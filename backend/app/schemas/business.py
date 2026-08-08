"""Schemas for business onboarding endpoints."""

from app.schemas.base import CamelCaseModel


class BusinessCreateRequest(CamelCaseModel):
    """Payload for creating a business (PRD.md §7)."""

    name: str
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    description: str | None = None


class BusinessResponse(CamelCaseModel):
    """Public-facing representation of a Business."""

    id: str
    name: str
    website: str | None
    industry: str | None
    location: str | None
    description: str | None
