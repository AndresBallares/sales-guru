"""Tests for BuyerAvatar.concepts: {slug, pillar, description} items, capped."""

import pytest
from app.schemas.buyer_avatar import MAX_CONCEPTS, AvatarConcept, normalise_concepts
from fastapi.testclient import TestClient
from pydantic import ValidationError


def _setup(client: TestClient) -> str:
    client.post(
        "/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )
    business_id = client.post(
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    return f"/businesses/{business_id}/avatars"


def test_the_cap_is_five() -> None:
    assert MAX_CONCEPTS == 5


def test_a_slug_is_derived_from_a_name_in_code() -> None:
    [concept] = normalise_concepts(
        [{"name": "The Last-Minute Rescue!", "pillar": "offer", "description": "d"}]
    )
    assert concept == AvatarConcept(
        slug="last-minute-rescue", pillar="offer", description="d"
    )


def test_an_existing_slug_is_kept_and_duplicates_are_suffixed() -> None:
    concepts = normalise_concepts(
        [
            {"slug": "solid-gold", "pillar": "mechanism", "description": "a"},
            {"name": "Solid gold", "pillar": "mechanism", "description": "b"},
        ]
    )
    assert [c.slug for c in concepts] == ["solid-gold", "solid-gold-2"]


def test_more_than_five_concepts_are_rejected() -> None:
    items = [
        {"name": f"Idea {n}", "pillar": "offer", "description": "d"} for n in range(6)
    ]
    with pytest.raises(ValueError, match="At most 5"):
        normalise_concepts(items)


def test_an_unknown_pillar_or_blank_description_is_rejected() -> None:
    with pytest.raises(ValidationError):
        normalise_concepts([{"name": "x", "pillar": "vibes", "description": "d"}])
    with pytest.raises(ValidationError):
        normalise_concepts([{"name": "x", "pillar": "offer", "description": "  "}])


def test_a_concept_needs_a_name_or_slug() -> None:
    with pytest.raises(ValueError, match="name"):
        normalise_concepts([{"pillar": "offer", "description": "d"}])


def test_concepts_round_trip_through_the_avatar_api(client: TestClient) -> None:
    url = _setup(client)
    created = client.post(
        url,
        json={
            "name": "A",
            "who": "w",
            "concepts": [
                {"name": "Rescue", "pillar": "offer", "description": "Fast gift"}
            ],
        },
    ).json()
    assert created["concepts"] == [
        {"slug": "rescue", "pillar": "offer", "description": "Fast gift"}
    ]

    patched = client.patch(
        f"{url}/{created['id']}",
        json={
            "concepts": [
                {"slug": "rescue", "pillar": "emotion", "description": "Edited"}
            ]
        },
    ).json()
    assert patched["concepts"] == [
        {"slug": "rescue", "pillar": "emotion", "description": "Edited"}
    ]
    assert (
        client.get(f"{url}/{created['id']}").json()["concepts"] == patched["concepts"]
    )


def test_an_avatar_without_concepts_returns_an_empty_list_and_patch_can_clear(
    client: TestClient,
) -> None:
    url = _setup(client)
    avatar = client.post(url, json={"name": "A", "who": "w"}).json()
    assert avatar["concepts"] == []
    client.patch(
        f"{url}/{avatar['id']}",
        json={"concepts": [{"name": "x", "pillar": "offer", "description": "d"}]},
    )
    cleared = client.patch(f"{url}/{avatar['id']}", json={"concepts": []}).json()
    assert cleared["concepts"] == []


def test_the_api_rejects_six_concepts(client: TestClient) -> None:
    url = _setup(client)
    items = [
        {"name": f"Idea {n}", "pillar": "offer", "description": "d"} for n in range(6)
    ]
    assert (
        client.post(url, json={"name": "A", "who": "w", "concepts": items}).status_code
        == 422
    )
