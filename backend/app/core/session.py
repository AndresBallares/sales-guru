"""Cookie-based, DB-backed session management."""

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, HTTPException, status
from prisma.models import User

from app.core.db import db

SESSION_COOKIE_NAME = "session"
SESSION_TTL = timedelta(days=30)

_NOT_AUTHENTICATED = "Not authenticated"


def _hash_token(token: str) -> str:
    """Hash a raw session token for storage/lookup.

    Args:
        token: The raw session token (as stored in the client's cookie).

    Returns:
        A SHA-256 hex digest of the token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(user_id: str) -> str:
    """Create a new session for a user.

    Args:
        user_id: The id of the user to create a session for.

    Returns:
        The raw session token — the only time it exists in plaintext; only
        its hash is persisted.
    """
    token = secrets.token_urlsafe(32)
    await db.session.create(
        data={
            "userId": user_id,
            "tokenHash": _hash_token(token),
            "expiresAt": datetime.now(UTC) + SESSION_TTL,
        }
    )
    return token


async def delete_session(token: str) -> None:
    """Delete a session by its raw token, if it exists.

    Args:
        token: The raw session token to invalidate.
    """
    await db.session.delete_many(where={"tokenHash": _hash_token(token)})


async def get_current_user(
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> User:
    """Resolve the current user from the session cookie.

    FastAPI dependency — raises 401 if there's no cookie, the session
    doesn't exist, or it has expired.

    Args:
        session: The raw session token from the request cookie.

    Returns:
        The authenticated User.

    Raises:
        HTTPException: 401 if the session is missing, invalid, or expired.
    """
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=_NOT_AUTHENTICATED
        )

    record = await db.session.find_unique(
        where={"tokenHash": _hash_token(session)}, include={"user": True}
    )
    if record is None or record.user is None or record.expiresAt < datetime.now(UTC):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=_NOT_AUTHENTICATED
        )

    return record.user
