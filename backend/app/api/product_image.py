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
    MIN_IMAGE_DIMENSION_PX,
    ProductImageResponse,
    ReorderProductImagesRequest,
    aspect_ratio_warning,
)
from app.services.image_dimensions import ImageDimensionError, get_image_dimensions

router = APIRouter(
    prefix="/businesses/{business_id}/products/{product_id}/images",
    tags=["product-images"],
)
serve_router = APIRouter(tags=["product-images"])

_UNSUPPORTED_CONTENT_TYPE = (
    f"Unsupported image type — use one of {', '.join(sorted(ALLOWED_CONTENT_TYPES))}"
)
_TOO_LARGE = f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit"
_UNREADABLE_IMAGE = "Could not read this image — it may be corrupted"
_TOO_SMALL = (
    f"Image is smaller than the {MIN_IMAGE_DIMENSION_PX}px minimum on its short side"
)
_IMAGE_NOT_FOUND = "Product image not found"
_REORDER_MISMATCH = (
    "imageIds must name exactly this product's current photos, once each"
)


def product_image_url(image_id: str) -> str:
    """Build the absolute, publicly-fetchable URL for a stored image."""
    return f"{get_settings().backend_url}/product-images/{image_id}"


async def get_primary_image_url(product_id: str) -> str | None:
    """The URL of a product's primary photo (position 0), if it has one.

    Used by app/api/product.py's ProductResponse.primary_image_url and by
    app/api/creative.py's own primary-photo auto-attach, both of which
    need the same "lowest position wins" lookup this wraps.

    Args:
        product_id: The product to look up.

    Returns:
        The primary photo's public URL, or None if it has no photos yet.
    """
    image = await db.productimage.find_first(
        where={"productId": product_id}, order={"position": "asc"}
    )
    return product_image_url(image.id) if image is not None else None


def _to_response(
    image: ProductImage, *, aspect_ratio_warning_text: str | None = None
) -> ProductImageResponse:
    """Map a Prisma ProductImage record to its public response shape.

    Args:
        image: The Prisma ProductImage model instance.
        aspect_ratio_warning_text: Only ever passed by upload_product_image
            itself, right after computing it from the just-uploaded
            file's dimensions — see ProductImageResponse's own docstring
            for why this is never recomputed for an already-stored image.

    Returns:
        The public-facing representation.
    """
    return ProductImageResponse(
        id=image.id,
        url=product_image_url(image.id),
        aspect_ratio_warning=aspect_ratio_warning_text,
        created_at=image.createdAt,
    )


async def _next_position(product_id: str) -> int:
    """The position a newly-uploaded photo should get — always appended.

    One past the current highest position, never a reused/deleted one's
    old slot — using a plain count instead would collide the moment any
    photo before the end has been deleted (confirmed 2026-09-09).

    Args:
        product_id: The product the new photo is being added to.

    Returns:
        0 for a product's first photo, otherwise its highest existing
        position + 1.
    """
    highest = await db.productimage.find_first(
        where={"productId": product_id}, order={"position": "desc"}
    )
    return highest.position + 1 if highest is not None else 0


@router.post(
    "", response_model=ProductImageResponse, status_code=status.HTTP_201_CREATED
)
async def upload_product_image(
    file: UploadFile,
    product: Product = Depends(get_owned_product),
) -> ProductImageResponse:
    """Upload a product photo, stored directly in the database.

    Option A, confirmed 2026-09-02 — no object storage account needed at
    MVP scale. Appended after the product's existing photos (see
    _next_position) — new uploads never jump ahead of ones already there,
    only reordering (see reorder_product_images) changes that.

    Args:
        file: The uploaded image (multipart/form-data), jpeg/png only
            (confirmed 2026-09-09 — see ALLOWED_CONTENT_TYPES).
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The newly stored image's metadata, including its public URL and
        — only ever on this response, never a later list/get — a
        non-blocking warning if its aspect ratio falls outside Meta's
        recommended range.

    Raises:
        HTTPException: 400 if the content type isn't a supported image
            format, the file exceeds MAX_IMAGE_BYTES, the bytes can't be
            read as a valid image of the declared type, or the image is
            smaller than MIN_IMAGE_DIMENSION_PX on its short side.
    """
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNSUPPORTED_CONTENT_TYPE
        )

    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_TOO_LARGE)

    try:
        width, height = get_image_dimensions(data, file.content_type)
    except ImageDimensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNREADABLE_IMAGE
        ) from exc
    if min(width, height) < MIN_IMAGE_DIMENSION_PX:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_TOO_SMALL)

    image = await db.productimage.create(
        data={
            "productId": product.id,
            "data": Base64.encode(data),
            "contentType": file.content_type,
            "position": await _next_position(product.id),
        }
    )
    return _to_response(
        image, aspect_ratio_warning_text=aspect_ratio_warning(width, height)
    )


@router.put("/order", response_model=list[ProductImageResponse])
async def reorder_product_images(
    payload: ReorderProductImagesRequest,
    product: Product = Depends(get_owned_product),
) -> list[ProductImageResponse]:
    """Set the product's photo display order — first in the list = primary.

    Takes the full new order, not a single move — simpler and less
    error-prone than translating one move into a position delta, and a
    drag-and-drop (or move-left/move-right) UI naturally has "here's the
    new order" already in hand.

    Args:
        payload: Every one of the product's current photo ids, in the
            new order.
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The photos in their new order.

    Raises:
        HTTPException: 400 if payload.image_ids isn't exactly the
            product's current set of photo ids (missing, extra, or
            duplicated).
    """
    current = await db.productimage.find_many(where={"productId": product.id})
    if {image.id for image in current} != set(payload.image_ids) or len(
        payload.image_ids
    ) != len(set(payload.image_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_REORDER_MISMATCH
        )

    for position, image_id in enumerate(payload.image_ids):
        await db.productimage.update(
            where={"id": image_id}, data={"position": position}
        )

    reordered = await db.productimage.find_many(
        where={"productId": product.id}, order={"position": "asc"}
    )
    return [_to_response(image) for image in reordered]


@router.get("", response_model=list[ProductImageResponse])
async def list_product_images(
    product: Product = Depends(get_owned_product),
) -> list[ProductImageResponse]:
    """List a product's uploaded photos, in display order (primary first).

    Args:
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The product's images — an empty list if none have been uploaded
        yet.
    """
    images = await db.productimage.find_many(
        where={"productId": product.id}, order={"position": "asc"}
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
