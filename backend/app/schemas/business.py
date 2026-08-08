"""Schemas for business onboarding endpoints."""

from pydantic import BaseModel


class BusinessCreateRequest(BaseModel):
    """Payload for creating a business (PRD.md §7)."""

    name: str
    website: str | None = None
    industry: str | None = None
    location: str | None = None
    description: str | None = None


class BusinessResponse(BaseModel):
    """Public-facing representation of a Business."""

    id: str
    name: str
    website: str | None
    industry: str | None
    location: str | None
    description: str | None
