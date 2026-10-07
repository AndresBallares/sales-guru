"""One-off backfill of photo size and aspect class for pre-media-metadata uploads.

Covers photos uploaded before product media metadata existed (confirmed
2026-10-07: a script, not a lazy fill).

Run it with scripts/backfill_image_metadata.py once per database after the
`add_product_media_metadata` migration — dev.db now, production as a deploy
step. Idempotent: rows that already have a width are left alone.
"""

from typing import NamedTuple

from prisma import Prisma

from app.core.db import db
from app.services.image_dimensions import ImageDimensionError, get_image_dimensions
from app.services.media_info import classify_aspect


class BackfillResult(NamedTuple):
    """What a backfill run did."""

    updated: int
    skipped: int
    failed: int


async def backfill_image_metadata(client: Prisma | None = None) -> BackfillResult:
    """Measure every photo that has no stored size yet.

    Args:
        client: A connected Prisma client for a specific database (what the
            script passes); defaults to the app's own.

    Returns:
        How many rows were updated, how many already had a size (skipped), and
        how many couldn't be read (failed, left untouched for a human to look
        at). Videos always have their size from upload, so they are skipped.
    """
    prisma = client or db
    updated = skipped = failed = 0
    for row in await prisma.productimage.find_many():
        if row.width is not None:
            skipped += 1
            continue
        try:
            width, height = get_image_dimensions(row.data.decode(), row.contentType)
        except (ImageDimensionError, ValueError):
            failed += 1
            continue
        await prisma.productimage.update(
            where={"id": row.id},
            data={
                "mediaType": "IMAGE",
                "width": width,
                "height": height,
                "sizeBytes": len(row.data.decode()),
                "aspectClass": classify_aspect(width, height),
            },
        )
        updated += 1
    return BackfillResult(updated, skipped, failed)
