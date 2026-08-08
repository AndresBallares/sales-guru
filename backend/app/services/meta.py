"""Meta Ads OAuth connection (PRD.md build step 6).

Handles the OAuth dialog URL, the authorization-code exchange, and the
Graph API calls needed to let a user pick an ad account + Page. Building a
live campaign on Meta (create campaign/ad set/ad) is a separate, later
step (PRD.md build step 8) — this module only gets a usable access token
and the two ids (ad account, Page) that step will need.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from app.core.config import get_settings
from app.schemas.meta import MetaAdAccount, MetaPage

_GRAPH_VERSION = "v21.0"
_GRAPH_BASE_URL = f"https://graph.facebook.com/{_GRAPH_VERSION}"
_AUTH_DIALOG_URL = f"https://www.facebook.com/{_GRAPH_VERSION}/dialog/oauth"
_SCOPES = "ads_management,ads_read,pages_show_list,business_management"


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
