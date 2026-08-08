"""Product onboarding endpoints, nested under a business (PRD.md §2 step 3, §7)."""

from fastapi import APIRouter, Depends, status
from prisma.models import Business, Product

from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.product import ProductCreateRequest, ProductResponse

router = APIRouter(prefix="/businesses/{business_id}/products", tags=["products"])


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
    """
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
