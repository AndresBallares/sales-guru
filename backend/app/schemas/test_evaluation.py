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

# Excludes prefer_broad/prefer_hypothesis — those require the cross-variant
# comparison real two-adset publishing would enable ("Phase C", not built
# yet: campaign publish still creates exactly one AdSet, app/services/
# publish.py), so there's no real data for the hypothesis-driven variant
# to compare the published broad-baseline variant against.
RecommendedAction = Literal[
    "continue_testing",
    "test_new_creative",
    "investigate_offer_or_landing_page",
    "investigate_checkout_or_purchase_friction",
]


class GeneratedTestEvaluation(CamelCaseModel):
    """The fields the LLM generates for a TEST_PLAN evaluation, as a forced tool call.

    confidence is the model's own self-assessment, same pattern as
    GeneratedRecommendation.risk (app/schemas/optimization.py).
    status/winning_variant/hypothesis_result are deliberately NOT
    generated here — they're backend-computed/fixed (see
    app/services/optimizer.py's evaluate_test_plan) — asking the model to
    self-report whether its own analysis has "enough data," or to name a
    winning variant with no real data for the other one, is exactly the
    kind of deterministic-or-impossible calculation PRD.md's Optimizer
    Agent responsibilities say the LLM must not own.
    """

    key_findings: list[str]
    recommended_action: RecommendedAction
    reasoning: str
    confidence: Confidence


class TestEvaluationResponse(CamelCaseModel):
    """Public-facing representation of a stored TestEvaluation.

    winning_variant is always null and hypothesis_result is always
    "INCONCLUSIVE" today — see the model's doc comment in schema.prisma
    for why (no real per-variant data exists until "Phase C").
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
