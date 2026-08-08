"""Tests for business onboarding endpoints."""

from fastapi.testclient import TestClient


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def test_create_business_requires_a_session(client: TestClient) -> None:
    """Creating a business with no session cookie returns 401."""
    response = client.post("/businesses", json={"name": "Acme"})

    assert response.status_code == 401


def test_create_business_with_only_name(client: TestClient) -> None:
    """Only `name` is required; the rest of the fields default to null."""
    _signed_up_client(client)

    response = client.post("/businesses", json={"name": "Acme Widgets"})

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Acme Widgets"
    assert body["website"] is None
    assert body["industry"] is None
    assert body["location"] is None
    assert body["description"] is None
    assert "id" in body


def test_create_business_with_all_fields(client: TestClient) -> None:
    """All PRD.md §7 fields round-trip correctly."""
    _signed_up_client(client)

    response = client.post(
        "/businesses",
        json={
            "name": "Acme Widgets",
            "website": "https://acme.example",
            "industry": "Manufacturing",
            "location": "Ciudad de México",
            "description": "We make widgets for other widget makers.",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["website"] == "https://acme.example"
    assert body["industry"] == "Manufacturing"
    assert body["location"] == "Ciudad de México"
    assert body["description"] == "We make widgets for other widget makers."


def test_create_business_requires_name(client: TestClient) -> None:
    """Omitting the required `name` field returns 422."""
    _signed_up_client(client)

    response = client.post("/businesses", json={"website": "https://acme.example"})

    assert response.status_code == 422


def test_list_businesses_requires_a_session(client: TestClient) -> None:
    """Listing businesses with no session cookie returns 401."""
    response = client.get("/businesses")

    assert response.status_code == 401


def test_list_businesses_returns_only_the_current_users_businesses(
    client: TestClient,
) -> None:
    """A user only ever sees their own businesses, never another user's."""
    _signed_up_client(client, email="alice@example.com")
    client.post("/businesses", json={"name": "Alice's Business"})
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    client.post("/businesses", json={"name": "Bob's Business"})

    response = client.get("/businesses")

    assert response.status_code == 200
    names = [b["name"] for b in response.json()]
    assert names == ["Bob's Business"]
