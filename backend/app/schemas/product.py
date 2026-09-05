"""Schemas for product onboarding endpoints."""

from pydantic import field_validator

from app.schemas.base import CamelCaseModel
from app.services.url_validation import validate_destination_url


class ProductCreateRequest(CamelCaseModel):
    """Payload for creating a product (PRD.md §7).

    url's format is validated (and normalized — a missing scheme, stray
    whitespace) here; whether it's *required* at all depends on the
    business's pending campaign objective (PRD.md §7 — SALES/TRAFFIC need
    one, the rest don't) and is checked in app/api/product.py, since that
    needs a database lookup a schema validator can't do.
    """

    description: str
    price: float | None = None
    margin: float | None = None
    features: str | None = None
    benefits: str | None = None
    url: str | None = None

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str | None) -> str | None:
        return validate_destination_url(value) if value is not None else None


class ProductResponse(CamelCaseModel):
    """Public-facing representation of a Product."""

    id: str
    description: str
    price: float | None
    margin: float | None
    features: str | None
    benefits: str | None
    url: str | None


class CheckUrlResponse(CamelCaseModel):
    """Public-facing representation of a ReachabilityResult (Phase 2 scaffold)."""

    reachable: bool
    reason: str
    status_code: int | None
    final_url: str | None
