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
Confidence = Literal["LOW", "MEDIUM", "HIGH"]
HypothesisResult = Literal["SUPPORTED", "REJECTED", "INCONCLUSIVE"]

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

    confidence is the model's own self-assessment, same pattern as
    GeneratedRecommendation.risk (app/schemas/optimization.py).
    status/winning_variant/hypothesis_result are deliberately NOT
    generated here — they're backend-computed/fixed (see
    app/services/optimizer.py's evaluate_test_plan/compute_test_result)
    — asking the model to self-report whether its own analysis has
    "enough data," or to name a winning variant, is exactly the kind of
    deterministic-or-impossible calculation PRD.md's Optimizer Agent
    responsibilities say the LLM must not own — true regardless of
    whether real per-variant data exists yet.
    """

    key_findings: list[str]
    recommended_action: GeneratedRecommendedAction
    reasoning: str
    confidence: Confidence


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
    created_at: datetime
