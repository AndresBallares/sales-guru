"""Campaign creation endpoints, nested under a business (PRD.md §2 step 4, §7).

Meta Ads connection is deliberately decoupled from campaign creation — an
objective can be picked and a strategy generated without ever connecting
Meta; that connection only matters at publish time (step 8).
"""

from datetime import UTC, datetime, time
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Campaign
from prisma.types import CampaignUpdateInput

from app.core.authz import get_owned_business, get_owned_campaign
from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.schemas.campaign import (
    CampaignCreateRequest,
    CampaignResponse,
    CampaignStatus,
    CampaignUpdateRequest,
)
from app.schemas.strategy import StrategyContentAdapter
from app.services.campaign_readiness import advance_to_ready_if_complete, is_ready
from app.services.creative import is_creative_stale
from app.services.event_venues import EVENT_VENUES, default_event_window
from app.services.meta import MetaConnectionError
from app.services.publish import pause_campaign as pause_campaign_on_meta
from app.services.publish import publish_campaign_to_meta, requires_pixel
from app.services.url_validation import requires_destination_url

router = APIRouter(prefix="/businesses/{business_id}/campaigns", tags=["campaigns"])

_PRODUCT_NOT_FOUND = "Product not found"
_PRODUCT_MISSING_URL_FOR_OBJECTIVE = (
    "This product has no destination URL — add one before attaching it to a "
    "Sales or Traffic campaign, whose ad needs somewhere to send people"
)
_AUDIENCE_NOT_FOUND = "Audience not found"
_EVENT_VENUE_NOT_FOUND = "Unknown event venue"
_NOT_READY_FOR_APPROVAL = "Select an ad creative before approving this campaign"
_NOT_READY_FOR_PUBLISH = "Approve this campaign before publishing"
_CAMPAIGN_NOT_READY = "Add a product and an audience to this campaign before publishing"
_NOT_LIVE_TO_PAUSE = "Only a live campaign can be paused"
_ALREADY_PUBLISHED = (
    "This campaign has already been published and can't be deleted — its "
    "data is used to optimize future campaigns"
)
_META_NOT_CONNECTED = (
    "Connect Meta Ads and select an ad account and Page before publishing"
)
_META_NOT_CONNECTED_TO_PAUSE = "No Meta connection found for this campaign's business"
_NO_CREATIVE_SELECTED = "Select an ad creative before publishing"
_CREATIVE_STALE = (
    "This ad was generated from an older version of the product — "
    "regenerate it before publishing"
)
_NO_DESTINATION_URL = (
    "Set a product URL or business website before publishing — Meta requires "
    "a destination link for the ad"
)
_NO_PIXEL_CONFIGURED = (
    "Connect a Meta Pixel before publishing this objective — Meta requires "
    "one to track conversions"
)


async def _needs_destination_url(campaign: Campaign) -> bool:
    """Whether the campaign's current product is missing a URL its objective needs.

    Args:
        campaign: The campaign to check.

    Returns:
        True if a product is attached but lacks a destination URL that
        SALES/TRAFFIC requires. False with no product attached at all —
        that's a distinct "no product" state, surfaced elsewhere (the
        readiness checklist), not this field's job.
    """
    if campaign.productId is None or not requires_destination_url(campaign.objective):
        return False
    product = await db.product.find_unique(where={"id": campaign.productId})
    return product is not None and product.url is None


async def _to_response(campaign: Campaign) -> CampaignResponse:
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
        # Prisma types the column as plain str (schema.prisma has no native
        # enum support); cast is safe since every write site sets one of
        # CampaignStatus's values (app/schemas/campaign.py's docstring) —
        # never user input, so there's no unrecognized-value case to guard
        # against the way Business.industry's response type has to.
        status=cast(CampaignStatus, campaign.status),
        product_id=campaign.productId,
        audience_id=campaign.audienceId,
        meta_campaign_id=campaign.metaCampaignId,
        event_venue_key=campaign.eventVenueKey,
        start_date=campaign.startDate,
        end_date=campaign.endDate,
        paused_reason=campaign.pausedReason,
        daily_spend_flag=campaign.dailySpendFlag,
        needs_destination_url=await _needs_destination_url(campaign),
    )


async def _validate_product(
    business_id: str,
    product_id: str | None,
    objective: str,
    *,
    enforce_url_requirement: bool = True,
) -> None:
    """Confirm a product id, if given, belongs to this business and qualifies.

    Scoping the lookup to businessId means a product belonging to a
    different business (even one the current user owns) looks identical to
    a nonexistent product — same "not found" response either way, so no
    cross-business relationship can be probed.

    Args:
        business_id: The business the campaign is being created under.
        product_id: The product id from the request, if provided.
        objective: The campaign's objective — SALES/TRAFFIC campaigns
            require the bound product to have a destination URL (see
            app/services/url_validation.py's requires_destination_url).
        enforce_url_requirement: When True (create_campaign's default),
            a resolving product that lacks a required URL is rejected
            outright. update_campaign passes False — swapping a
            campaign's product is never blocked on this; the response's
            needs_destination_url field warns instead (see
            _needs_destination_url), since a swap is a correction the
            user is actively in the middle of making, not a fresh
            creation that should refuse to save an inconsistent state.

    Raises:
        HTTPException: 404 if product_id is set but doesn't resolve within
            this business. 422 if it resolves but lacks a URL required by
            objective and enforce_url_requirement is True.
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
    if (
        enforce_url_requirement
        and requires_destination_url(objective)
        and product.url is None
    ):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_PRODUCT_MISSING_URL_FOR_OBJECTIVE,
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


def _resolve_event_window(
    payload: CampaignCreateRequest,
) -> tuple[datetime | None, datetime | None]:
    """Resolve a campaign's start/end datetimes from the request.

    event_venue_key (if set) must be a known curated venue
    (app/services/event_venues.py) — raises 404 otherwise, same
    "not found" treatment as an unresolvable product/audience id. When a
    venue is given but start_date/end_date are omitted, they default to
    the venue's next typical window (see default_event_window),
    converted to midnight UTC since dates need to be stored as
    DateTime (SQLite has no native Date type). Explicit dates in the
    payload always win over the default.

    Args:
        payload: The incoming create-campaign request.

    Returns:
        (start_date, end_date) to store — both None for a non-event
        campaign with no dates given.

    Raises:
        HTTPException: 404 if event_venue_key doesn't resolve.
    """
    if payload.event_venue_key is None:
        return payload.start_date, payload.end_date

    venue = EVENT_VENUES.get(payload.event_venue_key)
    if venue is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_EVENT_VENUE_NOT_FOUND
        )

    if payload.start_date is not None or payload.end_date is not None:
        return payload.start_date, payload.end_date

    default_start, default_end = default_event_window(venue)
    return (
        datetime.combine(default_start, time.min, tzinfo=UTC),
        datetime.combine(default_end, time.min, tzinfo=UTC),
    )


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreateRequest,
    business: Business = Depends(get_owned_business),
) -> CampaignResponse:
    """Create a campaign under a business owned by the current user.

    Starts DRAFT; if product_id and audience_id are both given here
    (rather than left for auto-attach or update_campaign to fill in
    later — see app/services/campaign_readiness.py), it advances straight
    to READY.

    Args:
        payload: The objective (required) and optional product/audience/
            event venue to target.
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The newly created campaign.

    Raises:
        HTTPException: 404 if event_venue_key is set but doesn't resolve
            to a curated venue.
    """
    await _validate_product(business.id, payload.product_id, payload.objective)
    await _validate_audience(business.id, payload.audience_id)
    start_date, end_date = _resolve_event_window(payload)

    campaign = await db.campaign.create(
        data={
            "businessId": business.id,
            "name": payload.name,
            "objective": payload.objective,
            "productId": payload.product_id,
            "audienceId": payload.audience_id,
            "eventVenueKey": payload.event_venue_key,
            "startDate": start_date,
            "endDate": end_date,
        }
    )
    campaign = await advance_to_ready_if_complete(campaign)
    return await _to_response(campaign)


@router.get("", response_model=list[CampaignResponse])
async def list_campaigns(
    business: Business = Depends(get_owned_business),
) -> list[CampaignResponse]:
    """List the campaigns under a business owned by the current user.

    Args:
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        All campaigns under the business, most recently created first —
        without an explicit order, row order is a DB implementation
        detail, not something to rely on for "newest first" in the UI
        (confirmed 2026-09-12, the frontend showed a just-created campaign
        at the bottom of the list instead of the top).
    """
    campaigns = await db.campaign.find_many(
        where={"businessId": business.id}, order={"createdAt": "desc"}
    )
    return [await _to_response(c) for c in campaigns]


@router.patch("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    payload: CampaignUpdateRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignResponse:
    """Attach a product and/or audience to an existing campaign, or swap one out.

    The objective-first onboarding flow creates a campaign before a
    product or audience necessarily exists. Most of the time one gets
    auto-attached the moment the business ends up with exactly one of
    each (app/services/campaign_readiness.py) — this endpoint is the
    manual fallback for the rest: several products/audiences to choose
    from, correcting a wrong auto-attach, or deliberately swapping an
    already-attached product for a different one (e.g. this campaign is
    now selling a different item entirely — CLAUDE.md's "Products are
    reusable across campaigns" note).

    Changing product_id never blocks on that new product missing a
    destination URL the objective requires (unlike create_campaign) —
    the response's needs_destination_url field warns instead, since a
    swap is a correction in progress, not a fresh creation. Any creatives
    already generated for this campaign are left untouched in storage
    (never deleted — kept for history) but read as stale from this point
    on: their stored source_product_id/source_description/source_url
    snapshot no longer matches the new product, so
    app/services/creative.py's is_creative_stale (surfaced as is_stale on
    every creative response) flips true until the user regenerates.

    Args:
        payload: A product_id and/or audience_id to set. Omitted fields
            are left unchanged.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The updated campaign, with needs_destination_url reflecting the
        new product (if any) — check this rather than expecting a 422.

    Raises:
        HTTPException: 404 if product_id/audience_id is given but doesn't
            belong to this campaign's business.
    """
    await _validate_product(
        campaign.businessId,
        payload.product_id,
        campaign.objective,
        enforce_url_requirement=False,
    )
    await _validate_audience(campaign.businessId, payload.audience_id)

    update_data: CampaignUpdateInput = {}
    if payload.product_id is not None:
        update_data["product"] = {"connect": {"id": payload.product_id}}
    if payload.audience_id is not None:
        update_data["audience"] = {"connect": {"id": payload.audience_id}}

    result = campaign
    if update_data:
        maybe_updated = await db.campaign.update(
            where={"id": campaign.id}, data=update_data
        )
        assert maybe_updated is not None  # just fetched above, can't vanish mid-request
        result = await advance_to_ready_if_complete(maybe_updated)

    return await _to_response(result)


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign: Campaign = Depends(get_owned_campaign),
) -> None:
    """Delete a campaign that has never been published to Meta.

    Blocked once the campaign has ever gone LIVE (metaCampaignId set) —
    from that point on it can carry real performance data
    (Metric/OptimizationRecommendation/TestEvaluation rows, written only
    for LIVE campaigns by app/services/optimization_jobs.py) that the
    Optimizer uses to inform future campaigns, so silently erasing it
    would throw that history away. A campaign that never published has
    none of those rows yet, so this one check is sufficient — no need to
    separately delete AdSet/Metric/etc. rows below, only its own
    Strategy/Creative rows (regenerable, never load-bearing on their own).

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Raises:
        HTTPException: 400 if the campaign has ever been published.
    """
    if campaign.metaCampaignId is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_ALREADY_PUBLISHED
        )

    await db.creative.delete_many(where={"campaignId": campaign.id})
    await db.strategy.delete_many(where={"campaignId": campaign.id})
    await db.campaign.delete(where={"id": campaign.id})


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

    return await _to_response(updated)


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
            fully connected, no creative is selected, there's no
            destination URL to advertise, or the objective needs a Meta
            Pixel that isn't configured (see requires_pixel); 500 if the
            Meta API call fails (the campaign is moved to FAILED first,
            so it can be retried).
    """
    if campaign.status not in ("APPROVED", "FAILED"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_READY_FOR_PUBLISH
        )
    if not is_ready(campaign):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CAMPAIGN_NOT_READY
        )

    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    connection = await get_meta_connection(business.id)
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
    if is_creative_stale(creative, campaign, product, business):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CREATIVE_STALE
        )
    destination_url = (product.url if product else None) or business.website
    if not destination_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_DESTINATION_URL
        )

    if requires_pixel(campaign.objective) and connection.pixelId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_PIXEL_CONFIGURED
        )

    try:
        updated = await publish_campaign_to_meta(
            campaign=campaign,
            connection=connection,
            creative=creative,
            strategy=StrategyContentAdapter.validate_json(strategy.content),
            destination_url=destination_url,
        )
    except MetaConnectionError as exc:
        await db.campaign.update(where={"id": campaign.id}, data={"status": "FAILED"})
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return await _to_response(updated)


@router.post("/{campaign_id}/pause", response_model=CampaignResponse)
async def pause_campaign(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignResponse:
    """Manually pause every AdSet in a live campaign — the one-click "stop" action.

    Deliberately campaign-wide and immediate — distinct from the
    Optimizer's PAUSE_AD recommendation flow (app/api/optimization.py),
    which pauses one Ad and always needs a human's explicit approval
    first. This *is* the explicit human action; no separate approval
    step, no LLM involved (app/services/publish.py's pause_campaign).
    Same underlying function the scheduled duration-elapsed job and the
    total-spend circuit breaker call (app/services/optimization_jobs.py)
    — those set a different, specific pausedReason.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The now-PAUSED campaign.

    Raises:
        HTTPException: 400 if the campaign isn't LIVE, or Meta isn't
            connected for its business; 500 if the Meta API call fails
            (any AdSets already paused before the failure stay paused).
    """
    if campaign.status != "LIVE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_LIVE_TO_PAUSE
        )

    connection = await get_meta_connection(campaign.businessId)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_META_NOT_CONNECTED_TO_PAUSE,
        )

    try:
        updated = await pause_campaign_on_meta(
            campaign=campaign, connection=connection, reason="Manually paused"
        )
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    return await _to_response(updated)
