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
    instead of the default broad US targeting. start_date/end_date are
    only meaningful alongside it — when omitted with an event_venue_key
    set, the backend defaults them from the venue's typical window (see
    app/api/campaign.py's create_campaign); left null otherwise, matching
    today's "runs indefinitely on its daily budget" behavior.
    """

    objective: Objective
    name: str | None = None
    product_id: str | None = None
    audience_id: str | None = None
    event_venue_key: str | None = None
    start_date: datetime | None = None
    end_date: datetime | None = None


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
