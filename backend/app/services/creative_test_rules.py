"""Deterministic pause rules for a creative test (CREATIVE_TEST_PLAN, Stage 4).

The plan's written decision rules, enforced in code. Cost per add-to-cart is
the primary metric (the test's question is which angle earns the cheapest
one); CAC is secondary and only counts once an ad has enough purchases for it
to mean anything. Nothing is judged before the test has run long enough, and
no rule fires on thin data.

This module only decides who *could* be paused. What actually happens
automatically (at most one pause per campaign) and what needs the user's
approval (every other pause, and any cost-cap change) is decided in
app/services/optimization_jobs.py. Pure functions, no I/O, no LLM.

The plan's other written rules (keep testing, test new creative, investigate
the offer or checkout) describe judgment calls, not pauses, and are not
enforced here.
"""

from typing import NamedTuple

from app.schemas.strategy import CreativeTestPlanContent
from app.services.optimizer import resolve_target_cac

# Rules wait this long after the first ad-level snapshot: Meta needs a couple of
# days to exit its learning phase and for spend to even out across ads.
MIN_HOURS_BEFORE_RULES = 48.0
# An ad that spent this many times the target with no result is wasting money.
NO_RESULT_SPEND_MULTIPLE = 2.0
# An ad whose cost per add-to-cart is this many times the best ad's is "materially"
# worse, and an ad whose CAC is this many times the target is too expensive.
LOSER_COST_FACTOR = 2.0
# A cost per add-to-cart from fewer than this many add-to-carts is noise.
MIN_ADD_TO_CARTS_TO_COMPARE = 5
# CAC only becomes a signal (secondary to cost per add-to-cart) at this many purchases.
MIN_PURCHASES_FOR_CAC = 10
# The test needs a comparison, so two ads always stay live.
MIN_LIVE_ADS = 2
# Only one pause per campaign is ever automatic; everything else needs approval.
AUTO_PAUSE_LIMIT = 1
# "Cost cap may be too tight" proposes raising the cap by this factor, and an
# approved raise never takes the cap above this multiple of the plan's target.
# A carousel is proposed as the next experiment only once the single-image test
# has had this long (five days) and one ad has clearly won, so the comparison
# is "the winning image vs. a carousel", not a second guess on thin data.
CAROUSEL_PROPOSAL_MIN_HOURS = 120.0

COST_CAP_RAISE_FACTOR = 1.25
COST_CAP_CEILING_MULTIPLE = 2.0


class AdSnapshot(NamedTuple):
    """One ad's lifetime numbers, from its latest ad-level Metric row."""

    ad_id: str
    name: str
    live: bool
    spend: float
    add_to_cart: int | None
    cost_per_add_to_cart: float | None
    purchases: int | None
    cac: float | None


class PauseCandidate(NamedTuple):
    """An ad a rule says should be paused, with the numbers that triggered it."""

    ad_id: str
    name: str
    rule: str  # NO_RESULT | WORSE_THAN_BEST | CAC_TOO_HIGH
    reasoning: str


def target_cac_for_plan(plan: CreativeTestPlanContent) -> float:
    """The plan's target CAC: the product's own, else the jewelry benchmark median."""
    return resolve_target_cac(plan.unit_economics)


def target_for_plan(plan: CreativeTestPlanContent) -> float:
    """The plan's per-result target: cost per add-to-cart, or CAC if purchase-based."""
    if plan.optimization_event == "ADD_TO_CART":
        assert plan.target_cost_per_add_to_cart is not None
        return plan.target_cost_per_add_to_cart
    return target_cac_for_plan(plan)


def _money(value: float) -> str:
    return f"${value:,.2f}"


def evaluate_creative_test(
    plan: CreativeTestPlanContent,
    ads: list[AdSnapshot],
    *,
    hours_running: float,
) -> list[PauseCandidate]:
    """Which ads the plan's rules say to pause, worst first.

    Args:
        plan: The campaign's CREATIVE_TEST_PLAN.
        ads: Every ad of the test with its own latest numbers.
        hours_running: Hours since the first ad-level snapshot was collected.

    Returns:
        Pause candidates, worst first, never so many that fewer than
        MIN_LIVE_ADS would stay live. Empty before MIN_HOURS_BEFORE_RULES, or
        when no rule fires.
    """
    if hours_running < MIN_HOURS_BEFORE_RULES:
        return []
    live = [ad for ad in ads if ad.live]
    pausable = len(live) - MIN_LIVE_ADS
    if pausable <= 0:
        return []

    target = target_for_plan(plan)
    target_cac = target_cac_for_plan(plan)
    on_add_to_cart = plan.optimization_event == "ADD_TO_CART"
    unit = "target cost per add-to-cart" if on_add_to_cart else "target CAC"
    result_word = "add-to-carts" if on_add_to_cart else "purchases"
    hours = f"{hours_running:.0f} hours"

    found: dict[str, tuple[float, PauseCandidate]] = {}

    # Rule 1: spent at least 2x the target and produced nothing.
    for ad in live:
        results = (ad.add_to_cart if on_add_to_cart else ad.purchases) or 0
        if ad.spend >= NO_RESULT_SPEND_MULTIPLE * target and results == 0:
            found[ad.ad_id] = (
                ad.spend,
                PauseCandidate(
                    ad.ad_id,
                    ad.name,
                    "NO_RESULT",
                    f"Ad '{ad.name}' spent {_money(ad.spend)} "
                    f"({ad.spend / target:.1f}x the {_money(target)} {unit}) "
                    f"with 0 {result_word} after {hours}.",
                ),
            )

    # Rule 2: cost per add-to-cart materially worse than the best ad's.
    comparable = [
        ad
        for ad in live
        if (ad.add_to_cart or 0) >= MIN_ADD_TO_CARTS_TO_COMPARE
        and ad.cost_per_add_to_cart is not None
    ]
    if len(comparable) >= 2:
        best = min(comparable, key=lambda a: a.cost_per_add_to_cart or 0.0)
        best_cost = best.cost_per_add_to_cart or 0.0
        for ad in comparable:
            cost = ad.cost_per_add_to_cart or 0.0
            protected = (
                (ad.purchases or 0) >= MIN_PURCHASES_FOR_CAC
                and ad.cac is not None
                and ad.cac <= target_cac
            )
            if (
                ad is not best
                and cost >= LOSER_COST_FACTOR * best_cost
                and not protected
                and ad.ad_id not in found
            ):
                found[ad.ad_id] = (
                    cost / best_cost * 1000,
                    PauseCandidate(
                        ad.ad_id,
                        ad.name,
                        "WORSE_THAN_BEST",
                        f"Ad '{ad.name}' costs {_money(cost)} per add-to-cart "
                        f"({ad.add_to_cart} add-to-carts), {cost / best_cost:.1f}x "
                        f"the best ad's {_money(best_cost)} "
                        f"({best.add_to_cart} add-to-carts), after {hours}.",
                    ),
                )

    # Rule 3 (secondary): CAC, only with enough purchases to trust it.
    for ad in live:
        if (
            (ad.purchases or 0) >= MIN_PURCHASES_FOR_CAC
            and ad.cac is not None
            and ad.cac >= LOSER_COST_FACTOR * target_cac
            and ad.ad_id not in found
        ):
            found[ad.ad_id] = (
                ad.cac / target_cac,
                PauseCandidate(
                    ad.ad_id,
                    ad.name,
                    "CAC_TOO_HIGH",
                    f"Ad '{ad.name}' has a CAC of {_money(ad.cac)} on "
                    f"{ad.purchases} purchases, {ad.cac / target_cac:.1f}x the "
                    f"{_money(target_cac)} target CAC, after {hours}.",
                ),
            )

    ordered = sorted(found.values(), key=lambda item: item[0], reverse=True)
    # NO_RESULT first (spend-ranked), then the rest by severity.
    ordered.sort(key=lambda item: item[1].rule != "NO_RESULT")
    return [candidate for _, candidate in ordered[:pausable]]


def carousel_winner(snapshots: list[AdSnapshot]) -> AdSnapshot | None:
    """The ad with the most add-to-carts, if it has enough to count as a winner.

    Args:
        snapshots: Every ad of the test with its latest numbers.

    Returns:
        The best ad by add-to-carts, or None when none reached
        MIN_ADD_TO_CARTS_TO_COMPARE.
    """
    best = max(snapshots, key=lambda s: s.add_to_cart or 0, default=None)
    if best is None or (best.add_to_cart or 0) < MIN_ADD_TO_CARTS_TO_COMPARE:
        return None
    return best


def carousel_proposal_reasoning(winner: AdSnapshot, photo_count: int) -> str:
    """Why a carousel is the next experiment, with the winning ad's numbers."""
    return (
        f"Test #1 compared single-image ads, and {winner.name} won with "
        f"{winner.add_to_cart} add-to-carts after $"
        f"{winner.spend:,.2f} spend. The next experiment is the same product "
        f"as a carousel ({photo_count} product photos). Approving creates a "
        "draft carousel campaign for you to generate, review and publish; "
        "nothing goes live on Meta until you do. It runs as its own "
        "campaign so format is the only thing that changes, not a mix of "
        "single-image and carousel ads in one test."
    )
