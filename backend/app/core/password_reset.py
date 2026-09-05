"""DB-backed password reset tokens."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from prisma.models import PasswordResetToken

from app.core.db import db

RESET_TOKEN_TTL = timedelta(hours=1)

# "3 per email per hour" (confirmed with the user 2026-09-03) — cheap
# enough for a real user who fat-fingered their password twice, tight
# enough to stop someone spamming another person's inbox or hammering
# the Resend quota.
MAX_RESET_REQUESTS_PER_HOUR = 3
_RATE_LIMIT_WINDOW = timedelta(hours=1)


def _hash_token(token: str) -> str:
    """Hash a raw reset token for storage/lookup.

    Same defense-in-depth principle as app/core/session.py's
    _hash_token — a DB read alone shouldn't be enough to reset someone's
    password.

    Args:
        token: The raw reset token (as embedded in the emailed link).

    Returns:
        A SHA-256 hex digest of the token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


async def is_rate_limited(user_id: str) -> bool:
    """Whether this user has already requested the hourly max of resets.

    Counts every token created in the window, used or not — a
    since-superseded token still represents a real request that
    happened, so it still counts against the quota (this is what stops
    unbounded requests from wiping their own history before the count
    is taken).

    Args:
        user_id: The account being checked.

    Returns:
        True once MAX_RESET_REQUESTS_PER_HOUR requests have been made in
        the last hour.
    """
    cutoff = datetime.now(UTC) - _RATE_LIMIT_WINDOW
    count = await db.passwordresettoken.count(
        where={"userId": user_id, "createdAt": {"gte": cutoff}}
    )
    return count >= MAX_RESET_REQUESTS_PER_HOUR


async def create_reset_token(user_id: str) -> str:
    """Supersede any still-active tokens for this user and issue a fresh one.

    Only the newest link a user requested should ever work — an older,
    forwarded, or leaked email shouldn't still be live once a new one's
    been sent.

    Args:
        user_id: The account to issue a token for.

    Returns:
        The raw token — the only time it exists in plaintext; only its
        hash is persisted. The caller embeds this in the emailed link.
    """
    now = datetime.now(UTC)
    await db.passwordresettoken.update_many(
        where={"userId": user_id, "usedAt": None}, data={"usedAt": now}
    )
    token = secrets.token_urlsafe(32)
    await db.passwordresettoken.create(
        data={
            "userId": user_id,
            "tokenHash": _hash_token(token),
            "expiresAt": now + RESET_TOKEN_TTL,
        }
    )
    return token


async def find_valid_token(token: str) -> PasswordResetToken | None:
    """Look up a raw reset token and return its record if still usable.

    Args:
        token: The raw token from the reset link.

    Returns:
        The PasswordResetToken (with .user loaded), or None if it
        doesn't exist, was already used (consumed or superseded), or has
        expired — deliberately not distinguished from each other in the
        return value, same "don't tell an attacker which reason" logic
        as a login failure.
    """
    record = await db.passwordresettoken.find_unique(
        where={"tokenHash": _hash_token(token)}, include={"user": True}
    )
    if (
        record is None
        or record.usedAt is not None
        or record.expiresAt < datetime.now(UTC)
    ):
        return None
    return record


async def mark_token_used(token_id: str) -> None:
    """Mark a reset token consumed, so it can't be replayed.

    Args:
        token_id: The PasswordResetToken's own id (not the raw token).
    """
    await db.passwordresettoken.update(
        where={"id": token_id}, data={"usedAt": datetime.now(UTC)}
    )
