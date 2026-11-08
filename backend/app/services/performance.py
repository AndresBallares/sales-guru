"""Advertising Performance math: lifetime snapshots in, one period's numbers out.

Pure functions over plain rows (no database, no Meta), like app/services/dashboard.py,
whose snapshot helpers this reuses. app/api/performance.py loads the rows.

**A period is a difference of two lifetime snapshots.** Every Metric row holds
Meta's lifetime-to-date figures, so the last N days are the latest snapshot minus
the latest one at or before the start of the window (a campaign with nothing
before the window started inside it, so its baseline is zero). Honest-gap rules:

- A figure Meta never reported stays None; it is never turned into zero.
- A figure that went down between two reads (Meta revised it) is None.
- A day with no snapshot, and the day after it (which cannot be split from the
  gap), are None on the trend chart rather than guessed.
- A ratio with a missing or zero denominator is None.
- Days are UTC days.
"""

from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import NamedTuple

from app.schemas.performance import (
    CampaignPerformance,
    DailyPoint,
    FunnelStage,
    FunnelStageKey,
    PerformanceResponse,
    PeriodMetrics,
    SyncFailure,
    SyncFailureSource,
    SyncInfo,
    SyncStatus,
)
from app.services.dashboard import combine, latest_per_group
from app.services.metric_rows import Snapshot, Totals
from app.services.sync_health import friendly_reason, is_token_problem

SYNC_INTERVAL_MINUTES = 15
# Two missed cycles plus a little slack before the dashboard calls the data stale.
STALE_AFTER = timedelta(minutes=2 * SYNC_INTERVAL_MINUTES + 5)
MAX_CHART_DAYS = 90

_FIELDS = (
    "impressions",
    "spend",
    "clicks",
    "link_clicks",
    "landing_page_views",
    "add_to_cart",
    "initiated_checkout",
    "purchases",
    "purchase_value",
)
_EPSILON = 1e-9


class FailureRecord(NamedTuple):
    """A business's stored failed sync (MetaConnection.syncFailure*)."""

    source: SyncFailureSource
    failed_at: datetime
    code: int | None
    reason: str


CampaignInput = tuple[str, str | None, str, Sequence[Snapshot]]
# One period's raw numbers by field name; None = unavailable.
Delta = dict[str, float | None]


def _upto(snapshots: Iterable[Snapshot], moment: datetime) -> Totals | None:
    """The campaign's lifetime totals as stored at (or before) a moment."""
    return combine(
        latest_per_group(
            s for s in snapshots if s.ad_id is None and s.fetched_at <= moment
        )
    )


def _difference(end: Totals, start: Totals | None) -> Delta:
    """Field by field, end minus start; None where the difference is not knowable."""
    out: Delta = {}
    for name in _FIELDS:
        later = getattr(end, name)
        if later is None:
            out[name] = None
        elif start is None:
            out[name] = later
        else:
            earlier = getattr(start, name)
            if earlier is None:
                # A baseline with delivery but no figure hides how much came before.
                out[name] = later if start.impressions == 0 else None
            else:
                gap = later - earlier
                out[name] = None if gap < -_EPSILON else max(gap, 0.0)
    return out


def _sum_deltas(deltas: Sequence[Delta]) -> Delta | None:
    """Add campaigns' deltas; a field is None if a delivering campaign lacks it."""
    if not deltas:
        return None
    out: Delta = {}
    for name in _FIELDS:
        total = 0.0
        known = False
        missing = False
        for delta in deltas:
            value = delta[name]
            if value is None:
                impressions = delta["impressions"]
                if impressions is None or impressions > 0:
                    missing = True
                continue
            total += value
            known = True
        out[name] = None if missing or not known else total
    return out


def _as_int(value: float | None) -> int | None:
    return None if value is None else round(value)


def _div(
    numerator: float | None, denominator: float | None, scale: float = 1.0
) -> float | None:
    if numerator is None or not denominator:
        return None
    return numerator * scale / denominator


def _metrics(delta: Delta) -> PeriodMetrics:
    spend = delta["spend"]
    impressions = delta["impressions"]
    clicks = delta["clicks"]
    purchases = delta["purchases"]
    add_to_cart = delta["add_to_cart"]
    return PeriodMetrics(
        spend=spend,
        impressions=_as_int(impressions),
        clicks=_as_int(clicks),
        link_clicks=_as_int(delta["link_clicks"]),
        landing_page_views=_as_int(delta["landing_page_views"]),
        add_to_cart=_as_int(add_to_cart),
        initiated_checkout=_as_int(delta["initiated_checkout"]),
        purchases=_as_int(purchases),
        purchase_value=delta["purchase_value"],
        cpm=_div(spend, impressions, 1000),
        ctr=_div(clicks, impressions, 100),
        cpc=_div(spend, clicks),
        cost_per_add_to_cart=_div(spend, add_to_cart),
        add_to_cart_rate=_div(add_to_cart, delta["landing_page_views"], 100),
        cost_per_sale=_div(spend, purchases),
        roas=_div(delta["purchase_value"], spend),
    )


def _campaign_delta(
    snapshots: Sequence[Snapshot], start: datetime | None, end: datetime
) -> Delta | None:
    """One campaign's numbers between two moments; None if it has no data by `end`."""
    latest = _upto(snapshots, end)
    if latest is None:
        return None
    baseline = None if start is None else _upto(snapshots, start)
    return _difference(latest, baseline)


def _period(
    campaigns: Sequence[CampaignInput], start: datetime | None, end: datetime
) -> Delta | None:
    deltas = [
        d
        for _, _, _, snaps in campaigns
        if (d := _campaign_delta(snaps, start, end)) is not None
    ]
    return _sum_deltas(deltas)


def _funnel(current: PeriodMetrics) -> list[FunnelStage]:
    steps: list[tuple[FunnelStageKey, float | None]] = [
        ("landing_page_views", current.landing_page_views),
        ("add_to_cart", current.add_to_cart),
        ("initiated_checkout", current.initiated_checkout),
        ("purchases", current.purchases),
    ]
    stages: list[FunnelStage] = []
    previous: float | None = None
    for key, count in steps:
        rate = None
        if previous and count is not None:
            rate = count * 100 / previous
        stages.append(FunnelStage(key=key, count=count, rate_from_previous=rate))
        previous = count
    stages.append(
        FunnelStage(
            key="revenue", count=current.purchase_value, rate_from_previous=None
        )
    )
    return stages


def _midnight(day: date) -> datetime:
    return datetime(day.year, day.month, day.day, tzinfo=UTC)


def _daily(
    campaigns: Sequence[CampaignInput], days: int | None, now: datetime
) -> list[DailyPoint]:
    all_times = [s.fetched_at for _, _, _, snaps in campaigns for s in snaps]
    if not all_times:
        return []
    today = now.date()
    if days is None:
        span = (today - min(all_times).date()).days + 1
        count = min(MAX_CHART_DAYS, span)
    else:
        count = min(days, MAX_CHART_DAYS)
    points: list[DailyPoint] = []
    for offset in range(count - 1, -1, -1):
        day = today - timedelta(days=offset)
        day_start = _midnight(day)
        day_end = min(day_start + timedelta(days=1) - timedelta(microseconds=1), now)
        points.append(_daily_point(campaigns, day, day_start, day_end))
    return points


def _daily_point(
    campaigns: Sequence[CampaignInput],
    day: date,
    day_start: datetime,
    day_end: datetime,
) -> DailyPoint:
    before = day_start - timedelta(microseconds=1)
    previous_day_start = day_start - timedelta(days=1)
    deltas: list[Delta] = []
    for _, _, _, snaps in campaigns:
        if not any(
            day_start <= s.fetched_at <= day_end for s in snaps if s.ad_id is None
        ):
            continue
        latest = _upto(snaps, day_end)
        assert latest is not None  # a snapshot exists inside the day
        baseline = _upto(snaps, before)
        if baseline is not None and baseline.as_of < previous_day_start:
            return _empty_day(day)  # the day after a gap cannot be split from it
        deltas.append(_difference(latest, baseline))
    total = _sum_deltas(deltas)
    if total is None:
        return _empty_day(day)
    m = _metrics(total)
    return DailyPoint(
        date=day,
        spend=m.spend,
        purchases=m.purchases,
        revenue=m.purchase_value,
        cost_per_sale=m.cost_per_sale,
        roas=m.roas,
        add_to_cart=m.add_to_cart,
        link_clicks=m.link_clicks,
    )


def _empty_day(day: date) -> DailyPoint:
    return DailyPoint(
        date=day,
        spend=None,
        purchases=None,
        revenue=None,
        cost_per_sale=None,
        roas=None,
        add_to_cart=None,
        link_clicks=None,
    )


def _campaign_rows(
    campaigns: Sequence[CampaignInput], start: datetime | None, end: datetime
) -> list[CampaignPerformance]:
    rows: list[CampaignPerformance] = []
    for campaign_id, name, status, snaps in campaigns:
        delta = _campaign_delta(snaps, start, end)
        if delta is None:
            continue
        m = _metrics(delta)
        rows.append(
            CampaignPerformance(
                campaign_id=campaign_id,
                name=name,
                status=status,
                spend=m.spend,
                impressions=m.impressions,
                link_clicks=m.link_clicks,
                add_to_cart=m.add_to_cart,
                purchases=m.purchases,
                cost_per_sale=m.cost_per_sale,
                revenue=m.purchase_value,
                roas=m.roas,
            )
        )
    rows.sort(key=lambda r: -(r.spend or 0.0))
    return rows


def _sync(
    campaigns: Sequence[CampaignInput],
    now: datetime,
    *,
    meta_connected: bool,
    failure: FailureRecord | None,
) -> SyncInfo:
    times = [s.fetched_at for _, _, _, snaps in campaigns for s in snaps]
    last = max(times) if times else None
    status: SyncStatus
    if not meta_connected:
        status = "not_connected"
    elif (
        failure is not None
        and failure.source == "collection"
        and (last is None or failure.failed_at > last)
    ):
        status = "failed"
    elif last is None:
        status = "waiting"
    elif now - last > STALE_AFTER and any(c[2] == "LIVE" for c in campaigns):
        status = "stale"
    else:
        status = "ok"
    return SyncInfo(
        status=status,
        last_synced_at=last,
        interval_minutes=SYNC_INTERVAL_MINUTES,
        failure=None
        if failure is None
        else SyncFailure(
            source=failure.source,
            failed_at=failure.failed_at,
            code=failure.code,
            reason=friendly_reason(failure.code, failure.reason),
            needs_reconnect=is_token_problem(failure.code),
        ),
    )


def _reach(
    campaigns: Sequence[CampaignInput], days: int | None
) -> tuple[int | None, float | None]:
    """Unique-people numbers, reported only where they are meaningful.

    People counted in one campaign overlap with another's, and a window's unique
    people cannot be got by subtracting lifetime counts, so this is lifetime,
    for a business with exactly one reporting campaign.
    """
    reporting = [snaps for _, _, _, snaps in campaigns if snaps]
    if days is not None or len(reporting) != 1:
        return None, None
    rows = [s for s in reporting[0] if s.ad_id is None and s.ad_set_id is None]
    if not rows:
        return None, None
    latest = max(rows, key=lambda s: s.fetched_at)
    return latest.reach, latest.frequency


def build_performance(
    campaigns: Sequence[CampaignInput],
    *,
    days: int | None,
    now: datetime,
    meta_connected: bool,
    failure: FailureRecord | None = None,
) -> PerformanceResponse:
    """The whole Advertising Performance payload for a set of campaigns.

    Args:
        campaigns: (id, name, status, that campaign's snapshots) per campaign.
        days: Window length in days; None for all time.
        now: The moment the window ends (injected so tests are exact).
        meta_connected: Whether the business has a Meta connection.
        failure: The business's stored failed sync, if any.
    """
    start = None if days is None else now - timedelta(days=days)
    current_delta = _period(campaigns, start, now)
    current = None if current_delta is None else _metrics(current_delta)

    previous: PeriodMetrics | None = None
    if start is not None and days is not None:
        previous_start = start - timedelta(days=days)
        times = [s.fetched_at for _, _, _, snaps in campaigns for s in snaps]
        if times and min(times) <= previous_start:
            previous_delta = _period(campaigns, previous_start, start)
            previous = None if previous_delta is None else _metrics(previous_delta)

    reach, frequency = _reach(campaigns, days)
    return PerformanceResponse(
        days=days,
        start=start,
        end=now,
        current=current,
        previous=previous,
        reach=reach,
        frequency=frequency,
        funnel=[] if current is None else _funnel(current),
        daily=_daily(campaigns, days, now),
        campaigns=_campaign_rows(campaigns, start, now),
        sync=_sync(campaigns, now, meta_connected=meta_connected, failure=failure),
    )
