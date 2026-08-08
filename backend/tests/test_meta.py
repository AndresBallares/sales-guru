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
from unittest.mock import AsyncMock, Mock

import pytest
from app.api import meta as meta_module
from app.schemas.meta import MetaAdAccount, MetaPage
from fastapi.testclient import TestClient
from prisma import Prisma


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post("/businesses", json={"name": name})
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
    return {
        "build_url": build_url,
        "exchange_code": exchange_code,
        "long_lived": long_lived,
        "user_id": user_id,
        "ad_accounts": ad_accounts,
        "pages": pages,
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
