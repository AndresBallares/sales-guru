"""Tests for the buyer avatar lookups the Strategist and results labels use."""

import pytest
from app.services.buyer_avatars import assignable_avatars, avatars_by_id
from fastapi.testclient import TestClient
from prisma import Prisma


def _library(client: TestClient) -> tuple[str, dict[str, str]]:
    """A business with four avatars: live, inactive, deleted and a live second one."""
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
    url = f"/businesses/{business_id}/avatars"
    ids: dict[str, str] = {}
    for name, extra in (
        ("second", {"sortOrder": 2}),
        ("first", {"sortOrder": 1}),
        ("inactive", {"isActive": False}),
        ("deleted", {}),
    ):
        ids[name] = client.post(
            url, json={"name": name, "who": f"Who {name}", **extra}
        ).json()["id"]
    client.delete(f"{url}/{ids['deleted']}")
    return business_id, ids


@pytest.mark.asyncio
async def test_only_active_undeleted_avatars_can_be_assigned(
    client: TestClient,
) -> None:
    """New angles may pick only active, not-deleted avatars, in sort order."""
    business_id, ids = _library(client)
    db = Prisma()
    await db.connect()

    avatars = await assignable_avatars(business_id, client=db)
    await db.disconnect()

    assert [a.id for a in avatars] == [ids["first"], ids["second"]]


@pytest.mark.asyncio
async def test_every_avatar_resolves_by_id_for_labels(client: TestClient) -> None:
    """Deleted and inactive avatars still resolve, so old results keep their label."""
    business_id, ids = _library(client)
    db = Prisma()
    await db.connect()

    found = await avatars_by_id(
        business_id,
        [ids["deleted"], ids["inactive"], ids["first"], "missing"],
        client=db,
    )
    await db.disconnect()

    assert set(found) == {ids["deleted"], ids["inactive"], ids["first"]}
    assert found[ids["deleted"]].deletedAt is not None
    assert found[ids["deleted"]].name == "deleted"


@pytest.mark.asyncio
async def test_resolving_is_scoped_to_the_business(client: TestClient) -> None:
    """An id from another business does not resolve."""
    _, ids = _library(client)
    db = Prisma()
    await db.connect()

    found = await avatars_by_id("another-business", [ids["first"]], client=db)
    await db.disconnect()

    assert found == {}


@pytest.mark.asyncio
async def test_resolving_no_ids_reads_nothing(client: TestClient) -> None:
    """An empty id list is an empty result."""
    business_id, _ = _library(client)
    db = Prisma()
    await db.connect()

    found = await avatars_by_id(business_id, [], client=db)
    await db.disconnect()

    assert found == {}
