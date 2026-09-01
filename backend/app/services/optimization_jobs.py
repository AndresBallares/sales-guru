"""Scheduled jobs for metrics collection and campaign optimization.

The orchestration layer between APScheduler (app/core/scheduler.py) and
the pure services underneath — app/services/meta.py's raw Graph API
calls and app/services/optimizer.py's agent (prompt building, gate
logic, guardrails). Same "pure service vs. DB-touching orchestration"
split already used for publish (app/services/meta.py vs.
app/services/publish.py).

Two jobs, in-process, no new infrastructure (confirmed with the user
2026-08-09 — see PRD.md build step 10):

- collect_metrics_for_all_live_campaigns: every 15 min, pure collection,
  the "Metrics Collector" tier. Makes zero decisions.
- evaluate_all_live_campaigns: every 60 min, the "Trigger/Scheduler" +
  "Daily Optimization" tiers collapsed into one job — checks the Event +
  Time + Data Sufficiency gate per campaign, and only actually spends an
  LLM call roughly once every 24h per campaign once that gate passes.
  Running the gate-check hourly (rather than one job every ~6h and a
  separate one every ~24h) keeps both cadences responsive without a
  third scheduled job.

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
from datetime import UTC, datetime

from prisma.models import Campaign, Metric, OptimizationRecommendation, TestEvaluation
from prisma.types import MetricCreateInput

from app.core.db import db
from app.schemas.strategy import StrategyContentAdapter, TestPlanContent
from app.services import optimizer
from app.services.meta import (
    CampaignInsights,
    MetaConnectionError,
    fetch_ad_set_insights,
    fetch_campaign_insights,
    pause_meta_ad,
    update_meta_ad_set_budget,
)

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


async def collect_metrics_for_all_live_campaigns() -> None:
    """Pure collection for every live, Meta-connected campaign.

    Skips (logs, doesn't raise) any campaign whose Meta call fails, so
    one bad campaign never blocks the rest of the batch — unlike the
    manual "Refresh results" endpoint (app/api/metric.py), which is
    user-triggered and should surface a failure immediately instead of
    silently skipping.
    """
    campaigns = await db.campaign.find_many(where={"status": "LIVE"})
    for campaign in campaigns:
        if campaign.metaCampaignId is None:
            continue
        connection = await db.metaconnection.find_unique(
            where={"businessId": campaign.businessId}
        )
        if connection is None:
            continue
        await _collect_metrics_for_campaign(campaign, connection.accessToken)


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
    connection = await db.metaconnection.find_unique(
        where={"businessId": campaign.businessId}
    )
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
    """
    campaigns = await db.campaign.find_many(where={"status": "LIVE"})
    for campaign in campaigns:
        try:
            await _evaluate_campaign(campaign)
        except optimizer.OptimizerError:
            logger.warning(
                "Optimization evaluation failed for campaign %s", campaign.id
            )


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
    campaign: Campaign, test_plan: TestPlanContent
) -> TestEvaluation:
    """Evaluate a TEST_PLAN campaign against its real Metric history, and store it.

    Manual "evaluate now" only today (app/api/test_evaluation.py) — not
    yet wired into the scheduler alongside evaluate_all_live_campaigns
    above (a deliberate scoping choice for "Phase B," confirmed
    2026-09-01, kept separate so this addition stays reviewable).

    Once both of the TEST_PLAN's real AdSets (PRD.md build step 5 "Phase
    C") have collected their own per-variant Metric snapshots (step 10's
    per-AdSet collection, confirmed 2026-09-02), this compares them for
    real — winning_variant/hypothesis_result become non-null/non-
    "INCONCLUSIVE" once both have enough conversion volume
    (optimizer.compute_test_result). Any campaign missing either piece
    (published before "Phase C", or per-variant collection just hasn't
    run yet) falls back to the original single-metric-pool behavior,
    unchanged.

    Args:
        campaign: The live campaign to evaluate. Caller is responsible
            for confirming it's LIVE, has a TEST_PLAN strategy, and has
            at least one Metric row.
        test_plan: The campaign's parsed TEST_PLAN.

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
    if hypothesis_metric is not None:
        winning_variant, hypothesis_result = optimizer.compute_test_result(
            baseline_metric=latest, hypothesis_metric=hypothesis_metric
        )
        if winning_variant == "hypothesis_audience":
            recommended_action = "prefer_hypothesis"
        elif winning_variant == "broad_baseline":
            recommended_action = "prefer_broad"

    return await db.testevaluation.create(
        data={
            "campaignId": campaign.id,
            "status": "SUFFICIENT_DATA",
            "winningVariant": winning_variant,
            "confidence": generated.confidence,
            "hypothesisResult": hypothesis_result,
            "keyFindings": json.dumps(generated.key_findings),
            "recommendedAction": recommended_action,
            "reasoning": generated.reasoning,
        }
    )
