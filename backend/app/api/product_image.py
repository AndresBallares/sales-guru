"""Product image upload endpoints (PRD.md §2 step 4).

Two routers, same split as app/api/meta.py's router/callback_router:
`router` is the normal business-scoped, session-authed CRUD (upload,
list, delete). `serve_router` is a single public, unauthenticated route
that serves the raw image bytes — Meta's own servers fetch this URL
directly for ad creative images (app/services/meta.py's
link_data.picture), not through the browser with the user's session
cookie, so it can't be behind get_owned_business the way everything else
in this app is. The id in the URL is an unguessable cuid, not a
sequential index, and product images are meant to be shown to the public
in ads anyway, so there's no meaningful confidentiality loss.
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from prisma import Base64
from prisma.models import Product, ProductImage

from app.core.authz import get_owned_product
from app.core.config import get_settings
from app.core.db import db
from app.schemas.product_image import (
    ALLOWED_CONTENT_TYPES,
    MAX_IMAGE_BYTES,
    ProductImageResponse,
)

router = APIRouter(
    prefix="/businesses/{business_id}/products/{product_id}/images",
    tags=["product-images"],
)
serve_router = APIRouter(tags=["product-images"])

_UNSUPPORTED_CONTENT_TYPE = (
    f"Unsupported image type — use one of {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
)
_TOO_LARGE = f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit"
_IMAGE_NOT_FOUND = "Product image not found"


def product_image_url(image_id: str) -> str:
    """Build the absolute, publicly-fetchable URL for a stored image."""
    return f"{get_settings().backend_url}/product-images/{image_id}"


def _to_response(image: ProductImage) -> ProductImageResponse:
    """Map a Prisma ProductImage record to its public response shape.

    Args:
        image: The Prisma ProductImage model instance.

    Returns:
        The public-facing representation.
    """
    return ProductImageResponse(
        id=image.id, url=product_image_url(image.id), created_at=image.createdAt
    )


@router.post(
    "", response_model=ProductImageResponse, status_code=status.HTTP_201_CREATED
)
async def upload_product_image(
    file: UploadFile,
    product: Product = Depends(get_owned_product),
) -> ProductImageResponse:
    """Upload a product photo, stored directly in the database.

    Option A, confirmed 2026-09-02 — no object storage account needed at
    MVP scale.

    Args:
        file: The uploaded image (multipart/form-data), jpeg/png/webp only.
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The newly stored image's metadata, including its public URL.

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

    image = await db.productimage.create(
        data={
            "productId": product.id,
            "data": Base64.encode(data),
            "contentType": file.content_type,
        }
    )
    return _to_response(image)


@router.get("", response_model=list[ProductImageResponse])
async def list_product_images(
    product: Product = Depends(get_owned_product),
) -> list[ProductImageResponse]:
    """List a product's uploaded photos, oldest first.

    Args:
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The product's images — an empty list if none have been uploaded
        yet.
    """
    images = await db.productimage.find_many(
        where={"productId": product.id}, order={"createdAt": "asc"}
    )
    return [_to_response(i) for i in images]


@router.delete("/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_product_image(
    image_id: str,
    product: Product = Depends(get_owned_product),
) -> None:
    """Delete one of a product's uploaded photos.

    Args:
        image_id: The image to delete.
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Raises:
        HTTPException: 404 if no such image exists on this product.
    """
    deleted = await db.productimage.delete_many(
        where={"id": image_id, "productId": product.id}
    )
    if deleted == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_IMAGE_NOT_FOUND
        )


@serve_router.get("/product-images/{image_id}", include_in_schema=False)
async def serve_product_image(image_id: str) -> Response:
    """Serve one image's raw bytes, publicly and without authentication.

    See the module docstring for why this route is deliberately not
    behind get_owned_business — Meta's servers need to fetch it directly.

    Args:
        image_id: The image to serve.

    Returns:
        The raw image bytes with the original upload's Content-Type.

    Raises:
        HTTPException: 404 if no such image exists.
    """
    image = await db.productimage.find_unique(where={"id": image_id})
    if image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_IMAGE_NOT_FOUND
        )
    return Response(content=image.data.decode(), media_type=image.contentType)
