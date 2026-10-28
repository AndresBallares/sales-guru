"""Tests for a creative test's per-campaign settings: budget and conversion event.

A creative test is one CBO campaign. Its daily budget and its conversion event
(Purchase by default, Add to Cart by the user's choice, never switched
silently) are edited before publishing; the advice says when Add to Cart is
worth considering.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import strategy as strategy_module
from app.services import creative_test_settings
from app.services.meta import MetaConnectionError
from fastapi.testclient import TestClient

from tests.test_creative_test_plan_publish import (
    _creative_plan,
    _creative_plan_campaign,
    mock_locales,  # noqa: F401  (autouse fixture)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture)
)
from tests.test_publish import (
    _create_business,
    _signed_up_client,
    mock_services,  # noqa: F401  (autouse fixture)
)


def _cbo_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, **kwargs: Any
) -> tuple[str, str, list[str]]:
    """A creative test that bids for the lowest cost: one CBO campaign."""
    return _creative_plan_campaign(
        client, monkeypatch, plan=_creative_plan(bid_strategy="LOWEST_COST"), **kwargs
    )


def _url(business_id: str, campaign_id: str) -> str:
    return f"/businesses/{business_id}/campaigns/{campaign_id}/strategy/test-settings"


@pytest.fixture(autouse=True)
def pixel_counts(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """A Pixel that has recorded purchases, so no advice unless a test asks."""
    counts = AsyncMock(return_value={"PageView": 900, "Purchase": 4})
    monkeypatch.setattr(strategy_module, "fetch_pixel_event_counts", counts)
    return counts


# ── The advice (pure) ────────────────────────────────────────


def test_no_advice_for_a_cheap_product_with_recorded_purchases() -> None:
    advice = creative_test_settings.event_advice(
        price=80.0, high_ticket_threshold=500.0, purchase_count=4
    )

    assert advice.recommended is None
    assert advice.reasons == []
    assert advice.pixel_checked is True


def test_zero_purchases_in_thirty_days_recommends_add_to_cart() -> None:
    advice = creative_test_settings.event_advice(
        price=80.0, high_ticket_threshold=500.0, purchase_count=0
    )

    assert advice.recommended == "ADD_TO_CART"
    assert len(advice.reasons) == 1
    assert "0 Purchase events" in advice.reasons[0]
    assert "30 days" in advice.reasons[0]


@pytest.mark.parametrize("price", [500.0, 2000.0])
def test_a_price_at_or_above_the_threshold_recommends_add_to_cart(
    price: float,
) -> None:
    advice = creative_test_settings.event_advice(
        price=price, high_ticket_threshold=500.0, purchase_count=4
    )

    assert advice.recommended == "ADD_TO_CART"
    assert len(advice.reasons) == 1
    assert "$500" in advice.reasons[0]


def test_a_price_just_under_the_threshold_gives_no_advice() -> None:
    advice = creative_test_settings.event_advice(
        price=499.99, high_ticket_threshold=500.0, purchase_count=4
    )

    assert advice.recommended is None


def test_both_reasons_are_listed() -> None:
    advice = creative_test_settings.event_advice(
        price=900.0, high_ticket_threshold=500.0, purchase_count=0
    )

    assert advice.recommended == "ADD_TO_CART"
    assert len(advice.reasons) == 2


def test_an_unchecked_pixel_is_not_treated_as_zero_purchases() -> None:
    advice = creative_test_settings.event_advice(
        price=80.0, high_ticket_threshold=500.0, purchase_count=None
    )

    assert advice.recommended is None
    assert advice.pixel_checked is False


def test_no_price_on_file_gives_no_price_reason() -> None:
    advice = creative_test_settings.event_advice(
        price=None, high_ticket_threshold=500.0, purchase_count=4
    )

    assert advice.recommended is None


# ── GET ──────────────────────────────────────────────────────


def test_get_returns_the_defaults_and_the_minimum(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.get(_url(business_id, campaign_id))

    assert response.status_code == 200
    body = response.json()
    assert body["dailyBudget"] == 50.0
    assert body["optimizationEvent"] == "PURCHASE"
    assert body["durationDays"] == 10
    assert body["totalBudget"] == 500.0
    # One photo on file, so the test needs three ads: $10 each.
    assert body["adCount"] == 3
    assert body["minDailyBudget"] == 30.0
    assert body["advice"] == {
        "recommended": None,
        "reasons": [],
        "pixelChecked": True,
    }


def test_get_warns_when_the_pixel_has_no_purchases_in_30_days(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, pixel_counts: AsyncMock
) -> None:
    pixel_counts.return_value = {"PageView": 900}
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["advice"]["recommended"] == "ADD_TO_CART"
    assert "0 Purchase events" in body["advice"]["reasons"][0]
    # A warning only: the plan itself is still Purchase.
    assert body["optimizationEvent"] == "PURCHASE"
    assert pixel_counts.await_args is not None
    assert pixel_counts.await_args.kwargs["pixel_id"] == "pixel_1"
    assert pixel_counts.await_args.kwargs["days"] == 30


def test_get_says_so_when_the_pixel_could_not_be_read(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, pixel_counts: AsyncMock
) -> None:
    pixel_counts.side_effect = MetaConnectionError("down")
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["advice"]["pixelChecked"] is False
    assert body["advice"]["recommended"] is None


def test_get_404s_without_a_strategy(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]

    assert client.get(_url(business_id, campaign_id)).status_code == 404


# ── PATCH ────────────────────────────────────────────────────


def test_patch_sets_the_budget_and_the_total(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 100})

    assert response.status_code == 200
    assert response.json()["dailyBudget"] == 100.0
    assert response.json()["totalBudget"] == 1000.0
    stored = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    ).json()["content"]
    assert stored["dailyBudget"] == 100.0
    assert stored["totalBudget"] == 1000.0


def test_patch_refuses_a_budget_under_ten_dollars_per_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 29.99})

    assert response.status_code == 422
    assert "$30" in response.json()["detail"]


def test_patch_accepts_exactly_the_minimum(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 30})

    assert response.status_code == 200


def test_the_minimum_is_forty_dollars_for_four_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False, photo_count=4
    )

    body = client.get(_url(business_id, campaign_id)).json()
    too_low = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 39})
    ok = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 40})

    assert body["adCount"] == 4
    assert body["minDailyBudget"] == 40.0
    assert too_low.status_code == 422
    assert ok.status_code == 200


def test_patch_chooses_add_to_cart_only_when_asked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.patch(
        _url(business_id, campaign_id), json={"optimizationEvent": "ADD_TO_CART"}
    )

    assert response.status_code == 200
    assert response.json()["optimizationEvent"] == "ADD_TO_CART"
    content = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    ).json()["content"]
    assert content["optimizationEvent"] == "ADD_TO_CART"
    # The benchmark target comes with the event (the industry median here).
    assert content["targetCostPerAddToCart"] is not None
    # Budget untouched by an event-only change.
    assert content["dailyBudget"] == 50.0


def test_patch_can_go_back_to_purchase(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )
    client.patch(
        _url(business_id, campaign_id), json={"optimizationEvent": "ADD_TO_CART"}
    )

    response = client.patch(
        _url(business_id, campaign_id), json={"optimizationEvent": "PURCHASE"}
    )

    assert response.json()["optimizationEvent"] == "PURCHASE"


def test_patch_with_nothing_to_change_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.patch(_url(business_id, campaign_id), json={})

    assert response.status_code == 422


def test_changing_an_approved_campaign_asks_for_approval_again(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(
        client, monkeypatch, select=3, approve=True
    )

    client.patch(_url(business_id, campaign_id), json={"dailyBudget": 60})

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    status = next(c for c in campaigns if c["id"] == campaign_id)["status"]
    assert status == "PENDING_APPROVAL"


def test_a_published_campaign_cannot_change_its_settings(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, Any],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _cbo_campaign(client, monkeypatch, select=3)
    published = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish"
    )
    assert published.status_code == 200, published.text

    response = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 60})

    assert response.status_code == 400
    assert "already published" in response.json()["detail"]


def test_a_campaign_whose_budget_is_on_its_ad_set_has_no_settings(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An older plan (a cost cap, no lowest-cost bid) keeps its shape: its budget
    stays on the ad set, so it has no campaign-level settings."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )

    got = client.get(_url(business_id, campaign_id))
    patched = client.patch(_url(business_id, campaign_id), json={"dailyBudget": 60})

    assert got.status_code == 400
    assert patched.status_code == 400
