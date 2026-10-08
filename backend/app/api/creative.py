"""Creative Agent endpoints (PRD.md build step 6)."""

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Campaign, Creative, Product, ProductImage
from prisma.types import CreativeCreateInput, CreativeUpdateInput

from app.api.product_image import (
    get_primary_image,
    product_image_url,
    product_thumbnail_url,
)
from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.creative import (
    MAX_CAROUSEL_CARDS,
    MIN_CAROUSEL_CARDS,
    CreateCreativesRequest,
    CreativeFormat,
    CreativeResponse,
    RegenerateCreativeRequest,
    ReorderCreativeCardsRequest,
    SelectCreativeRequest,
    SetCreativeImageRequest,
)
from app.schemas.strategy import (
    MAX_CREATIVE_ANGLES,
    MIN_CREATIVE_ANGLES,
    StrategyContentAdapter,
)
from app.services.campaign_readiness import is_ready
from app.services.creative import (
    CreativeAgentError,
    VideoInput,
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
_NO_PRODUCT_PHOTO = "Add at least one product photo before selecting an ad to publish"
_CAROUSEL_NEEDS_PRODUCT = (
    "Add a product to this campaign before generating a carousel ad"
)
_CAROUSEL_NEEDS_MORE_PHOTOS = (
    f"A carousel ad needs at least {MIN_CAROUSEL_CARDS} product photos "
    f"(this product has {{count}})"
)
_CAROUSEL_NEEDS_DESTINATION_URL = (
    "Add a product URL or a business website before generating a carousel "
    "ad — every card needs somewhere to link to"
)
_NOT_A_CAROUSEL = "This creative isn't a carousel"
_VIDEO_TEST_VIDEOS_ONLY = (
    "This is a video test: every ad in it must be a video, so images can't be mixed in"
)
_IMAGE_TEST_IMAGES_ONLY = (
    "This is an image test: every ad in it must be a single image, so "
    "videos can't be mixed in"
)
_NEEDS_PRODUCT_VIDEO = "Add a video to this product's photos before creating video ads"
_NO_PRODUCT_VIDEO = (
    "Add at least one product video before selecting a video ad to publish"
)
_VIDEO_GONE = "This ad's video no longer exists — pick another video"
_CREATIVE_PLAN_SINGLE_IMAGE_ONLY = (
    "A creative test plan uses single-image ads only for now"
)
_NOT_A_CREATIVE_TEST_PLAN = (
    "Only a creative test plan lets you add or remove ads from the test"
)
_TEST_FULL = "A creative test runs at most {max} ads — remove one before adding another"
_TEST_ALREADY_PUBLISHED = "This campaign is already published, so its ads can't change"
_CARD_NOT_FOUND = "Card not found"
_CAROUSEL_EDIT_UNSUPPORTED = (
    "A carousel's images and copy are set per card — regenerate the carousel "
    "to change them"
)
_CARD_REORDER_MISMATCH = (
    "cardIds must name exactly this creative's current cards, once each"
)
_MIN_CARDS_REQUIRED = (
    f"A carousel needs at least {MIN_CAROUSEL_CARDS} cards — regenerate "
    "with more product photos instead of removing this one"
)


def _to_response(
    creative: Creative, campaign: Campaign, product: Product | None, business: Business
) -> CreativeResponse:
    """Map a Prisma Creative record to its public response shape.

    Args:
        creative: The Prisma Creative model instance. Its cards relation
            must already be loaded (include={"cards": ...}) — every
            caller below does this, since Prisma-client-py doesn't lazy-
            load relations.
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
    cards = [
        {
            "id": card.id,
            "position": card.position,
            "imageUrl": card.imageUrl,
            "headline": card.headline,
            "description": card.description,
            "linkUrl": card.linkUrl,
        }
        for card in creative.cards or []
    ]
    return CreativeResponse.model_validate(
        {
            "id": creative.id,
            "campaignId": creative.campaignId,
            "adId": creative.adId,
            "videoUrl": (
                product_image_url(creative.productImageId)
                if creative.format == "SINGLE_VIDEO" and creative.productImageId
                else None
            ),
            "headline": creative.headline,
            "bodyText": creative.bodyText,
            "description": creative.description,
            "cta": creative.cta,
            "creativeAngle": creative.creativeAngle,
            "imagePrompt": creative.imagePrompt,
            "videoPrompt": creative.videoPrompt,
            "imageUrl": creative.imageUrl,
            "format": creative.format,
            "cards": cards,
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
        where={"campaignId": campaign.id},
        order={"createdAt": "asc"},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return [_to_response(c, campaign, product, business) for c in creatives]


def _video_input(video: ProductImage) -> VideoInput:
    """What the Creative Agent is told about a VIDEO row: thumbnail and length."""
    assert video.thumbnailData is not None  # enforced at upload
    return VideoInput(
        thumbnail_data=str(video.thumbnailData),
        thumbnail_content_type=video.thumbnailContentType or "image/jpeg",
        duration_seconds=video.durationSeconds or 0.0,
    )


def _media_type_for(creative: Creative) -> str:
    """The product media a creative's format uses: videos or photos."""
    return "VIDEO" if creative.format == "SINGLE_VIDEO" else "IMAGE"


def _media_url(media: ProductImage) -> str:
    """The URL an ad shows for this media: a video's thumbnail, a photo itself."""
    if media.mediaType == "VIDEO":
        return product_thumbnail_url(media.id)
    return product_image_url(media.id)


@router.post(
    "", response_model=list[CreativeResponse], status_code=status.HTTP_201_CREATED
)
async def create_creatives(
    payload: CreateCreativesRequest | None = None,
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[CreativeResponse]:
    """Generate a batch of ad creatives for a campaign, replacing any existing ones.

    For the default SINGLE_IMAGE format, if the campaign's product has an
    uploaded photo, its primary one is passed to the Creative Agent as a
    vision input alongside the text grounding (app/services/creative.py's
    generate_creatives) — headlines and descriptions reflect what the
    product actually looks like, not just its written description.

    For CAROUSEL, every one of the product's photos (in display order,
    capped at MAX_CAROUSEL_CARDS) is attached instead of just the primary
    one, and each generated variant's cards are written into their own
    CreativeCard rows immediately — unlike SINGLE_IMAGE, a carousel's
    images are fixed at generation time, not chosen later at
    select_creative (see app/services/creative.py's module docstring).

    Args:
        payload: Optionally names the desired format (SINGLE_IMAGE,
            the default, or CAROUSEL).
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The four newly generated creative variants.

    Raises:
        HTTPException: 400 if the campaign has no strategy yet, or (for
            CAROUSEL) the campaign has no product, its product has fewer
            than MIN_CAROUSEL_CARDS photos, or neither the product nor
            the business has a URL to link every card to; 500 if the
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
    brand_profile = await db.brandprofile.find_unique(where={"businessId": business.id})

    requested_format = payload.format if payload is not None else None
    plan = StrategyContentAdapter.validate_json(strategy.content)
    if plan.plan_type == "CREATIVE_TEST_PLAN":
        creative_format = requested_format or plan.creative_format
        if creative_format == "CAROUSEL":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_CREATIVE_PLAN_SINGLE_IMAGE_ONLY,
            )
        if creative_format != plan.creative_format:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    _VIDEO_TEST_VIDEOS_ONLY
                    if plan.creative_format == "SINGLE_VIDEO"
                    else _IMAGE_TEST_IMAGES_ONLY
                ),
            )
    else:
        creative_format = requested_format or "SINGLE_IMAGE"
    primary_image = None
    card_images = None
    video_row = None
    video_input = None
    destination_url = None
    if creative_format == "CAROUSEL":
        if product is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_CAROUSEL_NEEDS_PRODUCT,
            )
        all_images = await db.productimage.find_many(
            where={"productId": product.id, "mediaType": "IMAGE"},
            order={"position": "asc"},
        )
        if len(all_images) < MIN_CAROUSEL_CARDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_CAROUSEL_NEEDS_MORE_PHOTOS.format(count=len(all_images)),
            )
        # Excess photos are simply excluded, not rejected — the frontend's
        # own carousel format toggle tells the user which ones made the
        # cut (see the create-creatives PRD comment/plan, confirmed
        # 2026-09-12), matching ProductImage.position order.
        card_images = all_images[:MAX_CAROUSEL_CARDS]
        destination_url = product.url or business.website
        if not destination_url:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_CAROUSEL_NEEDS_DESTINATION_URL,
            )
    elif creative_format == "SINGLE_VIDEO":
        video_row = (
            await db.productimage.find_first(
                where={"productId": product.id, "mediaType": "VIDEO"},
                order={"position": "asc"},
            )
            if product is not None
            else None
        )
        if video_row is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=_NEEDS_PRODUCT_VIDEO
            )
        video_input = _video_input(video_row)
    elif product is not None:
        primary_image = await get_primary_image(product.id)

    try:
        variants = await generate_creatives(
            business=business,
            product=product,
            strategy=plan,
            primary_image=primary_image,
            brand_profile=brand_profile,
            format=creative_format,
            card_images=card_images,
            video=video_input,
        )
    except CreativeAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    source_description = product.description if product is not None else None
    source_url = product.url if product is not None else None

    # CreativeCard has a FK to Creative with no cascade delete configured
    # (this schema's usual convention — see e.g. ProductImage's own doc
    # comment), so any existing carousel's cards must go first or the
    # Creative delete below would fail the FK constraint outright.
    stale_creative_ids = [
        c.id for c in await db.creative.find_many(where={"campaignId": campaign.id})
    ]
    if stale_creative_ids:
        await db.creativecard.delete_many(
            where={"creativeId": {"in": stale_creative_ids}}
        )
    await db.creative.delete_many(where={"campaignId": campaign.id})
    for variant in variants:
        data: CreativeCreateInput = {
            "campaignId": campaign.id,
            "headline": variant.headline,
            "bodyText": variant.body_text,
            "description": variant.description,
            "cta": variant.cta,
            "creativeAngle": variant.creative_angle,
            "imagePrompt": variant.image_prompt,
            "videoPrompt": variant.video_prompt,
            "format": creative_format,
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
        if video_row is not None:
            # A video ad points at its product video through the same
            # productImageId an image ad uses for its photo (this field
            # can reference a VIDEO row); imageUrl is the video's
            # thumbnail, which is what lists and previews show.
            data["productImageId"] = video_row.id
            data["imageUrl"] = product_thumbnail_url(video_row.id)
        created = await db.creative.create(data=data)
        if variant.cards is not None:
            assert card_images is not None  # only set alongside CAROUSEL
            assert destination_url is not None  # gated above
            for position, (card, image) in enumerate(
                zip(variant.cards, card_images, strict=True)
            ):
                await db.creativecard.create(
                    data={
                        "creativeId": created.id,
                        "position": position,
                        "imageUrl": product_image_url(image.id),
                        "productImageId": image.id,
                        "headline": card.headline,
                        "description": card.description,
                        "linkUrl": destination_url,
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


async def _is_creative_test_plan(campaign: Campaign) -> bool:
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        return False
    plan = StrategyContentAdapter.validate_json(strategy.content)
    return plan.plan_type == "CREATIVE_TEST_PLAN"


async def _check_creative_test_can_change(campaign: Campaign) -> None:
    """A published creative test's ads are fixed — refuse changes to them."""
    current = await db.campaign.find_unique(where={"id": campaign.id})
    if current is not None and current.status in ("LIVE", "PAUSED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_TEST_ALREADY_PUBLISHED,
        )


async def _sync_creative_test_status(campaign: Campaign) -> None:
    """Move the campaign to match how many ads are selected.

    PENDING_APPROVAL once at least MIN_CREATIVE_ANGLES are selected (the test
    is ready for the approval gate), otherwise back to ADS_GENERATED.
    """
    selected = await db.creative.count(
        where={"campaignId": campaign.id, "status": "SELECTED"}
    )
    await db.campaign.update(
        where={"id": campaign.id},
        data={
            "status": (
                "PENDING_APPROVAL"
                if selected >= MIN_CREATIVE_ANGLES
                else "ADS_GENERATED"
            )
        },
    )


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
    imageUrl (and productImageId, its id), overriding whatever was there
    before — the user explicitly chose it. Otherwise, if this creative
    doesn't already have an image, the product's primary photo (position
    0 — ProductImage.position, "first = primary") is attached instead —
    the natural checkpoint moment before publish, and the point where the
    frontend can show the user what image the ad will actually use. A
    product with zero photos at all is rejected outright (see the 428
    below), not silently selected image-less. productImageId is what
    app/services/publish.py reads at publish time to fetch the actual
    image bytes for Meta's real ad image upload — imageUrl alone (our own
    /product-images/{id} URL) isn't enough for that.

    None of the above applies to a CAROUSEL creative — its cards' images
    were already fixed at generation time (see app/services/creative.py's
    module docstring), so payload.product_image_id is ignored and
    imageUrl/productImageId are left untouched (null, as they always are
    for CAROUSEL — see Creative.format's schema comment).

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
            428 if the campaign's product has no uploaded photo at all
            (confirmed 2026-09-09 — publishing image-less is no longer
            allowed; the frontend's own image-upload UI, now built into
            ProductForm, is the natural place to send the user instead),
            or if product_image_id is given but the campaign has no
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

    media_type = _media_type_for(creative)
    if campaign.productId is not None:
        media_count = await db.productimage.count(
            where={"productId": campaign.productId, "mediaType": media_type}
        )
        if media_count == 0:
            raise HTTPException(
                status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                detail=(
                    _NO_PRODUCT_VIDEO if media_type == "VIDEO" else _NO_PRODUCT_PHOTO
                ),
            )

    is_creative_plan = await _is_creative_test_plan(campaign)
    if is_creative_plan:
        await _check_creative_test_can_change(campaign)
        selected_count = await db.creative.count(
            where={"campaignId": campaign.id, "status": "SELECTED"}
        )
        if creative.status != "SELECTED" and selected_count >= MAX_CREATIVE_ANGLES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=_TEST_FULL.format(max=MAX_CREATIVE_ANGLES),
            )
    else:
        # The original single-ad flow: selecting one rejects its siblings.
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
    if creative.format == "CAROUSEL":
        pass  # its cards' images were already fixed at generation time
    elif product_image_id is not None:
        product_image = (
            await db.productimage.find_first(
                where={
                    "id": product_image_id,
                    "productId": campaign.productId,
                    "mediaType": media_type,
                }
            )
            if campaign.productId is not None
            else None
        )
        if product_image is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=_PRODUCT_IMAGE_NOT_FOUND
            )
        update_data["imageUrl"] = _media_url(product_image)
        update_data["productImageId"] = product_image.id
    elif (
        creative.imageUrl is None
        and creative.format == "SINGLE_IMAGE"
        and campaign.productId is not None
    ):
        product_image = await db.productimage.find_first(
            where={"productId": campaign.productId, "mediaType": "IMAGE"},
            order={"position": "asc"},
        )
        if product_image is not None:
            update_data["imageUrl"] = product_image_url(product_image.id)
            update_data["productImageId"] = product_image.id
    updated = await db.creative.update(
        where={"id": creative.id},
        data=update_data,
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request

    if is_creative_plan:
        await _sync_creative_test_status(campaign)
    else:
        await db.campaign.update(
            where={"id": campaign.id}, data={"status": "PENDING_APPROVAL"}
        )

    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)


@router.post("/{creative_id}/deselect", response_model=CreativeResponse)
async def deselect_creative(
    creative_id: str,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Remove one ad from a creative test (a CREATIVE_TEST_PLAN campaign only).

    The creative goes back to GENERATED. The campaign drops to ADS_GENERATED
    when fewer than the minimum ads remain selected, and to PENDING_APPROVAL
    otherwise (what was approved changed, so it needs approving again).

    Args:
        creative_id: The creative to remove from the test.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-deselected creative.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign; 400
            if the campaign isn't a creative test plan or is already
            published.
    """
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )
    if not await _is_creative_test_plan(campaign):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_NOT_A_CREATIVE_TEST_PLAN,
        )
    await _check_creative_test_can_change(campaign)

    updated = await db.creative.update(
        where={"id": creative.id},
        data={"status": "GENERATED"},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    await _sync_creative_test_status(campaign)

    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)


async def _reopen_approval_if_selected(campaign: Campaign, creative: Creative) -> None:
    """An approved campaign's selected ad changed — it needs approving again."""
    if creative.status != "SELECTED":
        return
    current = await db.campaign.find_unique(where={"id": campaign.id})
    if current is not None and current.status == "APPROVED":
        await db.campaign.update(
            where={"id": campaign.id}, data={"status": "PENDING_APPROVAL"}
        )


async def _find_editable_creative(creative_id: str, campaign: Campaign) -> Creative:
    """Fetch a single-image creative the user may still edit.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign; 400 if
            the campaign is already published or the creative is a carousel.
    """
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )
    await _check_creative_test_can_change(campaign)
    if creative.format == "CAROUSEL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CAROUSEL_EDIT_UNSUPPORTED
        )
    return creative


@router.put("/{creative_id}/image", response_model=CreativeResponse)
async def set_creative_image(
    creative_id: str,
    payload: SetCreativeImageRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Use a different product photo for one ad, without selecting it.

    Unlike select_creative's product_image_id, this never changes whether the
    ad is in the test, so the user can pick each ad's image while reviewing.

    Args:
        creative_id: The creative to change.
        payload: The product photo to use.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The updated creative.

    Raises:
        HTTPException: 404 if the creative, or a photo of this campaign's
            product with that id, doesn't exist; 400 if the campaign is already
            published or the creative is a carousel.
    """
    creative = await _find_editable_creative(creative_id, campaign)
    product_image = (
        await db.productimage.find_first(
            where={
                "id": payload.product_image_id,
                "productId": campaign.productId,
                "mediaType": _media_type_for(creative),
            }
        )
        if campaign.productId is not None
        else None
    )
    if product_image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_PRODUCT_IMAGE_NOT_FOUND
        )
    updated = await db.creative.update(
        where={"id": creative.id},
        data={
            "imageUrl": _media_url(product_image),
            "productImageId": product_image.id,
        },
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    await _reopen_approval_if_selected(campaign, updated)

    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)


@router.post("/{creative_id}/regenerate", response_model=CreativeResponse)
async def regenerate_creative_copy(
    creative_id: str,
    payload: RegenerateCreativeRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Rewrite some of one ad's copy (headline, primary text, description).

    Runs the Creative Agent again against the same strategy and takes the
    variant on this ad's creative angle (the first variant when the model
    wandered off it), then copies over only the requested slots — the angle,
    image, CTA and every other slot are untouched.

    Args:
        creative_id: The creative to rewrite.
        payload: Which copy slots to regenerate.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The updated creative.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign; 400 if
            the campaign has no strategy, is already published, or the
            creative is a carousel; 500 if the Creative Agent fails.
    """
    creative = await _find_editable_creative(creative_id, campaign)
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_STRATEGY_REQUIRED
        )
    business = await _current_business(campaign)
    product = await _current_product(campaign)
    brand_profile = await db.brandprofile.find_unique(where={"businessId": business.id})
    primary_image = None
    video_input = None
    if creative.format == "SINGLE_VIDEO":
        video = (
            await db.productimage.find_unique(where={"id": creative.productImageId})
            if creative.productImageId is not None
            else None
        )
        if video is None or video.mediaType != "VIDEO":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=_VIDEO_GONE
            )
        video_input = _video_input(video)
    elif product is not None:
        primary_image = await get_primary_image(product.id)

    try:
        variants = await generate_creatives(
            business=business,
            product=product,
            strategy=StrategyContentAdapter.validate_json(strategy.content),
            primary_image=primary_image,
            brand_profile=brand_profile,
            format=cast(CreativeFormat, creative.format),
            video=video_input,
        )
    except CreativeAgentError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    on_angle = next(
        (
            v
            for v in variants
            if creative.creativeAngle is not None
            and v.creative_angle.strip().lower() == creative.creativeAngle.lower()
        ),
        variants[0],
    )
    data: CreativeUpdateInput = {}
    for field in dict.fromkeys(payload.fields):
        if field == "headline":
            data["headline"] = on_angle.headline
        elif field == "bodyText":
            data["bodyText"] = on_angle.body_text
        else:
            data["description"] = on_angle.description
    updated = await db.creative.update(
        where={"id": creative.id},
        data=data,
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    await _reopen_approval_if_selected(campaign, updated)

    return _to_response(updated, campaign, product, business)


async def _find_carousel_creative(creative_id: str, campaign: Campaign) -> Creative:
    """Fetch a campaign's creative (with cards loaded), confirming it's a carousel.

    Shared by reorder_creative_cards and remove_creative_card below.

    Args:
        creative_id: The creative to fetch.
        campaign: The creative's parent campaign, already ownership-checked.

    Returns:
        The creative, with its cards relation loaded and position-ordered.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign, 400
            if it exists but isn't a CAROUSEL creative.
    """
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )
    if creative.format != "CAROUSEL":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_A_CAROUSEL
        )
    return creative


@router.put("/{creative_id}/cards/order", response_model=CreativeResponse)
async def reorder_creative_cards(
    creative_id: str,
    payload: ReorderCreativeCardsRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Set a CAROUSEL creative's card display order.

    Takes the full new order, not a single move — same reasoning as
    app/api/product_image.py's reorder_product_images.

    Args:
        creative_id: The carousel creative whose cards are being reordered.
        payload: Every one of the creative's current card ids, in the new
            order.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The creative, with its cards in their new order.

    Raises:
        HTTPException: 404 if no such creative exists on this campaign. 400
            if it isn't a CAROUSEL creative, or if payload.card_ids isn't
            exactly the creative's current set of card ids (missing, extra,
            or duplicated).
    """
    creative = await _find_carousel_creative(creative_id, campaign)
    current_ids = {card.id for card in creative.cards or []}
    if current_ids != set(payload.card_ids) or len(payload.card_ids) != len(
        set(payload.card_ids)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CARD_REORDER_MISMATCH
        )

    for position, card_id in enumerate(payload.card_ids):
        await db.creativecard.update(where={"id": card_id}, data={"position": position})

    updated = await db.creative.find_unique(
        where={"id": creative.id}, include={"cards": {"order_by": {"position": "asc"}}}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)


@router.delete("/{creative_id}/cards/{card_id}", response_model=CreativeResponse)
async def remove_creative_card(
    creative_id: str,
    card_id: str,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeResponse:
    """Remove one card from a CAROUSEL creative, renumbering the rest.

    Args:
        creative_id: The carousel creative to remove a card from.
        card_id: The card to remove.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The creative, with the card removed and its remaining cards
        renumbered to stay contiguous (0-indexed, in their existing
        relative order).

    Raises:
        HTTPException: 404 if no such creative exists on this campaign, or
            no such card exists on it. 400 if the creative isn't a
            CAROUSEL creative, or removing this card would leave fewer
            than MIN_CAROUSEL_CARDS (Meta's own minimum) — regenerate with
            more product photos instead.
    """
    creative = await _find_carousel_creative(creative_id, campaign)
    current_cards = creative.cards or []
    if not any(card.id == card_id for card in current_cards):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CARD_NOT_FOUND
        )
    if len(current_cards) <= MIN_CAROUSEL_CARDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_MIN_CARDS_REQUIRED
        )

    await db.creativecard.delete(where={"id": card_id})
    remaining = [card for card in current_cards if card.id != card_id]
    for position, card in enumerate(remaining):
        await db.creativecard.update(where={"id": card.id}, data={"position": position})

    updated = await db.creative.find_unique(
        where={"id": creative.id}, include={"cards": {"order_by": {"position": "asc"}}}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    return _to_response(updated, campaign, product, business)
