"""Marketing Strategist Agent (PRD.md build step 5).

USER -> Business Profile -> Marketing Strategist Agent -> {Target Audience,
Offer, Positioning, Campaign Objective, Creative Angles, Copy Strategy,
Budget Recommendation}.

Uses Claude's tool-use (forced tool call) rather than free-form JSON + a
parser — the model is required to call a single tool whose input_schema is
generated directly from GeneratedStrategyFields, so the response either
matches that schema or the call fails cleanly; there's no "the model wrote
almost-valid JSON" failure mode to handle.
"""

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import Audience, Business, Product

from app.core.config import get_settings
from app.schemas.strategy import GeneratedStrategyFields, StrategyContent

_MODEL = "claude-sonnet-5"
_MAX_TOKENS = 2048
_TOOL_NAME = "submit_strategy"


class StrategistError(RuntimeError):
    """Raised when the Marketing Strategist Agent fails to produce a strategy."""


def _build_prompt(
    business: Business,
    product: Product | None,
    audience: Audience | None,
    objective: str,
) -> str:
    """Build the grounding prompt from real business/product/audience data.

    Args:
        business: The business the strategy is for.
        product: The product being advertised, if one was selected.
        audience: The existing audience definition, if one was selected —
            treated as a hint to refine, not a fixed answer.
        objective: The campaign's fixed objective.

    Returns:
        The prompt text.
    """
    lines = [
        "You are a marketing strategist. Generate a complete advertising "
        "strategy for the business described below, grounded only in the "
        "information given — do not invent facts about the business that "
        "weren't provided.",
        "",
        f"Business: {business.name}",
    ]
    if business.industry:
        lines.append(f"Industry: {business.industry}")
    if business.location:
        lines.append(f"Location: {business.location}")
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

    if audience is not None:
        lines += ["", f"Existing audience notes: {audience.description}"]
        if audience.ageMin is not None or audience.ageMax is not None:
            lines.append(f"Age range hint: {audience.ageMin}-{audience.ageMax}")
        if audience.location:
            lines.append(f"Location hint: {audience.location}")
        if audience.interests:
            lines.append(f"Interests hint: {audience.interests}")
        if audience.problem:
            lines.append(f"Problem hint: {audience.problem}")
        if audience.desire:
            lines.append(f"Desire hint: {audience.desire}")
        lines.append("Refine and expand this into full targeting recommendations.")
    else:
        lines += ["", "No audience has been defined yet — recommend one from scratch."]

    lines += [
        "",
        f"Campaign objective: {objective}",
        "",
        "Submit your strategy using the provided tool.",
    ]
    return "\n".join(lines)


async def generate_strategy(
    *,
    business: Business,
    product: Product | None,
    audience: Audience | None,
    objective: str,
) -> StrategyContent:
    """Call the Marketing Strategist Agent and return a structured strategy.

    Args:
        business: The business the strategy is for.
        product: The product being advertised, if one was selected.
        audience: The existing audience definition, if one was selected.
        objective: The campaign's fixed objective — injected into the
            result directly rather than asked of the model, so it can never
            contradict what the user actually chose.

    Returns:
        The generated strategy, with `objective` set to the given value.

    Raises:
        StrategistError: If no API key is configured, the API call fails,
            or the model doesn't return a valid tool call.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise StrategistError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = _build_prompt(business, product, audience, objective)

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            tools=[
                {
                    "name": _TOOL_NAME,
                    "description": "Submit the generated marketing strategy.",
                    "input_schema": GeneratedStrategyFields.model_json_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": _TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AnthropicError as exc:
        raise StrategistError(f"Anthropic API call failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if block.type == "tool_use"), None
    )
    if tool_use is None:
        raise StrategistError("Model did not return a tool call")

    generated = GeneratedStrategyFields.model_validate(tool_use.input)
    # model_validate (not the constructor) because `objective` is plain str
    # here (that's what Prisma gives us — SQLite has no enum, PRD.md §7) and
    # needs real runtime validation against the Literal, not a static cast.
    return StrategyContent.model_validate(
        {**generated.model_dump(), "objective": objective}
    )
