"""Product onboarding endpoints, nested under a business (PRD.md §2 step 3, §7)."""

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Product
from prisma.types import ProductUpdateInput

from app.core.authz import get_owned_business, get_owned_product
from app.core.config import get_settings
from app.core.db import db
from app.schemas.product import (
    CheckUrlResponse,
    ProductCreateRequest,
    ProductResponse,
    ProductUpdateRequest,
)
from app.services.campaign_readiness import auto_attach_product
from app.services.url_reachability import check_url_reachable
from app.services.url_validation import requires_destination_url

router = APIRouter(prefix="/businesses/{business_id}/products", tags=["products"])

_URL_REQUIRED_FOR_OBJECTIVE = (
    "This business has a Sales or Traffic campaign waiting for a product — "
    "add a destination URL so its ad has somewhere to send people"
)
_REACHABILITY_CHECK_DISABLED = "URL reachability checking is not enabled"
_PRODUCT_NOT_FOUND = "Product not found"
_PRODUCT_HAS_NO_URL = "This product has no URL to check"


async def _product_url_is_required(business_id: str) -> bool:
    """Whether any campaign still missing a product needs one with a URL.

    Checked against every campaign missing a product, not just one — the
    next product created is a candidate for auto-attaching to any/all of
    them (app/services/campaign_readiness.py's auto_attach_product).

    Args:
        business_id: The business the product is being created under.

    Returns:
        True if at least one such campaign's objective requires a URL
        (SALES/TRAFFIC — see app/services/url_validation.py).
    """
    campaigns = await db.campaign.find_many(
        where={"businessId": business_id, "productId": None}
    )
    return any(requires_destination_url(c.objective) for c in campaigns)


def _to_response(product: Product) -> ProductResponse:
    """Map a Prisma Product record to its public response shape.

    Args:
        product: The Prisma Product model instance.

    Returns:
        The public-facing representation.
    """
    return ProductResponse(
        id=product.id,
        description=product.description,
        price=product.price,
        margin=product.margin,
        features=product.features,
        benefits=product.benefits,
        url=product.url,
    )


@router.post("", response_model=ProductResponse, status_code=status.HTTP_201_CREATED)
async def create_product(
    payload: ProductCreateRequest,
    business: Business = Depends(get_owned_business),
) -> ProductResponse:
    """Create a product under a business owned by the current user.

    Args:
        payload: The product fields (PRD.md §7 — description required, rest
            optional).
        business: The parent business, resolved and ownership-checked by
            get_owned_business (404s if it doesn't exist or isn't the
            current user's).

    Returns:
        The newly created product.

    Raises:
        HTTPException: 422 if url is omitted but a Sales/Traffic campaign
            is waiting for a product (app/services/url_validation.py's
            requires_destination_url) — its CTA needs somewhere to send
            people.
    """
    if payload.url is None and await _product_url_is_required(business.id):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_URL_REQUIRED_FOR_OBJECTIVE,
        )
    product = await db.product.create(
        data={
            "businessId": business.id,
            "description": payload.description,
            "price": payload.price,
            "margin": payload.margin,
            "features": payload.features,
            "benefits": payload.benefits,
            "url": payload.url,
        }
    )
    await auto_attach_product(business.id, product.id)
    return _to_response(product)


@router.get("", response_model=list[ProductResponse])
async def list_products(
    business: Business = Depends(get_owned_business),
) -> list[ProductResponse]:
    """List the products under a business owned by the current user.

    Args:
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        All products under the business.
    """
    products = await db.product.find_many(where={"businessId": business.id})
    return [_to_response(p) for p in products]


@router.patch("/{product_id}", response_model=ProductResponse)
async def update_product(
    payload: ProductUpdateRequest,
    product: Product = Depends(get_owned_product),
) -> ProductResponse:
    """Partially update a product owned by the current user's business.

    Only fields present in the request body change (see
    ProductUpdateRequest) — this is for editing the same item being sold
    (a typo'd description, a price change, a corrected URL), not for
    turning a product record into a different item entirely; see
    CLAUDE.md's "Products are reusable across campaigns" note.

    Args:
        payload: The fields to change.
        product: The product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The updated product.

    Raises:
        HTTPException: 404 if the product doesn't belong to this business
            (via get_owned_product). 422 if url is given but fails
            validate_destination_url.
    """
    update_data = cast(ProductUpdateInput, payload.model_dump(exclude_unset=True))
    if not update_data:
        return _to_response(product)
    updated = await db.product.update(where={"id": product.id}, data=update_data)
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)


@router.post("/{product_id}/check-url", response_model=CheckUrlResponse)
async def check_product_url(
    product_id: str,
    business: Business = Depends(get_owned_business),
) -> CheckUrlResponse:
    """Check whether a product's destination URL actually resolves (Phase 2).

    Scaffold only — never called automatically on product save, and not
    part of the publish flow yet (app/services/url_reachability.py).
    Gated behind Settings.url_reachability_check_enabled, off by default.

    Args:
        product_id: The product to check.
        business: The parent business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The reachability outcome.

    Raises:
        HTTPException: 404 if the flag is off (kept indistinguishable
            from a genuinely missing route), if the product doesn't
            belong to this business, or 422 if it has no url set.
    """
    if not get_settings().url_reachability_check_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_REACHABILITY_CHECK_DISABLED
        )
    product = await db.product.find_first(
        where={"id": product_id, "businessId": business.id}
    )
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_PRODUCT_NOT_FOUND
        )
    if product.url is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_PRODUCT_HAS_NO_URL
        )

    result = await check_url_reachable(product.url)
    return CheckUrlResponse(
        reachable=result.reachable,
        reason=result.reason,
        status_code=result.status_code,
        final_url=result.final_url,
    )
