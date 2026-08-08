"""Tests for campaign creation endpoints."""

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


def _create_product(
    client: TestClient, business_id: str, description: str = "Widgets"
) -> str:
    """Create a product under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/products", json={"description": description}
    )
    id_: str = response.json()["id"]
    return id_


def _create_audience(
    client: TestClient, business_id: str, description: str = "Everyone"
) -> str:
    """Create an audience under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/audiences", json={"description": description}
    )
    id_: str = response.json()["id"]
    return id_


def test_create_campaign_requires_a_session(client: TestClient) -> None:
    """Creating a campaign with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns", json={"objective": "SALES"})

    assert response.status_code == 401


def test_create_campaign_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Creating a campaign under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = client.post(
        "/businesses/does-not-exist/campaigns", json={"objective": "SALES"}
    )

    assert response.status_code == 404


def test_create_campaign_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't create a campaign under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    )

    assert response.status_code == 404


def test_create_campaign_with_only_objective(client: TestClient) -> None:
    """Only `objective` is required; product/audience default to null."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "AWARENESS"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["objective"] == "AWARENESS"
    assert body["status"] == "DRAFT"
    assert body["name"] is None
    assert body["productId"] is None
    assert body["audienceId"] is None
    assert body["metaCampaignId"] is None
    assert "id" in body


def test_create_campaign_with_a_name(client: TestClient) -> None:
    """An optional human-readable name is stored and returned."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "name": "Custom Colombian Emerald Ring"},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Custom Colombian Emerald Ring"


def test_create_campaign_with_product_and_audience(client: TestClient) -> None:
    """A campaign can reference a product and audience from the same business."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    audience_id = _create_audience(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "LEADS", "productId": product_id, "audienceId": audience_id},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["productId"] == product_id
    assert body["audienceId"] == audience_id


def test_create_campaign_rejects_an_invalid_objective(client: TestClient) -> None:
    """An objective outside the fixed set returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "NOT_A_REAL_ONE"}
    )

    assert response.status_code == 422


def test_create_campaign_requires_objective(client: TestClient) -> None:
    """Omitting the required `objective` field returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/campaigns", json={})

    assert response.status_code == 422


def test_create_campaign_404s_for_a_product_from_another_business(
    client: TestClient,
) -> None:
    """A product belonging to a different business (even one you own) 404s."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")
    product_from_b = _create_product(client, business_b)

    response = client.post(
        f"/businesses/{business_a}/campaigns",
        json={"objective": "SALES", "productId": product_from_b},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Product not found"


def test_create_campaign_404s_for_an_audience_from_another_business(
    client: TestClient,
) -> None:
    """An audience belonging to a different business (even one you own) 404s."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")
    audience_from_b = _create_audience(client, business_b)

    response = client.post(
        f"/businesses/{business_a}/campaigns",
        json={"objective": "SALES", "audienceId": audience_from_b},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Audience not found"


def test_list_campaigns_requires_a_session(client: TestClient) -> None:
    """Listing campaigns with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns")

    assert response.status_code == 401


def test_list_campaigns_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't list campaigns under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{business_id}/campaigns")

    assert response.status_code == 404


def test_list_campaigns_returns_only_this_businesss_campaigns(
    client: TestClient,
) -> None:
    """Campaigns from a different business under the same user never leak in."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")

    client.post(f"/businesses/{business_a}/campaigns", json={"objective": "SALES"})
    client.post(f"/businesses/{business_b}/campaigns", json={"objective": "LEADS"})

    response = client.get(f"/businesses/{business_a}/campaigns")

    assert response.status_code == 200
    objectives = [c["objective"] for c in response.json()]
    assert objectives == ["SALES"]
