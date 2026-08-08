"""Tests for the Meta Ads connection service.

httpx.AsyncClient is mocked throughout — no test here makes a real network
call to Meta's Graph API.
"""

from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from app.core.config import get_settings
from app.schemas.meta import MetaPage
from app.services import meta


class _FakeResponse:
    """Minimal stand-in for httpx.Response — only what _get_json touches."""

    def __init__(
        self, json_body: dict[str, Any], *, is_error: bool = False, text: str = ""
    ) -> None:
        self._json_body = json_body
        self.is_error = is_error
        self.text = text or str(json_body)

    def json(self) -> dict[str, Any]:
        return self._json_body


class _FakeAsyncClient:
    """Minimal stand-in for httpx.AsyncClient as an async context manager."""

    def __init__(
        self, response: _FakeResponse | None = None, error: Exception | None = None
    ) -> None:
        self._response = response
        self._error = error
        self.calls: list[tuple[str, dict[str, str]]] = []

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *_args: object) -> bool:
        return False

    async def get(self, url: str, params: dict[str, str]) -> _FakeResponse:
        self.calls.append((url, params))
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _mock_client_returning(
    monkeypatch: pytest.MonkeyPatch, response: _FakeResponse
) -> _FakeAsyncClient:
    """Patch httpx.AsyncClient to return a canned response, return the fake client."""
    fake_client = _FakeAsyncClient(response=response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)
    return fake_client


@pytest.fixture
def meta_app_credentials(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Configure a fake Meta app for the duration of a test."""
    monkeypatch.setenv("META_APP_ID", "test-app-id")
    monkeypatch.setenv("META_APP_SECRET", "test-app-secret")
    monkeypatch.setenv("META_REDIRECT_URI", "http://localhost:8000/meta/callback")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_build_authorization_url_raises_without_app_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No Meta app configured raises a clear error, not a crash."""
    monkeypatch.delenv("META_APP_ID", raising=False)
    get_settings.cache_clear()

    with pytest.raises(meta.MetaConnectionError, match="must all be configured"):
        meta.build_authorization_url("some-state")

    get_settings.cache_clear()


def test_build_authorization_url_includes_state_and_redirect_uri(
    meta_app_credentials: None,
) -> None:
    """The dialog URL carries the CSRF state and the configured redirect URI."""
    url = meta.build_authorization_url("abc123")

    assert "state=abc123" in url
    assert "client_id=test-app-id" in url
    assert "redirect_uri=http://localhost:8000/meta/callback" in url
    assert "ads_management" in url


@pytest.mark.asyncio
async def test_exchange_code_for_token_raises_without_app_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No Meta app configured raises a clear error before any network call."""
    monkeypatch.delenv("META_APP_ID", raising=False)
    get_settings.cache_clear()

    with pytest.raises(meta.MetaConnectionError, match="must all be configured"):
        await meta.exchange_code_for_token("some-code")

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_exchange_code_for_token_returns_the_access_token(
    meta_app_credentials: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A successful exchange returns the short-lived access token."""
    _mock_client_returning(
        monkeypatch, _FakeResponse({"access_token": "short-lived-token"})
    )

    token = await meta.exchange_code_for_token("some-code")

    assert token == "short-lived-token"


@pytest.mark.asyncio
async def test_get_long_lived_token_returns_token_and_expiry(
    meta_app_credentials: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A successful exchange returns the long-lived token and its expiry."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse({"access_token": "long-lived-token", "expires_in": 5184000}),
    )

    token, expires_at = await meta.get_long_lived_token("short-lived-token")

    assert token == "long-lived-token"
    assert expires_at > datetime.now(UTC)


@pytest.mark.asyncio
async def test_get_meta_user_id_returns_the_id(
    meta_app_credentials: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A successful call returns the Meta user's id."""
    _mock_client_returning(monkeypatch, _FakeResponse({"id": "meta-user-1"}))

    user_id = await meta.get_meta_user_id("some-token")

    assert user_id == "meta-user-1"


@pytest.mark.asyncio
async def test_list_ad_accounts_returns_parsed_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the ad accounts, parsed into MetaAdAccount."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {"id": "act_1", "name": "Acme Ads"},
                    {"id": "act_2", "name": "Other"},
                ]
            }
        ),
    )

    accounts = await meta.list_ad_accounts("some-token")

    assert [a.id for a in accounts] == ["act_1", "act_2"]
    assert accounts[0].name == "Acme Ads"


@pytest.mark.asyncio
async def test_list_pages_returns_parsed_pages(monkeypatch: pytest.MonkeyPatch) -> None:
    """A successful call returns the Pages, parsed into MetaPage."""
    _mock_client_returning(
        monkeypatch, _FakeResponse({"data": [{"id": "page_1", "name": "Acme Jewelry"}]})
    )

    pages = await meta.list_pages("some-token")

    assert pages == [MetaPage(id="page_1", name="Acme Jewelry")]


@pytest.mark.asyncio
async def test_get_json_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A network failure surfaces as MetaConnectionError, not a raw exception."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.list_pages("some-token")


@pytest.mark.asyncio
async def test_get_json_raises_on_error_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Meta {"error": ...} body surfaces as MetaConnectionError with its message."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {"error": {"message": "Invalid OAuth access token"}}, is_error=True
        ),
    )

    with pytest.raises(meta.MetaConnectionError, match="Invalid OAuth access token"):
        await meta.list_pages("some-token")
