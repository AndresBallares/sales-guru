"""Schemas for the TEST_PLAN Optimizer.

PRD.md §5 step 10, "Phase B" of the test-plan redesign (confirmed
2026-09-01) — compares real Metric history against the original
Strategy.content (the persisted TEST_PLAN) to answer "did the campaign
accomplish what the test set out to test?" Distinct from
app/schemas/optimization.py's OptimizationRecommendation, which reacts to
a live campaign's own metrics with a PAUSE/INCREASE/DECREASE action
regardless of plan type — this is specifically about evaluating a
TEST_PLAN's hypothesis.
"""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel

TestEvaluationStatus = Literal["SUFFICIENT_DATA", "INSUFFICIENT_DATA"]
# LOW: below MIN_CONVERSIONS_TO_COMPARE_VARIANTS on either side (no real
# comparison at all — compute_test_result stays INCONCLUSIVE here too).
# DIRECTIONAL: both sides clear that floor, a first real read, but haven't
# yet cleared MIN_CONVERSIONS_FOR_CONFIDENT_RESULT conversions and
# MIN_SPEND_MULTIPLE_OF_TARGET_CAC x target CAC spent on both sides.
# CONFIDENT: both gates cleared on both variants. Backend-computed
# (app/services/optimizer.py's compute_test_confidence) from real
# conversion/spend volume, never the LLM's self-assessment — declaring how
# much to trust an A/B test's CAC comparison is a deterministic read of
# sample size, not a judgment call.
Confidence = Literal["LOW", "DIRECTIONAL", "CONFIDENT"]
HypothesisResult = Literal["SUPPORTED", "REJECTED", "INCONCLUSIVE"]
# Why a TEST_PLAN evaluation ran — MANUAL is a human's "Evaluate now"
# click; the other three are the two auto-pause paths
# (app/services/optimization_jobs.py) each auto-triggering an evaluation
# right after they pause a TEST_PLAN campaign.
StopReason = Literal[
    "MANUAL",
    "TEST_DURATION_ELAPSED",
    "TOTAL_SPEND_CIRCUIT_BREAKER",
    "CAC_CIRCUIT_BREAKER",
]

# What the LLM may choose — diagnostic/iteration actions only, never a
# variant-preference call. Declaring an A/B test's winner is a
# deterministic computation on real CAC data (app/services/optimizer.py's
# compute_test_result), not a judgment call, so prefer_broad/
# prefer_hypothesis are never offered to the model as a choice — see
# GeneratedTestEvaluation's docstring.
GeneratedRecommendedAction = Literal[
    "continue_testing",
    "test_new_creative",
    "investigate_offer_or_landing_page",
    "investigate_checkout_or_purchase_friction",
]

# The full stored/API set — adds prefer_broad/prefer_hypothesis, which
# only the backend ever sets (app/services/optimizer.py's
# compute_test_result), once real per-variant CAC data with enough
# conversion volume on both sides exists (PRD.md build step 5 "Phase C"
# plus step 10's per-AdSet metric collection, confirmed 2026-09-02).
RecommendedAction = Literal[
    "continue_testing",
    "test_new_creative",
    "investigate_offer_or_landing_page",
    "investigate_checkout_or_purchase_friction",
    "prefer_broad",
    "prefer_hypothesis",
]


class GeneratedTestEvaluation(CamelCaseModel):
    """The fields the LLM generates for a TEST_PLAN evaluation, as a forced tool call.

    status/winning_variant/hypothesis_result/confidence are deliberately
    NOT generated here — they're backend-computed/fixed (see
    app/services/optimizer.py's evaluate_test_plan/compute_test_result/
    compute_test_confidence) — asking the model to self-report whether its
    own analysis has "enough data," to name a winning variant, or to rate
    its own confidence is exactly the kind of deterministic-or-impossible
    calculation PRD.md's Optimizer Agent responsibilities say the LLM must
    not own — true regardless of whether real per-variant data exists yet.
    confidence in particular is a direct read of sample size (conversions
    and spend against the target CAC), not a qualitative judgment call
    like GeneratedRecommendation.risk (app/schemas/optimization.py) is.
    """

    key_findings: list[str]
    recommended_action: GeneratedRecommendedAction
    reasoning: str


class TestEvaluationResponse(CamelCaseModel):
    """Public-facing representation of a stored TestEvaluation.

    winning_variant/hypothesis_result are non-null/non-"INCONCLUSIVE"
    only once both of a TEST_PLAN's real AdSets have collected enough
    conversion volume to compare (app/services/optimizer.py's
    compute_test_result) — before that (including any campaign published
    before "Phase C" existed), they stay null/"INCONCLUSIVE".
    """

    id: str
    campaign_id: str
    status: TestEvaluationStatus
    winning_variant: Literal["broad_baseline", "hypothesis_audience"] | None
    confidence: Confidence
    hypothesis_result: HypothesisResult
    key_findings: list[str]
    recommended_action: RecommendedAction
    reasoning: str
    stop_reason: StopReason
    created_at: datetime
