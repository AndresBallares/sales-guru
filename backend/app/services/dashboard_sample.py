"""Sample dashboard data for local development only.

Reachable solely through `?sample=true` on the dashboard endpoints, which
404 unless Settings.dashboard_sample_enabled (env DASHBOARD_SAMPLE_DATA) or
fake_meta_enabled (FAKE_META) is on. Neither can be on in production
(Settings refuses to construct with either when ENVIRONMENT=production), and
nothing here is ever written to the database: it
is built in memory and passed through the same assembler as real numbers, so
local development sees exactly what real data would look like.
"""

from datetime import UTC, datetime, timedelta
from typing import NamedTuple

from app.services.dashboard import (
    AdInfo,
    RecommendationInfo,
    Snapshot,
)

SAMPLE_PIXEL_WARNING = "Purchase event may not be firing"
SAMPLE_SATURATION_WARNING = (
    "Audience saturation: reach has plateaued while frequency climbs. In the last "
    "7 days you spent $420 ($400 the week before) and reached 2,100 new people, "
    "5.0 per dollar against 14.0 per dollar in the first 14 days. Frequency was "
    "3.9, and only 18% of impressions went to people reached for the first time."
)


class _AdFinal(NamedTuple):
    id: str
    name: str
    status: str
    impressions: int
    spend: float
    link_clicks: int
    landing_page_views: int
    add_to_cart: int
    initiated_checkout: int
    purchases: int
    purchase_value: float


# Three ads whose totals add up to the "3 sales, $420" example: thin on
# purchases (so the confidence flags show), enough add-to-carts on two ads but
# not the third (so there is no clear leader yet), and one proposed pause.
_ADS = (
    _AdFinal(
        "sample-ad-1",
        "Sample ad: Craftsmanship",
        "LIVE",
        4800,
        52.0,
        69,
        58,
        7,
        3,
        2,
        280.0,
    ),
    _AdFinal(
        "sample-ad-2",
        "Sample ad: Gift ready",
        "LIVE",
        4300,
        48.0,
        51,
        44,
        5,
        2,
        1,
        140.0,
    ),
    _AdFinal(
        "sample-ad-3",
        "Sample ad: Everyday luxury",
        "LIVE",
        3300,
        42.5,
        28,
        24,
        2,
        1,
        0,
        0.0,
    ),
)


class SampleCampaign(NamedTuple):
    """In-memory stand-in for one campaign's stored rows."""

    snapshots: list[Snapshot]
    ads: list[AdInfo]
    recommendations: list[RecommendationInfo]
    pixel_warning: str
    saturation_warning: str


def _scaled(
    final: _AdFinal, fraction: float, fetched_at: datetime, *, ad_level: bool
) -> Snapshot:
    return Snapshot(
        ad_set_id="sample-ad-set" if ad_level else None,
        ad_id=final.id if ad_level else None,
        impressions=int(final.impressions * fraction),
        spend=round(final.spend * fraction, 2),
        link_clicks=int(final.link_clicks * fraction),
        landing_page_views=int(final.landing_page_views * fraction),
        add_to_cart=int(final.add_to_cart * fraction),
        initiated_checkout=int(final.initiated_checkout * fraction),
        purchases=int(final.purchases * fraction),
        purchase_value=round(final.purchase_value * fraction, 2),
        fetched_at=fetched_at,
    )


def sample_campaign(now: datetime | None = None) -> SampleCampaign:
    """A 12-hour history of lifetime snapshots plus per-ad rows and a proposal."""
    now = now or datetime.now(UTC)
    campaign_rows: list[Snapshot] = []
    for step, fraction in enumerate((0.2, 0.4, 0.6, 0.8, 1.0)):
        at = now - timedelta(hours=3 * (4 - step))
        scaled = [_scaled(a, fraction, at, ad_level=False) for a in _ADS]
        campaign_rows.append(
            Snapshot(
                ad_set_id=None,
                ad_id=None,
                impressions=sum(s.impressions for s in scaled),
                spend=round(sum(s.spend for s in scaled), 2),
                link_clicks=sum(s.link_clicks or 0 for s in scaled),
                landing_page_views=sum(s.landing_page_views or 0 for s in scaled),
                add_to_cart=sum(s.add_to_cart or 0 for s in scaled),
                initiated_checkout=sum(s.initiated_checkout or 0 for s in scaled),
                purchases=sum(s.purchases or 0 for s in scaled),
                purchase_value=round(sum(s.purchase_value or 0 for s in scaled), 2),
                fetched_at=at,
            )
        )
    ad_rows = [
        _scaled(a, fraction, now - timedelta(hours=hours), ad_level=True)
        for a in _ADS
        for fraction, hours in ((0.5, 6), (1.0, 0))
    ]
    return SampleCampaign(
        snapshots=campaign_rows + ad_rows,
        ads=[AdInfo(a.id, a.name, a.status) for a in _ADS],
        recommendations=[
            RecommendationInfo(
                id="sample-recommendation-1",
                action_type="PAUSE_AD",
                status="PENDING",
                target_ad_id="sample-ad-3",
                reasoning=(
                    "Sample proposal: this ad has spent $42.50 with 2 add-to-carts, "
                    "well above the cost per add-to-cart of the other ads."
                ),
                risk="LOW",
                confidence=0.7,
                current_budget=None,
                suggested_budget=None,
                suggested_bid=None,
                created_at=now - timedelta(hours=1),
            )
        ],
        pixel_warning=SAMPLE_PIXEL_WARNING,
        saturation_warning=SAMPLE_SATURATION_WARNING,
    )


def sample_business(
    now: datetime | None = None,
) -> list[tuple[str, str | None, str, list[Snapshot]]]:
    """Three sample campaigns for the business stat strip."""
    moment = now or datetime.now(UTC)
    first = [s for s in sample_campaign(moment).snapshots if s.ad_id is None]

    def scaled(factor: float, hours: float) -> list[Snapshot]:
        return [
            s._replace(
                impressions=int(s.impressions * factor),
                spend=round(s.spend * factor, 2),
                purchases=int((s.purchases or 0) * factor),
                purchase_value=round((s.purchase_value or 0) * factor, 2),
                fetched_at=moment - timedelta(hours=hours),
            )
            for s in first
        ]

    return [
        ("sample-campaign-1", "Sample: Bestsellers (creative test)", "LIVE", first),
        ("sample-campaign-2", "Sample: Rings", "LIVE", scaled(2.0, 0)),
        ("sample-campaign-3", "Sample: Spring launch", "PAUSED", scaled(1.0, 24)),
    ]
