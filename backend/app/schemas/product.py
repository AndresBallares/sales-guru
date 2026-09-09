"""Schemas for product onboarding endpoints."""

from pydantic import Field, field_validator

from app.schemas.base import CamelCaseModel
from app.services.url_validation import validate_destination_url

# This text is pasted into the Strategist/Creative Agent prompts verbatim
# (app/services/strategist.py, app/services/creative.py, quarantined via
# app/services/prompt_safety.py) — capped so a pasted-in product page
# can't balloon the prompt, same reasoning as Business.description's cap.
_MAX_DESCRIPTION_LENGTH = 1000


class ProductCreateRequest(CamelCaseModel):
    """Payload for creating a product (PRD.md §7).

    url's format is validated (and normalized — a missing scheme, stray
    whitespace) here; whether it's *required* at all depends on the
    business's pending campaign objective (PRD.md §7 — SALES/TRAFFIC need
    one, the rest don't) and is checked in app/api/product.py, since that
    needs a database lookup a schema validator can't do.
    """

    description: str = Field(max_length=_MAX_DESCRIPTION_LENGTH)
    price: float | None = None
    margin: float | None = None
    features: str | None = None
    benefits: str | None = None
    url: str | None = None
    # The campaign this product is being created for, if any — scopes
    # auto-attach (app/services/campaign_readiness.py's auto_attach_product)
    # to just that campaign instead of guessing across the whole business.
    campaign_id: str | None = None

    @field_validator("url")
    @classmethod
    def _validate_url(cls, value: str | None) -> str | None:
        return validate_destination_url(value) if value is not None else None


class ProductUpdateRequest(CamelCaseModel):
    """Payload for PATCH .../products/{id} — a partial update.

    Only fields explicitly provided change; an omitted field is left as
    it is (app/api/product.py's update_product uses model_dump's
    exclude_unset, not a "None means unchanged" convention, since url
    must stay nullable — a client explicitly clearing it needs to be
    distinguishable from simply not mentioning it).

    Products are reusable across campaigns (CLAUDE.md): this endpoint is
    for correcting/updating the same item being sold, not repurposing a
    product record to describe a different item — swap the campaign's
    product for that instead (app/api/campaign.py's update_campaign).
    """

    description: str | None = Field(default=None, max_length=_MAX_DESCRIPTION_LENGTH)
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
    # The product's primary (position 0 — ProductImage.position) uploaded
    # photo, if any — lets a campaign list show a thumbnail without a
    # separate per-product images fetch (app/components/CampaignsSection).
    primary_image_url: str | None = None


class CheckUrlResponse(CamelCaseModel):
    """Public-facing representation of a ReachabilityResult (Phase 2 scaffold)."""

    reachable: bool
    reason: str
    status_code: int | None
    final_url: str | None
