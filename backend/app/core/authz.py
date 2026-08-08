"""Shared authorization dependencies for resource-ownership checks."""

from fastapi import Depends, HTTPException, status
from prisma.models import Business, Campaign, User

from app.core.db import db
from app.core.session import get_current_user

_BUSINESS_NOT_FOUND = "Business not found"
_CAMPAIGN_NOT_FOUND = "Campaign not found"


async def get_owned_organization_id(
    current_user: User = Depends(get_current_user),
) -> str:
    """Look up the organization auto-provisioned for the current user at signup.

    Args:
        current_user: Resolved from the session cookie.

    Returns:
        The id of the current user's organization.

    Raises:
        HTTPException: 500 if the user has no organization — this should be
            impossible (signup always creates exactly one, PRD.md §7) so
            hitting this means the invariant broke, not a user-facing error.
    """
    organization = await db.organization.find_first(where={"ownerId": current_user.id})
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User has no organization",
        )
    return organization.id


async def get_owned_business(
    business_id: str,
    organization_id: str = Depends(get_owned_organization_id),
) -> Business:
    """Resolve a business by id, scoped to the current user's organization.

    Args:
        business_id: The business id from the request path.
        organization_id: The current user's organization id.

    Returns:
        The business, if it exists and belongs to the current user.

    Raises:
        HTTPException: 404 if the business doesn't exist or belongs to a
            different organization — identical response either way, so a
            caller can't distinguish "not found" from "not yours" and
            enumerate other users' business ids.
    """
    business = await db.business.find_unique(where={"id": business_id})
    if business is None or business.organizationId != organization_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_BUSINESS_NOT_FOUND
        )
    return business


async def get_owned_campaign(
    campaign_id: str,
    business: Business = Depends(get_owned_business),
) -> Campaign:
    """Resolve a campaign by id, scoped to a business owned by the current user.

    Args:
        campaign_id: The campaign id from the request path.
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The campaign, if it exists and belongs to this business.

    Raises:
        HTTPException: 404 if the campaign doesn't exist or belongs to a
            different business — same "not found" reasoning as
            get_owned_business.
    """
    campaign = await db.campaign.find_first(
        where={"id": campaign_id, "businessId": business.id}
    )
    if campaign is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CAMPAIGN_NOT_FOUND
        )
    return campaign
