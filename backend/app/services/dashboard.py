"""Campaign dashboard math: snapshot rows in, the three tiers out.

Pure functions over plain rows (no database, no Meta), so every rule is unit
testable. app/api/dashboard.py loads the rows and calls these.

**Totals are the latest lifetime snapshot per level, never a sum over time.**
Every Metric row holds Meta's lifetime-to-date figures for the object it was
fetched for, so adding up the 15-minute snapshots would count the same spend
over and over. A campaign's totals are the latest campaign-level row (or, for
a two-variant TEST_PLAN that stores one row per ad set, the sum of each ad
set's own latest row: different objects, not different times); an ad's numbers
are that ad's own latest row. Ad-level rows never feed campaign totals.
"""

from collections.abc import Iterable, Sequence
from datetime import datetime
from typing import NamedTuple

from prisma.models import Metric

from app.schemas.dashboard import (
    AddToCartCard,
    AdRow,
    AdStatus,
    BusinessDashboardSummary,
    CampaignDashboardResponse,
    CampaignSummary,
    CheckoutCard,
    Confidence,
    CostPerPurchaseCard,
    CountCard,
    CpmCard,
    FunnelKey,
    FunnelStep,
    Leader,
    LinkCtrBand,
    LinkCtrCard,
    Proposal,
    RoasCard,
    SpendCard,
    TargetSource,
    Tier1,
    Tier2,
    Tier3,
)
from app.schemas.strategy import (
    AnyStrategyContent,
    CreativeTestPlanContent,
    TestPlanContent,
    daily_budget,
    planned_total_budget,
)
from app.services.benchmarks import (
    JEWELRY_META_BENCHMARKS,
    LINK_CTR_TYPICAL_HIGH_PCT,
    LINK_CTR_TYPICAL_LOW_PCT,
    LINK_CTR_WEAK_BELOW_PCT,
    classify_performance_zone,
)
from app.services.creative_test_rules import (
    MIN_ADD_TO_CARTS_TO_COMPARE,
    MIN_PURCHASES_FOR_CAC,
)

# Below these, a number is shown with a "too early to judge" flag.
MIN_PURCHASES_TO_JUDGE = MIN_PURCHASES_FOR_CAC
MIN_IMPRESSIONS_TO_JUDGE = 1000
MIN_ADD_TO_CARTS_TO_JUDGE = MIN_ADD_TO_CARTS_TO_COMPARE
MIN_CHECKOUTS_TO_JUDGE = 5

NO_CLEAR_LEADER = "No clear leader yet"


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


class AdInfo(NamedTuple):
    """A local Ad as the dashboard needs it."""

    id: str
    name: str
    status: str


class PauseRecommendation(NamedTuple):
    """A PAUSE_AD recommendation reduced to ad id and status."""

    target_ad_id: str | None
    status: str


def latest_per_group(snapshots: Iterable[Snapshot]) -> list[Snapshot]:
    """The most recent snapshot of each ad set group.

    Campaign-level rows (no ad set) are one group of their own.
    """
    latest: dict[str | None, Snapshot] = {}
    for snapshot in snapshots:
        current = latest.get(snapshot.ad_set_id)
        if current is None or snapshot.fetched_at > current.fetched_at:
            latest[snapshot.ad_set_id] = snapshot
    return list(latest.values())


def _sum_optional(rows: Sequence[Snapshot], field: str) -> float | None:
    """Sum a nullable field across groups.

    A group with no delivery (no impressions) and no value adds nothing; a
    group that has delivery but no value makes the total unavailable (None)
    rather than a quietly partial sum.
    """
    total = 0.0
    seen = False
    for row in rows:
        value = getattr(row, field)
        if value is None:
            if row.impressions > 0:
                return None
            continue
        total += value
        seen = True
    return total if seen else None


def _as_int(value: float | None) -> int | None:
    return None if value is None else int(value)


def combine(rows: Sequence[Snapshot]) -> Totals | None:
    """Totals across the latest snapshot of each group; None with no snapshots."""
    if not rows:
        return None
    return Totals(
        impressions=sum(r.impressions for r in rows),
        spend=sum(r.spend for r in rows),
        link_clicks=_as_int(_sum_optional(rows, "link_clicks")),
        landing_page_views=_as_int(_sum_optional(rows, "landing_page_views")),
        add_to_cart=_as_int(_sum_optional(rows, "add_to_cart")),
        initiated_checkout=_as_int(_sum_optional(rows, "initiated_checkout")),
        purchases=_as_int(_sum_optional(rows, "purchases")),
        purchase_value=_sum_optional(rows, "purchase_value"),
        as_of=max(r.fetched_at for r in rows),
    )


def campaign_totals(snapshots: Iterable[Snapshot]) -> Totals | None:
    """A campaign's lifetime totals from its campaign- and ad-set-level rows only."""
    return combine(latest_per_group(s for s in snapshots if s.ad_id is None))


def ad_totals(snapshots: Iterable[Snapshot]) -> dict[str, Totals]:
    """Each ad's own latest lifetime numbers, keyed by ad id."""
    latest: dict[str, Snapshot] = {}
    for snapshot in snapshots:
        if snapshot.ad_id is None:
            continue
        current = latest.get(snapshot.ad_id)
        if current is None or snapshot.fetched_at > current.fetched_at:
            latest[snapshot.ad_id] = snapshot
    totals: dict[str, Totals] = {}
    for ad_id, row in latest.items():
        combined = combine([row])
        assert combined is not None  # one row in, so never None
        totals[ad_id] = combined
    return totals


def confidence(
    basis: int | None, threshold: int, unit: str, singular: str
) -> Confidence:
    """Flag a number that rests on too little data.

    Args:
        basis: How many of the unit the number is based on (None = none yet).
        threshold: The count at which the number can be judged.
        unit: Plural unit name ("purchases").
        singular: Singular unit name ("purchase").
    """
    if basis is None:
        return Confidence(
            sufficient=False,
            basis=None,
            threshold=threshold,
            unit=unit,
            label="Not available yet",
        )
    if basis < threshold:
        noun = singular if basis == 1 else unit
        return Confidence(
            sufficient=False,
            basis=basis,
            threshold=threshold,
            unit=unit,
            label=f"Based on {basis} {noun} — too early to judge",
        )
    return Confidence(
        sufficient=True, basis=basis, threshold=threshold, unit=unit, label=None
    )


def _ratio(numerator: float | None, denominator: float | None) -> float | None:
    if numerator is None or not denominator:
        return None
    return numerator / denominator


def _pct(numerator: float | None, denominator: float | None) -> float | None:
    ratio = _ratio(numerator, denominator)
    return None if ratio is None else ratio * 100


def build_tier1(
    totals: Totals,
    *,
    planned_total: float | None,
    planned_daily: float | None,
    target_cac: float,
    target_source: TargetSource,
    breakeven_cac: float | None,
    breakeven_roas: float | None,
) -> Tier1:
    """Spend, purchases, revenue, cost per purchase and ROAS, each with its flag."""
    purchases = totals.purchases
    flag = confidence(purchases or 0, MIN_PURCHASES_TO_JUDGE, "purchases", "purchase")
    cost_per_purchase = _ratio(totals.spend, purchases)
    roas = (
        None
        if totals.purchase_value is None
        else _ratio(totals.purchase_value, totals.spend)
    )
    return Tier1(
        spend=SpendCard(
            value=totals.spend,
            planned_total=planned_total,
            planned_daily=planned_daily,
            percent_of_plan=_pct(totals.spend, planned_total),
        ),
        purchases=CountCard(
            value=None if purchases is None else float(purchases), confidence=flag
        ),
        revenue=CountCard(value=totals.purchase_value, confidence=flag),
        cost_per_purchase=CostPerPurchaseCard(
            value=cost_per_purchase,
            target=target_cac,
            target_source=target_source,
            breakeven=breakeven_cac,
            position=(
                None
                if cost_per_purchase is None
                else (
                    "below_target"
                    if cost_per_purchase <= target_cac
                    else "above_target"
                )
            ),
            confidence=flag,
        ),
        roas=RoasCard(
            value=roas,
            breakeven=breakeven_roas,
            position=(
                None
                if roas is None or breakeven_roas is None
                else (
                    "above_breakeven" if roas >= breakeven_roas else "below_breakeven"
                )
            ),
            confidence=flag,
        ),
    )


def _link_ctr_band(value: float | None) -> LinkCtrBand | None:
    if value is None:
        return None
    if value < LINK_CTR_WEAK_BELOW_PCT:
        return "weak"
    if value < LINK_CTR_TYPICAL_LOW_PCT:
        return "below_typical"
    if value <= LINK_CTR_TYPICAL_HIGH_PCT:
        return "typical"
    return "strong"


def _funnel(totals: Totals) -> list[FunnelStep]:
    counts: list[tuple[FunnelKey, str, int | None]] = [
        ("impressions", "Impressions", totals.impressions),
        ("link_clicks", "Link clicks", totals.link_clicks),
        ("add_to_cart", "Add to cart", totals.add_to_cart),
        ("checkout", "Checkout started", totals.initiated_checkout),
        ("purchase", "Purchases", totals.purchases),
    ]
    steps: list[FunnelStep] = []
    previous: int | None = None
    for key, label, count in counts:
        rate = _pct(count, previous) if steps else None
        steps.append(
            FunnelStep(
                key=key,
                label=label,
                count=count,
                rate_from_previous=rate,
                drop_off_from_previous=None if rate is None else 100 - rate,
            )
        )
        previous = count
    return steps


def build_tier2(totals: Totals, *, target_cost_per_add_to_cart: float | None) -> Tier2:
    """Link CTR, CPM, add-to-cart, checkout and the funnel, each with its flag."""
    impressions_flag = confidence(
        totals.impressions, MIN_IMPRESSIONS_TO_JUDGE, "impressions", "impression"
    )
    link_ctr = _pct(totals.link_clicks, totals.impressions)
    cpm = None if not totals.impressions else totals.spend / totals.impressions * 1000
    cpm_benchmark = JEWELRY_META_BENCHMARKS.cpm
    add_to_cart = totals.add_to_cart
    checkouts = totals.initiated_checkout
    return Tier2(
        link_ctr=LinkCtrCard(
            value=link_ctr,
            band=_link_ctr_band(link_ctr),
            weak_below=LINK_CTR_WEAK_BELOW_PCT,
            typical_low=LINK_CTR_TYPICAL_LOW_PCT,
            typical_high=LINK_CTR_TYPICAL_HIGH_PCT,
            confidence=impressions_flag,
        ),
        cpm=CpmCard(
            value=cpm,
            benchmark_low=cpm_benchmark.low,
            benchmark_median=cpm_benchmark.median,
            benchmark_high=cpm_benchmark.high,
            zone=(
                None if cpm is None else classify_performance_zone(cpm, cpm_benchmark)
            ),
            confidence=impressions_flag,
        ),
        add_to_cart=AddToCartCard(
            count=add_to_cart,
            rate=_pct(add_to_cart, totals.landing_page_views),
            cost_per=_ratio(totals.spend, add_to_cart),
            target_cost_per=target_cost_per_add_to_cart,
            confidence=confidence(
                add_to_cart or 0,
                MIN_ADD_TO_CARTS_TO_JUDGE,
                "add-to-carts",
                "add-to-cart",
            ),
        ),
        checkout=CheckoutCard(
            count=checkouts,
            rate=_pct(checkouts, add_to_cart),
            confidence=confidence(
                checkouts or 0, MIN_CHECKOUTS_TO_JUDGE, "checkouts", "checkout"
            ),
        ),
        funnel=_funnel(totals),
    )


def choose_leader(rows: Sequence[tuple[str, Totals]]) -> Leader | None:
    """Pick the leading ad, or None when the data can't support one.

    Ranked by cost per purchase only when every compared ad has 10+ purchases;
    otherwise by cost per add-to-cart when every compared ad has 5+
    add-to-carts; otherwise there is no leader. At least two ads are needed, and
    a tie for first is no leader.

    Args:
        rows: (ad id, that ad's totals) for every ad being compared.
    """
    if len(rows) < 2:
        return None
    if all((t.purchases or 0) >= MIN_PURCHASES_FOR_CAC for _, t in rows):
        costs = [(t.spend / t.purchases, ad_id) for ad_id, t in rows if t.purchases]
        basis = "cac"
    elif all((t.add_to_cart or 0) >= MIN_ADD_TO_CARTS_TO_COMPARE for _, t in rows):
        costs = [(t.spend / t.add_to_cart, ad_id) for ad_id, t in rows if t.add_to_cart]
        basis = "cost_per_add_to_cart"
    else:
        return None
    costs.sort()
    if len(costs) < 2 or costs[0][0] == costs[1][0]:
        return None
    return Leader(ad_id=costs[0][1], basis=basis)


def _ad_status(
    ad: AdInfo, pause_recommendations: Sequence[PauseRecommendation]
) -> AdStatus:
    mine = [r for r in pause_recommendations if r.target_ad_id == ad.id]
    if ad.status == "PAUSED":
        if any(r.status == "APPLIED" for r in mine):
            return "paused_by_optimizer"
        return "paused"
    if any(r.status == "PENDING" for r in mine):
        return "proposed_pause"
    return "live"


def build_tier3(
    ads: Sequence[AdInfo],
    per_ad: dict[str, Totals],
    pause_recommendations: Sequence[PauseRecommendation],
) -> Tier3 | None:
    """The per-ad table with the leader highlighted; None when no ad has numbers."""
    if not per_ad:
        return None
    leader = choose_leader(list(per_ad.items()))
    rows: list[AdRow] = []
    for ad in ads:
        totals = per_ad.get(ad.id)
        rows.append(
            AdRow(
                ad_id=ad.id,
                name=ad.name,
                status=_ad_status(ad, pause_recommendations),
                spend=None if totals is None else totals.spend,
                link_ctr=(
                    None
                    if totals is None
                    else _pct(totals.link_clicks, totals.impressions)
                ),
                add_to_cart=None if totals is None else totals.add_to_cart,
                cost_per_add_to_cart=(
                    None if totals is None else _ratio(totals.spend, totals.add_to_cart)
                ),
                purchases=None if totals is None else totals.purchases,
                cac=None if totals is None else _ratio(totals.spend, totals.purchases),
                is_leader=leader is not None and leader.ad_id == ad.id,
            )
        )
    return Tier3(
        ads=rows,
        leader=leader,
        leader_message=(
            NO_CLEAR_LEADER
            if leader is None
            else (
                "Leading on cost per purchase"
                if leader.basis == "cac"
                else "Leading on cost per add-to-cart"
            )
        ),
    )


# --- assembling a whole dashboard ----------------------------------------------


class PlanTargets(NamedTuple):
    """What the campaign is measured against, from its stored plan."""

    target_cac: float
    target_source: TargetSource
    breakeven_cac: float | None
    breakeven_roas: float | None
    planned_total: float | None
    planned_daily: float | None
    target_cost_per_add_to_cart: float | None


def plan_targets(content: AnyStrategyContent | None, ad_set_count: int) -> PlanTargets:
    """Targets and budget from the strategy, with the industry CAC as fallback.

    The cost-per-purchase target is the product's own target CAC (price and
    margin) when the plan has it, else the jewelry benchmark median. Break-even
    ROAS exists only with a price and margin. The planned total budget is
    known for the test plans (daily budget x ad sets x days); a data-driven
    strategy only has a daily figure.
    """
    unit_economics = getattr(content, "unit_economics", None)
    fallback_cac = JEWELRY_META_BENCHMARKS.cac.median
    planned_total: float | None = None
    planned_daily: float | None = None
    if content is not None:
        planned_daily = daily_budget(content)
        if isinstance(content, TestPlanContent | CreativeTestPlanContent):
            planned_total = planned_total_budget(content, ad_set_count)
    return PlanTargets(
        target_cac=unit_economics.target_cac if unit_economics else fallback_cac,
        target_source="unit_economics" if unit_economics else "industry_benchmark",
        breakeven_cac=unit_economics.breakeven_cac if unit_economics else None,
        breakeven_roas=unit_economics.breakeven_roas if unit_economics else None,
        planned_total=planned_total,
        planned_daily=planned_daily,
        target_cost_per_add_to_cart=getattr(
            content, "target_cost_per_add_to_cart", None
        ),
    )


class RecommendationInfo(NamedTuple):
    """An OptimizationRecommendation reduced to what the dashboard shows."""

    id: str
    action_type: str
    status: str
    target_ad_id: str | None
    reasoning: str
    risk: str
    confidence: float
    current_budget: float | None
    suggested_budget: float | None
    suggested_bid: float | None
    created_at: datetime


def snapshot_from_metric(metric: Metric) -> Snapshot:
    """Reduce a stored Metric row to a Snapshot."""
    return Snapshot(
        ad_set_id=metric.adSetId,
        ad_id=metric.adId,
        impressions=metric.impressions,
        spend=metric.spend,
        link_clicks=metric.linkClicks,
        landing_page_views=metric.landingPageViews,
        add_to_cart=metric.addToCart,
        initiated_checkout=metric.initiatedCheckout,
        purchases=metric.purchases,
        purchase_value=metric.purchaseValue,
        fetched_at=metric.fetchedAt,
    )


def assemble_campaign(
    *,
    campaign_id: str,
    name: str | None,
    status: str,
    snapshots: Sequence[Snapshot],
    targets: PlanTargets,
    ads: Sequence[AdInfo],
    recommendations: Sequence[RecommendationInfo],
    pixel_warning: str | None,
    is_sample: bool,
    paused_at: datetime | None = None,
    paused_reason: str | None = None,
) -> CampaignDashboardResponse:
    """Build the whole campaign dashboard from rows already loaded.

    Both the real endpoint and the local sample data go through here, so the
    sample shows exactly what real numbers would.
    """
    ad_names = {ad.id: ad.name for ad in ads}
    proposals = [
        Proposal(
            id=r.id,
            action_type=r.action_type,
            target_ad_id=r.target_ad_id,
            target_ad_name=ad_names.get(r.target_ad_id) if r.target_ad_id else None,
            reasoning=r.reasoning,
            risk=r.risk,
            confidence=r.confidence,
            current_budget=r.current_budget,
            suggested_budget=r.suggested_budget,
            suggested_bid=r.suggested_bid,
            created_at=r.created_at,
        )
        for r in sorted(recommendations, key=lambda r: r.created_at)
        if r.status == "PENDING"
    ]
    totals = campaign_totals(snapshots)
    # A campaign Meta hasn't delivered yet still gets all-zero snapshots; that is
    # "no results yet", not a campaign with $0 of results.
    if totals is not None and totals.impressions == 0 and totals.spend == 0:
        totals = None
    # Only a paused campaign has a pause to describe.
    is_paused = status == "PAUSED"
    base = {
        "campaign_id": campaign_id,
        "campaign_name": name,
        "status": status,
        "is_sample": is_sample,
        "pixel_warning": pixel_warning,
        "proposals": proposals,
        "paused_at": paused_at if is_paused else None,
        "paused_reason": paused_reason if is_paused else None,
    }
    if totals is None:
        return CampaignDashboardResponse(
            **base, has_data=False, as_of=None, tier1=None, tier2=None, tier3=None
        )
    pause_recommendations = [
        PauseRecommendation(r.target_ad_id, r.status)
        for r in recommendations
        if r.action_type == "PAUSE_AD"
    ]
    return CampaignDashboardResponse(
        **base,
        has_data=True,
        as_of=totals.as_of,
        tier1=build_tier1(
            totals,
            planned_total=targets.planned_total,
            planned_daily=targets.planned_daily,
            target_cac=targets.target_cac,
            target_source=targets.target_source,
            breakeven_cac=targets.breakeven_cac,
            breakeven_roas=targets.breakeven_roas,
        ),
        tier2=build_tier2(
            totals, target_cost_per_add_to_cart=targets.target_cost_per_add_to_cart
        ),
        tier3=build_tier3(ads, ad_totals(snapshots), pause_recommendations),
    )


def summarize_business(
    campaigns: Sequence[tuple[str, str | None, str, Sequence[Snapshot]]],
    *,
    is_sample: bool,
) -> BusinessDashboardSummary:
    """The stat strip across every published campaign of a business.

    Each campaign contributes its own latest lifetime totals (never a sum over
    time); the strip adds those across campaigns.

    Args:
        campaigns: (id, name, status, that campaign's snapshots) per campaign.
        is_sample: Whether this is local sample data.
    """
    rows: list[CampaignSummary] = []
    spend = 0.0
    purchases: int | None = None
    revenue: float | None = None
    for campaign_id, name, status, snapshots in campaigns:
        totals = campaign_totals(snapshots)
        if totals is None:
            continue
        rows.append(
            CampaignSummary(
                campaign_id=campaign_id,
                name=name,
                status=status,
                spend=totals.spend,
                purchases=totals.purchases,
            )
        )
        spend += totals.spend
        if totals.purchases is not None:
            purchases = (purchases or 0) + totals.purchases
        if totals.purchase_value is not None:
            revenue = (revenue or 0.0) + totals.purchase_value
    return BusinessDashboardSummary(
        active_campaigns=sum(1 for r in rows if r.status == "LIVE"),
        total_spend=spend,
        purchases=purchases,
        revenue=revenue,
        cost_per_purchase=_ratio(spend, purchases),
        confidence=confidence(
            purchases or 0, MIN_PURCHASES_TO_JUDGE, "purchases", "purchase"
        ),
        campaigns=rows,
        is_sample=is_sample,
    )
