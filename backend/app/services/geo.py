"""Live Meta Geo Search resolution for TargetLocation entries.

PRD.md build step 5, geo-taxonomy resolution, confirmed 2026-09-02.
Unlike interests (app/services/interests.py, a small curated table),
locations aren't a fixed small vocabulary — there's no reasonable way to
pre-curate every US city/region a business might target. So this
resolves live, at publish time, against Meta's real Geo Search endpoint
(app/services/meta.py's search_ad_geolocations).

The "Springfield problem" is real, not theoretical — confirmed against
the live API 2026-09-02: searching "Springfield" alone returns 25+
candidates across a dozen-plus US states (plus Australia and the UK),
with no single obviously-right answer from the name alone.
TargetLocation's structured {city, region} (app/schemas/strategy.py)
exists specifically so a region hint can disambiguate; a city name alone
falls back to Meta's own result ordering with a logged low-confidence
note rather than failing outright.

This MVP is US-only everywhere already (BenchmarkContext.country, the
default geo_locations countries:["US"]) — every resolution here filters
to country_code == "US" as a backend constraint, never something the LLM
picks or a per-business lookup, since there's only one possible value
today.
"""

import logging
from typing import Any

from app.services.meta import (
    MetaConnectionError,
    ResolvedGeoLocation,
    search_ad_geolocations,
)

logger = logging.getLogger(__name__)

_COUNTRY_CODE = "US"


class GeoResolutionError(MetaConnectionError):
    """Raised when a TargetLocation can't be resolved to any real Meta geo key.

    A subclass of MetaConnectionError (not a sibling exception) so
    publish.py's existing "any Graph API resolution step can fail"
    handling (app/api/campaign.py's except MetaConnectionError -> FAILED,
    retryable) covers this without a parallel error-handling path — a
    geo lookup returning no usable match is a real publish failure, same
    as the Graph API call it's built from returning an error.
    """


def _us_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [c for c in candidates if c.get("country_code") == _COUNTRY_CODE]


async def _resolve_city(
    *, access_token: str, city: str, region: str | None
) -> ResolvedGeoLocation:
    candidates = await search_ad_geolocations(
        access_token=access_token, query=city, location_type="city"
    )
    us_candidates = _us_candidates(candidates)
    if not us_candidates:
        raise GeoResolutionError(f"No US city match found for {city!r}")

    if region is not None:
        region_matches = [
            c
            for c in us_candidates
            if str(c.get("region", "")).casefold() == region.casefold()
        ]
        if len(region_matches) == 1:
            match = region_matches[0]
            return ResolvedGeoLocation(key=match["key"], type="city")
        if region_matches:
            match = region_matches[0]
            logger.warning(
                "Ambiguous city %r in region %r: %d candidates share both the "
                "name and region — using %s, low confidence",
                city,
                region,
                len(region_matches),
                match["key"],
            )
            return ResolvedGeoLocation(key=match["key"], type="city")
        logger.warning(
            "City %r not found in region %r among %d US candidates — falling "
            "back to the top US match without region disambiguation, low "
            "confidence",
            city,
            region,
            len(us_candidates),
        )

    if len(us_candidates) > 1:
        logger.warning(
            "Ambiguous city %r: %d US candidates with no region to "
            "disambiguate — using the top match %s, low confidence",
            city,
            len(us_candidates),
            us_candidates[0]["key"],
        )
    match = us_candidates[0]
    return ResolvedGeoLocation(key=match["key"], type="city")


async def _resolve_region(*, access_token: str, region: str) -> ResolvedGeoLocation:
    candidates = await search_ad_geolocations(
        access_token=access_token, query=region, location_type="region"
    )
    us_candidates = _us_candidates(candidates)
    if not us_candidates:
        raise GeoResolutionError(f"No US region match found for {region!r}")
    if len(us_candidates) > 1:
        logger.warning(
            "Ambiguous region %r: %d US candidates — using the top match %s, "
            "low confidence",
            region,
            len(us_candidates),
            us_candidates[0]["key"],
        )
    match = us_candidates[0]
    return ResolvedGeoLocation(key=match["key"], type="region")


async def resolve_target_location(
    *, access_token: str, city: str | None, region: str | None
) -> ResolvedGeoLocation:
    """Resolve one TargetLocation into a real, disambiguated Meta geo key.

    Args:
        access_token: A Meta access token with ads permissions.
        city: The location's city, if any. Takes priority over region
            when both are given — a specific city is a tighter target
            than its whole state, and region is only used to
            disambiguate the city search (the "Springfield problem").
        region: The location's region (state), if any.

    Returns:
        The resolved city or region.

    Raises:
        GeoResolutionError: If neither city nor region is set, or the
            given value has no US match at all.
    """
    if city is not None:
        return await _resolve_city(access_token=access_token, city=city, region=region)
    if region is not None:
        return await _resolve_region(access_token=access_token, region=region)
    raise GeoResolutionError("TargetLocation has neither city nor region set")
