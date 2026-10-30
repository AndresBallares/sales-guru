"""Publishing a creative round as a new pack in the campaign's CBO campaign (B2).

A round's 1-4 selected ads go into a NEW ad set ("Pack N") of the campaign that
is already on Meta: no second campaign, the campaign's budget stays on the
campaign, and the pack carries a 7-day minimum spend (about 1x the target CPA,
at most 20% of the campaign budget). A failed publish deletes only that ad set.
The round is CLOSED on success. Meta is always mocked.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative_round as round_module
from app.services import publish_jobs
from app.services.benchmarks import JEWELRY_META_BENCHMARKS
from app.services.meta import MetaConnectionError
from app.services.publish import pack_daily_min_spend
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_rounds import (
    ROUND_ANGLES,
    _base,
    _campaign_status,
    _new_round,
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    _cbo_plan,
    _creative_plan_campaign,
    _kwargs,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_video_ads import _approve, _creatives_url, _select_all, _video_campaign
from tests.test_video_publish import _publish, _status, _wait_for


@pytest.fixture(autouse=True)
def mock_round_angles(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    angles = AsyncMock(side_effect=lambda **kw: ROUND_ANGLES[: kw["count"]])
    monkeypatch.setattr(round_module, "generate_round_angles", angles)
    return angles


def _live_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, **plan: Any
) -> tuple[str, str]:
    """A published CBO creative test (four ads) with a round of four generated."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client,
        monkeypatch,
        plan=_cbo_plan(**plan),
        select=4,
        approve=True,
        photo_count=4,
    )
    response = client.post(f"{_base(campaign_id, business_id)}/publish")
    assert response.status_code == 200, response.text
    return business_id, campaign_id


def _round_with(
    client: TestClient, business_id: str, campaign_id: str, *, select: int
) -> dict[str, Any]:
    round_ = _new_round(client, business_id, campaign_id).json()
    for creative in round_["creatives"][:select]:
        client.post(
            f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
            f"/creatives/{creative['id']}/select"
        )
    return dict(round_)


def _publish_round(
    client: TestClient, business_id: str, campaign_id: str, round_id: str, **body: Any
) -> Any:
    return client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_id}/publish",
        json=body or None,
    )


# ── The minimum spend ────────────────────────────────────────


@pytest.mark.parametrize(
    ("budget", "target_cac", "expected"),
    [
        (100.0, 100.0, 20.0),  # 20% of the campaign wins
        (150.0, 100.0, 30.0),  # the cap wins below about 5x CPA
        (1000.0, 100.0, 100.0),  # 1x the target CPA wins on a large budget
        (500.0, 100.0, 100.0),  # the two meet at 5x
    ],
)
def test_the_pack_minimum_is_one_cpa_capped_at_twenty_percent(
    budget: float, target_cac: float, expected: float
) -> None:
    assert pack_daily_min_spend(budget, target_cac) == expected


# ── Publishing ───────────────────────────────────────────────


def test_a_round_becomes_a_new_ad_set_of_the_existing_campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=2)
    mock_services["create_ad_set"].reset_mock()
    mock_services["create_ad"].reset_mock()
    mock_services["create_campaign"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 200, response.text
    assert mock_services["create_campaign"].await_count == 0  # no second campaign
    ad_set = _kwargs(mock_services["create_ad_set"])
    assert ad_set["meta_campaign_id"] == "meta_campaign_1"
    assert ad_set["daily_budget_cents"] is None  # the budget stays on the campaign
    assert ad_set["target_cac_cents"] is None
    assert ad_set["name"].endswith("— Pack 2")
    assert mock_services["create_ad"].await_count == 2


def test_the_pack_carries_the_seven_day_minimum_spend(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)

    _publish_round(client, business_id, campaign_id, round_["id"])

    cents = _kwargs(mock_services["create_ad_set"])["daily_min_spend_cents"]
    expected = pack_daily_min_spend(100.0, JEWELRY_META_BENCHMARKS.cac.median)
    assert cents == round(expected * 100)
    assert cents <= 2000  # never above 20% of the $100 campaign budget


@pytest.mark.asyncio
async def test_the_pack_is_recorded_and_the_round_closed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=2)

    body = _publish_round(client, business_id, campaign_id, round_["id"]).json()

    assert body["status"] == "CLOSED"
    assert body["selectedCount"] == 2
    db = Prisma()
    await db.connect()
    try:
        pack = await db.adset.find_first(where={"packNumber": 2})
        assert pack is not None
        assert pack.campaignId == campaign_id
        assert pack.startDate is not None
        assert pack.dailyMinSpend == 20.0
        assert pack.status == "LIVE"
        ads = await db.ad.find_many(where={"adSetId": pack.id})
        assert len(ads) == 2
        selected = await db.creative.find_many(
            where={"roundId": round_["id"], "status": "SELECTED"}
        )
        assert all(c.adId is not None and c.metaCreativeId for c in selected)
        unselected = await db.creative.find_many(
            where={"roundId": round_["id"], "status": "GENERATED"}
        )
        assert all(c.adId is None for c in unselected)
        first_ad_set = await db.adset.find_first(where={"packNumber": None})
        assert first_ad_set is not None  # round 1's ad set is untouched
    finally:
        await db.disconnect()


def test_publishing_a_round_leaves_the_campaign_and_round_one_alone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    before = client.get(f"{_base(campaign_id, business_id)}/creatives").json()
    round_ = _round_with(client, business_id, campaign_id, select=1)

    _publish_round(client, business_id, campaign_id, round_["id"])

    assert _campaign_status(client, business_id, campaign_id) == "LIVE"
    assert client.get(f"{_base(campaign_id, business_id)}/creatives").json() == before


def test_a_round_can_be_published_paused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)

    _publish_round(client, business_id, campaign_id, round_["id"], paused=True)

    assert _kwargs(mock_services["create_ad_set"])["status"] == "PAUSED"
    assert _kwargs(mock_services["create_ad"])["status"] == "PAUSED"


def test_a_closed_round_cannot_be_published_again(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    _publish_round(client, business_id, campaign_id, round_["id"])
    mock_services["create_ad_set"].reset_mock()

    again = _publish_round(client, business_id, campaign_id, round_["id"])

    assert again.status_code == 409
    assert mock_services["create_ad_set"].await_count == 0


def test_a_new_round_can_follow_a_published_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    first = _round_with(client, business_id, campaign_id, select=1)
    _publish_round(client, business_id, campaign_id, first["id"])

    second = _new_round(client, business_id, campaign_id)

    assert second.status_code == 201
    assert second.json()["number"] == 3


# ── Rollback ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_failed_publish_deletes_only_the_new_ad_set_and_its_creatives(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=2)
    mock_services["create_ad_set"].return_value = "meta_pack_adset"
    mock_services["create_ad_creative"].side_effect = [
        "meta_creative_a",
        "meta_creative_b",
    ]
    mock_services["create_ad"].side_effect = [
        "meta_pack_ad_1",
        MetaConnectionError("Meta refused the second ad"),
    ]
    mock_services["delete_object"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    assert "refused the second ad" in response.json()["detail"]
    deleted = [
        c.kwargs["meta_object_id"]
        for c in mock_services["delete_object"].await_args_list
    ]
    # The new ad set first (which takes its ads), then the ad creatives made for
    # it; never the campaign, never round 1's ad set or creatives.
    assert deleted == ["meta_pack_adset", "meta_creative_a", "meta_creative_b"]
    db = Prisma()
    await db.connect()
    try:
        assert await db.adset.count(where={"campaignId": campaign_id}) == 1
        assert await db.adset.count(where={"packNumber": 2}) == 0
        pack_creatives = await db.creative.find_many(where={"roundId": round_["id"]})
        assert all(c.adId is None and c.metaCreativeId is None for c in pack_creatives)
        first_batch = await db.creative.find_many(
            where={"campaignId": campaign_id, "roundId": None}
        )
        assert all(c.adId is not None for c in first_batch)  # round 1 still live
        assert await db.ad.count() == 4  # only round 1's four ads remain
    finally:
        await db.disconnect()
    assert _campaign_status(client, business_id, campaign_id) == "LIVE"
    reopened = client.get(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}")
    assert reopened.json()["status"] == "OPEN"
    assert reopened.json()["selectedCount"] == 2


def test_a_failed_ad_set_creation_deletes_nothing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    mock_services["create_ad_set"].side_effect = MetaConnectionError("no ad set")
    mock_services["delete_object"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    assert mock_services["delete_object"].await_count == 0


def test_a_cleanup_failure_does_not_hide_the_publish_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    mock_services["create_ad"].side_effect = MetaConnectionError("ad refused")
    mock_services["delete_object"].side_effect = MetaConnectionError("delete refused")

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    assert "ad refused" in response.json()["detail"]


# ── Preconditions ────────────────────────────────────────────


def test_an_unpublished_campaign_cannot_publish_a_round(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=_cbo_plan(), select=4, approve=True, photo_count=4
    )
    round_ = _round_with(client, business_id, campaign_id, select=1)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "Publish the campaign" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_campaign_with_ad_set_budgets_gets_an_explanation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """A test published before #112 keeps its budget on its ad set: no new pack."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    db = Prisma()
    await db.connect()
    await db.campaign.update(where={"id": campaign_id}, data={"budgetLevel": "AD_SET"})
    await db.disconnect()
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "campaign budget" in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


def test_a_round_needs_at_least_one_selected_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=0)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


def test_an_unknown_round_is_not_found(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)

    assert _publish_round(client, business_id, campaign_id, "nope").status_code == 404


def test_meta_must_still_be_connected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    monkeypatch.setattr(
        round_module, "get_meta_connection", AsyncMock(return_value=None)
    )

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "Meta" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_stale_ad_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    db = Prisma()
    await db.connect()
    await db.creative.update_many(
        where={"roundId": round_["id"]}, data={"sourceDescription": "an old product"}
    )
    await db.disconnect()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "older version" in response.json()["detail"]


def test_a_second_publish_is_refused_while_one_is_running(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    monkeypatch.setattr(publish_jobs, "is_running", lambda _id: True)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 409
    assert "already being published" in response.json()["detail"]


def test_every_ad_in_the_campaign_still_gets_ten_dollars_a_day(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """Four live ads on a $40 campaign: a fifth would put each below $10."""
    business_id, campaign_id = _live_campaign(
        client, monkeypatch, daily_budget=40.0, total_budget=400.0
    )
    round_ = _round_with(client, business_id, campaign_id, select=1)
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "at least $50" in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_a_video_round_publishes_through_the_background_job(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch, videos=3)
    client.post(_creatives_url(business_id, campaign_id))
    _select_all(client, business_id, campaign_id, count=3)
    _approve(client, business_id, campaign_id)
    assert _publish(client, business_id, campaign_id).status_code == 202
    _wait_for(client, business_id, campaign_id, {"DONE"})
    db = Prisma()
    await db.connect()
    await db.campaign.update(
        where={"id": campaign_id}, data={"budgetLevel": "CAMPAIGN"}
    )
    await db.disconnect()
    round_ = _round_with(client, business_id, campaign_id, select=1)
    mock_services["create_ad"].reset_mock()
    mock_services["upload_video"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert response.status_code == 202
    assert final["state"] == "DONE", final
    assert mock_services["upload_video"].await_count >= 1
    assert mock_services["create_ad"].await_count == 1
    listed = client.get(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}")
    assert listed.json()["status"] == "CLOSED"
    assert _status(client, business_id, campaign_id)["state"] == "DONE"


async def _break_round(round_id: str, campaign_id: str, how: str) -> None:
    db = Prisma()
    await db.connect()
    try:
        if how == "format":
            await db.creative.update_many(
                where={"roundId": round_id}, data={"format": "CAROUSEL"}
            )
        elif how == "copy":
            await db.creative.update_many(
                where={"roundId": round_id}, data={"bodyText": "word " * 400}
            )
        elif how == "pixel":
            await db.metaconnection.update_many(where={}, data={"pixelId": None})
    finally:
        await db.disconnect()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("how", "message"),
    [
        ("format", "like the rest of the test"),
        ("copy", "fix the ad copy"),
        ("pixel", "Meta Pixel"),
    ],
)
async def test_the_first_publish_guards_apply_to_a_round(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    how: str,
    message: str,
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    await _break_round(round_["id"], campaign_id, how)
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400, response.text
    assert message in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_a_round_needs_a_destination_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    db = Prisma()
    await db.connect()
    await db.product.update_many(where={}, data={"url": None})
    await db.creative.update_many(
        where={"roundId": round_["id"]}, data={"sourceUrl": None}
    )
    await db.business.update_many(where={}, data={"website": None})
    await db.disconnect()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400, response.text
    assert "product URL or business website" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_photo_deleted_after_selection_fails_cleanly_and_removes_the_pack(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    db = Prisma()
    await db.connect()
    await db.creative.update_many(
        where={"roundId": round_["id"]},
        data={"productImageId": "gone", "imageUrl": "/product-images/gone"},
    )
    await db.disconnect()
    mock_services["create_ad_set"].return_value = "meta_pack_adset"
    mock_services["delete_object"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    assert "no longer exists" in response.json()["detail"]
    deleted = [
        c.kwargs["meta_object_id"]
        for c in mock_services["delete_object"].await_args_list
    ]
    assert deleted == ["meta_pack_adset"]


def test_the_campaign_response_says_where_its_budget_lives(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The UI offers "Add new round" only to a campaign that owns its budget."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()

    assert next(c for c in campaigns if c["id"] == campaign_id)["budgetLevel"] == (
        "CAMPAIGN"
    )


def test_a_creative_that_cannot_be_deleted_does_not_hide_the_publish_error(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=1)
    mock_services["create_ad_set"].return_value = "meta_pack_adset"
    mock_services["create_ad_creative"].return_value = "meta_creative_a"
    mock_services["create_ad"].side_effect = MetaConnectionError("ad refused")
    mock_services["delete_object"].reset_mock()
    mock_services["delete_object"].side_effect = [
        True,  # the ad set
        MetaConnectionError("creative is in use"),
    ]

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    assert "ad refused" in response.json()["detail"]
    assert mock_services["delete_object"].await_count == 2
