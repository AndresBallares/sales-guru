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

**Fake mode (Settings.fake_llm_enabled, confirmed 2026-09-09):**
generate_creatives — the single function that actually calls Anthropic —
returns a canned, schema-valid batch instead when the flag is on. Exists
so e2e tests can generate ad creatives with no real ANTHROPIC_API_KEY and
no dependency on live model output, same reasoning as strategist.py's own
fake mode.

**Vision grounding (confirmed 2026-09-09):** when the product has a
primary photo (app/api/product_image.py's get_primary_image), it's passed
as an image content block alongside the text prompt — Claude is a vision-
capable model already (no model swap needed), so headlines/descriptions
can reflect what the product actually looks like, not just its written
description. Fake mode is unaffected either way (see above).
"""

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

from app.core.config import get_settings
from app.schemas.creative import (
    CtaType,
    GeneratedCreativeBatch,
    GeneratedCreativeVariant,
)
from app.schemas.strategy import StrategyContent, primary_audience
from app.services.brand_voice import brand_voice_lines
from app.services.prompt_safety import quarantine
from app.services.tool_use import parse_tool_input

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

# Fake mode canned batch — built from the real GeneratedCreativeVariant
# model (not a hand-written dict), so a schema change breaks this loudly
# rather than drifting out of sync silently.
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


class CreativeAgentError(RuntimeError):
    """Raised when the Creative Agent fails to produce ad creatives."""


def _build_prompt(
    business: Business,
    product: Product | None,
    strategy: StrategyContent,
    *,
    has_image: bool = False,
    brand_profile: BrandProfile | None = None,
    has_logo: bool = False,
) -> str:
    """Build the grounding prompt from the business/product and its strategy.

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
            §5 step 3.5) — folded in as a "Brand voice" block. None falls
            back to current (no brand-specific steering) behavior.
        has_logo: Whether the business's logo is attached as an image
            content block alongside this prompt (see generate_creatives)
            — same has_image reasoning, a visual style cue rather than a
            literal product photo.

    Returns:
        The prompt text.
    """
    lines = [
        "You are an ad copywriter. Generate "
        f"{_VARIANT_COUNT} distinct ad creative variants for the business "
        "described below, grounded in the marketing strategy given — do "
        "not invent facts about the business that weren't provided.",
        "",
        f"Business: {business.name}",
    ]
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

    brand_voice = brand_voice_lines(brand_profile)
    if brand_voice:
        lines += [""] + brand_voice

    if product is not None:
        lines += ["", quarantine("Product", product.description)]
        if product.price is not None:
            lines.append(f"Price: {product.price}")
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
        f"Offer: {strategy.offer}",
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
        f"Campaign objective: {strategy.objective}",
        "",
        f"Generate exactly {_VARIANT_COUNT} variants, each built around a "
        "different creative angle where possible. Submit them using the "
        "provided tool.",
    ]
    return "\n".join(lines)


async def generate_creatives(
    *,
    business: Business,
    product: Product | None,
    strategy: StrategyContent,
    primary_image: PrismaProductImage | None = None,
    brand_profile: BrandProfile | None = None,
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
            Ignored in fake mode (see the module docstring).
        brand_profile: The business's brand profile, if one exists (PRD.md
            §5 step 3.5) — grounds the batch in a "Brand voice" block.
            None (the default — no profile yet) falls back to current
            behavior.

    Returns:
        Exactly four generated creative variants (Creative A-D).

    Raises:
        CreativeAgentError: If no API key is configured, the API call
            fails, or the model doesn't return a valid tool call.
    """
    settings = get_settings()
    if settings.fake_llm_enabled:
        return list(_FAKE_VARIANTS)
    if not settings.anthropic_api_key:
        raise CreativeAgentError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    has_image = primary_image is not None
    has_logo = business.logoData is not None
    prompt = _build_prompt(
        business,
        product,
        strategy,
        has_image=has_image,
        brand_profile=brand_profile,
        has_logo=has_logo,
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
    if primary_image is not None:
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

    content: str | list[ImageBlockParam | TextBlockParam]
    if image_blocks:
        content = [*image_blocks, {"type": "text", "text": prompt}]
    else:
        content = prompt
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

    batch = parse_tool_input(tool_use.input, GeneratedCreativeBatch)
    return batch.variants


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
