"""One-time (re-runnable) backfill: measure photos uploaded before product media.

The `add_product_media_metadata` migration added width/height/sizeBytes/
aspectClass to ProductImage; every photo that existed before it has them null.
This reads each such photo's header and fills them in. Re-running is a no-op
for rows that already have a size; unreadable rows are reported and left alone.
It only ever writes those four columns (and mediaType IMAGE) on rows that have
no width.

Run it once per database after `prisma migrate deploy`: against dev.db now, and
against production as a deploy step.

Goes through Prisma (see reset_password.py's docstring, and the same
dual-schema caveat: whichever client flavor is generated locally has to match
the target database's provider).

Usage:
    uv run python scripts/backfill_image_metadata.py \
        --database-url "file:./prisma/dev.db"

DATABASE_URL can be set in the environment instead of passed with
--database-url.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.media_backfill import backfill_image_metadata  # noqa: E402
from prisma import Prisma  # noqa: E402


def _resolve_database_url(args: argparse.Namespace) -> str:
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        print("error: pass --database-url or set DATABASE_URL", file=sys.stderr)
        raise SystemExit(1)
    return url


def _describe(url: str) -> str:
    """The target without credentials, for the log line."""
    return url.split("@")[-1] if "@" in url else url


async def _run(database_url: str) -> None:
    print(f"Backfilling photo metadata in: {_describe(database_url)}")
    db = Prisma(datasource={"url": database_url})
    await db.connect()
    try:
        result = await backfill_image_metadata(db)
    finally:
        await db.disconnect()
    print(
        f"Updated {result.updated}, already measured {result.skipped}, "
        f"unreadable {result.failed}."
    )
    if result.failed:
        raise SystemExit(2)


def main() -> None:
    """Parse args and run the backfill."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--database-url",
        help="A connection string matching the currently generated Prisma "
        "client's provider. Falls back to $DATABASE_URL.",
    )
    args = parser.parse_args()
    asyncio.run(_run(_resolve_database_url(args)))


if __name__ == "__main__":
    main()
