"""Schemas for campaign creation endpoints."""

from typing import Literal

from app.schemas.base import CamelCaseModel

# Maps directly to Meta's own campaign objectives at publish time (PRD.md §7).
Objective = Literal["SALES", "LEADS", "TRAFFIC", "MESSAGES", "AWARENESS"]


class CampaignCreateRequest(CamelCaseModel):
    """Payload for creating a campaign (PRD.md §7)."""

    objective: Objective
    name: str | None = None
    product_id: str | None = None
    audience_id: str | None = None


class CampaignResponse(CamelCaseModel):
    """Public-facing representation of a Campaign."""

    id: str
    name: str | None
    objective: str
    status: str
    product_id: str | None
    audience_id: str | None
    meta_campaign_id: str | None
