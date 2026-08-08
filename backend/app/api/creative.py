"""Creative Agent endpoints (PRD.md build step 6)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, Creative

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.creative import CreativeResponse
from app.schemas.strategy import StrategyContent
from app.services.creative import CreativeAgentError, generate_creatives

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/creatives",
    tags=["creatives"],
)

_STRATEGY_REQUIRED = "Generate a strategy for this campaign first"
_CREATIVE_NOT_FOUND = "Creative not found"


def _to_response(creative: Creative) -> CreativeResponse:
    """Map a Prisma Creative record to its public response shape.

    Args:
        creative: The Prisma Creative model instance.

    Returns:
        The public-facing representation.
    """
    return CreativeResponse.model_validate(
        {
            "id": creative.id,
            "campaignId": creative.campaignId,
            "adId": creative.adId,
            "headline": creative.headline,
            "bodyText": creative.bodyText,
            "description": creative.description,
            "cta": creative.cta,
            "creativeAngle": creative.creativeAngle,
            "imagePrompt": creative.imagePrompt,
            "videoPrompt": creative.videoPrompt,
            "status": creative.status,
            "createdAt": creative.createdAt,
        }
    )


async def _list_creatives(campaign_id: str) -> list[CreativeResponse]:
    """Fetch all creatives for a campaign, oldest first (stable A/B/C/D order)."""
    creatives = await db.creative.find_many(
        where={"campaignId": campaign_id}, order={"createdAt": "asc"}
    )
    return [_to_response(c) for c in creatives]


@router.post(
    "", response_model=list[CreativeResponse], status_code=status.HTTP_201_CREATED
)
async def create_creatives(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[CreativeResponse]:
    """Generate a batch of ad creatives for a campaign, replacing any existing ones.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The four newly generated creative variants.

    Raises:
        HTTPException: 400 if the campaign has no strategy yet; 500 if the
            Creative Agent isn't configured or the LLM call fails.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_STRATEGY_REQUIRED
        )

    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )

    try:
        variants = await generate_creatives(
            business=business,
            product=product,
            strategy=StrategyContent.model_validate_json(strategy.content),
        )
    except CreativeAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    await db.creative.delete_many(where={"campaignId": campaign.id})
    for variant in variants:
        await db.creative.create(
            data={
                "campaignId": campaign.id,
                "headline": variant.headline,
                "bodyText": variant.body_text,
                "description": variant.description,
                "cta": variant.cta,
                "creativeAngle": variant.creative_angle,
                "imagePrompt": variant.image_prompt,
                "videoPrompt": variant.video_prompt,
            }
        )
    await db.campaign.update(
        where={"id": campaign.id}, data={"status": "ADS_GENERATED"}
    )

    return await _list_creatives(campaign.id)


@router.get("", response_model=list[CreativeResponse])
async def list_creatives(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[CreativeResponse]:
    """List the creatives already generated for a campaign.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's creative variants, oldest first.
    """
    return await _list_creatives(campaign.id)


@router.post("/{creative_id}/select", response_model=CreativeResponse)
async def select_creative(
    creative_id: str,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Mark one creative as the chosen variant, rejecting its siblings.

    Also advances the campaign to PENDING_APPROVAL — selecting a creative is
    what makes the campaign ready for the explicit approval gate (PRD.md
    build step 7). Re-selecting (e.g. after a prior approval) moves the
    campaign back to PENDING_APPROVAL too, since the approved content just
    changed.

    Args:
        creative_id: The creative to select.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-selected creative.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign.
    """
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )

    await db.creative.update_many(
        where={"campaignId": campaign.id, "NOT": [{"id": creative.id}]},
        data={"status": "REJECTED"},
    )
    updated = await db.creative.update(
        where={"id": creative.id}, data={"status": "SELECTED"}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request

    await db.campaign.update(
        where={"id": campaign.id}, data={"status": "PENDING_APPROVAL"}
    )

    return _to_response(updated)
