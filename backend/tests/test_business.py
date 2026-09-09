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


def test_create_business_with_only_name_and_industry(client: TestClient) -> None:
    """`name` and `industry` are required; the rest default to null."""
    _signed_up_client(client)

    response = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    )

    assert response.status_code == 201
    body = response.json()
    assert body["name"] == "Acme Widgets"
    assert body["industry"] == "ECOMMERCE"
    assert body["website"] is None
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
            "industry": "SAAS_TECHNOLOGY",
            "location": "Ciudad de México",
            "description": "We make widgets for other widget makers.",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["website"] == "https://acme.example"
    assert body["industry"] == "SAAS_TECHNOLOGY"
    assert body["location"] == "Ciudad de México"
    assert body["description"] == "We make widgets for other widget makers."


def test_create_business_requires_name(client: TestClient) -> None:
    """Omitting the required `name` field returns 422 even with a valid
    industry given — isolates this case from the industry requirement
    below."""
    _signed_up_client(client)

    response = client.post(
        "/businesses",
        json={"website": "https://acme.example", "industry": "ECOMMERCE"},
    )

    assert response.status_code == 422


def test_create_business_requires_industry(client: TestClient) -> None:
    """Omitting the required `industry` field returns 422."""
    _signed_up_client(client)

    response = client.post("/businesses", json={"name": "Acme Widgets"})

    assert response.status_code == 422


def test_create_business_rejects_an_invalid_industry(client: TestClient) -> None:
    """A value outside the fixed list returns 422."""
    _signed_up_client(client)

    response = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "MANUFACTURING"}
    )

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
    client.post(
        "/businesses", json={"name": "Alice's Business", "industry": "ECOMMERCE"}
    )
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    client.post("/businesses", json={"name": "Bob's Business", "industry": "ECOMMERCE"})

    response = client.get("/businesses")

    assert response.status_code == 200
    names = [b["name"] for b in response.json()]
    assert names == ["Bob's Business"]


def test_get_business_requires_a_session(client: TestClient) -> None:
    """Fetching a business with no session cookie returns 401."""
    response = client.get("/businesses/some-id")

    assert response.status_code == 401


def test_get_business_returns_the_business(client: TestClient) -> None:
    """Fetching a business by id returns its full representation."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.get(f"/businesses/{created['id']}")

    assert response.status_code == 200
    assert response.json() == created


def test_get_business_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Fetching a business that doesn't exist returns 404."""
    _signed_up_client(client)

    response = client.get("/businesses/does-not-exist")

    assert response.status_code == 404


def test_get_business_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't fetch a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    created = client.post(
        "/businesses", json={"name": "Alice's Business", "industry": "ECOMMERCE"}
    ).json()
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{created['id']}")

    assert response.status_code == 404


def test_create_business_accepts_a_description_at_the_length_cap(
    client: TestClient,
) -> None:
    """Exactly 1000 characters — the cap itself — is still accepted."""
    _signed_up_client(client)

    response = client.post(
        "/businesses",
        json={"name": "Acme", "industry": "ECOMMERCE", "description": "a" * 1000},
    )

    assert response.status_code == 201


def test_create_business_rejects_a_description_over_the_length_cap(
    client: TestClient,
) -> None:
    """A pasted-in About page can't balloon the Strategist/Creative prompt —
    description is capped at 1000 characters, enforced at the schema."""
    _signed_up_client(client)

    response = client.post(
        "/businesses",
        json={"name": "Acme", "industry": "ECOMMERCE", "description": "a" * 1001},
    )

    assert response.status_code == 422


def test_update_business_requires_a_session(client: TestClient) -> None:
    """Updating a business with no session cookie returns 401."""
    response = client.patch("/businesses/some-id", json={"name": "New name"})

    assert response.status_code == 401


def test_update_business_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Updating a business that doesn't exist returns 404."""
    _signed_up_client(client)

    response = client.patch("/businesses/does-not-exist", json={"name": "New name"})

    assert response.status_code == 404


def test_update_business_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't update a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    created = client.post(
        "/businesses", json={"name": "Alice's Business", "industry": "ECOMMERCE"}
    ).json()
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.patch(
        f"/businesses/{created['id']}", json={"name": "Hijacked name"}
    )

    assert response.status_code == 404


def test_update_business_partial_update_leaves_omitted_fields_untouched(
    client: TestClient,
) -> None:
    """Only the fields sent in the PATCH body change; everything else
    keeps its prior value."""
    _signed_up_client(client)
    created = client.post(
        "/businesses",
        json={
            "name": "Acme Widgets",
            "website": "https://acme.example",
            "industry": "FASHION_JEWELRY",
            "location": "CDMX",
            "description": "Original description",
        },
    ).json()

    response = client.patch(
        f"/businesses/{created['id']}", json={"description": "Updated description"}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Acme Widgets"
    assert body["website"] == "https://acme.example"
    assert body["industry"] == "FASHION_JEWELRY"
    assert body["location"] == "CDMX"
    assert body["description"] == "Updated description"


def test_update_business_can_change_the_name(client: TestClient) -> None:
    """The name can also be updated on its own."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(f"/businesses/{created['id']}", json={"name": "Acme Inc"})

    assert response.status_code == 200
    assert response.json()["name"] == "Acme Inc"


def test_update_business_rejects_a_description_over_the_length_cap(
    client: TestClient,
) -> None:
    """The same cap as create_business applies to the PATCH path."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(
        f"/businesses/{created['id']}", json={"description": "a" * 1001}
    )

    assert response.status_code == 422


def test_update_business_with_an_empty_body_changes_nothing(client: TestClient) -> None:
    """An empty PATCH body is a no-op, not an error."""
    _signed_up_client(client)
    created = client.post(
        "/businesses",
        json={
            "name": "Acme Widgets",
            "industry": "ECOMMERCE",
            "description": "Original",
        },
    ).json()

    response = client.patch(f"/businesses/{created['id']}", json={})

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Acme Widgets"
    assert body["description"] == "Original"


def test_update_business_can_change_the_industry(client: TestClient) -> None:
    """industry can be changed via PATCH."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(
        f"/businesses/{created['id']}", json={"industry": "REAL_ESTATE"}
    )

    assert response.status_code == 200
    assert response.json()["industry"] == "REAL_ESTATE"


def test_update_business_rejects_an_invalid_industry(client: TestClient) -> None:
    """A PATCH with a value outside the fixed list returns 422."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(
        f"/businesses/{created['id']}", json={"industry": "MANUFACTURING"}
    )

    assert response.status_code == 422


# GET /businesses/industries moved to GET /options (test_options.py),
# confirmed 2026-09-08 — see that file for the industries-list assertions.
