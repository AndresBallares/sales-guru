"""Tests for the curated event-venue lookup table (PRD.md build step 11)."""

from datetime import date

from app.services.event_venues import EVENT_VENUES, default_event_window


def test_all_venues_have_unique_keys_matching_their_dict_key() -> None:
    """Each entry's own .key field matches the dict key it's stored under."""
    for key, venue in EVENT_VENUES.items():
        assert venue.key == key


def test_all_venues_have_plausible_us_coordinates() -> None:
    """Sanity bounds — every curated venue is inside the continental US."""
    for venue in EVENT_VENUES.values():
        assert 24.0 <= venue.lat <= 50.0
        assert -125.0 <= venue.lng <= -66.0


def test_default_event_window_stays_in_the_current_year_before_the_month() -> None:
    """A venue whose month hasn't started yet this year defaults to this year."""
    venue = EVENT_VENUES["jck_las_vegas"]  # typical_month=6

    start, end = default_event_window(venue, today=date(2026, 1, 15))

    assert start == date(2026, 6, 1)
    assert end == date(2026, 6, venue.typical_duration_days)


def test_default_event_window_rolls_to_next_year_after_the_month_passed() -> None:
    """A venue whose month already passed this year defaults to next year."""
    venue = EVENT_VENUES["agta_gemfair_tucson"]  # typical_month=1

    start, _end = default_event_window(venue, today=date(2026, 6, 1))

    assert start.year == 2027
    assert start.month == 1


def test_default_event_window_duration_matches_the_venue() -> None:
    """The window spans exactly typical_duration_days, inclusive."""
    venue = EVENT_VENUES["ja_new_york"]

    start, end = default_event_window(venue, today=date(2026, 1, 1))

    assert (end - start).days == venue.typical_duration_days - 1
