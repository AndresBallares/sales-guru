"""Meta Ads integration: OAuth (step 6), publishing (step 8), insights (step 9).

Handles the OAuth dialog URL, the authorization-code exchange, the Graph
API calls needed to let a user pick an ad account + Page, the
Campaign/AdSet/AdCreative/Ad creation calls that put an approved campaign
live on Meta, and pulling performance numbers back for a live one.
Orchestrating the publish calls against our own data model lives in
app/services/publish.py; this module only wraps the raw Graph API.

**Fake mode (Settings.fake_meta_enabled, confirmed 2026-09-09):** every
function below that makes a real outbound Graph API call checks the flag
first and returns a canned response instead when it's on — this is the
single place that decision is made, so every caller (app/api/meta.py's
ad-account/Page/Pixel pickers, app/services/publish.py's publish
orchestration, app/services/geo.py's location resolution — it calls back
into this module's search_ad_geolocations — and the scheduled optimization/
metrics jobs in app/services/optimization_jobs.py) gets fake data
uniformly with no fake-vs-real branching of its own. Functions only ever
reachable via the *real* OAuth flow (exchange_code_for_token,
get_long_lived_token, get_meta_user_id, build_authorization_url) are left
alone — POST .../meta/fake-connect (app/api/meta.py) bypasses that flow
entirely, so fake mode never exercises them.

**Real ad image upload (confirmed 2026-09-09, fix NOT YET RE-VERIFIED
against a real ad account):** upload_meta_ad_image uploads raw image
bytes to .../adimages as a real multipart file part with an explicit
content-type, returning the resulting image_hash, which
create_meta_ad_creative sets as link_data.image_hash instead of
link_data.picture's bare URL. Three earlier real-account attempts each
failed differently (a base64-form-field approach; a multipart part with
no content-type; the upload itself succeeding but a hardcoded response
key raising an uncaught KeyError) — upload_meta_ad_image's own docstring
has the full history; flag if this still fails on retry.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, NamedTuple, NoReturn
from uuid import uuid4

import httpx

from app.core.config import get_settings
from app.schemas.meta import MetaAdAccount, MetaPage, MetaPixel

_GRAPH_VERSION = "v21.0"
_GRAPH_BASE_URL = f"https://graph.facebook.com/{_GRAPH_VERSION}"
_AUTH_DIALOG_URL = f"https://www.facebook.com/{_GRAPH_VERSION}/dialog/oauth"
_SCOPES = "ads_management,ads_read,pages_show_list,business_management"

# Fake-mode-only sentinel — see list_ad_accounts/list_ad_pixels below.
_FAKE_TERMS_NOT_ACCEPTED_AD_ACCOUNT_ID = "act_fake_terms_not_accepted"

# Maps our Campaign.objective (PRD.md §7) to Meta's Outcome-Driven Ad
# Experience objective enum.
CAMPAIGN_OBJECTIVE_MAP = {
    "SALES": "OUTCOME_SALES",
    "LEADS": "OUTCOME_LEADS",
    "TRAFFIC": "OUTCOME_TRAFFIC",
    "MESSAGES": "OUTCOME_ENGAGEMENT",
    "AWARENESS": "OUTCOME_AWARENESS",
}


class MetaConnectionError(RuntimeError):
    """Raised when the Meta Ads connection can't be built or used.

    code/error_subcode carry Meta's own error.code/error.error_subcode
    when the failure came from a real (or faked) Graph API error response
    — both None for a non-Graph failure (a network error, or a
    configuration problem like _require_app_credentials). Callers that
    need to distinguish specific Graph errors (see
    is_business_tools_terms_error below) should check these structured
    fields, not parse the formatted message string.
    """

    def __init__(
        self,
        message: str,
        *,
        code: int | None = None,
        error_subcode: int | None = None,
    ) -> None:
        """Store Meta's error.code/error.error_subcode alongside the message."""
        super().__init__(message)
        self.code = code
        self.error_subcode = error_subcode


class CustomLocation(NamedTuple):
    """A radius-based geo target (PRD.md build step 11) for a Meta AdSet.

    Maps directly to Meta's targeting.geo_locations.custom_locations
    entry shape. Replaces the default {"countries": ["US"]} targeting
    entirely when given to create_meta_ad_set — Meta targets by either a
    country list or custom (lat/lng + radius) locations, not both mixed
    within one geo_locations object.
    """

    lat: float
    lng: float
    radius_miles: float


class ResolvedGeoLocation(NamedTuple):
    """One resolved city or region geo target for a Meta AdSet.

    Maps to one entry in targeting.geo_locations.cities or .regions
    (app/services/geo.py resolves a TargetLocation into this real,
    disambiguated Meta geo key — this module has no opinion on how it
    was resolved, same "meta.py wraps the raw API, doesn't decide
    business meaning" split as CustomLocation).
    """

    key: str
    type: Literal["city", "region"]


def _require_app_credentials() -> tuple[str, str, str]:
    """Fetch the configured Meta app id/secret/redirect URI, or raise clearly.

    Returns:
        (app_id, app_secret, redirect_uri).

    Raises:
        MetaConnectionError: If any of the three isn't configured.
    """
    settings = get_settings()
    if not (
        settings.meta_app_id and settings.meta_app_secret and settings.meta_redirect_uri
    ):
        raise MetaConnectionError(
            "META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI must all be configured"
        )
    return settings.meta_app_id, settings.meta_app_secret, settings.meta_redirect_uri


def _raise_for_meta_error(
    url: str, body: dict[str, Any], response: httpx.Response
) -> NoReturn:
    """Raise a MetaConnectionError with as much of Meta's own diagnosis as it gave us.

    Meta's top-level error.message is often a generic phrase like "Invalid
    parameter" shared by dozens of distinct problems — error.error_user_msg
    (when present) is the specific, human-actionable one, and
    error.error_subcode/error.fbtrace_id are what Meta support actually
    needs to look up a request. None of that was surfaced before
    (confirmed 2026-09-09, needed for real ad-account debugging) — every
    failure just said "Meta API call failed: <generic message>" with no
    way to tell even which endpoint was being called.

    Args:
        url: The endpoint that was called — only its path (not query
            params/data, which may carry the access token) is included in
            the raised message.
        body: The parsed JSON response body.
        response: The raw httpx response, for a non-JSON-error fallback.

    Raises:
        MetaConnectionError: Always — this is only called once the caller
            has already confirmed the response is an error.
    """
    endpoint = httpx.URL(url).path
    error = body.get("error", {})
    parts = [error.get("message", response.text)]
    if error.get("error_user_msg"):
        parts.append(f"user_msg={error['error_user_msg']!r}")
    if error.get("error_subcode"):
        parts.append(f"subcode={error['error_subcode']}")
    if error.get("fbtrace_id"):
        parts.append(f"fbtrace_id={error['fbtrace_id']}")
    raise MetaConnectionError(
        f"Meta API call to {endpoint} failed: {' | '.join(parts)}",
        code=error.get("code"),
        error_subcode=error.get("error_subcode"),
    )


# Business Tools Terms detection (PRD.md §6's Pixel step, and the future
# customer-list custom-audience feature — both require the ad account's
# *owner* to have accepted Meta's Business Tools Terms on Meta's own
# side before the Marketing API will create or read those objects; this
# is a per-ad-account agreement between the business and Meta, not
# something our app can accept on their behalf).
#
# Confidence differs by variant, deliberately checked both ways below:
# - error.code 2655 ("Terms of service has not been accepted") is a
#   documented, independently-confirmed code for the Custom Audience
#   Terms case (github.com/facebook/facebook-php-business-sdk#43).
# - The Pixel-specific wording ("Business has not accepted Pixel Terms
#   of Service", reported on Meta's own developer community forum) has
#   no independently-confirmed numeric code as of this writing — matched
#   on message text instead. If Meta's real API is ever observed
#   returning a different code for this specific message, add it above
#   as a second confirmed case rather than relying on text alone.
_CUSTOM_AUDIENCE_TERMS_CODE = 2655
_BUSINESS_TOOLS_TERMS_TEXT_MARKERS = ("has not accepted", "terms of service")


def is_business_tools_terms_error(exc: MetaConnectionError) -> bool:
    """Whether this error means the ad account hasn't accepted the terms.

    Meta's Business Tools Terms (or the narrower Custom Audience/Pixel
    Terms) are a precondition on Meta's own side, not something retrying
    the same call fixes. Callers should surface this distinctly (a
    friendly message plus a link to accept the terms) rather than the
    generic failure path. See the module-level comment above this
    function for exactly which signals are checked and how confident
    each one is.

    Args:
        exc: The error to check.

    Returns:
        True if this looks like a Business Tools Terms precondition
        failure.
    """
    if exc.code == _CUSTOM_AUDIENCE_TERMS_CODE:
        return True
    message = str(exc).lower()
    return all(marker in message for marker in _BUSINESS_TOOLS_TERMS_TEXT_MARKERS)


async def _get_json(url: str, params: dict[str, str]) -> dict[str, Any]:
    """GET a Graph API URL and return its parsed JSON body.

    Args:
        url: The full Graph API endpoint URL.
        params: Query parameters (including any access token).

    Returns:
        The parsed JSON response body.

    Raises:
        MetaConnectionError: On a network failure, a non-2xx response, or
            a response body containing Meta's own {"error": ...} shape.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, params=params)
    except httpx.HTTPError as exc:
        raise MetaConnectionError(f"Meta API call failed: {exc}") from exc

    body: dict[str, Any] = response.json()
    if response.is_error or "error" in body:
        _raise_for_meta_error(url, body, response)
    return body


async def _post_json(url: str, data: dict[str, str]) -> dict[str, Any]:
    """POST form-encoded data to a Graph API URL and return its parsed JSON body.

    Args:
        url: The full Graph API endpoint URL.
        data: Form fields (including the access token) — Meta's object
            -creation endpoints take form-encoded POST bodies, not JSON.

    Returns:
        The parsed JSON response body.

    Raises:
        MetaConnectionError: On a network failure, a non-2xx response, or
            a response body containing Meta's own {"error": ...} shape.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, data=data)
    except httpx.HTTPError as exc:
        raise MetaConnectionError(f"Meta API call failed: {exc}") from exc

    body: dict[str, Any] = response.json()
    if response.is_error or "error" in body:
        _raise_for_meta_error(url, body, response)
    return body


def build_authorization_url(state: str) -> str:
    """Build the URL that starts the Meta OAuth consent dialog.

    Args:
        state: An opaque, unguessable, one-time-use CSRF token (a
            MetaOAuthState row's id) — verified again at the callback.

    Returns:
        The full authorization dialog URL to send the browser to.

    Raises:
        MetaConnectionError: If the Meta app isn't configured.
    """
    app_id, _app_secret, redirect_uri = _require_app_credentials()
    params = {
        "client_id": app_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "scope": _SCOPES,
        "response_type": "code",
    }
    query = "&".join(f"{key}={value}" for key, value in params.items())
    return f"{_AUTH_DIALOG_URL}?{query}"


async def exchange_code_for_token(code: str) -> str:
    """Exchange an OAuth authorization code for a short-lived access token.

    Args:
        code: The `code` query param Meta sent back to the callback.

    Returns:
        The short-lived user access token.

    Raises:
        MetaConnectionError: If the Meta app isn't configured or the
            exchange fails.
    """
    app_id, app_secret, redirect_uri = _require_app_credentials()
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/oauth/access_token",
        {
            "client_id": app_id,
            "client_secret": app_secret,
            "redirect_uri": redirect_uri,
            "code": code,
        },
    )
    token: str = body["access_token"]
    return token


async def get_long_lived_token(short_lived_token: str) -> tuple[str, datetime]:
    """Exchange a short-lived token for a long-lived one (~60 days).

    Args:
        short_lived_token: The token from exchange_code_for_token.

    Returns:
        (long_lived_token, expires_at).

    Raises:
        MetaConnectionError: If the Meta app isn't configured or the
            exchange fails.
    """
    app_id, app_secret, _redirect_uri = _require_app_credentials()
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/oauth/access_token",
        {
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": short_lived_token,
        },
    )
    token: str = body["access_token"]
    expires_at = datetime.now(UTC) + timedelta(seconds=int(body["expires_in"]))
    return token, expires_at


async def get_meta_user_id(access_token: str) -> str:
    """Fetch the id of the Meta user who authorized the connection.

    Args:
        access_token: A valid Meta access token.

    Returns:
        The Meta user id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _get_json(f"{_GRAPH_BASE_URL}/me", {"access_token": access_token})
    user_id: str = body["id"]
    return user_id


async def list_ad_accounts(access_token: str) -> list[MetaAdAccount]:
    """List the ad accounts available to the connected Meta user.

    Args:
        access_token: A valid Meta access token.

    Returns:
        The user's ad accounts.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return [
            MetaAdAccount(id="act_fake_account", name="Fake Ad Account"),
            # Selectable in fake mode so the Business Tools Terms error
            # path (see is_business_tools_terms_error, list_ad_pixels
            # below) is e2e-testable without a real ad account that's
            # actually in that state — id checked by list_ad_pixels.
            MetaAdAccount(
                id=_FAKE_TERMS_NOT_ACCEPTED_AD_ACCOUNT_ID,
                name="Fake Ad Account (Terms Not Accepted)",
            ),
        ]
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/me/adaccounts",
        {"fields": "id,name", "access_token": access_token},
    )
    return [MetaAdAccount.model_validate(item) for item in body.get("data", [])]


async def list_pages(access_token: str) -> list[MetaPage]:
    """List the Pages available to the connected Meta user.

    Args:
        access_token: A valid Meta access token.

    Returns:
        The user's Pages.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return [MetaPage(id="fake_page", name="Fake Page")]
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/me/accounts",
        {"fields": "id,name", "access_token": access_token},
    )
    return [MetaPage.model_validate(item) for item in body.get("data", [])]


async def list_ad_pixels(access_token: str, ad_account_id: str) -> list[MetaPixel]:
    """List the Meta Pixels available on a given ad account.

    Unlike list_ad_accounts/list_pages, Pixels aren't listed via /me/... —
    they belong to an ad account, not directly to the user, so this needs
    one already chosen (real API behavior confirmed 2026-08-29).

    Args:
        access_token: A valid Meta access token.
        ad_account_id: The connected ad account, already carrying Meta's
            own "act_" prefix (see create_meta_campaign's docstring).

    Returns:
        The ad account's Pixels.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        if ad_account_id == _FAKE_TERMS_NOT_ACCEPTED_AD_ACCOUNT_ID:
            raise MetaConnectionError(
                "Meta API call to /adspixels failed: "
                "Business has not accepted Pixel Terms of Service"
            )
        return [MetaPixel(id="fake_pixel", name="Fake Pixel")]
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/adspixels",
        {"fields": "id,name", "access_token": access_token},
    )
    return [MetaPixel.model_validate(item) for item in body.get("data", [])]


async def create_meta_campaign(
    *,
    access_token: str,
    ad_account_id: str,
    name: str,
    objective: str,
    status: Literal["ACTIVE", "PAUSED"] = "ACTIVE",
) -> str:
    """Create a Campaign object on Meta (PRD.md build step 8).

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account to create the campaign in,
            already carrying Meta's own "act_" prefix (that's the literal
            `id` field /me/adaccounts returns — see list_ad_accounts —
            and what gets stored on MetaConnection.adAccountId; not
            re-added here, or it'd double up to "act_act_...").
        name: The campaign's display name on Meta.
        objective: Our Campaign.objective value — mapped to Meta's own
            objective enum via CAMPAIGN_OBJECTIVE_MAP.
        status: "ACTIVE" (default) or "PAUSED" — the "Publish paused"
            option (app/services/publish.py's publish_campaign_to_meta)
            sends "PAUSED" here and to create_meta_ad_set/create_meta_ad
            so nothing spends until a human clicks Activate, in this app
            or directly in Ads Manager.

    Returns:
        The new Meta campaign id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_campaign_{uuid4().hex[:12]}"
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/campaigns",
        {
            "access_token": access_token,
            "name": name,
            "objective": CAMPAIGN_OBJECTIVE_MAP[objective],
            "status": status,
            "special_ad_categories": "[]",
            # Meta requires this explicitly once a campaign doesn't use a
            # campaign-level budget (real API behavior confirmed
            # 2026-08-29, not caught by any mocked test before — error
            # was "Must specify True or False in is_adset_budget_sharing_
            # enabled field"). False because budget lives on the AdSet
            # (create_meta_ad_set's daily_budget), not shared/optimized
            # across ad sets at the campaign level.
            "is_adset_budget_sharing_enabled": "false",
        },
    )
    campaign_id: str = body["id"]
    return campaign_id


async def create_meta_ad_set(
    *,
    access_token: str,
    ad_account_id: str,
    name: str,
    meta_campaign_id: str,
    daily_budget_cents: int,
    optimization_goal: str,
    age_min: int,
    age_max: int,
    pixel_id: str | None = None,
    custom_location: CustomLocation | None = None,
    resolved_locations: list[ResolvedGeoLocation] | None = None,
    interests: list[dict[str, str]] | None = None,
    advantage_audience: int = 0,
    end_time: datetime | None = None,
    target_cac_cents: int | None = None,
    status: Literal["ACTIVE", "PAUSED"] = "ACTIVE",
) -> str:
    """Create an AdSet object on Meta, under an already-created campaign.

    Targeting is age range plus geo (either the default single-country
    geo or, when custom_location is given — PRD.md build step 11 — a
    radius around one curated event venue instead) plus, optionally,
    interests. interests is a list of already-resolved {"id", "name"}
    Meta interest objects (app/services/interests.py's curated table,
    resolved by the caller — this function has no opinion on where they
    came from, same as custom_location). advantage_audience defaults to
    0 (explicit targeting only, no Meta-driven expansion) but PRD.md
    "Phase C" (real two-variant TEST_PLAN publishing) passes 1 for the
    broad/automated baseline variant — real API behavior confirmed
    2026-08-29 (not caught by any mocked test before): Meta now requires
    this flag whenever explicit targeting is given at all, so it's always
    sent explicitly rather than left unset.

    bid_strategy is COST_CAP when target_cac_cents is given — Meta bids
    to stay near that per-result cost rather than chasing the lowest
    cost regardless of price (requested and confirmed 2026-09-03, a
    guardrail complementing the deterministic rolling-CAC circuit
    breaker in app/services/optimization_jobs.py, since Meta itself
    doesn't guarantee adherence to a cost cap). Falls back to
    LOWEST_COST_WITHOUT_CAP (automatic bidding, no manual cap, this
    app's original default) when no target is given at all — the caller
    (app/services/publish.py) always resolves one in practice (the
    campaign's own product economics, or the jewelry CAC benchmark
    median as a fallback), so this only matters for a caller that
    deliberately opts out.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        name: The ad set's display name on Meta.
        meta_campaign_id: The parent Meta campaign id.
        daily_budget_cents: Daily budget in the ad account's minor
            currency unit (cents for USD).
        optimization_goal: A Meta optimization_goal value.
        age_min: Minimum target age.
        age_max: Maximum target age.
        pixel_id: The MetaConnection's configured Pixel, if any. Required
            by Meta (as a promoted_object) for conversion-tracking
            optimization_goal values — currently just OFFSITE_CONVERSIONS
            — confirmed by the caller (app/api/campaign.py) before this
            is ever invoked, not re-checked here. custom_event_type is
            fixed to PURCHASE (matches the SALES objective this pairs
            with; not user-configurable yet).
        custom_location: A radius-based geo target, if this campaign is
            targeting a curated event venue (app/services/event_venues.py)
            instead of the default broad-US geo. When given, entirely
            replaces geo_locations.countries with
            geo_locations.custom_locations — Meta doesn't mix the two
            within one targeting spec. Distance unit/radius bounds are
            sent as-is (miles) — not yet verified against the real Graph
            API, same "real end-to-end testing catches what mocks can't"
            caution as the rest of this function's real-API fixes below.
        resolved_locations: Already-resolved city/region geo targets
            (app/services/geo.py), if the audience specified any real
            locations. Ignored when custom_location is given (an event
            venue's radius is the geo target, full stop — see
            app/services/publish.py's _resolve_custom_location); when
            given without custom_location, entirely replaces
            geo_locations.countries the same way custom_location does.
            geo_locations.cities/.regions shape is sent as {"key": ...}
            per entry — not yet verified against a real live publish
            (same caution as custom_location above).
        interests: Already-resolved Meta interest objects to add as
            explicit detailed targeting, if any (empty/None means no
            interest targeting — the broad-baseline case).
        advantage_audience: 0 (default) for explicit-only targeting, 1 to
            let Meta expand delivery beyond what's specified here.
        end_time: When to have Meta itself stop delivery, if the campaign
            has a planned end (a TEST_PLAN's duration_days, or an event
            venue's window — app/services/publish.py's
            publish_campaign_to_meta computes this once and passes it to
            every AdSet it creates). None leaves the ad set running
            indefinitely on its daily budget, same as before this
            parameter existed. Sent as ISO 8601 UTC
            ("2026-03-24T23:59:59+0000", Meta's documented format) — not
            yet verified against a real live publish, same "confirm
            against the real API before trusting it" caution as the
            geo/interest params above. Independent of the scheduled
            duration-elapsed auto-pause job — that's a same-effect
            backstop for a campaign published before this parameter
            existed, or in case Meta doesn't actually honor end_time as
            documented.
        target_cac_cents: The per-result cost to bid toward (COST_CAP's
            `bid_amount`), in the ad account's minor currency unit —
            same cents convention as daily_budget_cents. None uses
            LOWEST_COST_WITHOUT_CAP instead (no cap at all). Not yet
            verified against a real live publish, same caution as
            end_time above.
        status: "ACTIVE" (default) or "PAUSED" — see create_meta_campaign's
            own status param, sent identically alongside it by the
            "Publish paused" option.

    Returns:
        The new Meta ad set id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_adset_{uuid4().hex[:12]}"
    if custom_location is not None:
        geo_locations: dict[str, object] = {
            "custom_locations": [
                {
                    "latitude": custom_location.lat,
                    "longitude": custom_location.lng,
                    "radius": custom_location.radius_miles,
                    "distance_unit": "mile",
                }
            ]
        }
    elif resolved_locations:
        geo_locations = {}
        cities = [loc.key for loc in resolved_locations if loc.type == "city"]
        regions = [loc.key for loc in resolved_locations if loc.type == "region"]
        if cities:
            geo_locations["cities"] = [{"key": key} for key in cities]
        if regions:
            geo_locations["regions"] = [{"key": key} for key in regions]
    else:
        geo_locations = {"countries": ["US"]}
    targeting_spec: dict[str, object] = {
        "age_min": age_min,
        "age_max": age_max,
        "geo_locations": geo_locations,
        "targeting_automation": {"advantage_audience": advantage_audience},
    }
    if interests:
        targeting_spec["interests"] = interests
    targeting = json.dumps(targeting_spec)
    data = {
        "access_token": access_token,
        "name": name,
        "campaign_id": meta_campaign_id,
        "daily_budget": str(daily_budget_cents),
        "billing_event": "IMPRESSIONS",
        "optimization_goal": optimization_goal,
        "bid_strategy": "COST_CAP"
        if target_cac_cents is not None
        else "LOWEST_COST_WITHOUT_CAP",
        "targeting": targeting,
        "status": status,
    }
    if target_cac_cents is not None:
        data["bid_amount"] = str(target_cac_cents)
    if pixel_id is not None:
        data["promoted_object"] = json.dumps(
            {"pixel_id": pixel_id, "custom_event_type": "PURCHASE"}
        )
    if end_time is not None:
        data["end_time"] = end_time.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S+0000")
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/adsets",
        data,
    )
    ad_set_id: str = body["id"]
    return ad_set_id


async def upload_meta_ad_image(
    *, access_token: str, ad_account_id: str, image_data: bytes, content_type: str
) -> str:
    """Upload raw image bytes to Meta, returning the image_hash to reference it.

    The returned hash is what create_meta_ad_creative sets as
    link_data.image_hash — Meta's documented way to attach an ad image
    you host yourself, rather than a bare, publicly-fetchable picture URL
    (which link_data.picture used before this and Meta has to fetch
    itself, an extra failure point this avoids).

    **Three real-API surprises found and fixed against a live ad account,
    2026-09-09 — history kept here since none were obvious:**
    1. The base64-bytes-in-a-form-field approach (Meta's documented
       alternative to a real file upload — `bytes={"key": "<base64>"}`
       sent as a plain application/x-www-form-urlencoded field) failed
       outright (error_subcode 2446496, "We could not process the image
       you have uploaded") — didn't survive the round trip intact for a
       real photo. Every official example of this call actually uses
       `-F` (multipart/form-data) in curl, i.e. a real file part, not
       that alternative.
    2. Switching to a multipart file part fixed *that* failure, but
       without an explicit filename/content-type on the part, Meta
       couldn't identify it as an image at all (error_subcode 1487411,
       "The type of file is not supported") — httpx has no extension to
       guess a MIME type from a bare field name like `"image"`, so it
       silently fell back to `application/octet-stream`. Passing the
       already-known content_type explicitly (both as the filename's
       extension and the part's real content-type) fixed this.
    3. With that fixed, the upload itself started succeeding for real —
       but Meta keys the response's `images` object by the *filename*
       actually used, not by the multipart field name, so a hardcoded
       `body["images"]["image"]` lookup raised an uncaught KeyError the
       instant the filename stopped being literally `"image"` (step 2's
       fix). Reading the response's one value directly (exactly one file
       is ever uploaded per call) instead of a specific key fixed this
       without needing to know or guess Meta's exact echoed key at all.
    Uses httpx directly, not _post_json/_get_json, since neither of those
    helpers sends multipart bodies.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account to upload into.
        image_data: The raw image bytes (already validated on upload —
            app/schemas/product_image.py's JPG/PNG/size/dimension checks
            — so no further validation happens here).
        content_type: The image's real MIME type (ProductImage.contentType
            — "image/jpeg" or "image/png") — Meta needs this to actually
            recognize the upload as an image (see history above), not
            just to know what to store it as.

    Returns:
        The new image's hash.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_image_hash_{uuid4().hex[:12]}"
    url = f"{_GRAPH_BASE_URL}/{ad_account_id}/adimages"
    # The multipart field name ("image") is arbitrary and has no bearing
    # on the response; the filename's base ("image.<ext>") does, though —
    # confirmed 2026-09-09 against a real ad account: Meta keys the
    # response's images dict by the *filename* actually used, not the
    # form field name (a third real-API surprise, after the two in the
    # docstring above) — a hardcoded body["images"]["image"] lookup
    # raised KeyError once the filename stopped being literally "image".
    # Since exactly one file is ever uploaded per call, reading the
    # response's one value rather than a specific key sidesteps needing
    # to know or guess Meta's exact echoed key at all.
    extension = content_type.rsplit("/", maxsplit=1)[-1]
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                data={"access_token": access_token},
                files={"image": (f"image.{extension}", image_data, content_type)},
            )
    except httpx.HTTPError as exc:
        raise MetaConnectionError(f"Meta API call failed: {exc}") from exc

    body: dict[str, Any] = response.json()
    if response.is_error or "error" in body:
        _raise_for_meta_error(url, body, response)
    images = body.get("images", {})
    if not images:
        raise MetaConnectionError(
            f"Meta API call to {httpx.URL(url).path} succeeded but returned "
            f"no image: {body}"
        )
    image_hash: str = next(iter(images.values()))["hash"]
    return image_hash


async def create_meta_ad_creative(
    *,
    access_token: str,
    ad_account_id: str,
    page_id: str,
    name: str,
    headline: str,
    body_text: str,
    description: str | None,
    cta: str,
    link: str,
    image_hash: str | None,
) -> str:
    """Create an ad creative object on Meta, ready to attach to an Ad.

    image_hash is optional — a campaign with no product, or whose
    product has no photo, still has nothing to upload. Meta still accepts
    a link-only creative; a real running ad will typically need a real
    image to pass Meta's own ad review, which this doesn't handle.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        page_id: The connected Page the ad is posted as.
        name: The creative's display name on Meta.
        headline: The ad headline.
        body_text: The primary text (Meta's link_data.message).
        description: The secondary description line. Omitted from the
            request entirely when None (Part 4, confirmed 2026-09-12 — not
            every business has a proof point/trust line that fits every
            variant) — Meta falls back to auto-generating one from the
            link, same as when nothing is given at all.
        cta: A Meta call_to_action type value.
        link: The destination URL.
        image_hash: An already-uploaded image's hash (see
            upload_meta_ad_image), if one exists.

    Returns:
        The new Meta ad creative id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_creative_{uuid4().hex[:12]}"
    link_data: dict[str, Any] = {
        "message": body_text,
        "name": headline,
        "link": link,
        "call_to_action": {"type": cta},
    }
    if description:
        link_data["description"] = description
    if image_hash:
        link_data["image_hash"] = image_hash

    object_story_spec = json.dumps({"page_id": page_id, "link_data": link_data})
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/adcreatives",
        {
            "access_token": access_token,
            "name": name,
            "object_story_spec": object_story_spec,
        },
    )
    creative_id: str = body["id"]
    return creative_id


class CarouselCard(NamedTuple):
    """One card's already-resolved data, ready for a child_attachments entry.

    image_hash is required (unlike create_meta_ad_creative's optional
    image_hash) — a CreativeCard always has an image (app/schemas/
    creative.py's CreativeCard.imageUrl is non-nullable), so there's no
    image-less-card case to handle the way a whole image-less
    SINGLE_IMAGE creative is handled above.
    """

    image_hash: str
    headline: str
    description: str | None
    link: str


async def create_meta_carousel_ad_creative(
    *,
    access_token: str,
    ad_account_id: str,
    page_id: str,
    name: str,
    body_text: str,
    cta: str,
    link: str,
    cards: list[CarouselCard],
) -> str:
    """Create a CAROUSEL ad creative object on Meta (link_data.child_attachments).

    The single-image path (create_meta_ad_creative above) is untouched by
    this — a distinct function rather than branching inside that one,
    since the two shapes barely overlap (one image_hash vs. a list of
    per-card image_hash/name/description/link) and every existing
    SINGLE_IMAGE caller should see zero behavior change from this
    existing either way.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        page_id: The connected Page the ad is posted as.
        name: The creative's display name on Meta.
        body_text: The shared primary text (Meta's link_data.message) —
            unlike a card's headline/description, this is one value for
            the whole carousel, not per-card.
        cta: A Meta call_to_action type value, shared across every card
            (V1 has no per-card CTA — see GeneratedCreativeVariant's
            schema comment).
        link: The overall post's destination link — Meta requires
            link_data.link even alongside child_attachments. V1 is
            single-product, so this is the same URL every card's own
            link also points to (app/api/creative.py's create_creatives
            resolves one destination_url and stores it on every
            CreativeCard.linkUrl).
        cards: Every card's already-uploaded image_hash plus its own
            headline/description/link, in display order — Meta renders
            child_attachments in list order, matching CreativeCard.position.

    Returns:
        The new Meta ad creative id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_carousel_creative_{uuid4().hex[:12]}"
    link_data: dict[str, Any] = {
        "message": body_text,
        "link": link,
        "call_to_action": {"type": cta},
        "child_attachments": [
            {
                "link": card.link,
                "image_hash": card.image_hash,
                "name": card.headline,
                **({"description": card.description} if card.description else {}),
            }
            for card in cards
        ],
    }
    object_story_spec = json.dumps({"page_id": page_id, "link_data": link_data})
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/adcreatives",
        {
            "access_token": access_token,
            "name": name,
            "object_story_spec": object_story_spec,
        },
    )
    creative_id: str = body["id"]
    return creative_id


async def create_meta_ad(
    *,
    access_token: str,
    ad_account_id: str,
    name: str,
    meta_ad_set_id: str,
    meta_creative_id: str,
    status: Literal["ACTIVE", "PAUSED"] = "ACTIVE",
) -> str:
    """Create an Ad object on Meta, attaching an ad set + creative.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        name: The ad's display name on Meta.
        meta_ad_set_id: The parent Meta ad set id.
        meta_creative_id: The Meta ad creative id to attach.
        status: "ACTIVE" (default) or "PAUSED" — see create_meta_campaign's
            own status param, sent identically alongside it by the
            "Publish paused" option.

    Returns:
        The new Meta ad id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return f"fake_ad_{uuid4().hex[:12]}"
    creative_ref = json.dumps({"creative_id": meta_creative_id})
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/ads",
        {
            "access_token": access_token,
            "name": name,
            "adset_id": meta_ad_set_id,
            "creative": creative_ref,
            "status": status,
        },
    )
    ad_id: str = body["id"]
    return ad_id


class CampaignInsights(NamedTuple):
    """Lifetime performance numbers for a Meta campaign.

    impressions/clicks/spend/conversions are the original step-9 fields.
    Everything from reach onward is the "Phase B" extended set (PRD.md §5
    step 10, confirmed 2026-09-01), added for the TEST_PLAN Optimizer's
    success-criteria evaluation — all default None ("unavailable/not
    applicable," never zero, same NormalizedMetrics convention as
    app/schemas/strategy.py) so existing callers that only care about the
    original four fields are unaffected.
    """

    impressions: int
    clicks: int
    spend: float
    conversions: int
    reach: int | None = None
    cpm: float | None = None
    ctr: float | None = None
    cpc: float | None = None
    landing_page_views: int | None = None
    add_to_cart: int | None = None
    add_to_cart_rate: float | None = None
    conversion_rate: float | None = None
    cac: float | None = None
    purchase_value: float | None = None
    roas: float | None = None
    # Purchase-specific count (_PURCHASE_ACTION_TYPES below), distinct
    # from the broader `conversions` sum — stored so a rolling-window CAC
    # (spend delta / purchases delta between two snapshots) can be
    # computed later; `cac` above is only ever a lifetime-to-date ratio,
    # not something deltas can be taken of directly (app/services/
    # optimization_jobs.py's CAC circuit breaker).
    purchases: int | None = None


# Meta's own action_type values for the funnel steps the extended metric
# set tracks. Not exhaustive across every pixel/CAPI setup a business
# might have configured — a reasonable first pass (PRD.md §5 step 10),
# flagged for revisiting against real end-to-end testing the same way
# publish's own Meta-integration gaps were (PRD.md §5 step 8's "real bugs
# real testing catches" note).
_LANDING_PAGE_VIEW_ACTION_TYPES = frozenset({"landing_page_view"})
_ADD_TO_CART_ACTION_TYPES = frozenset({"add_to_cart", "omni_add_to_cart"})
_PURCHASE_ACTION_TYPES = frozenset(
    {"purchase", "omni_purchase", "offsite_conversion.fb_pixel_purchase"}
)


def _sum_actions(actions: list[dict[str, str]], action_types: frozenset[str]) -> int:
    """Sum the "value" of every action row whose action_type is in the given set."""
    return sum(
        int(action["value"])
        for action in actions
        if action.get("action_type") in action_types
    )


def _sum_action_values(
    action_values: list[dict[str, str]], action_types: frozenset[str]
) -> float:
    """Sum the "value" of every action_values row whose action_type matches."""
    return sum(
        float(action["value"])
        for action in action_values
        if action.get("action_type") in action_types
    )


async def _fetch_insights(
    *, access_token: str, meta_object_id: str
) -> CampaignInsights:
    """Fetch lifetime performance numbers for any Meta object with an /insights edge.

    Works for a Campaign or an AdSet — the endpoint shape and fields are
    identical either way, Meta's Insights API is symmetric across object
    levels.

    Args:
        access_token: The business's Meta access token.
        meta_object_id: The Meta campaign or ad set id.

    Returns:
        The original four fields are all zero if Meta has no delivery
        data yet (e.g. a campaign published moments ago) — not an error;
        every extended field is None in that case instead (no delivery
        data means every derived metric is genuinely unavailable, not
        zero — same distinction NormalizedMetrics makes).

        conversions is the sum of every entry in Meta's own "actions"
        breakdown (link clicks, purchases, leads, etc. all mixed
        together), not a single specific conversion type — resolving
        that properly means mapping each Campaign.objective to the one
        or two action_types that actually count as "the" conversion for
        it, which isn't done yet (known simplification, PRD.md §5 step 9).
        cac/roas below are narrower and use only the purchase-specific
        action types (_PURCHASE_ACTION_TYPES), not this broader
        conversions figure, since a customer-acquisition-cost or
        return-on-ad-spend number mixed with leads/link-clicks would be
        misleading.

        addToCartRate is add_to_cart / landing_page_views (not / clicks)
        — None when there were no landing page views to divide by.

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/{meta_object_id}/insights",
        {
            "fields": (
                "impressions,reach,spend,clicks,cpm,ctr,cpc,actions,action_values"
            ),
            "access_token": access_token,
        },
    )
    rows = body.get("data", [])
    if not rows:
        return CampaignInsights(impressions=0, clicks=0, spend=0.0, conversions=0)

    row = rows[0]
    actions = row.get("actions", [])
    action_values = row.get("action_values", [])
    spend = float(row.get("spend", 0.0))
    clicks = int(row.get("clicks", 0))
    conversions = sum(int(action["value"]) for action in actions)

    landing_page_views = _sum_actions(actions, _LANDING_PAGE_VIEW_ACTION_TYPES)
    add_to_cart = _sum_actions(actions, _ADD_TO_CART_ACTION_TYPES)
    purchases = _sum_actions(actions, _PURCHASE_ACTION_TYPES)
    purchase_value = _sum_action_values(action_values, _PURCHASE_ACTION_TYPES)

    return CampaignInsights(
        impressions=int(row.get("impressions", 0)),
        clicks=clicks,
        spend=spend,
        conversions=conversions,
        reach=int(row["reach"]) if "reach" in row else None,
        cpm=float(row["cpm"]) if "cpm" in row else None,
        ctr=float(row["ctr"]) if "ctr" in row else None,
        cpc=float(row["cpc"]) if "cpc" in row else None,
        landing_page_views=landing_page_views if actions else None,
        add_to_cart=add_to_cart if actions else None,
        add_to_cart_rate=(
            (add_to_cart / landing_page_views) if landing_page_views else None
        ),
        conversion_rate=(conversions / clicks) if clicks else None,
        cac=(spend / purchases) if purchases else None,
        purchase_value=purchase_value if action_values else None,
        roas=(purchase_value / spend) if spend and action_values else None,
        purchases=purchases if actions else None,
    )


async def fetch_campaign_insights(
    *, access_token: str, meta_campaign_id: str
) -> CampaignInsights:
    """Fetch lifetime performance numbers for a live Meta campaign.

    See _fetch_insights for the full field-shape documentation.

    Args:
        access_token: The business's Meta access token.
        meta_campaign_id: The Meta campaign id (Campaign.metaCampaignId).

    Returns:
        The campaign's lifetime-to-date insights — canned all-zero/all-
        None (the same shape as a campaign with no delivery data yet, see
        _fetch_insights) when fake_meta_enabled is on, so downstream
        consumers (app/api/metric.py's manual refresh, app/services/
        optimization_jobs.py's scheduled jobs) can be e2e-tested against
        a fake campaign without a real Insights call.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return CampaignInsights(impressions=0, clicks=0, spend=0.0, conversions=0)
    return await _fetch_insights(
        access_token=access_token, meta_object_id=meta_campaign_id
    )


async def fetch_ad_set_insights(
    *, access_token: str, meta_ad_set_id: str
) -> CampaignInsights:
    """Fetch lifetime performance numbers for one live Meta AdSet.

    Used for per-AdSet metric collection on a TEST_PLAN campaign's two
    real audience variants (PRD.md build step 10, confirmed 2026-09-02)
    — same shape and reasoning as fetch_campaign_insights, just scoped to
    one AdSet instead of the whole campaign, so each variant's own real
    performance can be compared against the other's.

    Args:
        access_token: The business's Meta access token.
        meta_ad_set_id: The Meta ad set id (AdSet.metaAdSetId).

    Returns:
        That one AdSet's lifetime-to-date insights — canned empty in fake
        mode, same as fetch_campaign_insights.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return CampaignInsights(impressions=0, clicks=0, spend=0.0, conversions=0)
    return await _fetch_insights(
        access_token=access_token, meta_object_id=meta_ad_set_id
    )


class AccountCampaignInsights(NamedTuple):
    """Lifetime performance numbers for one campaign on a connected ad account."""

    campaign_name: str
    impressions: int
    clicks: int
    spend: float
    conversions: int


async def fetch_account_historical_performance(
    *, access_token: str, ad_account_id: str
) -> list[AccountCampaignInsights]:
    """Fetch lifetime, per-campaign performance for an entire ad account.

    Unlike fetch_campaign_insights (which looks up one Meta campaign this
    app itself published), this pulls every campaign Meta has delivery
    data for on the account — including ones run before the business ever
    connected to Sales Guru. Used by the Marketing Strategist Agent
    (app/services/strategist.py) to decide between a TEST_PLAN and a
    DATA_DRIVEN_STRATEGY plan, and to ground the latter in what actually
    worked before (confirmed with the user 2026-08-31).

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account, already carrying Meta's
            own "act_" prefix (see create_meta_campaign's docstring).

    Returns:
        One entry per campaign with delivery data, empty if the account
        has none (also always empty in fake mode — a fake ad account has
        no history to speak of, which deterministically steers the
        Strategist toward a TEST_PLAN rather than depending on what a
        real account happens to have). Rows with no name are skipped —
        Meta shouldn't omit it, but a nameless row isn't useful grounding
        for the agent's prompt.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return []
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/{ad_account_id}/insights",
        {
            "level": "campaign",
            "fields": "campaign_name,impressions,clicks,spend,actions",
            "date_preset": "maximum",
            "access_token": access_token,
        },
    )
    results: list[AccountCampaignInsights] = []
    for row in body.get("data", []):
        name = row.get("campaign_name")
        if not name:
            continue
        conversions = sum(int(action["value"]) for action in row.get("actions", []))
        results.append(
            AccountCampaignInsights(
                campaign_name=name,
                impressions=int(row.get("impressions", 0)),
                clicks=int(row.get("clicks", 0)),
                spend=float(row.get("spend", 0.0)),
                conversions=conversions,
            )
        )
    return results


def has_meaningful_history(rows: list[AccountCampaignInsights]) -> bool:
    """Whether an account's historical pull shows any real spend.

    Args:
        rows: The result of fetch_account_historical_performance.

    Returns:
        True if any campaign on the account has spent anything at all —
        the bar for "this business has run ads before" is deliberately
        low (any real spend, not a dollar threshold): a self-reported "no"
        should never override real evidence to the contrary, however
        small (confirmed with the user 2026-08-31).
    """
    return any(row.spend > 0 for row in rows)


async def pause_meta_ad(*, access_token: str, meta_ad_id: str) -> None:
    """Pause a live ad on Meta (PRD.md build step 10, PAUSE_AD recommendations).

    Args:
        access_token: The business's Meta access token.
        meta_ad_id: The Meta ad id to pause (Ad.metaAdId).

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_id}",
        {"access_token": access_token, "status": "PAUSED"},
    )


async def pause_meta_ad_set(*, access_token: str, meta_ad_set_id: str) -> None:
    """Pause a live ad set on Meta.

    Manual campaign pause, duration-elapsed auto-pause, and the
    total-spend circuit breaker all pause at the AdSet level, not
    per-Ad — see app/services/publish.py's pause_campaign.

    Same shape as pause_meta_ad, one level up the object hierarchy —
    pausing an AdSet stops delivery for every Ad under it regardless of
    each Ad's own status field.

    Args:
        access_token: The business's Meta access token.
        meta_ad_set_id: The Meta ad set id to pause (AdSet.metaAdSetId).

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_set_id}",
        {"access_token": access_token, "status": "PAUSED"},
    )


async def resume_meta_ad_set(*, access_token: str, meta_ad_set_id: str) -> None:
    """Resume a paused ad set on Meta — the reverse of pause_meta_ad_set.

    Same shape/level as pause_meta_ad_set. Only ever called by
    app/services/publish.py's activate_campaign, itself only reachable
    for a campaign published paused ("Publish paused") and never yet
    activated — not a general "un-pause anything" action (see
    activate_campaign's own docstring for why).

    Args:
        access_token: The business's Meta access token.
        meta_ad_set_id: The Meta ad set id to resume (AdSet.metaAdSetId).

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_set_id}",
        {"access_token": access_token, "status": "ACTIVE"},
    )


async def update_meta_ad_set_budget(
    *, access_token: str, meta_ad_set_id: str, daily_budget_cents: int
) -> None:
    """Update a live ad set's daily budget on Meta (INCREASE_BUDGET recommendations).

    Args:
        access_token: The business's Meta access token.
        meta_ad_set_id: The Meta ad set id to update (AdSet.metaAdSetId).
        daily_budget_cents: The new daily budget, in the ad account's minor
            currency unit (cents for USD) — same unit as create_meta_ad_set.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        return
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_set_id}",
        {"access_token": access_token, "daily_budget": str(daily_budget_cents)},
    )


async def search_ad_interests(*, access_token: str, query: str) -> list[dict[str, Any]]:
    """Search Meta's ad-interest targeting taxonomy for a free-text term.

    Real endpoint confirmed 2026-09-02, used by scripts/resolve_interests.py
    to build the curated jewelry interest lookup table
    (app/services/interests.py) — GET /search?type=adinterest&q=... Not
    ad-account-scoped; any valid access token with ads permissions works.
    Not called at runtime by the app itself — interests are resolved once
    into a static curated table, not looked up live per request (see
    app/services/interests.py's module docstring for why) — this exists
    so the resolution script shares the same real API wrapper as the rest
    of this module instead of a separate ad hoc HTTP call.

    Args:
        access_token: A Meta access token with ads permissions.
        query: Free-text search term (e.g. "engagement rings").

    Returns:
        Meta's raw result list — each item has at least id/name/
        audience_size_lower_bound/audience_size_upper_bound.

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/search",
        {"type": "adinterest", "q": query, "access_token": access_token},
    )
    data: list[dict[str, Any]] = body.get("data", [])
    return data


async def validate_ad_interests(
    *, access_token: str, meta_ids: list[str]
) -> list[dict[str, Any]]:
    """Check whether previously-resolved interest ids are still live on Meta.

    Real endpoint confirmed 2026-09-02: GET /search?type=adinterestvalid&
    interest_fbid_list=[...] — note interest_fbid_list, not the more
    obvious-looking interest_list, which silently returns valid=false for
    every id regardless of whether it's real (a genuine API quirk, only
    caught by testing against the live endpoint, not documented anywhere
    this was checked). Returns a fresh audience_size for each still-valid
    id, which scripts/resolve_interests.py uses to refresh the curated
    table's numbers alongside re-stamping resolved_at — same freshness
    pattern as app/services/benchmarks.py's BenchmarkRange.as_of.

    Args:
        access_token: A Meta access token with ads permissions.
        meta_ids: The interest ids to check.

    Returns:
        Meta's raw result list, one entry per input id, each with at
        least id/valid/audience_size (audience_size only present when
        valid).

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/search",
        {
            "type": "adinterestvalid",
            "interest_fbid_list": json.dumps(meta_ids),
            "access_token": access_token,
        },
    )
    data: list[dict[str, Any]] = body.get("data", [])
    return data


async def search_ad_geolocations(
    *, access_token: str, query: str, location_type: Literal["city", "region"]
) -> list[dict[str, Any]]:
    """Search Meta's real geo-targeting taxonomy for a free-text place name.

    Real endpoint confirmed 2026-09-02, used by app/services/geo.py to
    resolve a TargetLocation's city/region into a real Meta geo key at
    publish time — GET /search?type=adgeolocation&location_types=
    ["city"|"region"]&q=... Not ad-account-scoped; any valid access
    token with ads permissions works, same as search_ad_interests.

    Args:
        access_token: A Meta access token with ads permissions.
        query: Free-text place name (e.g. "New York", "Springfield",
            "Texas").
        location_type: Which taxonomy to search — a city name and a
            region (state) name can't be searched together in one call.

    Returns:
        Meta's raw result list — each item has at least key/name/type/
        country_code/country_name, plus region/region_id for a city
        result. Ambiguous names (multiple real places sharing one name,
        possibly across different countries or — for city results —
        different US states) are common and expected; disambiguation is
        app/services/geo.py's job, not this function's.

    Raises:
        MetaConnectionError: If the call fails.
    """
    if get_settings().fake_meta_enabled:
        fake_key = f"fake_{location_type}_{query.strip().lower().replace(' ', '_')}"
        return [
            {
                "key": fake_key,
                "name": query,
                "type": location_type,
                "country_code": "US",
                "country_name": "United States",
            }
        ]
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/search",
        {
            "type": "adgeolocation",
            "location_types": json.dumps([location_type]),
            "q": query,
            "access_token": access_token,
        },
    )
    data: list[dict[str, Any]] = body.get("data", [])
    return data
