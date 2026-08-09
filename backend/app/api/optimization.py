"""Campaign Optimization Agent endpoints (PRD.md build step 10)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, OptimizationRecommendation

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.optimization import RecommendationResponse
from app.services.meta import MetaConnectionError
from app.services.optimization_jobs import (
    apply_recommendation,
    generate_and_store_recommendation,
)
from app.services.optimizer import OptimizerError

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/optimize",
    tags=["optimization"],
)

_NOT_LIVE_YET = "Publish this campaign before requesting optimization recommendations"
_NO_METRICS_YET = "Refresh results at least once before requesting a recommendation"
_NOT_ENOUGH_HISTORY = (
    "Not enough historical data yet — check back after metrics have been "
    "collected over a longer period"
)
_RECOMMENDATION_NOT_FOUND = "Recommendation not found"
_NOT_PENDING = "This recommendation has already been acted on"


def _to_response(rec: OptimizationRecommendation) -> RecommendationResponse:
    """Map a Prisma OptimizationRecommendation record to its public response shape.

    Args:
        rec: The Prisma OptimizationRecommendation model instance.

    Returns:
        The public-facing representation.
    """
    # model_validate (not the constructor) because actionType/status/risk
    # are plain str here (Prisma, no native enum — PRD.md §7) and need
    # real runtime validation against the Literal, not a static cast —
    # same reasoning as StrategyContent.model_validate in app/api/strategy.py.
    return RecommendationResponse.model_validate(
        {
            "id": rec.id,
            "campaignId": rec.campaignId,
            "actionType": rec.actionType,
            "targetAdId": rec.targetAdId,
            "currentBudget": rec.currentBudget,
            "suggestedBudget": rec.suggestedBudget,
            "reasoning": rec.reasoning,
            "confidence": rec.confidence,
            "risk": rec.risk,
            "requiresApproval": rec.requiresApproval,
            "status": rec.status,
            "createdAt": rec.createdAt,
        }
    )


@router.post(
    "", response_model=RecommendationResponse, status_code=status.HTTP_201_CREATED
)
async def create_recommendation(
    campaign: Campaign = Depends(get_owned_campaign),
) -> RecommendationResponse:
    """Generate a new optimization recommendation for a live campaign, right now.

    A manual, user-triggered "analyze now" — bypasses the scheduled job's
    Event + Time + Data Sufficiency gate (app/services/optimizer.py's
    has_sufficient_data) since the user is explicitly asking for analysis
    this moment, but still requires enough historical spread to compute
    at least one real trend window (see generate_and_store_recommendation).

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly generated (PENDING) recommendation.

    Raises:
        HTTPException: 400 if the campaign isn't live yet, has no
            performance data yet, or doesn't have enough historical
            spread yet for a trend window; 500 if the LLM call fails.
    """
    if campaign.status != "LIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_LIVE_YET
        )

    has_metrics = await db.metric.find_first(where={"campaignId": campaign.id})
    if has_metrics is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_METRICS_YET
        )

    try:
        rec = await generate_and_store_recommendation(campaign)
    except OptimizerError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    if rec is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_ENOUGH_HISTORY
        )

    return _to_response(rec)


@router.get("", response_model=list[RecommendationResponse])
async def list_recommendations(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[RecommendationResponse]:
    """List a campaign's recommendations, most recent first.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's recommendations — an empty list if none have been
        generated yet.
    """
    recs = await db.optimizationrecommendation.find_many(
        where={"campaignId": campaign.id}, order={"createdAt": "desc"}
    )
    return [_to_response(r) for r in recs]


async def _get_pending_recommendation(
    recommendation_id: str, campaign_id: str
) -> OptimizationRecommendation:
    """Fetch a campaign's recommendation by id, requiring it's still PENDING.

    Args:
        recommendation_id: The recommendation to look up.
        campaign_id: The campaign it must belong to.

    Returns:
        The recommendation.

    Raises:
        HTTPException: 404 if it doesn't exist on this campaign; 400 if
            it's already been acted on.
    """
    rec = await db.optimizationrecommendation.find_first(
        where={"id": recommendation_id, "campaignId": campaign_id}
    )
    if rec is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_RECOMMENDATION_NOT_FOUND
        )
    if rec.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_PENDING
        )
    return rec


@router.post("/{recommendation_id}/approve", response_model=RecommendationResponse)
async def approve_recommendation(
    recommendation_id: str,
    campaign: Campaign = Depends(get_owned_campaign),
) -> RecommendationResponse:
    """Approve a recommendation — applies it to Meta immediately.

    One explicit click both approves and applies (same "approve = act"
    shape as "Approve & Publish", PRD.md build step 8) — there's no
    separate APPROVED-but-not-yet-applied state to sit in. The actual
    Meta call is shared with the scheduled job's auto-apply path — see
    app/services/optimization_jobs.py's apply_recommendation.

    Args:
        recommendation_id: The recommendation to approve.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-APPLIED recommendation.

    Raises:
        HTTPException: 404 if the recommendation doesn't exist on this
            campaign; 400 if it isn't PENDING (already acted on); 500 if
            the Meta API call fails.
    """
    rec = await _get_pending_recommendation(recommendation_id, campaign.id)

    try:
        updated = await apply_recommendation(rec)
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return _to_response(updated)


@router.post("/{recommendation_id}/reject", response_model=RecommendationResponse)
async def reject_recommendation(
    recommendation_id: str,
    campaign: Campaign = Depends(get_owned_campaign),
) -> RecommendationResponse:
    """Reject a recommendation — no Meta call, just records the decision.

    Args:
        recommendation_id: The recommendation to reject.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-REJECTED recommendation.

    Raises:
        HTTPException: 404 if the recommendation doesn't exist on this
            campaign; 400 if it isn't PENDING (already acted on).
    """
    rec = await _get_pending_recommendation(recommendation_id, campaign.id)
    updated = await db.optimizationrecommendation.update(
        where={"id": rec.id}, data={"status": "REJECTED"}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)
