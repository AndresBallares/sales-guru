"""Schemas for product image upload (PRD.md §2 step 4)."""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel
from app.services.media_info import AspectClass

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

# Product media can also be a short video (mp4/mov), stored in the database
# like photos (Option A — V1 only, object storage deferred, confirmed
# 2026-10-07). Meta itself allows far larger files; this cap is what a Postgres
# column and one in-memory request can carry safely, and a 30-second ad video
# fits well within it.
# .m4v is an MP4 container that browsers tag video/x-m4v; it is stored as video/mp4.
ALLOWED_VIDEO_CONTENT_TYPES = frozenset({"video/mp4", "video/quicktime", "video/x-m4v"})
MAX_VIDEO_BYTES = 50 * 1024 * 1024
MAX_VIDEO_SECONDS = 60

MediaType = Literal["IMAGE", "VIDEO"]

_UNCLASSIFIED_WARNING = (
    "This {kind}'s shape isn't a standard ad shape (1:1 or 4:5 feed, 9:16 "
    "story, 1.91:1 landscape) — Meta may crop it unpredictably in some ad "
    "placements."
)


def unclassified_warning(aspect_class: AspectClass, kind: str) -> str | None:
    """A non-blocking warning for media that matches no standard ad shape.

    Replaces the old "outside 1:1-4:5" photo warning: 9:16 and 1.91:1 are now
    legitimate shapes, so only UNCLASSIFIED media is flagged.

    Args:
        aspect_class: The media's classification (media_info.classify_aspect).
        kind: "photo" or "video", for the message.

    Returns:
        The warning text for UNCLASSIFIED media, else None. Never blocks an
        upload, unlike MIN_IMAGE_DIMENSION_PX.
    """
    if aspect_class == "UNCLASSIFIED":
        return _UNCLASSIFIED_WARNING.format(kind=kind)
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
    # Measured at upload; null for photos uploaded before product media
    # existed until scripts/backfill_image_metadata.py has been run.
    media_type: MediaType = "IMAGE"
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    size_bytes: int | None = None
    aspect_class: AspectClass | None = None
    # A video's browser-captured thumbnail; null for a photo.
    thumbnail_url: str | None = None


class ReorderProductImagesRequest(CamelCaseModel):
    """The product's photos, in the new display order (first = primary).

    Sent as the full ordered id list, not a single move operation — a
    drag-and-drop (or move-left/move-right) reorder naturally produces
    "here's the new order", and rewriting every position from one list is
    simpler and less error-prone than translating a single move into a
    position delta.
    """

    image_ids: list[str]
