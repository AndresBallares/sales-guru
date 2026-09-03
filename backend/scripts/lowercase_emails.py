"""One-time (re-runnable) data fix: lowercase every User.email.

Signup/login/the reset script all normalize emails to lowercase now
(app/schemas/auth.py's _lowercase_email), so User.email is effectively
case-insensitive-unique going forward — but any row written before that
existed may still be mixed-case. This brings existing rows in line.

Checks for collisions across the *whole* table before writing anything —
two existing rows that would map to the same lowercased email (e.g.
"Foo@Bar.com" and "foo@bar.com" both already present) abort the run with
nothing changed, since User.email is @unique and a blind write would
just trade one bug for a worse one. Re-running once everything's already
lowercase is a no-op.

Goes through Prisma (see reset_password.py's docstring for why, and the
same dual-schema caveat: whichever client flavor is generated locally
has to match the target database's provider).

Usage:
    uv run python scripts/lowercase_emails.py --database-url "postgresql://..."

DATABASE_URL can be set in the environment instead of passed with
--database-url.
"""

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from prisma import Prisma  # noqa: E402


def _resolve_database_url(args: argparse.Namespace) -> str:
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        print("error: pass --database-url or set DATABASE_URL", file=sys.stderr)
        raise SystemExit(1)
    return url


async def _lowercase_emails(database_url: str) -> None:
    db = Prisma(datasource={"url": database_url})
    await db.connect()
    try:
        users = await db.user.find_many()

        by_lowered: dict[str, list[str]] = {}
        for user in users:
            by_lowered.setdefault(user.email.lower(), []).append(user.id)
        collisions = {email: ids for email, ids in by_lowered.items() if len(ids) > 1}
        if collisions:
            print(
                "error: these would collide after lowercasing — resolve manually "
                "first, nothing changed:",
                file=sys.stderr,
            )
            for email, ids in collisions.items():
                print(f"  {email!r}: user ids {ids}", file=sys.stderr)
            raise SystemExit(1)

        changed = 0
        for user in users:
            lowered = user.email.lower()
            if lowered != user.email:
                await db.user.update(where={"id": user.id}, data={"email": lowered})
                print(f"  {user.email!r} -> {lowered!r}")
                changed += 1

        print(f"Lowercased {changed} of {len(users)} user email(s).")
    finally:
        await db.disconnect()


def main() -> None:
    """Parse args and run the one-time lowercase fix."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--database-url",
        help="A connection string matching the currently generated Prisma "
        "client's provider. Falls back to $DATABASE_URL.",
    )
    args = parser.parse_args()

    asyncio.run(_lowercase_emails(_resolve_database_url(args)))


if __name__ == "__main__":
    main()
