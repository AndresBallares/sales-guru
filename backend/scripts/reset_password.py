"""Admin tool: reset a user's password directly.

Bypasses the (not yet built) self-service forgot-password flow. Hashes
the new password with the app's own Argon2 hasher
(app.core.security.hash_password) — the exact same one /auth/login
verifies against — then writes it through the real Prisma client (a
plain user.update, same as any other write in this codebase), not raw
SQL: that's what makes User.updatedAt bump automatically (Prisma's
@updatedAt only fires on writes that go through Prisma) and lets this
also invalidate every existing session for the account, same as a
compromised-password reset should.

Whichever Prisma client flavor happens to be generated locally has to
match the target database's provider (sqlite dev vs. postgres prod) —
this project's dual-schema setup, not something this script can paper
over. Regenerate first if needed:
    uv run prisma generate --schema=prisma/postgres/schema.prisma
and regenerate back to the default (sqlite) schema afterward for local
dev:
    uv run prisma generate

Usage:
    uv run python scripts/reset_password.py --email USER_EMAIL \
        --database-url "postgresql://..."

    uv run python scripts/reset_password.py --email USER_EMAIL \
        --database-url "postgresql://..." --password "chosen-password"

DATABASE_URL can be set in the environment instead of passed with
--database-url. Omit --password to auto-generate a random one, printed
once at the end — relay it to the user immediately, it isn't saved
anywhere by this script. The email is matched case-insensitively
(lowercased before lookup), same normalization as signup/login.
"""

import argparse
import asyncio
import os
import secrets
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.security import hash_password  # noqa: E402
from prisma import Prisma  # noqa: E402

# Unambiguous characters only (no 0/O/1/l/I) — this gets read aloud or
# retyped by a human under time pressure.
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
_GENERATED_PASSWORD_LENGTH = 16
# Matches SignupRequest.password's Field(min_length=8), app/schemas/auth.py
# — a reset password shouldn't be weaker than what signup itself allows.
_MIN_PASSWORD_LENGTH = 8


def _generate_password() -> str:
    return "".join(secrets.choice(_ALPHABET) for _ in range(_GENERATED_PASSWORD_LENGTH))


def _resolve_database_url(args: argparse.Namespace) -> str:
    url = args.database_url or os.environ.get("DATABASE_URL")
    if not url:
        print("error: pass --database-url or set DATABASE_URL", file=sys.stderr)
        raise SystemExit(1)
    return url


async def _reset(*, database_url: str, email: str, password: str) -> None:
    """Reset one user's password and invalidate their existing sessions.

    Args:
        database_url: A connection string matching the currently
            generated Prisma client's provider (sqlite dev / postgres
            prod).
        email: The account's email, already lowercased.
        password: The new plaintext password to set.
    """
    db = Prisma(datasource={"url": database_url})
    await db.connect()
    try:
        user = await db.user.find_unique(where={"email": email})
        if user is None:
            print(
                f"error: no user found with email {email!r} — nothing updated",
                file=sys.stderr,
            )
            raise SystemExit(1)

        await db.user.update(
            where={"id": user.id}, data={"hashedPassword": hash_password(password)}
        )
        invalidated = await db.session.delete_many(where={"userId": user.id})

        print(f"Password reset for {user.email} (id {user.id}).")
        print(f"Invalidated {invalidated} existing session(s).")
        print(f"New password: {password}")
    finally:
        await db.disconnect()


def main() -> None:
    """Parse args, hash the new password, and write it via Prisma."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--email", required=True, help="The account's email address.")
    parser.add_argument(
        "--database-url",
        help="A connection string matching the currently generated Prisma "
        "client's provider. Falls back to $DATABASE_URL.",
    )
    parser.add_argument(
        "--password",
        help="The new password to set. Omit to auto-generate a random one.",
    )
    args = parser.parse_args()

    database_url = _resolve_database_url(args)
    email = args.email.lower()
    password = args.password or _generate_password()
    if len(password) < _MIN_PASSWORD_LENGTH:
        print(
            f"error: password must be at least {_MIN_PASSWORD_LENGTH} characters",
            file=sys.stderr,
        )
        raise SystemExit(1)

    asyncio.run(_reset(database_url=database_url, email=email, password=password))


if __name__ == "__main__":
    main()
