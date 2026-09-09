"""Schemas for product image upload (PRD.md §2 step 4)."""

from datetime import datetime

from app.schemas.base import CamelCaseModel

# Meta requires a real image for link_data.picture. Narrowed to these two
# (confirmed 2026-09-09, dropping webp) — both have a simple enough header
# layout that app/services/image_dimensions.py can read width/height
# without a real image-processing library.
ALLOWED_CONTENT_TYPES = frozenset({"image/jpeg", "image/png"})

# Generous enough for real product photography, small enough to keep this
# fine to store as a plain DB column at MVP scale (Option A, confirmed
# 2026-09-02) without needing chunked upload handling. Raised from the
# original 5MB (confirmed 2026-09-09) — modern phone photos routinely
# clear that.
MAX_IMAGE_BYTES = 8 * 1024 * 1024

# Meta's own guidance for Feed image ads: below this on the short side,
# an ad image looks visibly soft/pixelated once scaled up to fill a feed
# card (confirmed 2026-09-09).
MIN_IMAGE_DIMENSION_PX = 600

# Meta's recommended range for Feed/Story image ads (1:1 square down to
# 4:5 portrait) — outside this, the photo still uploads (it's a warning,
# not a hard rule enforced by Meta itself), but may get cropped
# unpredictably by ad placements that expect something in this range.
MIN_ASPECT_RATIO = 4 / 5
MAX_ASPECT_RATIO = 1.0
_ASPECT_RATIO_WARNING = (
    "This photo's aspect ratio is outside Meta's recommended 1:1–4:5 "
    "range for ad images — it may get cropped unpredictably in some ad "
    "placements."
)


def aspect_ratio_warning(width: int, height: int) -> str | None:
    """Whether a photo's aspect ratio falls outside Meta's recommended range.

    Args:
        width: The image's width in pixels.
        height: The image's height in pixels.

    Returns:
        A human-readable warning if the ratio is outside
        [MIN_ASPECT_RATIO, MAX_ASPECT_RATIO], else None — never blocks
        the upload, unlike MIN_IMAGE_DIMENSION_PX.
    """
    ratio = width / height
    if ratio < MIN_ASPECT_RATIO or ratio > MAX_ASPECT_RATIO:
        return _ASPECT_RATIO_WARNING
    return None


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
    # Only ever set on the upload response itself (a one-time, inline
    # nudge right after choosing the file) — not persisted, and not
    # recomputed on a later list/get, since that would mean re-decoding
    # every stored image's bytes on every list call just to re-derive a
    # warning nobody asked to see again.
    aspect_ratio_warning: str | None = None
    created_at: datetime


class ReorderProductImagesRequest(CamelCaseModel):
    """The product's photos, in the new display order (first = primary).

    Sent as the full ordered id list, not a single move operation — a
    drag-and-drop (or move-left/move-right) reorder naturally produces
    "here's the new order", and rewriting every position from one list is
    simpler and less error-prone than translating a single move into a
    position delta.
    """

    image_ids: list[str]
