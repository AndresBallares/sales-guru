"""Campaign creation endpoints, nested under a business (PRD.md §2 step 4, §7).

Meta Ads connection is deliberately decoupled from campaign creation — an
objective can be picked and a strategy generated without ever connecting
Meta; that connection only matters at publish time (step 8).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Campaign

from app.core.authz import get_owned_business, get_owned_campaign
from app.core.db import db
from app.schemas.campaign import CampaignCreateRequest, CampaignResponse
from app.schemas.strategy import StrategyContent
from app.services.meta import MetaConnectionError
from app.services.publish import publish_campaign_to_meta

router = APIRouter(prefix="/businesses/{business_id}/campaigns", tags=["campaigns"])

_PRODUCT_NOT_FOUND = "Product not found"
_AUDIENCE_NOT_FOUND = "Audience not found"
_NOT_READY_FOR_APPROVAL = "Select an ad creative before approving this campaign"
_NOT_READY_FOR_PUBLISH = "Approve this campaign before publishing"
_META_NOT_CONNECTED = (
    "Connect Meta Ads and select an ad account and Page before publishing"
)
_NO_CREATIVE_SELECTED = "Select an ad creative before publishing"
_NO_DESTINATION_URL = (
    "Set a product URL or business website before publishing — Meta requires "
    "a destination link for the ad"
)


def _to_response(campaign: Campaign) -> CampaignResponse:
    """Map a Prisma Campaign record to its public response shape.

    Args:
        campaign: The Prisma Campaign model instance.

    Returns:
        The public-facing representation.
    """
    return CampaignResponse(
        id=campaign.id,
        name=campaign.name,
        objective=campaign.objective,
        status=campaign.status,
        product_id=campaign.productId,
        audience_id=campaign.audienceId,
        meta_campaign_id=campaign.metaCampaignId,
    )


async def _validate_product(business_id: str, product_id: str | None) -> None:
    """Confirm a product id, if given, belongs to this business.

    Scoping the lookup to businessId means a product belonging to a
    different business (even one the current user owns) looks identical to
    a nonexistent product — same "not found" response either way, so no
    cross-business relationship can be probed.

    Args:
        business_id: The business the campaign is being created under.
        product_id: The product id from the request, if provided.

    Raises:
        HTTPException: 404 if product_id is set but doesn't resolve within
            this business.
    """
    if product_id is None:
        return
    product = await db.product.find_first(
        where={"id": product_id, "businessId": business_id}
    )
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_PRODUCT_NOT_FOUND
        )


async def _validate_audience(business_id: str, audience_id: str | None) -> None:
    """Confirm an audience id, if given, belongs to this business.

    Args:
        business_id: The business the campaign is being created under.
        audience_id: The audience id from the request, if provided.

    Raises:
        HTTPException: 404 if audience_id is set but doesn't resolve within
            this business (same reasoning as _validate_product).
    """
    if audience_id is None:
        return
    audience = await db.audience.find_first(
        where={"id": audience_id, "businessId": business_id}
    )
    if audience is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_AUDIENCE_NOT_FOUND
        )


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreateRequest,
    business: Business = Depends(get_owned_business),
) -> CampaignResponse:
    """Create a campaign under a business owned by the current user.

    Args:
        payload: The objective (required) and optional product/audience to
            target.
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The newly created campaign.
    """
    await _validate_product(business.id, payload.product_id)
    await _validate_audience(business.id, payload.audience_id)

    campaign = await db.campaign.create(
        data={
            "businessId": business.id,
            "name": payload.name,
            "objective": payload.objective,
            "productId": payload.product_id,
            "audienceId": payload.audience_id,
        }
    )
    return _to_response(campaign)


@router.get("", response_model=list[CampaignResponse])
async def list_campaigns(
    business: Business = Depends(get_owned_business),
) -> list[CampaignResponse]:
    """List the campaigns under a business owned by the current user.

    Args:
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        All campaigns under the business.
    """
    campaigns = await db.campaign.find_many(where={"businessId": business.id})
    return [_to_response(c) for c in campaigns]


@router.post("/{campaign_id}/approve", response_model=CampaignResponse)
async def approve_campaign(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignResponse:
    """Approve a campaign — the explicit gate before publish (PRD.md build step 7).

    Idempotent once approved (re-approving an already-APPROVED campaign just
    returns it), but requires PENDING_APPROVAL to have been reached first —
    that only happens once an ad creative has been selected (see
    app/api/creative.py's select_creative), so there's always something
    concrete being approved.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-approved campaign.

    Raises:
        HTTPException: 400 if no ad creative has been selected yet.
    """
    if campaign.status not in ("PENDING_APPROVAL", "APPROVED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_READY_FOR_APPROVAL
        )

    updated = await db.campaign.update(
        where={"id": campaign.id}, data={"status": "APPROVED"}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request

    return _to_response(updated)


@router.post("/{campaign_id}/publish", response_model=CampaignResponse)
async def publish_campaign(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignResponse:
    """Publish an approved campaign live to Meta (PRD.md build step 8).

    This is the "Approve & Publish" checkpoint's actual publish half — the
    frontend calls approve() then this in one user-triggered flow, never
    automatically (PRD.md §5 step 8's checkpoint requirement). All
    precondition checks below are plain 400s, same pattern as
    app/api/creative.py's "strategy required" check; only an actual failed
    Meta API call becomes a 500.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-LIVE campaign, with metaCampaignId set.

    Raises:
        HTTPException: 400 if the campaign isn't approved yet, Meta isn't
            fully connected, no creative is selected, or there's no
            destination URL to advertise; 500 if the Meta API call fails
            (the campaign is moved to FAILED first, so it can be retried).
    """
    if campaign.status not in ("APPROVED", "FAILED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_READY_FOR_PUBLISH
        )

    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    connection = await db.metaconnection.find_unique(where={"businessId": business.id})
    connection_incomplete = (
        connection is None
        or connection.adAccountId is None
        or connection.pageId is None
    )
    if connection_incomplete:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )
    assert connection is not None  # narrowed by connection_incomplete above

    creative = await db.creative.find_first(
        where={"campaignId": campaign.id, "status": "SELECTED"}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_CREATIVE_SELECTED
        )

    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    assert strategy is not None  # guaranteed by the status flow (PENDING_APPROVAL+)

    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )
    destination_url = (product.url if product else None) or business.website
    if not destination_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_DESTINATION_URL
        )

    try:
        updated = await publish_campaign_to_meta(
            campaign=campaign,
            connection=connection,
            creative=creative,
            strategy=StrategyContent.model_validate_json(strategy.content),
            destination_url=destination_url,
        )
    except MetaConnectionError as exc:
        await db.campaign.update(where={"id": campaign.id}, data={"status": "FAILED"})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return _to_response(updated)
