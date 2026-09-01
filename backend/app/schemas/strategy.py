"""Schemas for the Marketing Strategist Agent (PRD.md build step 5).

Two-mode agent, confirmed with the user 2026-08-31: a business with no real
advertising history gets a TEST_PLAN — a structured advertising experiment,
not just two recommended audiences (confirmed with the user 2026-08-31,
"Phase A" of the test-plan redesign) — while a business with real
historical performance data gets a DATA_DRIVEN_STRATEGY plan (grounded in
what already worked). See app/services/strategist.py for how plan_type is
decided — always by the backend, never left to the LLM, same reasoning as
Campaign.objective being fixed input rather than something the agent
invents.
"""

from datetime import datetime
from typing import TYPE_CHECKING, Annotated, Literal, Self

from pydantic import Field, TypeAdapter, model_validator

from app.schemas.base import CamelCaseModel
from app.schemas.campaign import Objective
from app.services.benchmarks import BenchmarkRange
from app.services.interests import INTERESTS

# Forced tool-use plus this Literal means the Strategist LLM can only ever
# emit an interest key that's guaranteed to resolve to a real, currently-
# valid Meta interest id (app/services/interests.py) — no fuzzy matching,
# no runtime API dependency at publish time. Built from the curated
# table's own keys rather than hand-duplicated here, so the two can't
# drift out of sync (confirmed with the user 2026-09-02, "Phase C" of the
# test-plan redesign). mypy/ty can't statically verify a Literal built
# from a runtime dict's keys, so type-checking sees the always-valid
# `str` in the TYPE_CHECKING branch; Pydantic (and the real JSON schema
# it builds for the tool call) sees the real dynamic Literal at runtime.
if TYPE_CHECKING:
    InterestKey = str
else:
    InterestKey = Literal[tuple(sorted(INTERESTS))]


class TargetLocation(CamelCaseModel):
    """One structured location for real geo-targeting resolution.

    city/region as separate fields (not one free-text string) make
    resolution against Meta's real Geo Search endpoint
    (app/services/geo.py) near-deterministic. Confirmed against the live
    API 2026-09-02: searching a city name alone hits real ambiguity —
    "Springfield" alone returns 25+ candidates across a dozen-plus US
    states (plus Australia/UK) with no single obviously-right answer —
    the "Springfield problem" this structure exists to reduce. country
    isn't part of this: this MVP is US-only everywhere already
    (BenchmarkContext.country, the default geo_locations
    countries:["US"]), so resolution always filters to the US as a
    backend constraint, never something the LLM picks or a per-business
    lookup — there's only one possible value today.

    At least one of city/region must be set (validated) — an entry with
    neither carries no targeting information.
    """

    city: str | None = None
    region: str | None = None

    @model_validator(mode="after")
    def _at_least_one_field_set(self) -> Self:
        if self.city is None and self.region is None:
            raise ValueError("TargetLocation needs at least one of city/region set")
        return self


class TargetAudience(CamelCaseModel):
    """Agent-recommended (or refined) audience targeting.

    Mirrors the real Audience model's field shapes, not ad hoc ones —
    ageMin/ageMax as separate ints matches Meta's age_min/age_max targeting
    fields directly, same reasoning already used for the Audience table.
    genders is a list (not a single value) to match Meta's own targeting
    shape, which accepts multiple; None means "not specified" (broad),
    distinct from an empty list. interests is constrained to the curated
    InterestKey enum (not free text) for the same reason; location is
    structured (TargetLocation) rather than free text for the same
    "guarantee resolvability" reasoning — see TargetLocation's docstring.
    """

    age_min: int | None = None
    age_max: int | None = None
    genders: list[str] | None = None
    location: list[TargetLocation] = Field(default_factory=list)
    interests: list[InterestKey] = Field(default_factory=list)
    problem: str | None = None
    desire: str | None = None


class BudgetRecommendation(CamelCaseModel):
    """Agent-recommended daily budget, with the reasoning behind it.

    Used by the DATA_DRIVEN_STRATEGY plan only — TEST_PLAN has its own
    dailyBudget/durationDays/totalBudget shape below, computed as a
    backend business rule rather than freely recommended.
    """

    daily: float
    rationale: str


class UnitEconomicsFields(CamelCaseModel):
    """Per-unit profit math grounding budget/CAC/ROAS reasoning (both plan types).

    Computed by app/services/unit_economics.py, not the LLM — omitted
    entirely when the campaign's product has no price/margin set (or a
    zero margin, which has no meaningful breakeven ROAS).
    """

    gross_profit: float
    breakeven_cac: float
    target_cac: float
    breakeven_roas: float


# --- TEST_PLAN --------------------------------------------------------------
#
# A TEST_PLAN is a structured advertising experiment, not just two
# recommended audiences (confirmed with the user 2026-08-31). It always
# compares exactly two audience variants — a broad/automated baseline
# (Variant A) against one specific, hypothesis-driven audience (Variant
# B) — so the business collects real evidence about which approach works,
# rather than Sales Guru assuming an answer up front. See the module-level
# lifecycle note in PRD.md §5 step 5.
#
# Every field below is explicitly tagged, in its own docstring, as either
# a backend-computed fact or LLM-generated content — the spec's own
# requirement to distinguish "facts supplied by the business, historical
# Meta performance data, industry benchmarks, and AI-generated hypotheses"
# (see DataSourceTag below, which records this distinction on the stored
# plan itself).

# Test-phase budget/duration are a backend business rule, not an LLM
# recommendation and not an absolute advertising truth (confirmed with the
# user 2026-09-01, superseding the earlier "$50/10-day floor" framing) —
# see app/services/strategist.py's _compute_test_daily_budget for how
# DEFAULT/MIN/MAX combine with a product's own unit economics.
DEFAULT_TEST_BUDGET = 50.0
DEFAULT_TEST_DURATION = 10
MIN_TEST_BUDGET = 20.0
MAX_STARTING_BUDGET = 75.0

# The two variant ids are fixed, not LLM-chosen — the Optimizer (PRD.md §5
# step 10, not yet updated to consume this) needs a stable, well-known way
# to look up "the baseline" vs. "the test variant" regardless of what the
# LLM named them.
BROAD_BASELINE_ID = "broad_baseline"
HYPOTHESIS_AUDIENCE_ID = "hypothesis_audience"

# Variant A (the broad/automated baseline) is entirely backend-constructed
# — no LLM input needed, since "broad enough for Meta's delivery system to
# find likely customers" means deliberately empty/unconstrained targeting,
# not something to generate creatively. See app/services/strategist.py's
# _build_broad_baseline_variant.
BROAD_BASELINE_NAME = "Broad / Automated Baseline"
BROAD_BASELINE_HYPOTHESIS = (
    "Meta's automated delivery system can identify qualified customers "
    "more efficiently than manually defined targeting."
)

AudienceVariantType = Literal["broad_automated", "hypothesis_driven"]


class AudienceVariant(CamelCaseModel):
    """One of the TEST_PLAN's exactly two audience variants.

    id/type/isBaseline are backend-fixed structural facts (always
    "broad_baseline"/"broad_automated"/true for Variant A, always
    "hypothesis_audience"/"hypothesis_driven"/false for Variant B) — never
    left to the LLM, same "backend decides structural facts" reasoning
    used throughout this module. name/hypothesis/targeting are backend-
    fixed for Variant A and LLM-generated (grounded in the real product/
    business/audience data) for Variant B.
    """

    id: Literal["broad_baseline", "hypothesis_audience"]
    name: str
    type: AudienceVariantType
    is_baseline: bool
    hypothesis: str
    targeting: TargetAudience


class TestHypothesis(CamelCaseModel):
    """A falsifiable, measurable comparison between the two variants.

    baseline_variant/test_variant/primary_metric/secondary_metrics are
    backend-fixed (this experiment always compares the same two variants
    on the same metrics) — only `statement` is LLM-generated, so it can
    reference the actual audience specifics (e.g. the chosen interests)
    rather than being a generic template sentence.
    """

    id: str
    statement: str
    baseline_variant: Literal["broad_baseline"]
    test_variant: Literal["hypothesis_audience"]
    primary_metric: str
    secondary_metrics: list[str]


# The single metric the primary hypothesis is judged on, and the secondary
# metrics tracked alongside it — fixed, not LLM-chosen (every TEST_PLAN
# compares the same two variants the same way).
PRIMARY_HYPOTHESIS_METRIC = "cac"
SECONDARY_HYPOTHESIS_METRICS: list[str] = [
    "ctr",
    "cpc",
    "add_to_cart_rate",
    "conversion_rate",
    "roas",
]


class NormalizedMetrics(CamelCaseModel):
    """Meta performance metrics, normalized to one consistent internal shape.

    Every field defaults to None. None means "unavailable or not
    applicable to this campaign's objective," never zero — a metric that
    hasn't been collected yet is a different fact from a metric that was
    collected and came back at zero (confirmed with the user 2026-08-31).
    Not every campaign objective produces every metric (e.g. an AWARENESS
    campaign may never have add_to_cart data); this shape is deliberately
    permissive rather than assuming uniform availability.
    """

    impressions: int | None = None
    reach: int | None = None
    spend: float | None = None
    cpm: float | None = None
    clicks: int | None = None
    ctr: float | None = None
    cpc: float | None = None
    landing_page_views: int | None = None
    add_to_cart: int | None = None
    add_to_cart_rate: float | None = None
    conversions: int | None = None
    conversion_rate: float | None = None
    cac: float | None = None
    purchase_value: float | None = None
    roas: float | None = None


class BenchmarkContextEntry(CamelCaseModel):
    """One metric's benchmark range, snapshotted onto the stored plan.

    Copied from app/services/benchmarks.py at generation time.
    Deliberately a snapshot, not a live reference — if benchmarks.py's
    numbers change later, an already-running test's success criteria stay
    pinned to what was true when the test was designed, so evaluating it
    later (the Optimizer, PRD.md §5 step 10) can't retroactively change
    what "success" meant for this specific test.
    """

    low: float
    median: float
    high: float
    source: str
    as_of: str
    direction: Literal["higher_is_better", "lower_is_better"]


def benchmark_context_entry(benchmark: BenchmarkRange) -> BenchmarkContextEntry:
    """Snapshot a live BenchmarkRange into the stored-plan representation."""
    return BenchmarkContextEntry(
        low=benchmark.low,
        median=benchmark.median,
        high=benchmark.high,
        source=benchmark.source,
        as_of=benchmark.as_of,
        direction=benchmark.direction,
    )


class BenchmarkContext(CamelCaseModel):
    """The industry/platform benchmark ranges this TEST_PLAN was designed against.

    Expectations for a cold-start campaign, not this business's actual
    performance (confirmed with the user 2026-08-31: "do not present
    benchmark estimates as actual business performance").
    """

    platform: Literal["meta"] = "meta"
    industry: Literal["jewelry"] = "jewelry"
    country: Literal["US"] = "US"
    ctr: BenchmarkContextEntry
    cpm: BenchmarkContextEntry
    cvr: BenchmarkContextEntry
    cac: BenchmarkContextEntry


class SuccessCriterion(CamelCaseModel):
    """One tracked signal within success_criteria.

    benchmark (an industry-wide range) and business_target (this specific
    business's own economics-derived number, from unit_economics) are
    deliberately two separate fields, never blended into one number
    (confirmed with the user 2026-09-01): a $2,000 product at 50% margin
    might need "CAC below $100" as a business target, which has nothing
    to do with what the broader jewelry industry typically sees — picking
    "whichever is lower" between them, as an earlier draft of this schema
    did, would silently hide one fact behind the other. Both are None
    when not applicable (benchmark: no industry range configured for this
    metric, e.g. add_to_cart_rate/ROAS; business_target: no product
    price/margin on file). direction is set regardless (from
    app/services/benchmarks.py's METRIC_DIRECTIONS), so "better"/"worse"
    is always known even with neither number available.
    """

    metric: str
    benchmark: BenchmarkContextEntry | None
    business_target: float | None
    direction: Literal["higher_is_better", "lower_is_better"]
    guidance: str


class SuccessCriteria(CamelCaseModel):
    """Success criteria, split into leading vs. economic indicators.

    Confirmed with the user 2026-08-31 — a cold-start test shouldn't
    define success exclusively as "hit target ROAS," since that requires
    more conversion volume than a small test will have early on.

    leading_indicators (CTR, CPM, add-to-cart rate) give a useful early
    read with relatively little data. economic_indicators (conversion
    rate, CAC, ROAS) need more volume before they're reliable — the
    Optimizer (PRD.md §5 step 10) is responsible for actually gating on
    sample size, not this plan.
    """

    leading_indicators: list[SuccessCriterion]
    economic_indicators: list[SuccessCriterion]
    profitability_note: str


class DecisionRule(CamelCaseModel):
    """One rule telling the Optimizer what action a given result implies."""

    condition: str
    action: str


# A fixed playbook, not LLM-generated — the same rules apply regardless of
# business specifics, so generating them per-call would only risk
# inconsistency (confirmed with the user 2026-08-31). Structured as
# condition/action pairs comparing the two named variants (confirmed with
# the user 2026-08-31, superseding the earlier flat-string list) so the
# Optimizer can match on `action` programmatically instead of parsing prose.
TEST_PLAN_DECISION_RULES: list[DecisionRule] = [
    DecisionRule(
        condition="broad_baseline has lower CAC with sufficient conversion volume",
        action="prefer_broad",
    ),
    DecisionRule(
        condition="hypothesis_audience has lower CAC with sufficient conversion volume",
        action="prefer_hypothesis",
    ),
    DecisionRule(
        condition=(
            "one audience has materially better CTR/CPC but insufficient conversions"
        ),
        action="continue_testing",
    ),
    DecisionRule(
        condition="both audiences show weak CTR",
        action="test_new_creative",
    ),
    DecisionRule(
        condition="strong traffic but weak add_to_cart_rate",
        action="investigate_offer_or_landing_page",
    ),
    DecisionRule(
        condition="strong add_to_cart but weak purchase conversion",
        action="investigate_checkout_or_purchase_friction",
    ),
]


class DataSourceTag(CamelCaseModel):
    """Explicit provenance — which fields on this plan came from which source.

    Confirmed with the user 2026-08-31 — the Strategist "must clearly
    distinguish between facts supplied by the business, historical Meta
    performance data, industry benchmarks, and AI-generated hypotheses."
    Backend-assembled, not LLM output — the LLM doesn't get to
    characterize its own provenance.
    """

    business_facts: list[str]
    historical_meta_data: list[str]
    industry_benchmarks: list[str]
    ai_generated_hypotheses: list[str]


# TEST_PLAN never has real Meta history (that's what routes a business to
# DATA_DRIVEN_STRATEGY instead — see app/api/strategy.py), so
# historical_meta_data is always empty here.
TEST_PLAN_DATA_SOURCE = DataSourceTag(
    business_facts=[
        "business profile",
        "product description/price/margin",
        "existing audience notes (if any)",
        "campaign objective",
    ],
    historical_meta_data=[],
    industry_benchmarks=["ctr", "cpm", "cvr", "cac (Meta, jewelry & accessories)"],
    ai_generated_hypotheses=[
        "hypothesis-driven audience targeting",
        "primary hypothesis statement",
        "offer",
        "positioning",
        "creative angles",
        "copy strategy",
    ],
)


class GeneratedTestPlanFields(CamelCaseModel):
    """The fields the LLM generates for a TEST_PLAN.

    Deliberately excludes Variant A (the broad baseline — backend-fixed,
    see BROAD_BASELINE_NAME/BROAD_BASELINE_HYPOTHESIS above), the
    hypothesis's structural fields (backend-fixed, see TestHypothesis),
    daily budget/duration (a backend business rule), and every backend-
    computed field on TestPlanContent below. The LLM only designs Variant
    B (the hypothesis-driven audience) and the surrounding creative/offer
    content, grounded in the real product/business/audience data.
    """

    hypothesis_audience_name: str
    hypothesis_audience_targeting: TargetAudience
    hypothesis_statement: str
    offer: str
    positioning: str
    creative_angles: list[str]
    copy_strategy: str


class TestPlanContent(CamelCaseModel):
    """The full structured TEST_PLAN — what gets stored and returned.

    Everything except hypothesis_audience_name/_targeting/_statement,
    offer, positioning, creative_angles, and copy_strategy is backend-
    computed, not LLM output — see app/services/strategist.py.
    """

    # Tells pytest not to try collecting this as a test class — its name
    # just happens to start with "Test" (it's a plan *type*, TEST_PLAN vs.
    # DATA_DRIVEN_STRATEGY), unrelated to the test suite.
    __test__ = False

    plan_type: Literal["TEST_PLAN"] = "TEST_PLAN"
    objective: Objective
    audience_variants: Annotated[
        list[AudienceVariant], Field(min_length=2, max_length=2)
    ]
    hypotheses: list[TestHypothesis]
    offer: str
    positioning: str
    creative_angles: list[str]
    copy_strategy: str
    daily_budget: float
    duration_days: int
    total_budget: float
    success_criteria: SuccessCriteria
    decision_rules: list[DecisionRule] = TEST_PLAN_DECISION_RULES
    baseline_metrics: NormalizedMetrics
    benchmark_context: BenchmarkContext
    data_source: DataSourceTag = TEST_PLAN_DATA_SOURCE
    unit_economics: UnitEconomicsFields | None = None


# --- DATA_DRIVEN_STRATEGY ---------------------------------------------------


class GeneratedDataDrivenStrategyFields(CamelCaseModel):
    """The fields the LLM generates for a DATA_DRIVEN_STRATEGY plan."""

    target_audience: TargetAudience
    offer: str
    positioning: str
    creative_angles: list[str]
    copy_strategy: str
    budget_recommendation: BudgetRecommendation
    key_learnings: list[str]
    recommended_adjustments: list[str]
    scaling_trigger: str


class DataDrivenStrategyContent(GeneratedDataDrivenStrategyFields):
    """The full structured DATA_DRIVEN_STRATEGY plan — stored and returned."""

    plan_type: Literal["DATA_DRIVEN_STRATEGY"] = "DATA_DRIVEN_STRATEGY"
    objective: Objective
    unit_economics: UnitEconomicsFields | None = None


StrategyContent = Annotated[
    TestPlanContent | DataDrivenStrategyContent, Field(discriminator="plan_type")
]

# StrategyContent is a type alias (a discriminated union), not a class, so
# there's no `.model_validate_json`/`.model_dump_json` to call on it
# directly when round-tripping Strategy.content (stored as a JSON string —
# see app/api/strategy.py). TypeAdapter is Pydantic's mechanism for
# validating/serializing a bare type like this one.
StrategyContentAdapter: TypeAdapter[TestPlanContent | DataDrivenStrategyContent] = (
    TypeAdapter(StrategyContent)
)


def primary_audience(
    content: TestPlanContent | DataDrivenStrategyContent,
) -> TargetAudience:
    """The one audience to actually target at publish time, regardless of plan type.

    DATA_DRIVEN_STRATEGY has a single refined `targetAudience`.
    TEST_PLAN generates two variants to A/B test (`audienceVariants`), but
    campaign publish (app/services/publish.py) and the Creative Agent
    (app/services/creative.py) only ever build one AdSet/Ad per campaign
    (PRD.md §5 step 8) — there's no ad-set-level A/B execution infra yet
    ("Phase C" of the test-plan redesign, not yet built). Known
    simplification: the broad/automated baseline (audience_variants[0],
    empty/unconstrained targeting) is what actually gets published to —
    a safe general-purpose default — while the hypothesis-driven variant
    is designed but not independently executed. Revisit alongside that
    step 8 "one Ad" limitation when multi-adset publishing is built.
    """
    if content.plan_type == "TEST_PLAN":
        return content.audience_variants[0].targeting
    return content.target_audience


def daily_budget(content: TestPlanContent | DataDrivenStrategyContent) -> float:
    """The daily budget to actually use, regardless of plan type."""
    if content.plan_type == "TEST_PLAN":
        return content.daily_budget
    return content.budget_recommendation.daily


class StrategyResponse(CamelCaseModel):
    """Public-facing representation of a Strategy."""

    id: str
    campaign_id: str
    content: StrategyContent
    created_at: datetime


class CreateStrategyRequest(CamelCaseModel):
    """Optional answer to the one-time "has this business advertised before?" question.

    Sent along with strategy generation. Only consulted the first time a
    business generates a strategy (while Business.hasPriorAdvertisingExperience
    is still null) and only when no real Meta ad-account history is
    available either — see app/api/strategy.py.
    """

    has_prior_advertising_experience: bool | None = None
