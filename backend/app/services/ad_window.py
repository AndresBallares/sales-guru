"""Compare ads over the window in which all of them were running.

A stored ad-level ``Metric`` row is Meta's cumulative lifetime figure for one ad,
collected about every 15 minutes. Ranking ads on those latest rows favors the ad
that went live first: it has had longer to collect add-to-carts. This module
instead measures every ad over the same stretch of time, so the ads are compared
on equal exposure.

An ad's numbers in a window are the **difference of two cumulative snapshots**
(its newest row at the window's end minus its newest row at the window's start),
never a sum of increments. Revisions Meta makes in between therefore cannot
accumulate (see docs/common-window.md, "Meta's reporting lag").

The window starts when the *last* compared ad started delivering and ends at the
newest snapshot. An ad that never delivered in the window (it was paused before
the window began) is left out and listed.
"""

from collections.abc import Iterable
from datetime import datetime, timedelta
from typing import Literal, NamedTuple

from app.services.metric_rows import Snapshot, Totals

WindowStatus = Literal["ok", "too_short", "too_few_ads"]

# Used for an ad whose first stored row already shows delivery: its start is
# just before that row, and everything before it counts as zero.
_JUST_BEFORE = timedelta(microseconds=1)


class CommonWindow(NamedTuple):
    """The shared window and each compared ad's numbers inside it.

    ``per_ad`` is filled even when the window is too short, so the numbers can
    still be shown; ``status`` says whether they can support a ranking.
    """

    start: datetime | None
    end: datetime | None
    hours: float
    per_ad: dict[str, Totals]
    excluded: tuple[str, ...]
    status: WindowStatus
    min_hours: float

    @property
    def label(self) -> str | None:
        """How to tell the owner what the comparison covers; None with no window."""
        if self.status == "too_few_ads":
            return None
        if self.hours >= 48:
            span = f"{round(self.hours / 24)} days"
        else:
            hours = max(1, round(self.hours))
            span = f"{hours} hour{'' if hours == 1 else 's'}"
        return f"Compared over the last {span}, while all ads ran"

    @property
    def too_short_reason(self) -> str | None:
        """Why there is no ranking for lack of shared time, else None."""
        if self.status != "too_short":
            return None
        return (
            f"these ads have only run side by side for {round(self.hours)} hours "
            f"({self.min_hours:g} needed)"
        )


class _AdRows(NamedTuple):
    """One ad's rows, oldest first, and when it started and last delivered."""

    rows: list[Snapshot]
    start: datetime
    last_active: datetime


def _ad_rows(rows: list[Snapshot]) -> _AdRows | None:
    """An ad's delivery span; None if it never delivered."""
    rows = sorted(rows, key=lambda r: r.fetched_at)
    first = next((i for i, r in enumerate(rows) if r.impressions > 0), None)
    if first is None:
        return None
    start = (
        rows[first - 1].fetched_at if first > 0 else rows[0].fetched_at - _JUST_BEFORE
    )
    last_active = rows[first].fetched_at
    for before, after in zip(rows[first:], rows[first + 1 :], strict=False):
        if after.impressions > before.impressions:
            last_active = after.fetched_at
    return _AdRows(rows, start, last_active)


def _cumulative_at(rows: list[Snapshot], at: datetime) -> Snapshot | None:
    """The ad's newest row at or before ``at``; None if it has none (it was zero)."""
    latest: Snapshot | None = None
    for row in rows:
        if row.fetched_at <= at:
            latest = row
    return latest


def _difference(
    end: int | float | None, base: Snapshot | None, field: str
) -> float | None:
    """A cumulative field's change: unavailable stays None, below 0 clamps to 0."""
    if end is None:
        return None
    if base is None:
        return float(end)
    before = getattr(base, field)
    if before is None:
        # Meta sends no add-to-cart or purchase figure until the ad has had its
        # first such action, so an earlier row without one means zero then. (A
        # figure missing at the END stays None: that is "unavailable".)
        return float(end)
    return max(0.0, float(end) - float(before))


def _window_totals(rows: list[Snapshot], start: datetime, end: datetime) -> Totals:
    last = _cumulative_at(rows, end)
    assert last is not None  # the window ends at a row of this ad or later
    base = _cumulative_at(rows, start)

    def count(field: str) -> int | None:
        value = _difference(getattr(last, field), base, field)
        return None if value is None else int(value)

    def money(field: str) -> float | None:
        return _difference(getattr(last, field), base, field)

    return Totals(
        impressions=count("impressions") or 0,
        spend=money("spend") or 0.0,
        link_clicks=count("link_clicks"),
        landing_page_views=count("landing_page_views"),
        add_to_cart=count("add_to_cart"),
        initiated_checkout=count("initiated_checkout"),
        purchases=count("purchases"),
        purchase_value=money("purchase_value"),
        as_of=last.fetched_at,
    )


def compare_ads(snapshots: Iterable[Snapshot], *, min_hours: float) -> CommonWindow:
    """Each ad's numbers over the window in which all compared ads were running.

    Args:
        snapshots: Stored rows; only ad-level rows (``ad_id`` set) are read.
        min_hours: The shortest window that can support a ranking.

    Returns:
        The window and the per-ad numbers inside it. ``status`` is "too_few_ads"
        with fewer than two ads delivering in the window, "too_short" when the
        window is shorter than ``min_hours``, else "ok".
    """
    by_ad: dict[str, list[Snapshot]] = {}
    for snapshot in snapshots:
        if snapshot.ad_id is not None:
            by_ad.setdefault(snapshot.ad_id, []).append(snapshot)

    spans = {ad: span for ad, rows in by_ad.items() if (span := _ad_rows(rows))}
    excluded = [ad for ad in by_ad if ad not in spans]
    while spans:
        start = max(span.start for span in spans.values())
        stopped = [ad for ad, span in spans.items() if span.last_active <= start]
        if not stopped:
            break
        excluded += stopped
        for ad in stopped:
            del spans[ad]
    if not spans:
        return CommonWindow(
            None, None, 0.0, {}, tuple(excluded), "too_few_ads", min_hours
        )

    end = max(span.rows[-1].fetched_at for span in spans.values())
    hours = (end - start).total_seconds() / 3600
    per_ad = {ad: _window_totals(span.rows, start, end) for ad, span in spans.items()}
    if len(spans) < 2:
        status: WindowStatus = "too_few_ads"
    elif hours < min_hours:
        status = "too_short"
    else:
        status = "ok"
    return CommonWindow(start, end, hours, per_ad, tuple(excluded), status, min_hours)
