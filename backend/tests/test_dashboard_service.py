"""Tests for the campaign dashboard math (app/services/dashboard.py)."""

from datetime import UTC, datetime, timedelta
from typing import Any

from app.schemas.dashboard import Tier1
from app.services import dashboard as d

T0 = datetime(2026, 10, 10, 12, 0, tzinfo=UTC)


def snap(
    *,
    hours: float = 0.0,
    ad_set_id: str | None = None,
    ad_id: str | None = None,
    impressions: int = 1000,
    spend: float = 10.0,
    link_clicks: int | None = None,
    landing_page_views: int | None = None,
    add_to_cart: int | None = None,
    initiated_checkout: int | None = None,
    purchases: int | None = None,
    purchase_value: float | None = None,
) -> d.Snapshot:
    """A snapshot `hours` after T0."""
    return d.Snapshot(
        ad_set_id=ad_set_id,
        ad_id=ad_id,
        impressions=impressions,
        spend=spend,
        link_clicks=link_clicks,
        landing_page_views=landing_page_views,
        add_to_cart=add_to_cart,
        initiated_checkout=initiated_checkout,
        purchases=purchases,
        purchase_value=purchase_value,
        fetched_at=T0 + timedelta(hours=hours),
    )


def totals(**kwargs: Any) -> d.Totals:
    """Totals built through the real combine() from one snapshot."""
    result = d.combine([snap(**kwargs)])
    assert result is not None
    return result


def tier1(t: d.Totals, **kwargs: Any) -> Tier1:
    params: dict[str, Any] = {
        "planned_total": 500.0,
        "planned_daily": 50.0,
        "target_cac": 55.0,
        "target_source": "industry_benchmark",
        "breakeven_cac": None,
        "breakeven_roas": None,
    }
    params.update(kwargs)
    return d.build_tier1(t, **params)


# --- latest lifetime totals, never summed over time ----------------------------


def test_campaign_totals_use_the_latest_snapshot_not_a_sum_over_time() -> None:
    """Meta's numbers are lifetime-to-date, so five 15-minute snapshots of a
    campaign that has spent $30 in all read $30, not the sum of the five."""
    rows = [
        snap(hours=0, spend=6.0, impressions=200, purchases=0, purchase_value=0.0),
        snap(hours=0.25, spend=12.0, impressions=400, purchases=1, purchase_value=90.0),
        snap(hours=0.5, spend=18.0, impressions=600, purchases=1, purchase_value=90.0),
        snap(
            hours=0.75, spend=24.0, impressions=800, purchases=2, purchase_value=200.0
        ),
        snap(
            hours=1.0, spend=30.0, impressions=1000, purchases=3, purchase_value=290.0
        ),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.spend == 30.0
    assert result.impressions == 1000
    assert result.purchases == 3
    assert result.purchase_value == 290.0
    assert result.as_of == T0 + timedelta(hours=1)


def test_the_latest_snapshot_wins_whatever_order_rows_arrive_in() -> None:
    rows = [
        snap(hours=2, spend=30.0),
        snap(hours=0, spend=6.0),
        snap(hours=1, spend=18.0),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.spend == 30.0


def test_two_ad_sets_add_their_own_latest_rows_once_each() -> None:
    """A two-variant TEST_PLAN stores one row per ad set: the campaign is each
    ad set's latest, added together (different objects, not different times)."""
    rows = [
        snap(hours=0, ad_set_id="A", spend=5.0, impressions=100),
        snap(hours=1, ad_set_id="A", spend=30.0, impressions=900),
        snap(hours=0, ad_set_id="B", spend=4.0, impressions=80),
        snap(hours=1, ad_set_id="B", spend=20.0, impressions=700),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.spend == 50.0
    assert result.impressions == 1600


def test_ad_level_rows_never_feed_the_campaign_totals() -> None:
    rows = [
        snap(hours=1, spend=30.0, impressions=1000),
        snap(hours=1, ad_set_id="S", ad_id="ad-1", spend=18.0, impressions=600),
        snap(hours=1, ad_set_id="S", ad_id="ad-2", spend=12.0, impressions=400),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.spend == 30.0
    assert result.impressions == 1000


def test_each_ad_uses_only_its_own_latest_row() -> None:
    rows = [
        snap(hours=0, ad_set_id="S", ad_id="ad-1", spend=5.0, add_to_cart=1),
        snap(hours=2, ad_set_id="S", ad_id="ad-1", spend=18.0, add_to_cart=6),
        snap(hours=1, ad_set_id="S", ad_id="ad-2", spend=12.0, add_to_cart=4),
        snap(hours=1, spend=99.0),
    ]

    per_ad = d.ad_totals(rows)

    assert set(per_ad) == {"ad-1", "ad-2"}
    assert per_ad["ad-1"].spend == 18.0
    assert per_ad["ad-1"].add_to_cart == 6


def test_no_snapshots_means_no_totals() -> None:
    assert d.campaign_totals([]) is None
    assert d.ad_totals([]) == {}


def test_an_unavailable_field_stays_unavailable_not_zero() -> None:
    result = d.campaign_totals([snap(impressions=500)])

    assert result is not None
    assert result.link_clicks is None
    assert result.purchases is None
    assert result.purchase_value is None


def test_a_group_with_delivery_but_no_value_makes_the_total_unavailable() -> None:
    rows = [
        snap(ad_set_id="A", impressions=500, link_clicks=10),
        snap(ad_set_id="B", impressions=500, link_clicks=None),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.link_clicks is None


def test_a_group_with_no_delivery_yet_adds_nothing_to_a_field() -> None:
    rows = [
        snap(ad_set_id="A", impressions=500, link_clicks=10),
        snap(ad_set_id="B", impressions=0, spend=0.0, link_clicks=None),
    ]

    result = d.campaign_totals(rows)

    assert result is not None
    assert result.link_clicks == 10


# --- confidence flags ----------------------------------------------------------


def test_confidence_wording_for_thin_and_singular_data() -> None:
    thin = d.confidence(3, 10, "purchases", "purchase")
    one = d.confidence(1, 10, "purchases", "purchase")

    assert thin.sufficient is False
    assert thin.label == "Based on 3 purchases — too early to judge"
    assert one.label == "Based on 1 purchase — too early to judge"


def test_confidence_is_sufficient_at_the_threshold() -> None:
    result = d.confidence(10, 10, "purchases", "purchase")

    assert result.sufficient is True
    assert result.label is None


def test_confidence_with_no_basis_says_not_available() -> None:
    result = d.confidence(None, 10, "purchases", "purchase")

    assert result.sufficient is False
    assert result.label == "Not available yet"


# --- tier 1 ----------------------------------------------------------------------


def test_tier1_shows_raw_counts_and_flags_thin_data() -> None:
    t = totals(spend=140.0, purchases=3, purchase_value=420.0)

    result = tier1(t, breakeven_roas=2.0)

    assert result.purchases.value == 3
    assert result.revenue.value == 420.0
    assert (
        result.purchases.confidence.label == "Based on 3 purchases — too early to judge"
    )
    assert result.cost_per_purchase.confidence.sufficient is False
    assert result.roas.confidence.sufficient is False
    assert result.cost_per_purchase.value == 140.0 / 3
    assert result.roas.value == 3.0


def test_tier1_flag_clears_at_ten_purchases() -> None:
    result = tier1(totals(spend=400.0, purchases=10, purchase_value=1500.0))

    assert result.purchases.confidence.sufficient is True
    assert result.cost_per_purchase.confidence.label is None


def test_tier1_spend_against_the_plan() -> None:
    result = tier1(totals(spend=125.0), planned_total=500.0, planned_daily=50.0)

    assert result.spend.value == 125.0
    assert result.spend.planned_total == 500.0
    assert result.spend.percent_of_plan == 25.0


def test_tier1_spend_without_a_plan_budget() -> None:
    result = tier1(totals(spend=125.0), planned_total=None, planned_daily=None)

    assert result.spend.percent_of_plan is None


def test_tier1_cost_per_purchase_below_and_above_target() -> None:
    below = tier1(totals(spend=100.0, purchases=4), target_cac=55.0)
    above = tier1(totals(spend=300.0, purchases=4), target_cac=55.0)
    equal = tier1(totals(spend=220.0, purchases=4), target_cac=55.0)

    assert below.cost_per_purchase.position == "below_target"
    assert above.cost_per_purchase.position == "above_target"
    assert equal.cost_per_purchase.position == "below_target"
    assert above.cost_per_purchase.target == 55.0


def test_tier1_carries_the_target_source_and_breakeven() -> None:
    result = tier1(
        totals(spend=100.0, purchases=2),
        target_cac=40.0,
        target_source="unit_economics",
        breakeven_cac=120.0,
    )

    assert result.cost_per_purchase.target_source == "unit_economics"
    assert result.cost_per_purchase.breakeven == 120.0


def test_tier1_roas_above_and_below_breakeven() -> None:
    above = tier1(
        totals(spend=100.0, purchases=2, purchase_value=250.0), breakeven_roas=2.0
    )
    below = tier1(
        totals(spend=100.0, purchases=2, purchase_value=150.0), breakeven_roas=2.0
    )

    assert above.roas.position == "above_breakeven"
    assert below.roas.position == "below_breakeven"
    assert below.roas.breakeven == 2.0


def test_tier1_roas_has_no_position_without_a_breakeven() -> None:
    result = tier1(
        totals(spend=100.0, purchases=2, purchase_value=250.0), breakeven_roas=None
    )

    assert result.roas.value == 2.5
    assert result.roas.position is None


def test_tier1_with_no_purchases_has_no_cost_per_purchase() -> None:
    result = tier1(totals(spend=40.0, purchases=0, purchase_value=0.0))

    assert result.cost_per_purchase.value is None
    assert result.cost_per_purchase.position is None
    assert result.purchases.value == 0
    assert (
        result.purchases.confidence.label == "Based on 0 purchases — too early to judge"
    )


def test_tier1_revenue_and_roas_unavailable_when_meta_sent_no_values() -> None:
    result = tier1(totals(spend=40.0, purchases=None, purchase_value=None))

    assert result.revenue.value is None
    assert result.roas.value is None
    assert result.purchases.value is None


# --- tier 2 ----------------------------------------------------------------------


def test_link_ctr_is_link_clicks_over_impressions_with_a_band() -> None:
    result = d.build_tier2(
        totals(impressions=2000, link_clicks=30), target_cost_per_add_to_cart=None
    )

    assert result.link_ctr.value == 1.5
    assert result.link_ctr.band == "typical"


def test_link_ctr_bands() -> None:
    def band(clicks: int) -> str | None:
        t = totals(impressions=10000, link_clicks=clicks)
        return d.build_tier2(t, target_cost_per_add_to_cart=None).link_ctr.band

    assert band(79) == "weak"
    assert band(80) == "below_typical"
    assert band(119) == "below_typical"
    assert band(120) == "typical"
    assert band(150) == "typical"
    assert band(151) == "strong"


def test_link_ctr_unavailable_without_link_clicks() -> None:
    result = d.build_tier2(
        totals(impressions=2000, link_clicks=None), target_cost_per_add_to_cart=None
    )

    assert result.link_ctr.value is None
    assert result.link_ctr.band is None


def test_link_ctr_and_cpm_are_flagged_under_1000_impressions() -> None:
    result = d.build_tier2(
        totals(impressions=640, spend=6.4, link_clicks=9),
        target_cost_per_add_to_cart=None,
    )

    expected = "Based on 640 impressions — too early to judge"
    assert result.link_ctr.confidence.label == expected
    assert result.cpm.confidence.label == expected


def test_link_ctr_and_cpm_are_not_flagged_from_1000_impressions() -> None:
    result = d.build_tier2(
        totals(impressions=1000, spend=10.0, link_clicks=15),
        target_cost_per_add_to_cart=None,
    )

    assert result.link_ctr.confidence.sufficient is True
    assert result.cpm.confidence.sufficient is True


def test_cpm_is_spend_per_thousand_impressions_with_its_benchmark_zone() -> None:
    result = d.build_tier2(
        totals(impressions=2000, spend=20.0), target_cost_per_add_to_cart=None
    )

    assert result.cpm.value == 10.0
    assert result.cpm.benchmark_median == 9.36
    assert result.cpm.zone == "within_acceptable_range"


def test_cpm_unavailable_with_no_impressions() -> None:
    result = d.build_tier2(
        totals(impressions=0, spend=0.0), target_cost_per_add_to_cart=None
    )

    assert result.cpm.value is None
    assert result.cpm.zone is None


def test_add_to_cart_metrics_and_their_flag_under_five() -> None:
    result = d.build_tier2(
        totals(spend=40.0, landing_page_views=100, add_to_cart=4),
        target_cost_per_add_to_cart=12.0,
    )

    assert result.add_to_cart.count == 4
    assert result.add_to_cart.rate == 4.0
    assert result.add_to_cart.cost_per == 10.0
    assert result.add_to_cart.target_cost_per == 12.0
    assert (
        result.add_to_cart.confidence.label
        == "Based on 4 add-to-carts — too early to judge"
    )


def test_add_to_cart_flag_clears_at_five() -> None:
    result = d.build_tier2(
        totals(spend=40.0, landing_page_views=100, add_to_cart=5),
        target_cost_per_add_to_cart=None,
    )

    assert result.add_to_cart.confidence.sufficient is True


def test_add_to_cart_rate_unavailable_without_landing_page_views() -> None:
    result = d.build_tier2(
        totals(spend=40.0, landing_page_views=None, add_to_cart=6),
        target_cost_per_add_to_cart=None,
    )

    assert result.add_to_cart.rate is None
    assert result.add_to_cart.cost_per is not None


def test_checkout_rate_is_from_add_to_cart_and_flagged_under_five_checkouts() -> None:
    result = d.build_tier2(
        totals(add_to_cart=10, initiated_checkout=4), target_cost_per_add_to_cart=None
    )

    assert result.checkout.count == 4
    assert result.checkout.rate == 40.0
    assert (
        result.checkout.confidence.label == "Based on 4 checkouts — too early to judge"
    )


def test_checkout_flag_clears_at_five_checkouts() -> None:
    result = d.build_tier2(
        totals(add_to_cart=10, initiated_checkout=5), target_cost_per_add_to_cart=None
    )

    assert result.checkout.confidence.sufficient is True


def test_funnel_steps_with_rates_and_drop_off() -> None:
    result = d.build_tier2(
        totals(
            impressions=10000,
            link_clicks=200,
            add_to_cart=20,
            initiated_checkout=10,
            purchases=5,
        ),
        target_cost_per_add_to_cart=None,
    )

    steps = {s.key: s for s in result.funnel}
    assert [s.key for s in result.funnel] == [
        "impressions",
        "link_clicks",
        "add_to_cart",
        "checkout",
        "purchase",
    ]
    assert steps["impressions"].rate_from_previous is None
    assert steps["link_clicks"].rate_from_previous == 2.0
    assert steps["link_clicks"].drop_off_from_previous == 98.0
    assert steps["add_to_cart"].rate_from_previous == 10.0
    assert steps["checkout"].rate_from_previous == 50.0
    assert steps["purchase"].rate_from_previous == 50.0
    assert steps["purchase"].drop_off_from_previous == 50.0


def test_funnel_step_after_an_unavailable_step_has_no_rate() -> None:
    result = d.build_tier2(
        totals(impressions=1000, link_clicks=None, add_to_cart=5),
        target_cost_per_add_to_cart=None,
    )

    steps = {s.key: s for s in result.funnel}
    assert steps["link_clicks"].count is None
    assert steps["link_clicks"].rate_from_previous is None
    assert steps["add_to_cart"].rate_from_previous is None


# --- leader rule -------------------------------------------------------------------


def ad_totals_row(
    spend: float, *, purchases: int | None = None, add_to_cart: int | None = None
) -> d.Totals:
    return totals(spend=spend, purchases=purchases, add_to_cart=add_to_cart)


def test_leader_by_cac_when_every_ad_has_ten_purchases() -> None:
    rows = [
        ("a", ad_totals_row(400.0, purchases=10, add_to_cart=40)),
        ("b", ad_totals_row(300.0, purchases=12, add_to_cart=30)),
        ("c", ad_totals_row(500.0, purchases=10, add_to_cart=20)),
    ]

    leader = d.choose_leader(rows)

    assert leader is not None
    assert (leader.ad_id, leader.basis) == ("b", "cac")


def test_cac_is_not_used_when_one_ad_has_fewer_than_ten_purchases() -> None:
    """Falls back to cost per add-to-cart (all have 5+), and the ad with the
    best CAC but only 3 purchases does not get to lead on it."""
    rows = [
        ("a", ad_totals_row(400.0, purchases=10, add_to_cart=40)),
        ("b", ad_totals_row(30.0, purchases=3, add_to_cart=10)),
    ]

    leader = d.choose_leader(rows)

    assert leader is not None
    assert (leader.ad_id, leader.basis) == ("b", "cost_per_add_to_cart")


def test_leader_by_cost_per_add_to_cart_when_every_ad_has_five() -> None:
    rows = [
        ("a", ad_totals_row(100.0, add_to_cart=5)),
        ("b", ad_totals_row(60.0, add_to_cart=6)),
        ("c", ad_totals_row(99.0, add_to_cart=9)),
    ]

    leader = d.choose_leader(rows)

    assert leader is not None
    assert (leader.ad_id, leader.basis) == ("b", "cost_per_add_to_cart")


def test_no_leader_when_an_ad_has_under_five_add_to_carts_and_under_ten_purchases() -> (
    None
):
    rows = [
        ("a", ad_totals_row(100.0, add_to_cart=5)),
        ("b", ad_totals_row(10.0, add_to_cart=4)),
    ]

    assert d.choose_leader(rows) is None


def test_no_leader_with_fewer_than_two_ads() -> None:
    assert d.choose_leader([]) is None
    assert d.choose_leader([("a", ad_totals_row(100.0, add_to_cart=9))]) is None


def test_no_leader_on_a_tie() -> None:
    rows = [
        ("a", ad_totals_row(100.0, add_to_cart=10)),
        ("b", ad_totals_row(50.0, add_to_cart=5)),
    ]

    assert d.choose_leader(rows) is None


# --- tier 3 ------------------------------------------------------------------------


def test_tier3_marks_the_leader_and_computes_per_ad_numbers() -> None:
    ads = [d.AdInfo("a", "Ad A", "LIVE"), d.AdInfo("b", "Ad B", "LIVE")]
    per_ad = {
        "a": totals(
            spend=100.0, impressions=2000, link_clicks=20, add_to_cart=5, purchases=1
        ),
        "b": totals(spend=60.0, impressions=1000, link_clicks=20, add_to_cart=6),
    }

    result = d.build_tier3(ads, per_ad, [])

    assert result is not None
    assert result.leader is not None and result.leader.ad_id == "b"
    assert result.leader_message == "Leading on cost per add-to-cart"
    rows = {r.ad_id: r for r in result.ads}
    assert rows["b"].is_leader is True
    assert rows["a"].is_leader is False
    assert rows["a"].link_ctr == 1.0
    assert rows["a"].cost_per_add_to_cart == 20.0
    assert rows["a"].cac == 100.0
    assert rows["b"].cac is None


def test_tier3_says_no_clear_leader_yet_when_there_is_none() -> None:
    ads = [d.AdInfo("a", "Ad A", "LIVE"), d.AdInfo("b", "Ad B", "LIVE")]
    per_ad = {
        "a": totals(spend=10.0, add_to_cart=1),
        "b": totals(spend=10.0, add_to_cart=2),
    }

    result = d.build_tier3(ads, per_ad, [])

    assert result is not None
    assert result.leader is None
    assert result.leader_message == "No clear leader yet"
    assert not any(r.is_leader for r in result.ads)


def test_tier3_is_absent_without_any_ad_level_numbers() -> None:
    assert d.build_tier3([d.AdInfo("a", "Ad A", "LIVE")], {}, []) is None


def test_tier3_lists_an_ad_with_no_numbers_yet() -> None:
    ads = [d.AdInfo("a", "Ad A", "LIVE"), d.AdInfo("b", "Ad B", "LIVE")]

    result = d.build_tier3(ads, {"a": totals(spend=10.0)}, [])

    assert result is not None
    row = {r.ad_id: r for r in result.ads}["b"]
    assert row.spend is None
    assert row.cac is None


def test_ad_status_labels() -> None:
    ads = [
        d.AdInfo("live", "Live", "LIVE"),
        d.AdInfo("user", "Paused by you", "PAUSED"),
        d.AdInfo("auto", "Paused by optimizer", "PAUSED"),
        d.AdInfo("prop", "Proposed pause", "LIVE"),
    ]
    per_ad = {a.id: totals(spend=10.0) for a in ads}
    recs = [
        d.PauseRecommendation("auto", "APPLIED"),
        d.PauseRecommendation("prop", "PENDING"),
        d.PauseRecommendation("live", "REJECTED"),
    ]

    result = d.build_tier3(ads, per_ad, recs)

    assert result is not None
    status = {r.ad_id: r.status for r in result.ads}
    assert status == {
        "live": "live",
        "user": "paused",
        "auto": "paused_by_optimizer",
        "prop": "proposed_pause",
    }
