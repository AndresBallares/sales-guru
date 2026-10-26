"""Tests for the Meta billing pre-check and for cleaning up a failed publish.

A publish creates a campaign, ad set, creatives and ads on Meta one call at a
time. Two things must hold: an ad account with no payment method is stopped
before anything is created, and a publish that fails partway removes what it
created so the retry doesn't leave a second campaign behind.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import meta as meta_service_module
from app.services.meta import MetaConnectionError
from app.services.meta import (
    require_funding_source as real_require_funding_source,
)
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    _ready_campaign,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

_NO_PAYMENT_MESSAGE = (
    "Your Meta ad account has no valid payment method. Add one in Meta's "
    "Billing & payments, then publish again."
)
_BILLING_LINK = "https://business.facebook.com/billing_hub/payment_settings?asset_id=1"


def _kwargs(mock: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of a mock's most recent awaited call."""
    assert mock.await_args is not None
    return dict(mock.await_args.kwargs)


def _campaign_status(client: TestClient, business_id: str) -> str:
    return str(client.get(f"/businesses/{business_id}/campaigns").json()[0]["status"])


# ── The pre-check itself ─────────────────────────────────────


@pytest.mark.asyncio
async def test_pre_check_blocks_an_account_with_no_funding_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_json = AsyncMock(return_value={"account_status": 1})
    monkeypatch.setattr(meta_service_module, "_get_json", get_json)

    with pytest.raises(MetaConnectionError) as raised:
        await real_require_funding_source(access_token="tok", ad_account_id="act_1")

    assert str(raised.value) == f"{_NO_PAYMENT_MESSAGE} {_BILLING_LINK}"
    assert raised.value.error_subcode == meta_service_module.NO_PAYMENT_METHOD_SUBCODE
    assert get_json.await_args is not None
    url, params = get_json.await_args.args
    assert url.endswith("/act_1")
    assert params["fields"] == "funding_source_details,account_status"


@pytest.mark.asyncio
async def test_pre_check_passes_an_account_with_a_funding_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        meta_service_module,
        "_get_json",
        AsyncMock(
            return_value={
                "account_status": 1,
                "funding_source_details": {"id": "9", "type": 1},
            }
        ),
    )

    await real_require_funding_source(access_token="tok", ad_account_id="act_1")


@pytest.mark.asyncio
async def test_pre_check_lets_the_publish_try_when_billing_cannot_be_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A token that can't read billing must not block a publish that might work."""
    monkeypatch.setattr(
        meta_service_module,
        "_get_json",
        AsyncMock(side_effect=MetaConnectionError("(#200) Permissions error")),
    )

    await real_require_funding_source(access_token="tok", ad_account_id="act_1")


@pytest.mark.asyncio
async def test_pre_check_is_skipped_in_fake_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_json = AsyncMock()
    monkeypatch.setattr(meta_service_module, "_get_json", get_json)
    monkeypatch.setattr(
        meta_service_module,
        "get_settings",
        lambda: type("S", (), {"fake_meta_enabled": True})(),
    )

    await real_require_funding_source(access_token="tok", ad_account_id="act_1")

    get_json.assert_not_awaited()


# ── In the publish path ──────────────────────────────────────


def test_publish_is_blocked_before_anything_is_created_on_meta(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)
    mock_services["require_funding_source"].side_effect = MetaConnectionError(
        f"{_NO_PAYMENT_MESSAGE} {_BILLING_LINK}"
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert response.json()["detail"] == f"{_NO_PAYMENT_MESSAGE} {_BILLING_LINK}"
    mock_services["create_campaign"].assert_not_awaited()
    mock_services["upload_ad_image"].assert_not_awaited()
    assert _campaign_status(client, business_id) == "FAILED"


def test_the_pre_check_runs_with_the_connected_account(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    kwargs = _kwargs(mock_services["require_funding_source"])
    assert kwargs["ad_account_id"] == "act_1"


def test_a_meta_no_payment_method_error_becomes_the_plain_message(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """Meta can still reject at creation time (the funding source lapsed mid-way)."""
    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_ad_set"].side_effect = MetaConnectionError(
        "Meta API call to /act_1/adsets failed: Invalid parameter | subcode=1359188",
        code=100,
        error_subcode=1359188,
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert response.json()["detail"] == f"{_NO_PAYMENT_MESSAGE} {_BILLING_LINK}"


# ── A failure partway leaves nothing behind ──────────────────


def test_a_failed_ads_step_deletes_the_campaign_it_created(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_ad"].side_effect = MetaConnectionError("Ad rejected")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert "Ad rejected" in response.json()["detail"]
    deleted = _kwargs(mock_services["delete_object"])
    assert deleted["meta_object_id"] == "meta_campaign_1"
    assert deleted["ad_account_id"] == "act_1"
    assert _campaign_status(client, business_id) == "FAILED"


def test_a_retry_after_a_failed_ads_step_creates_a_fresh_campaign_once(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_ad"].side_effect = MetaConnectionError("Ad rejected")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    mock_services["create_ad"].side_effect = None
    mock_services["create_campaign"].return_value = "meta_campaign_2"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["metaCampaignId"] == "meta_campaign_2"
    # The first attempt's campaign was deleted, so only the retry's remains on Meta.
    assert [
        call.kwargs["meta_object_id"]
        for call in mock_services["delete_object"].await_args_list
    ] == ["meta_campaign_1"]


@pytest.mark.asyncio
async def test_a_failed_creative_test_removes_its_local_ad_set_and_ads(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    mock_services["create_ad"].side_effect = [
        "meta_ad_1",
        MetaConnectionError("Ad rejected"),
    ]

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    reader = Prisma()
    await reader.connect()
    try:
        assert await reader.adset.count(where={"campaignId": campaign_id}) == 0
        creatives = await reader.creative.find_many(where={"campaignId": campaign_id})
        assert [c.adId for c in creatives if c.adId is not None] == []
    finally:
        await reader.disconnect()
    deleted = _kwargs(mock_services["delete_object"])
    assert deleted["meta_object_id"] == "meta_campaign_1"


def test_a_failed_creative_test_publishes_cleanly_on_retry(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    mock_services["create_ad"].side_effect = MetaConnectionError("Ad rejected")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    mock_services["create_ad"].side_effect = None
    mock_services["create_ad"].return_value = "meta_ad_1"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"


def test_the_original_failure_is_reported_even_if_cleanup_fails(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_ad"].side_effect = MetaConnectionError("Ad rejected")
    mock_services["delete_object"].side_effect = MetaConnectionError("Cannot delete")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert "Ad rejected" in response.json()["detail"]
    assert _campaign_status(client, business_id) == "FAILED"


def test_a_failure_before_the_campaign_exists_deletes_nothing(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_campaign"].side_effect = MetaConnectionError("boom")

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    mock_services["delete_object"].assert_not_awaited()
