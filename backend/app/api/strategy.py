"""Marketing Strategist Agent endpoints (PRD.md build step 5)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, Strategy

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.strategy import StrategyContent, StrategyResponse
from app.services.strategist import StrategistError, generate_strategy

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/strategy",
    tags=["strategy"],
)

_STRATEGY_NOT_FOUND = "Strategy not found"


def _to_response(strategy: Strategy) -> StrategyResponse:
    """Map a Prisma Strategy record to its public response shape.

    Args:
        strategy: The Prisma Strategy model instance.

    Returns:
        The public-facing representation, with `content` parsed from its
        stored JSON string into a structured object.
    """
    return StrategyResponse(
        id=strategy.id,
        campaign_id=strategy.campaignId,
        content=StrategyContent.model_validate_json(strategy.content),
        created_at=strategy.createdAt,
    )


@router.post("", response_model=StrategyResponse, status_code=status.HTTP_201_CREATED)
async def create_strategy(
    campaign: Campaign = Depends(get_owned_campaign),
) -> StrategyResponse:
    """Generate a strategy for a campaign, replacing any existing one.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly generated strategy.

    Raises:
        HTTPException: 500 if the Strategist Agent isn't configured or the
            LLM call fails.
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

    try:
        content = await generate_strategy(
            business=business,
            product=product,
            audience=audience,
            objective=campaign.objective,
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
