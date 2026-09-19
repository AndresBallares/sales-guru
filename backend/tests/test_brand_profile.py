"""Tests for the Brand Profile ("brand DNA") endpoints (PRD.md §5 step 3.5)."""

from fastapi.testclient import TestClient


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post(
        "/businesses", json={"name": name, "industry": "FASHION_JEWELRY"}
    )
    id_: str = response.json()["id"]
    return id_


def _valid_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "description": "Family-run studio making handcrafted gold jewelry.",
        "idealCustomer": "Women 30-55 buying for milestones and self-purchase.",
        "voiceTraits": ["WARM", "ARTISANAL"],
        "pricePositioning": "PREMIUM",
    }
    payload.update(overrides)
    return payload


def test_create_brand_profile_requires_a_session(client: TestClient) -> None:
    """Creating a profile with no session cookie returns 401."""
    response = client.post("/businesses/some-id/brand-profile", json=_valid_payload())

    assert response.status_code == 401


def test_create_brand_profile_404s_for_a_nonexistent_business(
    client: TestClient,
) -> None:
    """Creating a profile under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = client.post(
        "/businesses/does-not-exist/brand-profile", json=_valid_payload()
    )

    assert response.status_code == 404


def test_create_brand_profile_404s_for_another_users_business(
    client: TestClient,
) -> None:
    """A user can't create a brand profile for a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    )

    assert response.status_code == 404


def test_create_brand_profile_with_only_required_fields(client: TestClient) -> None:
    """description/ideal_customer/voice_traits/price_positioning are
    required; everything else defaults to null."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    )

    assert response.status_code == 201
    body = response.json()
    assert body["businessId"] == business_id
    assert body["description"] == "Family-run studio making handcrafted gold jewelry."
    assert body["idealCustomer"] == (
        "Women 30-55 buying for milestones and self-purchase."
    )
    assert body["voiceTraits"] == ["WARM", "ARTISANAL"]
    assert body["pricePositioning"] == "PREMIUM"
    assert body["brandPhrases"] is None
    assert body["avoidPhrases"] is None
    assert body["tagline"] is None
    assert body["competitors"] is None
    assert body["exampleCopy"] is None
    assert body["proofPoints"] == []
    assert body["offer"] is None
    assert body["logoUrl"] is None
    assert "id" in body


def test_create_brand_profile_with_every_field(client: TestClient) -> None:
    """Every optional field round-trips correctly too."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(
            brandPhrases="handcrafted, one-of-a-kind, heirloom",
            avoidPhrases="cheap, discount, mass-produced",
            tagline="Wear your story",
            competitors="Big-box chain jewelers",
            exampleCopy="No two Venzi pieces feel the same.",
            proofPoints=["4.8★ from 2,100 reviews", "Free shipping over $75"],
            offer="20% off first order with WELCOME20",
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["brandPhrases"] == "handcrafted, one-of-a-kind, heirloom"
    assert body["avoidPhrases"] == "cheap, discount, mass-produced"
    assert body["tagline"] == "Wear your story"
    assert body["competitors"] == "Big-box chain jewelers"
    assert body["exampleCopy"] == "No two Venzi pieces feel the same."
    assert body["proofPoints"] == ["4.8★ from 2,100 reviews", "Free shipping over $75"]
    assert body["offer"] == "20% off first order with WELCOME20"


def test_create_brand_profile_strips_blank_proof_points(client: TestClient) -> None:
    """Blank/whitespace-only proof points are dropped, not stored as-is."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(proofPoints=["Free shipping over $75", "   ", ""]),
    )

    assert response.status_code == 201
    assert response.json()["proofPoints"] == ["Free shipping over $75"]


def test_create_brand_profile_rejects_a_too_long_proof_point(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(proofPoints=["x" * 201]),
    )

    assert response.status_code == 422


def test_create_brand_profile_accepts_each_fields_new_max_length(
    client: TestClient,
) -> None:
    """Raised caps (confirmed 2026-09-11): idealCustomer/competitors to
    1000, brand/avoidPhrases to 750 — each field's new limit is accepted
    right up to the boundary, not just comfortably under it."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(
            idealCustomer="c" * 1000,
            brandPhrases="p" * 750,
            avoidPhrases="p" * 750,
            competitors="c" * 1000,
        ),
    )

    assert response.status_code == 201
    body = response.json()
    assert len(body["idealCustomer"]) == 1000
    assert len(body["brandPhrases"]) == 750
    assert len(body["avoidPhrases"]) == 750
    assert len(body["competitors"]) == 1000


def test_create_brand_profile_rejects_one_character_past_the_new_max_length(
    client: TestClient,
) -> None:
    """One character past the new idealCustomer cap (1000) still 422s —
    the cap moved, it didn't disappear."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(idealCustomer="c" * 1001),
    )

    assert response.status_code == 422


def test_create_brand_profile_requires_description(client: TestClient) -> None:
    """Omitting the required description field returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)
    payload = _valid_payload()
    del payload["description"]

    response = client.post(f"/businesses/{business_id}/brand-profile", json=payload)

    assert response.status_code == 422


def test_create_brand_profile_requires_at_least_one_voice_trait(
    client: TestClient,
) -> None:
    """An empty voice_traits list returns 422 — at least one is required."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(voiceTraits=[]),
    )

    assert response.status_code == 422


def test_create_brand_profile_rejects_an_invalid_voice_trait(
    client: TestClient,
) -> None:
    """A value outside the fixed voice-trait list returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(voiceTraits=["FRIENDLY"]),
    )

    assert response.status_code == 422


def test_create_brand_profile_rejects_an_invalid_price_positioning(
    client: TestClient,
) -> None:
    """A value outside the fixed price-positioning list returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(pricePositioning="BUDGET"),
    )

    assert response.status_code == 422


def test_create_brand_profile_400s_if_one_already_exists(client: TestClient) -> None:
    """A second POST for the same business is rejected — PATCH edits it instead."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/brand-profile", json=_valid_payload())

    response = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    )

    assert response.status_code == 400
    assert "already has a brand profile" in response.json()["detail"]


def test_create_brand_profile_includes_the_business_logo_url_when_uploaded(
    client: TestClient,
) -> None:
    """logo_url is populated from the parent business, not left null, once
    a logo has been uploaded."""
    _signed_up_client(client)
    business_id = _create_business(client)
    logo_bytes = b"\xff\xd8\xff\xe0fake jpeg bytes"
    client.post(
        f"/businesses/{business_id}/logo",
        files={"file": ("logo.jpg", logo_bytes, "image/jpeg")},
    )

    response = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    )

    assert response.status_code == 201
    assert (
        response.json()["logoUrl"]
        == f"http://localhost:8000/business-logos/{business_id}"
    )


def test_get_brand_profile_requires_a_session(client: TestClient) -> None:
    """Fetching a profile with no session cookie returns 401."""
    response = client.get("/businesses/some-id/brand-profile")

    assert response.status_code == 401


def test_get_brand_profile_404s_when_none_exists(client: TestClient) -> None:
    """A business with no brand profile yet 404s, not an empty object."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(f"/businesses/{business_id}/brand-profile")

    assert response.status_code == 404
    assert response.json()["detail"] == "This business has no brand profile yet"


def test_get_brand_profile_returns_it_once_created(client: TestClient) -> None:
    """Fetching after creation returns the same representation."""
    _signed_up_client(client)
    business_id = _create_business(client)
    created = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    ).json()

    response = client.get(f"/businesses/{business_id}/brand-profile")

    assert response.status_code == 200
    assert response.json() == created


def test_update_brand_profile_requires_a_session(client: TestClient) -> None:
    """Updating a profile with no session cookie returns 401."""
    response = client.patch("/businesses/some-id/brand-profile", json={})

    assert response.status_code == 401


def test_update_brand_profile_404s_when_none_exists(client: TestClient) -> None:
    """PATCH with no profile yet 404s — create one first via POST."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.patch(
        f"/businesses/{business_id}/brand-profile", json={"tagline": "New tagline"}
    )

    assert response.status_code == 404


def test_update_brand_profile_changes_only_provided_fields(client: TestClient) -> None:
    """A partial update leaves omitted fields exactly as they were —
    exercises every multi-word field's camelCase round-trip, not just the
    single-word ones."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/brand-profile", json=_valid_payload())

    response = client.patch(
        f"/businesses/{business_id}/brand-profile",
        json={
            "idealCustomer": "Updated ideal customer",
            "voiceTraits": ["BOLD", "EDGY", "PLAYFUL"],
            "pricePositioning": "LUXURY",
            "brandPhrases": "iconic, statement piece",
            "avoidPhrases": "basic, generic",
            "tagline": "Updated tagline",
            "competitors": "Updated competitors",
            "exampleCopy": "Updated example copy",
            "proofPoints": ["Lifetime tarnish guarantee"],
            "offer": "Free engraving this month",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "Family-run studio making handcrafted gold jewelry."
    assert body["idealCustomer"] == "Updated ideal customer"
    assert body["voiceTraits"] == ["BOLD", "EDGY", "PLAYFUL"]
    assert body["pricePositioning"] == "LUXURY"
    assert body["brandPhrases"] == "iconic, statement piece"
    assert body["avoidPhrases"] == "basic, generic"
    assert body["tagline"] == "Updated tagline"
    assert body["competitors"] == "Updated competitors"
    assert body["exampleCopy"] == "Updated example copy"
    assert body["proofPoints"] == ["Lifetime tarnish guarantee"]
    assert body["offer"] == "Free engraving this month"


def test_update_brand_profile_can_clear_proof_points_and_offer(
    client: TestClient,
) -> None:
    """An explicit empty list/null actually clears them, distinct from
    omitting the field (which leaves them untouched)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(
        f"/businesses/{business_id}/brand-profile",
        json=_valid_payload(
            proofPoints=["Free shipping over $75"], offer="20% off first order"
        ),
    )

    response = client.patch(
        f"/businesses/{business_id}/brand-profile",
        json={"proofPoints": [], "offer": None},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["proofPoints"] == []
    assert body["offer"] is None


def test_update_brand_profile_with_an_empty_body_changes_nothing(
    client: TestClient,
) -> None:
    """An empty PATCH body is a no-op, not an error."""
    _signed_up_client(client)
    business_id = _create_business(client)
    created = client.post(
        f"/businesses/{business_id}/brand-profile", json=_valid_payload()
    ).json()

    response = client.patch(f"/businesses/{business_id}/brand-profile", json={})

    assert response.status_code == 200
    assert response.json() == created


def test_update_brand_profile_rejects_an_invalid_voice_trait(
    client: TestClient,
) -> None:
    """A PATCH with a value outside the fixed voice-trait list returns 422."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/brand-profile", json=_valid_payload())

    response = client.patch(
        f"/businesses/{business_id}/brand-profile",
        json={"voiceTraits": ["FRIENDLY"]},
    )

    assert response.status_code == 422


def test_update_brand_profile_404s_for_another_users_business(
    client: TestClient,
) -> None:
    """A user can't edit a brand profile for a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/brand-profile", json=_valid_payload())
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.patch(
        f"/businesses/{business_id}/brand-profile", json={"tagline": "Hijacked"}
    )

    assert response.status_code == 404
