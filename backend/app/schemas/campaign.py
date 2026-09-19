"""Schemas for campaign creation endpoints."""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel

# Maps directly to Meta's own campaign objectives at publish time (PRD.md §7).
Objective = Literal["SALES", "LEADS", "TRAFFIC", "MESSAGES", "AWARENESS"]

# Display labels for GET /options (app/api/options.py) — previously
# hand-copied on the frontend (CampaignsSection.tsx's OBJECTIVE_LABELS,
# confirmed 2026-09-08 to move to the fetch-from-backend pattern used for
# Business.industry).
OBJECTIVE_LABELS: dict[Objective, str] = {
    "SALES": "Sales",
    "LEADS": "Leads",
    "TRAFFIC": "Traffic",
    "MESSAGES": "Messages",
    "AWARENESS": "Awareness",
}

# Campaign.status (schema.prisma) is a plain String, not a Prisma enum
# (same SQLite/Postgres-parity reasoning as Business.industry). Every
# value is backend-assigned (never user input), so nothing here needs
# Business.industry's "must tolerate an unrecognized legacy value"
# treatment — but that also means this Literal must stay exhaustive
# against every `data={"status": ...}` write in the codebase (confirmed
# 2026-09-09 after READY — written by campaign_readiness.py's
# advance_to_ready_if_complete, informational only per that module's
# docstring — turned up missing here and in CAMPAIGN_STATUS_LABELS,
# which would have 500'd CampaignResponse for any READY campaign once
# status was typed as this Literal instead of plain str).
CampaignStatus = Literal[
    "DRAFT",
    "READY",
    "STRATEGY_GENERATED",
    "ADS_GENERATED",
    "PENDING_APPROVAL",
    "APPROVED",
    "LIVE",
    "PAUSED",
    "FAILED",
]

# Previously hand-copied on the frontend (CampaignsSection.tsx's
# STATUS_LABELS, confirmed 2026-09-08 to move to the fetch-from-backend
# pattern used for Business.industry).
CAMPAIGN_STATUS_LABELS: dict[CampaignStatus, str] = {
    "DRAFT": "Draft",
    "READY": "Ready",
    "STRATEGY_GENERATED": "Strategy generated",
    "ADS_GENERATED": "Ads generated",
    "PENDING_APPROVAL": "Pending approval",
    "APPROVED": "Approved",
    "LIVE": "Live",
    "PAUSED": "Paused",
    "FAILED": "Failed",
}


class CampaignCreateRequest(CamelCaseModel):
    """Payload for creating a campaign (PRD.md §7).

    event_venue_key optionally targets the campaign at a curated jewelry
    trade show venue (PRD.md build step 11, app/services/event_venues.py)
    instead of the default broad US targeting. start_date/end_date given
    here are only meaningful alongside it — when omitted with an
    event_venue_key set, the backend defaults them from the venue's
    typical window (see app/api/campaign.py's create_campaign); left
    null otherwise. A campaign with no event venue still gets a real
    end_date, just computed later at publish time from its strategy's
    duration_days (app/services/publish.py's publish_campaign_to_meta),
    not something the user sets at creation.
    """

    objective: Objective
    name: str | None = None
    product_id: str | None = None
    audience_id: str | None = None
    event_venue_key: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None


class CampaignUpdateRequest(CamelCaseModel):
    """Payload for PATCH .../campaigns/{id}.

    Attaches a product and/or audience to an existing campaign — the
    manual counterpart to auto-attach (app/services/campaign_readiness.py)
    for when a business has more than one to choose from. Only provided
    fields change; omitted ones are left as they are, never cleared.
    """

    product_id: str | None = None
    audience_id: str | None = None


class PublishCampaignRequest(CamelCaseModel):
    """Optional payload for publish (PRD.md build step 8).

    paused defaults to False here (an omitted/empty body still publishes
    live, same as before this field existed) — the frontend's own
    "Publish paused" checkbox defaults to checked, but that's a UI
    default, not this API's; every existing direct caller (scripts,
    tests) that posts no body is unaffected.
    """

    paused: bool = False


class CampaignResponse(CamelCaseModel):
    """Public-facing representation of a Campaign."""

    id: str
    name: str | None
    objective: str
    status: CampaignStatus
    product_id: str | None
    audience_id: str | None
    meta_campaign_id: str | None
    event_venue_key: str | None
    start_date: datetime | None
    end_date: datetime | None
    paused_reason: str | None
    daily_spend_flag: str | None
    # Computed at read time (app/api/campaign.py's _to_response), never
    # stored: true when a product is attached but lacks a destination URL
    # that this campaign's SALES/TRAFFIC objective requires. Swapping a
    # campaign onto a URL-less product (app/api/campaign.py's
    # update_campaign) is never blocked outright — this field is how the
    # frontend surfaces the warning instead, since the swap itself always
    # succeeds.
    needs_destination_url: bool
