"""Creative Agent (PRD.md build step 6).

Strategy -> Creative Agent -> Creative A/B/C/D, each with {Primary Text,
Headline, Description, CTA, Image Prompt, Video Prompt}.

Same forced-tool-use approach as the Marketing Strategist Agent
(app/services/strategist.py) for guaranteed-structured output — the model
must call a single tool whose input_schema is generated directly from
GeneratedCreativeBatch, so the response is either schema-valid (exactly
four variants) or the call fails cleanly.
"""

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import Business, Product

from app.core.config import get_settings
from app.schemas.creative import GeneratedCreativeBatch, GeneratedCreativeVariant
from app.schemas.strategy import StrategyContent

_MODEL = "claude-sonnet-5"
_MAX_TOKENS = 4096
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
        lines.append(f"About: {business.description}")

    if product is not None:
        lines += ["", f"Product: {product.description}"]
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
    if strategy.target_audience.problem:
        lines.append(f"Target audience problem: {strategy.target_audience.problem}")
    if strategy.target_audience.desire:
        lines.append(f"Target audience desire: {strategy.target_audience.desire}")
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

    batch = GeneratedCreativeBatch.model_validate(tool_use.input)
    return batch.variants
