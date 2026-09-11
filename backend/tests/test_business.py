"""Tests for business onboarding endpoints."""

import struct

import httpx2
import pytest
from app.schemas.product_image import MAX_IMAGE_BYTES
from fastapi.testclient import TestClient
from prisma import Prisma


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


async def _set_campaign_status(campaign_id: str, status: str) -> None:
    """Set a campaign's status directly via a fresh connection.

    A real LIVE campaign only ever comes from a full publish flow (Meta
    OAuth, ad account, pixel, strategy, creative — see
    test_optimization_jobs.py's _live_campaign) — irrelevant to what
    delete_business itself checks, so this sets the one field its 409
    check actually reads, directly.
    """
    seeder = Prisma()
    await seeder.connect()
    await seeder.campaign.update(where={"id": campaign_id}, data={"status": status})
    await seeder.disconnect()


def _valid_jpeg(width: int = 800, height: int = 800) -> bytes:
    """A structurally-valid minimal JPEG — real header, fake scan data."""
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


_JPEG_BYTES = _valid_jpeg()


def _upload_logo(
    client: TestClient,
    business_id: str,
    *,
    filename: str = "logo.jpg",
    content: bytes = _JPEG_BYTES,
    content_type: str = "image/jpeg",
) -> httpx2.Response:
    return client.post(
        f"/businesses/{business_id}/logo",
        files={"file": (filename, content, content_type)},
    )


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


def test_update_business_can_change_the_website(client: TestClient) -> None:
    """website can be changed via PATCH."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(
        f"/businesses/{created['id']}", json={"website": "https://acme.example"}
    )

    assert response.status_code == 200
    assert response.json()["website"] == "https://acme.example"


def test_update_business_can_change_the_location(client: TestClient) -> None:
    """location can be changed via PATCH."""
    _signed_up_client(client)
    created = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()

    response = client.patch(f"/businesses/{created['id']}", json={"location": "CDMX"})

    assert response.status_code == 200
    assert response.json()["location"] == "CDMX"


def test_create_business_has_no_logo_url_by_default(client: TestClient) -> None:
    """A freshly created business has no logo yet."""
    _signed_up_client(client)

    response = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    )

    assert response.json()["logoUrl"] is None


def test_upload_logo_requires_a_session(client: TestClient) -> None:
    """Uploading a logo with no session cookie returns 401."""
    response = _upload_logo(client, "some-id")

    assert response.status_code == 401


def test_upload_logo_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Uploading a logo under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = _upload_logo(client, "does-not-exist")

    assert response.status_code == 404


def test_upload_logo_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't upload a logo for a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = client.post(
        "/businesses", json={"name": "Alice's Business", "industry": "ECOMMERCE"}
    ).json()["id"]
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = _upload_logo(client, business_id)

    assert response.status_code == 404


def test_upload_logo_succeeds_and_sets_logo_url(client: TestClient) -> None:
    """A supported image type uploads successfully and the business gets a logo_url."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]

    response = _upload_logo(client, business_id)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == business_id
    assert body["logoUrl"] == f"http://localhost:8000/business-logos/{business_id}"


def test_upload_logo_rejects_an_unsupported_content_type(client: TestClient) -> None:
    """A non-image content type is rejected."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]

    response = _upload_logo(
        client,
        business_id,
        filename="notes.txt",
        content=b"just some text",
        content_type="text/plain",
    )

    assert response.status_code == 400
    assert "Unsupported image type" in response.json()["detail"]


def test_upload_logo_rejects_a_file_over_the_size_limit(client: TestClient) -> None:
    """A file larger than MAX_IMAGE_BYTES is rejected, not silently truncated."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    oversized = b"\xff\xd8\xff\xe0" + b"x" * MAX_IMAGE_BYTES

    response = _upload_logo(client, business_id, content=oversized)

    assert response.status_code == 400
    assert "exceeds" in response.json()["detail"]


def test_upload_logo_replaces_a_previous_one(client: TestClient) -> None:
    """A second upload overwrites the first, not appends — only one logo
    per business ever exists."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    _upload_logo(client, business_id)

    response = _upload_logo(client, business_id, filename="new-logo.jpg")

    assert response.status_code == 200
    assert (
        response.json()["logoUrl"]
        == f"http://localhost:8000/business-logos/{business_id}"
    )


def test_serve_logo_returns_the_raw_bytes(client: TestClient) -> None:
    """GET /business-logos/{id} serves the stored bytes with the right content-type."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    _upload_logo(client, business_id)

    response = client.get(f"/business-logos/{business_id}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == _JPEG_BYTES


def test_serve_logo_404s_when_none_uploaded(client: TestClient) -> None:
    """A business with no logo yet 404s, not an empty response."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]

    response = client.get(f"/business-logos/{business_id}")

    assert response.status_code == 404


def test_serve_logo_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """A nonexistent business id 404s, same message as no-logo-yet."""
    response = client.get("/business-logos/does-not-exist")

    assert response.status_code == 404


def test_delete_business_requires_a_session(client: TestClient) -> None:
    """Deleting a business with no session cookie returns 401."""
    response = client.delete("/businesses/some-id")

    assert response.status_code == 401


def test_delete_business_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Deleting a business that doesn't exist returns 404."""
    _signed_up_client(client)

    response = client.delete("/businesses/does-not-exist")

    assert response.status_code == 404


def test_delete_business_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't delete a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    created = client.post(
        "/businesses", json={"name": "Alice's Business", "industry": "ECOMMERCE"}
    ).json()
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.delete(f"/businesses/{created['id']}")

    assert response.status_code == 404


def test_delete_business_succeeds_and_removes_it_from_list_and_get(
    client: TestClient,
) -> None:
    """A successful delete 204s, and the business disappears from both
    GET /businesses and GET /businesses/{id} afterward — same 404 as a
    business that never existed."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]

    response = client.delete(f"/businesses/{business_id}")

    assert response.status_code == 204
    assert client.get(f"/businesses/{business_id}").status_code == 404
    listed = client.get("/businesses").json()
    assert business_id not in [b["id"] for b in listed]


@pytest.mark.asyncio
async def test_delete_business_sets_deleted_at(client: TestClient) -> None:
    """The row itself is soft-deleted — deletedAt set, not removed."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]

    client.delete(f"/businesses/{business_id}")

    seeder = Prisma()
    await seeder.connect()
    business = await seeder.business.find_unique(where={"id": business_id})
    await seeder.disconnect()
    assert business is not None
    assert business.deletedAt is not None


@pytest.mark.asyncio
async def test_delete_business_409s_with_a_live_campaign(client: TestClient) -> None:
    """A LIVE campaign blocks deletion — the only status that means Meta
    could be actively spending against it right now."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    await _set_campaign_status(campaign_id, "LIVE")

    response = client.delete(f"/businesses/{business_id}")

    assert response.status_code == 409
    assert "live on Meta" in response.json()["detail"]
    # Not actually deleted — still fetchable, unchanged.
    assert client.get(f"/businesses/{business_id}").status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status",
    [
        "DRAFT",
        "READY",
        "STRATEGY_GENERATED",
        "ADS_GENERATED",
        "PENDING_APPROVAL",
        "APPROVED",
        "PAUSED",
        "FAILED",
    ],
)
async def test_delete_business_succeeds_with_any_non_live_campaign_status(
    client: TestClient, status: str
) -> None:
    """Every status other than LIVE is safe to delete alongside — including
    PAUSED regardless of why it paused (manual, end-date-elapsed, or a
    spend circuit breaker all land on the same PAUSED status)."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    await _set_campaign_status(campaign_id, status)

    response = client.delete(f"/businesses/{business_id}")

    assert response.status_code == 204


@pytest.mark.asyncio
async def test_delete_business_leaves_child_records_untouched(
    client: TestClient,
) -> None:
    """Products, campaigns, and the logo all survive a soft delete —
    only Business.deletedAt changes."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/logo",
        files={"file": ("logo.jpg", _valid_jpeg(), "image/jpeg")},
    )

    client.delete(f"/businesses/{business_id}")

    seeder = Prisma()
    await seeder.connect()
    product = await seeder.product.find_unique(where={"id": product_id})
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    business = await seeder.business.find_unique(where={"id": business_id})
    await seeder.disconnect()
    assert product is not None
    assert campaign is not None
    assert business is not None
    assert business.logoData is not None


def test_deleted_business_404s_for_update(client: TestClient) -> None:
    """A soft-deleted business can't be PATCHed either — same
    get_owned_business choke point as GET."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    client.delete(f"/businesses/{business_id}")

    response = client.patch(f"/businesses/{business_id}", json={"name": "New name"})

    assert response.status_code == 404


def test_deleted_business_logo_no_longer_served(client: TestClient) -> None:
    """A soft-deleted business's logo 404s too, even though logoData is
    still in the row — the public serve route checks deletedAt directly."""
    _signed_up_client(client)
    business_id = client.post(
        "/businesses", json={"name": "Acme Widgets", "industry": "ECOMMERCE"}
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/logo",
        files={"file": ("logo.jpg", _valid_jpeg(), "image/jpeg")},
    )
    client.delete(f"/businesses/{business_id}")

    response = client.get(f"/business-logos/{business_id}")

    assert response.status_code == 404


# GET /businesses/industries moved to GET /options (test_options.py),
# confirmed 2026-09-08 — see that file for the industries-list assertions.
