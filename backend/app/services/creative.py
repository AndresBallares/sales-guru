"""Creative Agent (PRD.md build step 6).

Strategy -> Creative Agent -> Creative A/B/C/D, each with {Primary Text,
Headline, Description, CTA, Image Prompt, Video Prompt}.

Same forced-tool-use approach as the Marketing Strategist Agent
(app/services/strategist.py) for guaranteed-structured output — the model
must call a single tool whose input_schema is generated directly from
GeneratedCreativeBatch, so the response is either schema-valid (exactly
four variants) or the call fails cleanly. Also shares that module's
parse_tool_input (app/services/tool_use.py) to tolerate a model wrapping
its output under one stray top-level key instead of matching the schema
directly.

**Objective-aware CTA (confirmed 2026-09-12):** app/schemas/creative.py's
GeneratedCreativeBatch enforces, at the schema level (not just prompted
for), that every variant shares one CTA and that CTA is one this
campaign's objective actually allows (ALLOWED_CTAS_BY_OBJECTIVE) — a SALES
campaign no longer comes back with LEARN_MORE on one variant and GET_OFFER
on another. generate_creatives below retries once (with the validation
error appended to the prompt) on a business-rule failure, then falls back
to coercing the batch (default CTA for the objective, over-length text
truncated at a word boundary) rather than failing the whole generation —
see _coerce_batch.

**Fake mode (Settings.fake_llm_enabled, confirmed 2026-09-09):**
generate_creatives — the single function that actually calls Anthropic —
returns a canned, schema-valid batch instead when the flag is on. Exists
so e2e tests can generate ad creatives with no real ANTHROPIC_API_KEY and
no dependency on live model output, same reasoning as strategist.py's own
fake mode. Deliberately bypasses GeneratedCreativeBatch's own validation
entirely (returns _FAKE_VARIANTS directly) — it's canned test fixture
data, not a real objective-aware batch.

**Vision grounding (confirmed 2026-09-09):** when the product has a
primary photo (app/api/product_image.py's get_primary_image), it's passed
as an image content block alongside the text prompt — Claude is a vision-
capable model already (no model swap needed), so headlines/descriptions
can reflect what the product actually looks like, not just its written
description. Fake mode is unaffected either way (see above).

**Carousel format (confirmed 2026-09-12):** when the caller requests
CAROUSEL (app/schemas/creative.py's CreativeFormat), every card's image
is attached to the model up front — a real behavioral difference from
SINGLE_IMAGE, whose image is chosen later at select_creative
(app/api/creative.py). CAROUSEL needs its cards' copy written against
their actual images at generation time, so there's no later "pick an
image" step for it the way there is for SINGLE_IMAGE. V1 is single-product
only — every card draws from the same product's photos (ProductImage.
position order, capped at MAX_CAROUSEL_CARDS) and shares one link. Each
variant's cards get their own headline/description; body_text/cta/
creative_angle stay shared across a variant's own cards, same as before.
"""

import copy
import json
import logging
from typing import Literal, cast

import anthropic
from anthropic import AsyncAnthropic
from anthropic.types import (
    ImageBlockParam,
    MessageParam,
    TextBlockParam,
)
from prisma.models import BrandProfile, Business, Campaign, Creative, Product
from prisma.models import ProductImage as PrismaProductImage
from pydantic import ValidationError

from app.core.config import get_settings
from app.schemas.campaign import Objective
from app.schemas.creative import (
    ALLOWED_CTAS_BY_OBJECTIVE,
    DEFAULT_CTA_BY_OBJECTIVE,
    MAX_BODY_TEXT_LENGTH,
    MAX_DESCRIPTION_LENGTH,
    MAX_HEADLINE_LENGTH,
    CreativeFormat,
    CtaType,
    GeneratedCreativeBatch,
    GeneratedCreativeCard,
    GeneratedCreativeVariant,
)
from app.schemas.strategy import StrategyContent, primary_audience
from app.services.brand_voice import brand_voice_lines
from app.services.prompt_safety import quarantine
from app.services.tool_use import ToolInputRecoveryError, parse_tool_input

logger = logging.getLogger(__name__)

_MODEL = "claude-sonnet-5"
# Four variants x {headline, body_text, description, cta, creative_angle,
# image_prompt, video_prompt} is a lot of real content — 4096 was
# occasionally too tight and truncated mid-JSON (confirmed 2026-09-09,
# surfaced by real e2e generation rather than any mocked test: the
# truncated tail came back as a string tool_use.py's known-quirk
# recovery couldn't parse, since it wasn't merely mis-shaped JSON but
# genuinely incomplete).
_MAX_TOKENS = 8192
_TOOL_NAME = "submit_creatives"
_VARIANT_COUNT = 4

# ProductImage.contentType is a plain str at the type level (validated at
# upload time, app/schemas/product_image.py's ALLOWED_CONTENT_TYPES), but
# Anthropic's Base64ImageSourceParam wants this exact Literal — the cast
# at its one use site below is safe because every stored image was
# already restricted to this same {jpeg, png} pair on the way in.
_SupportedImageMediaType = Literal["image/jpeg", "image/png", "image/gif", "image/webp"]

# Reference angle structures per industry (Part 3.4, confirmed
# 2026-09-12) — structural examples the model adapts, never copy to reuse
# verbatim. A simple dict keyed by Business.industry so per-industry
# templates can be added later without touching the prompt builder itself;
# any industry not listed (9 of the app's 10 today) falls back to
# _DEFAULT_ANGLE_TEMPLATES. "offer + urgency" is dropped from either list
# in the prompt itself when the business has no standing promotion — an
# urgency angle around a discount that doesn't exist would be false
# advertising, not just a weak angle.
_DEFAULT_ANGLE_TEMPLATES: tuple[str, ...] = (
    "benefit + trust line",
    "social proof + product",
    "offer + urgency",
)
_ANGLE_TEMPLATES_BY_INDUSTRY: dict[str, tuple[str, ...]] = {
    "FASHION_JEWELRY": (
        "product + material + trust line",
        "social proof + product",
        "offer + urgency",
    ),
}

# Fake mode canned batch — built from the real GeneratedCreativeVariant
# model (not a hand-written dict), so a schema change breaks this loudly
# rather than drifting out of sync silently. Deliberately four different
# CTAs (unlike a real batch, which always shares one) — this is canned
# fixture data for e2e/tests, never passed through GeneratedCreativeBatch's
# own shared-CTA validation.
_FAKE_CTAS: tuple[CtaType, CtaType, CtaType, CtaType] = (
    "SHOP_NOW",
    "LEARN_MORE",
    "SIGN_UP",
    "SUBSCRIBE",
)
_FAKE_VARIANTS: list[GeneratedCreativeVariant] = [
    GeneratedCreativeVariant(
        headline=f"Fake headline {letter}",
        body_text=f"Fake body text {letter} (FAKE_LLM mode).",
        description=f"Fake description {letter}.",
        cta=cta,
        creative_angle=f"Fake creative angle {letter}",
        image_prompt=f"Fake image prompt {letter}.",
        video_prompt=f"Fake video prompt {letter}.",
    )
    for letter, cta in zip("ABCD", _FAKE_CTAS, strict=True)
]


def _fake_carousel_variants(card_count: int) -> list[GeneratedCreativeVariant]:
    """Fake mode's CAROUSEL batch — same reasoning as _FAKE_VARIANTS above.

    card_count mirrors however many card images the caller actually
    attached (2-10) rather than a hardcoded number, so fake mode e2e
    coverage exercises the same card count a real call would have
    produced from that same product's photos.
    """
    return [
        GeneratedCreativeVariant(
            headline=f"Fake headline {letter}",
            body_text=f"Fake body text {letter} (FAKE_LLM mode).",
            description=f"Fake description {letter}.",
            cta=cta,
            creative_angle=f"Fake creative angle {letter}",
            image_prompt=f"Fake image prompt {letter}.",
            video_prompt=f"Fake video prompt {letter}.",
            cards=[
                GeneratedCreativeCard(
                    headline=f"Fake card {position + 1} headline {letter}",
                    description=f"Fake card {position + 1} description {letter}.",
                )
                for position in range(card_count)
            ],
        )
        for letter, cta in zip("ABCD", _FAKE_CTAS, strict=True)
    ]


class CreativeAgentError(RuntimeError):
    """Raised when the Creative Agent fails to produce ad creatives."""


def _angle_templates_for_industry(industry: str | None) -> tuple[str, ...]:
    """Reference angle structures for this industry, or the generic fallback."""
    return _ANGLE_TEMPLATES_BY_INDUSTRY.get(industry or "", _DEFAULT_ANGLE_TEMPLATES)


def _truncate_at_word_boundary(text: str, max_length: int) -> str:
    """Shorten text to at most max_length characters without cutting mid-word.

    Used only by the coercion fallback (generate_creatives) after two
    real attempts still came back over a slot's limit — falls back to a
    hard cut only when there's no space to break on at all (one long word).
    """
    stripped = text.strip()
    if len(stripped) <= max_length:
        return stripped
    truncated = stripped[:max_length]
    last_space = truncated.rfind(" ")
    return (truncated[:last_space] if last_space > 0 else truncated).rstrip()


def _build_prompt(
    business: Business,
    product: Product | None,
    strategy: StrategyContent,
    *,
    has_image: bool = False,
    brand_profile: BrandProfile | None = None,
    has_logo: bool = False,
    format: CreativeFormat = "SINGLE_IMAGE",
    card_count: int = 0,
) -> str:
    """Build the grounding prompt from the business/product and its strategy.

    Order (confirmed with the user 2026-09-12, Part 3): objective + the
    exact allowed CTA set, brand profile (voice/positioning plus the
    business's own standing promotion and proof points), product, then
    industry reference angle structures — each section building on facts
    established by the one before it, so the model sees "what CTA can I
    even use" before it sees anything that might tempt a different one.

    Args:
        business: The business the creatives are for.
        product: The product being advertised, if one was selected.
        strategy: The campaign's already-generated marketing strategy —
            the creatives must be built around it, not invent a new angle.
        has_image: Whether the product's primary photo is attached as an
            image content block alongside this prompt (see
            generate_creatives) — adds a line telling the model to
            actually look at it, since a forced-tool-use call otherwise
            gives it no explicit cue to attend to an earlier image block
            over the text description.
        brand_profile: The business's brand profile, if one exists (PRD.md
            §5 step 3.5) — folded in as a "Brand voice" block, plus its
            own proof_points/offer fields directly (not part of
            brand_voice_lines, which is shared with the Strategist Agent
            and doesn't carry this CTA-eligibility-specific framing).
            None falls back to current (no brand-specific steering)
            behavior.
        has_logo: Whether the business's logo is attached as an image
            content block alongside this prompt (see generate_creatives)
            — same has_image reasoning, a visual style cue rather than a
            literal product photo.
        format: SINGLE_IMAGE (default) or CAROUSEL — CAROUSEL adds
            instructions for the per-card headline/description structure
            below and implies has_image is irrelevant (every card image
            is attached instead of just the primary one).
        card_count: How many product photos are attached as per-card
            image blocks, when format is CAROUSEL (see generate_creatives)
            — ignored for SINGLE_IMAGE.

    Returns:
        The prompt text.
    """
    objective = strategy.objective
    allowed_ctas = sorted(ALLOWED_CTAS_BY_OBJECTIVE.get(objective, set()))
    standing_offer = brand_profile.offer if brand_profile is not None else None
    proof_points = (
        cast(list[str], json.loads(brand_profile.proofPoints))
        if brand_profile is not None and brand_profile.proofPoints
        else []
    )

    lines = [
        "You are an ad copywriter. Generate "
        f"{_VARIANT_COUNT} distinct ad creative variants for the business "
        "described below, grounded in the marketing strategy given — do "
        "not invent facts about the business that weren't provided.",
        "",
        f"Campaign objective: {objective}",
        "You must choose the CTA from exactly this set: "
        f"{', '.join(allowed_ctas)}. All four variants in this batch must "
        "use that same CTA — do not vary it across variants.",
    ]
    if "GET_OFFER" in allowed_ctas:
        if standing_offer:
            lines.append(
                "GET_OFFER is only usable if every variant's primary text "
                "actually names or clearly references the standing "
                "promotion given below — don't choose it otherwise."
            )
        else:
            lines.append(
                "GET_OFFER is not usable right now: this business has no "
                "standing promotion set. Do not choose it."
            )

    lines += ["", f"Business: {business.name}"]
    if business.industry:
        lines.append(f"Industry: {business.industry}")
    if business.description:
        lines.append(quarantine("About", business.description))
    if has_logo:
        lines.append(
            "The business's logo is attached above — use it only as a "
            "visual style cue (color palette, mood, level of formality), "
            "never as a literal subject to describe in the copy."
        )
    if format == "CAROUSEL":
        lines.append(
            f"This is a CAROUSEL ad: {card_count} photos of the product "
            "are attached above, in display order — the first attached "
            "photo is card 1, the second is card 2, and so on."
        )

    brand_voice = brand_voice_lines(brand_profile)
    if brand_voice:
        lines += [""] + brand_voice
    if proof_points:
        lines.append(
            "Proof points/trust lines on file — use one for the "
            "description slot (or a trust line elsewhere) when it fits; "
            "never invent a proof point that isn't listed here: "
            + "; ".join(proof_points)
        )
    lines += [
        f"Standing promotion (from brand profile): {standing_offer or 'none'}",
        f"Campaign strategic offer: {strategy.offer}",
        "These are two different things, so don't conflate them: the "
        "standing promotion is this business's own ongoing deal, if any "
        "(and is what determines whether GET_OFFER is usable above); the "
        "campaign strategic offer is this campaign's value framing from "
        "its strategy and isn't necessarily a discount.",
    ]

    if product is not None:
        lines += ["", quarantine("Product", product.description)]
        if product.price is not None:
            lines.append(f"Price: {product.price}")
        if product.url:
            lines.append(f"Product URL: {product.url}")
        if product.features:
            lines.append(f"Features: {product.features}")
        if product.benefits:
            lines.append(f"Benefits: {product.benefits}")
        if has_image:
            lines.append(
                "A photo of the product is attached above — ground the "
                "creative angles in what it actually looks like (materials, "
                "color, style), in addition to the description and "
                "features/benefits given here."
            )
    else:
        lines += ["", "No specific product was selected for this campaign."]

    lines += [
        "",
        f"Positioning: {strategy.positioning}",
        f"Copy strategy: {strategy.copy_strategy}",
        f"Creative angles to draw from: {', '.join(strategy.creative_angles)}",
    ]
    audience = primary_audience(strategy)
    if audience.problem:
        lines.append(f"Target audience problem: {audience.problem}")
    if audience.desire:
        lines.append(f"Target audience desire: {audience.desire}")

    lines += [
        "",
        "Reference angle structures for this industry (structural "
        "examples to adapt, never copy to reuse verbatim):",
    ]
    for template in _angle_templates_for_industry(business.industry):
        if template == "offer + urgency" and not standing_offer:
            continue
        lines.append(f"- {template}")

    lines += [
        "",
        "Business website (this appears automatically as the ad's display "
        f"link — never write the domain into the copy itself): "
        f"{business.website or 'none'}",
        "",
        f"Generate exactly {_VARIANT_COUNT} variants, each built around a "
        "different creative angle (draw from the creative angles and "
        "reference structures above where possible) — every variant's "
        "angle must be distinct from the others. Each variant needs: "
        f"body_text as the primary text (at most {MAX_BODY_TEXT_LENGTH} "
        f"characters — it must read complete before Meta's own truncation "
        f"cuts it off), a headline (at most {MAX_HEADLINE_LENGTH} "
        f"characters), an optional description (at most "
        f"{MAX_DESCRIPTION_LENGTH} characters — omit it if no proof point "
        "fits, don't pad it), the one shared CTA chosen above, and the "
        "creative angle.",
    ]
    if format == "CAROUSEL":
        lines.append(
            f"Each variant must also include a cards list of exactly "
            f"{card_count} cards, one per attached product photo in the "
            "same order they were attached (card 1 = the first attached "
            "photo, and so on). Every card needs its own headline (at "
            f"most {MAX_HEADLINE_LENGTH} characters) calling out something "
            "specific to that photo — angle, feature, or use case — and an "
            f"optional description (at most {MAX_DESCRIPTION_LENGTH} "
            "characters). The variant's own body_text and CTA (above) "
            "stay shared across all of its cards — don't repeat them per "
            "card, and don't give cards their own CTA."
        )
    lines.append("Submit them using the provided tool.")
    return "\n".join(lines)


def _coerce_batch(
    raw: dict[str, object], objective: Objective, failure: Exception
) -> list[GeneratedCreativeVariant]:
    """Best-effort recovery after two failed attempts at a valid batch.

    Forces the objective's default CTA onto every variant (resolves both
    "CTA not allowed for this objective" and any GET_OFFER-eligibility
    failure at once, since neither applies once the CTA changes) and
    truncates any over-length headline/body_text/description at a word
    boundary — including each card's own headline/description, for a
    CAROUSEL batch (confirmed 2026-09-12, same reasoning as the top-level
    fields) — then re-validates structurally only (no business-rule
    context — the coercion above is exactly what would otherwise fail
    those rules; see GeneratedCreativeBatch's own docstring for why
    context=None skips them). Doesn't attempt to fix anything else (e.g.
    two variants sharing an angle, a wrong card count, or genuinely
    malformed input) — those still raise, since no coercion for them was
    ever specified.

    Args:
        raw: The second attempt's raw tool_use.input, already known not
            to validate against the full (context-aware) rules.
        objective: The campaign's objective, for its default CTA.
        failure: The validation failure being recovered from, logged for
            visibility into what the model kept getting wrong.

    Returns:
        The coerced batch's variants.

    Raises:
        CreativeAgentError: If the coerced result still doesn't even
            structurally validate.
    """
    default_cta = DEFAULT_CTA_BY_OBJECTIVE.get(objective, "LEARN_MORE")
    logger.warning(
        "Creative Agent output still invalid after one retry (%s) — "
        "coercing every variant's CTA to %s and truncating any "
        "over-length text.",
        failure,
        default_cta,
    )
    coerced = copy.deepcopy(raw)
    variants = coerced.get("variants")
    if isinstance(variants, list):
        for variant in variants:
            if not isinstance(variant, dict):
                continue
            variant["cta"] = default_cta
            if isinstance(variant.get("headline"), str):
                variant["headline"] = _truncate_at_word_boundary(
                    variant["headline"], MAX_HEADLINE_LENGTH
                )
            if isinstance(variant.get("bodyText"), str):
                variant["bodyText"] = _truncate_at_word_boundary(
                    variant["bodyText"], MAX_BODY_TEXT_LENGTH
                )
            if isinstance(variant.get("description"), str):
                variant["description"] = _truncate_at_word_boundary(
                    variant["description"], MAX_DESCRIPTION_LENGTH
                )
            cards = variant.get("cards")
            if isinstance(cards, list):
                for card in cards:
                    if not isinstance(card, dict):
                        continue
                    if isinstance(card.get("headline"), str):
                        card["headline"] = _truncate_at_word_boundary(
                            card["headline"], MAX_HEADLINE_LENGTH
                        )
                    if isinstance(card.get("description"), str):
                        card["description"] = _truncate_at_word_boundary(
                            card["description"], MAX_DESCRIPTION_LENGTH
                        )
    try:
        # No context — the fixes above target exactly the two
        # context-dependent rules; re-checking them here would just
        # re-raise on data we already know is now compliant, or (for
        # GET_OFFER specifically) reject a CTA we deliberately moved away
        # from anyway.
        batch = parse_tool_input(coerced, GeneratedCreativeBatch)
    except (ValidationError, ToolInputRecoveryError) as exc:
        raise CreativeAgentError(
            "Creative Agent output was invalid even after a retry and "
            f"coercion attempt: {exc}"
        ) from exc
    return batch.variants


def _check_card_counts_match_images(
    variants: list[GeneratedCreativeVariant], expected_card_count: int
) -> None:
    """Every CAROUSEL variant has exactly one card per image attached.

    A card count within the general 2-10 range (GeneratedCreativeVariant's
    own unconditional _check_card_count) isn't enough on its own — each
    card is meant to correspond 1:1, in order, to one of the product
    photos actually attached to the request, so the caller can zip cards
    to images without silently dropping one or the other.

    Applied uniformly after generate_creatives' happy path, retry, *and*
    coercion fallback (called once, after all three) rather than as a
    GeneratedCreativeBatch validator gated on a "card_count" context key
    — a context-gated check would be silently skipped by _coerce_batch's
    own re-validation, which deliberately drops context (see its
    docstring), reopening exactly the mismatch this exists to catch.

    Args:
        variants: The batch about to be returned to the caller.
        expected_card_count: How many images were actually attached.

    Raises:
        CreativeAgentError: If any variant's card count doesn't match.
    """
    for index, variant in enumerate(variants):
        if variant.cards is not None and len(variant.cards) != expected_card_count:
            raise CreativeAgentError(
                f"Creative Agent variant {index} has {len(variant.cards)} "
                f"cards but {expected_card_count} product photos were "
                "attached — every variant needs exactly one card per "
                "attached photo"
            )


async def generate_creatives(
    *,
    business: Business,
    product: Product | None,
    strategy: StrategyContent,
    primary_image: PrismaProductImage | None = None,
    brand_profile: BrandProfile | None = None,
    format: CreativeFormat = "SINGLE_IMAGE",
    card_images: list[PrismaProductImage] | None = None,
) -> list[GeneratedCreativeVariant]:
    """Call the Creative Agent and return a batch of ad creative variants.

    Args:
        business: The business the creatives are for. Its logo (Business.
            logoData/logoContentType, if uploaded — app/api/business.py's
            upload_business_logo) is passed to the model as an additional
            vision input, same reasoning as primary_image below but as a
            visual style cue (color/mood) rather than a literal subject.
        product: The product being advertised, if one was selected.
        strategy: The campaign's already-generated marketing strategy.
        primary_image: The product's primary uploaded photo (app/api/
            product_image.py's get_primary_image), if it has one. Passed
            to the model as a vision input alongside the text prompt —
            Claude already reads images, so no model change is needed for
            this — grounding headlines/descriptions in what the product
            actually looks like, not just its written description.
            Ignored in fake mode (see the module docstring). Ignored
            entirely when format is CAROUSEL — card_images below is used
            instead.
        brand_profile: The business's brand profile, if one exists (PRD.md
            §5 step 3.5) — grounds the batch in a "Brand voice" block,
            plus its own proof_points/offer fields. None (the default —
            no profile yet) falls back to current behavior.
        format: SINGLE_IMAGE (default) or CAROUSEL. The caller
            (app/api/creative.py) is responsible for confirming the
            product has at least MIN_CAROUSEL_CARDS photos before
            requesting CAROUSEL — this function trusts card_images is
            already a valid-length (2-10), position-ordered list when
            format is CAROUSEL, and doesn't re-check it.
        card_images: The product's photos to build cards from, in display
            order (ProductImage.position order, already capped at
            MAX_CAROUSEL_CARDS by the caller) — one card is generated per
            image, in the same order. Required (non-None, 2-10 items)
            when format is CAROUSEL; ignored for SINGLE_IMAGE.

    Returns:
        Exactly four generated creative variants (Creative A-D), their
        shared CTA guaranteed to be one this campaign's objective allows.
        For CAROUSEL, each variant also carries a cards list matching
        card_images 1:1 in order.

    Raises:
        CreativeAgentError: If no API key is configured, the API call
            fails, the model doesn't return a tool call, or (after one
            retry and one coercion attempt) its output still doesn't
            structurally validate.
    """
    settings = get_settings()
    is_carousel = format == "CAROUSEL"
    if settings.fake_llm_enabled:
        if is_carousel:
            assert card_images is not None  # caller contract, see docstring
            return _fake_carousel_variants(len(card_images))
        return list(_FAKE_VARIANTS)
    if not settings.anthropic_api_key:
        raise CreativeAgentError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    has_image = not is_carousel and primary_image is not None
    has_logo = business.logoData is not None
    prompt = _build_prompt(
        business,
        product,
        strategy,
        has_image=has_image,
        brand_profile=brand_profile,
        has_logo=has_logo,
        format=format,
        card_count=len(card_images) if is_carousel and card_images else 0,
    )

    image_blocks: list[ImageBlockParam] = []
    if business.logoData is not None:
        logo_media_type = cast(_SupportedImageMediaType, business.logoContentType)
        image_blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": logo_media_type,
                    "data": str(business.logoData),
                },
            }
        )
    if is_carousel:
        assert card_images is not None  # caller contract, see docstring
        for card_image in card_images:
            card_media_type = cast(_SupportedImageMediaType, card_image.contentType)
            image_blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": card_media_type,
                        "data": str(card_image.data),
                    },
                }
            )
    elif primary_image is not None:
        media_type = cast(_SupportedImageMediaType, primary_image.contentType)
        image_blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": str(primary_image.data),
                },
            }
        )

    async def _call(prompt_text: str) -> dict[str, object]:
        content: str | list[ImageBlockParam | TextBlockParam]
        if image_blocks:
            content = [*image_blocks, {"type": "text", "text": prompt_text}]
        else:
            content = prompt_text
        message: MessageParam = {"role": "user", "content": content}
        try:
            response = await client.messages.create(
                model=_MODEL,
                max_tokens=_MAX_TOKENS,
                tools=[
                    {
                        "name": _TOOL_NAME,
                        "description": "Submit the generated ad creative variants.",
                        "input_schema": GeneratedCreativeBatch.model_json_schema(),
                    }
                ],
                tool_choice={"type": "tool", "name": _TOOL_NAME},
                messages=[message],
            )
        except anthropic.AnthropicError as exc:
            raise CreativeAgentError(f"Anthropic API call failed: {exc}") from exc

        tool_use = next(
            (block for block in response.content if block.type == "tool_use"), None
        )
        if tool_use is None:
            raise CreativeAgentError("Model did not return a tool call")
        return tool_use.input

    context: dict[str, object] = {
        "objective": strategy.objective,
        "standing_offer": brand_profile.offer if brand_profile is not None else None,
        "format": format,
    }
    expected_card_count = len(card_images) if is_carousel and card_images else None

    raw = await _call(prompt)
    try:
        batch = parse_tool_input(raw, GeneratedCreativeBatch, context=context)
        variants = batch.variants
    except (ValidationError, ToolInputRecoveryError) as first_failure:
        retry_prompt = (
            f"{prompt}\n\n"
            "Your previous submission was invalid and must be corrected:\n"
            f"{first_failure}\n"
            "Resubmit a complete, corrected batch of "
            f"{_VARIANT_COUNT} variants."
        )
        raw = await _call(retry_prompt)
        try:
            batch = parse_tool_input(raw, GeneratedCreativeBatch, context=context)
            variants = batch.variants
        except (ValidationError, ToolInputRecoveryError) as second_failure:
            variants = _coerce_batch(raw, strategy.objective, second_failure)

    if expected_card_count is not None:
        _check_card_counts_match_images(variants, expected_card_count)
    return variants


def is_creative_stale(
    creative: Creative, campaign: Campaign, product: Product | None, business: Business
) -> bool:
    """Whether a creative's source snapshot no longer matches its grounding.

    A creative is generated grounded in the business's description and a
    specific product's description/URL at that moment (see app/api/
    creative.py's create_creatives, which stamps sourceProductId/
    sourceDescription/sourceUrl/sourceBusinessDescription). It goes stale
    the moment any of those facts move out from under it — editing the
    business's own description, editing the product's description (Part
    1), or swapping the campaign onto a different product entirely (Part
    2) — because the ad copy/CTA no longer reflects what's actually being
    sold or who's selling it.

    Args:
        creative: The creative to check, with its source_* snapshot.
        campaign: Its parent campaign, for the current productId.
        product: The campaign's current product, or None if it has none.
            Must be the product identified by campaign.productId when one
            is set — callers are responsible for fetching the right row.
        business: The campaign's business — always present (unlike
            product), so its description is checked unconditionally,
            independent of whether a product is even attached.

    Returns:
        True if the creative's snapshot no longer matches the campaign's
        current business/product grounding. A campaign with no product
        attached is never stale on the *product* fields — that's "no
        product," a distinct case handled by the caller (e.g. show
        nothing to regenerate against) — but a business description
        mismatch is still staleness regardless.
    """
    if creative.sourceBusinessDescription != business.description:
        return True
    if campaign.productId is None:
        return False
    if creative.sourceProductId != campaign.productId:
        return True
    assert product is not None  # campaign.productId set implies its row exists (FK)
    if creative.sourceDescription != product.description:
        return True
    return creative.sourceUrl != product.url
