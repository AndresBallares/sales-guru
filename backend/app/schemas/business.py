"""Schemas for business onboarding endpoints."""

from pydantic import Field

from app.schemas.base import CamelCaseModel

# This text is pasted into the Strategist/Creative Agent prompts verbatim
# (app/services/strategist.py, app/services/creative.py, quarantined via
# app/services/prompt_safety.py) — capped so a pasted-in About page can't
# balloon the prompt, same reasoning as Product.description's own cap.
_MAX_DESCRIPTION_LENGTH = 1000


class BusinessCreateRequest(CamelCaseModel):
    """Payload for creating a business (PRD.md §7)."""

    name: str
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)


class BusinessUpdateRequest(CamelCaseModel):
    """Payload for PATCH .../businesses/{id} — a partial update.

    Only name and description can be changed here (confirmed 2026-09-08)
    — website/industry/location aren't editable through this endpoint,
    since nothing has asked for that yet. Only fields explicitly provided
    change; an omitted field is left as it is (app/api/business.py's
    update_business uses model_dump's exclude_unset, same convention as
    ProductUpdateRequest).
    """

    name: str | None = None
    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)


class BusinessResponse(CamelCaseModel):
    """Public-facing representation of a Business."""

    id: str
    name: str
    website: str | None
    industry: str | None
    location: str | None
    description: str | None
