"""Curated jewelry trade show venues for event/venue geo-targeting.

PRD.md build step 11, confirmed 2026-09-01. A small, fixed, well-known set
of major annual US jewelry trade shows — unlike Meta's interest taxonomy
(which churns and needs the live-resolution/freshness machinery planned
for the interest lookup table in step 5's Phase C) or free-text city/
region geo (unbounded), venue coordinates don't change, so this is
hand-curated with no live API dependency and no freshness/re-validation
job, same "backend decides structural facts, never LLM-sourced" reasoning
already applied to industry benchmarks (app/services/benchmarks.py).
"""

from datetime import date, timedelta
from typing import NamedTuple


class EventVenue(NamedTuple):
    """One curated jewelry trade show venue.

    typical_month/typical_duration_days describe a recurring annual
    show's usual window — used only to default a campaign's start/end
    dates (see default_event_window), always editable by the user at
    campaign creation, never treated as an authoritative real calendar
    (actual show dates shift year to year and aren't tracked here).
    """

    key: str
    name: str
    venue: str
    city: str
    state: str
    lat: float
    lng: float
    typical_month: int
    typical_duration_days: int
    recommended_radius_miles: float


# Exact list is a starting set, not exhaustive — expand as needed. Lat/lng
# are the venue's approximate coordinates, accurate enough for multi-mile
# radius targeting; Meta's actual supported radius range/units still need
# verifying against the real API at implementation time (PRD.md step 11).
EVENT_VENUES: dict[str, EventVenue] = {
    "jck_las_vegas": EventVenue(
        key="jck_las_vegas",
        name="JCK Las Vegas",
        venue="Las Vegas Convention Center",
        city="Las Vegas",
        state="NV",
        lat=36.1299,
        lng=-115.1529,
        typical_month=6,
        typical_duration_days=4,
        recommended_radius_miles=10.0,
    ),
    "couture_las_vegas": EventVenue(
        key="couture_las_vegas",
        name="Couture",
        venue="Wynn Las Vegas",
        city="Las Vegas",
        state="NV",
        lat=36.1266,
        lng=-115.1663,
        typical_month=6,
        typical_duration_days=4,
        recommended_radius_miles=10.0,
    ),
    "agta_gemfair_tucson": EventVenue(
        key="agta_gemfair_tucson",
        name="AGTA GemFair Tucson",
        venue="Tucson Convention Center",
        city="Tucson",
        state="AZ",
        lat=32.2201,
        lng=-110.9747,
        typical_month=1,
        typical_duration_days=5,
        recommended_radius_miles=15.0,
    ),
    "ja_new_york": EventVenue(
        key="ja_new_york",
        name="JA New York",
        venue="Javits Center",
        city="New York",
        state="NY",
        lat=40.7577,
        lng=-74.0028,
        typical_month=3,
        typical_duration_days=3,
        recommended_radius_miles=10.0,
    ),
}


def default_event_window(
    venue: EventVenue, *, today: date | None = None
) -> tuple[date, date]:
    """A default start/end window for a venue's next occurrence.

    Deliberately simple: the 1st of typical_month through
    typical_duration_days later, in the current year if that month
    hasn't started yet this year, otherwise next year. Real show dates
    shift year to year and aren't tracked here — this is only ever a
    default, always user-editable at campaign creation.

    Args:
        venue: The event venue.
        today: Reference date to compute "already passed this year"
            from. Defaults to the real current date.

    Returns:
        (start_date, end_date), inclusive.
    """
    reference = today or date.today()
    passed_this_year = reference.month > venue.typical_month
    year = reference.year + 1 if passed_this_year else reference.year
    start = date(year, venue.typical_month, 1)
    end = start + timedelta(days=venue.typical_duration_days - 1)
    return start, end
