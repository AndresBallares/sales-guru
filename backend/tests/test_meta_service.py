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

    async def post(self, url: str, data: dict[str, str]) -> _FakeResponse:
        self.calls.append((url, data))
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


@pytest.mark.asyncio
async def test_post_json_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A network failure on a POST call also surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.create_meta_campaign(
            access_token="token",
            ad_account_id="act_1",
            name="Campaign",
            objective="SALES",
        )


@pytest.mark.asyncio
async def test_post_json_raises_on_error_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Meta {"error": ...} body on a POST call also surfaces with its message."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse({"error": {"message": "Invalid parameter"}}, is_error=True),
    )

    with pytest.raises(meta.MetaConnectionError, match="Invalid parameter"):
        await meta.create_meta_campaign(
            access_token="token",
            ad_account_id="act_1",
            name="Campaign",
            objective="SALES",
        )


@pytest.mark.asyncio
async def test_create_meta_campaign_returns_the_new_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the new campaign id, objective mapped correctly."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "campaign_123"}))

    campaign_id = await meta.create_meta_campaign(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        objective="SALES",
    )

    assert campaign_id == "campaign_123"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_act_1/campaigns"
    assert data["objective"] == "OUTCOME_SALES"
    assert data["status"] == "ACTIVE"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_create_meta_ad_set_returns_the_new_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the new Meta ad set id, targeting encoded as JSON."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    ad_set_id = await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
    )

    assert ad_set_id == "adset_123"
    _url, data = client.calls[0]
    assert data["campaign_id"] == "campaign_123"
    assert data["daily_budget"] == "2500"
    assert data["optimization_goal"] == "OFFSITE_CONVERSIONS"
    assert '"age_min": 30' in data["targeting"]
    assert '"age_max": 55' in data["targeting"]


@pytest.mark.asyncio
async def test_create_meta_ad_creative_includes_the_image_when_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A creative with an image URL includes it in link_data.picture."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "creative_123"}))

    creative_id = await meta.create_meta_ad_creative(
        access_token="token",
        ad_account_id="act_1",
        page_id="page_1",
        name="Creative A",
        headline="As Unique As Your Story",
        body_text="No two stories are the same",
        description="Custom handmade emerald jewelry",
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        image_url="https://acme.example/ring.jpg",
    )

    assert creative_id == "creative_123"
    _url, data = client.calls[0]
    assert '"picture": "https://acme.example/ring.jpg"' in data["object_story_spec"]
    assert '"page_id": "page_1"' in data["object_story_spec"]


@pytest.mark.asyncio
async def test_create_meta_ad_creative_omits_picture_without_an_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No image generated yet (PRD.md §2 step 4) still gives a valid creative call."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "creative_123"}))

    await meta.create_meta_ad_creative(
        access_token="token",
        ad_account_id="act_1",
        page_id="page_1",
        name="Creative A",
        headline="As Unique As Your Story",
        body_text="No two stories are the same",
        description="Custom handmade emerald jewelry",
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        image_url=None,
    )

    _url, data = client.calls[0]
    assert "picture" not in data["object_story_spec"]


@pytest.mark.asyncio
async def test_create_meta_ad_returns_the_new_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the new Meta ad id, referencing the creative."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "ad_123"}))

    ad_id = await meta.create_meta_ad(
        access_token="token",
        ad_account_id="act_1",
        name="Creative A",
        meta_ad_set_id="adset_123",
        meta_creative_id="creative_123",
    )

    assert ad_id == "ad_123"
    _url, data = client.calls[0]
    assert data["adset_id"] == "adset_123"
    assert '"creative_id": "creative_123"' in data["creative"]
    assert data["status"] == "ACTIVE"


@pytest.mark.asyncio
async def test_fetch_campaign_insights_parses_the_first_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Numeric fields (often strings from Meta) are parsed, actions summed."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "50",
                        "spend": "12.50",
                        "actions": [
                            {"action_type": "link_click", "value": "10"},
                            {"action_type": "offsite_conversion", "value": "3"},
                        ],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.impressions == 1000
    assert insights.clicks == 50
    assert insights.spend == 12.5
    assert insights.conversions == 13


@pytest.mark.asyncio
async def test_fetch_campaign_insights_returns_zeros_with_no_delivery_yet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A campaign with no delivery data yet returns zeros, not an error."""
    _mock_client_returning(monkeypatch, _FakeResponse({"data": []}))

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights == meta.CampaignInsights(
        impressions=0, clicks=0, spend=0.0, conversions=0
    )


@pytest.mark.asyncio
async def test_fetch_campaign_insights_handles_no_actions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A row with impressions/clicks but no actions yet has zero conversions."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {"data": [{"impressions": "500", "clicks": "5", "spend": "1.00"}]}
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.conversions == 0


@pytest.mark.asyncio
async def test_fetch_campaign_insights_raises_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.fetch_campaign_insights(
            access_token="token", meta_campaign_id="campaign_123"
        )
