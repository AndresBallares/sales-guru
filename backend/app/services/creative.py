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
"""

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import Business, Campaign, Creative, Product

from app.core.config import get_settings
from app.schemas.creative import GeneratedCreativeBatch, GeneratedCreativeVariant
from app.schemas.strategy import StrategyContent, primary_audience
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


class CreativeAgentError(RuntimeError):
    """Raised when the Creative Agent fails to produce ad creatives."""


def _build_prompt(
    business: Business, product: Product | None, strategy: StrategyContent
) -> str:
    """Build the grounding prompt from the business/product and its strategy.

    Args:
        business: The business the creatives are for.
        product: The product being advertised, if one was selected.
        strategy: The campaign's already-generated marketing strategy —
            the creatives must be built around it, not invent a new angle.

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

    if product is not None:
        lines += ["", quarantine("Product", product.description)]
        if product.price is not None:
            lines.append(f"Price: {product.price}")
        if product.features:
            lines.append(f"Features: {product.features}")
        if product.benefits:
            lines.append(f"Benefits: {product.benefits}")
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
) -> list[GeneratedCreativeVariant]:
    """Call the Creative Agent and return a batch of ad creative variants.

    Args:
        business: The business the creatives are for.
        product: The product being advertised, if one was selected.
        strategy: The campaign's already-generated marketing strategy.

    Returns:
        Exactly four generated creative variants (Creative A-D).

    Raises:
        CreativeAgentError: If no API key is configured, the API call
            fails, or the model doesn't return a valid tool call.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise CreativeAgentError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = _build_prompt(business, product, strategy)

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
            messages=[{"role": "user", "content": prompt}],
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
