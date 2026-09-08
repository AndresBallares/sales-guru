"""Schemas for campaign creation endpoints."""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel

# Maps directly to Meta's own campaign objectives at publish time (PRD.md §7).
Objective = Literal["SALES", "LEADS", "TRAFFIC", "MESSAGES", "AWARENESS"]


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


class CampaignResponse(CamelCaseModel):
    """Public-facing representation of a Campaign."""

    id: str
    name: str | None
    objective: str
    status: str
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
