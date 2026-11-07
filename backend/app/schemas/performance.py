"""Response shapes for the business-level Advertising Performance dashboard.

Every figure is for one period (the last N days, or all time). None always means
"Meta has not reported this" or "cannot be worked out reliably", never zero.
Percent fields are percentages (3.8 means 3.8%).
"""

from datetime import date, datetime
from typing import Literal

from app.schemas.base import CamelCaseModel

SyncStatus = Literal["not_connected", "waiting", "ok", "stale"]
FunnelStageKey = Literal[
    "landing_page_views", "add_to_cart", "initiated_checkout", "purchases", "revenue"
]


class PeriodMetrics(CamelCaseModel):
    """One period's raw numbers and the ratios worked out from them."""

    spend: float | None
    impressions: int | None
    clicks: int | None
    link_clicks: int | None
    landing_page_views: int | None
    add_to_cart: int | None
    initiated_checkout: int | None
    purchases: int | None
    purchase_value: float | None
    cpm: float | None
    ctr: float | None
    cpc: float | None
    cost_per_add_to_cart: float | None
    add_to_cart_rate: float | None
    cost_per_sale: float | None
    roas: float | None


class FunnelStage(CamelCaseModel):
    """One step of the click-to-customer funnel.

    ``rate_from_previous`` is the share of the previous step that reached this
    one; None when either count is unavailable or the previous count is zero.
    """

    key: FunnelStageKey
    count: float | None
    rate_from_previous: float | None


class DailyPoint(CamelCaseModel):
    """One UTC day of the trend chart; every value None on a day with no data."""

    date: date
    spend: float | None
    purchases: int | None
    revenue: float | None
    cost_per_sale: float | None
    roas: float | None
    add_to_cart: int | None
    link_clicks: int | None


class CampaignPerformance(CamelCaseModel):
    """One campaign's row in the comparison table, for the selected period."""

    campaign_id: str
    name: str | None
    status: str
    spend: float | None
    impressions: int | None
    link_clicks: int | None
    add_to_cart: int | None
    purchases: int | None
    cost_per_sale: float | None
    revenue: float | None
    roas: float | None


class SyncInfo(CamelCaseModel):
    """When Meta's numbers were last stored, and whether that is recent enough."""

    status: SyncStatus
    last_synced_at: datetime | None
    interval_minutes: int


class PerformanceResponse(CamelCaseModel):
    """Everything the Advertising Performance dashboard shows."""

    # The window length in days; None means all time.
    days: int | None
    start: datetime | None
    end: datetime
    current: PeriodMetrics | None
    # The same-length period just before; None unless stored history covers it.
    previous: PeriodMetrics | None
    # Unique-people numbers: lifetime, one campaign only (see the service).
    reach: int | None
    frequency: float | None
    funnel: list[FunnelStage]
    daily: list[DailyPoint]
    campaigns: list[CampaignPerformance]
    sync: SyncInfo
