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
    """A campaign can reference a product and audience from the same business.

    Giving both right away skips straight to READY (see
    app/services/campaign_readiness.py) — there's nothing left to
    auto-attach or fill in later.
    """
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
    assert body["status"] == "READY"


def test_create_campaign_with_only_objective_has_null_event_fields(
    client: TestClient,
) -> None:
    """A non-event campaign's eventVenueKey/startDate/endDate all stay null."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["eventVenueKey"] is None
    assert body["startDate"] is None
    assert body["endDate"] is None


def test_create_campaign_with_an_event_venue_defaults_the_window(
    client: TestClient,
) -> None:
    """An event venue with no explicit dates defaults to its typical window."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "eventVenueKey": "jck_las_vegas"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["eventVenueKey"] == "jck_las_vegas"
    assert body["startDate"] is not None
    assert body["endDate"] is not None
    assert body["startDate"] < body["endDate"]


def test_create_campaign_with_an_event_venue_and_explicit_dates(
    client: TestClient,
) -> None:
    """Explicit start/end dates in the payload always win over the default."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={
            "objective": "SALES",
            "eventVenueKey": "jck_las_vegas",
            "startDate": "2027-07-01T00:00:00Z",
            "endDate": "2027-07-04T00:00:00Z",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["startDate"] == "2027-07-01T00:00:00Z"
    assert body["endDate"] == "2027-07-04T00:00:00Z"


def test_create_campaign_404s_for_an_unknown_event_venue(client: TestClient) -> None:
    """A venue key outside the curated set returns 404, not a silent no-op."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "eventVenueKey": "not_a_real_venue"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown event venue"


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


def test_approve_campaign_requires_a_session(client: TestClient) -> None:
    """Approving with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/approve")

    assert response.status_code == 401


def test_approve_campaign_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Approving a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/approve"
    )

    assert response.status_code == 404


def test_approve_campaign_400s_before_an_ad_is_selected(client: TestClient) -> None:
    """A freshly created (DRAFT) campaign can't be approved yet."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 400
    assert "ad creative" in response.json()["detail"].lower()


def test_create_campaign_with_only_a_product_stays_draft(client: TestClient) -> None:
    """Only one of product/audience set isn't enough to reach READY."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id},
    )

    assert response.json()["status"] == "DRAFT"


def test_creating_a_product_auto_attaches_it_to_a_draft_campaign(
    client: TestClient,
) -> None:
    """The one-product case attaches to every campaign missing one, no
    user action needed (app/services/campaign_readiness.py)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]

    product_id = _create_product(client, business_id)

    campaign = client.get(f"/businesses/{business_id}/campaigns").json()[0]
    assert campaign["id"] == campaign_id
    assert campaign["productId"] == product_id
    assert campaign["status"] == "DRAFT"  # audience still missing


def test_creating_an_audience_auto_attaches_it_and_completes_readiness(
    client: TestClient,
) -> None:
    """Once both product and audience auto-attach, the campaign flips READY."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/campaigns", json={"objective": "SALES"})
    _create_product(client, business_id)

    audience_id = _create_audience(client, business_id)

    campaign = client.get(f"/businesses/{business_id}/campaigns").json()[0]
    assert campaign["audienceId"] == audience_id
    assert campaign["status"] == "READY"


def test_a_second_product_stops_further_auto_attach(client: TestClient) -> None:
    """With two products, auto-attach can't guess which one — it leaves
    the campaign alone rather than picking arbitrarily."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    _create_product(client, business_id, description="First product")

    _create_product(client, business_id, description="Second product")

    campaign = client.get(f"/businesses/{business_id}/campaigns").json()[0]
    assert campaign["id"] == campaign_id
    # The first product's own auto-attach already ran before the second
    # product existed, so it's still attached — the second one just
    # doesn't retroactively undo or contest that.
    assert campaign["productId"] is not None


def test_creating_a_product_does_not_attach_to_an_already_complete_campaign(
    client: TestClient,
) -> None:
    """Auto-attach only fills in campaigns missing a product — it never
    overwrites one that already has a different one."""
    _signed_up_client(client)
    business_id = _create_business(client)
    original_product_id = _create_product(client, business_id, description="Original")
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={
            "objective": "SALES",
            "productId": original_product_id,
            "audienceId": audience_id,
        },
    ).json()["id"]

    _create_product(client, business_id, description="New product")

    campaign = next(
        c
        for c in client.get(f"/businesses/{business_id}/campaigns").json()
        if c["id"] == campaign_id
    )
    assert campaign["productId"] == original_product_id


def test_update_campaign_requires_a_session(client: TestClient) -> None:
    """Updating with no session cookie returns 401."""
    response = client.patch("/businesses/some-id/campaigns/some-id", json={})

    assert response.status_code == 401


def test_update_campaign_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Updating a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.patch(
        f"/businesses/{business_id}/campaigns/does-not-exist", json={}
    )

    assert response.status_code == 404


def test_update_campaign_attaches_a_product_and_audience(client: TestClient) -> None:
    """The manual fallback for when auto-attach can't decide (several
    products/audiences to choose from)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    product_id = _create_product(client, business_id, description="First product")
    _create_product(client, business_id, description="Second product")
    audience_id = _create_audience(client, business_id, description="First audience")
    _create_audience(client, business_id, description="Second audience")

    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}",
        json={"productId": product_id, "audienceId": audience_id},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["productId"] == product_id
    assert body["audienceId"] == audience_id
    assert body["status"] == "READY"


def test_update_campaign_only_changes_provided_fields(client: TestClient) -> None:
    """Omitting a field in the PATCH body leaves it exactly as it was."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id},
    ).json()["id"]

    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}", json={}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["productId"] == product_id
    assert body["status"] == "DRAFT"


def test_update_campaign_404s_for_a_product_from_another_business(
    client: TestClient,
) -> None:
    """A product_id belonging to a different business is rejected."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")
    campaign_id = client.post(
        f"/businesses/{business_a}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    other_product_id = _create_product(client, business_b)

    response = client.patch(
        f"/businesses/{business_a}/campaigns/{campaign_id}",
        json={"productId": other_product_id},
    )

    assert response.status_code == 404


def test_update_campaign_404s_for_an_audience_from_another_business(
    client: TestClient,
) -> None:
    """An audience_id belonging to a different business is rejected."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")
    campaign_id = client.post(
        f"/businesses/{business_a}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    other_audience_id = _create_audience(client, business_b)

    response = client.patch(
        f"/businesses/{business_a}/campaigns/{campaign_id}",
        json={"audienceId": other_audience_id},
    )

    assert response.status_code == 404


def test_update_campaign_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't update a campaign they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}", json={}
    )

    assert response.status_code == 404
