"""Marketing Strategist Agent endpoints (PRD.md build step 5).

Two-mode agent (confirmed with the user 2026-08-31) — see app/services/
strategist.py's module docstring for the full reasoning. This module owns
plan_type resolution, since it's the only layer with DB/Meta-network
access: real Meta ad-account history always wins when available; otherwise
falls back to the business's one-time self-reported answer, asking for it
(428) if it's never been given and no real history exists either.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, Strategy

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.strategy import (
    CreateStrategyRequest,
    StrategyContentAdapter,
    StrategyResponse,
)
from app.services.meta import (
    AccountCampaignInsights,
    MetaConnectionError,
    fetch_account_historical_performance,
    has_meaningful_history,
)
from app.services.strategist import PlanType, StrategistError, generate_strategy

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/strategy",
    tags=["strategy"],
)

_STRATEGY_NOT_FOUND = "Strategy not found"
_ANSWER_REQUIRED = (
    "Has this business run advertising campaigns before? Answer required "
    "before a strategy can be generated."
)


def _to_response(strategy: Strategy) -> StrategyResponse:
    """Map a Prisma Strategy record to its public response shape.

    Args:
        strategy: The Prisma Strategy model instance.

    Returns:
        The public-facing representation, with `content` parsed from its
        stored JSON string into the right plan-type model.
    """
    return StrategyResponse(
        id=strategy.id,
        campaign_id=strategy.campaignId,
        content=StrategyContentAdapter.validate_json(strategy.content),
        created_at=strategy.createdAt,
    )


@router.post("", response_model=StrategyResponse, status_code=status.HTTP_201_CREATED)
async def create_strategy(
    body: CreateStrategyRequest | None = None,
    campaign: Campaign = Depends(get_owned_campaign),
) -> StrategyResponse:
    """Generate a strategy for a campaign, replacing any existing one.

    Args:
        body: Optionally answers the one-time "has this business
            advertised before?" question — only consulted when needed
            (see module docstring). None (no body sent at all) is treated
            the same as an unanswered question.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly generated strategy.

    Raises:
        HTTPException: 428 if plan-type can't be determined yet (no real
            Meta history, business hasn't answered the one-time question,
            and this request didn't answer it either) — the frontend
            should prompt the user and resubmit with an answer. 500 if the
            Strategist Agent isn't configured or the LLM call fails.
    """
    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )
    audience = (
        await db.audience.find_unique(where={"id": campaign.audienceId})
        if campaign.audienceId
        else None
    )

    meta_connection = await db.metaconnection.find_unique(
        where={"businessId": business.id}
    )
    account_history: list[AccountCampaignInsights] = []
    if meta_connection is not None and meta_connection.adAccountId is not None:
        try:
            account_history = await fetch_account_historical_performance(
                access_token=meta_connection.accessToken,
                ad_account_id=meta_connection.adAccountId,
            )
        except MetaConnectionError:
            # Degrade to the self-report path rather than blocking strategy
            # generation on a Meta Insights outage.
            account_history = []

    plan_type: PlanType
    if has_meaningful_history(account_history):
        plan_type = "DATA_DRIVEN_STRATEGY"
    else:
        prior_experience = business.hasPriorAdvertisingExperience
        if prior_experience is None:
            prior_experience = (
                body.has_prior_advertising_experience if body is not None else None
            )
            if prior_experience is None:
                raise HTTPException(
                    status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                    detail=_ANSWER_REQUIRED,
                )
            business = await db.business.update(
                where={"id": business.id},
                data={"hasPriorAdvertisingExperience": prior_experience},
            )
            assert business is not None  # just fetched above, can't vanish mid-request
        plan_type = "DATA_DRIVEN_STRATEGY" if prior_experience else "TEST_PLAN"

    try:
        content = await generate_strategy(
            business=business,
            product=product,
            audience=audience,
            objective=campaign.objective,
            plan_type=plan_type,
            account_history=account_history,
        )
    except StrategistError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    await db.strategy.delete_many(where={"campaignId": campaign.id})
    strategy = await db.strategy.create(
        data={
            "campaignId": campaign.id,
            "content": content.model_dump_json(by_alias=True),
        }
    )
    await db.campaign.update(
        where={"id": campaign.id}, data={"status": "STRATEGY_GENERATED"}
    )

    return _to_response(strategy)


@router.get("", response_model=StrategyResponse)
async def get_strategy(
    campaign: Campaign = Depends(get_owned_campaign),
) -> StrategyResponse:
    """Fetch the strategy already generated for a campaign.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's strategy.

    Raises:
        HTTPException: 404 if no strategy has been generated yet.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_STRATEGY_NOT_FOUND
        )
    return _to_response(strategy)
