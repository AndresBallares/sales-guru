"""Brand Profile ("brand DNA") endpoints (PRD.md §5 step 3.5).

One profile per business (BrandProfile.businessId is unique) — POST
creates it once, PATCH edits it afterward (from the business page), GET
fetches it. Feeds the Strategist/Creative Agent prompts (app/services/
strategist.py, app/services/creative.py) as a dedicated "Brand voice"
block whenever one exists; campaigns generated before a profile existed
are unaffected until regenerated.
"""

import json
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import BrandProfile, Business
from prisma.types import BrandProfileUpdateInput

from app.api.business import business_logo_url
from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.brand_profile import (
    BrandProfileCreateRequest,
    BrandProfileResponse,
    BrandProfileUpdateRequest,
    PricePositioning,
    VoiceTrait,
)

router = APIRouter(
    prefix="/businesses/{business_id}/brand-profile", tags=["brand-profile"]
)

_NOT_FOUND = "This business has no brand profile yet"
_ALREADY_EXISTS = "This business already has a brand profile — use PATCH to edit it"


def _to_response(profile: BrandProfile, business: Business) -> BrandProfileResponse:
    """Map a Prisma BrandProfile record to its public response shape.

    Args:
        profile: The Prisma BrandProfile model instance.
        business: Its parent business, for logo_url.

    Returns:
        The public-facing representation, with voice_traits parsed from
        its stored JSON string back into a real list.
    """
    return BrandProfileResponse(
        id=profile.id,
        business_id=profile.businessId,
        description=profile.description,
        ideal_customer=profile.idealCustomer,
        voice_traits=cast(list[VoiceTrait], json.loads(profile.voiceTraits)),
        price_positioning=cast(PricePositioning, profile.pricePositioning),
        brand_phrases=profile.brandPhrases,
        avoid_phrases=profile.avoidPhrases,
        tagline=profile.tagline,
        competitors=profile.competitors,
        example_copy=profile.exampleCopy,
        proof_points=json.loads(profile.proofPoints) if profile.proofPoints else [],
        offer=profile.offer,
        logo_url=business_logo_url(business.id)
        if business.logoData is not None
        else None,
    )


@router.post(
    "", response_model=BrandProfileResponse, status_code=status.HTTP_201_CREATED
)
async def create_brand_profile(
    payload: BrandProfileCreateRequest,
    business: Business = Depends(get_owned_business),
) -> BrandProfileResponse:
    """Create a business's brand profile — the one-time onboarding questionnaire.

    Args:
        payload: The profile fields (PRD.md §5 step 3.5 — description,
            ideal_customer, voice_traits, price_positioning required, the
            rest optional).
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The newly created profile.

    Raises:
        HTTPException: 400 if this business already has one — PATCH edits
            it instead, matching the one-per-business shape.
    """
    existing = await db.brandprofile.find_unique(where={"businessId": business.id})
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_ALREADY_EXISTS
        )

    profile = await db.brandprofile.create(
        data={
            "businessId": business.id,
            "description": payload.description,
            "idealCustomer": payload.ideal_customer,
            "voiceTraits": json.dumps(payload.voice_traits),
            "pricePositioning": payload.price_positioning,
            "brandPhrases": payload.brand_phrases,
            "avoidPhrases": payload.avoid_phrases,
            "tagline": payload.tagline,
            "competitors": payload.competitors,
            "exampleCopy": payload.example_copy,
            "proofPoints": json.dumps(payload.proof_points)
            if payload.proof_points
            else None,
            "offer": payload.offer,
        }
    )
    return _to_response(profile, business)


@router.get("", response_model=BrandProfileResponse)
async def get_brand_profile(
    business: Business = Depends(get_owned_business),
) -> BrandProfileResponse:
    """Fetch a business's brand profile.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The business's brand profile.

    Raises:
        HTTPException: 404 if this business has no profile yet.
    """
    profile = await db.brandprofile.find_unique(where={"businessId": business.id})
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return _to_response(profile, business)


@router.patch("", response_model=BrandProfileResponse)
async def update_brand_profile(
    payload: BrandProfileUpdateRequest,
    business: Business = Depends(get_owned_business),
) -> BrandProfileResponse:
    """Partially update a business's brand profile.

    Args:
        payload: The fields to change — only ones explicitly present in
            the request body change.
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The updated profile.

    Raises:
        HTTPException: 404 if this business has no profile yet — create
            one first via POST.
    """
    profile = await db.brandprofile.find_unique(where={"businessId": business.id})
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)

    # by_alias=True — most of this model's fields are multi-word
    # (idealCustomer, pricePositioning, ...), so the plain field-name
    # dump (what BusinessUpdateRequest/ProductUpdateRequest use, single-
    # word fields only) wouldn't match Prisma's camelCase column names.
    update_data = payload.model_dump(exclude_unset=True, by_alias=True)
    if "voiceTraits" in update_data:
        update_data["voiceTraits"] = json.dumps(update_data["voiceTraits"])
    if "proofPoints" in update_data:
        proof_points = update_data["proofPoints"]
        update_data["proofPoints"] = json.dumps(proof_points) if proof_points else None

    if not update_data:
        return _to_response(profile, business)
    updated = await db.brandprofile.update(
        where={"id": profile.id}, data=cast(BrandProfileUpdateInput, update_data)
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated, business)
