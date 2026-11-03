"""Tests for loading the research template's inputs from a business's saved data."""

import json

import pytest
from app.services.research_template import load_template_inputs
from fastapi.testclient import TestClient
from prisma import Prisma


def _business(client: TestClient) -> str:
    client.post(
        "/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )
    business_id: str = client.post(
        "/businesses",
        json={"name": "Acme", "industry": "FASHION_JEWELRY", "description": "Biz desc"},
    ).json()["id"]
    return business_id


async def _product(db: Prisma, business_id: str, name: str) -> str:
    product = await db.product.create(
        data={
            "businessId": business_id,
            "name": name,
            "description": f"{name} desc",
        }
    )
    return product.id


@pytest.mark.asyncio
async def test_defaults_to_the_most_recent_product_with_no_campaigns(
    client: TestClient,
) -> None:
    business_id = _business(client)
    db = Prisma()
    await db.connect()
    await _product(db, business_id, "old")
    await _product(db, business_id, "newest")

    inputs = await load_template_inputs(business_id, client=db)
    await db.disconnect()

    assert [p.name for p in inputs.products] == ["newest"]
    assert inputs.business_description == "Biz desc"


@pytest.mark.asyncio
async def test_owner_choice_wins_and_is_capped_at_three(client: TestClient) -> None:
    business_id = _business(client)
    db = Prisma()
    await db.connect()
    ids = [await _product(db, business_id, f"p{n}") for n in range(4)]

    chosen = await load_template_inputs(
        business_id, product_ids=[ids[2], ids[0]], client=db
    )
    with pytest.raises(ValueError, match="at most 3"):
        await load_template_inputs(business_id, product_ids=ids, client=db)
    await db.disconnect()

    assert [p.name for p in chosen.products] == ["p2", "p0"]


@pytest.mark.asyncio
async def test_a_product_of_another_business_is_rejected(client: TestClient) -> None:
    business_id = _business(client)
    other = client.post(
        "/businesses", json={"name": "Other", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    db = Prisma()
    await db.connect()
    foreign = await _product(db, other, "foreign")

    with pytest.raises(ValueError, match="not found"):
        await load_template_inputs(business_id, product_ids=[foreign], client=db)
    await db.disconnect()


@pytest.mark.asyncio
async def test_without_a_choice_it_uses_products_of_the_three_most_recent_campaigns(
    client: TestClient,
) -> None:
    business_id = _business(client)
    db = Prisma()
    await db.connect()
    ids = [await _product(db, business_id, f"p{n}") for n in range(5)]
    for n in (0, 1, 2, 3):  # oldest campaign first; p3's campaign is the newest
        await db.campaign.create(
            data={"businessId": business_id, "productId": ids[n], "objective": "SALES"}
        )
    await db.campaign.create(
        data={"businessId": business_id, "productId": ids[3], "objective": "SALES"}
    )

    inputs = await load_template_inputs(business_id, client=db)
    await db.disconnect()

    assert [p.name for p in inputs.products] == ["p3", "p2", "p1"]


@pytest.mark.asyncio
async def test_brand_profile_rules_and_avatars_are_read(client: TestClient) -> None:
    business_id = _business(client)
    client.post(
        f"/businesses/{business_id}/brand-profile",
        json={
            "description": "Profile desc",
            "idealCustomer": "Ideal",
            "voiceTraits": ["WARM"],
            "pricePositioning": "PREMIUM",
            "competitors": "https://rival.example",
            "offer": "10% off",
            "proofPoints": ["4.8 stars"],
            "keyMessages": ["Gold that lasts"],
            "customerProblems": ["Plating fades"],
            "mechanisms": ["Solid gold"],
        },
    )
    client.put(
        f"/businesses/{business_id}/brand-rules",
        json={"bannedPhrases": ["cheap"], "requiredDisclosures": []},
    )
    avatar_url = f"/businesses/{business_id}/avatars"
    client.post(avatar_url, json={"name": "Live", "who": "Someone"})
    gone = client.post(avatar_url, json={"name": "Gone", "who": "x"}).json()["id"]
    client.delete(f"{avatar_url}/{gone}")
    client.post(avatar_url, json={"name": "Off", "who": "x", "isActive": False})
    db = Prisma()
    await db.connect()

    inputs = await load_template_inputs(business_id, client=db)
    await db.disconnect()

    assert inputs.brand_description == "Profile desc"
    assert inputs.price_positioning == "PREMIUM"
    assert inputs.offer == "10% off"
    assert inputs.proof_points == ["4.8 stars"]
    assert inputs.key_messages == ["Gold that lasts"]
    assert inputs.customer_problems == ["Plating fades"]
    assert inputs.mechanisms == ["Solid gold"]
    assert inputs.banned_phrases == ["cheap"]
    assert inputs.existing_avatars == [("Live", "Someone")]
    assert json.dumps(inputs.competitors_text) == '"https://rival.example"'


@pytest.mark.asyncio
async def test_a_business_with_no_profile_still_loads(client: TestClient) -> None:
    business_id = _business(client)
    db = Prisma()
    await db.connect()
    inputs = await load_template_inputs(business_id, client=db)
    await db.disconnect()
    assert inputs.brand_name == "Acme"
    assert inputs.products == []
    assert inputs.banned_phrases == []
