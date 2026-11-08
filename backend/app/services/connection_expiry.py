"""When a business's Meta connection needs to be signed in again.

A Meta long-lived token lasts about 60 days and cannot be renewed without the
user signing in to Meta, so the app warns ahead of the date and says so once it has
passed. Worked out on the server with the server's clock, so the page needs no
date arithmetic and a wrong browser clock cannot hide the warning.
"""

from datetime import datetime, timedelta
from typing import Literal, NamedTuple

ExpiryStatus = Literal["ok", "expiring_soon", "expired"]

# The warning starts this many days before the token expires (inclusive).
EXPIRY_WARNING_DAYS = 14


class ConnectionExpiry(NamedTuple):
    """The connection's expiry state and the whole days left (None once expired)."""

    status: ExpiryStatus
    days_until_expiry: int | None


def connection_expiry(expires_at: datetime, now: datetime) -> ConnectionExpiry:
    """Classify a token's expiry.

    Args:
        expires_at: When the token expires.
        now: The current time.

    Returns:
        "expired" (no days left) at or after the expiry; "expiring_soon" with the
        whole days left (0 within the last day) when 14 days or fewer remain; "ok"
        otherwise.
    """
    remaining = expires_at - now
    if remaining <= timedelta(0):
        return ConnectionExpiry("expired", None)
    days = remaining // timedelta(days=1)
    if remaining <= timedelta(days=EXPIRY_WARNING_DAYS):
        return ConnectionExpiry("expiring_soon", days)
    return ConnectionExpiry("ok", days)
