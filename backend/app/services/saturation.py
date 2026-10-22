"""Audience-saturation detection for an open-ended campaign (Optimizer).

**What it catches:** broad targeting can collapse into a narrow pocket: the
algorithm keeps serving the same people, so new reach dries up while frequency
climbs and results decay. The response is a proposal to duplicate the winning
ads into an adjacent-interest ad set (see the PRD's Part B). It is only ever a
proposal; nothing here acts on Meta.

**The rule (all four must hold, on two daily evaluations in a row):**

1. *Spend holding up:* the last 7 days' spend is at least
   `saturation_min_spend_7d`, the last 7 days' impressions at least
   `saturation_min_impressions_7d`, and spend is not falling (at least
   `saturation_spend_floor_ratio` of the 7 days before). Without this, flat
   reach just means the campaign stopped spending.
2. *New reach has dried up:* new people reached per dollar over the last 7
   days is at most `saturation_reach_per_dollar_ratio` of the first 14 days'
   rate. Comparing rates rather than raw growth keeps the rule honest as a
   campaign ages, since lifetime reach growth falls on its own over time.
3. *Frequency is high:* unique frequency over the last 7 days is at least
   `saturation_min_frequency` (from a windowed Insights query: unique reach is
   not additive, so lifetime snapshots cannot give it).
4. *Most impressions are repeats:* fewer than `saturation_max_first_time_ratio`
   of the last 7 days' impressions went to people reached for the first time.
   Meta's Insights API has no such field, so this is derived: new people
   reached (the change in lifetime reach) divided by the impressions in the
   window. "First time" means first time for this campaign.

Only a campaign past its creative test, with `saturation_min_days` of real
delivery, is evaluated. Everything is computed from stored lifetime-to-date
snapshots, so the maths is exact and needs no extra Meta call except the one
windowed frequency.
"""

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import NamedTuple, Protocol

from app.core.config import Settings
from app.services.proposals import ProposalNotBuiltError


class SaturationResponseNotBuiltError(ProposalNotBuiltError):
    """Raised when the saturation response is approved: building it isn't done."""


class Snapshot(Protocol):
    """The Metric columns the rule reads (a Prisma Metric satisfies it)."""

    fetchedAt: datetime  # noqa: N815 (Prisma's column name)
    spend: float
    impressions: int
    reach: int | None
    frequency7d: float | None  # noqa: N815 (Prisma's column name)


class SaturationReading(NamedTuple):
    """The numbers behind one evaluation, and whether the rule holds."""

    spend_7d: float
    spend_prev_7d: float
    impressions_7d: int
    new_reach_7d: int
    reach_per_dollar_7d: float
    reach_per_dollar_baseline: float
    frequency_7d: float
    first_time_ratio_7d: float
    spend_ok: bool
    reach_ok: bool
    frequency_ok: bool
    first_time_ok: bool

    @property
    def fired(self) -> bool:
        """Whether every condition holds on this evaluation."""
        return (
            self.spend_ok and self.reach_ok and self.frequency_ok and self.first_time_ok
        )


def _nearest_at_or_before(
    snapshots: Sequence[Snapshot], cutoff: datetime
) -> Snapshot | None:
    candidates = [s for s in snapshots if s.fetchedAt <= cutoff]
    return max(candidates, key=lambda s: s.fetchedAt) if candidates else None


def evaluate(
    snapshots: Sequence[Snapshot], settings: Settings, *, now: datetime
) -> SaturationReading | None:
    """Evaluate the saturation rule against a campaign's stored snapshots.

    Args:
        snapshots: The campaign-level Metric snapshots (not ad or ad-set rows),
            any order.
        settings: The thresholds.
        now: The time of evaluation.

    Returns:
        The reading, or None when the campaign can't be evaluated yet: under
        `saturation_min_days` of delivery, a missing snapshot at 7 or 14 days
        ago, missing reach, or no recent windowed frequency.
    """
    delivering = sorted(
        (s for s in snapshots if s.spend > 0 and s.impressions > 0),
        key=lambda s: s.fetchedAt,
    )
    if not delivering:
        return None
    started = delivering[0].fetchedAt
    if now - started < timedelta(days=settings.saturation_min_days):
        return None
    latest = max(snapshots, key=lambda s: s.fetchedAt)
    week_ago = _nearest_at_or_before(snapshots, now - timedelta(days=7))
    two_weeks_ago = _nearest_at_or_before(snapshots, now - timedelta(days=14))
    baseline = _nearest_at_or_before(
        snapshots, started + timedelta(days=settings.saturation_min_days)
    )
    if week_ago is None or two_weeks_ago is None or baseline is None:
        return None
    if latest.reach is None or week_ago.reach is None or baseline.reach is None:
        return None
    # The windowed frequency is fetched about once a day; use the newest one,
    # but not a stale one.
    windowed = [
        s
        for s in snapshots
        if s.frequency7d is not None and now - s.fetchedAt <= timedelta(hours=36)
    ]
    if not windowed:
        return None
    frequency = max(windowed, key=lambda s: s.fetchedAt).frequency7d
    assert frequency is not None  # filtered above

    spend_7d = latest.spend - week_ago.spend
    spend_prev = week_ago.spend - two_weeks_ago.spend
    impressions_7d = latest.impressions - week_ago.impressions
    new_reach = max(latest.reach - week_ago.reach, 0)
    if spend_7d <= 0 or impressions_7d <= 0 or baseline.spend <= 0:
        return None
    reach_per_dollar = new_reach / spend_7d
    baseline_rate = baseline.reach / baseline.spend
    first_time_ratio = new_reach / impressions_7d
    return SaturationReading(
        spend_7d=spend_7d,
        spend_prev_7d=spend_prev,
        impressions_7d=impressions_7d,
        new_reach_7d=new_reach,
        reach_per_dollar_7d=reach_per_dollar,
        reach_per_dollar_baseline=baseline_rate,
        frequency_7d=frequency,
        first_time_ratio_7d=first_time_ratio,
        spend_ok=(
            spend_7d >= settings.saturation_min_spend_7d
            and impressions_7d >= settings.saturation_min_impressions_7d
            and spend_7d >= settings.saturation_spend_floor_ratio * spend_prev
        ),
        reach_ok=reach_per_dollar
        <= settings.saturation_reach_per_dollar_ratio * baseline_rate,
        frequency_ok=frequency >= settings.saturation_min_frequency,
        first_time_ok=first_time_ratio < settings.saturation_max_first_time_ratio,
    )


def numbers(reading: SaturationReading) -> str:
    """The figures behind a firing, in plain language."""
    return (
        f"In the last 7 days you spent ${reading.spend_7d:,.0f} "
        f"(${reading.spend_prev_7d:,.0f} the week before) and reached "
        f"{reading.new_reach_7d:,} new people, {reading.reach_per_dollar_7d:,.1f} "
        f"per dollar against {reading.reach_per_dollar_baseline:,.1f} per dollar in "
        f"the first 14 days. Frequency was {reading.frequency_7d:.1f}, and only "
        f"{reading.first_time_ratio_7d:.0%} of impressions went to people reached "
        "for the first time."
    )


def warning_text(reading: SaturationReading) -> str:
    """The short warning shown on the dashboard and the campaign."""
    return (
        "Audience saturation: reach has plateaued while frequency climbs. "
        + numbers(reading)
    )


def proposal_reasoning(reading: SaturationReading) -> str:
    """The Optimizer proposal's reasoning, with the triggering numbers."""
    return (
        "Audience saturation detected — reach has plateaued while frequency "
        "climbs and most impressions go to people already reached. "
        + numbers(reading)
        + " Proposed: duplicate the winning ad(s) into an adjacent-interest ad "
        "set to reach fresh buyers. Nothing changes until you approve."
    )
