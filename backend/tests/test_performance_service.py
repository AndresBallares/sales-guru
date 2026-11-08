"""Tests for the Advertising Performance math (app/services/performance.py).

Every Metric row is a lifetime-to-date snapshot, so a period's numbers are the
latest snapshot minus the one at the period's start. These tests pin that rule
and the honest-gap rules around it: a missing number stays missing, a day with
no snapshot is a gap, and nothing is divided by zero.
"""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta

from app.schemas.performance import PerformanceResponse, SyncFailureSource
from app.services import performance as perf
from app.services.metric_rows import Snapshot

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def snap(
    *,
    days_ago: float = 0.0,
    spend: float = 10.0,
    impressions: int = 1000,
    clicks: int | None = 0,
    link_clicks: int | None = 0,
    landing_page_views: int | None = 0,
    add_to_cart: int | None = 0,
    initiated_checkout: int | None = 0,
    purchases: int | None = 0,
    purchase_value: float | None = 0.0,
    reach: int | None = None,
    frequency: float | None = None,
    ad_set_id: str | None = None,
) -> Snapshot:
    """A campaign-level lifetime snapshot taken `days_ago` before NOW."""
    return Snapshot(
        ad_set_id=ad_set_id,
        ad_id=None,
        impressions=impressions,
        spend=spend,
        link_clicks=link_clicks,
        landing_page_views=landing_page_views,
        add_to_cart=add_to_cart,
        initiated_checkout=initiated_checkout,
        purchases=purchases,
        purchase_value=purchase_value,
        fetched_at=NOW - timedelta(days=days_ago),
        clicks=clicks,
        reach=reach,
        frequency=frequency,
    )


def build(
    campaigns: Sequence[tuple[str, str | None, str, Sequence[Snapshot]]],
    *,
    days: int | None = 7,
    connected: bool = True,
    failure: perf.FailureRecord | None = None,
) -> PerformanceResponse:
    return perf.build_performance(
        campaigns, days=days, now=NOW, meta_connected=connected, failure=failure
    )


def one(
    snapshots: Sequence[Snapshot], *, status: str = "LIVE", days: int | None = 7
) -> PerformanceResponse:
    return build([("c1", "Spring", status, snapshots)], days=days)


# ---- period totals ---------------------------------------------------------


def test_a_periods_numbers_are_the_latest_snapshot_minus_the_one_at_its_start() -> None:
    result = one(
        [
            snap(days_ago=10, spend=10, purchases=1, purchase_value=50),
            snap(days_ago=3, spend=40, purchases=2, purchase_value=120),
            snap(days_ago=0, spend=100, purchases=5, purchase_value=470),
        ]
    )

    assert result.current is not None
    assert result.current.spend == 90
    assert result.current.purchases == 4
    assert result.current.purchase_value == 420


def test_a_campaign_that_started_inside_the_period_counts_from_zero() -> None:
    result = one(
        [
            snap(days_ago=3, spend=40, purchases=2),
            snap(days_ago=0, spend=100, purchases=5),
        ]
    )

    assert result.current is not None
    assert result.current.spend == 100
    assert result.current.purchases == 5


def test_all_time_is_the_latest_lifetime_snapshot() -> None:
    result = one([snap(days_ago=40, spend=10), snap(days_ago=0, spend=100)], days=None)

    assert result.current is not None
    assert result.current.spend == 100
    assert result.start is None
    assert result.previous is None


def test_a_number_meta_never_reported_stays_unavailable_not_zero() -> None:
    result = one(
        [
            snap(days_ago=10, purchase_value=None, purchases=None),
            snap(days_ago=0, spend=100, purchase_value=None, purchases=None),
        ]
    )

    assert result.current is not None
    assert result.current.purchases is None
    assert result.current.purchase_value is None
    assert result.current.roas is None
    assert result.current.cost_per_sale is None


def test_a_number_that_went_backwards_is_unavailable_not_negative() -> None:
    # Meta revised a count down between two reads: the difference means nothing.
    result = one([snap(days_ago=10, purchases=5), snap(days_ago=0, purchases=3)])

    assert result.current is not None
    assert result.current.purchases is None


def test_a_business_with_no_snapshots_has_no_numbers() -> None:
    result = build([("c1", "Spring", "LIVE", [])])

    assert result.current is None
    assert result.funnel == [] or all(s.count is None for s in result.funnel)
    assert result.sync.status == "waiting"


def test_a_business_total_adds_up_each_campaign() -> None:
    result = build(
        [
            ("c1", "A", "LIVE", [snap(spend=60, purchases=3, purchase_value=300)]),
            ("c2", "B", "LIVE", [snap(spend=40, purchases=1, purchase_value=100)]),
        ],
        days=None,
    )

    assert result.current is not None
    assert result.current.spend == 100
    assert result.current.purchases == 4
    assert result.current.purchase_value == 400
    assert {c.campaign_id for c in result.campaigns} == {"c1", "c2"}


def test_two_ad_set_rows_of_one_campaign_are_added_not_double_counted() -> None:
    result = one(
        [
            snap(ad_set_id="a", spend=30, purchases=1),
            snap(ad_set_id="b", spend=20, purchases=2),
            snap(ad_set_id="a", spend=10, days_ago=1, purchases=0),
        ],
        days=None,
    )

    assert result.current is not None
    assert result.current.spend == 50
    assert result.current.purchases == 3


# ---- ratios ----------------------------------------------------------------


def test_every_ratio_is_worked_out_from_the_periods_counts() -> None:
    result = one(
        [
            snap(
                spend=100,
                impressions=10000,
                clicks=200,
                link_clicks=100,
                landing_page_views=80,
                add_to_cart=20,
                initiated_checkout=10,
                purchases=5,
                purchase_value=420,
            )
        ],
        days=None,
    )

    m = result.current
    assert m is not None
    assert m.cpm == 10  # $100 per 10,000 impressions
    assert m.ctr == 2.0  # 200 clicks / 10,000 impressions
    assert m.cpc == 0.5  # $100 / 200 clicks
    assert m.cost_per_add_to_cart == 5
    assert m.add_to_cart_rate == 25  # 20 / 80 landing page views
    assert m.cost_per_sale == 20
    assert m.roas == 4.2


def test_all_clicks_and_link_clicks_stay_separate() -> None:
    result = one([snap(clicks=200, link_clicks=100)], days=None)

    assert result.current is not None
    assert result.current.clicks == 200
    assert result.current.link_clicks == 100


def test_nothing_is_divided_by_zero() -> None:
    result = one(
        [snap(spend=0, impressions=0, clicks=0, add_to_cart=0, purchases=0)], days=None
    )

    m = result.current
    assert m is not None
    assert m.cpm is None
    assert m.ctr is None
    assert m.cpc is None
    assert m.cost_per_add_to_cart is None
    assert m.add_to_cart_rate is None
    assert m.cost_per_sale is None
    assert m.roas is None


# ---- funnel ----------------------------------------------------------------


def test_the_funnel_gives_each_steps_share_of_the_step_before() -> None:
    result = one(
        [
            snap(
                landing_page_views=950,
                add_to_cart=120,
                initiated_checkout=65,
                purchases=18,
                purchase_value=5400,
            )
        ],
        days=None,
    )

    steps = {s.key: s for s in result.funnel}
    assert [s.key for s in result.funnel] == [
        "landing_page_views",
        "add_to_cart",
        "initiated_checkout",
        "purchases",
        "revenue",
    ]
    assert steps["landing_page_views"].rate_from_previous is None
    assert round(steps["add_to_cart"].rate_from_previous or 0, 1) == 12.6
    assert round(steps["initiated_checkout"].rate_from_previous or 0, 1) == 54.2
    assert round(steps["purchases"].rate_from_previous or 0, 1) == 27.7
    assert steps["revenue"].count == 5400
    assert steps["revenue"].rate_from_previous is None


def test_a_missing_step_is_not_shown_as_zero_percent() -> None:
    result = one(
        [
            snap(
                landing_page_views=950,
                add_to_cart=120,
                initiated_checkout=None,
                purchases=18,
            )
        ],
        days=None,
    )

    steps = {s.key: s for s in result.funnel}
    assert steps["initiated_checkout"].count is None
    assert steps["initiated_checkout"].rate_from_previous is None
    # purchases follows a missing step, so there is nothing valid to divide by
    assert steps["purchases"].rate_from_previous is None


def test_a_zero_step_before_gives_no_rate() -> None:
    result = one([snap(landing_page_views=0, add_to_cart=0)], days=None)

    steps = {s.key: s for s in result.funnel}
    assert steps["add_to_cart"].rate_from_previous is None


# ---- previous period -------------------------------------------------------


def test_the_previous_period_appears_when_history_reaches_back_to_it() -> None:
    result = one(
        [
            snap(days_ago=20, spend=10, purchases=0),
            snap(days_ago=7, spend=50, purchases=2),
            snap(days_ago=0, spend=130, purchases=8),
        ]
    )

    assert result.current is not None
    assert result.previous is not None
    assert result.current.spend == 80
    assert result.previous.spend == 40
    assert result.previous.purchases == 2


def test_no_comparison_when_history_starts_inside_the_previous_period() -> None:
    result = one([snap(days_ago=10, spend=10), snap(days_ago=0, spend=100)])

    assert result.previous is None


# ---- reach and frequency ---------------------------------------------------


def test_reach_is_only_reported_for_all_time_with_a_single_campaign() -> None:
    rows = [snap(reach=18500, frequency=1.35)]

    single_all_time = one(rows, days=None)
    assert single_all_time.reach == 18500
    assert single_all_time.frequency == 1.35

    windowed = one(rows, days=7)
    assert windowed.reach is None
    assert windowed.frequency is None

    two_campaigns = build(
        [("c1", "A", "LIVE", rows), ("c2", "B", "LIVE", rows)], days=None
    )
    assert two_campaigns.reach is None
    assert two_campaigns.frequency is None


# ---- daily series ----------------------------------------------------------


def test_each_day_is_that_days_end_minus_the_previous_days_end() -> None:
    result = one(
        [
            snap(days_ago=3.25, spend=10, purchases=0),  # Nov 4, 06:00
            snap(
                days_ago=2.75, spend=30, purchases=1, purchase_value=100
            ),  # Nov 4, 18:00
            snap(
                days_ago=2.25, spend=60, purchases=3, purchase_value=250
            ),  # Nov 5, 06:00
            snap(
                days_ago=1.25, spend=60, purchases=3, purchase_value=250
            ),  # Nov 6, 06:00
            snap(days_ago=0, spend=70, purchases=3, purchase_value=250),  # Nov 7, 12:00
        ],
        days=3,
    )

    by_date = {p.date.isoformat(): p for p in result.daily}
    assert sorted(by_date) == ["2026-11-05", "2026-11-06", "2026-11-07"]
    nov5 = by_date["2026-11-05"]
    assert nov5.spend == 30  # 60 at the end of the 5th, minus 30 at the end of the 4th
    assert nov5.purchases == 2
    assert nov5.revenue == 150
    assert nov5.cost_per_sale == 15
    assert nov5.roas == 5.0
    assert by_date["2026-11-06"].spend == 0
    assert by_date["2026-11-07"].spend == 10


def test_a_day_with_no_snapshot_is_a_gap_not_a_zero() -> None:
    result = one(
        [
            snap(days_ago=3.25, spend=10),  # Nov 4, 06:00
            snap(days_ago=2.25, spend=30),  # Nov 5, 06:00
            # nothing stored on the 6th (the sync was down)
            snap(days_ago=0.4, spend=90),  # Nov 7, 02:24
        ],
        days=3,
    )

    by_date = {p.date.isoformat(): p for p in result.daily}
    assert by_date["2026-11-05"].spend == 20
    gap = by_date["2026-11-06"]
    assert gap.spend is None
    assert gap.purchases is None
    # the day after a gap cannot be split from it either
    assert by_date["2026-11-07"].spend is None


def test_cost_per_sale_is_unavailable_on_a_day_with_no_purchases() -> None:
    result = one(
        [
            snap(days_ago=1.75, spend=10, purchases=0),  # Nov 5, 18:00
            snap(days_ago=0.75, spend=30, purchases=0),  # Nov 6, 18:00
        ],
        days=2,
    )

    by_date = {p.date.isoformat(): p for p in result.daily}
    assert by_date["2026-11-06"].spend == 20
    assert by_date["2026-11-06"].cost_per_sale is None
    # revenue was reported as $0 against $20 spent, so the return really is 0.0x
    assert by_date["2026-11-06"].roas == 0.0


def test_all_time_charts_cover_at_most_the_last_90_days() -> None:
    result = one([snap(days_ago=200, spend=1), snap(days_ago=0, spend=9)], days=None)

    assert len(result.daily) == 90


# ---- campaign rows ---------------------------------------------------------


def test_each_campaign_gets_a_row_for_the_selected_period() -> None:
    result = build(
        [
            (
                "c1",
                "Spring",
                "LIVE",
                [
                    snap(days_ago=10, spend=10, purchases=0),
                    snap(
                        spend=110,
                        impressions=5000,
                        link_clicks=80,
                        add_to_cart=9,
                        purchases=4,
                        purchase_value=400,
                    ),
                ],
            ),
            ("c2", None, "PAUSED", []),
        ]
    )

    assert [c.campaign_id for c in result.campaigns] == ["c1"]
    row = result.campaigns[0]
    assert row.name == "Spring"
    assert row.status == "LIVE"
    assert row.spend == 100
    assert row.purchases == 4
    assert row.cost_per_sale == 25
    assert row.revenue == 400
    assert row.roas == 4.0


# ---- sync indicator --------------------------------------------------------


def test_sync_is_not_connected_without_a_meta_connection() -> None:
    result = build([("c1", "A", "LIVE", [snap()])], connected=False)

    assert result.sync.status == "not_connected"


def test_sync_is_ok_when_the_last_read_is_recent() -> None:
    result = one([snap(days_ago=10 / 1440)])

    assert result.sync.status == "ok"
    assert result.sync.last_synced_at == NOW - timedelta(minutes=10)
    assert result.sync.interval_minutes == 15


def test_sync_is_stale_when_a_live_campaign_missed_two_cycles() -> None:
    result = one([snap(days_ago=50 / 1440)])

    assert result.sync.status == "stale"
    assert result.sync.last_synced_at == NOW - timedelta(minutes=50)


def test_old_numbers_of_paused_campaigns_are_not_stale() -> None:
    result = one([snap(days_ago=2)], status="PAUSED")

    assert result.sync.status == "ok"


# ---- recorded failures ------------------------------------------------------


def failed(
    source: SyncFailureSource = "collection",
    *,
    minutes_ago: float = 1,
    code: int | None = 190,
    reason: str = "Meta API call to /x failed: Invalid OAuth access token",
) -> perf.FailureRecord:
    return perf.FailureRecord(
        source=source,
        failed_at=NOW - timedelta(minutes=minutes_ago),
        code=code,
        reason=reason,
    )


def test_a_failed_collection_newer_than_the_last_numbers_is_a_failed_sync() -> None:
    result = build(
        [("c1", "A", "LIVE", [snap(days_ago=30 / 1440)])],
        failure=failed(minutes_ago=1),
    )

    assert result.sync.status == "failed"
    assert result.sync.last_synced_at == NOW - timedelta(minutes=30)
    failure = result.sync.failure
    assert failure is not None
    assert failure.source == "collection"
    assert failure.needs_reconnect is True
    assert "no longer accepts your connection" in failure.reason
    assert "Invalid OAuth" not in failure.reason


def test_a_failed_collection_before_any_numbers_exist_is_still_failed() -> None:
    result = build([("c1", "A", "LIVE", [])], failure=failed())

    assert result.sync.status == "failed"
    assert result.sync.last_synced_at is None


def test_a_failure_older_than_the_latest_numbers_does_not_make_it_failed() -> None:
    result = build(
        [("c1", "A", "LIVE", [snap(days_ago=1 / 1440)])],
        failure=failed(minutes_ago=20),
    )

    assert result.sync.status == "ok"
    assert result.sync.failure is not None  # still reported


def test_a_failed_spend_check_is_reported_without_calling_the_sync_failed() -> None:
    result = build(
        [("c1", "A", "LIVE", [snap(days_ago=5 / 1440)])],
        failure=failed("reconcile"),
    )

    assert result.sync.status == "ok"
    assert result.sync.failure is not None
    assert result.sync.failure.source == "reconcile"


def test_a_failure_that_is_not_about_the_token_needs_no_reconnect() -> None:
    result = build(
        [("c1", "A", "LIVE", [snap(days_ago=30 / 1440)])],
        failure=failed(code=4, reason="Application request limit reached"),
    )

    assert result.sync.failure is not None
    assert result.sync.failure.needs_reconnect is False
    assert "limiting requests" in result.sync.failure.reason


def test_not_connected_outranks_a_recorded_failure() -> None:
    result = build([("c1", "A", "LIVE", [snap()])], connected=False, failure=failed())

    assert result.sync.status == "not_connected"


def test_no_failure_means_no_failure_field() -> None:
    result = one([snap(days_ago=5 / 1440)])

    assert result.sync.failure is None
