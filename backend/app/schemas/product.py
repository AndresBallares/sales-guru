"""Schemas for product onboarding endpoints."""

from app.schemas.base import CamelCaseModel


class ProductCreateRequest(CamelCaseModel):
    """Payload for creating a product (PRD.md §7)."""

    description: str
    price: float | None = None
    margin: float | None = None
    features: str | None = None
    benefits: str | None = None
    url: str | None = None


class ProductResponse(CamelCaseModel):
    """Public-facing representation of a Product."""

    id: str
    description: str
    price: float | None
    margin: float | None
    features: str | None
    benefits: str | None
    url: str | None
