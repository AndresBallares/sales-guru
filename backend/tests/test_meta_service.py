"""Tests for the Meta Ads connection service.

httpx.AsyncClient is mocked throughout — no test here makes a real network
call to Meta's Graph API.
"""

import base64
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from app.core.config import get_settings
from app.schemas.meta import MetaAdAccount, MetaPage, MetaPixel
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
    """No Meta app configured raises a clear error, not a crash.

    Set to "" rather than deleted — Settings reads .env directly (not just
    os.environ, see app/core/config.py), so delenv alone doesn't hide a
    real key that's actually present in .env; an explicit empty env var
    does, since it outranks the dotenv source.
    """
    monkeypatch.setenv("META_APP_ID", "")
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
    """No Meta app configured raises a clear error before any network call.

    Set to "" rather than deleted — Settings reads .env directly (not just
    os.environ, see app/core/config.py), so delenv alone doesn't hide a
    real key that's actually present in .env; an explicit empty env var
    does, since it outranks the dotenv source.
    """
    monkeypatch.setenv("META_APP_ID", "")
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
async def test_list_ad_pixels_returns_parsed_pixels(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the ad account's Pixels, parsed into MetaPixel."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse({"data": [{"id": "pixel_1", "name": "venzi jewelry"}]}),
    )

    pixels = await meta.list_ad_pixels("some-token", "act_1")

    assert pixels == [MetaPixel(id="pixel_1", name="venzi jewelry")]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adspixels"
    assert params["access_token"] == "some-token"


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
    # ad_account_id already carries Meta's own "act_" prefix (that's the
    # literal `id` field /me/adaccounts returns) — never re-added here, or
    # it'd double up to "act_act_1".
    assert url == "https://graph.facebook.com/v21.0/act_1/campaigns"
    assert data["objective"] == "OUTCOME_SALES"
    assert data["status"] == "ACTIVE"
    assert data["access_token"] == "token"
    assert data["is_adset_budget_sharing_enabled"] == "false"


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
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adsets"
    assert data["campaign_id"] == "campaign_123"
    assert data["daily_budget"] == "2500"
    assert data["optimization_goal"] == "OFFSITE_CONVERSIONS"
    assert data["bid_strategy"] == "LOWEST_COST_WITHOUT_CAP"
    assert '"age_min": 30' in data["targeting"]
    assert '"age_max": 55' in data["targeting"]
    assert '"targeting_automation": {"advantage_audience": 0}' in data["targeting"]
    assert '"geo_locations": {"countries": ["US"]}' in data["targeting"]
    assert "promoted_object" not in data
    assert "end_time" not in data
    assert "bid_amount" not in data


@pytest.mark.asyncio
async def test_create_meta_ad_set_uses_cost_cap_when_a_target_cac_is_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A given target_cac_cents switches bid_strategy to COST_CAP with that
    bid_amount."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Vegas Bridal Push",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        target_cac_cents=5500,
    )

    _url, data = client.calls[0]
    assert data["bid_strategy"] == "COST_CAP"
    assert data["bid_amount"] == "5500"


@pytest.mark.asyncio
async def test_create_meta_ad_set_sends_end_time_as_iso8601_utc_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A given end_time is sent as Meta's documented ISO 8601 UTC format."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Vegas Bridal Push",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        end_time=datetime(2026, 3, 24, 23, 59, 59, tzinfo=UTC),
    )

    _url, data = client.calls[0]
    assert data["end_time"] == "2026-03-24T23:59:59+0000"


@pytest.mark.asyncio
async def test_create_meta_ad_set_targets_a_custom_location_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A custom_location replaces the default country geo entirely with a
    radius around the given lat/lng (PRD.md build step 11)."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="JCK Las Vegas push",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        custom_location=meta.CustomLocation(
            lat=36.1299, lng=-115.1529, radius_miles=10.0
        ),
    )

    _url, data = client.calls[0]
    assert '"countries"' not in data["targeting"]
    assert '"latitude": 36.1299' in data["targeting"]
    assert '"longitude": -115.1529' in data["targeting"]
    assert '"radius": 10.0' in data["targeting"]
    assert '"distance_unit": "mile"' in data["targeting"]


@pytest.mark.asyncio
async def test_create_meta_ad_set_targets_resolved_cities_and_regions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """resolved_locations replaces the default country geo entirely with
    cities/regions, split by type (PRD.md build step 5, geo-taxonomy
    resolution)."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        resolved_locations=[
            meta.ResolvedGeoLocation(key="2490299", type="city"),
            meta.ResolvedGeoLocation(key="3886", type="region"),
        ],
    )

    _url, data = client.calls[0]
    assert '"countries"' not in data["targeting"]
    assert '"cities": [{"key": "2490299"}]' in data["targeting"]
    assert '"regions": [{"key": "3886"}]' in data["targeting"]


@pytest.mark.asyncio
async def test_create_meta_ad_set_includes_interests_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Already-resolved interests are added to the real targeting spec."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        interests=[{"id": "6003266225248", "name": "Jewelry"}],
    )

    _url, data = client.calls[0]
    assert (
        '"interests": [{"id": "6003266225248", "name": "Jewelry"}]' in data["targeting"]
    )


@pytest.mark.asyncio
async def test_create_meta_ad_set_targets_a_region_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A region with no city resolved sends only regions, no cities key at all."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        resolved_locations=[meta.ResolvedGeoLocation(key="3886", type="region")],
    )

    _url, data = client.calls[0]
    assert '"cities"' not in data["targeting"]
    assert '"regions": [{"key": "3886"}]' in data["targeting"]


@pytest.mark.asyncio
async def test_create_meta_ad_set_defaults_to_broad_us_without_any_geo_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Neither custom_location nor resolved_locations given keeps the
    original default broad-US targeting."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        resolved_locations=[],
    )

    _url, data = client.calls[0]
    assert '"geo_locations": {"countries": ["US"]}' in data["targeting"]


@pytest.mark.asyncio
async def test_search_ad_geolocations_returns_the_raw_result_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A search hits the real endpoint shape and returns Meta's data list."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "key": "2490299",
                        "name": "New York",
                        "type": "city",
                        "country_code": "US",
                        "region": "New York",
                    }
                ]
            }
        ),
    )

    results = await meta.search_ad_geolocations(
        access_token="token", query="New York", location_type="city"
    )

    assert results == [
        {
            "key": "2490299",
            "name": "New York",
            "type": "city",
            "country_code": "US",
            "region": "New York",
        }
    ]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/search"
    assert params["type"] == "adgeolocation"
    assert params["location_types"] == '["city"]'
    assert params["q"] == "New York"
    assert params["access_token"] == "token"


@pytest.mark.asyncio
async def test_create_meta_ad_set_includes_promoted_object_with_a_pixel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A pixel_id builds promoted_object with a fixed PURCHASE event type.

    Real API behavior confirmed 2026-08-29: OFFSITE_CONVERSIONS requires
    this — see app/services/publish.py's requires_pixel.
    """
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        meta_campaign_id="campaign_123",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        pixel_id="pixel_1",
    )

    _url, data = client.calls[0]
    assert '"pixel_id": "pixel_1"' in data["promoted_object"]
    assert '"custom_event_type": "PURCHASE"' in data["promoted_object"]


@pytest.mark.asyncio
async def test_create_meta_ad_creative_includes_the_image_when_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A creative with an image hash includes it in link_data.image_hash,
    not a bare link_data.picture URL (confirmed 2026-09-09 — Meta's own
    real-ad-image mechanism, see upload_meta_ad_image)."""
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
        image_hash="abc123hash",
    )

    assert creative_id == "creative_123"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adcreatives"
    assert '"image_hash": "abc123hash"' in data["object_story_spec"]
    assert "picture" not in data["object_story_spec"]
    assert '"page_id": "page_1"' in data["object_story_spec"]


@pytest.mark.asyncio
async def test_create_meta_ad_creative_omits_image_hash_without_an_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A campaign with no product photo still gives a valid, link-only
    creative call."""
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
        image_hash=None,
    )

    _url, data = client.calls[0]
    assert "image_hash" not in data["object_story_spec"]
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
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/ads"
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
    assert insights.conversion_rate == 13 / 50


@pytest.mark.asyncio
async def test_fetch_ad_set_insights_hits_the_ad_set_object_and_parses_the_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same shared parsing as fetch_campaign_insights, scoped to one AdSet's
    own /insights edge (PRD.md build step 10, per-AdSet metric collection)."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "500",
                        "clicks": "20",
                        "spend": "5.00",
                        "actions": [],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_ad_set_insights(
        access_token="token", meta_ad_set_id="adset_123"
    )

    assert insights.impressions == 500
    assert insights.spend == 5.0
    url, _params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/adset_123/insights"


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
async def test_fetch_campaign_insights_returns_none_extended_fields_with_no_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No delivery data means every extended field is None, not zero — a
    genuinely different fact (unavailable) from "collected and was zero"."""
    _mock_client_returning(monkeypatch, _FakeResponse({"data": []}))

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.reach is None
    assert insights.cpm is None
    assert insights.ctr is None
    assert insights.cpc is None
    assert insights.landing_page_views is None
    assert insights.add_to_cart is None
    assert insights.add_to_cart_rate is None
    assert insights.conversion_rate is None
    assert insights.cac is None
    assert insights.purchase_value is None
    assert insights.roas is None


@pytest.mark.asyncio
async def test_fetch_campaign_insights_passes_through_reach_cpm_ctr_cpc(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """reach/cpm/ctr/cpc come straight from Meta, no re-derivation."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "reach": "800",
                        "clicks": "50",
                        "spend": "12.50",
                        "cpm": "12.50",
                        "ctr": "5.0",
                        "cpc": "0.25",
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.reach == 800
    assert insights.cpm == 12.5
    assert insights.ctr == 5.0
    assert insights.cpc == 0.25


@pytest.mark.asyncio
async def test_fetch_campaign_insights_computes_add_to_cart_rate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """add_to_cart_rate = add_to_cart / landing_page_views, not / clicks."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "12.50",
                        "actions": [
                            {"action_type": "landing_page_view", "value": "40"},
                            {"action_type": "add_to_cart", "value": "10"},
                        ],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.landing_page_views == 40
    assert insights.add_to_cart == 10
    assert insights.add_to_cart_rate == 0.25


@pytest.mark.asyncio
async def test_fetch_campaign_insights_add_to_cart_rate_none_with_no_landing_views(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No landing page views means the rate can't be computed — None, not 0."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "12.50",
                        "actions": [{"action_type": "link_click", "value": "5"}],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.landing_page_views == 0
    assert insights.add_to_cart_rate is None


@pytest.mark.asyncio
async def test_fetch_campaign_insights_computes_cac_and_roas_from_purchases_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """cac/roas use only purchase-specific actions, not the broader
    conversions figure (link clicks/leads mixed in would be misleading)."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "100.00",
                        "actions": [
                            {"action_type": "link_click", "value": "50"},
                            {"action_type": "purchase", "value": "4"},
                        ],
                        "action_values": [
                            {"action_type": "purchase", "value": "800.00"}
                        ],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.purchase_value == 800.0
    assert insights.cac == 25.0  # $100 spend / 4 purchases
    assert insights.roas == 8.0  # $800 revenue / $100 spend


@pytest.mark.asyncio
async def test_fetch_campaign_insights_cac_and_roas_none_with_no_purchases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No purchase actions means cac/roas can't be computed — None, not
    a divide-by-zero or a misleading number from unrelated actions."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "100.00",
                        "actions": [{"action_type": "link_click", "value": "50"}],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.cac is None
    assert insights.purchase_value is None
    assert insights.roas is None


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


@pytest.mark.asyncio
async def test_fetch_account_historical_performance_parses_each_campaign_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every campaign row on the account is parsed, actions summed per row."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "campaign_name": "Spring Sale",
                        "impressions": "5000",
                        "clicks": "200",
                        "spend": "150.00",
                        "actions": [
                            {"action_type": "link_click", "value": "40"},
                            {"action_type": "purchase", "value": "5"},
                        ],
                    },
                    {
                        "campaign_name": "Holiday Push",
                        "impressions": "9000",
                        "clicks": "300",
                        "spend": "400.00",
                    },
                ]
            }
        ),
    )

    rows = await meta.fetch_account_historical_performance(
        access_token="token", ad_account_id="act_1"
    )

    assert rows == [
        meta.AccountCampaignInsights(
            campaign_name="Spring Sale",
            impressions=5000,
            clicks=200,
            spend=150.0,
            conversions=45,
        ),
        meta.AccountCampaignInsights(
            campaign_name="Holiday Push",
            impressions=9000,
            clicks=300,
            spend=400.0,
            conversions=0,
        ),
    ]


@pytest.mark.asyncio
async def test_fetch_account_historical_performance_skips_nameless_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A row Meta didn't attach a campaign_name to isn't useful grounding."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {"data": [{"impressions": "100", "clicks": "1", "spend": "1.0"}]}
        ),
    )

    rows = await meta.fetch_account_historical_performance(
        access_token="token", ad_account_id="act_1"
    )

    assert rows == []


@pytest.mark.asyncio
async def test_fetch_account_historical_performance_returns_empty_with_no_history(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A freshly-connected account with no prior campaigns returns an empty list."""
    _mock_client_returning(monkeypatch, _FakeResponse({"data": []}))

    rows = await meta.fetch_account_historical_performance(
        access_token="token", ad_account_id="act_1"
    )

    assert rows == []


@pytest.mark.asyncio
async def test_fetch_account_historical_performance_raises_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.fetch_account_historical_performance(
            access_token="token", ad_account_id="act_1"
        )


def test_has_meaningful_history_true_when_any_campaign_has_spend() -> None:
    """Any real spend at all counts — no dollar threshold (see docstring)."""
    rows = [
        meta.AccountCampaignInsights(
            campaign_name="Spring Sale",
            impressions=0,
            clicks=0,
            spend=0.0,
            conversions=0,
        ),
        meta.AccountCampaignInsights(
            campaign_name="Holiday Push",
            impressions=10,
            clicks=1,
            spend=5.0,
            conversions=0,
        ),
    ]

    assert meta.has_meaningful_history(rows) is True


def test_has_meaningful_history_false_with_no_spend_or_no_rows() -> None:
    """Zero spend across every row, or no rows at all, means no real history."""
    assert meta.has_meaningful_history([]) is False
    assert (
        meta.has_meaningful_history(
            [
                meta.AccountCampaignInsights(
                    campaign_name="Spring Sale",
                    impressions=0,
                    clicks=0,
                    spend=0.0,
                    conversions=0,
                )
            ]
        )
        is False
    )


@pytest.mark.asyncio
async def test_pause_meta_ad_sends_the_paused_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pausing an ad POSTs status=PAUSED to the ad's own node."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await meta.pause_meta_ad(access_token="token", meta_ad_id="ad_123")

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/ad_123"
    assert data["status"] == "PAUSED"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_pause_meta_ad_raises_on_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.pause_meta_ad(access_token="token", meta_ad_id="ad_123")


@pytest.mark.asyncio
async def test_pause_meta_ad_set_sends_the_paused_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Pausing an ad set POSTs status=PAUSED to the ad set's own node."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await meta.pause_meta_ad_set(access_token="token", meta_ad_set_id="adset_123")

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/adset_123"
    assert data["status"] == "PAUSED"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_pause_meta_ad_set_raises_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.pause_meta_ad_set(access_token="token", meta_ad_set_id="adset_123")


@pytest.mark.asyncio
async def test_update_meta_ad_set_budget_sends_the_new_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Updating the budget POSTs the new daily_budget to the ad set's own node."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await meta.update_meta_ad_set_budget(
        access_token="token", meta_ad_set_id="adset_123", daily_budget_cents=4000
    )

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/adset_123"
    assert data["daily_budget"] == "4000"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_update_meta_ad_set_budget_raises_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.update_meta_ad_set_budget(
            access_token="token", meta_ad_set_id="adset_123", daily_budget_cents=4000
        )


@pytest.mark.asyncio
async def test_search_ad_interests_returns_the_raw_result_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A search hits the real endpoint shape and returns Meta's data list."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "id": "6002969885729",
                        "name": "Engagement ring",
                        "audience_size_lower_bound": 55933936,
                        "audience_size_upper_bound": 65778309,
                    }
                ]
            }
        ),
    )

    results = await meta.search_ad_interests(
        access_token="token", query="engagement rings"
    )

    assert results == [
        {
            "id": "6002969885729",
            "name": "Engagement ring",
            "audience_size_lower_bound": 55933936,
            "audience_size_upper_bound": 65778309,
        }
    ]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/search"
    assert params["type"] == "adinterest"
    assert params["q"] == "engagement rings"
    assert params["access_token"] == "token"


@pytest.mark.asyncio
async def test_validate_ad_interests_sends_the_fbid_list_param(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Uses interest_fbid_list (not interest_list — a real API quirk, see
    the function's own docstring) and returns Meta's raw validity list."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {"id": "6002969885729", "valid": True, "audience_size": 60000000}
                ]
            }
        ),
    )

    results = await meta.validate_ad_interests(
        access_token="token", meta_ids=["6002969885729"]
    )

    assert results == [
        {"id": "6002969885729", "valid": True, "audience_size": 60000000}
    ]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/search"
    assert params["type"] == "adinterestvalid"
    assert params["interest_fbid_list"] == '["6002969885729"]'
    assert params["access_token"] == "token"


# Fake mode (Settings.fake_meta_enabled, confirmed 2026-09-09) — every
# function below returns a canned response and never touches
# httpx.AsyncClient at all; each test proves that by making the real
# path (were it reached) raise instead of quietly succeeding or hanging
# on a real network call.
@pytest.fixture
def fake_meta_mode(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Turn on fake_meta_enabled and make any real HTTP call blow up loudly."""
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda: _FakeAsyncClient(
            error=AssertionError("must not call the real Graph API in fake mode")
        ),
    )
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_list_ad_accounts_returns_a_canned_account_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns one canned ad account, no real call."""
    accounts = await meta.list_ad_accounts("fake-token")

    assert accounts == [MetaAdAccount(id="act_fake_account", name="Fake Ad Account")]


@pytest.mark.asyncio
async def test_list_pages_returns_a_canned_page_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns one canned Page, no real call."""
    pages = await meta.list_pages("fake-token")

    assert pages == [MetaPage(id="fake_page", name="Fake Page")]


@pytest.mark.asyncio
async def test_list_ad_pixels_returns_a_canned_pixel_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns one canned Pixel, no real call."""
    pixels = await meta.list_ad_pixels("fake-token", "act_fake_account")

    assert pixels == [MetaPixel(id="fake_pixel", name="Fake Pixel")]


@pytest.mark.asyncio
async def test_create_meta_campaign_returns_a_fake_id_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake campaign id, no real call."""
    campaign_id = await meta.create_meta_campaign(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        name="Some campaign",
        objective="SALES",
    )

    assert campaign_id.startswith("fake_campaign_")


@pytest.mark.asyncio
async def test_create_meta_ad_set_returns_a_fake_id_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake ad set id, no real call."""
    ad_set_id = await meta.create_meta_ad_set(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        name="Some ad set",
        meta_campaign_id="fake_campaign_abc",
        daily_budget_cents=2500,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
    )

    assert ad_set_id.startswith("fake_adset_")


@pytest.mark.asyncio
async def test_create_meta_ad_creative_returns_a_fake_id_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake creative id, no real call."""
    creative_id = await meta.create_meta_ad_creative(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        page_id="fake_page",
        name="Creative A",
        headline="Headline",
        body_text="Body",
        description="Description",
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        image_hash=None,
    )

    assert creative_id.startswith("fake_creative_")


@pytest.mark.asyncio
async def test_upload_meta_ad_image_returns_the_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful upload returns the hash Meta assigned the image, and
    sends the base64-encoded bytes under the "bytes" form param."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse({"images": {"image": {"hash": "img_hash_123", "url": "..."}}}),
    )

    image_hash = await meta.upload_meta_ad_image(
        access_token="token", ad_account_id="act_1", image_data=b"fake jpeg bytes"
    )

    assert image_hash == "img_hash_123"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adimages"
    sent = json.loads(data["bytes"])
    assert base64.b64decode(sent["image"]) == b"fake jpeg bytes"


@pytest.mark.asyncio
async def test_upload_meta_ad_image_returns_a_fake_hash_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake hash, no real call."""
    image_hash = await meta.upload_meta_ad_image(
        access_token="fake-token", ad_account_id="act_fake_account", image_data=b"bytes"
    )

    assert image_hash.startswith("fake_image_hash_")


@pytest.mark.asyncio
async def test_create_meta_ad_returns_a_fake_id_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake ad id, no real call."""
    ad_id = await meta.create_meta_ad(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        name="Creative A",
        meta_ad_set_id="fake_adset_abc",
        meta_creative_id="fake_creative_abc",
    )

    assert ad_id.startswith("fake_ad_")


@pytest.mark.asyncio
async def test_fetch_campaign_insights_returns_canned_empty_metrics_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns all-zero/all-None metrics — the "no delivery data"
    shape — so downstream jobs (app/services/optimization_jobs.py) and the
    upcoming delete feature can be e2e-tested against a fake campaign."""
    insights = await meta.fetch_campaign_insights(
        access_token="fake-token", meta_campaign_id="fake_campaign_abc"
    )

    assert insights == meta.CampaignInsights(
        impressions=0, clicks=0, spend=0.0, conversions=0
    )


@pytest.mark.asyncio
async def test_fetch_ad_set_insights_returns_canned_empty_metrics_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Same canned-empty shape as fetch_campaign_insights, scoped to an AdSet."""
    insights = await meta.fetch_ad_set_insights(
        access_token="fake-token", meta_ad_set_id="fake_adset_abc"
    )

    assert insights == meta.CampaignInsights(
        impressions=0, clicks=0, spend=0.0, conversions=0
    )


@pytest.mark.asyncio
async def test_fetch_account_historical_performance_returns_empty_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """A fake ad account has no history — steers the Strategist toward
    TEST_PLAN deterministically, rather than depending on a real account."""
    rows = await meta.fetch_account_historical_performance(
        access_token="fake-token", ad_account_id="act_fake_account"
    )

    assert rows == []


@pytest.mark.asyncio
async def test_pause_meta_ad_is_a_no_op_in_fake_mode(fake_meta_mode: None) -> None:
    """Fake mode pauses nothing for real — just returns."""
    await meta.pause_meta_ad(access_token="fake-token", meta_ad_id="fake_ad_abc")


@pytest.mark.asyncio
async def test_pause_meta_ad_set_is_a_no_op_in_fake_mode(fake_meta_mode: None) -> None:
    """Fake mode pauses nothing for real — just returns."""
    await meta.pause_meta_ad_set(
        access_token="fake-token", meta_ad_set_id="fake_adset_abc"
    )


@pytest.mark.asyncio
async def test_update_meta_ad_set_budget_is_a_no_op_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode updates nothing for real — just returns."""
    await meta.update_meta_ad_set_budget(
        access_token="fake-token",
        meta_ad_set_id="fake_adset_abc",
        daily_budget_cents=4000,
    )


@pytest.mark.asyncio
async def test_search_ad_geolocations_returns_a_resolvable_fake_match_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns one always-resolvable US match, for any query — so
    app/services/geo.py's resolve_target_location never fails on a fake
    connection, however the AI-generated strategy happened to phrase a
    location."""
    results = await meta.search_ad_geolocations(
        access_token="fake-token", query="Springfield", location_type="city"
    )

    assert len(results) == 1
    assert results[0]["country_code"] == "US"
    assert results[0]["key"]
