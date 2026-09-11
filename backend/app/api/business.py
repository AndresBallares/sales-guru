"""Business onboarding endpoints (PRD.md §2 step 2, §7)."""

from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from prisma import Base64
from prisma.models import Business
from prisma.types import BusinessUpdateInput

from app.core.authz import get_owned_business, get_owned_organization_id
from app.core.config import get_settings
from app.core.db import db
from app.schemas.business import (
    BusinessCreateRequest,
    BusinessResponse,
    BusinessUpdateRequest,
)
from app.schemas.product_image import ALLOWED_CONTENT_TYPES, MAX_IMAGE_BYTES

router = APIRouter(prefix="/businesses", tags=["businesses"])
# Separate, unauthenticated router for serving the raw logo bytes — same
# split and same reasoning as app/api/product_image.py's serve_router: a
# future consumer (the Creative Agent grounding image generation in it, or
# eventually Meta itself) may need to fetch this URL directly, not through
# the browser with the user's session cookie. The id in the URL is the
# business's own id (unguessable cuid), and a logo — unlike, say, an
# unpublished product photo — is meant to be publicly visible anyway, so
# there's no meaningful confidentiality loss.
serve_router = APIRouter(tags=["businesses"])

_UNSUPPORTED_CONTENT_TYPE = (
    f"Unsupported image type — use one of {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
)
_TOO_LARGE = f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit"
_LOGO_NOT_FOUND = "This business has no logo"
_HAS_LIVE_CAMPAIGN = (
    "Can't delete — this business has a campaign that's still live on Meta. "
    "Pause or end it before deleting this business."
)


def business_logo_url(business_id: str) -> str:
    """Build the absolute, publicly-fetchable URL for a business's logo."""
    return f"{get_settings().backend_url}/business-logos/{business_id}"


def _to_response(business: Business) -> BusinessResponse:
    """Map a Prisma Business record to its public response shape.

    Args:
        business: The Prisma Business model instance.

    Returns:
        The public-facing representation.
    """
    return BusinessResponse(
        id=business.id,
        name=business.name,
        website=business.website,
        industry=business.industry,
        location=business.location,
        description=business.description,
        logo_url=business_logo_url(business.id)
        if business.logoData is not None
        else None,
    )


@router.post("", response_model=BusinessResponse, status_code=status.HTTP_201_CREATED)
async def create_business(
    payload: BusinessCreateRequest,
    organization_id: str = Depends(get_owned_organization_id),
) -> BusinessResponse:
    """Create a business under the current user's organization.

    Args:
        payload: The business fields (PRD.md §7 — name required, rest
            optional).
        organization_id: The current user's organization id (this dependency
            chain resolves get_current_user first, so this 401s before
            touching the DB when unauthenticated).

    Returns:
        The newly created business.
    """
    business = await db.business.create(
        data={
            "organizationId": organization_id,
            "name": payload.name,
            "website": payload.website,
            "industry": payload.industry,
            "location": payload.location,
            "description": payload.description,
        }
    )
    return _to_response(business)


@router.get("", response_model=list[BusinessResponse])
async def list_businesses(
    organization_id: str = Depends(get_owned_organization_id),
) -> list[BusinessResponse]:
    """List the current user's businesses.

    Args:
        organization_id: The current user's organization id.

    Returns:
        All businesses under the current user's organization.
    """
    businesses = await db.business.find_many(
        where={"organizationId": organization_id, "deletedAt": None}
    )
    return [_to_response(b) for b in businesses]


@router.get("/{business_id}", response_model=BusinessResponse)
async def get_business(
    business: Business = Depends(get_owned_business),
) -> BusinessResponse:
    """Fetch a single business owned by the current user.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business (404s if it doesn't exist or isn't the
            current user's).

    Returns:
        The business.
    """
    return _to_response(business)


@router.patch("/{business_id}", response_model=BusinessResponse)
async def update_business(
    payload: BusinessUpdateRequest,
    business: Business = Depends(get_owned_business),
) -> BusinessResponse:
    """Partially update a business owned by the current user.

    name, description, and industry can be changed here (see
    BusinessUpdateRequest) — only fields present in the request body
    change.

    Args:
        payload: The fields to change.
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The updated business.

    Raises:
        HTTPException: 404 if the business doesn't exist or belongs to a
            different organization (via get_owned_business). 422 if
            description exceeds the length cap.
    """
    update_data = cast(BusinessUpdateInput, payload.model_dump(exclude_unset=True))
    if not update_data:
        return _to_response(business)
    updated = await db.business.update(where={"id": business.id}, data=update_data)
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)


@router.delete("/{business_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_business(
    business: Business = Depends(get_owned_business),
) -> None:
    """Soft-delete a business owned by the current user.

    Sets deletedAt rather than removing the row — every child record
    (products, photos, brand profile, Meta connection, campaigns) is left
    untouched, and every business-scoped lookup excludes a deleted
    business from here on (get_owned_business is the single choke point;
    see Business.deletedAt's schema comment for the few routes that
    aren't behind it and check it directly instead).

    Meta itself is never touched here — a campaign that already went live
    (metaCampaignId set) stays exactly as it is on Meta's side (paused, if
    it's been paused; running, if somehow still LIVE, though that's
    exactly what the check below prevents from being deleted in the first
    place).

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Raises:
        HTTPException: 404 if the business doesn't exist or isn't the
            current user's (via get_owned_business). 409 if any of its
            campaigns is still LIVE — the only status that means Meta
            could be actively spending against it right now.
    """
    live_campaign = await db.campaign.find_first(
        where={"businessId": business.id, "status": "LIVE"}
    )
    if live_campaign is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_HAS_LIVE_CAMPAIGN
        )

    await db.business.update(
        where={"id": business.id}, data={"deletedAt": datetime.now(UTC)}
    )


@router.post("/{business_id}/logo", response_model=BusinessResponse)
async def upload_business_logo(
    file: UploadFile,
    business: Business = Depends(get_owned_business),
) -> BusinessResponse:
    """Upload (or replace) a business's logo, stored directly in the database.

    Same storage approach as ProductImage (Option A, confirmed
    2026-09-02) — no object storage account needed at MVP scale. Unlike a
    product photo there's only ever one per business, so a second upload
    simply overwrites the first rather than appending.

    Not yet consumed by the Strategist/Creative Agents — this endpoint
    only stores and serves it; grounding ad generation in it (PRD.md's
    "brand DNA" — consistent, on-brand ads) is a separate, not-yet-built
    pass.

    Args:
        file: The uploaded image (multipart/form-data), jpeg/png only.
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The business, with logo_url now set.

    Raises:
        HTTPException: 400 if the content type isn't a supported image
            format, or the file exceeds MAX_IMAGE_BYTES.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNSUPPORTED_CONTENT_TYPE
        )

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_TOO_LARGE)

    updated = await db.business.update(
        where={"id": business.id},
        data={"logoData": Base64.encode(data), "logoContentType": file.content_type},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)


@serve_router.get("/business-logos/{business_id}", include_in_schema=False)
async def serve_business_logo(business_id: str) -> Response:
    """Serve a business's raw logo bytes, publicly and without authentication.

    See this module's router docstring for why this route is deliberately
    not behind get_owned_business.

    Args:
        business_id: The business whose logo to serve.

    Returns:
        The raw image bytes with the original upload's Content-Type.

    Raises:
        HTTPException: 404 if the business doesn't exist or has no logo.
    """
    business = await db.business.find_unique(where={"id": business_id})
    if (
        business is None
        or business.deletedAt is not None
        or business.logoData is None
        or business.logoContentType is None
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_LOGO_NOT_FOUND
        )
    return Response(
        content=business.logoData.decode(), media_type=business.logoContentType
    )
