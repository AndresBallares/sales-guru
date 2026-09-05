"""Tests for product onboarding endpoints."""

from unittest.mock import AsyncMock

import pytest
from app.api import product as product_api
from app.core.config import get_settings
from app.services.url_reachability import ReachabilityResult
from fastapi.testclient import TestClient


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


def test_create_product_requires_a_session(client: TestClient) -> None:
    """Creating a product with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/products", json={"description": "Widgets"}
    )

    assert response.status_code == 401


def test_create_product_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Creating a product under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = client.post(
        "/businesses/does-not-exist/products", json={"description": "Widgets"}
    )

    assert response.status_code == 404


def test_create_product_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't create a product under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 404


def test_create_product_with_only_description(client: TestClient) -> None:
    """Only `description` is required; the rest default to null."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Handmade leather wallets"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["description"] == "Handmade leather wallets"
    assert body["price"] is None
    assert body["margin"] is None
    assert body["features"] is None
    assert body["benefits"] is None
    assert body["url"] is None
    assert "id" in body


def test_create_product_with_all_fields(client: TestClient) -> None:
    """All PRD.md §7 fields round-trip correctly."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/products",
        json={
            "description": "Handmade leather wallets",
            "price": 49.99,
            "margin": 40.0,
            "features": "Full-grain leather, hand-stitched",
            "benefits": "Lasts a lifetime, ages beautifully",
            "url": "https://acme.example/wallets",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["price"] == 49.99
    assert body["margin"] == 40.0
    assert body["features"] == "Full-grain leather, hand-stitched"
    assert body["benefits"] == "Lasts a lifetime, ages beautifully"
    assert body["url"] == "https://acme.example/wallets"


def test_create_product_requires_description(client: TestClient) -> None:
    """Omitting the required `description` field returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/products", json={"price": 10})

    assert response.status_code == 422


def test_create_product_normalizes_a_schemeless_url(client: TestClient) -> None:
    """A missing scheme is normalized to https:// before storage."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Widgets", "url": "acme.example/ring"},
    )

    assert response.status_code == 201
    assert response.json()["url"] == "https://acme.example/ring"


def test_create_product_rejects_an_invalid_url(client: TestClient) -> None:
    """A URL that fails validate_destination_url returns a 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Widgets", "url": "javascript:alert(1)"},
    )

    assert response.status_code == 422


def test_create_product_url_optional_with_no_pending_campaign(
    client: TestClient,
) -> None:
    """With no campaign waiting for a product, url stays optional regardless
    of objective — there's nothing yet that needs it."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "AWARENESS"})

    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 201
    assert response.json()["url"] is None


def test_create_product_url_optional_for_awareness_campaign(
    client: TestClient,
) -> None:
    """A pending AWARENESS campaign doesn't require a product URL."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "AWARENESS"})

    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 201
    assert response.json()["url"] is None


def test_create_product_requires_url_for_pending_sales_campaign(
    client: TestClient,
) -> None:
    """A pending SALES campaign's CTA needs somewhere to send people."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "SALES"})

    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 422


def test_create_product_requires_url_for_pending_traffic_campaign(
    client: TestClient,
) -> None:
    """Same rule for TRAFFIC as for SALES."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "TRAFFIC"})

    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 422


def test_create_product_with_url_succeeds_for_pending_sales_campaign(
    client: TestClient,
) -> None:
    """Supplying a URL up front satisfies the pending SALES campaign."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "SALES"})

    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Widgets", "url": "https://acme.example/widgets"},
    )

    assert response.status_code == 201


def test_create_product_url_optional_once_a_pending_campaign_already_has_one(
    client: TestClient,
) -> None:
    """Only campaigns still missing a product count toward the requirement."""
    _signed_up_client(client)
    business_id = _create_business(client)
    other_product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Original", "url": "https://acme.example/original"},
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": other_product_id},
    )

    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )

    assert response.status_code == 201


def test_check_product_url_404s_when_the_flag_is_off(client: TestClient) -> None:
    """The scaffold endpoint is invisible until URL_REACHABILITY_CHECK_ENABLED."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Widgets", "url": "https://acme.example/widgets"},
    ).json()["id"]

    response = client.post(f"/businesses/{business_id}/products/{product_id}/check-url")

    assert response.status_code == 404


def test_check_product_url_returns_the_reachability_result(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With the flag on, the endpoint delegates to check_url_reachable."""
    monkeypatch.setenv("URL_REACHABILITY_CHECK_ENABLED", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)
        product_id = client.post(
            f"/businesses/{business_id}/products",
            json={"description": "Widgets", "url": "https://acme.example/widgets"},
        ).json()["id"]
        monkeypatch.setattr(
            product_api,
            "check_url_reachable",
            AsyncMock(
                return_value=ReachabilityResult(
                    reachable=True,
                    reason="ok",
                    status_code=200,
                    final_url="https://acme.example/widgets",
                )
            ),
        )

        response = client.post(
            f"/businesses/{business_id}/products/{product_id}/check-url"
        )

        assert response.status_code == 200
        body = response.json()
        assert body["reachable"] is True
        assert body["reason"] == "ok"
        assert body["statusCode"] == 200
        assert body["finalUrl"] == "https://acme.example/widgets"
    finally:
        get_settings.cache_clear()


def test_check_product_url_422s_for_a_product_with_no_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Nothing to check if the product has no URL at all."""
    monkeypatch.setenv("URL_REACHABILITY_CHECK_ENABLED", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)
        product_id = client.post(
            f"/businesses/{business_id}/products", json={"description": "Widgets"}
        ).json()["id"]

        response = client.post(
            f"/businesses/{business_id}/products/{product_id}/check-url"
        )

        assert response.status_code == 422
    finally:
        get_settings.cache_clear()


def test_check_product_url_404s_for_a_nonexistent_product(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Same not-found behavior as any other business-scoped resource."""
    monkeypatch.setenv("URL_REACHABILITY_CHECK_ENABLED", "true")
    get_settings.cache_clear()
    try:
        _signed_up_client(client)
        business_id = _create_business(client)

        response = client.post(
            f"/businesses/{business_id}/products/does-not-exist/check-url"
        )

        assert response.status_code == 404
    finally:
        get_settings.cache_clear()


def test_list_products_requires_a_session(client: TestClient) -> None:
    """Listing products with no session cookie returns 401."""
    response = client.get("/businesses/some-id/products")

    assert response.status_code == 401


def test_list_products_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't list products under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{business_id}/products")

    assert response.status_code == 404


def test_list_products_returns_only_this_businesss_products(
    client: TestClient,
) -> None:
    """Products from a different business under the same user never leak in."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")

    client.post(f"/businesses/{business_a}/products", json={"description": "A1"})
    client.post(f"/businesses/{business_b}/products", json={"description": "B1"})

    response = client.get(f"/businesses/{business_a}/products")

    assert response.status_code == 200
    descriptions = [p["description"] for p in response.json()]
    assert descriptions == ["A1"]
