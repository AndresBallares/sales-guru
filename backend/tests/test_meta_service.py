"""Tests for the Meta Ads connection service.

httpx.AsyncClient is mocked throughout — no test here makes a real network
call to Meta's Graph API.
"""

import asyncio
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
        # Only appended by post() when it's given a files= kwarg (the
        # multipart upload_meta_ad_image call) — kept as a parallel list
        # rather than widening calls' tuple shape, since ~20 existing
        # tests destructure client.calls[0] as a plain (url, data) pair.
        self.post_files: list[dict[str, Any] | None] = []

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

    async def post(
        self,
        url: str,
        data: dict[str, str],
        files: dict[str, Any] | None = None,
    ) -> _FakeResponse:
        self.calls.append((url, data))
        self.post_files.append(files)
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _mock_client_returning(
    monkeypatch: pytest.MonkeyPatch, response: _FakeResponse
) -> _FakeAsyncClient:
    """Patch httpx.AsyncClient to return a canned response, return the fake client."""
    fake_client = _FakeAsyncClient(response=response)
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake_client)
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
async def test_post_json_error_includes_the_endpoint_and_metas_full_diagnosis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The raised message names which endpoint failed and surfaces Meta's
    error_user_msg/error_subcode/fbtrace_id when present (confirmed
    2026-09-09) — error.message alone is often a generic phrase ("Invalid
    parameter") shared by many distinct real causes, and not knowing even
    which of ~5 publish-time Graph calls failed made a real first-live-
    publish failure hard to diagnose."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "error": {
                    "message": "Invalid parameter",
                    "error_user_msg": "The image format is not supported",
                    "error_subcode": 1234567,
                    "fbtrace_id": "AbCdEfGhIjK",
                }
            },
            is_error=True,
        ),
    )

    with pytest.raises(meta.MetaConnectionError) as exc_info:
        await meta.create_meta_campaign(
            access_token="token",
            ad_account_id="act_1",
            name="Campaign",
            objective="SALES",
        )

    message = str(exc_info.value)
    assert "act_1/campaigns" in message
    assert "Invalid parameter" in message
    assert "The image format is not supported" in message
    assert "1234567" in message
    assert "AbCdEfGhIjK" in message
    assert exc_info.value.error_subcode == 1234567


@pytest.mark.asyncio
async def test_raised_error_carries_metas_code_as_a_structured_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """error.code lands on MetaConnectionError.code, not just in the
    formatted message string — is_business_tools_terms_error (and any
    future caller that needs to distinguish specific Graph errors) reads
    this field directly rather than parsing text."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "error": {
                    "message": "Terms of service has not been accepted",
                    "code": 2655,
                }
            },
            is_error=True,
        ),
    )

    with pytest.raises(meta.MetaConnectionError) as exc_info:
        await meta.create_meta_campaign(
            access_token="token",
            ad_account_id="act_1",
            name="Campaign",
            objective="SALES",
        )

    assert exc_info.value.code == 2655


class TestIsBusinessToolsTermsError:
    """Unit coverage for the Business Tools Terms detection helper itself
    (app/services/meta.py) — separate from the fake-mode/API-mapping
    tests elsewhere, which exercise it end to end."""

    def test_matches_the_confirmed_custom_audience_terms_code(self) -> None:
        exc = meta.MetaConnectionError("some generic message", code=2655)

        assert meta.is_business_tools_terms_error(exc) is True

    def test_matches_the_pixel_terms_wording_with_no_confirmed_code(self) -> None:
        exc = meta.MetaConnectionError(
            "Meta API call to /adspixels failed: "
            "Business has not accepted Pixel Terms of Service"
        )

        assert meta.is_business_tools_terms_error(exc) is True

    def test_match_is_case_insensitive(self) -> None:
        exc = meta.MetaConnectionError(
            "BUSINESS HAS NOT ACCEPTED PIXEL TERMS OF SERVICE"
        )

        assert meta.is_business_tools_terms_error(exc) is True

    def test_does_not_match_an_unrelated_error(self) -> None:
        exc = meta.MetaConnectionError("Invalid OAuth access token", code=190)

        assert meta.is_business_tools_terms_error(exc) is False

    def test_does_not_match_an_error_with_neither_signal(self) -> None:
        exc = meta.MetaConnectionError("Meta API call failed: some network error")

        assert meta.is_business_tools_terms_error(exc) is False


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
async def test_create_meta_campaign_sends_paused_status_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The "Publish paused" option sends status=PAUSED instead of the
    ACTIVE default — nothing spends until a human clicks Activate."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "campaign_123"}))

    await meta.create_meta_campaign(
        access_token="token",
        ad_account_id="act_1",
        name="Custom Colombian Emerald Ring",
        objective="SALES",
        status="PAUSED",
    )

    _url, data = client.calls[0]
    assert data["status"] == "PAUSED"


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
async def test_create_meta_ad_set_sends_paused_status_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The "Publish paused" option sends status=PAUSED instead of the
    ACTIVE default, same as create_meta_campaign."""
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
        status="PAUSED",
    )

    _url, data = client.calls[0]
    assert data["status"] == "PAUSED"


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


@pytest.mark.asyncio
async def test_create_meta_ad_creative_omits_description_when_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A creative with no description slot filled (Part 4, confirmed
    2026-09-12 — not every business has a proof point that fits every
    variant) omits link_data.description entirely, letting Meta
    auto-generate one from the link, rather than sending an empty string."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "creative_123"}))

    await meta.create_meta_ad_creative(
        access_token="token",
        ad_account_id="act_1",
        page_id="page_1",
        name="Creative A",
        headline="As Unique As Your Story",
        body_text="No two stories are the same",
        description=None,
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        image_hash=None,
    )

    _url, data = client.calls[0]
    assert "description" not in data["object_story_spec"]
    assert "picture" not in data["object_story_spec"]


@pytest.mark.asyncio
async def test_create_meta_carousel_ad_creative_builds_child_attachments(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One creative object for the whole carousel, one child_attachment per
    card in list order (matching CreativeCard.position), sharing one
    message/link/call_to_action across every card."""
    client = _mock_client_returning(
        monkeypatch, _FakeResponse({"id": "carousel_creative_123"})
    )

    creative_id = await meta.create_meta_carousel_ad_creative(
        access_token="token",
        ad_account_id="act_1",
        page_id="page_1",
        name="Carousel A",
        body_text="Shop the whole collection",
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        cards=[
            meta.CarouselCard(
                image_hash="hash_1",
                headline="Ring one",
                description="14k gold",
                link="https://acme.example/rings",
            ),
            meta.CarouselCard(
                image_hash="hash_2",
                headline="Ring two",
                description=None,
                link="https://acme.example/rings",
            ),
        ],
    )

    assert creative_id == "carousel_creative_123"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adcreatives"
    spec = json.loads(data["object_story_spec"])
    assert spec["page_id"] == "page_1"
    assert spec["link_data"]["message"] == "Shop the whole collection"
    assert spec["link_data"]["link"] == "https://acme.example/rings"
    assert spec["link_data"]["call_to_action"] == {"type": "SHOP_NOW"}
    attachments = spec["link_data"]["child_attachments"]
    assert len(attachments) == 2
    assert attachments[0] == {
        "link": "https://acme.example/rings",
        "image_hash": "hash_1",
        "name": "Ring one",
        "description": "14k gold",
    }
    # No description key at all when the card has none — same
    # "omit rather than send empty" convention as the single-image path.
    assert attachments[1] == {
        "link": "https://acme.example/rings",
        "image_hash": "hash_2",
        "name": "Ring two",
    }


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
async def test_create_meta_ad_sends_paused_status_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The "Publish paused" option sends status=PAUSED instead of the
    ACTIVE default, same as create_meta_campaign/create_meta_ad_set."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "ad_123"}))

    await meta.create_meta_ad(
        access_token="token",
        ad_account_id="act_1",
        name="Creative A",
        meta_ad_set_id="adset_123",
        meta_creative_id="creative_123",
        status="PAUSED",
    )

    _url, data = client.calls[0]
    assert data["status"] == "PAUSED"


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


def _history_row(name: str, spend: float, clicks: int) -> meta.AccountCampaignInsights:
    return meta.AccountCampaignInsights(
        campaign_name=name,
        impressions=clicks * 50,
        clicks=clicks,
        spend=spend,
        conversions=0,
    )


def test_a_little_spend_is_not_meaningful_history() -> None:
    """A $5 experiment is not "has run ads before": any amount of spend used
    to count, which pushed accounts off the first test on a few dollars."""
    rows = [_history_row("Holiday Push", spend=5.0, clicks=1)]

    assert meta.has_meaningful_history(rows) is False


def test_history_needs_both_enough_spend_and_enough_clicks() -> None:
    assert meta.has_meaningful_history([_history_row("A", 500.0, 300)]) is True
    assert meta.has_meaningful_history([_history_row("A", 499.99, 300)]) is False
    assert meta.has_meaningful_history([_history_row("A", 500.0, 299)]) is False
    # Spend with almost no clicks is a broken or barely-delivered campaign.
    assert meta.has_meaningful_history([_history_row("A", 5000.0, 10)]) is False


def test_history_is_summed_across_the_accounts_campaigns() -> None:
    rows = [
        _history_row("Spring Sale", 300.0, 150),
        _history_row("Holiday Push", 250.0, 200),
    ]

    assert meta.has_meaningful_history(rows) is True


def test_history_thresholds_are_configurable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MEANINGFUL_HISTORY_MIN_SPEND", "50")
    monkeypatch.setenv("MEANINGFUL_HISTORY_MIN_CLICKS", "20")
    get_settings.cache_clear()
    try:
        assert meta.has_meaningful_history([_history_row("A", 60.0, 25)]) is True
        assert meta.has_meaningful_history([_history_row("A", 40.0, 25)]) is False
    finally:
        get_settings.cache_clear()


def test_the_default_history_thresholds_are_500_dollars_and_300_clicks() -> None:
    get_settings.cache_clear()

    assert get_settings().meaningful_history_min_spend == 500.0
    assert get_settings().meaningful_history_min_clicks == 300


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
async def test_resume_meta_ad_set_sends_the_active_status(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Resuming an ad set POSTs status=ACTIVE to the ad set's own node —
    the reverse of pause_meta_ad_set, used by activate_campaign."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await meta.resume_meta_ad_set(access_token="token", meta_ad_set_id="adset_123")

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/adset_123"
    assert data["status"] == "ACTIVE"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_resume_meta_ad_set_raises_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.resume_meta_ad_set(access_token="token", meta_ad_set_id="adset_123")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("func", "kwarg"),
    [
        (meta.resume_meta_campaign, "meta_campaign_id"),
        (meta.resume_meta_ad, "meta_ad_id"),
    ],
)
async def test_resume_campaign_and_ad_send_the_active_status(
    monkeypatch: pytest.MonkeyPatch, func: Any, kwarg: str
) -> None:
    """Resuming a campaign or an ad POSTs status=ACTIVE to its own node."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await func(access_token="token", **{kwarg: "obj_123"})

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/obj_123"
    assert data["status"] == "ACTIVE"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("func", "kwarg"),
    [
        (meta.resume_meta_campaign, "meta_campaign_id"),
        (meta.resume_meta_ad, "meta_ad_id"),
    ],
)
async def test_resume_campaign_and_ad_raise_on_failure(
    monkeypatch: pytest.MonkeyPatch, func: Any, kwarg: str
) -> None:
    """A Graph API failure surfaces as MetaConnectionError."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await func(access_token="token", **{kwarg: "obj_123"})


@pytest.mark.asyncio
async def test_fetch_meta_object_status_reads_the_status_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A read-only GET of the object's own `status`."""
    client = _mock_client_returning(
        monkeypatch, _FakeResponse({"status": "ACTIVE", "id": "ad_1"})
    )

    status = await meta.fetch_meta_object_status(
        access_token="token", meta_object_id="ad_1"
    )

    assert status == "ACTIVE"
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/ad_1"
    assert params == {"access_token": "token", "fields": "status"}


@pytest.mark.asyncio
async def test_fetch_meta_object_status_is_empty_when_meta_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_client_returning(monkeypatch, _FakeResponse({"id": "ad_1"}))

    assert (
        await meta.fetch_meta_object_status(access_token="token", meta_object_id="ad_1")
        == ""
    )


@pytest.mark.asyncio
async def test_resume_and_status_read_are_canned_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode: resumes are no-ops and the read-back says ACTIVE."""
    await meta.resume_meta_campaign(access_token="t", meta_campaign_id="c")
    await meta.resume_meta_ad(access_token="t", meta_ad_id="a")
    assert (
        await meta.fetch_meta_object_status(access_token="t", meta_object_id="a")
        == "ACTIVE"
    )


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
    """Fake mode returns the canned ad account, no real call.

    Also returns a second, deliberately-selectable "Terms Not Accepted"
    ad account (see test_list_ad_pixels_raises_business_tools_terms_error_
    in_fake_mode below) — asserted by membership, not exact list equality,
    so this test doesn't need to change again if a third fake account is
    ever added for a different scenario.
    """
    accounts = await meta.list_ad_accounts("fake-token")

    assert MetaAdAccount(id="act_fake_account", name="Fake Ad Account") in accounts


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
async def test_list_ad_pixels_raises_business_tools_terms_error_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Selecting the "Terms Not Accepted" fake ad account simulates the
    real Business Tools Terms failure end to end — this is what makes
    app/api/meta.py's 409 mapping e2e-testable without a real ad account
    that's actually in that state."""
    with pytest.raises(meta.MetaConnectionError) as exc_info:
        await meta.list_ad_pixels("fake-token", "act_fake_terms_not_accepted")

    assert meta.is_business_tools_terms_error(exc_info.value)


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
async def test_create_meta_carousel_ad_creative_returns_a_fake_id_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake carousel creative id, no real call."""
    creative_id = await meta.create_meta_carousel_ad_creative(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        page_id="fake_page",
        name="Carousel A",
        body_text="Shop the collection",
        cta="SHOP_NOW",
        link="https://acme.example/rings",
        cards=[
            meta.CarouselCard(
                image_hash="hash_1",
                headline="Ring one",
                description=None,
                link="https://acme.example/rings",
            )
        ],
    )

    assert creative_id.startswith("fake_carousel_creative_")


@pytest.mark.asyncio
async def test_upload_meta_ad_image_returns_the_hash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful upload returns the hash Meta assigned the image, sent
    as a real multipart file part with an explicit filename/content-type
    (confirmed 2026-09-09 against a real ad account — see
    upload_meta_ad_image's own docstring for the three failures this
    fixes). The response is keyed by "image.jpeg" (the real filename
    used), not the literal string "image" — confirmed against a real ad
    account that Meta echoes back the filename, not the multipart field
    name; a hardcoded body["images"]["image"] lookup raised an uncaught
    KeyError the moment the filename stopped being literally "image"."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {"images": {"image.jpeg": {"hash": "img_hash_123", "url": "..."}}}
        ),
    )

    image_hash = await meta.upload_meta_ad_image(
        access_token="token",
        ad_account_id="act_1",
        image_data=b"fake jpeg bytes",
        content_type="image/jpeg",
    )

    assert image_hash == "img_hash_123"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adimages"
    assert data == {"access_token": "token"}
    files = client.post_files[0]
    assert files is not None
    assert files["image"] == ("image.jpeg", b"fake jpeg bytes", "image/jpeg")


@pytest.mark.asyncio
async def test_upload_meta_ad_image_allows_time_to_send_and_hear_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The default 5s timeout expired on a real thumbnail upload (found live
    2026-10-08): Meta's adimages endpoint can take a while to answer."""
    fake_client = _FakeAsyncClient(
        response=_FakeResponse({"images": {"image.jpeg": {"hash": "h"}}})
    )
    seen: dict[str, Any] = {}

    def make_client(**kwargs: Any) -> _FakeAsyncClient:
        seen.update(kwargs)
        return fake_client

    monkeypatch.setattr(httpx, "AsyncClient", make_client)

    await meta.upload_meta_ad_image(
        access_token="t",
        ad_account_id="act_1",
        image_data=b"x",
        content_type="image/jpeg",
    )

    assert seen["timeout"].read >= 60
    assert seen["timeout"].write >= 60


@pytest.mark.asyncio
async def test_upload_meta_ad_image_names_the_error_type_when_the_message_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(error=httpx.ReadTimeout("")),
    )

    with pytest.raises(meta.MetaConnectionError, match="ReadTimeout"):
        await meta.upload_meta_ad_image(
            access_token="t",
            ad_account_id="act_1",
            image_data=b"x",
            content_type="image/jpeg",
        )


@pytest.mark.asyncio
async def test_upload_meta_ad_image_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A network failure surfaces as MetaConnectionError — this function
    has its own inline try/except (it can't use _post_json, which doesn't
    support multipart), so it needs its own direct coverage of this path."""
    fake_client = _FakeAsyncClient(error=httpx.ConnectError("boom"))
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: fake_client)

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.upload_meta_ad_image(
            access_token="token",
            ad_account_id="act_1",
            image_data=b"fake jpeg bytes",
            content_type="image/jpeg",
        )


@pytest.mark.asyncio
async def test_upload_meta_ad_image_raises_on_error_response_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Meta {"error": ...} body surfaces with the endpoint and message —
    this is the exact real failure mode confirmed against a live ad
    account 2026-09-09 before the content-type fix (error_subcode
    1487411, "The type of file is not supported")."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "error": {
                    "message": "Invalid parameter",
                    "error_user_msg": "The type of file is not supported.",
                    "error_subcode": 1487411,
                }
            },
            is_error=True,
        ),
    )

    with pytest.raises(meta.MetaConnectionError, match="act_1/adimages") as exc_info:
        await meta.upload_meta_ad_image(
            access_token="token",
            ad_account_id="act_1",
            image_data=b"fake jpeg bytes",
            content_type="image/jpeg",
        )

    assert "1487411" in str(exc_info.value)


@pytest.mark.asyncio
async def test_upload_meta_ad_image_raises_clearly_on_an_empty_images_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A 200 response with no "images" entry at all (not observed for
    real, but not proven impossible either) fails clearly rather than
    with an opaque KeyError/StopIteration — same "flag it, don't crash on
    an unexpected but non-error shape" caution the real KeyError incident
    above (now fixed) shows is worth having here."""
    _mock_client_returning(monkeypatch, _FakeResponse({"images": {}}))

    with pytest.raises(meta.MetaConnectionError, match="no image"):
        await meta.upload_meta_ad_image(
            access_token="token",
            ad_account_id="act_1",
            image_data=b"fake jpeg bytes",
            content_type="image/jpeg",
        )


@pytest.mark.asyncio
async def test_upload_meta_ad_image_returns_a_fake_hash_in_fake_mode(
    fake_meta_mode: None,
) -> None:
    """Fake mode returns a recognizably-fake hash, no real call."""
    image_hash = await meta.upload_meta_ad_image(
        access_token="fake-token",
        ad_account_id="act_fake_account",
        image_data=b"bytes",
        content_type="image/png",
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
async def test_resume_meta_ad_set_is_a_no_op_in_fake_mode(fake_meta_mode: None) -> None:
    """Fake mode resumes nothing for real — just returns."""
    await meta.resume_meta_ad_set(
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


# ── Locales lookup + Advantage+ ad set payload (creative-first Stage 2) ──


@pytest.mark.asyncio
async def test_search_ad_locales_returns_the_raw_result_list(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Targeting Search with type=adlocale (confirmed against the real API
    2026-10-06: English returns US 6, UK 24, All 1001)."""
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {"name": "English (US)", "key": 6},
                    {"name": "English (All)", "key": 1001},
                ]
            }
        ),
    )

    results = await meta.search_ad_locales(access_token="token", query="English")

    assert results == [
        {"name": "English (US)", "key": 6},
        {"name": "English (All)", "key": 1001},
    ]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/search"
    assert params["type"] == "adlocale"
    assert params["q"] == "English"
    assert params["access_token"] == "token"


@pytest.mark.asyncio
async def test_search_ad_locales_returns_a_resolvable_fake_match_in_fake_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        results = await meta.search_ad_locales(access_token="token", query="English")
    finally:
        get_settings.cache_clear()

    assert results == [{"name": "English (All)", "key": 1001}]


@pytest.mark.asyncio
async def test_create_meta_ad_set_sends_locales_when_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Creative test",
        meta_campaign_id="campaign_123",
        daily_budget_cents=5000,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=18,
        age_max=None,
        advantage_audience=1,
        locales=[1001, 1002],
    )

    _url, data = client.calls[0]
    targeting = json.loads(data["targeting"])
    assert targeting["locales"] == [1001, 1002]
    assert targeting["targeting_automation"] == {"advantage_audience": 1}


@pytest.mark.asyncio
async def test_create_meta_ad_set_omits_age_max_and_locales_when_not_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Meta rejects an age_max when Advantage+ audience is on (it is fixed
    at 65), so a caller can leave it out entirely."""
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Creative test",
        meta_campaign_id="campaign_123",
        daily_budget_cents=5000,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=18,
        age_max=None,
        advantage_audience=1,
    )

    _url, data = client.calls[0]
    targeting = json.loads(data["targeting"])
    assert "age_max" not in targeting
    assert "locales" not in targeting


@pytest.mark.asyncio
async def test_create_meta_ad_set_uses_the_given_custom_event_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Creative test",
        meta_campaign_id="campaign_123",
        daily_budget_cents=5000,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=18,
        age_max=None,
        pixel_id="pixel_1",
        custom_event_type="ADD_TO_CART",
    )

    _url, data = client.calls[0]
    assert json.loads(data["promoted_object"]) == {
        "pixel_id": "pixel_1",
        "custom_event_type": "ADD_TO_CART",
    }


@pytest.mark.asyncio
async def test_create_meta_ad_set_defaults_the_event_type_to_purchase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "adset_123"}))

    await meta.create_meta_ad_set(
        access_token="token",
        ad_account_id="act_1",
        name="Anything",
        meta_campaign_id="campaign_123",
        daily_budget_cents=5000,
        optimization_goal="OFFSITE_CONVERSIONS",
        age_min=30,
        age_max=55,
        pixel_id="pixel_1",
    )

    _url, data = client.calls[0]
    assert json.loads(data["promoted_object"])["custom_event_type"] == "PURCHASE"


# ── Ad-level insights + cost per add-to-cart (creative-first Stage 3) ──


@pytest.mark.asyncio
async def test_fetch_ad_insights_hits_the_ad_object_and_parses_the_row(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "300",
                        "clicks": "12",
                        "spend": "4.00",
                        "actions": [],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_ad_insights(access_token="token", meta_ad_id="ad_123")

    assert insights.impressions == 300
    assert insights.spend == 4.0
    url, _params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/ad_123/insights"


@pytest.mark.asyncio
async def test_fetch_ad_insights_returns_canned_zeros_in_fake_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        insights = await meta.fetch_ad_insights(access_token="t", meta_ad_id="ad_1")
    finally:
        get_settings.cache_clear()

    assert insights.spend == 0.0
    assert insights.cost_per_add_to_cart is None


@pytest.mark.asyncio
async def test_fetch_insights_computes_cost_per_add_to_cart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """cost_per_add_to_cart = spend / add-to-carts: the creative test's
    primary metric."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "60.00",
                        "actions": [{"action_type": "add_to_cart", "value": "5"}],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.cost_per_add_to_cart == 12.0


@pytest.mark.asyncio
async def test_fetch_insights_cost_per_add_to_cart_is_none_without_add_to_carts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No add-to-carts means the metric is unavailable, never zero or infinite."""
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "impressions": "1000",
                        "clicks": "100",
                        "spend": "60.00",
                        "actions": [
                            {"action_type": "landing_page_view", "value": "40"}
                        ],
                    }
                ]
            }
        ),
    )

    insights = await meta.fetch_campaign_insights(
        access_token="token", meta_campaign_id="campaign_123"
    )

    assert insights.cost_per_add_to_cart is None


@pytest.mark.asyncio
async def test_update_meta_ad_set_bid_posts_the_new_bid_amount(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"success": True}))

    await meta.update_meta_ad_set_bid(
        access_token="token", meta_ad_set_id="adset_1", bid_amount_cents=2500
    )

    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/adset_1"
    assert data["bid_amount"] == "2500"
    assert data["access_token"] == "token"


@pytest.mark.asyncio
async def test_update_meta_ad_set_bid_does_nothing_in_fake_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        await meta.update_meta_ad_set_bid(
            access_token="t", meta_ad_set_id="adset_1", bid_amount_cents=100
        )
    finally:
        get_settings.cache_clear()


# ── Video upload, processing and creative (Stage 2) ──────────


@pytest.mark.asyncio
async def test_upload_meta_video_posts_the_file_to_advideos_and_returns_the_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "vid_1"}))

    video_id = await meta.upload_meta_video(
        access_token="token",
        ad_account_id="act_1",
        video_data=b"movie bytes",
        content_type="video/quicktime",
        name="Spring clip",
    )

    assert video_id == "vid_1"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/advideos"
    assert data == {"access_token": "token", "name": "Spring clip"}
    files = client.post_files[0]
    assert files is not None
    assert files["source"] == ("video.mov", b"movie bytes", "video/quicktime")


@pytest.mark.asyncio
async def test_upload_meta_video_allows_a_slow_large_upload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """httpx's default 5s write timeout killed a real 31MB upload (found live
    2026-10-08); a video upload must be allowed minutes to send."""
    fake_client = _FakeAsyncClient(response=_FakeResponse({"id": "vid_1"}))
    seen: dict[str, Any] = {}

    def make_client(**kwargs: Any) -> _FakeAsyncClient:
        seen.update(kwargs)
        return fake_client

    monkeypatch.setattr(httpx, "AsyncClient", make_client)

    await meta.upload_meta_video(
        access_token="t",
        ad_account_id="act_1",
        video_data=b"x",
        content_type="video/mp4",
        name="n",
    )

    timeout = seen["timeout"]
    assert timeout.write >= 300
    assert timeout.read >= 60
    assert timeout.connect <= 30


@pytest.mark.asyncio
async def test_upload_meta_video_names_the_error_type_when_the_message_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A WriteTimeout has an empty message; the user shouldn't see 'failed: '."""
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(error=httpx.WriteTimeout("")),
    )

    with pytest.raises(meta.MetaConnectionError, match="WriteTimeout"):
        await meta.upload_meta_video(
            access_token="t",
            ad_account_id="act_1",
            video_data=b"x",
            content_type="video/mp4",
            name="n",
        )


@pytest.mark.asyncio
async def test_upload_meta_video_names_an_mp4_by_its_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "vid_1"}))

    await meta.upload_meta_video(
        access_token="t",
        ad_account_id="act_1",
        video_data=b"x",
        content_type="video/mp4",
        name="n",
    )

    assert client.post_files[0] is not None
    assert client.post_files[0]["source"][0] == "video.mp4"


@pytest.mark.asyncio
async def test_upload_meta_video_raises_on_network_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(error=httpx.ConnectError("x")),
    )

    with pytest.raises(meta.MetaConnectionError, match="Meta API call failed"):
        await meta.upload_meta_video(
            access_token="t",
            ad_account_id="act_1",
            video_data=b"x",
            content_type="video/mp4",
            name="n",
        )


@pytest.mark.asyncio
async def test_upload_meta_video_surfaces_metas_rejection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {"error": {"message": "Invalid parameter", "error_user_msg": "Bad codec"}},
            is_error=True,
        ),
    )

    with pytest.raises(meta.MetaConnectionError, match="Bad codec"):
        await meta.upload_meta_video(
            access_token="t",
            ad_account_id="act_1",
            video_data=b"x",
            content_type="video/quicktime",
            name="n",
        )


@pytest.mark.asyncio
async def test_upload_meta_video_rejects_a_response_without_an_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_client_returning(monkeypatch, _FakeResponse({}))

    with pytest.raises(meta.MetaConnectionError, match="no video id"):
        await meta.upload_meta_video(
            access_token="t",
            ad_account_id="act_1",
            video_data=b"x",
            content_type="video/mp4",
            name="n",
        )


class _SequencedClient(_FakeAsyncClient):
    """A client whose successive GETs return successive canned bodies."""

    def __init__(self, bodies: list[dict[str, Any]]) -> None:
        super().__init__(response=_FakeResponse({}))
        self._bodies = bodies
        self.gets = 0

    async def get(self, url: str, params: dict[str, str]) -> _FakeResponse:
        self.calls.append((url, params))
        body = self._bodies[min(self.gets, len(self._bodies) - 1)]
        self.gets += 1
        return _FakeResponse(body)


def _video_status(
    state: str, progress: int | None = None, **extra: Any
) -> dict[str, Any]:
    status: dict[str, Any] = {"video_status": state, **extra}
    if progress is not None:
        status["processing_progress"] = progress
    return {"status": status, "id": "vid_1"}


@pytest.fixture
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    slept: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        slept.append(seconds)

    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    return slept


@pytest.mark.asyncio
async def test_waiting_for_a_video_returns_once_it_is_ready(
    monkeypatch: pytest.MonkeyPatch, no_sleep: list[float]
) -> None:
    client = _SequencedClient(
        [
            _video_status("processing", 10),
            _video_status("processing", 60),
            _video_status("ready"),
        ]
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda: client)
    seen: list[int | None] = []

    await meta.wait_for_meta_video(
        access_token="t",
        video_id="vid_1",
        poll_interval_seconds=2,
        on_progress=seen.append,
    )

    assert client.gets == 3
    assert no_sleep == [2, 2]
    assert seen == [10, 60, None]
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/vid_1"
    assert params == {"access_token": "t", "fields": "status"}


@pytest.mark.asyncio
async def test_waiting_for_a_video_fails_clearly_when_meta_reports_an_error(
    monkeypatch: pytest.MonkeyPatch, no_sleep: list[float]
) -> None:
    client = _SequencedClient(
        [
            _video_status(
                "error",
                processing_phase={
                    "status": "error",
                    "errors": [{"code": 1363030, "message": "Unsupported codec"}],
                },
            )
        ]
    )
    monkeypatch.setattr(httpx, "AsyncClient", lambda: client)

    with pytest.raises(meta.MetaConnectionError, match="Unsupported codec"):
        await meta.wait_for_meta_video(access_token="t", video_id="vid_1")


@pytest.mark.asyncio
async def test_an_errored_video_without_details_still_fails_with_a_message(
    monkeypatch: pytest.MonkeyPatch, no_sleep: list[float]
) -> None:
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda: _SequencedClient([_video_status("error")])
    )

    with pytest.raises(meta.MetaConnectionError, match="could not process"):
        await meta.wait_for_meta_video(access_token="t", video_id="vid_1")


@pytest.mark.asyncio
async def test_waiting_for_a_video_times_out_with_a_clear_message(
    monkeypatch: pytest.MonkeyPatch, no_sleep: list[float]
) -> None:
    client = _SequencedClient([_video_status("processing", 5)])
    monkeypatch.setattr(httpx, "AsyncClient", lambda: client)

    with pytest.raises(meta.MetaConnectionError, match="still processing") as caught:
        await meta.wait_for_meta_video(
            access_token="t",
            video_id="vid_1",
            timeout_seconds=6,
            poll_interval_seconds=2,
        )

    assert "6 seconds" in str(caught.value)
    assert client.gets == 4  # t=0, 2, 4, 6


@pytest.mark.asyncio
async def test_create_meta_video_ad_creative_builds_video_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "creative_9"}))

    creative_id = await meta.create_meta_video_ad_creative(
        access_token="token",
        ad_account_id="act_1",
        page_id="page_1",
        name="Ad name",
        headline="Handmade rings",
        body_text="A ring made for you.",
        description="Free shipping",
        cta="SHOP_NOW",
        link="https://acme.example/ring",
        video_id="vid_1",
        image_hash="thumb_hash",
    )

    assert creative_id == "creative_9"
    url, data = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/act_1/adcreatives"
    assert data["name"] == "Ad name"
    spec = json.loads(data["object_story_spec"])
    assert spec == {
        "page_id": "page_1",
        "video_data": {
            "video_id": "vid_1",
            "image_hash": "thumb_hash",
            "title": "Handmade rings",
            "message": "A ring made for you.",
            "link_description": "Free shipping",
            "call_to_action": {
                "type": "SHOP_NOW",
                "value": {"link": "https://acme.example/ring"},
            },
        },
    }


@pytest.mark.asyncio
async def test_create_meta_video_ad_creative_waits_longer_than_the_default_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """httpx's 5s default expired on a real video-creative call (found live
    2026-10-08): Meta checks the video while creating the creative."""
    fake_client = _FakeAsyncClient(response=_FakeResponse({"id": "c"}))
    seen: dict[str, Any] = {}

    def make_client(**kwargs: Any) -> _FakeAsyncClient:
        seen.update(kwargs)
        return fake_client

    monkeypatch.setattr(httpx, "AsyncClient", make_client)

    await meta.create_meta_video_ad_creative(
        access_token="t",
        ad_account_id="act_1",
        page_id="p",
        name="n",
        headline="h",
        body_text="b.",
        description=None,
        cta="SHOP_NOW",
        link="https://acme.example",
        video_id="v",
        image_hash="i",
    )

    assert seen["timeout"] >= 30


@pytest.mark.asyncio
async def test_post_json_names_the_error_type_when_the_message_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **_kwargs: _FakeAsyncClient(error=httpx.ReadTimeout("")),
    )

    with pytest.raises(meta.MetaConnectionError, match="ReadTimeout"):
        await meta._post_json("https://graph.example/x", {"a": "b"})


@pytest.mark.asyncio
async def test_create_meta_video_ad_creative_omits_a_missing_description(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(monkeypatch, _FakeResponse({"id": "c"}))

    await meta.create_meta_video_ad_creative(
        access_token="t",
        ad_account_id="act_1",
        page_id="p",
        name="n",
        headline="h",
        body_text="b.",
        description=None,
        cta="SHOP_NOW",
        link="https://acme.example",
        video_id="v",
        image_hash="i",
    )

    spec = json.loads(client.calls[0][1]["object_story_spec"])
    assert "link_description" not in spec["video_data"]


@pytest.mark.asyncio
async def test_fake_meta_mode_fakes_video_upload_wait_and_creative(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        video_id = await meta.upload_meta_video(
            access_token="t",
            ad_account_id="act_1",
            video_data=b"x",
            content_type="video/mp4",
            name="n",
        )
        await meta.wait_for_meta_video(access_token="t", video_id=video_id)
        creative_id = await meta.create_meta_video_ad_creative(
            access_token="t",
            ad_account_id="act_1",
            page_id="p",
            name="n",
            headline="h",
            body_text="b.",
            description=None,
            cta="SHOP_NOW",
            link="https://acme.example",
            video_id=video_id,
            image_hash="i",
        )
    finally:
        get_settings.cache_clear()

    assert video_id.startswith("fake_video_")
    assert creative_id.startswith("fake_creative_")
