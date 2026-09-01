"""Marketing Strategist Agent (PRD.md build step 5).

Two-mode agent (confirmed with the user 2026-08-31): plan_type — TEST_PLAN
or DATA_DRIVEN_STRATEGY — is always decided by the caller (app/api/
strategy.py, using real Meta ad-account history or the business's
one-time self-report) and passed in here, same "backend decides, LLM never
invents it" reasoning already used for Campaign.objective. This module
only builds the right prompt/tool schema for whichever mode it's given and
applies the backend-computed fields on top of the LLM's output.

TEST_PLAN is a structured advertising experiment (confirmed with the user
2026-08-31), not just two recommended audiences: a fixed broad/automated
baseline (Variant A, entirely backend-constructed) against one specific,
LLM-generated hypothesis-driven audience (Variant B) — the LLM only ever
designs Variant B and the surrounding creative/offer content, never the
plan's structural facts (variant ids, hypothesis metadata, budget,
success-criteria/decision-rule mechanics, benchmark snapshots).

Uses Claude's tool-use (forced tool call) rather than free-form JSON + a
parser — the model is required to call a single tool whose input_schema is
generated directly from the mode's *Fields model, so the response either
matches that schema or the call fails cleanly; there's no "the model wrote
almost-valid JSON" failure mode to handle. tool_choice only forces which
tool is called though, not that its arguments strictly match the schema —
see app/services/tool_use.py's parse_tool_input for the one stray-wrapper
shape that's tolerated before failing.
"""

from typing import Literal

import anthropic
from anthropic import AsyncAnthropic
from prisma.models import Audience, Business, Product

from app.core.config import get_settings
from app.schemas.strategy import (
    BROAD_BASELINE_HYPOTHESIS,
    BROAD_BASELINE_ID,
    BROAD_BASELINE_NAME,
    DEFAULT_TEST_BUDGET,
    DEFAULT_TEST_DURATION,
    HYPOTHESIS_AUDIENCE_ID,
    MAX_STARTING_BUDGET,
    MIN_TEST_BUDGET,
    PRIMARY_HYPOTHESIS_METRIC,
    SECONDARY_HYPOTHESIS_METRICS,
    AudienceVariant,
    BenchmarkContext,
    DataDrivenStrategyContent,
    GeneratedDataDrivenStrategyFields,
    GeneratedTestPlanFields,
    NormalizedMetrics,
    StrategyContent,
    SuccessCriteria,
    SuccessCriterion,
    TargetAudience,
    TestHypothesis,
    TestPlanContent,
    UnitEconomicsFields,
    benchmark_context_entry,
)
from app.services.benchmarks import (
    JEWELRY_GOOGLE_BENCHMARKS,
    JEWELRY_META_BENCHMARKS,
    METRIC_DIRECTIONS,
    BenchmarkRange,
)
from app.services.meta import AccountCampaignInsights
from app.services.tool_use import parse_tool_input
from app.services.unit_economics import compute_unit_economics

_MODEL = "claude-sonnet-5"
_MAX_TOKENS = 2048
_TEST_PLAN_TOOL_NAME = "submit_test_plan"
_DATA_DRIVEN_STRATEGY_TOOL_NAME = "submit_data_driven_strategy"

PlanType = Literal["TEST_PLAN", "DATA_DRIVEN_STRATEGY"]


class StrategistError(RuntimeError):
    """Raised when the Marketing Strategist Agent fails to produce a strategy."""


def _range_line(label: str, benchmark: BenchmarkRange, unit_fmt: str) -> str:
    """Format one benchmark range as a prompt line.

    Deliberately a range, not a single point, so the model doesn't
    over-index on hitting an exact number (confirmed with the user
    2026-08-31 — a single point invites false precision, e.g. "your CTR
    of 2.38% failed the 2.42% threshold" is noise, not signal).

    Args:
        label: The metric's display name.
        benchmark: The range to format.
        unit_fmt: A str.format template applied to each of low/median/high
            (e.g. "{:.2f}%" or "${:.2f}") — the unit belongs on every
            number, not tacked onto the end of the whole range string.
    """
    return (
        f"{label}: median {unit_fmt.format(benchmark.median)} (typical range "
        f"{unit_fmt.format(benchmark.low)}–{unit_fmt.format(benchmark.high)}, "
        f"source: {benchmark.source})"
    )


def _vertical_grounding() -> str:
    """Jewelry & accessories vertical knowledge + industry benchmark ranges.

    MVP is scoped to this industry only (PRD.md §1, confirmed 2026-08-31) —
    grounding every generation with this context (materials/occasions/price
    tiers/seasonality, plus real benchmark ranges) rather than staying
    industry-agnostic.
    """
    meta_b = JEWELRY_META_BENCHMARKS
    google_b = JEWELRY_GOOGLE_BENCHMARKS
    return (
        "This business is in the jewelry & accessories industry — the only "
        "vertical this product supports. Ground your reasoning in this "
        "industry's realities: materials/gemstones, common purchase "
        "occasions (engagement, anniversary, gifting, self-purchase), "
        "price tiers (fine vs. fashion jewelry), and seasonality "
        "(Valentine's Day, Mother's Day, the winter holidays).\n\n"
        "Validated industry benchmark ranges for this vertical — these are "
        "expectations for a cold-start campaign, not anyone's actual "
        "performance, so reason about them as a typical range rather than "
        "a pass/fail cutoff:\n"
        f"- Meta/Facebook Ads: {_range_line('CTR', meta_b.ctr, '{:.2f}%')}; "
        f"{_range_line('CPM', meta_b.cpm, '${:.2f}')}; "
        f"{_range_line('conversion rate', meta_b.cvr, '{:.2f}%')}; "
        f"{_range_line('CAC', meta_b.cac, '${:.2f}')}\n"
        f"- Google Ads (informational only — this product only publishes "
        f"to Meta): CTR {google_b.ctr_pct}%, CPC ${google_b.cpc_usd}, "
        f"conversion rate {google_b.cvr_pct}%, cost per lead "
        f"${google_b.cost_per_lead_usd}\n"
        "You may reference the Google numbers to justify why Meta is the "
        "more cost-efficient channel for this vertical (e.g. comparing CAC "
        "to cost per lead), but never propose testing or publishing to "
        "Google — this product only executes on Meta."
    )


def _business_product_audience_lines(
    business: Business, product: Product | None, audience: Audience | None
) -> list[str]:
    """Shared grounding lines used by both plan-type prompts."""
    lines = [f"Business: {business.name}"]
    if business.industry:
        lines.append(f"Industry: {business.industry}")
    if business.location:
        lines.append(f"Location: {business.location}")
    if business.description:
        lines.append(f"About: {business.description}")

    if product is not None:
        lines += ["", f"Product: {product.description}"]
        if product.price is not None:
            lines.append(f"Price: {product.price}")
        if product.features:
            lines.append(f"Features: {product.features}")
        if product.benefits:
            lines.append(f"Benefits: {product.benefits}")
    else:
        lines += ["", "No specific product was selected for this campaign."]

    if audience is not None:
        lines += ["", f"Existing audience notes: {audience.description}"]
        if audience.ageMin is not None or audience.ageMax is not None:
            lines.append(f"Age range hint: {audience.ageMin}-{audience.ageMax}")
        if audience.location:
            lines.append(f"Location hint: {audience.location}")
        if audience.interests:
            lines.append(f"Interests hint: {audience.interests}")
        if audience.problem:
            lines.append(f"Problem hint: {audience.problem}")
        if audience.desire:
            lines.append(f"Desire hint: {audience.desire}")
    else:
        lines += ["", "No audience has been defined yet — recommend one from scratch."]

    return lines


def _unit_economics_line(unit_economics: UnitEconomicsFields) -> str:
    """One line summarizing this product's unit economics for a prompt."""
    return (
        f"This product's gross profit per unit is "
        f"${unit_economics.gross_profit:.2f}, implying a breakeven CAC of "
        f"${unit_economics.breakeven_cac:.2f}, a target CAC of "
        f"${unit_economics.target_cac:.2f}, and a breakeven ROAS of "
        f"{unit_economics.breakeven_roas:.2f}x."
    )


def _build_test_plan_prompt(
    business: Business,
    product: Product | None,
    audience: Audience | None,
    objective: str,
    unit_economics: UnitEconomicsFields | None,
    daily_budget: float,
    duration_days: int,
) -> str:
    """Build the grounding prompt for a TEST_PLAN generation.

    Args:
        business: The business the plan is for.
        product: The product being advertised, if one was selected.
        audience: An existing audience definition, if one was selected —
            only used as a hint for the hypothesis-driven variant.
        objective: The campaign's fixed objective.
        unit_economics: This product's computed unit economics, if available.
        daily_budget: The already-decided test budget (a backend business
            rule — see _compute_test_daily_budget), given here only as
            context so the hypothesis/creative angles are realistic for
            the actual spend level, not something the model is asked to set.
        duration_days: The already-decided test duration, same reasoning.

    Returns:
        The prompt text.
    """
    lines = [
        "You are a marketing strategist. This business has no meaningful "
        "advertising history yet, so you're designing one half of a "
        "structured two-variant experiment.",
        "",
        "The system has already fixed Variant A — a broad/automated "
        "baseline using Meta's automated delivery (deliberately empty "
        "targeting, no invented interests) as the control. Your job is "
        "only Variant B: one specific, hypothesis-driven audience to test "
        "against that baseline, plus the surrounding creative/offer "
        "content. The purpose of this experiment is NOT to assume either "
        "audience is better — it's to collect real campaign data and let "
        "actual performance decide.",
        "",
        _vertical_grounding(),
        "",
        *_business_product_audience_lines(business, product, audience),
        "",
        f"Campaign objective: {objective}",
        "",
        f"This test will run at ${daily_budget:.2f}/day for {duration_days} "
        f"days — that's a fixed business decision, not something you need "
        f"to determine, but factor it into how ambitious your hypothesis "
        f"and creative angles can realistically be at that spend level.",
        "",
        "Design Variant B's audience from the real product/business/"
        "audience data above — do not create an unnecessarily complicated, "
        "interest-stacked audience. It should be specific enough to test a "
        "meaningful, falsifiable hypothesis, but simple enough that the "
        "result can be interpreted. Avoid overly clever demographic "
        "assumptions that aren't actually supported by the data given.",
        "",
        "Your hypothesis statement must name a specific, measurable "
        "difference you expect between Variant B and the broad baseline "
        "(e.g. a lower CAC, a higher CTR) — not a vague claim like "
        '"this audience should perform well." Generate at least two '
        "creative angles to test. Do not propose testing against another "
        "ad platform (Google, TikTok, etc.) — this product only executes "
        "on Meta.",
    ]
    if unit_economics is not None:
        lines += ["", _unit_economics_line(unit_economics)]
    lines += ["", "Submit your test plan using the provided tool."]
    return "\n".join(lines)


def _compute_test_daily_budget(unit_economics: UnitEconomicsFields | None) -> float:
    """The TEST_PLAN daily budget — a backend business rule, not an LLM recommendation.

    Not an absolute advertising truth either (confirmed with the user
    2026-09-01). Anchored to this product's own target CAC when known — a
    productive test should be able to buy roughly one conversion a day at
    that rate — clamped to [MIN_TEST_BUDGET, MAX_STARTING_BUDGET] so a
    very cheap or very expensive product doesn't get an unreasonable
    starting budget. Falls back to DEFAULT_TEST_BUDGET with no computable
    unit economics.

    Args:
        unit_economics: This product's computed unit economics, if available.

    Returns:
        The daily test budget in dollars.
    """
    if unit_economics is None:
        return DEFAULT_TEST_BUDGET
    return min(max(unit_economics.target_cac, MIN_TEST_BUDGET), MAX_STARTING_BUDGET)


def _build_broad_baseline_variant() -> AudienceVariant:
    """Variant A — entirely backend-constructed, no LLM input.

    "Broad enough for Meta's delivery system to find likely customers"
    means deliberately empty/unconstrained targeting, not something to
    generate creatively (confirmed with the user 2026-08-31 — "do not
    invent unnecessary interests for the broad audience").
    """
    return AudienceVariant(
        id=BROAD_BASELINE_ID,
        name=BROAD_BASELINE_NAME,
        type="broad_automated",
        is_baseline=True,
        hypothesis=BROAD_BASELINE_HYPOTHESIS,
        targeting=TargetAudience(),
    )


def _build_hypothesis_variant(generated: GeneratedTestPlanFields) -> AudienceVariant:
    """Variant B — LLM-designed audience wrapped in the fixed structural fields."""
    return AudienceVariant(
        id=HYPOTHESIS_AUDIENCE_ID,
        name=generated.hypothesis_audience_name,
        type="hypothesis_driven",
        is_baseline=False,
        hypothesis=generated.hypothesis_statement,
        targeting=generated.hypothesis_audience_targeting,
    )


def _build_primary_hypothesis(hypothesis_statement: str) -> TestHypothesis:
    """The experiment's primary, falsifiable hypothesis.

    baseline_variant/test_variant/primary_metric/secondary_metrics are
    fixed — every TEST_PLAN compares the same two variants the same way —
    only the statement text is LLM-generated, so it can reference the
    actual audience specifics (e.g. the interests chosen for Variant B)
    rather than reading as a generic template sentence.
    """
    return TestHypothesis(
        id="audience_targeting",
        statement=hypothesis_statement,
        baseline_variant=BROAD_BASELINE_ID,
        test_variant=HYPOTHESIS_AUDIENCE_ID,
        primary_metric=PRIMARY_HYPOTHESIS_METRIC,
        secondary_metrics=SECONDARY_HYPOTHESIS_METRICS,
    )


def _build_benchmark_context() -> BenchmarkContext:
    """Snapshot the current Meta jewelry benchmark ranges onto the plan.

    A snapshot, not a live reference — see BenchmarkContextEntry's
    docstring for why (an already-designed test's criteria shouldn't
    shift if benchmarks.py's numbers are updated later).
    """
    b = JEWELRY_META_BENCHMARKS
    return BenchmarkContext(
        ctr=benchmark_context_entry(b.ctr),
        cpm=benchmark_context_entry(b.cpm),
        cvr=benchmark_context_entry(b.cvr),
        cac=benchmark_context_entry(b.cac),
    )


def _build_success_criteria(
    benchmark_context: BenchmarkContext, unit_economics: UnitEconomicsFields | None
) -> SuccessCriteria:
    """The fixed TEST_PLAN success-criteria — not LLM-generated.

    Split into leading indicators (a useful early read with relatively
    little data) and economic indicators (need more conversion volume to
    be reliable) — confirmed with the user 2026-08-31: a small cold-start
    test shouldn't define success exclusively as "hit target ROAS."

    benchmark (industry-wide) and business_target (this business's own
    economics) are kept as two separate numbers on every criterion, never
    blended into one (confirmed with the user 2026-09-01) — a $2,000
    product at 50% margin needing "CAC below $100" is a business target
    that has nothing to do with what the broader jewelry industry
    typically sees; picking "whichever is lower" between them, as an
    earlier draft of this function did, would silently hide one fact
    behind the other.
    """
    target_cac = unit_economics.target_cac if unit_economics is not None else None
    breakeven_roas = (
        unit_economics.breakeven_roas if unit_economics is not None else None
    )
    leading = [
        SuccessCriterion(
            metric="ctr",
            benchmark=benchmark_context.ctr,
            business_target=None,
            direction=METRIC_DIRECTIONS["ctr"],
            guidance=(
                "An early signal, meaningful even with a small sample — "
                "compare against the typical range, not a single cutoff."
            ),
        ),
        SuccessCriterion(
            metric="cpm",
            benchmark=benchmark_context.cpm,
            business_target=None,
            direction=METRIC_DIRECTIONS["cpm"],
            guidance="Reflects how efficiently Meta is delivering impressions.",
        ),
        SuccessCriterion(
            metric="add_to_cart_rate",
            benchmark=None,
            business_target=None,
            direction=METRIC_DIRECTIONS["add_to_cart_rate"],
            guidance=(
                "No industry benchmark range is configured for this metric "
                "yet — track it directionally: strong traffic with a weak "
                "add-to-cart rate points at the offer or landing page, not "
                "the audience."
            ),
        ),
    ]
    economic = [
        SuccessCriterion(
            metric="conversion_rate",
            benchmark=benchmark_context.cvr,
            business_target=None,
            direction=METRIC_DIRECTIONS["conversion_rate"],
            guidance="Needs meaningful traffic volume before it's reliable.",
        ),
        SuccessCriterion(
            metric="cac",
            benchmark=benchmark_context.cac,
            business_target=target_cac,
            direction=METRIC_DIRECTIONS["cac"],
            guidance=(
                "Two separate signals, not one: the industry benchmark "
                "range shows what's typical for this vertical; "
                "business_target (when available) is this product's own "
                "economics-derived ceiling and is the one that actually "
                "determines profitability. Both need sufficient conversion "
                "volume before they're a reliable read."
            ),
        ),
        SuccessCriterion(
            metric="roas",
            benchmark=None,
            business_target=breakeven_roas,
            direction=METRIC_DIRECTIONS["roas"],
            guidance=(
                "No industry benchmark range is configured for ROAS — "
                "judge it against this product's own breakeven ROAS "
                "(business_target, when available) once conversion volume "
                "is sufficient, not as the sole measure of a cold-start test."
            ),
        ),
    ]
    if unit_economics is not None:
        profitability_note = (
            f"{_unit_economics_line(unit_economics)} These are this "
            f"product's own business-economics targets — see each "
            f"criterion's business_target field — kept separate from the "
            f"industry benchmark ranges above, which describe the broader "
            f"vertical, not this business."
        )
    else:
        profitability_note = (
            "This product has no price/margin on file, so no business-"
            "specific target is available — success is judged against the "
            "industry benchmark ranges above only."
        )
    return SuccessCriteria(
        leading_indicators=leading,
        economic_indicators=economic,
        profitability_note=profitability_note,
    )


def _build_data_driven_strategy_prompt(
    business: Business,
    product: Product | None,
    audience: Audience | None,
    objective: str,
    unit_economics: UnitEconomicsFields | None,
    account_history: list[AccountCampaignInsights],
) -> str:
    """Build the grounding prompt for a DATA_DRIVEN_STRATEGY generation."""
    lines = [
        "You are a marketing strategist. This business has real "
        "advertising history — generate a full strategy plus an "
        "optimization plan grounded in what already worked, not a "
        "from-scratch test.",
        "",
        _vertical_grounding(),
        "",
        *_business_product_audience_lines(business, product, audience),
        "",
        f"Campaign objective: {objective}",
    ]
    if account_history:
        lines += ["", "Historical performance on this Meta ad account:"]
        for row in account_history:
            ctr = (row.clicks / row.impressions * 100) if row.impressions else 0.0
            lines.append(
                f"- {row.campaign_name}: {row.impressions} impressions, "
                f"{row.clicks} clicks (CTR {ctr:.2f}%), ${row.spend:.2f} spend, "
                f"{row.conversions} conversions"
            )
    else:
        lines += [
            "",
            "No numeric ad-account history is available — this business "
            "self-reported prior advertising experience, but ground your "
            "reasoning in general best practice for this vertical rather "
            "than fabricated numbers.",
        ]
    if unit_economics is not None:
        lines += [
            "",
            f"{_unit_economics_line(unit_economics)} Factor this into your "
            f"budget recommendation and scaling trigger.",
        ]
    lines += [
        "",
        "keyLearnings should summarize what the historical data shows "
        "worked or didn't. recommendedAdjustments should be concrete "
        "changes vs. past performance. scalingTrigger should state, in "
        "plain terms, what result should trigger increasing budget "
        "further.",
        "",
        "Submit your strategy using the provided tool.",
    ]
    return "\n".join(lines)


async def _call_agent(
    *, tool_name: str, tool_schema: dict[str, object], prompt: str
) -> dict[str, object]:
    """Shared Anthropic forced-tool-use call for both plan types.

    Args:
        tool_name: The name of the single tool the model is forced to call.
        tool_schema: The JSON schema of that tool's input.
        prompt: The full grounding prompt.

    Returns:
        The tool call's raw input, ready for parse_tool_input.

    Raises:
        StrategistError: If no API key is configured, the API call fails,
            or the model doesn't return a tool call.
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise StrategistError("ANTHROPIC_API_KEY is not configured")

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        response = await client.messages.create(
            model=_MODEL,
            max_tokens=_MAX_TOKENS,
            tools=[
                {
                    "name": tool_name,
                    "description": "Submit the generated plan.",
                    "input_schema": tool_schema,
                }
            ],
            tool_choice={"type": "tool", "name": tool_name},
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AnthropicError as exc:
        raise StrategistError(f"Anthropic API call failed: {exc}") from exc

    tool_use = next(
        (block for block in response.content if block.type == "tool_use"), None
    )
    if tool_use is None:
        raise StrategistError("Model did not return a tool call")
    result: dict[str, object] = tool_use.input
    return result


async def generate_strategy(
    *,
    business: Business,
    product: Product | None,
    audience: Audience | None,
    objective: str,
    plan_type: PlanType,
    account_history: list[AccountCampaignInsights] | None = None,
) -> StrategyContent:
    """Call the Marketing Strategist Agent and return a structured plan.

    Args:
        business: The business the plan is for.
        product: The product being advertised, if one was selected.
        audience: The existing audience definition, if one was selected —
            only used as a hint for DATA_DRIVEN_STRATEGY's single audience
            or TEST_PLAN's hypothesis-driven variant.
        objective: The campaign's fixed objective — injected into the
            result directly rather than asked of the model, so it can
            never contradict what the user actually chose.
        plan_type: Which plan to generate — decided by the caller (app/api/
            strategy.py), never by the LLM.
        account_history: Real per-campaign Meta ad-account history, if any
            was found — only meaningful for DATA_DRIVEN_STRATEGY.

    Returns:
        The generated plan, with every backend-computed field (see
        app/schemas/strategy.py's TestPlanContent/DataDrivenStrategyContent
        docstrings for exactly which) set by this function rather than
        the LLM.

    Raises:
        StrategistError: If no API key is configured, the API call fails,
            or the model doesn't return a valid tool call.
    """
    unit_economics_tuple = compute_unit_economics(product)
    unit_economics = (
        UnitEconomicsFields(
            gross_profit=unit_economics_tuple.gross_profit,
            breakeven_cac=unit_economics_tuple.breakeven_cac,
            target_cac=unit_economics_tuple.target_cac,
            breakeven_roas=unit_economics_tuple.breakeven_roas,
        )
        if unit_economics_tuple is not None
        else None
    )

    if plan_type == "TEST_PLAN":
        daily_budget = _compute_test_daily_budget(unit_economics)
        duration_days = DEFAULT_TEST_DURATION
        prompt = _build_test_plan_prompt(
            business,
            product,
            audience,
            objective,
            unit_economics,
            daily_budget,
            duration_days,
        )
        raw = await _call_agent(
            tool_name=_TEST_PLAN_TOOL_NAME,
            tool_schema=GeneratedTestPlanFields.model_json_schema(),
            prompt=prompt,
        )
        generated = parse_tool_input(raw, GeneratedTestPlanFields)
        benchmark_context = _build_benchmark_context()
        # model_validate (not the constructor) because `objective` is plain
        # str here (that's what Prisma gives us — SQLite has no enum,
        # PRD.md §7) and needs real runtime validation against the
        # Literal, not a static cast.
        return TestPlanContent.model_validate(
            {
                "objective": objective,
                "audience_variants": [
                    _build_broad_baseline_variant(),
                    _build_hypothesis_variant(generated),
                ],
                "hypotheses": [
                    _build_primary_hypothesis(generated.hypothesis_statement)
                ],
                "offer": generated.offer,
                "positioning": generated.positioning,
                "creative_angles": generated.creative_angles,
                "copy_strategy": generated.copy_strategy,
                "daily_budget": daily_budget,
                "duration_days": duration_days,
                "total_budget": daily_budget * duration_days,
                "success_criteria": _build_success_criteria(
                    benchmark_context, unit_economics
                ),
                "baseline_metrics": NormalizedMetrics(),
                "benchmark_context": benchmark_context,
                "unit_economics": unit_economics,
            }
        )

    prompt = _build_data_driven_strategy_prompt(
        business, product, audience, objective, unit_economics, account_history or []
    )
    raw = await _call_agent(
        tool_name=_DATA_DRIVEN_STRATEGY_TOOL_NAME,
        tool_schema=GeneratedDataDrivenStrategyFields.model_json_schema(),
        prompt=prompt,
    )
    generated_opt = parse_tool_input(raw, GeneratedDataDrivenStrategyFields)
    # model_validate, not the constructor — same objective-is-plain-str
    # reasoning as the TEST_PLAN branch above.
    return DataDrivenStrategyContent.model_validate(
        {
            "objective": objective,
            "target_audience": generated_opt.target_audience,
            "offer": generated_opt.offer,
            "positioning": generated_opt.positioning,
            "creative_angles": generated_opt.creative_angles,
            "copy_strategy": generated_opt.copy_strategy,
            "budget_recommendation": generated_opt.budget_recommendation,
            "key_learnings": generated_opt.key_learnings,
            "recommended_adjustments": generated_opt.recommended_adjustments,
            "scaling_trigger": generated_opt.scaling_trigger,
            "unit_economics": unit_economics,
        }
    )
