"""Audience onboarding endpoints, nested under a business (PRD.md §2 step 3, §7)."""

from fastapi import APIRouter, Depends, status
from prisma.models import Audience, Business

from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.audience import AudienceCreateRequest, AudienceResponse

router = APIRouter(prefix="/businesses/{business_id}/audiences", tags=["audiences"])


def _to_response(audience: Audience) -> AudienceResponse:
    """Map a Prisma Audience record to its public response shape.

    Args:
        audience: The Prisma Audience model instance.

    Returns:
        The public-facing representation.
    """
    return AudienceResponse(
        id=audience.id,
        description=audience.description,
        age_min=audience.ageMin,
        age_max=audience.ageMax,
        location=audience.location,
        interests=audience.interests,
        problem=audience.problem,
        desire=audience.desire,
    )


@router.post("", response_model=AudienceResponse, status_code=status.HTTP_201_CREATED)
async def create_audience(
    payload: AudienceCreateRequest,
    business: Business = Depends(get_owned_business),
) -> AudienceResponse:
    """Create an audience under a business owned by the current user.

    Args:
        payload: The audience fields (PRD.md §7 — description required, rest
            optional).
        business: The parent business, resolved and ownership-checked by
            get_owned_business (404s if it doesn't exist or isn't the
            current user's).

    Returns:
        The newly created audience.
    """
    audience = await db.audience.create(
        data={
            "businessId": business.id,
            "description": payload.description,
            "ageMin": payload.age_min,
            "ageMax": payload.age_max,
            "location": payload.location,
            "interests": payload.interests,
            "problem": payload.problem,
            "desire": payload.desire,
        }
    )
    return _to_response(audience)


@router.get("", response_model=list[AudienceResponse])
async def list_audiences(
    business: Business = Depends(get_owned_business),
) -> list[AudienceResponse]:
    """List the audiences under a business owned by the current user.

    Args:
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        All audiences under the business.
    """
    audiences = await db.audience.find_many(where={"businessId": business.id})
    return [_to_response(a) for a in audiences]
