"""Record the latest failed attempt to read a business's numbers from Meta.

Stored on the business's MetaConnection (latest state only, no history): when it
failed, which job, Meta's error code and a scrubbed reason. The dashboard reads it
to say *why* the numbers are stale instead of only that they are.

Two jobs record: the 15-minute metrics collector ("collection") and the
account-spend check ("reconcile"). A job that succeeds clears only its own failure,
and the spend check never overwrites the collector's, because a collector that cannot
read is the more serious fault. The settle job only logs.
"""

import re
from datetime import UTC, datetime
from typing import Literal

from app.core.db import db
from app.services.meta import MetaConnectionError

SyncSource = Literal["collection", "reconcile"]

REASON_MAX_LENGTH = 300
# Meta error codes that mean the access token is no longer good: 190 (invalid or
# expired), 102 (session invalid), 463 (expired) and 467 (invalid).
_TOKEN_ERROR_CODES = frozenset({190, 102, 463, 467})

# Meta error codes for "too many calls": application (4), user (17), page (32) and
# custom (613) request limits.
_RATE_LIMIT_CODES = frozenset({4, 17, 32, 613})

_QUERY_TOKEN = re.compile(r"access_token=[^&\s'\"]+")
_BARE_TOKEN = re.compile(r"\bEAA[A-Za-z0-9]{20,}\b")


def scrub_reason(text: str) -> str:
    """Make an error message safe to store and show: no tokens, at most 300 characters.

    Args:
        text: The raw error text.

    Returns:
        The text with any ``access_token=...`` parameter and any bare Meta token
        replaced by ``[removed]``, cut to 300 characters (ending in an ellipsis when
        cut), or "Unknown error" when nothing is left.
    """
    cleaned = _BARE_TOKEN.sub("[removed]", _QUERY_TOKEN.sub("[removed]", text)).strip()
    if not cleaned:
        return "Unknown error"
    if len(cleaned) > REASON_MAX_LENGTH:
        return cleaned[: REASON_MAX_LENGTH - 1] + "…"
    return cleaned


def is_token_problem(code: int | None) -> bool:
    """Whether a Meta error code means the connection needs to be signed in again."""
    return code in _TOKEN_ERROR_CODES


def friendly_reason(code: int | None, raw_reason: str) -> str:
    """Say a stored failure in words for the business owner.

    Args:
        code: Meta's error code, if it sent one.
        raw_reason: The stored (scrubbed) reason.

    Returns:
        A plain sentence for a bad token, a rate limit or a network problem; Meta's
        own words for anything else.
    """
    if is_token_problem(code):
        return (
            "Meta no longer accepts your connection (the sign-in expired or was "
            "removed). Reconnect Meta to keep your results updating."
        )
    if code in _RATE_LIMIT_CODES:
        return (
            "Meta is limiting requests right now. Sales Guru will try again "
            "automatically."
        )
    if code is None and raw_reason.startswith("Meta API call failed"):
        return "Sales Guru couldn’t reach Meta. It will try again automatically."
    return raw_reason


def _describe(error: Exception) -> tuple[int | None, str]:
    if isinstance(error, MetaConnectionError):
        return error.code, scrub_reason(str(error))
    return None, scrub_reason(f"{type(error).__name__}: {error}")


async def record_sync_failure(
    business_id: str, source: SyncSource, error: Exception
) -> None:
    """Store a failed read on the business's connection.

    The spend check's failure is not stored while the collector's failure is on
    record. Does nothing when the business has no connection.

    Args:
        business_id: The business whose read failed.
        source: Which job failed.
        error: What it raised.
    """
    connection = await db.metaconnection.find_unique(where={"businessId": business_id})
    if connection is None:
        return
    if source == "reconcile" and connection.syncFailureSource == "collection":
        return
    code, reason = _describe(error)
    await db.metaconnection.update(
        where={"businessId": business_id},
        data={
            "syncFailedAt": datetime.now(UTC),
            "syncFailureSource": source,
            "syncFailureCode": code,
            "syncFailureReason": reason,
        },
    )


async def clear_sync_failure(business_id: str, source: SyncSource) -> None:
    """Clear the stored failure if it came from this job.

    Args:
        business_id: The business whose read just worked.
        source: The job that worked; a failure from the other job is left alone.
    """
    connection = await db.metaconnection.find_unique(where={"businessId": business_id})
    if connection is None or connection.syncFailureSource != source:
        return
    await db.metaconnection.update(
        where={"businessId": business_id},
        data={
            "syncFailedAt": None,
            "syncFailureSource": None,
            "syncFailureCode": None,
            "syncFailureReason": None,
        },
    )
