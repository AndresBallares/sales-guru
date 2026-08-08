"""Business onboarding endpoints (PRD.md §2 step 2, §7)."""

from fastapi import APIRouter, Depends, status
from prisma.models import Business

from app.core.authz import get_owned_business, get_owned_organization_id
from app.core.db import db
from app.schemas.business import BusinessCreateRequest, BusinessResponse

router = APIRouter(prefix="/businesses", tags=["businesses"])


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
    businesses = await db.business.find_many(where={"organizationId": organization_id})
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
