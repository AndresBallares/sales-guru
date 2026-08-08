"""Tests for product onboarding endpoints."""

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
