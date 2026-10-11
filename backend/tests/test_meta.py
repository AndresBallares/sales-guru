"""Tests for the Meta Ads connection endpoints.

The Meta service layer (app/services/meta.py) is mocked here — its own
behavior against the real Graph API is covered by test_meta_service.py.
These tests cover auth, ownership scoping, connection state, and (for the
OAuth callback) the always-redirect contract.

State is driven through the real endpoints throughout, same as every other
API test file in this suite — except the expired-state test, which has to
seed an already-old MetaOAuthState directly, since there's no way to make
ten real minutes pass in a test.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, Mock

import pytest
from app.api import meta as meta_module
from app.core.config import get_settings
from app.schemas.meta import MetaAdAccount, MetaPage, MetaPixel
from fastapi.testclient import TestClient
from prisma import Prisma


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post(
        "/businesses", json={"name": name, "industry": "FASHION_JEWELRY"}
    )
    id_: str = response.json()["id"]
    return id_


def _connect(client: TestClient, business_id: str) -> None:
    """Drive a full connect -> callback round-trip (service calls mocked)."""
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )


@pytest.fixture(autouse=True)
def mock_meta_service(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock | Mock]:
    """Mock every Meta service call the API layer touches."""
    build_url = Mock(side_effect=lambda state: f"https://meta.example/{state}")
    monkeypatch.setattr(meta_module, "build_authorization_url", build_url)
    exchange_code = AsyncMock(return_value="short-lived-token")
    monkeypatch.setattr(meta_module, "exchange_code_for_token", exchange_code)
    long_lived = AsyncMock(
        return_value=("long-lived-token", datetime.now(UTC) + timedelta(days=60))
    )
    monkeypatch.setattr(meta_module, "get_long_lived_token", long_lived)
    user_id = AsyncMock(return_value="meta-user-1")
    monkeypatch.setattr(meta_module, "get_meta_user_id", user_id)
    ad_accounts = AsyncMock(return_value=[MetaAdAccount(id="act_1", name="Acme Ads")])
    monkeypatch.setattr(meta_module, "list_ad_accounts", ad_accounts)
    pages = AsyncMock(return_value=[MetaPage(id="page_1", name="Acme Jewelry")])
    monkeypatch.setattr(meta_module, "list_pages", pages)
    pixels = AsyncMock(return_value=[MetaPixel(id="pixel_1", name="venzi jewelry")])
    monkeypatch.setattr(meta_module, "list_ad_pixels", pixels)
    instagram = AsyncMock(return_value="ig_1")
    monkeypatch.setattr(meta_module, "fetch_page_instagram_account", instagram)
    validate_instagram = AsyncMock(return_value=None)
    monkeypatch.setattr(meta_module, "validate_instagram_account", validate_instagram)
    return {
        "instagram": instagram,
        "validate_instagram": validate_instagram,
        "build_url": build_url,
        "exchange_code": exchange_code,
        "long_lived": long_lived,
        "user_id": user_id,
        "ad_accounts": ad_accounts,
        "pages": pages,
        "pixels": pixels,
    }


def test_connect_requires_a_session(client: TestClient) -> None:
    """Starting a connection with no session cookie returns 401."""
    response = client.get("/businesses/some-id/meta/connect")

    assert response.status_code == 401


def test_connect_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Connecting a nonexistent business returns 404."""
    _signed_up_client(client)

    response = client.get("/businesses/does-not-exist/meta/connect")

    assert response.status_code == 404


def test_connect_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't start a connection for a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{business_id}/meta/connect")

    assert response.status_code == 404


def test_connect_returns_an_authorization_url(client: TestClient) -> None:
    """A successful connect returns the dialog URL to navigate the browser to."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/meta/connect")

    assert response.status_code == 200
    assert response.json()["authorizationUrl"].startswith("https://meta.example/")


def test_connect_surfaces_agent_failures_as_500(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A MetaConnectionError building the dialog URL becomes a clean 500."""
    from app.services.meta import MetaConnectionError

    mock_meta_service["build_url"].side_effect = MetaConnectionError(
        "META_APP_ID, META_APP_SECRET, and META_REDIRECT_URI must all be configured"
    )
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/meta/connect")

    assert response.status_code == 500
    assert "META_APP_ID" in response.json()["detail"]


def test_get_connection_requires_a_session(client: TestClient) -> None:
    """Fetching connection status with no session cookie returns 401."""
    response = client.get("/businesses/some-id/meta")

    assert response.status_code == 401


def test_get_connection_404s_before_any_connection_started(client: TestClient) -> None:
    """No connection yet returns 404, not an empty/default object."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/meta")

    assert response.status_code == 404


def test_get_connection_returns_the_stored_connection(client: TestClient) -> None:
    """A stored connection round-trips, with null adAccountId/pageId until finalized."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.get(f"/businesses/{business_id}/meta")

    assert response.status_code == 200
    body = response.json()
    assert body["businessId"] == business_id
    assert body["metaUserId"] == "meta-user-1"
    assert body["adAccountId"] is None
    assert body["pageId"] is None
    assert "accessToken" not in body


def test_get_ad_accounts_requires_a_session(client: TestClient) -> None:
    """Listing ad accounts with no session cookie returns 401."""
    response = client.get("/businesses/some-id/meta/ad-accounts")

    assert response.status_code == 401


def test_get_ad_accounts_404s_before_any_connection_started(client: TestClient) -> None:
    """Listing ad accounts before a connection exists returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/meta/ad-accounts")

    assert response.status_code == 404


def test_get_ad_accounts_returns_the_list(client: TestClient) -> None:
    """A pending connection's ad accounts are listed for the picker."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.get(f"/businesses/{business_id}/meta/ad-accounts")

    assert response.status_code == 200
    assert response.json() == [{"id": "act_1", "name": "Acme Ads"}]


def test_get_ad_accounts_surfaces_agent_failures_as_500(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A MetaConnectionError from the Graph API call becomes a clean 500."""
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    mock_meta_service["ad_accounts"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.get(f"/businesses/{business_id}/meta/ad-accounts")

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]


def test_get_pages_returns_the_list(client: TestClient) -> None:
    """A pending connection's Pages are listed for the picker."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.get(f"/businesses/{business_id}/meta/pages")

    assert response.status_code == 200
    assert response.json() == [{"id": "page_1", "name": "Acme Jewelry"}]


def test_get_pages_surfaces_agent_failures_as_500(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A MetaConnectionError from the Graph API call becomes a clean 500."""
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    mock_meta_service["pages"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.get(f"/businesses/{business_id}/meta/pages")

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]


def test_finalize_requires_a_session(client: TestClient) -> None:
    """Finalizing with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    assert response.status_code == 401


def test_finalize_404s_before_any_connection_started(client: TestClient) -> None:
    """Finalizing before a connection exists returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    assert response.status_code == 404


def test_finalize_stores_the_chosen_ad_account_and_page(client: TestClient) -> None:
    """Finalizing records the picked ad account + Page on the connection."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["adAccountId"] == "act_1"
    assert body["pageId"] == "page_1"


def _finalize(client: TestClient, business_id: str) -> dict[str, Any]:
    response = client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def test_finalize_stores_the_pages_linked_instagram_account(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """Finalize reads the chosen Page's Instagram account and stores its id."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    body = _finalize(client, business_id)

    assert body["instagramUserId"] == "ig_1"
    mock_meta_service["instagram"].assert_awaited_once_with(
        "long-lived-token", "page_1"
    )
    assert client.get(f"/businesses/{business_id}/meta").json()["instagramUserId"] == (
        "ig_1"
    )


def test_finalize_leaves_instagram_unset_when_the_page_has_none(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A Page with no linked Instagram account stores null."""
    mock_meta_service["instagram"].return_value = None
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    body = _finalize(client, business_id)

    assert body["instagramUserId"] is None
    assert body["pageId"] == "page_1"


def test_finalize_still_succeeds_when_the_instagram_lookup_fails(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A failed Instagram read must not block connecting; it stays unset."""
    from app.services.meta import MetaConnectionError

    mock_meta_service["instagram"].side_effect = MetaConnectionError("boom")
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    body = _finalize(client, business_id)

    assert body["pageId"] == "page_1"
    assert body["instagramUserId"] is None


def test_reconnecting_clears_the_stored_instagram_account(client: TestClient) -> None:
    """A fresh connection starts without one, same as the Page and ad account."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    assert _finalize(client, business_id)["instagramUserId"] == "ig_1"

    _connect(client, business_id)

    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["pageId"] is None
    assert body["instagramUserId"] is None


def test_refresh_instagram_requires_a_session(client: TestClient) -> None:
    response = client.post("/businesses/some-id/meta/instagram/refresh")

    assert response.status_code == 401


def test_refresh_instagram_404s_without_a_connection(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/meta/instagram/refresh")

    assert response.status_code == 404


def test_refresh_instagram_400s_before_a_page_is_chosen(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.post(f"/businesses/{business_id}/meta/instagram/refresh")

    assert response.status_code == 400
    mock_meta_service["instagram"].assert_not_awaited()


def test_refresh_instagram_backfills_an_existing_connection(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A connection finalized before Instagram was stored picks it up, with no
    reconnect: the same Page, ad account and token are kept."""
    mock_meta_service["instagram"].return_value = None
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    assert _finalize(client, business_id)["instagramUserId"] is None
    mock_meta_service["instagram"].return_value = "ig_venzi"

    response = client.post(f"/businesses/{business_id}/meta/instagram/refresh")

    assert response.status_code == 200
    body = response.json()
    assert body["instagramUserId"] == "ig_venzi"
    assert body["pageId"] == "page_1"
    assert body["adAccountId"] == "act_1"
    mock_meta_service["instagram"].assert_awaited_with("long-lived-token", "page_1")


def test_refresh_instagram_clears_it_when_the_page_no_longer_has_one(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    assert _finalize(client, business_id)["instagramUserId"] == "ig_1"
    mock_meta_service["instagram"].return_value = None

    response = client.post(f"/businesses/{business_id}/meta/instagram/refresh")

    assert response.status_code == 200
    assert response.json()["instagramUserId"] is None


def test_refresh_instagram_500s_and_keeps_the_stored_value_when_meta_fails(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    assert _finalize(client, business_id)["instagramUserId"] == "ig_1"
    mock_meta_service["instagram"].side_effect = MetaConnectionError("Meta is down")

    response = client.post(f"/businesses/{business_id}/meta/instagram/refresh")

    assert response.status_code == 500
    assert "Meta is down" in response.json()["detail"]
    assert client.get(f"/businesses/{business_id}/meta").json()["instagramUserId"] == (
        "ig_1"
    )


MANUAL_IG = "17841400000000001"


def _set_manual(client: TestClient, business_id: str, value: str | None) -> Any:
    return client.put(
        f"/businesses/{business_id}/meta/instagram", json={"instagramUserId": value}
    )


def _connected_and_finalized(client: TestClient) -> str:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    _finalize(client, business_id)
    return business_id


def test_set_instagram_requires_a_session(client: TestClient) -> None:
    assert _set_manual(client, "some-id", MANUAL_IG).status_code == 401


def test_set_instagram_404s_without_a_connection(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    assert _set_manual(client, business_id, MANUAL_IG).status_code == 404


def test_set_instagram_400s_before_the_ad_account_and_page_are_chosen(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = _set_manual(client, business_id, MANUAL_IG)

    assert response.status_code == 400
    mock_meta_service["validate_instagram"].assert_not_awaited()


@pytest.mark.parametrize("bad", ["abc", "1234", "1784-14000", "17841400000000001x"])
def test_set_instagram_422s_for_something_that_is_not_an_account_number(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock], bad: str
) -> None:
    business_id = _connected_and_finalized(client)

    assert _set_manual(client, business_id, bad).status_code == 422
    mock_meta_service["validate_instagram"].assert_not_awaited()


def test_a_manual_instagram_account_is_checked_with_meta_then_wins_over_discovery(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """Discovery found ig_1; the hand-entered id is validated against the ad
    account and Page, saved, and becomes the account in use."""
    business_id = _connected_and_finalized(client)

    response = _set_manual(client, business_id, f"  {MANUAL_IG} ")

    assert response.status_code == 200
    body = response.json()
    assert body["instagramUserId"] == MANUAL_IG
    assert body["instagramUserIdManual"] == MANUAL_IG
    assert body["instagramUserIdDiscovered"] == "ig_1"
    mock_meta_service["validate_instagram"].assert_awaited_once_with(
        access_token="long-lived-token",
        ad_account_id="act_1",
        page_id="page_1",
        instagram_user_id=MANUAL_IG,
    )
    stored = client.get(f"/businesses/{business_id}/meta").json()
    assert stored["instagramUserId"] == MANUAL_IG


def test_a_manual_instagram_account_meta_rejects_is_not_saved(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    from app.services.meta import InvalidInstagramAccountError

    business_id = _connected_and_finalized(client)
    mock_meta_service["validate_instagram"].side_effect = InvalidInstagramAccountError(
        "(#100) Param instagram_user_id must be a valid Instagram account id"
    )

    response = _set_manual(client, business_id, MANUAL_IG)

    assert response.status_code == 400
    assert "doesn't accept that Instagram account ID" in response.json()["detail"]
    stored = client.get(f"/businesses/{business_id}/meta").json()
    assert stored["instagramUserIdManual"] is None
    assert stored["instagramUserId"] == "ig_1"


def test_a_failed_meta_lookup_is_a_500_and_nothing_is_saved(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    from app.services.meta import MetaConnectionError

    business_id = _connected_and_finalized(client)
    mock_meta_service["validate_instagram"].side_effect = MetaConnectionError("down")

    response = _set_manual(client, business_id, MANUAL_IG)

    assert response.status_code == 500
    stored = client.get(f"/businesses/{business_id}/meta").json()
    assert stored["instagramUserIdManual"] is None


@pytest.mark.parametrize("clear", [None, "", "   "])
def test_clearing_the_manual_account_goes_back_to_discovery_without_a_meta_call(
    client: TestClient,
    mock_meta_service: dict[str, AsyncMock | Mock],
    clear: str | None,
) -> None:
    business_id = _connected_and_finalized(client)
    assert _set_manual(client, business_id, MANUAL_IG).status_code == 200
    mock_meta_service["validate_instagram"].reset_mock()

    response = _set_manual(client, business_id, clear)

    assert response.status_code == 200
    body = response.json()
    assert body["instagramUserIdManual"] is None
    assert body["instagramUserId"] == "ig_1"
    mock_meta_service["validate_instagram"].assert_not_awaited()


def test_refresh_updates_the_discovered_account_but_never_the_manual_one(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    business_id = _connected_and_finalized(client)
    _set_manual(client, business_id, MANUAL_IG)
    mock_meta_service["instagram"].return_value = "ig_new"

    body = client.post(f"/businesses/{business_id}/meta/instagram/refresh").json()

    assert body["instagramUserIdDiscovered"] == "ig_new"
    assert body["instagramUserIdManual"] == MANUAL_IG
    assert body["instagramUserId"] == MANUAL_IG


def test_a_manual_account_covers_a_page_with_nothing_discovered(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """The case this exists for: discovery finds nothing, so the hand-entered
    id is the one in use."""
    mock_meta_service["instagram"].return_value = None
    business_id = _connected_and_finalized(client)
    assert (
        client.get(f"/businesses/{business_id}/meta").json()["instagramUserId"] is None
    )

    body = _set_manual(client, business_id, MANUAL_IG).json()

    assert body["instagramUserId"] == MANUAL_IG
    assert body["instagramUserIdDiscovered"] is None


def test_choosing_a_different_page_drops_the_manual_account_entered_for_the_old_one(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    business_id = _connected_and_finalized(client)
    _set_manual(client, business_id, MANUAL_IG)

    response = client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_2"},
    )

    assert response.json()["instagramUserIdManual"] is None


def test_finalizing_the_same_page_again_keeps_the_manual_account(
    client: TestClient,
) -> None:
    business_id = _connected_and_finalized(client)
    _set_manual(client, business_id, MANUAL_IG)

    body = _finalize(client, business_id)

    assert body["instagramUserIdManual"] == MANUAL_IG


def test_reconnecting_clears_the_manual_account_too(client: TestClient) -> None:
    business_id = _connected_and_finalized(client)
    _set_manual(client, business_id, MANUAL_IG)

    _connect(client, business_id)

    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["instagramUserIdManual"] is None
    assert body["instagramUserId"] is None


def _start_reconnect(client: TestClient, business_id: str) -> str:
    response = client.get(f"/businesses/{business_id}/meta/reconnect")
    assert response.status_code == 200
    return str(response.json()["authorizationUrl"].rsplit("/", 1)[-1])


def _finish_oauth(client: TestClient, state_id: str) -> str:
    """Hit the OAuth callback; return where the browser is sent back to."""
    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )
    return str(response.headers["location"])


def _rotate_token(mock_meta_service: dict[str, AsyncMock | Mock]) -> None:
    mock_meta_service["long_lived"].return_value = (
        "rotated-token",
        datetime.now(UTC) + timedelta(days=60),
    )
    mock_meta_service["user_id"].return_value = "meta-user-2"


def test_reconnect_requires_a_session(client: TestClient) -> None:
    assert client.get("/businesses/some-id/meta/reconnect").status_code == 401


def test_reconnect_404s_without_a_connection(client: TestClient) -> None:
    """Nothing to reconnect: the first connection uses /connect."""
    _signed_up_client(client)
    business_id = _create_business(client)

    assert client.get(f"/businesses/{business_id}/meta/reconnect").status_code == 404


def test_reconnect_returns_the_same_authorization_dialog(client: TestClient) -> None:
    business_id = _connected_and_finalized(client)

    response = client.get(f"/businesses/{business_id}/meta/reconnect")

    assert response.status_code == 200
    assert response.json()["authorizationUrl"].startswith("https://meta.example/")


def test_reconnect_rotates_the_token_and_keeps_the_connection_settings(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """Same ad account, Page, Pixel and hand-entered Instagram account; only the
    token and Meta user change."""
    business_id = _connected_and_finalized(client)
    assert (
        client.post(
            f"/businesses/{business_id}/meta/pixel", json={"pixelId": "pixel_1"}
        ).status_code
        == 200
    )
    _set_manual(client, business_id, MANUAL_IG)
    _rotate_token(mock_meta_service)

    location = _finish_oauth(client, _start_reconnect(client, business_id))

    assert location.endswith(f"/businesses/{business_id}?meta=reconnected")
    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["metaUserId"] == "meta-user-2"
    assert body["adAccountId"] == "act_1"
    assert body["pageId"] == "page_1"
    assert body["pixelId"] == "pixel_1"
    assert body["instagramUserIdManual"] == MANUAL_IG
    # The new token is the one now used for Meta calls.
    client.get(f"/businesses/{business_id}/meta/pages")
    mock_meta_service["pages"].assert_awaited_with("rotated-token")


def test_reconnect_discovers_the_pages_instagram_account_again(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """The case this is for: a connection made without the permission to read
    the Instagram account picks it up once reconnected."""
    mock_meta_service["instagram"].return_value = None
    business_id = _connected_and_finalized(client)
    assert (
        client.get(f"/businesses/{business_id}/meta").json()["instagramUserId"] is None
    )
    mock_meta_service["instagram"].return_value = "ig_found"
    _rotate_token(mock_meta_service)

    _finish_oauth(client, _start_reconnect(client, business_id))

    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["instagramUserIdDiscovered"] == "ig_found"
    assert body["instagramUserId"] == "ig_found"
    mock_meta_service["instagram"].assert_awaited_with("rotated-token", "page_1")


def test_reconnect_keeps_the_old_instagram_account_when_discovery_fails(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    from app.services.meta import MetaConnectionError

    business_id = _connected_and_finalized(client)
    mock_meta_service["instagram"].side_effect = MetaConnectionError("boom")
    _rotate_token(mock_meta_service)

    location = _finish_oauth(client, _start_reconnect(client, business_id))

    assert location.endswith("?meta=reconnected")
    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["instagramUserIdDiscovered"] == "ig_1"
    assert body["pageId"] == "page_1"


def test_reconnect_with_a_login_that_cannot_see_the_page_asks_for_a_new_one(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A different Meta login without access to the stored Page: the ad account
    and Page are cleared (and the Instagram settings tied to them) so the
    existing picker runs again, rather than publishing as a Page it cannot use."""
    business_id = _connected_and_finalized(client)
    _set_manual(client, business_id, MANUAL_IG)
    mock_meta_service["pages"].return_value = [MetaPage(id="other_page", name="Other")]
    _rotate_token(mock_meta_service)

    location = _finish_oauth(client, _start_reconnect(client, business_id))

    assert location.endswith("?meta=reconnected_choose_page")
    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["metaUserId"] == "meta-user-2"
    assert body["adAccountId"] is None
    assert body["pageId"] is None
    assert body["instagramUserId"] is None
    assert body["instagramUserIdManual"] is None


def test_reconnect_keeps_everything_when_the_page_list_cannot_be_read(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    from app.services.meta import MetaConnectionError

    business_id = _connected_and_finalized(client)
    mock_meta_service["pages"].side_effect = MetaConnectionError("down")
    _rotate_token(mock_meta_service)

    location = _finish_oauth(client, _start_reconnect(client, business_id))

    assert location.endswith("?meta=reconnected")
    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["pageId"] == "page_1"
    assert body["adAccountId"] == "act_1"


def test_a_reconnect_for_a_connection_deleted_meanwhile_connects_fresh(
    client: TestClient,
) -> None:
    business_id = _connected_and_finalized(client)
    state_id = _start_reconnect(client, business_id)
    assert client.delete(f"/businesses/{business_id}/meta").status_code == 204

    location = _finish_oauth(client, state_id)

    assert location.endswith("?meta=connected")
    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["pageId"] is None


def test_a_first_connect_still_resets_the_settings(client: TestClient) -> None:
    """Only a reconnect keeps them; a plain /connect round-trip still starts over."""
    business_id = _connected_and_finalized(client)

    _connect(client, business_id)

    body = client.get(f"/businesses/{business_id}/meta").json()
    assert body["pageId"] is None
    assert body["adAccountId"] is None


def test_get_pixels_requires_a_session(client: TestClient) -> None:
    """Listing Pixels with no session cookie returns 401."""
    response = client.get("/businesses/some-id/meta/pixels")

    assert response.status_code == 401


def test_get_pixels_404s_before_any_connection_started(client: TestClient) -> None:
    """Listing Pixels before a connection exists returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/meta/pixels")

    assert response.status_code == 404


def test_get_pixels_400s_before_an_ad_account_is_chosen(client: TestClient) -> None:
    """Pixels belong to an ad account — finalize must run first (see meta.py)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.get(f"/businesses/{business_id}/meta/pixels")

    assert response.status_code == 400
    assert "ad account" in response.json()["detail"].lower()


def test_get_pixels_returns_the_list_once_an_ad_account_is_chosen(
    client: TestClient,
) -> None:
    """Once finalize has picked an ad account, its Pixels are listed."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    response = client.get(f"/businesses/{business_id}/meta/pixels")

    assert response.status_code == 200
    assert response.json() == [{"id": "pixel_1", "name": "venzi jewelry"}]


def test_get_pixels_surfaces_agent_failures_as_500(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A MetaConnectionError from the Graph API call becomes a clean 500."""
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )
    mock_meta_service["pixels"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.get(f"/businesses/{business_id}/meta/pixels")

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]


def test_get_pixels_maps_a_business_tools_terms_error_to_409(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """The ad account not accepting Business Tools Terms is a distinct,
    friendly 409 — not the generic 500 every other Graph failure gets —
    since retrying the same call won't help until the terms are accepted
    on Meta's own side (app/services/meta.py's
    is_business_tools_terms_error)."""
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )
    mock_meta_service["pixels"].side_effect = MetaConnectionError(
        "Meta API call to /adspixels failed: "
        "Business has not accepted Pixel Terms of Service"
    )

    response = client.get(f"/businesses/{business_id}/meta/pixels")

    assert response.status_code == 409
    assert "Business Tools Terms" in response.json()["detail"]
    assert "retry" in response.json()["detail"].lower()


def test_set_pixel_requires_a_session(client: TestClient) -> None:
    """Setting the Pixel with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/meta/pixel", json={"pixelId": "pixel_1"}
    )

    assert response.status_code == 401


def test_set_pixel_404s_before_any_connection_started(client: TestClient) -> None:
    """Setting the Pixel before a connection exists returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/meta/pixel", json={"pixelId": "pixel_1"}
    )

    assert response.status_code == 404


def test_set_pixel_stores_the_chosen_pixel(client: TestClient) -> None:
    """Setting the Pixel records it, separate from and after finalize."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    response = client.post(
        f"/businesses/{business_id}/meta/pixel", json={"pixelId": "pixel_1"}
    )

    assert response.status_code == 200
    assert response.json()["pixelId"] == "pixel_1"


def test_set_pixel_clears_a_previous_skip(client: TestClient) -> None:
    """Choosing a real Pixel supersedes an earlier "skip" — the two are
    mutually exclusive facts about the same optional step."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )
    client.post(f"/businesses/{business_id}/meta/pixel/skip")

    response = client.post(
        f"/businesses/{business_id}/meta/pixel", json={"pixelId": "pixel_1"}
    )

    assert response.status_code == 200
    assert response.json()["pixelId"] == "pixel_1"
    assert response.json()["pixelSkipped"] is False


def test_skip_pixel_requires_a_session(client: TestClient) -> None:
    """Skipping the Pixel with no session cookie returns 401."""
    response = client.post("/businesses/some-id/meta/pixel/skip")

    assert response.status_code == 401


def test_skip_pixel_404s_before_any_connection_started(client: TestClient) -> None:
    """Skipping the Pixel before a connection exists returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/meta/pixel/skip")

    assert response.status_code == 404


def test_skip_pixel_persists_the_choice(client: TestClient) -> None:
    """Skipping is recorded on the connection, not just returned once —
    a later fetch reflects it too, which is the actual bug this fixes
    (the old, localStorage-only fix couldn't survive a remount)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    response = client.post(f"/businesses/{business_id}/meta/pixel/skip")
    assert response.status_code == 200
    assert response.json()["pixelSkipped"] is True

    fetched = client.get(f"/businesses/{business_id}/meta")
    assert fetched.json()["pixelSkipped"] is True


def test_reconnecting_resets_a_skipped_pixel(client: TestClient) -> None:
    """A fresh ad-account/Page selection (a real reconnect, not a full
    disconnect) also resets a skipped Pixel — the old selection's Pixels
    aren't necessarily even valid for whatever gets chosen next."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )
    client.post(f"/businesses/{business_id}/meta/pixel/skip")

    _connect(client, business_id)

    fetched = client.get(f"/businesses/{business_id}/meta")
    assert fetched.json()["pixelSkipped"] is False


def test_disconnect_requires_a_session(client: TestClient) -> None:
    """Disconnecting with no session cookie returns 401."""
    response = client.delete("/businesses/some-id/meta")

    assert response.status_code == 401


def test_disconnect_removes_the_connection(client: TestClient) -> None:
    """Disconnecting deletes the connection, so it 404s afterward."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)

    response = client.delete(f"/businesses/{business_id}/meta")

    assert response.status_code == 204
    assert client.get(f"/businesses/{business_id}/meta").status_code == 404


def test_callback_redirects_to_error_when_meta_reports_an_error(
    client: TestClient,
) -> None:
    """A denied-consent redirect from Meta becomes a clean error redirect."""
    response = client.get(
        "/meta/callback", params={"error": "access_denied"}, follow_redirects=False
    )

    assert response.status_code in (302, 307)
    assert response.headers["location"].endswith("/?meta=error")


def test_callback_redirects_to_error_when_code_or_state_missing(
    client: TestClient,
) -> None:
    """A callback with no code/state at all becomes a clean error redirect."""
    response = client.get("/meta/callback", follow_redirects=False)

    assert response.headers["location"].endswith("/?meta=error")


def test_callback_redirects_to_error_for_an_unknown_state(client: TestClient) -> None:
    """An unrecognized state value becomes a clean error redirect."""
    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": "does-not-exist"},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith("/?meta=error")


@pytest.mark.asyncio
async def test_callback_redirects_to_error_for_an_expired_state(
    client: TestClient,
) -> None:
    """A state older than the TTL is treated as invalid, not honored late.

    Uses a fresh Prisma() connection rather than the app's shared `db`
    singleton — `db` was connected on TestClient's own internal event
    loop (via the app's lifespan), so awaiting it directly from this
    pytest-asyncio test function's loop raises a cross-event-loop error.
    A separate connection, opened and closed on this loop, avoids that.
    """
    _signed_up_client(client)
    business_id = _create_business(client)

    seeder = Prisma()
    await seeder.connect()
    state = await seeder.metaoauthstate.create(
        data={
            "businessId": business_id,
            "createdAt": datetime.now(UTC) - timedelta(minutes=30),
        }
    )
    await seeder.disconnect()

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state.id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith("/?meta=error")


def test_callback_redirects_to_error_without_a_session(client: TestClient) -> None:
    """A valid state but no session cookie can't be linked to anyone — error."""
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.post("/auth/logout")

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


def test_callback_redirects_to_error_for_an_invalid_session_cookie(
    client: TestClient,
) -> None:
    """A cookie present but not resolving to a real session is rejected too —
    distinct from no cookie at all (get_current_user's own 401, caught)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.cookies.set("session", "not-a-real-session-token")

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


def test_callback_redirects_to_error_for_a_state_from_another_users_business(
    client: TestClient,
) -> None:
    """A state tied to a business the current session doesn't own is rejected."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


def test_callback_redirects_to_error_for_a_soft_deleted_business(
    client: TestClient,
) -> None:
    """A business soft-deleted between starting the OAuth flow and Meta's
    redirect back can't have a MetaConnection created for it — same
    ownership-check rejection as another user's business, even though this
    route isn't behind get_owned_business."""
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.delete(f"/businesses/{business_id}")

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


@pytest.mark.asyncio
async def test_callback_redirects_to_error_when_the_user_has_no_organization(
    client: TestClient,
) -> None:
    """Defense in depth: a user somehow missing their auto-provisioned
    Organization (should be impossible post-signup) can't own any business,
    so the ownership check fails closed rather than raising.

    Uses a fresh Prisma() connection, same reasoning as the expired-state
    test — this can't go through the app's shared `db` singleton from a
    pytest-asyncio test function.
    """
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]

    seeder = Prisma()
    await seeder.connect()
    await seeder.execute_raw("PRAGMA foreign_keys = OFF")
    await seeder.organization.delete_many()
    await seeder.execute_raw("PRAGMA foreign_keys = ON")
    await seeder.disconnect()

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


def test_callback_redirects_to_error_when_the_token_exchange_fails(
    client: TestClient, mock_meta_service: dict[str, AsyncMock | Mock]
) -> None:
    """A failed Graph API exchange becomes a clean error redirect, not a 500 page."""
    from app.services.meta import MetaConnectionError

    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    mock_meta_service["exchange_code"].side_effect = MetaConnectionError("bad code")

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=error"
    )


def test_callback_completes_the_connection_on_success(client: TestClient) -> None:
    """A full successful round-trip stores the connection and redirects to it."""
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith(
        f"/businesses/{business_id}?meta=connected"
    )
    fetched = client.get(f"/businesses/{business_id}/meta")
    assert fetched.status_code == 200
    assert fetched.json()["metaUserId"] == "meta-user-1"


def test_callback_is_one_time_use(client: TestClient) -> None:
    """Reusing the same state a second time fails — it was deleted after first use."""
    _signed_up_client(client)
    business_id = _create_business(client)
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    response = client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    assert response.headers["location"].endswith("/?meta=error")


def test_callback_resets_ad_account_and_page_on_reconnect(client: TestClient) -> None:
    """Reconnecting an already-configured business clears the old selections."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect(client, business_id)
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )

    _connect(client, business_id)

    fetched = client.get(f"/businesses/{business_id}/meta")
    assert fetched.json()["adAccountId"] is None
    assert fetched.json()["pageId"] is None


def test_fake_connect_requires_a_session(client: TestClient) -> None:
    """Fake-connecting with no session cookie returns 401."""
    response = client.post("/businesses/some-id/meta/fake-connect")

    assert response.status_code == 401


def test_fake_connect_404s_when_fake_meta_is_disabled(client: TestClient) -> None:
    """With FAKE_META off (the default), the route is a 404, like a missing one."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/meta/fake-connect")

    assert response.status_code == 404


def test_fake_connect_creates_a_connection_without_real_oauth(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With FAKE_META on, fake-connect creates a connection with no OAuth round-trip."""
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)

        response = client.post(f"/businesses/{business_id}/meta/fake-connect")

        assert response.status_code == 201
        body = response.json()
        assert body["metaUserId"] == "fake_meta_user"
        assert body["adAccountId"] is None
        assert body["pageId"] is None
        assert body["pixelSkipped"] is False
        fetched = client.get(f"/businesses/{business_id}/meta")
        assert fetched.status_code == 200
        assert fetched.json()["id"] == body["id"]
    finally:
        get_settings.cache_clear()


def test_fake_connect_resets_ad_account_and_page_on_reconnect(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Fake-reconnecting an already-configured business clears old selections."""
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)
        client.post(f"/businesses/{business_id}/meta/fake-connect")
        client.post(
            f"/businesses/{business_id}/meta/finalize",
            json={"adAccountId": "act_fake_account", "pageId": "fake_page"},
        )

        client.post(f"/businesses/{business_id}/meta/fake-connect")

        fetched = client.get(f"/businesses/{business_id}/meta")
        assert fetched.json()["adAccountId"] is None
        assert fetched.json()["pageId"] is None
    finally:
        get_settings.cache_clear()


def test_disconnecting_then_fake_reconnecting_resets_a_skipped_pixel(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A full disconnect + reconnect (not just a fresh ad-account/Page
    pick on the same connection) also starts the Pixel choice over —
    disconnect deletes the row outright, so the new one is a clean
    default regardless."""
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)
        client.post(f"/businesses/{business_id}/meta/fake-connect")
        client.post(
            f"/businesses/{business_id}/meta/finalize",
            json={"adAccountId": "act_fake_account", "pageId": "fake_page"},
        )
        client.post(f"/businesses/{business_id}/meta/pixel/skip")

        client.delete(f"/businesses/{business_id}/meta")
        assert client.get(f"/businesses/{business_id}/meta").status_code == 404

        client.post(f"/businesses/{business_id}/meta/fake-connect")

        fetched = client.get(f"/businesses/{business_id}/meta")
        assert fetched.json()["pixelSkipped"] is False
    finally:
        get_settings.cache_clear()
