"""Shared "Brand voice" prompt block (PRD.md §5 step 3.5).

Both the Marketing Strategist Agent (app/services/strategist.py) and the
Creative Agent (app/services/creative.py) ground their prompts in the same
brand_voice_lines block whenever a business has filled in a BrandProfile —
one place so the two agents can never drift into describing the brand
differently.
"""

import json
from typing import cast

from prisma.models import BrandProfile

from app.schemas.brand_profile import (
    PRICE_POSITIONING_LABELS,
    VOICE_TRAIT_LABELS,
    PricePositioning,
    VoiceTrait,
)
from app.services.prompt_safety import quarantine


def brand_voice_lines(brand_profile: BrandProfile | None) -> list[str]:
    """The "Brand voice" grounding block, or [] with no profile at all.

    Falls back to current (no brand-specific steering) behavior when the
    business hasn't filled in a brand profile yet — this is a pure no-op
    in that case, not a placeholder note in the prompt. Every free-text
    field is quarantined (app/services/prompt_safety.py), same reasoning
    as Business/Product.description: user-authored text, always data,
    never instructions.

    Args:
        brand_profile: The business's brand profile, if one exists.

    Returns:
        Prompt lines for the brand voice block, or [] if brand_profile is
        None.
    """
    if brand_profile is None:
        return []
    voice_traits = ", ".join(
        VOICE_TRAIT_LABELS[trait]
        for trait in cast(list[VoiceTrait], json.loads(brand_profile.voiceTraits))
    )
    price_positioning = PRICE_POSITIONING_LABELS[
        cast(PricePositioning, brand_profile.pricePositioning)
    ]
    lines = [
        "Brand voice — this business has defined its own brand identity "
        "below. Write in this voice consistently: match the tone "
        "described by the voice traits, and match the stated price "
        "positioning in how you frame value and price.",
        f"Voice traits: {voice_traits}",
        f"Price positioning: {price_positioning}",
        quarantine("Brand description", brand_profile.description),
        quarantine("Ideal customer", brand_profile.idealCustomer),
    ]
    if brand_profile.brandPhrases:
        lines.append(
            quarantine(
                "Brand phrases — use these naturally where they fit, "
                "don't force them into every section",
                brand_profile.brandPhrases,
            )
        )
    if brand_profile.avoidPhrases:
        lines.append(
            quarantine(
                "Phrases to NEVER use, under any circumstance",
                brand_profile.avoidPhrases,
            )
        )
    if brand_profile.tagline:
        lines.append(quarantine("Tagline", brand_profile.tagline))
    if brand_profile.competitors:
        lines.append(
            quarantine("Competitors to differentiate from", brand_profile.competitors)
        )
    if brand_profile.exampleCopy:
        lines.append(
            quarantine(
                "Example of on-brand copy — match this style", brand_profile.exampleCopy
            )
        )
    return lines
