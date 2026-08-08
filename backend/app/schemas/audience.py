"""Schemas for audience onboarding endpoints."""

from app.schemas.base import CamelCaseModel


class AudienceCreateRequest(CamelCaseModel):
    """Payload for creating an audience (PRD.md §7)."""

    description: str
    age_min: int | None = None
    age_max: int | None = None
    location: str | None = None
    interests: str | None = None
    problem: str | None = None
    desire: str | None = None


class AudienceResponse(CamelCaseModel):
    """Public-facing representation of an Audience."""

    id: str
    description: str
    age_min: int | None
    age_max: int | None
    location: str | None
    interests: str | None
    problem: str | None
    desire: str | None
