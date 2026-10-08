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

import asyncio

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from prisma import Base64
from prisma.models import Product, ProductImage

from app.core.authz import get_owned_product
from app.core.config import get_settings
from app.core.db import db
from app.schemas.product_image import (
    ALLOWED_CONTENT_TYPES,
    ALLOWED_VIDEO_CONTENT_TYPES,
    MAX_IMAGE_BYTES,
    MAX_VIDEO_BYTES,
    MAX_VIDEO_SECONDS,
    MIN_IMAGE_DIMENSION_PX,
    ProductImageResponse,
    ReorderProductImagesRequest,
    unclassified_warning,
)
from app.services.image_dimensions import ImageDimensionError, get_image_dimensions
from app.services.media_info import (
    VideoParseError,
    classify_aspect,
    read_video_info,
)
from app.services.thumbnail_brightness import is_nearly_black

router = APIRouter(
    prefix="/businesses/{business_id}/products/{product_id}/images",
    tags=["product-images"],
)
serve_router = APIRouter(tags=["product-images"])

_UNSUPPORTED_CONTENT_TYPE = (
    "Unsupported file type — use a JPEG or PNG photo, or an MP4/MOV/M4V video"
)
_TOO_LARGE = f"Image exceeds the {MAX_IMAGE_BYTES // (1024 * 1024)}MB limit"
_VIDEO_TOO_LARGE = (
    f"Video exceeds the {MAX_VIDEO_BYTES // (1024 * 1024)}MB limit — keep ad "
    "videos under 30 seconds (or compress the file) so they stay small"
)
_VIDEO_TOO_LONG = f"Videos can be at most {MAX_VIDEO_SECONDS} seconds long"
_UNREADABLE_VIDEO = (
    "Could not read this video — it may be corrupted, or not a real MP4/MOV"
)
_THUMBNAIL_REQUIRED = "A video needs a thumbnail image (captured from the video)"
_BAD_THUMBNAIL = "The video's thumbnail must be a readable JPEG or PNG image"
_BLACK_THUMBNAIL = (
    "The video's thumbnail is a solid black frame — your browser could not "
    "render this video (common with iPhone HDR/HEVC video). Upload a thumbnail "
    "image manually, or re-record with iPhone Camera set to Most Compatible and "
    "HDR Video turned off."
)
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


async def get_primary_image(product_id: str) -> ProductImage | None:
    """The product's primary photo record (its first photo, never a video).

    The "lowest position wins" lookup — shared by get_primary_image_url
    below and by app/services/creative.py's vision-grounding, which needs
    the actual image bytes/content-type, not just a URL.

    Args:
        product_id: The product to look up.

    Returns:
        The primary photo's Prisma record, or None if it has no photos yet.
    """
    return await db.productimage.find_first(
        where={"productId": product_id, "mediaType": "IMAGE"},
        order={"position": "asc"},
    )


async def get_primary_image_url(product_id: str) -> str | None:
    """The URL of a product's primary photo (position 0), if it has one.

    Used by app/api/product.py's ProductResponse.primary_image_url and by
    app/api/creative.py's own primary-photo auto-attach.

    Args:
        product_id: The product to look up.

    Returns:
        The primary photo's public URL, or None if it has no photos yet.
    """
    image = await get_primary_image(product_id)
    return product_image_url(image.id) if image is not None else None


def _to_response(
    image: ProductImage, *, aspect_ratio_warning_text: str | None = None
) -> ProductImageResponse:
    """Map a Prisma ProductImage record to its public response shape.

    Args:
        image: The Prisma ProductImage model instance.
        aspect_ratio_warning_text: Only ever passed by upload_product_image
            itself, right after computing it from the just-uploaded
            file's measured shape — see ProductImageResponse's own
            docstring for why this is never recomputed for an already-stored
            image.

    Returns:
        The public-facing representation.
    """
    return ProductImageResponse(
        id=image.id,
        url=product_image_url(image.id),
        aspect_ratio_warning=aspect_ratio_warning_text,
        created_at=image.createdAt,
        media_type="VIDEO" if image.mediaType == "VIDEO" else "IMAGE",
        width=image.width,
        height=image.height,
        duration_seconds=image.durationSeconds,
        size_bytes=image.sizeBytes,
        aspect_class=classify_aspect(image.width, image.height)
        if image.width is not None and image.height is not None
        else None,
        thumbnail_url=(
            f"{product_image_url(image.id)}/thumbnail"
            if image.thumbnailData is not None
            else None
        ),
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


async def _validated_thumbnail(thumbnail: UploadFile | None) -> tuple[bytes, str]:
    """Read and validate a video's browser-captured thumbnail like any image."""
    if thumbnail is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_THUMBNAIL_REQUIRED
        )
    content_type = thumbnail.content_type or ""
    data = await thumbnail.read()
    if content_type not in ALLOWED_CONTENT_TYPES or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_BAD_THUMBNAIL
        )
    try:
        get_image_dimensions(data, content_type)
    except ImageDimensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_BAD_THUMBNAIL
        ) from exc
    # Off the event loop: decoding is pure Python (up to ~0.5s for a large JPEG).
    if await asyncio.to_thread(is_nearly_black, data, content_type):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_BLACK_THUMBNAIL
        )
    return data, content_type


@router.post(
    "", response_model=ProductImageResponse, status_code=status.HTTP_201_CREATED
)
async def upload_product_image(
    file: UploadFile,
    thumbnail: UploadFile | None = None,
    product: Product = Depends(get_owned_product),
) -> ProductImageResponse:
    """Upload a product photo or video, stored directly in the database.

    Option A, confirmed 2026-09-02 — no object storage account needed at
    MVP scale (videos too in V1, capped at MAX_VIDEO_BYTES; confirmed
    2026-10-07). Appended after the product's existing media (see
    _next_position) — new uploads never jump ahead of ones already there,
    only reordering (see reorder_product_images) changes that.

    Width, height, size and aspect class are measured here and stored. A
    photo is read from its image header; a video from its MP4/MOV headers
    (app/services/media_info.py), with a browser-captured thumbnail uploaded
    alongside it and validated like any image.

    Args:
        file: The uploaded photo (jpeg/png) or video (mp4/mov), multipart.
        thumbnail: Required for a video, ignored for a photo: a JPEG/PNG
            frame captured in the browser.
        product: The parent product, resolved and ownership-checked by
            get_owned_product.

    Returns:
        The newly stored media's metadata, including its public URL and
        — only ever on this response, never a later list/get — a
        non-blocking warning if its shape matches no standard ad shape.

    Raises:
        HTTPException: 400 if the content type isn't supported, a photo is
            too large, unreadable or smaller than MIN_IMAGE_DIMENSION_PX on
            its short side, or a video has no/an invalid thumbnail, is over
            MAX_VIDEO_BYTES or MAX_VIDEO_SECONDS, or can't be read.
    """
    content_type = file.content_type or ""
    if content_type in ALLOWED_VIDEO_CONTENT_TYPES:
        return await _store_video(file, content_type, thumbnail, product)
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNSUPPORTED_CONTENT_TYPE
        )
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_TOO_LARGE)
    try:
        width, height = get_image_dimensions(data, content_type)
    except ImageDimensionError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNREADABLE_IMAGE
        ) from exc
    if min(width, height) < MIN_IMAGE_DIMENSION_PX:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_TOO_SMALL)
    aspect_class = classify_aspect(width, height)
    image = await db.productimage.create(
        data={
            "productId": product.id,
            "data": Base64.encode(data),
            "contentType": content_type,
            "position": await _next_position(product.id),
            "mediaType": "IMAGE",
            "width": width,
            "height": height,
            "sizeBytes": len(data),
            "aspectClass": aspect_class,
        }
    )
    return _to_response(
        image,
        aspect_ratio_warning_text=unclassified_warning(aspect_class, "photo"),
    )


async def _store_video(
    file: UploadFile,
    content_type: str,
    thumbnail: UploadFile | None,
    product: Product,
) -> ProductImageResponse:
    """Validate and store an uploaded video with its thumbnail."""
    thumb_data, thumb_type = await _validated_thumbnail(thumbnail)
    data = await file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_VIDEO_TOO_LARGE
        )
    try:
        info = read_video_info(data)
    except VideoParseError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_UNREADABLE_VIDEO
        ) from exc
    if info.duration_seconds > MAX_VIDEO_SECONDS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_VIDEO_TOO_LONG
        )
    aspect_class = classify_aspect(info.width, info.height)
    video = await db.productimage.create(
        data={
            "productId": product.id,
            "data": Base64.encode(data),
            # Meta only knows video/mp4; an .m4v is the same container.
            "contentType": "video/mp4"
            if content_type == "video/x-m4v"
            else content_type,
            "position": await _next_position(product.id),
            "mediaType": "VIDEO",
            "width": info.width,
            "height": info.height,
            "durationSeconds": info.duration_seconds,
            "sizeBytes": len(data),
            "aspectClass": aspect_class,
            "thumbnailData": Base64.encode(thumb_data),
            "thumbnailContentType": thumb_type,
        }
    )
    return _to_response(
        video,
        aspect_ratio_warning_text=unclassified_warning(aspect_class, "video"),
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


async def _publicly_visible_media(image_id: str) -> ProductImage:
    """The media row, unless it doesn't exist or its business is soft-deleted."""
    image = await db.productimage.find_unique(where={"id": image_id})
    if image is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_IMAGE_NOT_FOUND
        )
    product = await db.product.find_unique(where={"id": image.productId})
    assert product is not None  # guaranteed by the FK, not user input
    business = await db.business.find_unique(where={"id": product.businessId})
    if business is None or business.deletedAt is not None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_IMAGE_NOT_FOUND
        )
    return image


@serve_router.get("/product-images/{image_id}", include_in_schema=False)
async def serve_product_image(image_id: str) -> Response:
    """Serve one photo's or video's raw bytes, publicly and without authentication.

    See the module docstring for why this route is deliberately not
    behind get_owned_business — Meta's servers need to fetch it directly.

    Args:
        image_id: The media to serve.

    Returns:
        The raw bytes with the original upload's Content-Type.

    Raises:
        HTTPException: 404 if no such media exists, or its business has
            been soft-deleted (Business.deletedAt — this route isn't
            behind get_owned_business, so it checks directly instead).
    """
    image = await _publicly_visible_media(image_id)
    return Response(content=image.data.decode(), media_type=image.contentType)


@serve_router.get("/product-images/{image_id}/thumbnail", include_in_schema=False)
async def serve_product_media_thumbnail(image_id: str) -> Response:
    """Serve a video's thumbnail, publicly (Meta fetches it for the ad creative).

    Args:
        image_id: The video whose thumbnail to serve.

    Returns:
        The thumbnail bytes with its own Content-Type.

    Raises:
        HTTPException: 404 if no such media exists, it has no thumbnail (a
            photo), or its business has been soft-deleted.
    """
    image = await _publicly_visible_media(image_id)
    if image.thumbnailData is None or image.thumbnailContentType is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_IMAGE_NOT_FOUND
        )
    return Response(
        content=image.thumbnailData.decode(), media_type=image.thumbnailContentType
    )
