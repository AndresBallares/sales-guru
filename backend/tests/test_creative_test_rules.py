"""Tests for the creative test's deterministic pause rules (Stage 4).

Rules only run after a minimum time and data threshold. Cost per add-to-cart
is the primary metric; CAC is secondary and only counts once an ad has enough
purchases. The rules only ever propose pausing ads: what actually happens
automatically is decided by the job (tests in test_optimization_jobs.py).
"""

from typing import Any

import pytest
from app.schemas.strategy import (
    AudienceConstraints,
    CreativePersona,
    CreativeTestPlanContent,
    NormalizedMetrics,
    UnitEconomicsFields,
)
from app.services import creative_test_rules as rules
from app.services import strategist
from app.services.benchmarks import JEWELRY_META_BENCHMARKS


def _plan(**overrides: Any) -> CreativeTestPlanContent:
    benchmark_context = strategist._build_benchmark_context()
    fields: dict[str, Any] = {
        "objective": "SALES",
        "audience_constraints": AudienceConstraints(),
        "creative_persona": CreativePersona(name="Buyers", description="Women"),
        "hypotheses": [strategist._build_creative_hypothesis("A wins.")],
        "offer": "Offer",
        "positioning": "Positioning",
        "creative_angles": ["a", "b", "c", "d"],
        "copy_strategy": "Copy",
        "daily_budget": 75.0,
        "duration_days": 10,
        "total_budget": 750.0,
        "optimization_event": "ADD_TO_CART",
        "target_cost_per_add_to_cart": 20.0,
        "success_criteria": strategist._build_creative_success_criteria(
            benchmark_context, None, 20.0
        ),
        "baseline_metrics": NormalizedMetrics(),
        "benchmark_context": benchmark_context,
    }
    fields.update(overrides)
    return CreativeTestPlanContent(**fields)


def _ad(
    ad_id: str,
    *,
    spend: float = 0.0,
    add_to_cart: int | None = None,
    purchases: int | None = None,
    cac: float | None = None,
    live: bool = True,
    window: tuple[float, int] | None | str = "same",
) -> rules.AdSnapshot:
    """An ad; its shared-period numbers equal its lifetime ones unless `window` says.

    `window` is (spend, add-to-carts) in the shared period, or None when the ad
    has no shared-period numbers (the ads have not run side by side long enough).
    """
    if window == "same":
        window = (spend, add_to_cart or 0) if add_to_cart is not None else None
    window_spend, window_atc = window if isinstance(window, tuple) else (None, None)
    return rules.AdSnapshot(
        ad_id=ad_id,
        name=f"Ad {ad_id}",
        live=live,
        spend=spend,
        add_to_cart=add_to_cart,
        cost_per_add_to_cart=(spend / add_to_cart) if add_to_cart else None,
        purchases=purchases,
        cac=cac,
        window_spend=window_spend,
        window_add_to_cart=window_atc,
        window_cost_per_add_to_cart=(
            window_spend / window_atc
            if window_spend is not None and window_atc
            else None
        ),
    )


def _evaluate(
    ads: list[rules.AdSnapshot],
    *,
    plan: CreativeTestPlanContent | None = None,
    hours: float = 72.0,
) -> list[rules.PauseCandidate]:
    return rules.evaluate_creative_test(plan or _plan(), ads, hours_running=hours)


# ── Thresholds: time first ───────────────────────────────────


def test_the_thresholds_are_the_documented_ones() -> None:
    assert rules.MIN_HOURS_BEFORE_RULES == 48
    assert rules.NO_RESULT_SPEND_MULTIPLE == 2.0
    assert rules.LOSER_COST_FACTOR == 2.0
    assert rules.MIN_ADD_TO_CARTS_TO_COMPARE == 5
    assert rules.MIN_PURCHASES_FOR_CAC == 10
    assert rules.MIN_LIVE_ADS == 2
    assert rules.AUTO_PAUSE_LIMIT == 1


def test_nothing_is_judged_before_the_minimum_running_time() -> None:
    ads = [
        _ad("1", spend=500.0),
        _ad("2", spend=10.0, add_to_cart=5),
        _ad("3", spend=10.0, add_to_cart=5),
    ]

    assert _evaluate(ads, hours=47.9) == []
    assert _evaluate(ads, hours=48.0) != []


# ── Rule 1: spent 2x the target with nothing to show ─────────


def test_pauses_an_ad_that_spent_twice_the_target_with_no_add_to_carts() -> None:
    ads = [
        _ad("1", spend=40.0),
        _ad("2", spend=40.0, add_to_cart=4),
        _ad("3", spend=40.0, add_to_cart=4),
    ]

    candidates = _evaluate(ads)

    assert [c.ad_id for c in candidates] == ["1"]
    assert candidates[0].rule == "NO_RESULT"


def test_an_ad_just_under_twice_the_target_is_left_alone() -> None:
    ads = [
        _ad("1", spend=39.99),
        _ad("2", spend=40.0, add_to_cart=4),
        _ad("3", spend=40.0, add_to_cart=4),
    ]

    assert _evaluate(ads) == []


def test_an_ad_with_any_add_to_cart_is_not_a_no_result_ad() -> None:
    ads = [
        _ad("1", spend=500.0, add_to_cart=1),
        _ad("2", spend=40.0, add_to_cart=4),
        _ad("3", spend=40.0, add_to_cart=4),
    ]

    assert all(c.rule != "NO_RESULT" for c in _evaluate(ads))


def test_missing_add_to_cart_data_counts_as_none_once_spend_is_enough() -> None:
    ads = [
        _ad("1", spend=100.0, add_to_cart=None),
        _ad("2", spend=1.0),
        _ad("3", spend=1.0),
    ]

    assert [c.ad_id for c in _evaluate(ads)] == ["1"]


def test_a_purchase_plan_judges_the_no_result_rule_on_purchases_and_target_cac() -> (
    None
):
    plan = _plan(optimization_event="PURCHASE", target_cost_per_add_to_cart=None)
    target_cac = JEWELRY_META_BENCHMARKS.cac.median
    over = target_cac * 2.0
    ads = [
        _ad("1", spend=over, add_to_cart=9, purchases=0),
        _ad("2", spend=over, add_to_cart=9, purchases=1),
        _ad("3", spend=1.0),
    ]

    candidates = _evaluate(ads, plan=plan)

    assert [c.ad_id for c in candidates] == ["1"]
    assert candidates[0].rule == "NO_RESULT"


def test_a_purchase_plan_uses_the_products_own_target_cac() -> None:
    economics = UnitEconomicsFields(
        gross_profit=400.0, breakeven_cac=400.0, target_cac=100.0, breakeven_roas=2.0
    )
    plan = _plan(
        optimization_event="PURCHASE",
        target_cost_per_add_to_cart=None,
        unit_economics=economics,
    )

    assert rules.target_for_plan(plan) == 100.0
    assert rules.target_for_plan(_plan()) == 20.0


# ── Rule 2: materially worse cost per add-to-cart ────────────


def test_pauses_an_ad_with_twice_the_best_cost_per_add_to_cart() -> None:
    ads = [
        _ad("best", spend=50.0, add_to_cart=5),  # $10.00
        _ad("loser", spend=125.0, add_to_cart=5),  # $25.00 = 2.5x
        _ad("ok", spend=60.0, add_to_cart=5),  # $12.00
    ]

    candidates = _evaluate(ads)

    assert [c.ad_id for c in candidates] == ["loser"]
    assert candidates[0].rule == "WORSE_THAN_BEST"


def test_not_material_enough_is_left_alone() -> None:
    ads = [
        _ad("best", spend=50.0, add_to_cart=5),  # $10.00
        _ad("meh", spend=95.0, add_to_cart=5),  # $19.00 = 1.9x
        _ad("ok", spend=60.0, add_to_cart=5),
    ]

    assert _evaluate(ads) == []


@pytest.mark.parametrize("best_atc,loser_atc", [(4, 5), (5, 4)])
def test_a_comparison_needs_enough_add_to_carts_on_both_ads(
    best_atc: int, loser_atc: int
) -> None:
    ads = [
        _ad("best", spend=10.0 * best_atc, add_to_cart=best_atc),
        _ad("loser", spend=30.0 * loser_atc, add_to_cart=loser_atc),
        _ad("ok", spend=10.0, add_to_cart=1),
    ]

    assert _evaluate(ads) == []


# ── CAC is secondary: only with enough purchases ─────────────


def test_an_ad_with_enough_purchases_at_a_good_cac_is_protected() -> None:
    target_cac = rules.target_cac_for_plan(_plan())
    ads = [
        _ad("best", spend=50.0, add_to_cart=5),
        _ad("loser", spend=125.0, add_to_cart=5, purchases=10, cac=target_cac),
        _ad("ok", spend=60.0, add_to_cart=5),
    ]

    assert _evaluate(ads) == []


def test_an_ad_with_few_purchases_gets_no_cac_protection() -> None:
    target_cac = rules.target_cac_for_plan(_plan())
    ads = [
        _ad("best", spend=50.0, add_to_cart=5),
        _ad("loser", spend=125.0, add_to_cart=5, purchases=9, cac=target_cac),
        _ad("ok", spend=60.0, add_to_cart=5),
    ]

    assert [c.ad_id for c in _evaluate(ads)] == ["loser"]


def test_pauses_an_ad_whose_cac_is_twice_the_target_once_it_has_enough_purchases() -> (
    None
):
    target_cac = rules.target_cac_for_plan(_plan())
    ads = [
        _ad("a", spend=50.0, add_to_cart=5),
        _ad("bad", spend=60.0, add_to_cart=5, purchases=10, cac=target_cac * 2.5),
        _ad("c", spend=60.0, add_to_cart=5),
    ]

    candidates = _evaluate(ads)

    assert [c.ad_id for c in candidates] == ["bad"]
    assert candidates[0].rule == "CAC_TOO_HIGH"


def test_a_high_cac_with_too_few_purchases_is_ignored() -> None:
    target_cac = rules.target_cac_for_plan(_plan())
    ads = [
        _ad("a", spend=50.0, add_to_cart=5),
        _ad("bad", spend=60.0, add_to_cart=5, purchases=9, cac=target_cac * 2.5),
        _ad("c", spend=60.0, add_to_cart=5),
    ]

    assert _evaluate(ads) == []


# ── Never pause the test away ────────────────────────────────


def test_never_pauses_below_two_live_ads() -> None:
    ads = [_ad("1", spend=500.0), _ad("2", spend=40.0, add_to_cart=4)]

    assert _evaluate(ads) == []


def test_paused_ads_are_not_judged_or_counted_as_live() -> None:
    ads = [
        _ad("1", spend=500.0),
        _ad("2", spend=40.0, add_to_cart=4),
        _ad("gone", spend=500.0, live=False),
    ]

    assert _evaluate(ads) == []


def test_when_several_qualify_the_worst_comes_first_and_two_ads_always_remain() -> None:
    ads = [
        _ad("small", spend=45.0),
        _ad("big", spend=300.0),
        _ad("fine", spend=40.0, add_to_cart=4),
        _ad("fine2", spend=40.0, add_to_cart=4),
    ]

    candidates = _evaluate(ads)

    # Four live ads, so at most two can go; the biggest waste is first.
    assert [c.ad_id for c in candidates] == ["big", "small"]


# ── Every candidate carries the numbers that triggered it ────


def test_the_reasoning_states_the_numbers() -> None:
    ads = [
        _ad("1", spend=40.0),
        _ad("2", spend=40.0, add_to_cart=4),
        _ad("3", spend=40.0, add_to_cart=4),
    ]

    reasoning = _evaluate(ads, hours=60.0)[0].reasoning

    assert "$40.00" in reasoning
    assert "$20.00" in reasoning  # the target
    assert "2.0x" in reasoning
    assert "0 add-to-carts" in reasoning
    assert "60" in reasoning  # hours running


# ── The comparisons use the shared period; absolute rules stay lifetime ──


def test_rule_two_compares_cost_per_add_to_cart_in_the_shared_period() -> None:
    ads = [
        # On lifetime this looks like the best ad ($5.00); in the shared period, $25.
        _ad("old", spend=50.0, add_to_cart=10, window=(125.0, 5)),
        _ad("new", spend=50.0, add_to_cart=5, window=(50.0, 5)),  # $10.00
        _ad("ok", spend=60.0, add_to_cart=5, window=(60.0, 5)),  # $12.00
    ]

    candidates = _evaluate(ads)

    assert [c.ad_id for c in candidates] == ["old"]
    assert candidates[0].rule == "WORSE_THAN_BEST"
    assert "$25.00" in candidates[0].reasoning
    assert "shared period" in candidates[0].reasoning


def test_rule_two_does_not_fire_without_shared_period_numbers() -> None:
    ads = [
        _ad("best", spend=50.0, add_to_cart=5, window=None),
        _ad("loser", spend=125.0, add_to_cart=5, window=None),  # 2.5x on lifetime
        _ad("ok", spend=60.0, add_to_cart=5, window=None),
    ]

    assert _evaluate(ads) == []


def test_an_ad_outside_the_shared_period_is_not_a_comparison_candidate() -> None:
    ads = [
        _ad("best", spend=50.0, add_to_cart=5),
        _ad("stopped", spend=125.0, add_to_cart=5, window=None),
        _ad("ok", spend=60.0, add_to_cart=5),
    ]

    assert _evaluate(ads) == []


def test_rule_one_still_uses_lifetime_spend_even_without_shared_period_numbers() -> (
    None
):
    target = rules.target_for_plan(_plan())
    ads = [
        _ad("burner", spend=target * 2, add_to_cart=None, window=None),
        _ad("a", spend=5.0, add_to_cart=1, window=None),
        _ad("b", spend=5.0, add_to_cart=1, window=None),
    ]

    candidates = _evaluate(ads)

    assert [(c.ad_id, c.rule) for c in candidates] == [("burner", "NO_RESULT")]


def test_rule_three_still_uses_lifetime_cac() -> None:
    target_cac = rules.target_cac_for_plan(_plan())
    ads = [
        _ad(
            "dear",
            spend=500.0,
            add_to_cart=20,
            purchases=10,
            cac=target_cac * 2,
            window=None,
        ),
        _ad("a", spend=5.0, add_to_cart=1, window=None),
        _ad("b", spend=5.0, add_to_cart=1, window=None),
    ]

    candidates = _evaluate(ads)

    assert [(c.ad_id, c.rule) for c in candidates] == [("dear", "CAC_TOO_HIGH")]


def test_the_carousel_winner_has_most_add_to_carts_in_the_shared_period() -> None:
    ads = [
        _ad("old", spend=200.0, add_to_cart=40, window=(40.0, 6)),
        _ad("new", spend=60.0, add_to_cart=10, window=(60.0, 9)),
    ]

    winner = rules.carousel_winner(ads)

    assert winner is not None and winner.ad_id == "new"


def test_no_carousel_winner_without_shared_period_numbers() -> None:
    ads = [
        _ad("old", spend=200.0, add_to_cart=40, window=None),
        _ad("new", spend=60.0, add_to_cart=10, window=None),
    ]

    assert rules.carousel_winner(ads) is None


def test_the_carousel_reasoning_quotes_the_shared_period_numbers() -> None:
    winner = _ad("new", spend=500.0, add_to_cart=40, window=(60.0, 9))

    text = rules.carousel_proposal_reasoning(
        winner, 4, "Compared over the last 4 days, while all ads ran"
    )

    assert "9 add-to-carts" in text and "$60.00" in text
    assert "Compared over the last 4 days, while all ads ran" in text
