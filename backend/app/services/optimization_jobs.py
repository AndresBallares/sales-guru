"""Scheduled jobs for metrics collection and campaign optimization.

The orchestration layer between APScheduler (app/core/scheduler.py) and
the pure services underneath — app/services/meta.py's raw Graph API
calls and app/services/optimizer.py's agent (prompt building, gate
logic, guardrails). Same "pure service vs. DB-touching orchestration"
split already used for publish (app/services/meta.py vs.
app/services/publish.py).

Three jobs, in-process, no new infrastructure (confirmed with the user
2026-08-09 — see PRD.md build step 10):

- collect_metrics_for_all_live_campaigns: every 15 min, the "Metrics
  Collector" tier. Also runs three deterministic, non-LLM decisions right
  after collection, since they need the same freshly-fetched numbers the
  collection step already has — not "zero decisions" as originally
  scoped; these are hard guardrails, not optimization judgment calls, so
  they stay in the collection job rather than waiting for the hourly
  evaluation cycle below:
  - _enforce_spend_circuit_breaker — a TEST_PLAN's combined spend
    exceeding its fixed total_budget auto-pauses it.
  - _enforce_cac_circuit_breaker — a rolling 3-day CAC (any plan type)
    blowing past 2x the target CAC (the campaign's own product
    economics, or the jewelry benchmark median as a fallback) auto-pauses
    it too, once at least $100 of rolling spend makes the ratio trustworthy.
  - _enforce_daily_spend_flag — a monitoring-only signal (never pauses):
    any AdSet's own last-24h spend exceeding 1.25x its daily budget sets
    Campaign.dailySpendFlag, cleared back to null once it's no longer true.
  Both circuit breakers, when they pause a TEST_PLAN campaign, also call
  _auto_evaluate_after_pause right away (stop_reason
  "TOTAL_SPEND_CIRCUIT_BREAKER"/"CAC_CIRCUIT_BREAKER") — a test's verdict
  gets recorded the moment it stops, not whenever a human next remembers
  to click "Evaluate now."
- evaluate_all_live_campaigns: every 60 min, the "Trigger/Scheduler" +
  "Daily Optimization" tiers collapsed into one job — checks the Event +
  Time + Data Sufficiency gate per campaign, and only actually spends an
  LLM call roughly once every 24h per campaign once that gate passes.
  Running the gate-check hourly (rather than one job every ~6h and a
  separate one every ~24h) keeps both cadences responsive without a
  third scheduled job.
- pause_expired_campaigns: every 60 min, deterministic backstop for a
  campaign's planned end date (Campaign.endDate — a TEST_PLAN's
  duration_days, or an event venue's window) — Meta is sent an end_time
  at publish time (app/services/publish.py) and should stop delivery
  itself, but this catches a campaign published before that parameter
  existed, or in case Meta doesn't actually honor it as documented. Same
  _auto_evaluate_after_pause call as the circuit breakers above
  (stop_reason "TEST_DURATION_ELAPSED") when the expired campaign turns
  out to be a TEST_PLAN.

generate_and_store_recommendation is also called directly by the manual
"generate now" endpoint (app/api/optimization.py) — a user explicitly
requesting analysis bypasses the gate (they're asking right now, on
purpose), but still goes through the same trend-window computation,
guardrail capping, and storage as the scheduled path.

apply_recommendation is the one place that actually pushes a
recommendation's action to Meta — shared by the manual approve endpoint
(app/api/optimization.py) and generate_and_store_recommendation's own
auto-apply path below, so there's a single implementation of "what does
approving this recommendation actually do" regardless of whether a human
clicked Approve or compute_requires_approval decided a click wasn't
needed.
"""

import json
import logging
from datetime import UTC, datetime, timedelta

from prisma.models import (
    AdSet,
    Campaign,
    MetaConnection,
    Metric,
    OptimizationRecommendation,
    TestEvaluation,
)
from prisma.types import MetricCreateInput

from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.schemas.strategy import StrategyContentAdapter, TestPlanContent
from app.schemas.test_evaluation import StopReason
from app.services import optimizer
from app.services.meta import (
    CampaignInsights,
    MetaConnectionError,
    fetch_ad_set_insights,
    fetch_campaign_insights,
    pause_meta_ad,
    update_meta_ad_set_budget,
)
from app.services.publish import pause_campaign

logger = logging.getLogger(__name__)


def _metric_create_data(
    *, campaign_id: str, insights: CampaignInsights, ad_set_id: str | None = None
) -> MetricCreateInput:
    """Build a db.metric.create data dict from one insights fetch.

    ad_set_id is set only for a TEST_PLAN variant's own snapshot
    (PRD.md build step 10, per-AdSet metric collection) — None for the
    pre-existing campaign-level aggregate collection.
    """
    return {
        "campaignId": campaign_id,
        "adSetId": ad_set_id,
        "impressions": insights.impressions,
        "clicks": insights.clicks,
        "spend": insights.spend,
        "conversions": insights.conversions,
        "reach": insights.reach,
        "cpm": insights.cpm,
        "ctr": insights.ctr,
        "cpc": insights.cpc,
        "landingPageViews": insights.landing_page_views,
        "addToCart": insights.add_to_cart,
        "addToCartRate": insights.add_to_cart_rate,
        "conversionRate": insights.conversion_rate,
        "cac": insights.cac,
        "purchaseValue": insights.purchase_value,
        "roas": insights.roas,
        "purchases": insights.purchases,
    }


async def _collect_metrics_for_campaign(campaign: Campaign, access_token: str) -> None:
    """Collect and store this campaign's latest snapshot(s).

    A TEST_PLAN campaign with both real variant AdSets published
    ("Phase C," confirmed 2026-09-02) collects one snapshot per AdSet
    instead of one campaign-level aggregate — each variant's own numbers
    are what the TEST_PLAN evaluator (app/services/optimizer.py's
    evaluate_test_plan) actually needs to compare. Any other campaign
    (DATA_DRIVEN_STRATEGY, or a TEST_PLAN published before Phase C
    existed) keeps the original single campaign-level collection.

    Each AdSet's Meta call is independent — one variant's call failing
    doesn't block the other's from being recorded, same "one bad
    campaign never blocks the batch" reasoning this function's caller
    already applies at the campaign level.
    """
    variant_ad_sets = [
        a
        for a in await db.adset.find_many(where={"campaignId": campaign.id})
        if a.variantId is not None and a.metaAdSetId is not None
    ]
    if len(variant_ad_sets) < 2:
        assert campaign.metaCampaignId is not None  # checked by the caller
        try:
            insights = await fetch_campaign_insights(
                access_token=access_token, meta_campaign_id=campaign.metaCampaignId
            )
        except MetaConnectionError:
            logger.warning("Metrics collection failed for campaign %s", campaign.id)
            return
        await db.metric.create(
            data=_metric_create_data(campaign_id=campaign.id, insights=insights)
        )
        return

    for ad_set in variant_ad_sets:
        assert ad_set.metaAdSetId is not None  # filtered above
        try:
            insights = await fetch_ad_set_insights(
                access_token=access_token, meta_ad_set_id=ad_set.metaAdSetId
            )
        except MetaConnectionError:
            logger.warning(
                "Metrics collection failed for campaign %s adSet %s",
                campaign.id,
                ad_set.id,
            )
            continue
        await db.metric.create(
            data=_metric_create_data(
                campaign_id=campaign.id, insights=insights, ad_set_id=ad_set.id
            )
        )


async def _latest_total_spend(campaign_id: str) -> float:
    """Sum the most recent spend snapshot per AdSet (or the campaign-level one).

    Metric.spend is Meta's own lifetime-to-date figure for whatever
    object it was fetched for (app/services/meta.py's _fetch_insights
    docstring) — never a delta — so the latest row per distinct
    adSetId group already is that group's full spend so far. A TEST_PLAN
    with two real per-variant AdSets ("Phase C") stores one row per
    variant; summing both variants' latest gives the campaign's true
    combined spend. Any other campaign has exactly one group (adSetId
    None, the campaign-level aggregate), so this reduces to that one
    row's own spend.

    Args:
        campaign_id: The campaign to sum.

    Returns:
        Total spend across the latest snapshot of every AdSet (or 0.0 if
        nothing has been collected yet).
    """
    metrics = await db.metric.find_many(
        where={"campaignId": campaign_id}, order={"fetchedAt": "desc"}
    )
    latest_by_group: dict[str | None, Metric] = {}
    for metric in metrics:
        latest_by_group.setdefault(metric.adSetId, metric)
    return sum(metric.spend for metric in latest_by_group.values())


async def _auto_evaluate_after_pause(
    campaign: Campaign, test_plan: TestPlanContent, stop_reason: StopReason
) -> None:
    """Record a TEST_PLAN's verdict right after an auto-pause path stops it.

    Best-effort: an evaluation failure here (OptimizerError, from the LLM
    call for the qualitative half of the evaluation) is logged, not
    raised — the campaign is already safely paused either way, and a
    human can still trigger evaluation manually (app/api/
    test_evaluation.py) if this attempt fails. Skips silently if no
    Metric row exists yet at all (nothing to evaluate).
    """
    has_metrics = await db.metric.find_first(where={"campaignId": campaign.id})
    if has_metrics is None:
        return
    try:
        await generate_and_store_test_evaluation(
            campaign, test_plan, stop_reason=stop_reason
        )
    except optimizer.OptimizerError:
        logger.warning(
            "Auto-evaluation failed for campaign %s (stop_reason=%s)",
            campaign.id,
            stop_reason,
        )


async def _enforce_spend_circuit_breaker(
    campaign: Campaign, connection: MetaConnection
) -> None:
    """Deterministic, non-LLM guardrail: auto-pause a TEST_PLAN that overspent its plan.

    Only TEST_PLAN campaigns have a fixed total_budget to check against
    — a DATA_DRIVEN_STRATEGY has no such ceiling (open-ended by design,
    scaled up/down by its own scaling_trigger instead) and is skipped
    entirely. Never an LLM judgment call, same "backend rules apply
    before/instead of the LLM" principle as apply_budget_guardrail
    (app/services/optimizer.py) — this doesn't even involve the
    Optimizer Agent.

    Args:
        campaign: The live campaign to check. Caller has already
            confirmed it's LIVE and Meta-connected.
        connection: The business's Meta connection, for the actual pause
            call if the breaker fires.

    Raises:
        MetaConnectionError: If pausing fails partway through — same
            "already-paused AdSets stay paused, no rollback" behavior as
            pause_campaign itself.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        return
    content = StrategyContentAdapter.validate_json(strategy.content)
    if content.plan_type != "TEST_PLAN":
        return

    total_spend = await _latest_total_spend(campaign.id)
    if total_spend <= content.total_budget:
        return

    logger.warning(
        "Circuit breaker: campaign %s spent $%.2f, exceeding its $%.2f planned budget",
        campaign.id,
        total_spend,
        content.total_budget,
    )
    paused = await pause_campaign(
        campaign=campaign,
        connection=connection,
        reason=(
            f"Total spend ${total_spend:,.2f} exceeded the "
            f"${content.total_budget:,.2f} planned budget"
        ),
    )
    await _auto_evaluate_after_pause(paused, content, "TOTAL_SPEND_CIRCUIT_BREAKER")


async def _grouped_metrics(campaign_id: str) -> dict[str | None, list[Metric]]:
    """Every Metric snapshot for a campaign, grouped by adSetId.

    None is the group key for the campaign-level aggregate stream.
    """
    metrics = await db.metric.find_many(where={"campaignId": campaign_id})
    groups: dict[str | None, list[Metric]] = {}
    for metric in metrics:
        groups.setdefault(metric.adSetId, []).append(metric)
    return groups


_MIN_ROLLING_SPEND_FOR_CAC_CHECK = 100.0
_CAC_OVERSPEND_MULTIPLE = 2.0
_ROLLING_CAC_WINDOW = timedelta(days=3)


async def _rolling_spend_and_purchases(
    campaign_id: str, window: timedelta, *, now: datetime | None = None
) -> tuple[float, int] | None:
    """Combined (delta_spend, delta_purchases) over `window`, summed across every group.

    Each AdSet group (or the single campaign-level group, adSetId None)
    is deltaed independently against its own snapshot nearest `window`
    ago, then summed — same "one variant's own trend, summed for a
    campaign-wide total" reasoning as _latest_total_spend, just windowed
    instead of lifetime-to-date.

    Args:
        campaign_id: The campaign to check.
        window: How far back to look (e.g. 3 days for the CAC breaker).
        now: Injectable for tests; defaults to the real current time.

    Returns:
        None if no group has any snapshot old enough for a real window
        yet (not "zero spend" — genuinely not enough history to trust).
    """
    now = now or datetime.now(UTC)
    cutoff = now - window
    groups = await _grouped_metrics(campaign_id)
    total_spend = 0.0
    total_purchases = 0
    any_window = False
    for group_metrics in groups.values():
        latest = max(group_metrics, key=lambda m: m.fetchedAt)
        baseline = optimizer.nearest_metric_at_or_before(group_metrics, cutoff)
        if baseline is None or baseline.id == latest.id:
            continue
        any_window = True
        total_spend += latest.spend - baseline.spend
        total_purchases += (latest.purchases or 0) - (baseline.purchases or 0)
    return (total_spend, total_purchases) if any_window else None


async def _enforce_cac_circuit_breaker(
    campaign: Campaign, connection: MetaConnection
) -> None:
    """Deterministic, non-LLM guardrail: auto-pause a campaign with a blown-up CAC.

    Complements _enforce_spend_circuit_breaker (a fixed total budget, TEST_PLAN
    only) with an efficiency check that applies to any live campaign,
    either plan type — target_cac is a product-level concept, not a
    TEST_PLAN-specific one. Never an LLM judgment call, same "backend
    rules apply before/instead of the LLM" principle throughout this
    build.

    Args:
        campaign: The live campaign to check. Caller has already
            confirmed it's LIVE and Meta-connected.
        connection: The business's Meta connection, for the actual pause
            call if the breaker fires.

    Raises:
        MetaConnectionError: If pausing fails partway through.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        return
    content = StrategyContentAdapter.validate_json(strategy.content)
    target_cac = optimizer.resolve_target_cac(content.unit_economics)

    window = await _rolling_spend_and_purchases(campaign.id, _ROLLING_CAC_WINDOW)
    if window is None:
        return
    delta_spend, delta_purchases = window
    if delta_spend < _MIN_ROLLING_SPEND_FOR_CAC_CHECK:
        return

    if delta_purchases > 0:
        rolling_cac = delta_spend / delta_purchases
        if rolling_cac <= target_cac * _CAC_OVERSPEND_MULTIPLE:
            return
        reason = (
            f"Rolling 3-day CAC ${rolling_cac:,.2f} exceeded "
            f"{_CAC_OVERSPEND_MULTIPLE:g}x the ${target_cac:,.2f} target "
            f"(${delta_spend:,.2f} spent for {delta_purchases} purchases)"
        )
    else:
        # Real spend, zero purchases over the whole window — worse than
        # any finite CAC ratio, not silently skipped as "can't compute."
        reason = (
            f"${delta_spend:,.2f} spent over the last 3 days with zero "
            f"purchases (target CAC ${target_cac:,.2f})"
        )

    logger.warning("CAC circuit breaker: campaign %s — %s", campaign.id, reason)
    paused = await pause_campaign(
        campaign=campaign, connection=connection, reason=reason
    )
    if content.plan_type == "TEST_PLAN":
        await _auto_evaluate_after_pause(paused, content, "CAC_CIRCUIT_BREAKER")


_DAILY_OVERSPEND_MULTIPLE = 1.25
_DAILY_SPEND_WINDOW = timedelta(days=1)


def _real_ad_set_group_key(ad_set: AdSet, real_ad_set_count: int) -> str | None:
    """The Metric.adSetId this AdSet's own snapshots are actually tagged with.

    Per-AdSet collection (Phase C) tags rows with the AdSet's own id only
    once a campaign has 2+ real variant AdSets (_collect_metrics_for_campaign);
    a campaign with exactly one real AdSet still collects at the
    campaign level (adSetId None) — same fallback that function uses,
    mirrored here so this AdSet's own daily spend can be found at all.
    """
    return ad_set.id if real_ad_set_count >= 2 else None


async def _enforce_daily_spend_flag(campaign: Campaign) -> None:
    """Deterministic monitoring signal — never pauses, just flags.

    Meta's own daily-budget pacing can overspend up to ~25% on a given
    day, evened out across a calendar week (Meta's own documented
    policy) — a single day over that isn't itself cause to stop the
    campaign, just to surface. Refreshed every cycle: set (or updated)
    while any AdSet's own last-24h spend exceeds 1.25x its configured
    daily budget, cleared back to null once none do — so this always
    reflects current state, not a one-time stuck alert.

    Args:
        campaign: The live campaign to check.
    """
    ad_sets = await db.adset.find_many(where={"campaignId": campaign.id})
    real_ad_sets = [a for a in ad_sets if a.metaAdSetId is not None]
    groups = await _grouped_metrics(campaign.id)
    cutoff = datetime.now(UTC) - _DAILY_SPEND_WINDOW

    overspending: list[str] = []
    for ad_set in real_ad_sets:
        group_metrics = groups.get(
            _real_ad_set_group_key(ad_set, len(real_ad_sets)), []
        )
        if not group_metrics:
            continue
        latest = max(group_metrics, key=lambda m: m.fetchedAt)
        baseline = optimizer.nearest_metric_at_or_before(group_metrics, cutoff)
        if baseline is None or baseline.id == latest.id:
            continue
        delta_spend = latest.spend - baseline.spend
        if delta_spend > ad_set.budget * _DAILY_OVERSPEND_MULTIPLE:
            overspending.append(
                f"{ad_set.name}: ${delta_spend:,.2f} vs "
                f"${ad_set.budget:,.2f}/day budget"
            )

    flag = (
        "Daily spend above 1.25x budget — " + "; ".join(overspending)
        if overspending
        else None
    )
    if flag != campaign.dailySpendFlag:
        await db.campaign.update(
            where={"id": campaign.id}, data={"dailySpendFlag": flag}
        )


async def collect_metrics_for_all_live_campaigns() -> None:
    """Collect fresh metrics, then run the deterministic spend guardrails.

    Skips (logs, doesn't raise) any campaign whose Meta call fails, so
    one bad campaign never blocks the rest of the batch — unlike the
    manual "Refresh results" endpoint (app/api/metric.py), which is
    user-triggered and should surface a failure immediately instead of
    silently skipping. The guardrail checks still run even when this
    cycle's own fetch failed — they compare against whatever's already
    stored, since a prior cycle's numbers crossing a threshold is still
    valid grounds to act.

    A LIVE campaign's business can never actually be soft-deleted
    (DELETE /businesses/{id} 409s while any campaign is LIVE) — the
    `business.is.deletedAt: None` filter below is a defensive backstop
    for that invariant, not something reachable in normal operation.
    """
    campaigns = await db.campaign.find_many(
        where={"status": "LIVE", "business": {"is": {"deletedAt": None}}}
    )
    for campaign in campaigns:
        if campaign.metaCampaignId is None:
            continue
        connection = await get_meta_connection(campaign.businessId)
        if connection is None:
            continue
        await _collect_metrics_for_campaign(campaign, connection.accessToken)
        try:
            await _enforce_spend_circuit_breaker(campaign, connection)
            # Re-fetch: the total-spend breaker above may have just paused
            # it, and the CAC breaker/daily flag below have no business
            # running against a campaign that's no longer LIVE (a second
            # breaker firing on the same stale in-memory `campaign` would
            # otherwise re-pause an already-paused campaign and overwrite
            # its real pausedReason).
            current = await db.campaign.find_unique(where={"id": campaign.id})
            if current is not None and current.status == "LIVE":
                await _enforce_cac_circuit_breaker(current, connection)
                await _enforce_daily_spend_flag(current)
        except MetaConnectionError:
            logger.warning("Circuit breaker pause failed for campaign %s", campaign.id)


async def apply_recommendation(
    recommendation: OptimizationRecommendation,
) -> OptimizationRecommendation:
    """Push a recommendation's action to Meta, mirror it locally, and mark it APPLIED.

    The one place that actually calls Meta for a recommendation — used
    both by a human's explicit Approve click and by
    generate_and_store_recommendation's auto-apply path, so there's a
    single implementation of what "applying" a recommendation means.

    Args:
        recommendation: The recommendation to apply. Caller is
            responsible for confirming it's still PENDING.

    Returns:
        The now-APPLIED recommendation.

    Raises:
        MetaConnectionError: If the Graph API call fails.
    """
    campaign = await db.campaign.find_unique(where={"id": recommendation.campaignId})
    assert campaign is not None  # guaranteed by the FK, not user input
    connection = await get_meta_connection(campaign.businessId)
    assert connection is not None  # guaranteed by LIVE status (publish requires it)
    ad_set = await db.adset.find_first(where={"campaignId": campaign.id})
    assert ad_set is not None  # guaranteed by LIVE status (publish creates it)

    if recommendation.actionType == "PAUSE_AD":
        assert recommendation.targetAdId is not None
        ad = await db.ad.find_unique(where={"id": recommendation.targetAdId})
        assert ad is not None and ad.metaAdId is not None
        await pause_meta_ad(access_token=connection.accessToken, meta_ad_id=ad.metaAdId)
        await db.ad.update(where={"id": ad.id}, data={"status": "PAUSED"})
    else:
        assert (
            recommendation.suggestedBudget is not None
            and ad_set.metaAdSetId is not None
        )
        await update_meta_ad_set_budget(
            access_token=connection.accessToken,
            meta_ad_set_id=ad_set.metaAdSetId,
            daily_budget_cents=round(recommendation.suggestedBudget * 100),
        )
        await db.adset.update(
            where={"id": ad_set.id}, data={"budget": recommendation.suggestedBudget}
        )

    updated = await db.optimizationrecommendation.update(
        where={"id": recommendation.id}, data={"status": "APPLIED"}
    )
    assert updated is not None  # just fetched by the caller, can't vanish mid-request
    return updated


async def generate_and_store_recommendation(
    campaign: Campaign,
) -> OptimizationRecommendation | None:
    """Build trend windows, call the agent, and store its recommendation.

    Args:
        campaign: The live campaign to evaluate. Caller is responsible
            for confirming it's LIVE and has at least one Metric row.

    Returns:
        The newly stored recommendation — already APPLIED if
        compute_requires_approval decided it didn't need a human click
        and applying it to Meta succeeded, PENDING otherwise (including
        when auto-apply itself failed, see below). Returns None if there
        isn't enough historical spread yet to compute even a single
        trend window (e.g. a campaign whose only Metric snapshot was
        just taken minutes ago has no 24h-old baseline to diff against)
        — safer to wait for real history than reason over a fabricated
        "trend" of one point.

    Raises:
        optimizer.OptimizerError: If the LLM call fails.
    """
    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    ad_set = await db.adset.find_first(where={"campaignId": campaign.id})
    assert ad_set is not None  # guaranteed by LIVE status (publish creates it)

    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )

    metrics = await db.metric.find_many(where={"campaignId": campaign.id})
    windows = optimizer.compute_trend_windows(
        metrics, product.price if product else None
    )
    if not windows:
        return None

    result = await optimizer.generate_recommendation(
        business=business, campaign=campaign, ad_set=ad_set, windows=windows
    )
    generated = result.recommendation

    await db.optimizationrecommendation.update_many(
        where={"campaignId": campaign.id, "status": "PENDING"},
        data={"status": "SUPERSEDED"},
    )

    target_ad_id = None
    if generated.action_type == "PAUSE_AD":
        ad = await db.ad.find_first(where={"adSetId": ad_set.id})
        assert ad is not None  # guaranteed by LIVE status (publish creates it)
        target_ad_id = ad.id

    requires_approval = optimizer.compute_requires_approval(
        action_type=generated.action_type,
        risk=generated.risk,
        confidence=generated.confidence,
        capped_by_guardrail=result.capped_by_guardrail,
    )

    created = await db.optimizationrecommendation.create(
        data={
            "campaignId": campaign.id,
            "actionType": generated.action_type,
            "targetAdId": target_ad_id,
            "currentBudget": ad_set.budget,
            "suggestedBudget": generated.suggested_budget,
            "reasoning": generated.reasoning,
            "confidence": generated.confidence,
            "risk": generated.risk,
            "requiresApproval": requires_approval,
        }
    )

    if not requires_approval:
        try:
            created = await apply_recommendation(created)
        except MetaConnectionError:
            # Auto-apply itself failing (expired token, transient Graph
            # API error, ...) shouldn't lose the recommendation — fall
            # back to requiring a human click rather than leaving it
            # silently un-applied with requiresApproval still False.
            logger.warning(
                "Auto-apply failed for recommendation %s — leaving for manual approval",
                created.id,
            )
            fallback = await db.optimizationrecommendation.update(
                where={"id": created.id}, data={"requiresApproval": True}
            )
            assert fallback is not None
            created = fallback

    return created


async def _evaluate_campaign(campaign: Campaign) -> None:
    """Gate-check one live campaign, deep-analyzing it if it's due.

    Skips TEST_PLAN campaigns: they're evaluated by
    generate_and_store_test_evaluation instead (not yet wired into this
    scheduled job — a deliberate Phase B scoping choice, see
    app/api/test_evaluation.py). The general recommender below assumes
    one AdSet per campaign, which doesn't hold once a TEST_PLAN's two
    audience variants are both published (Phase C) — skip rather than
    generate a recommendation against an arbitrary one of the two.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    assert strategy is not None  # guaranteed by LIVE status (publish requires it)
    if StrategyContentAdapter.validate_json(strategy.content).plan_type == "TEST_PLAN":
        return

    metrics = await db.metric.find_many(where={"campaignId": campaign.id})
    if not metrics:
        return

    now = datetime.now(UTC)
    hours_since_last_check = (
        float("inf")
        if campaign.lastOptimizationCheckAt is None
        else (now - campaign.lastOptimizationCheckAt).total_seconds() / 3600
    )
    earliest = min(metrics, key=lambda m: m.fetchedAt)
    latest = max(metrics, key=lambda m: m.fetchedAt)
    baseline = optimizer.nearest_metric_at_or_before(
        metrics, campaign.lastOptimizationCheckAt or earliest.fetchedAt
    )
    baseline = baseline or earliest
    delta_spend = latest.spend - baseline.spend
    delta_clicks = latest.clicks - baseline.clicks

    # Recorded regardless of outcome — this is what lets the next run's
    # "hours since last check" mean something even when this run WAITs.
    await db.campaign.update(
        where={"id": campaign.id}, data={"lastOptimizationCheckAt": now}
    )

    if not optimizer.has_sufficient_data(
        hours_since_last_check=hours_since_last_check,
        delta_spend=delta_spend,
        delta_clicks=delta_clicks,
    ):
        return

    latest_recommendation = await db.optimizationrecommendation.find_first(
        where={"campaignId": campaign.id}, order={"createdAt": "desc"}
    )
    if latest_recommendation is not None:
        hours_since_last_recommendation = (
            now - latest_recommendation.createdAt
        ).total_seconds() / 3600
        if (
            hours_since_last_recommendation
            < optimizer.MIN_HOURS_BETWEEN_RECOMMENDATIONS
        ):
            return

    await generate_and_store_recommendation(campaign)


async def evaluate_all_live_campaigns() -> None:
    """Gate-checked, ~daily deep optimization for every live campaign.

    Each campaign is evaluated independently; one campaign's LLM failure
    doesn't block the others in the same run.

    Same defensive `business.is.deletedAt: None` backstop as
    collect_metrics_for_all_live_campaigns above — see its docstring.
    """
    campaigns = await db.campaign.find_many(
        where={"status": "LIVE", "business": {"is": {"deletedAt": None}}}
    )
    for campaign in campaigns:
        try:
            await _evaluate_campaign(campaign)
        except optimizer.OptimizerError:
            logger.warning(
                "Optimization evaluation failed for campaign %s", campaign.id
            )


async def pause_expired_campaigns() -> None:
    """Auto-pause every live campaign whose planned end date has passed.

    Deterministic backstop for Campaign.endDate — Meta is sent an
    end_time at publish time (app/services/publish.py's
    publish_campaign_to_meta) and should stop delivery on its own, but
    this catches a campaign published before that parameter existed, or
    in case Meta doesn't actually honor it as documented (not yet
    verified against a real live publish). Applies to any campaign with
    an endDate in the past regardless of plan type — a TEST_PLAN's
    computed duration_days window and an event venue's explicit window
    (PRD.md build step 11) both set Campaign.endDate the same way, so
    one check covers both. A DATA_DRIVEN_STRATEGY with no event venue
    has no endDate at all and is never touched by this job.

    One campaign's Meta failure doesn't block the rest of the batch,
    same "skip and log" pattern as collect_metrics_for_all_live_campaigns.

    Same defensive `business.is.deletedAt: None` backstop as
    collect_metrics_for_all_live_campaigns above — see its docstring.
    """
    now = datetime.now(UTC)
    campaigns = await db.campaign.find_many(
        where={
            "status": "LIVE",
            "endDate": {"lt": now},
            "business": {"is": {"deletedAt": None}},
        }
    )
    for campaign in campaigns:
        connection = await get_meta_connection(campaign.businessId)
        if connection is None:
            continue
        try:
            paused = await pause_campaign(
                campaign=campaign,
                connection=connection,
                reason="Planned end date reached",
            )
        except MetaConnectionError:
            logger.warning(
                "Duration-elapsed auto-pause failed for campaign %s", campaign.id
            )
            continue

        strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
        if strategy is None:
            continue
        content = StrategyContentAdapter.validate_json(strategy.content)
        if content.plan_type == "TEST_PLAN":
            await _auto_evaluate_after_pause(paused, content, "TEST_DURATION_ELAPSED")


async def _variant_ad_sets(campaign_id: str) -> tuple[str | None, str | None]:
    """A TEST_PLAN campaign's real AdSet ids, by variant.

    Returns:
        (broad_baseline_ad_set_id, hypothesis_audience_ad_set_id) — either
        (or both) is None when that variant hasn't been published as its
        own real AdSet yet (any campaign published before "Phase C"
        existed, PRD.md build step 5, confirmed 2026-09-02).
    """
    ad_sets = await db.adset.find_many(where={"campaignId": campaign_id})
    by_variant = {a.variantId: a.id for a in ad_sets if a.variantId is not None}
    return by_variant.get("broad_baseline"), by_variant.get("hypothesis_audience")


def _insufficient_data_reasoning(
    *, test_plan: TestPlanContent, spend_fraction: float, duration_fraction: float
) -> str:
    """Explain why the data-sufficiency gate hasn't passed yet."""
    return (
        f"Only {spend_fraction:.0%} of the ${test_plan.total_budget:.2f} "
        f"test budget and {duration_fraction:.0%} of its "
        f"{test_plan.duration_days}-day duration have elapsed — not "
        f"enough data yet for a reliable read."
    )


async def generate_and_store_test_evaluation(
    campaign: Campaign,
    test_plan: TestPlanContent,
    *,
    stop_reason: StopReason = "MANUAL",
) -> TestEvaluation:
    """Evaluate a TEST_PLAN campaign against its real Metric history, and store it.

    Called both by a human's manual "evaluate now" (app/api/
    test_evaluation.py, stop_reason defaults to "MANUAL") and
    automatically, right after either of the two auto-pause paths stops a
    TEST_PLAN campaign (pause_expired_campaigns and the CAC/spend circuit
    breakers below, each passing their own stop_reason) — a paused test
    should have its verdict recorded without a human needing to remember
    to click evaluate.

    Once both of the TEST_PLAN's real AdSets (PRD.md build step 5 "Phase
    C") have collected their own per-variant Metric snapshots (step 10's
    per-AdSet collection, confirmed 2026-09-02), this compares them for
    real — winning_variant/hypothesis_result become non-null/non-
    "INCONCLUSIVE" once both have enough conversion volume
    (optimizer.compute_test_result), and confidence becomes a real
    deterministic read of that same sample size
    (optimizer.compute_test_confidence). Any campaign missing either
    piece (published before "Phase C", or per-variant collection just
    hasn't run yet) falls back to the original single-metric-pool
    behavior, confidence fixed at "LOW" since no real variant comparison
    is possible at all.

    Args:
        campaign: The live campaign to evaluate. Caller is responsible
            for confirming it's LIVE, has a TEST_PLAN strategy, and has
            at least one Metric row.
        test_plan: The campaign's parsed TEST_PLAN.
        stop_reason: Why this evaluation is running — a human's manual
            click, or which auto-pause path triggered it.

    Returns:
        The newly stored evaluation — always created, even when the
        data-sufficiency gate fails. An "INSUFFICIENT_DATA" evaluation is
        itself a meaningful, storable result (per the product
        requirement to say so explicitly), not an error — unlike
        generate_and_store_recommendation's "return None" when there's
        no trend window to reason over at all.

    Raises:
        optimizer.OptimizerError: If the LLM call fails (only reached
            once the sufficiency gate passes).
    """
    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    metrics = await db.metric.find_many(where={"campaignId": campaign.id})
    # Campaign has no dedicated "went live at" column — the earliest
    # Metric snapshot is a reasonable proxy, since collection starts
    # shortly after publish (see collect_metrics_for_all_live_campaigns).
    campaign_live_since = min(metrics, key=lambda m: m.fetchedAt).fetchedAt

    baseline_ad_set_id, hypothesis_ad_set_id = await _variant_ad_sets(campaign.id)
    baseline_variant_metrics = (
        [m for m in metrics if m.adSetId == baseline_ad_set_id]
        if baseline_ad_set_id
        else []
    )
    hypothesis_variant_metrics = (
        [m for m in metrics if m.adSetId == hypothesis_ad_set_id]
        if hypothesis_ad_set_id
        else []
    )

    hypothesis_metric: Metric | None = None
    if baseline_variant_metrics and hypothesis_variant_metrics:
        # Real two-variant path — both AdSets have their own data.
        latest = max(baseline_variant_metrics, key=lambda m: m.fetchedAt)
        hypothesis_metric = max(hypothesis_variant_metrics, key=lambda m: m.fetchedAt)
        sufficient = optimizer.has_sufficient_test_data_for_variants(
            test_plan=test_plan,
            baseline_metric=latest,
            hypothesis_metric=hypothesis_metric,
            campaign_live_since=campaign_live_since,
        )
        variant_budget = test_plan.daily_budget * test_plan.duration_days
        spend_fraction = min(
            latest.spend / variant_budget if variant_budget else 0.0,
            hypothesis_metric.spend / variant_budget if variant_budget else 0.0,
        )
    else:
        # Fallback: pre-"Phase C" campaign, or per-variant collection
        # hasn't produced data yet — treat the whole pool as one signal,
        # same behavior as before per-AdSet collection existed.
        latest = max(metrics, key=lambda m: m.fetchedAt)
        sufficient = optimizer.has_sufficient_test_data(
            test_plan=test_plan,
            latest_metric=latest,
            campaign_live_since=campaign_live_since,
        )
        spend_fraction = (
            latest.spend / test_plan.total_budget if test_plan.total_budget else 0.0
        )

    if not sufficient:
        hours_elapsed = (datetime.now(UTC) - campaign_live_since).total_seconds() / 3600
        duration_fraction = (
            hours_elapsed / (test_plan.duration_days * 24)
            if test_plan.duration_days
            else 0.0
        )
        return await db.testevaluation.create(
            data={
                "campaignId": campaign.id,
                "status": "INSUFFICIENT_DATA",
                "winningVariant": None,
                "confidence": "LOW",
                "hypothesisResult": "INCONCLUSIVE",
                "keyFindings": json.dumps([]),
                "recommendedAction": "continue_testing",
                "reasoning": _insufficient_data_reasoning(
                    test_plan=test_plan,
                    spend_fraction=spend_fraction,
                    duration_fraction=duration_fraction,
                ),
                "stopReason": stop_reason,
            }
        )

    generated = await optimizer.evaluate_test_plan(
        business=business,
        campaign=campaign,
        test_plan=test_plan,
        latest_metric=latest,
        hypothesis_metric=hypothesis_metric,
    )

    winning_variant: str | None = None
    hypothesis_result = "INCONCLUSIVE"
    recommended_action: str = generated.recommended_action
    confidence: str = "LOW"
    if hypothesis_metric is not None:
        winning_variant, hypothesis_result = optimizer.compute_test_result(
            baseline_metric=latest, hypothesis_metric=hypothesis_metric
        )
        if winning_variant == "hypothesis_audience":
            recommended_action = "prefer_hypothesis"
        elif winning_variant == "broad_baseline":
            recommended_action = "prefer_broad"
        confidence = optimizer.compute_test_confidence(
            baseline_metric=latest,
            hypothesis_metric=hypothesis_metric,
            target_cac=optimizer.resolve_target_cac(test_plan.unit_economics),
        )

    return await db.testevaluation.create(
        data={
            "campaignId": campaign.id,
            "status": "SUFFICIENT_DATA",
            "winningVariant": winning_variant,
            "confidence": confidence,
            "hypothesisResult": hypothesis_result,
            "keyFindings": json.dumps(generated.key_findings),
            "recommendedAction": recommended_action,
            "reasoning": generated.reasoning,
            "stopReason": stop_reason,
        }
    )
