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
(app/services/strategist.py) for guaranteed-structured output, and the
same "generate, don't auto-apply" boundary as every other agent here —
approving a recommendation (app/api/optimization.py) is a separate,
explicit step that actually calls Meta.
"""

from datetime import UTC, datetime, timedelta
from typing import NamedTuple

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import AdSet, Business, Campaign, Metric

from app.core.config import get_settings
from app.schemas.optimization import GeneratedRecommendation

_MODEL = "claude-sonnet-5"
_MAX_TOKENS = 1024
_TOOL_NAME = "submit_recommendation"

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
    *, risk: str, confidence: float, capped_by_guardrail: bool
) -> bool:
    """Decide whether a recommendation needs a human checkpoint before applying.

    Always True today — PRD.md build step 10's checkpoint requirement is
    that every recommendation requires an explicit human approval click,
    regardless of computed risk, until a LOW-risk auto-apply capability
    is explicitly built. Kept as its own function (not a literal `True`
    inline at the call site) precisely so that becomes a rule change
    here, not a rewrite of the callers or a re-litigation of whether the
    LLM's output can be trusted directly (it still won't be — see
    apply_budget_guardrail).

    Args:
        risk: The LLM's self-assessed risk (LOW/MEDIUM/HIGH) — unused
            today, threaded through for when this stops always
            returning True.
        confidence: The LLM's self-assessed confidence (0-1) — unused
            today, same reason.
        capped_by_guardrail: Whether apply_budget_guardrail actually
            reduced the LLM's suggestion — unused today, same reason.

    Returns:
        True, unconditionally, for now.
    """
    del risk, confidence, capped_by_guardrail  # not used yet, see docstring
    return True


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
) -> GeneratedRecommendation:
    """Call the Optimization Agent and return one guardrail-capped recommendation.

    Args:
        business: The business the campaign belongs to.
        campaign: The live campaign being evaluated.
        ad_set: The campaign's ad set.
        windows: Trend windows from compute_trend_windows (at least one,
            checked by the caller).

    Returns:
        The generated recommendation, with suggested_budget already
        passed through apply_budget_guardrail if the action is a budget
        change.

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
    if generated.suggested_budget is not None:
        capped = apply_budget_guardrail(
            current_budget=ad_set.budget, suggested_budget=generated.suggested_budget
        )
        generated = generated.model_copy(update={"suggested_budget": capped})
    return generated
