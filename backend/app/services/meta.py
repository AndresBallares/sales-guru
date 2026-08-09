"""Meta Ads integration: OAuth (step 6), publishing (step 8), insights (step 9).

Handles the OAuth dialog URL, the authorization-code exchange, the Graph
API calls needed to let a user pick an ad account + Page, the
Campaign/AdSet/AdCreative/Ad creation calls that put an approved campaign
live on Meta, and pulling performance numbers back for a live one.
Orchestrating the publish calls against our own data model lives in
app/services/publish.py; this module only wraps the raw Graph API.
"""

import json
from datetime import UTC, datetime, timedelta
from typing import Any, NamedTuple

import httpx

from app.core.config import get_settings
from app.schemas.meta import MetaAdAccount, MetaPage

_GRAPH_VERSION = "v21.0"
_GRAPH_BASE_URL = f"https://graph.facebook.com/{_GRAPH_VERSION}"
_AUTH_DIALOG_URL = f"https://www.facebook.com/{_GRAPH_VERSION}/dialog/oauth"
_SCOPES = "ads_management,ads_read,pages_show_list,business_management"

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
    """Raised when the Meta Ads connection can't be built or used."""


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
        message = body.get("error", {}).get("message", response.text)
        raise MetaConnectionError(f"Meta API call failed: {message}")
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
        message = body.get("error", {}).get("message", response.text)
        raise MetaConnectionError(f"Meta API call failed: {message}")
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
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/me/accounts",
        {"fields": "id,name", "access_token": access_token},
    )
    return [MetaPage.model_validate(item) for item in body.get("data", [])]


async def create_meta_campaign(
    *, access_token: str, ad_account_id: str, name: str, objective: str
) -> str:
    """Create a live Campaign object on Meta (PRD.md build step 8).

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account to create the campaign in.
        name: The campaign's display name on Meta.
        objective: Our Campaign.objective value — mapped to Meta's own
            objective enum via CAMPAIGN_OBJECTIVE_MAP.

    Returns:
        The new Meta campaign id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/act_{ad_account_id}/campaigns",
        {
            "access_token": access_token,
            "name": name,
            "objective": CAMPAIGN_OBJECTIVE_MAP[objective],
            "status": "ACTIVE",
            "special_ad_categories": "[]",
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
) -> str:
    """Create a live AdSet object on Meta, under an already-created campaign.

    Targeting is deliberately minimal — age range only, a single-country
    geo default. PRD.md §7 already flags real location/interest
    resolution (free text -> Meta's own targeting-search taxonomy) as a
    known gap to close "at publish time" — this is that gap, still open;
    interests aren't sent at all yet.

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

    Returns:
        The new Meta ad set id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    targeting = json.dumps(
        {
            "age_min": age_min,
            "age_max": age_max,
            "geo_locations": {"countries": ["US"]},
        }
    )
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/act_{ad_account_id}/adsets",
        {
            "access_token": access_token,
            "name": name,
            "campaign_id": meta_campaign_id,
            "daily_budget": str(daily_budget_cents),
            "billing_event": "IMPRESSIONS",
            "optimization_goal": optimization_goal,
            "targeting": targeting,
            "status": "ACTIVE",
        },
    )
    ad_set_id: str = body["id"]
    return ad_set_id


async def create_meta_ad_creative(
    *,
    access_token: str,
    ad_account_id: str,
    page_id: str,
    name: str,
    headline: str,
    body_text: str,
    description: str,
    cta: str,
    link: str,
    image_url: str | None,
) -> str:
    """Create an ad creative object on Meta, ready to attach to an Ad.

    image_url is optional — no image generation/upload is built yet
    (PRD.md §2 step 4), so most creatives won't have one. Meta still
    accepts a link-only creative; a real running ad will typically need a
    real image to pass Meta's own ad review, which this doesn't handle.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        page_id: The connected Page the ad is posted as.
        name: The creative's display name on Meta.
        headline: The ad headline.
        body_text: The primary text (Meta's link_data.message).
        description: The secondary description line.
        cta: A Meta call_to_action type value.
        link: The destination URL.
        image_url: A publicly-reachable image URL, if one exists.

    Returns:
        The new Meta ad creative id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    link_data: dict[str, Any] = {
        "message": body_text,
        "name": headline,
        "description": description,
        "link": link,
        "call_to_action": {"type": cta},
    }
    if image_url:
        link_data["picture"] = image_url

    object_story_spec = json.dumps({"page_id": page_id, "link_data": link_data})
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/act_{ad_account_id}/adcreatives",
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
) -> str:
    """Create a live Ad object on Meta, attaching an ad set + creative.

    Args:
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.
        name: The ad's display name on Meta.
        meta_ad_set_id: The parent Meta ad set id.
        meta_creative_id: The Meta ad creative id to attach.

    Returns:
        The new Meta ad id.

    Raises:
        MetaConnectionError: If the call fails.
    """
    creative_ref = json.dumps({"creative_id": meta_creative_id})
    body = await _post_json(
        f"{_GRAPH_BASE_URL}/act_{ad_account_id}/ads",
        {
            "access_token": access_token,
            "name": name,
            "adset_id": meta_ad_set_id,
            "creative": creative_ref,
            "status": "ACTIVE",
        },
    )
    ad_id: str = body["id"]
    return ad_id


class CampaignInsights(NamedTuple):
    """Lifetime performance numbers for a Meta campaign."""

    impressions: int
    clicks: int
    spend: float
    conversions: int


async def fetch_campaign_insights(
    *, access_token: str, meta_campaign_id: str
) -> CampaignInsights:
    """Fetch lifetime performance numbers for a live Meta campaign.

    Args:
        access_token: The business's Meta access token.
        meta_campaign_id: The Meta campaign id (Campaign.metaCampaignId).

    Returns:
        All zero if Meta has no delivery data yet (e.g. a campaign
        published moments ago) — not an error.

        conversions is the sum of every entry in Meta's own "actions"
        breakdown (link clicks, purchases, leads, etc. all mixed
        together), not a single specific conversion type — resolving
        that properly means mapping each Campaign.objective to the one
        or two action_types that actually count as "the" conversion for
        it, which isn't done yet (known simplification, PRD.md §5 step 9).

    Raises:
        MetaConnectionError: If the call fails.
    """
    body = await _get_json(
        f"{_GRAPH_BASE_URL}/{meta_campaign_id}/insights",
        {"fields": "impressions,clicks,spend,actions", "access_token": access_token},
    )
    rows = body.get("data", [])
    if not rows:
        return CampaignInsights(impressions=0, clicks=0, spend=0.0, conversions=0)

    row = rows[0]
    conversions = sum(int(action["value"]) for action in row.get("actions", []))
    return CampaignInsights(
        impressions=int(row.get("impressions", 0)),
        clicks=int(row.get("clicks", 0)),
        spend=float(row.get("spend", 0.0)),
        conversions=conversions,
    )


async def pause_meta_ad(*, access_token: str, meta_ad_id: str) -> None:
    """Pause a live ad on Meta (PRD.md build step 10, PAUSE_AD recommendations).

    Args:
        access_token: The business's Meta access token.
        meta_ad_id: The Meta ad id to pause (Ad.metaAdId).

    Raises:
        MetaConnectionError: If the call fails.
    """
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_id}",
        {"access_token": access_token, "status": "PAUSED"},
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
    await _post_json(
        f"{_GRAPH_BASE_URL}/{meta_ad_set_id}",
        {"access_token": access_token, "daily_budget": str(daily_budget_cents)},
    )
