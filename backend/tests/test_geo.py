"""Tests for live Meta Geo Search resolution (PRD.md build step 5,
geo-taxonomy resolution).

app/services/geo.py does `from app.services.meta import ...
search_ad_geolocations` (direct import), so that's what gets mocked here
— same "mock where it's imported, not where it's defined" rule already
established elsewhere in this suite.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import geo
from app.services.meta import MetaConnectionError, ResolvedGeoLocation

_NEW_YORK_CITY = {
    "key": "2490299",
    "name": "New York",
    "type": "city",
    "country_code": "US",
    "region": "New York",
}
_LONDON_UK = {
    "key": "999999",
    "name": "London",
    "type": "city",
    "country_code": "GB",
    "region": "England",
}
_SPRINGFIELD_MA = {
    "key": "2466450",
    "name": "Springfield",
    "type": "city",
    "country_code": "US",
    "region": "Massachusetts",
}
_SPRINGFIELD_IL = {
    "key": "2440704",
    "name": "Springfield",
    "type": "city",
    "country_code": "US",
    "region": "Illinois",
}
_SPRINGFIELD_AU = {
    "key": "2725818",
    "name": "Springfield",
    "type": "city",
    "country_code": "AU",
    "region": "Queensland",
}
_TEXAS_REGION = {
    "key": "3886",
    "name": "Texas",
    "type": "region",
    "country_code": "US",
}
_TEXAS_ONTARIO_LOOKALIKE = {
    "key": "1234",
    "name": "Texas",
    "type": "region",
    "country_code": "CA",
}


def _mock_search(
    monkeypatch: pytest.MonkeyPatch, results: list[dict[str, Any]]
) -> AsyncMock:
    mock = AsyncMock(return_value=results)
    monkeypatch.setattr(geo, "search_ad_geolocations", mock)
    return mock


def test_geo_resolution_error_is_a_meta_connection_error() -> None:
    """A subclass, not a sibling — so publish.py's existing except
    MetaConnectionError handling covers this without new plumbing."""
    assert issubclass(geo.GeoResolutionError, MetaConnectionError)


@pytest.mark.asyncio
async def test_resolve_target_location_raises_without_city_or_region() -> None:
    """A TargetLocation with neither field set carries no targeting
    information — this should never actually happen (the schema-level
    validator on TargetLocation already forbids it), but resolve_target_location
    fails loud rather than silently doing nothing if it somehow does."""
    with pytest.raises(geo.GeoResolutionError, match="neither city nor region"):
        await geo.resolve_target_location(access_token="token", city=None, region=None)


# --- city resolution -----------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_city_single_us_match(monkeypatch: pytest.MonkeyPatch) -> None:
    """One unambiguous US match resolves directly."""
    _mock_search(monkeypatch, [_NEW_YORK_CITY, _LONDON_UK])

    result = await geo.resolve_target_location(
        access_token="token", city="New York", region=None
    )

    assert result == ResolvedGeoLocation(key="2490299", type="city")


@pytest.mark.asyncio
async def test_resolve_city_raises_without_any_us_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No US candidates at all is a real resolution failure."""
    _mock_search(monkeypatch, [_LONDON_UK])

    with pytest.raises(geo.GeoResolutionError, match="No US city match"):
        await geo.resolve_target_location(
            access_token="token", city="London", region=None
        )


@pytest.mark.asyncio
async def test_resolve_city_disambiguates_the_springfield_problem_with_region(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Real ambiguity (multiple same-named US cities) is resolved by a
    region hint, picking exactly the right one."""
    _mock_search(monkeypatch, [_SPRINGFIELD_MA, _SPRINGFIELD_IL, _SPRINGFIELD_AU])

    result = await geo.resolve_target_location(
        access_token="token", city="Springfield", region="Illinois"
    )

    assert result == ResolvedGeoLocation(key="2440704", type="city")


@pytest.mark.asyncio
async def test_resolve_city_falls_back_when_region_doesnt_match_any_candidate(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A region that matches none of the US candidates falls back to the
    top US match rather than raising — low confidence, logged."""
    _mock_search(monkeypatch, [_SPRINGFIELD_MA, _SPRINGFIELD_IL])

    with caplog.at_level("WARNING"):
        result = await geo.resolve_target_location(
            access_token="token", city="Springfield", region="Not A Real State"
        )

    assert result == ResolvedGeoLocation(key="2466450", type="city")
    assert "not found in region" in caplog.text


@pytest.mark.asyncio
async def test_resolve_city_ambiguous_with_no_region_uses_top_match(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Ambiguous city, no region given at all — falls back to Meta's own
    top result, low confidence, logged."""
    _mock_search(monkeypatch, [_SPRINGFIELD_MA, _SPRINGFIELD_IL])

    with caplog.at_level("WARNING"):
        result = await geo.resolve_target_location(
            access_token="token", city="Springfield", region=None
        )

    assert result == ResolvedGeoLocation(key="2466450", type="city")
    assert "no region to" in caplog.text


@pytest.mark.asyncio
async def test_resolve_city_multiple_candidates_share_name_and_region(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Two candidates sharing both the name and region (a genuinely rare
    edge case) still resolves — the top one, low confidence, logged —
    rather than crashing on an ambiguous list."""
    duplicate = {**_SPRINGFIELD_IL, "key": "9999999"}
    _mock_search(monkeypatch, [_SPRINGFIELD_IL, duplicate])

    with caplog.at_level("WARNING"):
        result = await geo.resolve_target_location(
            access_token="token", city="Springfield", region="Illinois"
        )

    assert result == ResolvedGeoLocation(key="2440704", type="city")
    assert "share both the name and region" in caplog.text


@pytest.mark.asyncio
async def test_resolve_city_region_match_is_case_insensitive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Region matching doesn't require exact casing from the LLM's output."""
    _mock_search(monkeypatch, [_SPRINGFIELD_MA, _SPRINGFIELD_IL])

    result = await geo.resolve_target_location(
        access_token="token", city="Springfield", region="illinois"
    )

    assert result == ResolvedGeoLocation(key="2440704", type="city")


# --- region resolution ----------------------------------------------------


@pytest.mark.asyncio
async def test_resolve_region_single_us_match(monkeypatch: pytest.MonkeyPatch) -> None:
    """One unambiguous US region resolves directly."""
    _mock_search(monkeypatch, [_TEXAS_REGION, _TEXAS_ONTARIO_LOOKALIKE])

    result = await geo.resolve_target_location(
        access_token="token", city=None, region="Texas"
    )

    assert result == ResolvedGeoLocation(key="3886", type="region")


@pytest.mark.asyncio
async def test_resolve_region_raises_without_any_us_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No US region candidates at all is a real resolution failure."""
    _mock_search(monkeypatch, [_TEXAS_ONTARIO_LOOKALIKE])

    with pytest.raises(geo.GeoResolutionError, match="No US region match"):
        await geo.resolve_target_location(
            access_token="token", city=None, region="Texas"
        )


@pytest.mark.asyncio
async def test_resolve_region_ambiguous_uses_top_match(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Multiple US regions sharing a name falls back to the top match,
    low confidence, logged — rare in practice but handled the same way
    as the city case."""
    duplicate = {**_TEXAS_REGION, "key": "9999"}
    _mock_search(monkeypatch, [_TEXAS_REGION, duplicate])

    with caplog.at_level("WARNING"):
        result = await geo.resolve_target_location(
            access_token="token", city=None, region="Texas"
        )

    assert result == ResolvedGeoLocation(key="3886", type="region")
    assert "Ambiguous region" in caplog.text


@pytest.mark.asyncio
async def test_resolve_city_takes_priority_over_region_when_both_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A specific city is a tighter target than its whole state — city
    resolution runs, region search is never even called."""
    search = _mock_search(monkeypatch, [_NEW_YORK_CITY])

    result = await geo.resolve_target_location(
        access_token="token", city="New York", region="New York"
    )

    assert result == ResolvedGeoLocation(key="2490299", type="city")
    search.assert_awaited_once_with(
        access_token="token", query="New York", location_type="city"
    )
