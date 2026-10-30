"""Follow-up creative rounds on a creative test campaign.

Round 1 is the campaign's first batch (api/creative.py); a round is a further
batch of fresh ads the user picks from, 1 to 4 of them, to publish later. This
module only generates, lists, selects within and deletes rounds: selecting never
changes the campaign's status or touches a live ad, and nothing here publishes.
"""

import json
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from prisma.models import Campaign, CreativeRound
from prisma.types import CreativeUpdateInput, CreativeWhereInput

from app.api.creative import (
    _current_business,
    _current_product,
    _to_response,
    generate_batch,
)
from app.api.product_image import product_image_url
from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.creative_round import CreativeRoundResponse, CreativeRoundStatus
from app.schemas.strategy import (
    CreativeAngle,
    CreativeTestPlanContent,
    GeneratedCreativeAngle,
    StrategyContentAdapter,
)
from app.services.creative import test_ads_required
from app.services.strategist import StrategistError, generate_round_angles

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/rounds",
    tags=["creative-rounds"],
)

_NEEDS_CREATIVE_TEST = "Creative rounds are only available for a creative test"
_NEEDS_FIRST_BATCH = "Generate the campaign's first ads before adding a round"
_ROUND_ALREADY_OPEN = (
    "This campaign already has an open round; finish or delete it before "
    "starting another"
)
_ROUND_NOT_FOUND = "Round not found"
_CREATIVE_NOT_FOUND = "Creative not found"
_ROUND_CLOSED = "This round is closed and can no longer be changed"
_ROUND_HAS_LIVE_ADS = "This round has ads on Meta and cannot be deleted"
_NO_PRODUCT_PHOTO = "Add a photo to the product before selecting an ad"


async def _round_response(
    campaign: Campaign, round_: CreativeRound
) -> CreativeRoundResponse:
    """Map a round and its ads to the public response."""
    creatives = await db.creative.find_many(
        where={"campaignId": campaign.id, "roundId": round_.id},
        order={"createdAt": "asc"},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return CreativeRoundResponse(
        id=round_.id,
        campaign_id=round_.campaignId,
        number=round_.number,
        status=cast(CreativeRoundStatus, round_.status),
        generated_count=round_.generatedCount,
        selected_count=round_.selectedCount,
        angles=[
            GeneratedCreativeAngle.model_validate(a) for a in json.loads(round_.angles)
        ],
        creatives=[_to_response(c, campaign, product, business) for c in creatives],
        created_at=round_.createdAt,
    )


async def _owned_round(round_id: str, campaign: Campaign) -> CreativeRound:
    round_ = await db.creativeround.find_first(
        where={"id": round_id, "campaignId": campaign.id}
    )
    if round_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_ROUND_NOT_FOUND
        )
    return round_


async def _sync_selected_count(round_: CreativeRound) -> CreativeRound:
    """Store how many of the round's ads are selected on the round itself."""
    selected = await db.creative.count(
        where={"roundId": round_.id, "status": "SELECTED"}
    )
    updated = await db.creativeround.update(
        where={"id": round_.id}, data={"selectedCount": selected}
    )
    assert updated is not None  # just fetched, can't vanish mid-request
    return updated


async def _delete_round_rows(round_id: str) -> None:
    """Delete a round's ads, their cards and the round (no cascade in this schema)."""
    ids = [c.id for c in await db.creative.find_many(where={"roundId": round_id})]
    if ids:
        await db.creativecard.delete_many(where={"creativeId": {"in": ids}})
    await db.creative.delete_many(where={"roundId": round_id})
    await db.creativeround.delete(where={"id": round_id})


@router.post(
    "", response_model=CreativeRoundResponse, status_code=status.HTTP_201_CREATED
)
async def create_round(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeRoundResponse:
    """Generate a new round of ads on angles no earlier round used.

    Four ads, or three when the product lacks a fourth photo or video. The
    user selects 1 to 4 of them afterwards.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The new, open round with its ads.

    Raises:
        HTTPException: 400 if the campaign is not a creative test or has no
            first batch of ads yet; 409 if a round is already open; 500 if the
            Strategist or Creative Agent fails (nothing is kept).
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    plan = (
        StrategyContentAdapter.validate_json(strategy.content)
        if strategy is not None
        else None
    )
    if not isinstance(plan, CreativeTestPlanContent):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NEEDS_CREATIVE_TEST
        )
    if await db.creative.count(where={"campaignId": campaign.id, "roundId": None}) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NEEDS_FIRST_BATCH
        )
    earlier = await db.creativeround.find_many(
        where={"campaignId": campaign.id}, order={"number": "asc"}
    )
    if any(r.status == "OPEN" for r in earlier):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_ALREADY_OPEN
        )

    count = await test_ads_required(campaign, plan)
    excluded = list(plan.creative_angles)
    for r in earlier:
        excluded += [CreativeAngle.model_validate(a) for a in json.loads(r.angles)]

    business = await _current_business(campaign)
    product = await _current_product(campaign)
    audience = (
        await db.audience.find_unique(where={"id": campaign.audienceId})
        if campaign.audienceId
        else None
    )
    brand_profile = await db.brandprofile.find_unique(where={"businessId": business.id})
    try:
        angles = await generate_round_angles(
            business=business,
            product=product,
            audience=audience,
            plan=plan,
            excluded_angles=excluded,
            count=count,
            brand_profile=brand_profile,
            campaign_id=campaign.id,
        )
    except StrategistError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    round_ = await db.creativeround.create(
        data={
            "campaignId": campaign.id,
            "number": max((r.number for r in earlier), default=1) + 1,
            "generatedCount": count,
            "angles": json.dumps([a.model_dump(mode="json") for a in angles]),
        }
    )
    round_plan = plan.model_copy(
        update={
            "creative_angles": [CreativeAngle(**a.model_dump()) for a in angles],
        }
    )
    try:
        await generate_batch(
            campaign, plan_override=round_plan, round_id=round_.id, batch_size=count
        )
    except HTTPException:
        # generate_batch raised (including its own 500 for a Creative Agent
        # failure): keep no half-made round.
        await _delete_round_rows(round_.id)
        raise
    return await _round_response(campaign, round_)


@router.get("", response_model=list[CreativeRoundResponse])
async def list_rounds(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[CreativeRoundResponse]:
    """List a campaign's follow-up rounds, oldest first, with their ads."""
    rounds = await db.creativeround.find_many(
        where={"campaignId": campaign.id}, order={"number": "asc"}
    )
    return [await _round_response(campaign, r) for r in rounds]


@router.get("/{round_id}", response_model=CreativeRoundResponse)
async def get_round(
    round_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Fetch one round with its ads (404 if it is not this campaign's)."""
    return await _round_response(campaign, await _owned_round(round_id, campaign))


@router.delete("/{round_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_round(
    round_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> Response:
    """Delete a round and its ads, freeing the campaign's single round slot.

    Raises:
        HTTPException: 404 if the round is not this campaign's; 409 if any of
            its ads is already on Meta.
    """
    round_ = await _owned_round(round_id, campaign)
    on_meta: CreativeWhereInput = {
        "roundId": round_.id,
        "OR": [{"NOT": [{"adId": None}]}, {"NOT": [{"metaCreativeId": None}]}],
    }
    live = await db.creative.count(where=on_meta)
    if live:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_HAS_LIVE_ADS
        )
    await _delete_round_rows(round_.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _change_selection(
    round_id: str, creative_id: str, campaign: Campaign, *, select: bool
) -> CreativeRoundResponse:
    """Select or deselect one of an open round's ads.

    Only the ad's own status and the round's selectedCount change: never the
    campaign's status, round 1, or any ad already on Meta.
    """
    round_ = await _owned_round(round_id, campaign)
    if round_.status != "OPEN":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_ROUND_CLOSED)
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id, "roundId": round_.id}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )
    data: CreativeUpdateInput = {"status": "SELECTED" if select else "GENERATED"}
    if select and creative.format == "SINGLE_IMAGE" and creative.imageUrl is None:
        photo = (
            await db.productimage.find_first(
                where={"productId": campaign.productId, "mediaType": "IMAGE"},
                order={"position": "asc"},
            )
            if campaign.productId is not None
            else None
        )
        if campaign.productId is not None and photo is None:
            raise HTTPException(
                status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                detail=_NO_PRODUCT_PHOTO,
            )
        if photo is not None:
            data["imageUrl"] = product_image_url(photo.id)
            data["productImageId"] = photo.id
    await db.creative.update(where={"id": creative.id}, data=data)
    return await _round_response(campaign, await _sync_selected_count(round_))


@router.post("/{round_id}/creatives/{creative_id}/select")
async def select_round_creative(
    round_id: str, creative_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Select one of an open round's ads (any number from 1 to all of them)."""
    return await _change_selection(round_id, creative_id, campaign, select=True)


@router.post("/{round_id}/creatives/{creative_id}/deselect")
async def deselect_round_creative(
    round_id: str, creative_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Take one of an open round's ads out of the selection."""
    return await _change_selection(round_id, creative_id, campaign, select=False)
