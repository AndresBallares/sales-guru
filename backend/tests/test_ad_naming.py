"""Tests for naming a batch of ads at publish time (app/services/ad_naming.py).

An ad written for a library avatar gets that avatar's slug in its name; any other
ad is named exactly as it always was. Names stay unique within a campaign.
"""

from typing import Any, cast

import pytest
from app.services.ad_naming import plan_ad_names
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.types import CreativeCreateInput


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
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    return business_id


def _avatar(client: TestClient, business_id: str, name: str) -> str:
    avatar_id: str = client.post(
        f"/businesses/{business_id}/avatars", json={"name": name, "who": "A buyer."}
    ).json()["id"]
    return avatar_id


async def _campaign(db: Prisma, business_id: str, name: str = "Snake-Ring") -> str:
    campaign = await db.campaign.create(
        data={"businessId": business_id, "name": name, "objective": "SALES"}
    )
    await db.adset.create(
        data={
            "campaignId": campaign.id,
            "name": "Ad set",
            "budget": 50.0,
            "optimizationGoal": "OFFSITE_CONVERSIONS",
            "status": "PAUSED",
        }
    )
    return campaign.id


async def _creative(db: Prisma, campaign_id: str, **fields: Any) -> Any:
    data: dict[str, Any] = {
        "campaignId": campaign_id,
        "headline": "Some headline",
        "bodyText": "Body",
        "cta": "SHOP_NOW",
        "avatar": "self_purchaser",
        "concept": "ceramic-inlay",
        "pillar": "mechanism",
    }
    data.update(fields)
    return await db.creative.create(data=cast(CreativeCreateInput, data))


async def _existing_ad(db: Prisma, campaign_id: str, name: str) -> None:
    ad_set = await db.adset.find_first(where={"campaignId": campaign_id})
    assert ad_set is not None
    await db.ad.create(data={"adSetId": ad_set.id, "name": name, "status": "LIVE"})


@pytest.mark.asyncio
async def test_an_avatar_ad_is_named_with_its_slug(client: TestClient) -> None:
    business_id = _business(client)
    avatar_id = _avatar(client, business_id, "The Promotion Ring Buyer")
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        creative = await _creative(db, campaign_id, buyerAvatarId=avatar_id)

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[creative],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names == {
        creative.id: "Self-purchaser (promotion-ring-buyer) – Ceramic inlay – Mechanism"
    }


@pytest.mark.asyncio
async def test_an_ad_with_no_avatar_keeps_its_old_name(client: TestClient) -> None:
    business_id = _business(client)
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        plain = await _creative(db, campaign_id)
        unstructured = await _creative(
            db, campaign_id, avatar=None, concept=None, pillar=None, headline="Hello"
        )
        unresolved = await _creative(db, campaign_id, buyerAvatarId="no-such-avatar")

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[plain, unstructured, unresolved],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names[plain.id] == "Self-purchaser – Ceramic inlay – Mechanism"
    assert names[unstructured.id] == "Hello"
    assert names[unresolved.id] == "Self-purchaser – Ceramic inlay – Mechanism"


@pytest.mark.asyncio
async def test_a_deleted_or_inactive_avatar_still_gives_its_slug(
    client: TestClient,
) -> None:
    business_id = _business(client)
    gone = _avatar(client, business_id, "Heirloom Commissioner")
    off = _avatar(client, business_id, "Quiet-Luxury Collector")
    client.delete(f"/businesses/{business_id}/avatars/{gone}")
    client.patch(f"/businesses/{business_id}/avatars/{off}", json={"isActive": False})
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        a = await _creative(db, campaign_id, buyerAvatarId=gone, concept="redesign")
        b = await _creative(db, campaign_id, buyerAvatarId=off, concept="logo-tax")

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[a, b],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names[a.id].startswith("Self-purchaser (heirloom-commissioner) – ")
    assert names[b.id].startswith("Self-purchaser (quiet-luxury-collector) – ")


@pytest.mark.asyncio
async def test_two_avatars_with_one_slug_get_distinct_names(client: TestClient) -> None:
    business_id = _business(client)
    first = _avatar(client, business_id, "The Ring Buyer")
    second = _avatar(client, business_id, "Ring Buyer")
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        a = await _creative(db, campaign_id, buyerAvatarId=first)
        b = await _creative(db, campaign_id, buyerAvatarId=second)

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[a, b],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names[a.id] == "Self-purchaser (ring-buyer) – Ceramic inlay – Mechanism"
    assert names[b.id] == "Self-purchaser (ring-buyer-2) – Ceramic inlay – Mechanism"
    assert len(set(names.values())) == 2


@pytest.mark.asyncio
async def test_a_name_already_used_in_the_campaign_is_not_reused(
    client: TestClient,
) -> None:
    business_id = _business(client)
    avatar_id = _avatar(client, business_id, "Ring Buyer")
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        other_id = await _campaign(db, business_id, name="Other")
        await _existing_ad(
            db, campaign_id, "Self-purchaser (ring-buyer) – Ceramic inlay – Mechanism"
        )
        # The same name in another campaign does not count against this one.
        await _existing_ad(
            db, other_id, "Self-purchaser (ring-buyer-2) – Ceramic inlay – Mechanism"
        )
        creative = await _creative(db, campaign_id, buyerAvatarId=avatar_id)

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[creative],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names[creative.id] == (
        "Self-purchaser (ring-buyer-2) – Ceramic inlay – Mechanism"
    )


@pytest.mark.asyncio
async def test_another_businesss_avatar_is_not_used_for_a_slug(
    client: TestClient,
) -> None:
    business_id = _business(client)
    other = client.post(
        "/businesses", json={"name": "Other Co", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    foreign = _avatar(client, other, "Somebody Else")
    db = Prisma()
    await db.connect()
    try:
        campaign_id = await _campaign(db, business_id)
        creative = await _creative(db, campaign_id, buyerAvatarId=foreign)

        names = await plan_ad_names(
            business_id=business_id,
            campaign_id=campaign_id,
            creatives=[creative],
            client=db,
        )
    finally:
        await db.disconnect()

    assert names[creative.id] == "Self-purchaser – Ceramic inlay – Mechanism"
