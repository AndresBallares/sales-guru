"""TEST_PLAN Optimizer endpoints ("Phase B" of the test-plan redesign).

PRD.md §5 step 10, confirmed 2026-09-01. Distinct from app/api/
optimization.py's endpoints, which apply regardless of plan type — this
is specifically about evaluating a TEST_PLAN's hypothesis against real
Metric history.
"""

import json

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, TestEvaluation

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.strategy import StrategyContentAdapter
from app.schemas.test_evaluation import TestEvaluationResponse
from app.services.optimization_jobs import generate_and_store_test_evaluation
from app.services.optimizer import OptimizerError

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation",
    tags=["test-evaluation"],
)

_NOT_LIVE_YET = "Publish this campaign before requesting a test evaluation"
_NO_STRATEGY_YET = "Generate a strategy for this campaign first"
_NOT_A_TEST_PLAN = "This campaign's strategy is not a TEST_PLAN"
_NO_METRICS_YET = "Refresh results at least once before requesting an evaluation"


def _to_response(evaluation: TestEvaluation) -> TestEvaluationResponse:
    """Map a Prisma TestEvaluation record to its public response shape.

    Args:
        evaluation: The Prisma TestEvaluation model instance.

    Returns:
        The public-facing representation, with keyFindings parsed from
        its stored JSON string (SQLite has no native array type, same
        pattern as Strategy.content).
    """
    return TestEvaluationResponse.model_validate(
        {
            "id": evaluation.id,
            "campaignId": evaluation.campaignId,
            "status": evaluation.status,
            "winningVariant": evaluation.winningVariant,
            "confidence": evaluation.confidence,
            "hypothesisResult": evaluation.hypothesisResult,
            "keyFindings": json.loads(evaluation.keyFindings),
            "recommendedAction": evaluation.recommendedAction,
            "reasoning": evaluation.reasoning,
            "createdAt": evaluation.createdAt,
        }
    )


@router.post(
    "", response_model=TestEvaluationResponse, status_code=status.HTTP_201_CREATED
)
async def create_test_evaluation(
    campaign: Campaign = Depends(get_owned_campaign),
) -> TestEvaluationResponse:
    """Evaluate a TEST_PLAN campaign against its real performance, right now.

    A manual, user-triggered "evaluate now" — not yet wired into the
    scheduled optimization job (a deliberate "Phase B" scoping choice,
    confirmed 2026-09-01, kept separate from evaluate_all_live_campaigns
    so this addition stays reviewable).

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly generated evaluation — SUFFICIENT_DATA or
        INSUFFICIENT_DATA are both valid, stored results, not errors.

    Raises:
        HTTPException: 400 if the campaign isn't live yet, has no
            strategy, has a DATA_DRIVEN_STRATEGY (not a TEST_PLAN), or
            has no performance data yet; 500 if the LLM call fails.
    """
    if campaign.status != "LIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_LIVE_YET
        )

    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_STRATEGY_YET
        )

    content = StrategyContentAdapter.validate_json(strategy.content)
    if content.plan_type != "TEST_PLAN":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_A_TEST_PLAN
        )

    has_metrics = await db.metric.find_first(where={"campaignId": campaign.id})
    if has_metrics is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_METRICS_YET
        )

    try:
        evaluation = await generate_and_store_test_evaluation(campaign, content)
    except OptimizerError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return _to_response(evaluation)


@router.get("", response_model=list[TestEvaluationResponse])
async def list_test_evaluations(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[TestEvaluationResponse]:
    """List a campaign's test evaluations, most recent first.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's evaluations — an empty list if none have been
        generated yet.
    """
    evaluations = await db.testevaluation.find_many(
        where={"campaignId": campaign.id}, order={"createdAt": "desc"}
    )
    return [_to_response(e) for e in evaluations]
