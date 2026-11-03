"""Owner tool: set which research models a business may use and its monthly run limit.

The business user cannot change these (no API route writes them); this script is
the only way until billing exists (BACKLOG.md). ``claude-fable-5-1`` is a premium
extra: add it here for a business that has paid for it.

It writes through the app's own ``set_access`` (validated, same columns billing
will use later) to whatever DATABASE_URL points at, and prints that target first.
Whichever Prisma client flavor is generated must match the target database (see
reset_password.py for the sqlite / postgres note).

Usage:
    uv run python scripts/research_access.py --business-id ID --show
    uv run python scripts/research_access.py --business-id ID \
        --models claude-opus-5-5,claude-fable-5-1
    uv run python scripts/research_access.py --business-id ID --runs-per-month 3
"""

import argparse
import asyncio
import os
import sys
from urllib.parse import urlsplit

from app.core.db import db
from app.services import research_access


def _target() -> str:
    url = os.environ.get("DATABASE_URL", "(unset)")
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.hostname}{parts.path}" if parts.hostname else url


async def _run(args: argparse.Namespace) -> int:
    await db.connect()
    try:
        print(f"Database: {_target()}")
        before = await research_access.access_for(args.business_id)
        print(
            f"Before: models={before.models} runs_per_month={before.runs_per_month} "
            f"used_this_month={before.runs_used}"
        )
        if args.models is not None or args.runs_per_month is not None:
            models = args.models.split(",") if args.models is not None else None
            await research_access.set_access(
                business_id=args.business_id,
                models=[m.strip() for m in models] if models is not None else None,
                runs_per_month=args.runs_per_month,
            )
            after = await research_access.access_for(args.business_id)
            print(
                f"After:  models={after.models} runs_per_month={after.runs_per_month} "
                f"used_this_month={after.runs_used}"
            )
        return 0
    except ValueError as exc:
        print(f"Error: {exc}")
        return 1
    finally:
        await db.disconnect()


def main(argv: list[str] | None = None) -> int:
    """Parse the arguments, show the settings, and change them if asked.

    Args:
        argv: The command line without the program name (``sys.argv`` by default).

    Returns:
        0 on success, 1 on a rejected value or an unknown business.
    """
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--business-id", required=True)
    parser.add_argument("--models", help="comma-separated model ids to allow")
    parser.add_argument("--runs-per-month", type=int)
    parser.add_argument("--show", action="store_true", help="only print the settings")
    args = parser.parse_args(argv)
    if args.show and (args.models is not None or args.runs_per_month is not None):
        parser.error("--show cannot be combined with a change")
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
