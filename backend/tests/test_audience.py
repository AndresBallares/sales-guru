"""Tests for audience onboarding endpoints."""

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


def test_create_audience_requires_a_session(client: TestClient) -> None:
    """Creating an audience with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/audiences", json={"description": "Busy parents"}
    )

    assert response.status_code == 401


def test_create_audience_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Creating an audience under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = client.post(
        "/businesses/does-not-exist/audiences", json={"description": "Busy parents"}
    )

    assert response.status_code == 404


def test_create_audience_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't create an audience under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/audiences", json={"description": "Busy parents"}
    )

    assert response.status_code == 404


def test_create_audience_with_only_description(client: TestClient) -> None:
    """Only `description` is required; the rest default to null."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Busy parents seeking quick meal solutions"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["description"] == "Busy parents seeking quick meal solutions"
    assert body["ageMin"] is None
    assert body["ageMax"] is None
    assert body["location"] is None
    assert body["interests"] is None
    assert body["problem"] is None
    assert body["desire"] is None
    assert "id" in body


def test_create_audience_with_all_fields_uses_camelcase(client: TestClient) -> None:
    """All PRD.md §7 fields round-trip, using camelCase JSON keys."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/audiences",
        json={
            "description": "Busy parents",
            "ageMin": 30,
            "ageMax": 55,
            "location": "New York",
            "interests": "meal kits, fitness",
            "problem": "No time to cook healthy meals",
            "desire": "Feed their family well without the effort",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["ageMin"] == 30
    assert body["ageMax"] == 55
    assert body["location"] == "New York"
    assert body["interests"] == "meal kits, fitness"
    assert body["problem"] == "No time to cook healthy meals"
    assert body["desire"] == "Feed their family well without the effort"


def test_create_audience_requires_description(client: TestClient) -> None:
    """Omitting the required `description` field returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/audiences", json={"ageMin": 30})

    assert response.status_code == 422


def test_list_audiences_requires_a_session(client: TestClient) -> None:
    """Listing audiences with no session cookie returns 401."""
    response = client.get("/businesses/some-id/audiences")

    assert response.status_code == 401


def test_list_audiences_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't list audiences under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{business_id}/audiences")

    assert response.status_code == 404


def test_list_audiences_returns_only_this_businesss_audiences(
    client: TestClient,
) -> None:
    """Audiences from a different business under the same user never leak in."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")

    client.post(f"/businesses/{business_a}/audiences", json={"description": "A1"})
    client.post(f"/businesses/{business_b}/audiences", json={"description": "B1"})

    response = client.get(f"/businesses/{business_a}/audiences")

    assert response.status_code == 200
    descriptions = [a["description"] for a in response.json()]
    assert descriptions == ["A1"]
