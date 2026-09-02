"""Schemas for product image upload (PRD.md §2 step 4)."""

from datetime import datetime

from app.schemas.base import CamelCaseModel

# Meta requires a real image for link_data.picture — these three formats
# cover what Meta's own ad creative pipeline accepts and what browsers
# universally render, without pulling in a real image-processing library
# just to sniff/transcode formats for MVP.
ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png", "image/webp"})

# Generous enough for real product photography, small enough to keep this
# fine to store as a plain DB column at MVP scale (Option A, confirmed
# 2026-09-02) without needing chunked upload handling.
MAX_IMAGE_BYTES = 5 * 1024 * 1024


class ProductImageResponse(CamelCaseModel):
    """Public-facing representation of a stored ProductImage.

    url is the absolute, publicly-fetchable serving URL (GET
    /product-images/{id}, app/api/product_image.py) — not the internal
    id alone — so the frontend can use it directly in an <img src> and
    Meta can fetch it directly at publish time, same shape as any other
    externally-hosted image URL.
    """

    id: str
    url: str
    created_at: datetime
