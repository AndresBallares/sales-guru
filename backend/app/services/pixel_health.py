"""Is the Pixel Sales Guru uses actually receiving this business's website events?

Worked out on demand (when the dashboard or the publish screen loads) rather than
only while a campaign is live, and stamped with when it was checked, so a warning
from an earlier look can never linger as if it were current. The answer is kept for
ten minutes per business, and "check again" is honoured at most once a minute, so
opening the page repeatedly cannot hammer Meta. Two Meta reads, both free: the ad
account's Pixels (with when each last received an event) and the selected Pixel's
event counts over the last 30 days. The kept answers live in this process, which is
enough for one server; a restart just means one more look.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from typing import Literal

from app.core.config import get_settings
from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.schemas.base import CamelCaseModel
from app.schemas.meta import MetaPixel
from app.services import retargeting
from app.services.meta import (
    MetaConnectionError,
    fetch_pixel_event_counts,
    list_ad_pixels,
)

logger = logging.getLogger(__name__)

PIXEL_HEALTH_TTL = timedelta(minutes=10)
PIXEL_HEALTH_MIN_REFRESH = timedelta(seconds=60)
WINDOW_DAYS = retargeting.WINDOW_DAYS

PixelStatus = Literal[
    "none_selected", "ok", "no_purchase", "no_events", "unavailable", "unreadable"
]


class OtherPixel(CamelCaseModel):
    """Another Pixel on the ad account that did receive events recently."""

    id: str
    name: str
    last_fired_at: datetime


class PixelHealth(CamelCaseModel):
    """The latest look at the selected Pixel, and when it was taken."""

    status: PixelStatus
    pixel_id: str | None
    pixel_name: str | None
    last_fired_at: datetime | None
    checked_at: datetime
    warning: str | None
    other_pixels: list[OtherPixel] = []
    window_days: int = WINDOW_DAYS


_cache: dict[str, PixelHealth] = {}


def remember(business_id: str, health: PixelHealth) -> None:
    """Keep a business's latest look."""
    _cache[business_id] = health


def cached_for(business_id: str) -> PixelHealth | None:
    """The business's kept look, if any."""
    return _cache.get(business_id)


def clear_cache(business_id: str | None = None) -> None:
    """Forget one business's kept look, or every one."""
    if business_id is None:
        _cache.clear()
    else:
        _cache.pop(business_id, None)


def _day(moment: datetime) -> str:
    return f"{moment:%b} {moment.day}"


def assess(
    *,
    pixel_id: str | None,
    pixels: list[MetaPixel],
    counts: dict[str, int],
    now: datetime,
) -> PixelHealth:
    """Work out the Pixel's health from what Meta reported (no Meta calls).

    Args:
        pixel_id: The Pixel Sales Guru uses (None when none is selected).
        pixels: The ad account's Pixels, as Meta lists them.
        counts: The selected Pixel's event name -> count over the window.
        now: The moment of the check.

    Returns:
        "none_selected"; "unavailable" when the Pixel is gone from the account or Meta
        marks it unavailable; "no_events" when it received no website events in the
        window (naming other Pixels on the account that did); "no_purchase" when people
        started checkout but no Purchase was recorded; otherwise "ok".
    """

    def build(
        status: PixelStatus,
        pixel: MetaPixel | None,
        warning: str | None,
        others: list[OtherPixel] | None = None,
    ) -> PixelHealth:
        return PixelHealth(
            status=status,
            pixel_id=pixel_id,
            pixel_name=pixel.name if pixel else None,
            last_fired_at=pixel.last_fired_at if pixel else None,
            checked_at=now,
            warning=warning,
            other_pixels=others or [],
        )

    if pixel_id is None:
        return build("none_selected", None, None)
    pixel = next((p for p in pixels if p.id == pixel_id), None)
    if pixel is None:
        return build(
            "unavailable",
            None,
            "The Pixel Sales Guru uses is no longer on this ad account. "
            "Choose a Pixel again in the Meta connection settings.",
        )
    if pixel.is_unavailable:
        return build(
            "unavailable", pixel, f"Meta marks the Pixel “{pixel.name}” as unavailable."
        )
    if sum(counts.values()) == 0:
        cutoff = now - timedelta(days=WINDOW_DAYS)
        others = sorted(
            (
                OtherPixel(id=p.id, name=p.name, last_fired_at=p.last_fired_at)
                for p in pixels
                if p.id != pixel_id
                and p.last_fired_at is not None
                and p.last_fired_at >= cutoff
            ),
            key=lambda p: p.last_fired_at,
            reverse=True,
        )
        warning = (
            f"This Pixel ({pixel.name}) received no website events in the last "
            f"{WINDOW_DAYS} days. Events from your store may be going to a "
            "different dataset."
        )
        if others:
            named = ", ".join(
                f"{o.name} (last event {_day(o.last_fired_at)})" for o in others
            )
            warning += (
                f" Other datasets on this ad account did receive events: {named}."
            )
        return build("no_events", pixel, warning, others)
    purchase_warning = retargeting.purchase_event_warning(counts)
    if purchase_warning is not None:
        return build("no_purchase", pixel, purchase_warning)
    return build("ok", pixel, None)


async def _clear_stored_warnings(business_id: str) -> None:
    """Drop Pixel warnings stored on the business's campaigns once the Pixel is healthy.

    The live collector stores a warning on a campaign only while it is LIVE, so one
    stored before the problem was fixed (Snake-Ring, 2026-11) would otherwise stay on a
    paused or archived campaign for good. A live campaign's warning is stored again by
    the collector if the problem comes back. Only rows that hold a warning are written.
    """
    campaigns = await db.campaign.find_many(where={"businessId": business_id})
    for campaign in campaigns:
        if campaign.pixelWarning is not None:
            await db.campaign.update(
                where={"id": campaign.id}, data={"pixelWarning": None}
            )


async def get_pixel_health(
    business_id: str, *, refresh: bool = False, now: datetime | None = None
) -> PixelHealth:
    """The business's Pixel health, looked at on demand and rate limited.

    Args:
        business_id: The business.
        refresh: The user asked to check again; honoured at most once a minute.
        now: The current time (injected so tests are exact).

    Returns:
        The kept answer while it is fresh (ten minutes; a minute after a failed
        look), otherwise a new look at Meta. Never raises: a failed read is an
        "unreadable" answer.
    """
    now = now or datetime.now(UTC)
    if get_settings().fake_meta_enabled:
        return PixelHealth(
            status="ok",
            pixel_id="fake_pixel",
            pixel_name="Fake Pixel",
            last_fired_at=now - timedelta(hours=2),
            checked_at=now,
            warning=None,
        )
    connection = await get_meta_connection(business_id)
    if (
        connection is None
        or connection.pixelId is None
        or connection.adAccountId is None
    ):
        return assess(pixel_id=None, pixels=[], counts={}, now=now)

    kept = _cache.get(business_id)
    if kept is not None and kept.pixel_id == connection.pixelId:
        limit = (
            PIXEL_HEALTH_MIN_REFRESH
            if refresh or kept.status == "unreadable"
            else PIXEL_HEALTH_TTL
        )
        if now - kept.checked_at < limit:
            return kept

    try:
        pixels, counts = await asyncio.gather(
            list_ad_pixels(connection.accessToken, connection.adAccountId),
            fetch_pixel_event_counts(
                access_token=connection.accessToken,
                pixel_id=connection.pixelId,
                days=WINDOW_DAYS,
            ),
        )
    except MetaConnectionError:
        health = PixelHealth(
            status="unreadable",
            pixel_id=connection.pixelId,
            pixel_name=None,
            last_fired_at=None,
            checked_at=now,
            warning=(
                "Sales Guru couldn’t check the Pixel just now. "
                "It will try again shortly."
            ),
        )
    else:
        health = assess(
            pixel_id=connection.pixelId, pixels=pixels, counts=counts, now=now
        )
        if health.status == "ok":
            try:
                await _clear_stored_warnings(business_id)
            except Exception:
                logger.exception(
                    "Could not clear stored Pixel warnings for %s", business_id
                )
    remember(business_id, health)
    return health
