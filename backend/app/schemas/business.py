"""Schemas for business onboarding endpoints."""

from typing import Literal, get_args

from pydantic import Field

from app.schemas.base import CamelCaseModel

# This text is pasted into the Strategist/Creative Agent prompts verbatim
# (app/services/strategist.py, app/services/creative.py, quarantined via
# app/services/prompt_safety.py) — capped so a pasted-in About page can't
# balloon the prompt, same reasoning as Product.description's own cap.
_MAX_DESCRIPTION_LENGTH = 1000

# Fixed list, confirmed 2026-09-08. Same Literal-type-alias pattern as
# Objective (app/schemas/campaign.py) — SQLite has no native enum support,
# so the Business.industry column stays a plain String on both
# schema.prisma and prisma/postgres/schema.prisma (see that file's header
# comment) and this Literal is what actually enforces the fixed list, at
# the request-validation layer. BusinessResponse.industry below stays a
# plain `str | None` rather than this Literal, though — a legacy row's
# freeform value (this field predates the fixed list) must still round-trip
# on read instead of failing response validation, since existing rows are
# deliberately not backfilled.
Industry = Literal[
    "ECOMMERCE",
    "FASHION_JEWELRY",
    "BEAUTY_COSMETICS",
    "REAL_ESTATE",
    "AUTOMOTIVE",
    "TRAVEL",
    "RESTAURANTS_FOOD",
    "SAAS_TECHNOLOGY",
    "PROFESSIONAL_SERVICES",
    "FITNESS_WELLNESS",
    "OTHER",
]

# Display labels for GET /options (app/api/options.py) — the frontend
# fetches this instead of hard-coding the list. Was its own GET
# /businesses/industries endpoint (2026-09-08); folded into the single
# /options endpoint the same day once EVENT_VENUES turned up as a second,
# frontend-hand-copied list that needed the same treatment.
INDUSTRY_LABELS: dict[Industry, str] = {
    "ECOMMERCE": "E-commerce",
    "FASHION_JEWELRY": "Fashion / Jewelry",
    "BEAUTY_COSMETICS": "Beauty & Cosmetics",
    "REAL_ESTATE": "Real Estate",
    "AUTOMOTIVE": "Automotive",
    "TRAVEL": "Travel",
    "RESTAURANTS_FOOD": "Restaurants / Food",
    "SAAS_TECHNOLOGY": "SaaS / Technology",
    "PROFESSIONAL_SERVICES": "Professional Services",
    "FITNESS_WELLNESS": "Fitness / Wellness",
    "OTHER": "Other",
}

# get_args preserves declaration order (Python 3.7+ dict/typing semantics),
# so this and INDUSTRY_LABELS above always agree on ordering.
assert set(get_args(Industry)) == set(INDUSTRY_LABELS)


class BusinessCreateRequest(CamelCaseModel):
    """Payload for creating a business (PRD.md §7).

    industry is required (confirmed 2026-09-08), unlike website/location/
    description which stay optional to keep signup friction low. It's
    appended as prompt context for the Strategist/Creative Agents (app/
    services/strategist.py, app/services/creative.py) alongside
    description, but — unlike description — has no length-driven reason to
    stay optional, so it's required outright.
    """

    name: str
    website: str | None = None
    industry: Industry
    location: str | None = None
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)


class BusinessUpdateRequest(CamelCaseModel):
    """Payload for PATCH .../businesses/{id} — a partial update.

    name, description, and industry can be changed here (industry added
    2026-09-08, superseding an earlier 2026-09-08 decision that had left
    it out) — website/location still aren't editable through this
    endpoint, since nothing has asked for that yet. Only fields explicitly
    provided change; an omitted field is left as it is (app/api/
    business.py's update_business uses model_dump's exclude_unset, same
    convention as ProductUpdateRequest).
    """

    name: str | None = None
    industry: Industry | None = None
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)


class BusinessResponse(CamelCaseModel):
    """Public-facing representation of a Business."""

    id: str
    name: str
    website: str | None
    industry: str | None
    location: str | None
    description: str | None
