"""Business onboarding endpoints (PRD.md §2 step 2, §7)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, User

from app.core.db import db
from app.core.session import get_current_user
from app.schemas.business import BusinessCreateRequest, BusinessResponse

router = APIRouter(prefix="/businesses", tags=["businesses"])


async def _get_owned_organization_id(user_id: str) -> str:
    """Look up the organization auto-provisioned for a user at signup.

    Args:
        user_id: The id of the user.

    Returns:
        The id of the user's organization.

    Raises:
        HTTPException: 500 if the user has no organization — this should be
            impossible (signup always creates exactly one, PRD.md §7) so
            hitting this means the invariant broke, not a user-facing error.
    """
    organization = await db.organization.find_first(where={"ownerId": user_id})
    if organization is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="User has no organization",
        )
    return organization.id


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
    )


@router.post("", response_model=BusinessResponse, status_code=status.HTTP_201_CREATED)
async def create_business(
    payload: BusinessCreateRequest, current_user: User = Depends(get_current_user)
) -> BusinessResponse:
    """Create a business under the current user's organization.

    Args:
        payload: The business fields (PRD.md §7 — name required, rest
            optional).
        current_user: Resolved from the session cookie.

    Returns:
        The newly created business.
    """
    organization_id = await _get_owned_organization_id(current_user.id)

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
    current_user: User = Depends(get_current_user),
) -> list[BusinessResponse]:
    """List the current user's businesses.

    Args:
        current_user: Resolved from the session cookie.

    Returns:
        All businesses under the current user's organization.
    """
    organization_id = await _get_owned_organization_id(current_user.id)

    businesses = await db.business.find_many(where={"organizationId": organization_id})
    return [_to_response(b) for b in businesses]
