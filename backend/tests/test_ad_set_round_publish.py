"""Publishing ad-set rounds: round 1, later rounds and their winners ad set.

Meta is always mocked. The plan and routing tests are in test_ad_set_rounds.py.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_ad_set_rounds import ad_set_plan
from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    _kwargs,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


async def _ad_sets_of(campaign_id: str) -> list[Any]:
    db = Prisma()
    await db.connect()
    try:
        return await db.adset.find_many(
            where={"campaignId": campaign_id}, order={"createdAt": "asc"}
        )
    finally:
        await db.disconnect()


def _published_round_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, **plan: Any
) -> tuple[str, str]:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client,
        monkeypatch,
        plan=ad_set_plan(**plan),
        select=4,
        approve=True,
        photo_count=4,
    )
    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    assert response.status_code == 200, response.text
    return business_id, campaign_id


@pytest.mark.asyncio
async def test_round_one_gives_its_ad_set_the_budget_and_a_ten_day_end(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    before = datetime.now(UTC)
    _, campaign_id = _published_round_one(client, monkeypatch)

    # No campaign budget: the ad set owns the $100 a day.
    assert _kwargs(mock_services["create_campaign"])["daily_budget_cents"] is None
    ad_set = _kwargs(mock_services["create_ad_set"])
    assert ad_set["daily_budget_cents"] == 10000
    assert ad_set["target_cac_cents"] is None  # lowest cost, no cap
    assert ad_set["end_time"] - before >= timedelta(days=10) - timedelta(minutes=1)
    assert ad_set["end_time"] - before <= timedelta(days=10, minutes=5)
    [row] = await _ad_sets_of(campaign_id)
    assert row.budget == 100.0
    assert (row.packNumber, row.isWinners) == (1, False)
    assert row.startDate is not None
    assert abs(row.endDate - ad_set["end_time"]) < timedelta(seconds=1)


# --- round 2: a new ad set plus the winners ad set ---------------------------


from tests.test_creative_rounds import _base, generate_mock  # noqa: E402, F401
from tests.test_data_driven_rounds import mock_round_angles  # noqa: E402, F401
from tests.test_round_publish import (  # noqa: E402
    _publish_round,
    _round_with,
    post_mocks,  # noqa: F401  (fixture, must be in this namespace)
)


async def _round_two_ready(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    select: int = 4,
) -> tuple[str, str, dict[str, Any]]:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    await _finish_rounds(campaign_id)
    return (
        business_id,
        campaign_id,
        _round_with(client, business_id, campaign_id, select=select),
    )


async def _finish_rounds(
    campaign_id: str, *, ago: timedelta = timedelta(hours=1)
) -> None:
    """Pretend every ad set has run its days: its end date is in the past."""
    db = Prisma()
    await db.connect()
    try:
        await db.adset.update_many(
            where={"campaignId": campaign_id},
            data={"endDate": datetime.now(UTC) - ago},
        )
    finally:
        await db.disconnect()


async def _all_ad_sets(campaign_id: str) -> list[Any]:
    return sorted(await _ad_sets_of(campaign_id), key=lambda a: a.createdAt)


@pytest.mark.asyncio
async def test_round_two_is_a_new_ad_set_plus_a_winners_ad_set(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    mock_services["create_ad_set"].reset_mock()
    mock_services["create_campaign"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 200, response.text
    assert mock_services["create_campaign"].await_count == 0  # same campaign
    calls = [c.kwargs for c in mock_services["create_ad_set"].await_args_list]
    assert [c["daily_budget_cents"] for c in calls] == [10000, 5000]
    assert calls[0]["end_time"] == calls[1]["end_time"]
    assert calls[0]["name"].endswith("Round 2")
    assert calls[1]["name"].endswith("Round 2 winners")
    assert all(c.get("daily_min_spend_cents") is None for c in calls)  # no pack floor
    rows = await _all_ad_sets(campaign_id)
    assert [(r.packNumber, r.isWinners, r.budget) for r in rows] == [
        (1, False, 100.0),
        (2, False, 100.0),
        (2, True, 50.0),
    ]
    assert rows[1].endDate == rows[2].endDate


@pytest.mark.asyncio
async def test_each_winner_reuses_its_original_facebook_post(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)

    _publish_round(client, business_id, campaign_id, round_["id"])

    posts = [
        c.kwargs["object_story_id"] for c in post_mocks["reuse_post"].await_args_list
    ]
    assert sorted(posts) == sorted(
        f"page_post_of_meta_ad_{n}" for n in range(1, 5)
    )  # the four ads round 1 published
    db = Prisma()
    await db.connect()
    try:
        where: Any = {"campaignId": campaign_id, "carriedFromCreativeId": {"not": None}}
        carried = await db.creative.find_many(where=where)
        originals = {
            c.id: c
            for c in await db.creative.find_many(
                where={"campaignId": campaign_id, "roundId": None}
            )
        }
    finally:
        await db.disconnect()
    assert len(carried) == 4
    for copy in carried:
        assert copy.carriedFromCreativeId is not None
        original = originals[copy.carriedFromCreativeId]
        assert copy.carriedFromRound == 1
        assert (copy.avatar, copy.concept, copy.pillar, copy.hookType) == (
            original.avatar,
            original.concept,
            original.pillar,
            original.hookType,
        )
        assert copy.adId is not None
        assert (copy.metaCreativeId or "").startswith("post_creative_")


@pytest.mark.asyncio
async def test_a_loser_paused_on_meta_is_not_carried(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    mock_services["object_status"].side_effect = lambda **kw: (
        "PAUSED" if kw["meta_object_id"] in {"meta_ad_2", "meta_ad_3"} else "ACTIVE"
    )

    _publish_round(client, business_id, campaign_id, round_["id"])

    posts = [
        c.kwargs["object_story_id"] for c in post_mocks["reuse_post"].await_args_list
    ]
    assert sorted(posts) == ["page_post_of_meta_ad_1", "page_post_of_meta_ad_4"]


@pytest.mark.asyncio
async def test_with_no_winners_the_round_is_one_ad_set_and_a_thousand_dollars(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    mock_services["object_status"].return_value = "PAUSED"  # every ad was paused
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 200, response.text
    assert mock_services["create_ad_set"].await_count == 1
    assert post_mocks["reuse_post"].await_count == 0
    assert [r.isWinners for r in await _all_ad_sets(campaign_id)] == [False, False]


@pytest.mark.asyncio
async def test_a_winner_without_a_post_stops_the_publish_before_anything_is_made(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    post_mocks["fetch_post"].side_effect = lambda **_: None
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "facebook post" in response.json()["detail"].lower()
    assert mock_services["create_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_a_failed_winners_ad_set_removes_everything_the_round_made(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    from app.services.meta import MetaConnectionError

    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    post_mocks["reuse_post"].side_effect = MetaConnectionError("post refused")
    mock_services["delete_object"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 500
    deleted = {
        c.kwargs["meta_object_id"]
        for c in mock_services["delete_object"].await_args_list
    }
    assert {"meta_adset_2", "meta_adset_3"} <= deleted  # both new ad sets
    assert [r.packNumber for r in await _all_ad_sets(campaign_id)] == [1]
    again = client.get(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
    ).json()
    assert again["status"] == "OPEN"
