"""Schemas for the results dashboard (PRD.md build step 9)."""

from datetime import datetime

from app.schemas.base import CamelCaseModel


class MetricResponse(CamelCaseModel):
    """Public-facing representation of a stored Metric snapshot.

    Every field from reach onward is the "Phase B" extended metric set
    (PRD.md §5 step 10, confirmed 2026-09-01) — None means unavailable/
    not applicable, never zero (see app/services/meta.py's
    fetch_campaign_insights for exactly when each is populated).
    """

    id: str
    campaign_id: str
    impressions: int
    clicks: int
    spend: float
    conversions: int
    reach: int | None
    cpm: float | None
    ctr: float | None
    cpc: float | None
    landing_page_views: int | None
    add_to_cart: int | None
    add_to_cart_rate: float | None
    conversion_rate: float | None
    cac: float | None
    purchase_value: float | None
    roas: float | None
    fetched_at: datetime
