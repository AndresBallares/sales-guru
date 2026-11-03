"""POST .../products/{id}/edit-impact: what a product edit would do to creatives.

A read-only pre-flight for the Products tab's warning. It reuses
``is_creative_stale`` against a copy of the product with the proposed changes, so
it can never disagree with what the app does after the edit is saved.
"""

from typing import Any
from unittest.mock import AsyncMock

import httpx2
import pytest
from app.api import creative as creative_module
from app.api import strategy as strategy_module
from fastapi.testclient import TestClient

from tests.research_helpers import sql
from tests.test_creative import (
    _FAKE_STRATEGY,
    _FAKE_VARIANTS,
    _create_business,
    _create_campaign,
    _generate_strategy,
    _signed_up_client,
)


@pytest.fixture(autouse=True)
def _canned_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        creative_module, "generate_creatives", AsyncMock(return_value=_FAKE_VARIANTS)
    )
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=_FAKE_STRATEGY)
    )


def _product(client: TestClient, business_id: str, **extra: Any) -> str:  # noqa: ANN401
    body = {"description": "Ring", "url": "https://acme.example/ring", **extra}
    product_id: str = client.post(
        f"/businesses/{business_id}/products", json=body
    ).json()["id"]
    return product_id


def _campaign_with_creatives(
    client: TestClient, business_id: str, product_id: str
) -> str:
    campaign_id = _create_campaign(client, business_id, product_id=product_id)
    _generate_strategy(client, business_id, campaign_id)
    assert (
        client.post(
            f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
        ).status_code
        == 201
    )
    return campaign_id


def _impact(
    client: TestClient,
    business_id: str,
    product_id: str,
    **body: Any,  # noqa: ANN401
) -> httpx2.Response:
    return client.post(
        f"/businesses/{business_id}/products/{product_id}/edit-impact", json=body
    )


def _setup(client: TestClient) -> tuple[str, str, str]:
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _product(client, business_id)
    campaign_id = _campaign_with_creatives(client, business_id, product_id)
    return business_id, product_id, campaign_id


def test_a_name_only_edit_changes_nothing_for_creatives(client: TestClient) -> None:
    business_id, product_id, campaign_id = _setup(client)
    body = _impact(client, business_id, product_id, name="Emerald Coil").json()
    assert body["willAffectCreatives"] is False
    assert body["affectsPublishedCampaign"] is False
    (campaign,) = body["campaigns"]
    assert campaign["id"] == campaign_id
    assert campaign["creativesTotal"] == 4
    assert campaign["creativesWouldBeStale"] == 0
    assert campaign["creativesAlreadyStale"] == 0


@pytest.mark.parametrize(
    "change",
    [
        {"price": 450},
        {"features": "New features"},
        {"benefits": "New benefits"},
        {"mechanism": "A new mechanism"},
        {"margin": 40},
    ],
)
def test_the_other_fields_never_mark_creatives_stale(
    client: TestClient, change: dict[str, Any]
) -> None:
    business_id, product_id, _ = _setup(client)
    assert (
        _impact(client, business_id, product_id, **change).json()["willAffectCreatives"]
        is False
    )


def test_a_new_description_would_mark_every_creative_stale(client: TestClient) -> None:
    business_id, product_id, campaign_id = _setup(client)
    body = _impact(client, business_id, product_id, description="Necklace").json()
    assert body["willAffectCreatives"] is True
    (campaign,) = body["campaigns"]
    assert campaign["creativesWouldBeStale"] == 4
    assert campaign["name"] is None or isinstance(campaign["name"], str)
    assert campaign["status"] == "ADS_GENERATED"
    assert campaign["isPublished"] is False
    assert campaign["id"] == campaign_id


def test_the_same_description_changes_nothing(client: TestClient) -> None:
    business_id, product_id, _ = _setup(client)
    body = _impact(client, business_id, product_id, description="Ring").json()
    assert body["willAffectCreatives"] is False


def test_a_new_url_would_mark_creatives_stale(client: TestClient) -> None:
    business_id, product_id, _ = _setup(client)
    body = _impact(
        client, business_id, product_id, url="https://acme.example/other"
    ).json()
    assert body["willAffectCreatives"] is True
    assert body["campaigns"][0]["creativesWouldBeStale"] == 4


def test_personalization_matters_only_before_the_ad_is_on_meta(
    client: TestClient,
) -> None:
    business_id, product_id, campaign_id = _setup(client)
    change = {"personalizable": True, "personalizationOptions": "Pick the stone"}
    before = _impact(client, business_id, product_id, **change).json()
    assert before["willAffectCreatives"] is True
    sql("UPDATE Campaign SET metaCampaignId = 'meta-1' WHERE id = ?", campaign_id)
    after = _impact(client, business_id, product_id, **change).json()
    assert after["willAffectCreatives"] is False
    assert after["campaigns"][0]["isPublished"] is True


def test_a_published_campaign_is_flagged_when_its_creatives_would_go_stale(
    client: TestClient,
) -> None:
    business_id, product_id, campaign_id = _setup(client)
    sql("UPDATE Campaign SET metaCampaignId = 'meta-1' WHERE id = ?", campaign_id)
    body = _impact(client, business_id, product_id, description="Necklace").json()
    assert body["willAffectCreatives"] is True
    assert body["affectsPublishedCampaign"] is True
    assert body["campaigns"][0]["isPublished"] is True


def test_a_published_campaign_with_no_effect_is_not_flagged(client: TestClient) -> None:
    business_id, product_id, campaign_id = _setup(client)
    sql("UPDATE Campaign SET metaCampaignId = 'meta-1' WHERE id = ?", campaign_id)
    body = _impact(client, business_id, product_id, name="Emerald Coil").json()
    assert body["affectsPublishedCampaign"] is False


def test_only_campaigns_using_this_product_are_listed(client: TestClient) -> None:
    business_id, product_id, campaign_id = _setup(client)
    other_product = _product(client, business_id, description="Necklace")
    other_campaign = _campaign_with_creatives(client, business_id, other_product)
    body = _impact(client, business_id, product_id, description="Bracelet").json()
    assert [c["id"] for c in body["campaigns"]] == [campaign_id]
    assert other_campaign not in [c["id"] for c in body["campaigns"]]


def test_a_product_with_no_campaigns_has_an_empty_list(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _product(client, business_id)
    body = _impact(client, business_id, product_id, description="Necklace").json()
    assert body == {
        "willAffectCreatives": False,
        "affectsPublishedCampaign": False,
        "campaigns": [],
    }


def test_creatives_that_are_already_stale_are_counted_separately(
    client: TestClient,
) -> None:
    business_id, product_id, _ = _setup(client)
    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"description": "Necklace"},
    )
    body = _impact(client, business_id, product_id, description="Bracelet").json()
    campaign = body["campaigns"][0]
    assert campaign["creativesAlreadyStale"] == 4
    assert campaign["creativesWouldBeStale"] == 0
    assert body["willAffectCreatives"] is False


def test_the_pre_flight_changes_nothing(client: TestClient) -> None:
    business_id, product_id, campaign_id = _setup(client)
    before = client.get(f"/businesses/{business_id}/products").json()
    _impact(client, business_id, product_id, description="Necklace", name="X")
    assert client.get(f"/businesses/{business_id}/products").json() == before
    creatives = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert not any(c["isStale"] for c in creatives)


def test_an_invalid_url_is_a_422_like_a_real_edit(client: TestClient) -> None:
    business_id, product_id, _ = _setup(client)
    assert _impact(client, business_id, product_id, url="not a url").status_code == 422


def test_it_needs_a_session_an_owned_business_and_a_real_product(
    client: TestClient,
) -> None:
    business_id, product_id, _ = _setup(client)
    assert _impact(client, business_id, "nope").status_code == 404
    client.post("/auth/logout")
    assert _impact(client, business_id, product_id).status_code == 401
    _signed_up_client(client, "intruder@example.com")
    assert _impact(client, business_id, product_id).status_code == 404
