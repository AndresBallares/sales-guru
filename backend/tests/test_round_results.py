"""Which ad is winning a creative test, for the next round's Strategist.

The winner is the dashboard's leader (app.services.dashboard.choose_leader),
unchanged, so it matches what the owner sees. These tests cover mapping that ad
back to the angle (and library avatar) it was written for.
"""

from datetime import UTC, datetime

import pytest
from app.services.creative_naming import angle_label
from app.services.dashboard import Totals
from app.services.round_results import (
    AdAngle,
    build_round_results,
    load_round_results,
)
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_dashboard import _seed_ads, _seed_campaign, _seed_metric
from tests.test_strategy import _create_business, _signed_up_client

_AT = datetime(2026, 11, 1, tzinfo=UTC)


def _totals(
    spend: float, add_to_cart: int | None = None, purchases: int | None = None
) -> Totals:
    return Totals(
        impressions=1000,
        spend=spend,
        link_clicks=None,
        landing_page_views=None,
        add_to_cart=add_to_cart,
        initiated_checkout=None,
        purchases=purchases,
        purchase_value=None,
        as_of=_AT,
    )


def _angle(label: str, buyer_avatar_id: str | None = "cav1") -> AdAngle:
    return AdAngle(
        label=label,
        buyer_avatar_id=buyer_avatar_id,
        avatar="self_purchaser",
        concept=label.lower().replace(" ", "-"),
        pillar="emotion",
    )


def test_no_ad_numbers_means_no_results() -> None:
    assert build_round_results({}, {}) is None


def test_the_cheaper_add_to_cart_leads_and_the_dearest_is_the_weakest() -> None:
    per_ad = {
        "ad1": _totals(100, add_to_cart=10),  # $10.00
        "ad2": _totals(100, add_to_cart=5),  # $20.00
        "ad3": _totals(90, add_to_cart=6),  # $15.00
    }
    angles = {"ad1": _angle("One", "cav-a"), "ad2": _angle("Two", "cav-b")}

    results = build_round_results(per_ad, angles)

    assert results is not None
    assert results.basis == "cost_per_add_to_cart"
    assert results.ads_compared == 3
    assert results.leader is not None
    assert (results.leader.ad_id, results.leader.cost, results.leader.results) == (
        "ad1",
        10.0,
        10,
    )
    assert results.leader.angle.buyer_avatar_id == "cav-a"
    assert results.weakest is not None
    assert (results.weakest.ad_id, results.weakest.cost) == ("ad2", 20.0)


def test_cost_per_purchase_decides_once_every_ad_has_ten_purchases() -> None:
    per_ad = {
        "ad1": _totals(500, add_to_cart=50, purchases=10),  # CAC $50
        "ad2": _totals(300, add_to_cart=5, purchases=10),  # CAC $30
    }

    results = build_round_results(per_ad, {})

    assert results is not None
    assert results.basis == "cac"
    assert results.leader is not None
    assert results.leader.ad_id == "ad2"


def test_too_little_data_has_no_leader_but_still_counts_the_ads() -> None:
    per_ad = {"ad1": _totals(40, add_to_cart=4), "ad2": _totals(50, add_to_cart=9)}

    results = build_round_results(per_ad, {})

    assert results is not None
    assert (results.leader, results.weakest, results.basis) == (None, None, None)
    assert results.ads_compared == 2


def test_one_ad_alone_has_no_leader() -> None:
    results = build_round_results({"ad1": _totals(100, add_to_cart=10)}, {})

    assert results is not None
    assert results.leader is None
    assert results.ads_compared == 1


def test_a_tie_for_first_has_no_leader() -> None:
    per_ad = {"ad1": _totals(100, add_to_cart=10), "ad2": _totals(50, add_to_cart=5)}

    results = build_round_results(per_ad, {})

    assert results is not None
    assert results.leader is None


def test_an_ad_with_no_known_angle_is_labeled_by_its_id() -> None:
    per_ad = {"ad1": _totals(100, add_to_cart=10), "ad2": _totals(100, add_to_cart=5)}

    results = build_round_results(per_ad, {})

    assert results is not None
    assert results.leader is not None
    assert results.leader.angle == AdAngle("ad1", None, None, None, None)


@pytest.mark.asyncio
async def test_the_leader_is_traced_from_its_ad_to_the_creative_and_its_avatar(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = await _seed_campaign(business_id)
    (ad1, ad_set), (ad2, _) = await _seed_ads(campaign_id, ["Ad one", "Ad two"])
    await _seed_metric(
        campaign_id, ad_id=ad1, ad_set_id=ad_set, spend=100, add_to_cart=10
    )
    await _seed_metric(
        campaign_id, ad_id=ad2, ad_set_id=ad_set, spend=100, add_to_cart=5
    )
    db = Prisma()
    await db.connect()
    try:
        for ad_id, concept, avatar_id in (
            (ad1, "everyday-wear", "cav-a"),
            (ad2, "x", None),
        ):
            await db.creative.create(
                data={
                    "campaignId": campaign_id,
                    "adId": ad_id,
                    "headline": "h",
                    "bodyText": "b",
                    "cta": "SHOP_NOW",
                    "avatar": "self_purchaser",
                    "concept": concept,
                    "pillar": "emotion",
                    "buyerAvatarId": avatar_id,
                }
            )
    finally:
        await db.disconnect()

    reader = Prisma()
    await reader.connect()
    try:
        results = await load_round_results(campaign_id, client=reader)
    finally:
        await reader.disconnect()

    assert results is not None
    assert results.leader is not None
    assert results.leader.angle.buyer_avatar_id == "cav-a"
    assert results.leader.angle.concept == "everyday-wear"
    assert results.leader.angle.label == angle_label(
        "self_purchaser", "everyday-wear", "emotion"
    )


@pytest.mark.asyncio
async def test_a_campaign_with_no_ad_numbers_yet_has_no_results(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = await _seed_campaign(business_id)

    reader = Prisma()
    await reader.connect()
    try:
        assert await load_round_results(campaign_id, client=reader) is None
    finally:
        await reader.disconnect()
