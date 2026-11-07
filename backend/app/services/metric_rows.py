"""The two row shapes the dashboard and the ad comparison share.

Kept apart from app/services/dashboard.py so app/services/ad_window.py can build
them without importing the dashboard (which imports it).
"""

from datetime import datetime
from typing import NamedTuple


class Snapshot(NamedTuple):
    """One stored Metric row, reduced to what the dashboard reads."""

    ad_set_id: str | None
    ad_id: str | None
    impressions: int
    spend: float
    link_clicks: int | None
    landing_page_views: int | None
    add_to_cart: int | None
    initiated_checkout: int | None
    purchases: int | None
    purchase_value: float | None
    fetched_at: datetime
    # Added for the performance dashboard; defaulted so older callers are unchanged.
    # clicks counts every tap, link_clicks only clicks through to the destination.
    clicks: int | None = None
    reach: int | None = None
    frequency: float | None = None


class Totals(NamedTuple):
    """Lifetime numbers for a campaign (or one ad) from its latest snapshot(s)."""

    impressions: int
    spend: float
    link_clicks: int | None
    landing_page_views: int | None
    add_to_cart: int | None
    initiated_checkout: int | None
    purchases: int | None
    purchase_value: float | None
    as_of: datetime
    clicks: int | None = None
