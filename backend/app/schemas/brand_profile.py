"""Schemas for the Brand Profile ("brand DNA") onboarding step (PRD.md §5 step 3.5).

A short, one-time questionnaire the Strategist/Creative Agents are
grounded in (a "Brand voice" prompt block, app/services/strategist.py and
creative.py) so generated strategy/ad copy stays consistent and on-brand
across campaigns. One per business — created once, editable later.
"""

from typing import Literal, get_args

from pydantic import Field, field_validator

from app.schemas.base import CamelCaseModel

# Pasted into the Strategist/Creative Agent prompts verbatim (quarantined
# via app/services/prompt_safety.py, same reasoning as Business.description
# and Product.description) — capped so none of these can balloon the prompt.
_MAX_DESCRIPTION_LENGTH = 1000
_MAX_IDEAL_CUSTOMER_LENGTH = 1000
_MAX_PHRASES_LENGTH = 750
_MAX_TAGLINE_LENGTH = 150
_MAX_COMPETITORS_LENGTH = 1000
_MAX_EXAMPLE_COPY_LENGTH = 2000
_MAX_PROOF_POINT_LENGTH = 200
_MAX_PROOF_POINTS = 10
_MAX_OFFER_LENGTH = 200

# Fixed list, confirmed 2026-09-11 — same Literal-type-alias + *_LABELS
# pattern as Objective/Industry (app/schemas/campaign.py, business.py):
# SQLite has no native enum, so the underlying DB column stays a plain
# String (BrandProfile.voiceTraits, JSON-serialized array of these
# values) and this Literal is what actually enforces the fixed list, at
# the request-validation layer.
VoiceTrait = Literal[
    "LUXURIOUS",
    "PLAYFUL",
    "MINIMAL",
    "WARM",
    "BOLD",
    "ARTISANAL",
    "EDGY",
    "PROFESSIONAL",
]

VOICE_TRAIT_LABELS: dict[VoiceTrait, str] = {
    "LUXURIOUS": "Luxurious",
    "PLAYFUL": "Playful",
    "MINIMAL": "Minimal",
    "WARM": "Warm",
    "BOLD": "Bold",
    "ARTISANAL": "Artisanal",
    "EDGY": "Edgy",
    "PROFESSIONAL": "Professional",
}

assert set(get_args(VoiceTrait)) == set(VOICE_TRAIT_LABELS)

PricePositioning = Literal["AFFORDABLE", "MID", "PREMIUM", "LUXURY"]

PRICE_POSITIONING_LABELS: dict[PricePositioning, str] = {
    "AFFORDABLE": "Affordable",
    "MID": "Mid-range",
    "PREMIUM": "Premium",
    "LUXURY": "Luxury",
}

assert set(get_args(PricePositioning)) == set(PRICE_POSITIONING_LABELS)


class BrandProfileCreateRequest(CamelCaseModel):
    """Payload for creating a business's brand profile (PRD.md §5 step 3.5).

    description/ideal_customer/voice_traits/price_positioning are required
    — the onboarding questionnaire's minimum for a usable "Brand voice"
    prompt block; everything else is optional, filled in whenever the user
    has it.
    """

    description: str = Field(max_length=_MAX_DESCRIPTION_LENGTH)
    ideal_customer: str = Field(max_length=_MAX_IDEAL_CUSTOMER_LENGTH)
    voice_traits: list[VoiceTrait] = Field(min_length=1)
    price_positioning: PricePositioning
    brand_phrases: str | None = Field(default=None, max_length=_MAX_PHRASES_LENGTH)
    avoid_phrases: str | None = Field(default=None, max_length=_MAX_PHRASES_LENGTH)
    tagline: str | None = Field(default=None, max_length=_MAX_TAGLINE_LENGTH)
    competitors: str | None = Field(default=None, max_length=_MAX_COMPETITORS_LENGTH)
    example_copy: str | None = Field(default=None, max_length=_MAX_EXAMPLE_COPY_LENGTH)
    # Both optional and both feed the Creative Agent (Part 2/3, confirmed
    # 2026-09-12): proof_points grounds the description slot/a trust line
    # ("4.8★ from 2,100 reviews", "Free shipping over $75", ...);
    # offer is the business's own standing promotion ("20% off first
    # order with WELCOME20") — distinct from a campaign's own
    # Strategy.offer — and is what gates GET_OFFER CTA eligibility
    # (app/schemas/creative.py's ALLOWED_CTAS_BY_OBJECTIVE validator).
    proof_points: list[str] = Field(default_factory=list, max_length=_MAX_PROOF_POINTS)
    offer: str | None = Field(default=None, max_length=_MAX_OFFER_LENGTH)

    @field_validator("proof_points")
    @classmethod
    def _validate_proof_points(cls, value: list[str]) -> list[str]:
        cleaned = [item.strip() for item in value if item.strip()]
        for item in cleaned:
            if len(item) > _MAX_PROOF_POINT_LENGTH:
                raise ValueError(
                    f"Each proof point must be at most {_MAX_PROOF_POINT_LENGTH} "
                    f"characters (got {len(item)}): {item!r}"
                )
        return cleaned


class BrandProfileUpdateRequest(CamelCaseModel):
    """Payload for PATCH .../brand-profile — a partial update.

    Every field optional; only ones explicitly provided change (same
    exclude_unset convention as BusinessUpdateRequest/ProductUpdateRequest).
    voice_traits, given, replaces the whole list — there's no "add one
    trait" endpoint, matching how a checkbox-group form naturally submits
    its full current selection.
    """

    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)
    ideal_customer: str | None = Field(
        default=None, max_length=_MAX_IDEAL_CUSTOMER_LENGTH
    )
    voice_traits: list[VoiceTrait] | None = Field(default=None, min_length=1)
    price_positioning: PricePositioning | None = None
    brand_phrases: str | None = Field(default=None, max_length=_MAX_PHRASES_LENGTH)
    avoid_phrases: str | None = Field(default=None, max_length=_MAX_PHRASES_LENGTH)
    tagline: str | None = Field(default=None, max_length=_MAX_TAGLINE_LENGTH)
    competitors: str | None = Field(default=None, max_length=_MAX_COMPETITORS_LENGTH)
    example_copy: str | None = Field(default=None, max_length=_MAX_EXAMPLE_COPY_LENGTH)
    # None (the default) leaves it unchanged, same convention as every
    # other field here — pass an empty list to actually clear proof_points.
    proof_points: list[str] | None = Field(default=None, max_length=_MAX_PROOF_POINTS)
    offer: str | None = Field(default=None, max_length=_MAX_OFFER_LENGTH)

    @field_validator("proof_points")
    @classmethod
    def _validate_proof_points(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        cleaned = [item.strip() for item in value if item.strip()]
        for item in cleaned:
            if len(item) > _MAX_PROOF_POINT_LENGTH:
                raise ValueError(
                    f"Each proof point must be at most {_MAX_PROOF_POINT_LENGTH} "
                    f"characters (got {len(item)}): {item!r}"
                )
        return cleaned


class BrandProfileResponse(CamelCaseModel):
    """Public-facing representation of a BrandProfile.

    logo_url rides along here too (computed from the parent Business, same
    as BusinessResponse's own field) — the frontend's brand-profile view
    is the natural single place to show the whole brand identity (logo +
    voice) together, without a second business fetch.
    """

    id: str
    business_id: str
    description: str
    ideal_customer: str
    voice_traits: list[VoiceTrait]
    price_positioning: PricePositioning
    brand_phrases: str | None
    avoid_phrases: str | None
    tagline: str | None
    competitors: str | None
    example_copy: str | None
    proof_points: list[str]
    offer: str | None
    logo_url: str | None
