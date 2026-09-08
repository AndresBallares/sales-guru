"""Creative Agent endpoints (PRD.md build step 6)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Campaign, Creative, Product
from prisma.types import CreativeUpdateInput

from app.api.product_image import product_image_url
from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.creative import CreativeResponse, SelectCreativeRequest
from app.schemas.strategy import StrategyContentAdapter
from app.services.campaign_readiness import is_ready
from app.services.creative import (
    CreativeAgentError,
    generate_creatives,
    is_creative_stale,
)

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/creatives",
    tags=["creatives"],
)

_STRATEGY_REQUIRED = "Generate a strategy for this campaign first"
_CREATIVE_NOT_FOUND = "Creative not found"
_PRODUCT_IMAGE_NOT_FOUND = "Product image not found"
_CAMPAIGN_NOT_READY = (
    "Add a product and an audience to this campaign before attaching an image"
)


def _to_response(
    creative: Creative, campaign: Campaign, product: Product | None, business: Business
) -> CreativeResponse:
    """Map a Prisma Creative record to its public response shape.

    Args:
        creative: The Prisma Creative model instance.
        campaign: The creative's parent campaign — needed to compute
            is_stale (app/services/creative.py's is_creative_stale) at
            read time rather than trusting a stored flag.
        product: The campaign's current product, or None if it has none.
            Must be the product identified by campaign.productId when one
            is set.
        business: The campaign's business, for its description snapshot.

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
            "imageUrl": creative.imageUrl,
            "status": creative.status,
            "createdAt": creative.createdAt,
            "isStale": is_creative_stale(creative, campaign, product, business),
        }
    )


async def _current_product(campaign: Campaign) -> Product | None:
    """Fetch the campaign's current product, or None if it has none."""
    if campaign.productId is None:
        return None
    return await db.product.find_unique(where={"id": campaign.productId})


async def _current_business(campaign: Campaign) -> Business:
    """Fetch the campaign's business — always present, unlike product."""
    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input
    return business


async def _list_creatives(campaign: Campaign) -> list[CreativeResponse]:
    """Fetch all creatives for a campaign, oldest first (stable A/B/C/D order)."""
    creatives = await db.creative.find_many(
        where={"campaignId": campaign.id}, order={"createdAt": "asc"}
    )
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return [_to_response(c, campaign, product, business) for c in creatives]


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
            strategy=StrategyContentAdapter.validate_json(strategy.content),
        )
    except CreativeAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    source_description = product.description if product is not None else None
    source_url = product.url if product is not None else None

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
                # Snapshot the business/product this batch was actually
                # grounded in (app/services/creative.py's is_creative_stale
                # compares against this later) — the product fields are
                # None/None when there's no product, same as the prompt
                # itself handling that case; sourceBusinessDescription is
                # always set since a campaign's business is never optional.
                "sourceProductId": product.id if product is not None else None,
                "sourceDescription": source_description,
                "sourceUrl": source_url,
                "sourceBusinessDescription": business.description,
            }
        )
    await db.campaign.update(
        where={"id": campaign.id}, data={"status": "ADS_GENERATED"}
    )

    return await _list_creatives(campaign)


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
    return await _list_creatives(campaign)


@router.post("/{creative_id}/select", response_model=CreativeResponse)
async def select_creative(
    creative_id: str,
    payload: SelectCreativeRequest | None = None,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Mark one creative as the chosen variant, rejecting its siblings.

    Also advances the campaign to PENDING_APPROVAL — selecting a creative is
    what makes the campaign ready for the explicit approval gate (PRD.md
    build step 7). Re-selecting (e.g. after a prior approval) moves the
    campaign back to PENDING_APPROVAL too, since the approved content just
    changed.

    If payload.product_image_id names a photo, that photo is attached as
    imageUrl, overriding whatever was there before — the user explicitly
    chose it. Otherwise, if the campaign's product has at least one
    uploaded photo (PRD.md §2 step 4) and this creative doesn't already
    have an image, the product's oldest photo is attached instead — the
    natural checkpoint moment before publish, and the point where the
    frontend can show the user what image the ad will actually use.

    Args:
        creative_id: The creative to select.
        payload: Optionally names a specific product photo to attach.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-selected creative.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign, or
            if product_image_id doesn't belong to the campaign's product.
            428 if product_image_id is given but the campaign has no
            product and audience attached yet (app/services/
            campaign_readiness.py) — unreachable in the normal flow,
            since generating a strategy already requires readiness, but
            checked here too rather than trusted transitively.
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
    product_image_id = payload.product_image_id if payload is not None else None
    if product_image_id is not None and not is_ready(campaign):
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=_CAMPAIGN_NOT_READY,
        )
    update_data: CreativeUpdateInput = {"status": "SELECTED"}
    if product_image_id is not None:
        product_image = (
            await db.productimage.find_first(
                where={"id": product_image_id, "productId": campaign.productId}
            )
            if campaign.productId is not None
            else None
        )
        if product_image is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=_PRODUCT_IMAGE_NOT_FOUND
            )
        update_data["imageUrl"] = product_image_url(product_image.id)
    elif creative.imageUrl is None and campaign.productId is not None:
        product_image = await db.productimage.find_first(
            where={"productId": campaign.productId}, order={"createdAt": "asc"}
        )
        if product_image is not None:
            update_data["imageUrl"] = product_image_url(product_image.id)
    updated = await db.creative.update(where={"id": creative.id}, data=update_data)
    assert updated is not None  # just fetched above, can't vanish mid-request

    await db.campaign.update(
        where={"id": campaign.id}, data={"status": "PENDING_APPROVAL"}
    )

    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)
