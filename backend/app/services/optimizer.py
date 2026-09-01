"""Campaign Optimization Agent (PRD.md build step 10).

Meta -> Campaign Metrics -> Optimization Agent -> {CTR, CPC, CPM, CPL,
ROAS, Conversion Rate} -> Recommendation.

This module is the pure agent: gate logic (has_sufficient_data), trend
computation (compute_trend_windows), the LLM call itself, and the budget
guardrail cap. It never touches the database — orchestrating it against
real campaigns (fetching Metric history, deciding which live campaigns
are due, writing OptimizationRecommendation rows) lives in
app/services/optimization_jobs.py, same "pure agent vs. DB-touching
orchestration" split already used for publish (app/services/meta.py's
Graph API calls vs. app/services/publish.py's orchestration).

The agent doesn't reason over raw impressions/clicks/spend/conversions
directly — _derive_metrics turns each window into six ratios first (same
"compute the real signal, don't make the LLM guess at arithmetic"
reasoning as StrategyContent's budget being a number the LLM outputs, not
something app code re-derives from vague terms). Trend windows (24h / 3d
/ 7d deltas, not raw lifetime-to-date cumulative totals) are what the
deep, ~daily analysis actually reasons over — see compute_trend_windows.

Same forced-tool-use approach as the Marketing Strategist Agent
(app/services/strategist.py) for guaranteed-structured output. This
agent never calls Meta itself — it only decides what to recommend and,
via compute_requires_approval, whether that recommendation is trusted
enough to apply on its own. A LOW-risk, high-confidence budget nudge can
auto-apply (confirmed with the user 2026-08-09); everything else still
waits for an explicit human approval click (app/api/optimization.py) or
the scheduled job's own auto-apply path (app/services/optimization_jobs.py).
"""

from datetime import UTC, datetime, timedelta
from typing import NamedTuple

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import AdSet, Business, Campaign, Metric

from app.core.config import get_settings
from app.schemas.optimization import GeneratedRecommendation
from app.schemas.strategy import SuccessCriterion, TestPlanContent
from app.schemas.test_evaluation import GeneratedTestEvaluation
from app.services.benchmarks import classify_performance_zone

_MODEL = "claude-sonnet-5"
_MAX_TOKENS = 1024
_TOOL_NAME = "submit_recommendation"
_TEST_EVALUATION_TOOL_NAME = "submit_test_evaluation"

# Event + Time + Data Sufficiency gate (PRD.md build step 10) — all three
# must hold before the scheduled job spends an LLM call on a campaign.
# Deliberately conservative defaults; not user-configurable yet (no UI
# asked for this), so they're plain module constants for now.
MIN_HOURS_BETWEEN_CHECKS = 6.0
MIN_SPEND_TO_ANALYZE = 20.0
MIN_CLICKS_TO_ANALYZE = 30

# Only run the LLM-driven deep analysis roughly once a day per campaign
# even if the lightweight gate above passes more often than that.
MIN_HOURS_BETWEEN_RECOMMENDATIONS = 24.0

# "Maximum automatic budget increase = 20%" — the user's own guardrail
# example. Applied symmetrically to decreases too (never propose cutting
# more than 20% at once, same reasoning: bound the blast radius of any
# single recommendation regardless of direction).
MAX_BUDGET_CHANGE_FRACTION = 0.20

# Auto-apply tiering (confirmed with the user 2026-08-09): LOW risk +
# confidence at or above this threshold, on a budget action that wasn't
# capped by the guardrail above, applies to Meta immediately with no
# human click. Everything else — MEDIUM/HIGH risk, low confidence,
# PAUSE_AD, or a suggestion the guardrail had to rein in — still requires
# the checkpoint. See compute_requires_approval.
AUTO_APPLY_CONFIDENCE_THRESHOLD = 0.90

# Auto-apply is scoped to budget nudges only — PAUSE_AD always requires
# approval, since stopping an ad's delivery is a harder action to walk
# back cheaply than a budget change that's already guardrail-capped.
_AUTO_APPLY_ELIGIBLE_ACTIONS = frozenset({"INCREASE_BUDGET", "DECREASE_BUDGET"})

_TREND_WINDOWS = (
    ("24h", timedelta(hours=24)),
    ("3d", timedelta(days=3)),
    ("7d", timedelta(days=7)),
)


class OptimizerError(RuntimeError):
    """Raised when the Optimization Agent fails to produce a recommendation."""


class DerivedMetrics(NamedTuple):
    """The ratios the agent actually reasons over, not raw counts.

    Any ratio is None when its denominator is zero (e.g. CTR with no
    impressions yet) — reported to the model as "n/a", never as 0 or a
    divide-by-zero crash. roas is None whenever there's no product price
    to approximate revenue from (see _derive_metrics).
    """

    ctr: float | None
    cpc: float | None
    cpm: float | None
    cpl: float | None
    roas: float | None
    conversion_rate: float | None


class TrendWindow(NamedTuple):
    """One comparison window (24h/3d/7d) — the delta over that period, derived."""

    label: str
    impressions: int
    clicks: int
    spend: float
    conversions: int
    derived: DerivedMetrics


class RecommendationResult(NamedTuple):
    """generate_recommendation's return: the recommendation plus guardrail metadata.

    capped_by_guardrail is kept out of GeneratedRecommendation itself
    (rather than added as a field there) because that schema also doubles
    as the forced tool-use input_schema handed to Claude — adding a field
    the model shouldn't be asked to fill in would leak into what we're
    asking it to submit. It's computed here, after the fact, and fed to
    compute_requires_approval instead.
    """

    recommendation: GeneratedRecommendation
    capped_by_guardrail: bool


def _derive_metrics(
    *,
    impressions: int,
    clicks: int,
    spend: float,
    conversions: int,
    product_price: float | None,
) -> DerivedMetrics:
    """Compute CTR/CPC/CPM/CPL/ROAS/conversion rate from raw counts.

    Args:
        impressions: Impressions over the period being evaluated.
        clicks: Clicks over the period being evaluated.
        spend: Spend over the period being evaluated.
        conversions: Conversions over the period being evaluated.
        product_price: The campaign's product price, if one is set — the
            only basis we have for approximating revenue (conversions *
            price) and therefore ROAS. No product/price means no ROAS,
            not a fabricated one (known simplification, PRD.md §5 step
            10: conversions itself is already an approximation, see step
            9's note — this compounds that).

    Returns:
        The derived ratios, each None where it can't be computed.
    """
    ctr = clicks / impressions if impressions else None
    cpc = spend / clicks if clicks else None
    cpm = spend / impressions * 1000 if impressions else None
    cpl = spend / conversions if conversions else None
    conversion_rate = conversions / clicks if clicks else None
    roas = None
    if product_price is not None and spend:
        roas = (conversions * product_price) / spend
    return DerivedMetrics(
        ctr=ctr, cpc=cpc, cpm=cpm, cpl=cpl, roas=roas, conversion_rate=conversion_rate
    )


def nearest_metric_at_or_before(
    metrics: list[Metric], cutoff: datetime
) -> Metric | None:
    """Find the snapshot closest to (but not after) `cutoff`.

    Args:
        metrics: Any number of Metric snapshots, any order.
        cutoff: The point in time to find a snapshot at or before.

    Returns:
        The latest snapshot at or before cutoff, or None if every
        snapshot is after it (not enough history yet for this cutoff).
    """
    candidates = [m for m in metrics if m.fetchedAt <= cutoff]
    return max(candidates, key=lambda m: m.fetchedAt) if candidates else None


def compute_trend_windows(
    metrics: list[Metric], product_price: float | None, *, now: datetime | None = None
) -> list[TrendWindow]:
    """Compute 24h/3d/7d deltas from lifetime-to-date Metric snapshots.

    Each Metric row is a cumulative lifetime-to-date total as of its own
    fetchedAt (see fetch_campaign_insights) — a window's real "spend in
    the last 24h" is the delta between the latest snapshot and whichever
    snapshot is closest to 24h ago, not the latest snapshot's raw total.
    This is what lets the deep analysis compare 24h vs 3d vs 7d trends
    instead of just staring at one lifetime cumulative number.

    Args:
        metrics: The campaign's Metric snapshots, any order.
        product_price: The campaign's product price, if set (for ROAS).
        now: Injectable for tests; defaults to the real current time.

    Returns:
        One TrendWindow per period that has enough history to compute
        (a period is skipped entirely if no snapshot exists at or before
        its cutoff — e.g. a campaign live for 2 days has no real "7d"
        window yet).
    """
    if not metrics:
        return []
    now = now or datetime.now(UTC)
    latest = max(metrics, key=lambda m: m.fetchedAt)

    windows = []
    for label, span in _TREND_WINDOWS:
        baseline = nearest_metric_at_or_before(metrics, now - span)
        if baseline is None or baseline.id == latest.id:
            continue
        impressions = latest.impressions - baseline.impressions
        clicks = latest.clicks - baseline.clicks
        spend = latest.spend - baseline.spend
        conversions = latest.conversions - baseline.conversions
        windows.append(
            TrendWindow(
                label=label,
                impressions=impressions,
                clicks=clicks,
                spend=spend,
                conversions=conversions,
                derived=_derive_metrics(
                    impressions=impressions,
                    clicks=clicks,
                    spend=spend,
                    conversions=conversions,
                    product_price=product_price,
                ),
            )
        )
    return windows


def has_sufficient_data(
    *, hours_since_last_check: float, delta_spend: float, delta_clicks: int
) -> bool:
    """Event + Time + Data Sufficiency gate (PRD.md build step 10).

    All three must hold — explicitly not "time passed, so analyze."
    hours_since_last_check being float("inf") (never checked before)
    always satisfies the time leg; the spend/click legs still apply.

    Args:
        hours_since_last_check: Hours since this campaign was last
            evaluated by the scheduled job, regardless of outcome.
        delta_spend: Spend since that last check (or since the earliest
            recorded snapshot, if never checked).
        delta_clicks: Clicks over the same period.

    Returns:
        True only if enough time, spend, and clicks have all accumulated.
    """
    return (
        hours_since_last_check >= MIN_HOURS_BETWEEN_CHECKS
        and delta_spend >= MIN_SPEND_TO_ANALYZE
        and delta_clicks >= MIN_CLICKS_TO_ANALYZE
    )


def apply_budget_guardrail(*, current_budget: float, suggested_budget: float) -> float:
    """Cap a proposed budget change to MAX_BUDGET_CHANGE_FRACTION.

    The LLM's raw suggestion is never trusted directly — same "backend
    applies rules/guardrails before executing" principle the user stated
    explicitly for requires_approval, applied here to magnitude instead.

    Args:
        current_budget: The ad set's current daily budget.
        suggested_budget: The LLM's raw, unbounded suggestion.

    Returns:
        suggested_budget, clamped to within +/-20% of current_budget.
    """
    ceiling = current_budget * (1 + MAX_BUDGET_CHANGE_FRACTION)
    floor = current_budget * (1 - MAX_BUDGET_CHANGE_FRACTION)
    return max(floor, min(ceiling, suggested_budget))


def compute_requires_approval(
    *, action_type: str, risk: str, confidence: float, capped_by_guardrail: bool
) -> bool:
    """Decide whether a recommendation needs a human checkpoint before applying.

    Risk is a hard gate, not something confidence can override: HIGH risk
    always requires the checkpoint no matter how confident the model is
    (e.g. a $50/day -> $500/day jump stays mandatory even at 87%
    confidence). Below that, only LOW risk + confidence at or above
    AUTO_APPLY_CONFIDENCE_THRESHOLD on a budget action skips the
    checkpoint — MEDIUM risk always requires approval regardless of
    confidence, same as PAUSE_AD and any suggestion the guardrail had to
    cap (a capped suggestion means the LLM's raw ask exceeded what we
    consider safe, which disqualifies it from auto-apply on its own).

    Args:
        action_type: The recommendation's action type (PAUSE_AD/
            INCREASE_BUDGET/DECREASE_BUDGET) — only budget actions are
            ever auto-apply eligible.
        risk: The LLM's self-assessed risk (LOW/MEDIUM/HIGH).
        confidence: The LLM's self-assessed confidence (0-1).
        capped_by_guardrail: Whether apply_budget_guardrail actually
            reduced the LLM's suggestion.

    Returns:
        False only for a LOW-risk, high-confidence, uncapped budget
        action — True otherwise.
    """
    if risk == "HIGH":
        return True
    if action_type not in _AUTO_APPLY_ELIGIBLE_ACTIONS:
        return True
    if capped_by_guardrail:
        return True
    return not (risk == "LOW" and confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD)


def _format_ratio(value: float | None, *, as_percent: bool = False) -> str:
    """Format a derived ratio for the prompt, or "n/a" if it's None."""
    if value is None:
        return "n/a"
    return f"{value:.2%}" if as_percent else f"{value:.2f}"


def _format_window(window: TrendWindow) -> str:
    """Format one TrendWindow as a prompt line."""
    d = window.derived
    return (
        f"- Last {window.label}: {window.impressions} impressions, {window.clicks} "
        f"clicks, ${window.spend:.2f} spend, {window.conversions} conversions "
        f"(CTR: {_format_ratio(d.ctr, as_percent=True)}, "
        f"CPC: ${_format_ratio(d.cpc)}, CPM: ${_format_ratio(d.cpm)}, "
        f"CPL: ${_format_ratio(d.cpl)}, "
        f"Conversion rate: {_format_ratio(d.conversion_rate, as_percent=True)}, "
        f"ROAS: {_format_ratio(d.roas)})"
    )


def _build_prompt(
    business: Business,
    campaign: Campaign,
    ad_set: AdSet,
    windows: list[TrendWindow],
) -> str:
    """Build the grounding prompt from the campaign's real trend data.

    Args:
        business: The business the campaign belongs to.
        campaign: The live campaign being evaluated.
        ad_set: The campaign's ad set — current daily budget lives here.
        windows: 24h/3d/7d trend windows from compute_trend_windows —
            whichever ones have enough history to exist yet.

    Returns:
        The prompt text.
    """
    lines = [
        "You are a paid-ads performance analyst. Based only on the real "
        "trend data below — comparing the last 24 hours, 3 days, and 7 "
        "days where available — recommend exactly one action: pausing "
        "this campaign's ad, increasing its daily budget, or decreasing "
        "its daily budget. Read the trend across windows before "
        "recommending anything; a single short-term dip or spike is not "
        "by itself a reason to act. Do not invent data that isn't given.",
        "",
        f"Business: {business.name}",
        f"Campaign: {campaign.name or campaign.id} (objective: {campaign.objective})",
        f"Current daily budget: ${ad_set.budget}",
        "",
        "Performance trend (most recent window first):",
    ]
    lines += [_format_window(w) for w in windows]
    lines += [
        "",
        "Submit your recommendation using the provided tool, including "
        "your own confidence (0-1) and risk assessment (LOW/MEDIUM/HIGH) "
        "for the action you're proposing.",
    ]
    return "\n".join(lines)


async def generate_recommendation(
    *,
    business: Business,
    campaign: Campaign,
    ad_set: AdSet,
    windows: list[TrendWindow],
) -> RecommendationResult:
    """Call the Optimization Agent and return one guardrail-capped recommendation.

    Args:
        business: The business the campaign belongs to.
        campaign: The live campaign being evaluated.
        ad_set: The campaign's ad set.
        windows: Trend windows from compute_trend_windows (at least one,
            checked by the caller).

    Returns:
        The generated recommendation (suggested_budget already passed
        through apply_budget_guardrail if the action is a budget change)
        plus whether that capping actually changed the value.

    Raises:
        OptimizerError: If no API key is configured, the API call fails,
            or the model doesn't return a valid tool call.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise OptimizerError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = _build_prompt(business, campaign, ad_set, windows)

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            tools=[
                {
                    "name": _TOOL_NAME,
                    "description": "Submit the recommended optimization action.",
                    "input_schema": GeneratedRecommendation.model_json_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": _TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AnthropicError as exc:
        raise OptimizerError(f"Anthropic API call failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if block.type == "tool_use"), None
    )
    if tool_use is None:
        raise OptimizerError("Model did not return a tool call")

    generated = GeneratedRecommendation.model_validate(tool_use.input)
    capped_by_guardrail = False
    if generated.suggested_budget is not None:
        capped = apply_budget_guardrail(
            current_budget=ad_set.budget, suggested_budget=generated.suggested_budget
        )
        capped_by_guardrail = capped != generated.suggested_budget
        generated = generated.model_copy(update={"suggested_budget": capped})
    return RecommendationResult(
        recommendation=generated, capped_by_guardrail=capped_by_guardrail
    )


# --- TEST_PLAN evaluation ("Phase B" of the test-plan redesign, PRD.md §5
# step 10, confirmed 2026-09-01) ---------------------------------------------
#
# Answers "did the campaign accomplish what the Test Plan set out to
# test?" by comparing real Metric history against the original
# Strategy.content. Distinct from the recommendation logic above (which
# reacts to a live campaign's own metrics with a PAUSE/INCREASE/DECREASE
# action regardless of plan type) — this is specifically about a
# TEST_PLAN's hypothesis.
#
# Known constraint, not yet resolved: campaign publish (app/services/
# publish.py) still creates exactly one AdSet per campaign — there is no
# real per-variant data to compare the hypothesis-driven audience against
# the published broad-baseline variant. winning_variant is therefore
# always None and hypothesis_result is always "INCONCLUSIVE" today; this
# evaluation still does real, useful work by checking the single running
# variant's real metrics against the TEST_PLAN's own success criteria.

# A test is "worth evaluating" once it's consumed at least half its
# declared budget or run at least half its declared duration — tied to
# the test's own design parameters (TestPlanContent.total_budget/
# duration_days), not a fixed constant, since a $500 test and a $5,000
# test don't reach a meaningful sample at the same dollar amount.
MIN_TEST_BUDGET_SPENT_FRACTION = 0.5
MIN_TEST_DURATION_ELAPSED_FRACTION = 0.5


def has_sufficient_test_data(
    *,
    test_plan: TestPlanContent,
    latest_metric: Metric,
    campaign_live_since: datetime,
    now: datetime | None = None,
) -> bool:
    """Whether a TEST_PLAN has run long enough / spent enough to evaluate.

    Either leg passing is enough (not both, unlike has_sufficient_data
    above) — a test that blew through its budget in two days has real
    signal even though little time has passed, and a slow-spending test
    that's run its full duration has real signal even below budget.

    Args:
        test_plan: The campaign's original TEST_PLAN.
        latest_metric: The most recent Metric snapshot.
        campaign_live_since: When the campaign started running —
            approximated by the caller as the earliest Metric snapshot's
            fetchedAt (Campaign has no dedicated "went live at" column).
        now: Injectable for tests; defaults to the real current time.

    Returns:
        True if enough of the test's own budget or duration has elapsed.
    """
    now = now or datetime.now(UTC)
    spend_fraction = (
        latest_metric.spend / test_plan.total_budget if test_plan.total_budget else 0.0
    )
    hours_elapsed = (now - campaign_live_since).total_seconds() / 3600
    duration_fraction = (
        hours_elapsed / (test_plan.duration_days * 24)
        if test_plan.duration_days
        else 0.0
    )
    return (
        spend_fraction >= MIN_TEST_BUDGET_SPENT_FRACTION
        or duration_fraction >= MIN_TEST_DURATION_ELAPSED_FRACTION
    )


def _format_criterion_line(
    criterion: SuccessCriterion, actual_value: float | None
) -> str:
    """Format one success criterion against its actual value.

    Includes the benchmark performance zone when both a benchmark and a
    real value exist.
    """
    metric = criterion.metric
    benchmark = criterion.benchmark
    business_target = criterion.business_target
    value_str = "not yet available" if actual_value is None else f"{actual_value:.2f}"
    parts = [f"{metric}: actual {value_str}"]
    if benchmark is not None:
        zone = (
            classify_performance_zone(actual_value, benchmark)
            if actual_value is not None
            else None
        )
        parts.append(
            f"industry range {benchmark.low}-{benchmark.high} "
            f"(median {benchmark.median})" + (f" — {zone}" if zone is not None else "")
        )
    if business_target is not None:
        parts.append(f"business target {business_target:.2f}")
    return " | ".join(parts)


def _build_test_evaluation_prompt(
    business: Business,
    campaign: Campaign,
    test_plan: TestPlanContent,
    latest_metric: Metric,
) -> str:
    """Build the grounding prompt for a TEST_PLAN evaluation.

    Args:
        business: The business the campaign belongs to.
        campaign: The live campaign being evaluated.
        test_plan: The campaign's original TEST_PLAN.
        latest_metric: The most recent Metric snapshot (lifetime-to-date
            totals, same convention as fetch_campaign_insights).

    Returns:
        The prompt text.
    """
    baseline, hypothesis = test_plan.audience_variants
    primary_hypothesis = test_plan.hypotheses[0]

    actual_by_metric: dict[str, float | None] = {
        "ctr": latest_metric.ctr,
        "cpm": latest_metric.cpm,
        "conversion_rate": latest_metric.conversionRate,
        "cac": latest_metric.cac,
        "roas": latest_metric.roas,
        "add_to_cart_rate": latest_metric.addToCartRate,
    }

    lines = [
        "You are a paid-ads test analyst. This campaign is running a "
        "structured two-variant experiment, but only Variant A (the "
        "broad/automated baseline) has actually been published to Meta "
        "so far — there is no real data yet for Variant B (the "
        "hypothesis-driven audience). You cannot and must not declare "
        "either variant a winner, or claim the hypothesis is supported "
        "or rejected — that comparison isn't possible until both "
        "variants are actually running. Your job is only to read how "
        "the currently-running variant is performing against this "
        "test's own success criteria, and recommend what to do next.",
        "",
        f"Business: {business.name}",
        f"Campaign: {campaign.name or campaign.id} (objective: {campaign.objective})",
        f"Currently running: {baseline.name} ({baseline.hypothesis})",
        f"Designed but not yet published: {hypothesis.name} ({hypothesis.hypothesis})",
        f"Primary hypothesis being tested: {primary_hypothesis.statement}",
        "",
        f"Test design: ${test_plan.daily_budget:.2f}/day for "
        f"{test_plan.duration_days} days (${test_plan.total_budget:.2f} total).",
        "",
        "Real performance so far (lifetime-to-date):",
        f"- Impressions: {latest_metric.impressions}, clicks: {latest_metric.clicks}, "
        f"spend: ${latest_metric.spend:.2f}, conversions: {latest_metric.conversions}",
    ]
    lines += [
        "",
        "Leading indicators (a useful early read):",
        *(
            f"- {_format_criterion_line(c, actual_by_metric.get(c.metric))}"
            for c in test_plan.success_criteria.leading_indicators
        ),
        "",
        "Economic indicators (need more conversion volume to trust):",
        *(
            f"- {_format_criterion_line(c, actual_by_metric.get(c.metric))}"
            for c in test_plan.success_criteria.economic_indicators
        ),
        "",
        test_plan.success_criteria.profitability_note,
        "",
        "This test's own decision-rule playbook, for reference:",
        *(
            f"- If {rule.condition} -> {rule.action}"
            for rule in test_plan.decision_rules
        ),
        "",
        "Choose exactly one recommended_action from: continue_testing, "
        "test_new_creative, investigate_offer_or_landing_page, "
        "investigate_checkout_or_purchase_friction — never prefer_broad "
        "or prefer_hypothesis, since no real comparison is possible yet. "
        "Submit your evaluation using the provided tool, including your "
        "own confidence (LOW/MEDIUM/HIGH).",
    ]
    return "\n".join(lines)


async def evaluate_test_plan(
    *,
    business: Business,
    campaign: Campaign,
    test_plan: TestPlanContent,
    latest_metric: Metric,
) -> GeneratedTestEvaluation:
    """Call the Optimizer on a TEST_PLAN and return its structured evaluation.

    Args:
        business: The business the campaign belongs to.
        campaign: The live campaign being evaluated.
        test_plan: The campaign's original TEST_PLAN — caller has already
            confirmed has_sufficient_test_data passed.
        latest_metric: The most recent Metric snapshot.

    Returns:
        The generated evaluation (recommended_action is always one of
        the cross-variant-comparison-free actions — see
        app/schemas/test_evaluation.py's RecommendedAction).

    Raises:
        OptimizerError: If no API key is configured, the API call fails,
            or the model doesn't return a valid tool call.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise OptimizerError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    prompt = _build_test_evaluation_prompt(business, campaign, test_plan, latest_metric)

    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            tools=[
                {
                    "name": _TEST_EVALUATION_TOOL_NAME,
                    "description": "Submit the test-plan evaluation.",
                    "input_schema": GeneratedTestEvaluation.model_json_schema(),
                }
            ],
            tool_choice={"type": "tool", "name": _TEST_EVALUATION_TOOL_NAME},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AnthropicError as exc:
        raise OptimizerError(f"Anthropic API call failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if block.type == "tool_use"), None
    )
    if tool_use is None:
        raise OptimizerError("Model did not return a tool call")

    return GeneratedTestEvaluation.model_validate(tool_use.input)
