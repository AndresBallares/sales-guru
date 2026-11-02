"""Phase 6: the buyer avatar is visible on creatives and on the dashboard.

A creative response says which library avatar it was written for (with the
avatar's state), and each dashboard ad row carries the same. The numbers, the
leader and the stored ad names are untouched. The Snake-Ring tests mirror the
first live avatar campaign: published ads with old-style names whose creatives
already carry a buyerAvatarId.
"""

from collections.abc import Awaitable, Callable
from typing import Any, cast

from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.types import CreativeCreateInput

from tests.test_dashboard import (
    _create_business,
    _run,
    _seed_campaign,
    _seed_metric,
    _signed_up_client,
)


def _avatar(client: TestClient, business_id: str, name: str, **extra: Any) -> str:
    payload = {"name": name, "who": f"{name} buys fine jewelry.", **extra}
    response = client.post(f"/businesses/{business_id}/avatars", json=payload)
    assert response.status_code == 201, response.text
    avatar_id: str = response.json()["id"]
    return avatar_id


async def _with_db[T](func: Callable[[Prisma], Awaitable[T]]) -> T:
    seeder = Prisma()
    await seeder.connect()
    try:
        return await func(seeder)
    finally:
        await seeder.disconnect()


async def _seed_creative(campaign_id: str, **fields: Any) -> str:
    async def go(db: Prisma) -> str:
        data: dict[str, Any] = {
            "campaignId": campaign_id,
            "headline": "Headline",
            "bodyText": "Body",
            "cta": "SHOP_NOW",
            **fields,
        }
        creative = await db.creative.create(data=cast(CreativeCreateInput, data))
        return creative.id

    return await _with_db(go)


async def _seed_ad(adset_id: str, name: str) -> str:
    async def go(db: Prisma) -> str:
        ad = await db.ad.create(
            data={
                "adSetId": adset_id,
                "name": name,
                "status": "LIVE",
                "metaAdId": f"meta_{name}",
            }
        )
        return ad.id

    return await _with_db(go)


async def _ad_set_id(campaign_id: str) -> str:
    async def go(db: Prisma) -> str:
        row = await db.adset.find_first(where={"campaignId": campaign_id})
        assert row is not None
        return row.id

    return await _with_db(go)


async def _link(creative_id: str, ad_id: str) -> None:
    async def go(db: Prisma) -> None:
        await db.creative.update(
            where={"id": creative_id}, data={"ad": {"connect": {"id": ad_id}}}
        )

    await _with_db(go)


async def _ad_names(campaign_id: str) -> list[str]:
    async def go(db: Prisma) -> list[str]:
        ads = await db.ad.find_many(
            where={"adSet": {"is": {"campaignId": campaign_id}}},
            order={"createdAt": "asc"},
        )
        return [a.name for a in ads]

    return await _with_db(go)


def _creatives(client: TestClient, business_id: str, campaign_id: str) -> list[Any]:
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )
    assert response.status_code == 200, response.text
    return list(response.json())


def _dashboard(client: TestClient, business_id: str, campaign_id: str) -> Any:
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/dashboard"
    )
    assert response.status_code == 200, response.text
    return response.json()


def _setup(client: TestClient) -> tuple[str, str]:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _run(client, _seed_campaign, business_id)
    return business_id, campaign_id


# ── Creatives carry their avatar ─────────────────────────────────────────


def test_a_creative_reports_its_library_avatar_and_angle_fields(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    avatar_id = _avatar(client, business_id, "The Promotion Ring Buyer")
    _run(
        client,
        lambda: _seed_creative(
            campaign_id,
            creativeAngle="Self-purchaser – Ceramic inlay – Mechanism",
            avatar="self_purchaser",
            concept="ceramic-inlay",
            pillar="mechanism",
            buyerAvatarId=avatar_id,
        ),
    )

    (creative,) = _creatives(client, business_id, campaign_id)

    assert creative["avatar"] == "self_purchaser"
    assert creative["concept"] == "ceramic-inlay"
    assert creative["pillar"] == "mechanism"
    assert creative["buyerAvatarId"] == avatar_id
    assert creative["buyerAvatar"] == {
        "id": avatar_id,
        "name": "The Promotion Ring Buyer",
        "state": "active",
    }
    # The matching key is not touched.
    assert creative["creativeAngle"] == "Self-purchaser – Ceramic inlay – Mechanism"


def test_a_deactivated_avatar_is_inactive_and_a_deleted_one_archived(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    inactive = _avatar(client, business_id, "Plated-Burned Upgrader")
    deleted = _avatar(client, business_id, "Heirloom Commissioner")
    client.patch(
        f"/businesses/{business_id}/avatars/{inactive}", json={"isActive": False}
    )
    client.delete(f"/businesses/{business_id}/avatars/{deleted}")
    for avatar_id in (inactive, deleted):
        _run(
            client,
            lambda a=avatar_id: _seed_creative(
                campaign_id, avatar="self_purchaser", buyerAvatarId=a
            ),
        )

    states = {
        c["buyerAvatar"]["name"]: c["buyerAvatar"]["state"]
        for c in _creatives(client, business_id, campaign_id)
    }

    assert states == {
        "Plated-Burned Upgrader": "inactive",
        "Heirloom Commissioner": "archived",
    }


def test_a_creative_without_an_avatar_has_none_and_keeps_its_label(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    _run(
        client,
        lambda: _seed_creative(
            campaign_id,
            creativeAngle="Gift buyer – Not the same ring – Education",
            avatar="gift_buyer",
            concept="not-the-same-ring",
            pillar="education",
        ),
    )

    (creative,) = _creatives(client, business_id, campaign_id)

    assert creative["buyerAvatarId"] is None
    assert creative["buyerAvatar"] is None
    assert creative["creativeAngle"] == "Gift buyer – Not the same ring – Education"


def test_an_avatar_id_that_no_longer_resolves_is_reported_as_none(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    _run(
        client,
        lambda: _seed_creative(campaign_id, buyerAvatarId="gone-for-good"),
    )

    (creative,) = _creatives(client, business_id, campaign_id)

    assert creative["buyerAvatarId"] == "gone-for-good"
    assert creative["buyerAvatar"] is None


def test_another_businesses_avatar_is_never_resolved(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)
    other = _create_business(client, name="Other Co")
    foreign = _avatar(client, other, "Somebody Else's Buyer")
    _run(client, lambda: _seed_creative(campaign_id, buyerAvatarId=foreign))

    (creative,) = _creatives(client, business_id, campaign_id)

    assert creative["buyerAvatar"] is None


# ── Snake-Ring: published ads, old-style names, avatars on the creatives ──

_SNAKE_RING = [
    # (published name, avatar, concept, pillar, library avatar, spend, add-to-carts)
    (
        "Gift buyer – Founder led gift – Emotion",
        "gift_buyer",
        "founder-led-gift",
        "emotion",
        "The Deadline Gift-Giver",
        40.0,
        9,
    ),
    (
        "Self-purchaser – Ceramic inlay – Mechanism",
        "self_purchaser",
        "ceramic-inlay",
        "mechanism",
        "The Promotion Ring Buyer",
        40.0,
        8,
    ),
    (
        "Self-purchaser – Collector grade stone – Mechanism",
        "self_purchaser",
        "collector-grade-stone",
        "mechanism",
        "The Quiet-Luxury Collector",
        40.0,
        7,
    ),
    (
        "Self-purchaser – Logo tax – Education",
        "self_purchaser",
        "logo-tax",
        "education",
        "The Quiet-Luxury Collector",
        40.0,
        6,
    ),
]


def _snake_ring(client: TestClient) -> tuple[str, str, list[str]]:
    """A published (paused) creative test whose ads predate slugs in names."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _run(
        client, lambda: _seed_campaign(business_id, name="Snake-Ring", status="PAUSED")
    )
    ad_set_id = _run(client, lambda: _ad_set_id(campaign_id))
    avatar_ids: dict[str, str] = {}
    ad_ids: list[str] = []
    _run(
        client,
        lambda: _seed_metric(
            campaign_id, impressions=16000, spend=160.0, link_clicks=160, add_to_cart=30
        ),
    )
    for name, avatar, concept, pillar, library, spend, atc in _SNAKE_RING:
        if library not in avatar_ids:
            avatar_ids[library] = _avatar(client, business_id, library)
        ad_id = _run(client, lambda n=name: _seed_ad(ad_set_id, n))
        creative_id = _run(
            client,
            lambda n=name, a=avatar, c=concept, p=pillar, lib=library: _seed_creative(
                campaign_id,
                creativeAngle=n,
                avatar=a,
                concept=c,
                pillar=p,
                buyerAvatarId=avatar_ids[lib],
            ),
        )
        _run(client, lambda c=creative_id, a=ad_id: _link(c, a))
        _run(
            client,
            lambda a=ad_id, s=spend, t=atc: _seed_metric(
                campaign_id,
                ad_id=a,
                ad_set_id=ad_set_id,
                spend=s,
                add_to_cart=t,
                link_clicks=40,
            ),
        )
        ad_ids.append(ad_id)
    return business_id, campaign_id, ad_ids


def test_snake_ring_creatives_show_their_avatars_and_ad_names_stay_as_published(
    client: TestClient,
) -> None:
    business_id, campaign_id, _ = _snake_ring(client)
    before = _run(client, lambda: _ad_names(campaign_id))

    creatives = _creatives(client, business_id, campaign_id)
    _creatives(client, business_id, campaign_id)

    assert [c["buyerAvatar"]["name"] for c in creatives] == [
        "The Deadline Gift-Giver",
        "The Promotion Ring Buyer",
        "The Quiet-Luxury Collector",
        "The Quiet-Luxury Collector",
    ]
    assert [c["creativeAngle"] for c in creatives] == [row[0] for row in _SNAKE_RING]
    assert _run(client, lambda: _ad_names(campaign_id)) == before
    assert before == [row[0] for row in _SNAKE_RING]


def test_snake_ring_dashboard_rows_name_the_avatar_and_pillar(
    client: TestClient,
) -> None:
    business_id, campaign_id, ad_ids = _snake_ring(client)
    before = _run(client, lambda: _ad_names(campaign_id))

    tier3 = _dashboard(client, business_id, campaign_id)["tier3"]

    rows = {r["adId"]: r for r in tier3["ads"]}
    first = rows[ad_ids[1]]
    assert first["name"] == "Self-purchaser – Ceramic inlay – Mechanism"
    assert first["avatarName"] == "The Promotion Ring Buyer"
    assert first["avatarState"] == "active"
    assert first["pillar"] == "mechanism"
    assert first["concept"] == "ceramic-inlay"
    # Two ads share one avatar and still each report it.
    assert rows[ad_ids[2]]["avatarName"] == rows[ad_ids[3]]["avatarName"]
    assert _run(client, lambda: _ad_names(campaign_id)) == before


def test_the_leader_is_chosen_exactly_as_before_and_gains_only_its_avatar(
    client: TestClient,
) -> None:
    business_id, campaign_id, ad_ids = _snake_ring(client)

    tier3 = _dashboard(client, business_id, campaign_id)["tier3"]

    # Same spend, so the most add-to-carts wins: the gift ad. Ranking unchanged.
    assert tier3["leader"] == {"adId": ad_ids[0], "basis": "cost_per_add_to_cart"}
    assert tier3["leaderMessage"] == "Leading on cost per add-to-cart"
    leader_row = next(r for r in tier3["ads"] if r["isLeader"])
    assert leader_row["adId"] == ad_ids[0]
    assert leader_row["avatarName"] == "The Deadline Gift-Giver"
    assert [r["isLeader"] for r in tier3["ads"]].count(True) == 1


def test_deleted_and_inactive_avatars_still_label_dashboard_rows(
    client: TestClient,
) -> None:
    business_id, campaign_id, ad_ids = _snake_ring(client)
    avatars = client.get(f"/businesses/{business_id}/avatars").json()
    by_name = {a["name"]: a["id"] for a in avatars}
    client.delete(
        f"/businesses/{business_id}/avatars/{by_name['The Deadline Gift-Giver']}"
    )
    client.patch(
        f"/businesses/{business_id}/avatars/{by_name['The Promotion Ring Buyer']}",
        json={"isActive": False},
    )

    rows = {
        r["adId"]: r
        for r in _dashboard(client, business_id, campaign_id)["tier3"]["ads"]
    }

    assert rows[ad_ids[0]]["avatarName"] == "The Deadline Gift-Giver"
    assert rows[ad_ids[0]]["avatarState"] == "archived"
    assert rows[ad_ids[1]]["avatarState"] == "inactive"
    assert rows[ad_ids[2]]["avatarState"] == "active"


def test_an_ad_without_an_avatar_has_empty_avatar_fields(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id))
    ad_set_id = _run(client, lambda: _ad_set_id(campaign_id))
    _run(
        client,
        lambda: _seed_metric(campaign_id, impressions=8000, spend=80.0, add_to_cart=15),
    )
    for name, atc in (("Ad A", 9), ("Ad B", 6)):
        ad_id = _run(client, lambda n=name: _seed_ad(ad_set_id, n))
        _run(
            client,
            lambda a=ad_id, t=atc: _seed_metric(
                campaign_id, ad_id=a, ad_set_id=ad_set_id, spend=40.0, add_to_cart=t
            ),
        )

    rows = _dashboard(client, business_id, campaign_id)["tier3"]["ads"]

    for row in rows:
        assert row["avatarName"] is None
        assert row["avatarState"] is None
        assert row["pillar"] is None
        assert row["concept"] is None
    assert [r["name"] for r in rows] == ["Ad A", "Ad B"]
