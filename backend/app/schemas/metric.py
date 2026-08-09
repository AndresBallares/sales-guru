"""Schemas for the results dashboard (PRD.md build step 9)."""

from datetime import datetime

from app.schemas.base import CamelCaseModel


class MetricResponse(CamelCaseModel):
    """Public-facing representation of a stored Metric snapshot."""

    id: str
    campaign_id: str
    impressions: int
    clicks: int
    spend: float
    conversions: int
    fetched_at: datetime
