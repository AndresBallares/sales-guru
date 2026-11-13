"""The guards a round publish applies before anything is made on Meta.

The same refusals a first publish makes (stale ad, banned phrase, missing URL, Pixel
or Meta connection, wrong format or copy), checked on a later round of an ad-set
round campaign. Meta is always mocked.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative_round as round_module
from app.services import publish_jobs
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_rounds import (
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_round_publish import (
    _finish_rounds,
    _live_campaign,
    _publish_round,
    _round_with,
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
    post_mocks,  # noqa: F401  (fixture, must be in this namespace)
)


async def _round_two(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, *, select: int, **plan: Any
) -> tuple[str, str, dict[str, Any]]:
    """A published first test that has run its days, with round 2 generated."""
    business_id, campaign_id = _live_campaign(client, monkeypatch, **plan)
    await _finish_rounds(campaign_id)
    return (
        business_id,
        campaign_id,
        _round_with(client, business_id, campaign_id, select=select),
    )


async def _break_round(round_id: str, how: str) -> None:
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
async def test_a_round_needs_at_least_one_selected_ad(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=0)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "at least one" in response.json()["detail"]


@pytest.mark.asyncio
async def test_an_unknown_round_is_not_found(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)

    assert _publish_round(client, business_id, campaign_id, "nope").status_code == 404


@pytest.mark.asyncio
async def test_meta_must_still_be_connected(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
    monkeypatch.setattr(
        round_module, "get_meta_connection", AsyncMock(return_value=None)
    )

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "Meta" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_stale_ad_is_refused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
    db = Prisma()
    await db.connect()
    await db.creative.update_many(
        where={"roundId": round_["id"]}, data={"sourceDescription": "an old product"}
    )
    await db.disconnect()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "older version" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_second_publish_is_refused_while_one_is_running(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
    monkeypatch.setattr(publish_jobs, "is_running", lambda _id: True)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 409
    assert "already being published" in response.json()["detail"]


@pytest.mark.asyncio
async def test_a_new_ad_set_still_needs_ten_dollars_a_day_for_each_of_its_ads(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    """Four ads on a $30 ad set would each get under $10 a day."""
    business_id, campaign_id = _live_campaign(
        client, monkeypatch, daily_budget=30.0, total_budget=300.0
    )
    await _finish_rounds(campaign_id)
    round_ = _round_with(client, business_id, campaign_id, select=4)
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400
    assert "at least $40" in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


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
    generate_mock: AsyncMock,  # noqa: F811
    how: str,
    message: str,
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
    await _break_round(round_["id"], how)
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400, response.text
    assert message in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_a_round_ad_with_a_business_banned_phrase_is_refused_by_name(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
    db = Prisma()
    await db.connect()
    try:
        await db.brandrules.create(
            data={"businessId": business_id, "bannedPhrases": '["Elevate your style"]'}
        )
        await db.creative.update_many(
            where={"roundId": round_["id"]},
            data={"bodyText": "Elevate your style with 18K gold and ceramic."},
        )
    finally:
        await db.disconnect()
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 400, response.text
    assert "'Elevate your style'" in response.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_a_round_needs_a_destination_url(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two(client, monkeypatch, select=1)
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
