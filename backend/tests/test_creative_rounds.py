"""Follow-up creative rounds on a creative test campaign (B1: backend only).

A round is four freshly generated ads (three for a product lacking a fourth
photo) on angles no earlier round used; the user then selects 1-4 of them.
Round 1 is the campaign's first batch and has no row (roundId is null), so
every query that predates rounds is scoped to it. Selecting in a round never
changes the campaign's status or touches a live ad.
"""

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import creative_round as round_module
from app.schemas.strategy import GeneratedCreativeAngle
from app.services.creative import CreativeAgentError
from app.services.strategist import StrategistError
from fastapi import HTTPException
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    _kwargs,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    _FAKE_VARIANTS,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

ROUND_ANGLES = [
    GeneratedCreativeAngle(
        avatar="self_purchaser",
        concept="daily-ritual",
        pillar="emotion",
        description="A quiet morning with the piece.",
    ),
    GeneratedCreativeAngle(
        avatar="self_purchaser",
        concept="made-to-last",
        pillar="mechanism",
        description="The solid-gold build.",
    ),
    GeneratedCreativeAngle(
        avatar="gift_buyer",
        concept="anniversary-surprise",
        pillar="emotion",
        description="The reveal moment.",
    ),
    GeneratedCreativeAngle(
        avatar="gift_buyer",
        concept="easy-returns",
        pillar="offer",
        description="Risk-free gifting.",
    ),
]


@pytest.fixture(autouse=True)
def mock_round_angles(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    angles = AsyncMock(side_effect=lambda **kw: ROUND_ANGLES[: kw["count"]])
    monkeypatch.setattr(round_module, "generate_round_angles", angles)
    return angles


@pytest.fixture
def generate_mock(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """The Creative Agent mock, returning as many canned ads as the batch asks for."""
    mock = AsyncMock(side_effect=lambda **kw: _FAKE_VARIANTS[: kw.get("batch_size", 4)])
    monkeypatch.setattr(creative_module, "generate_creatives", mock)
    return mock


def _base(campaign_id: str, business_id: str) -> str:
    return f"/businesses/{business_id}/campaigns/{campaign_id}"


def _campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    select: int = 3,
    approve: bool = False,
    photo_count: int = 4,
) -> tuple[str, str, list[str]]:
    return _creative_plan_campaign(
        client,
        monkeypatch,
        select=select,
        approve=approve,
        photo_count=photo_count,
    )


def _new_round(client: TestClient, business_id: str, campaign_id: str) -> Any:
    return client.post(f"{_base(campaign_id, business_id)}/rounds")


def _campaign_status(client: TestClient, business_id: str, campaign_id: str) -> str:
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return str(next(c for c in campaigns if c["id"] == campaign_id)["status"])


async def _close_round(round_id: str) -> None:
    db = Prisma()
    await db.connect()
    await db.creativeround.update(where={"id": round_id}, data={"status": "CLOSED"})
    await db.disconnect()


# ── Generating a round ───────────────────────────────────────


def test_a_round_generates_four_ads_with_fresh_numbering(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201
    body = response.json()
    assert body["number"] == 2
    assert body["status"] == "OPEN"
    assert body["generatedCount"] == 4
    assert body["selectedCount"] == 0
    assert len(body["creatives"]) == 4
    assert {c["roundId"] for c in body["creatives"]} == {body["id"]}
    assert [a["concept"] for a in body["angles"]] == [a.concept for a in ROUND_ANGLES]


def test_a_thin_product_generates_three_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, generate_mock: AsyncMock
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, photo_count=3)

    body = _new_round(client, business_id, campaign_id).json()

    assert body["generatedCount"] == 3
    assert len(body["creatives"]) == 3
    assert _kwargs(generate_mock)["batch_size"] == 3


def test_the_round_is_generated_from_its_own_angles_not_the_plans(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, generate_mock: AsyncMock
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    _new_round(client, business_id, campaign_id)

    plan = _kwargs(generate_mock)["strategy"]
    assert [a.concept for a in plan.creative_angles] == [
        a.concept for a in ROUND_ANGLES
    ]
    assert _kwargs(generate_mock)["batch_size"] == 4


def test_round_angles_exclude_the_first_batch(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_round_angles: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    _new_round(client, business_id, campaign_id)

    excluded = _kwargs(mock_round_angles)["excluded_angles"]
    assert sorted(a.concept for a in excluded) == ["a", "b", "c", "d"]
    assert _kwargs(mock_round_angles)["count"] == 4


@pytest.mark.asyncio
async def test_round_angles_exclude_every_earlier_round(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_round_angles: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    first = _new_round(client, business_id, campaign_id).json()
    await _close_round(first["id"])

    second = _new_round(client, business_id, campaign_id)

    assert second.status_code == 201
    assert second.json()["number"] == 3
    excluded = {a.concept for a in _kwargs(mock_round_angles)["excluded_angles"]}
    assert excluded >= {"a", "b", "c", "d"} | {a.concept for a in ROUND_ANGLES}


def test_only_one_round_can_be_open(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    _new_round(client, business_id, campaign_id)

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 409
    assert "open round" in response.json()["detail"]


def test_a_campaign_without_a_creative_test_plan_gets_no_round(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    client.delete(f"{_base(campaign_id, business_id)}/strategy")  # no-op if absent

    other = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES"},
    ).json()["id"]
    response = _new_round(client, business_id, other)

    assert response.status_code == 400


def test_a_model_failure_leaves_no_round_behind(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    monkeypatch.setattr(
        creative_module,
        "generate_creatives",
        AsyncMock(side_effect=CreativeAgentError("boom")),
    )

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 500
    assert client.get(f"{_base(campaign_id, business_id)}/rounds").json() == []


# ── Round-scoped selection ───────────────────────────────────


def test_selecting_in_a_round_counts_on_the_round_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, select=3)
    round_ = _new_round(client, business_id, campaign_id).json()
    first = round_["creatives"][0]["id"]
    status_before = _campaign_status(client, business_id, campaign_id)

    response = client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{first}/select"
    )

    assert response.status_code == 200
    assert response.json()["selectedCount"] == 1
    assert _campaign_status(client, business_id, campaign_id) == status_before


def test_one_to_four_ads_can_be_selected_and_deselected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    base = f"{_base(campaign_id, business_id)}/rounds/{round_['id']}/creatives"

    for creative in round_["creatives"]:
        body = client.post(f"{base}/{creative['id']}/select").json()
    assert body["selectedCount"] == 4
    body = client.post(f"{base}/{round_['creatives'][0]['id']}/deselect").json()

    assert body["selectedCount"] == 3
    statuses = [c["status"] for c in body["creatives"]]
    assert statuses.count("SELECTED") == 3
    assert statuses.count("GENERATED") == 1


def test_selection_is_stored_on_the_round_row(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    creative_id = round_["creatives"][1]["id"]
    client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{creative_id}/select"
    )

    listed = client.get(f"{_base(campaign_id, business_id)}/rounds").json()

    assert listed[0]["selectedCount"] == 1
    assert listed[0]["generatedCount"] == 4


def test_selecting_never_changes_round_one_or_its_live_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _campaign(client, monkeypatch, select=3)
    round_ = _new_round(client, business_id, campaign_id).json()

    client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{round_['creatives'][0]['id']}/select"
    )

    first_batch = client.get(f"{_base(campaign_id, business_id)}/creatives").json()
    assert {c["id"] for c in first_batch if c["status"] == "SELECTED"} == set(selected)


def test_a_creative_of_another_round_is_not_found_through_a_round(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()

    response = client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{selected[0]}/select"
    )

    assert response.status_code == 404


def test_a_round_creative_cannot_be_selected_through_the_first_batch_route(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    status_before = _campaign_status(client, business_id, campaign_id)

    response = client.post(
        f"{_base(campaign_id, business_id)}/creatives/"
        f"{round_['creatives'][0]['id']}/select"
    )

    assert response.status_code == 404
    assert _campaign_status(client, business_id, campaign_id) == status_before


@pytest.mark.asyncio
async def test_a_closed_round_cannot_be_changed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    await _close_round(round_["id"])

    response = client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{round_['creatives'][0]['id']}/select"
    )

    assert response.status_code == 409


# ── Round 1 scoping of the queries that predate rounds ───────


def test_the_creatives_list_is_round_one_only(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    _new_round(client, business_id, campaign_id)

    listed = client.get(f"{_base(campaign_id, business_id)}/creatives").json()

    assert len(listed) == 4
    assert {c["roundId"] for c in listed} == {None}


def test_regenerating_round_one_keeps_the_rounds_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, select=0)
    round_ = _new_round(client, business_id, campaign_id).json()

    client.post(f"{_base(campaign_id, business_id)}/creatives")

    kept = client.get(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}").json()
    assert [c["id"] for c in kept["creatives"]] == [
        c["id"] for c in round_["creatives"]
    ]


def test_round_ads_do_not_count_toward_round_one_approval_or_publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, Any],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, select=4, approve=True)
    round_ = _new_round(client, business_id, campaign_id).json()
    for creative in round_["creatives"][:2]:
        client.post(
            f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
            f"/creatives/{creative['id']}/select"
        )
    assert _campaign_status(client, business_id, campaign_id) == "APPROVED"

    response = client.post(f"{_base(campaign_id, business_id)}/publish")

    assert response.status_code == 200, response.text
    assert mock_services["create_ad_creative"].await_count == 4


# ── Reading and deleting rounds ──────────────────────────────


def test_rounds_are_listed_oldest_first_with_their_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    created = _new_round(client, business_id, campaign_id).json()

    listed = client.get(f"{_base(campaign_id, business_id)}/rounds").json()
    one = client.get(f"{_base(campaign_id, business_id)}/rounds/{created['id']}")

    assert [r["id"] for r in listed] == [created["id"]]
    assert len(listed[0]["creatives"]) == 4
    assert one.status_code == 200
    assert one.json()["number"] == 2


def test_an_unknown_round_is_not_found(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    get = client.get(f"{_base(campaign_id, business_id)}/rounds/nope")
    delete = client.delete(f"{_base(campaign_id, business_id)}/rounds/nope")

    assert get.status_code == 404
    assert delete.status_code == 404


@pytest.mark.asyncio
async def test_deleting_a_round_removes_its_ads_and_frees_the_slot(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()

    response = client.delete(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}")

    assert response.status_code == 204
    assert client.get(f"{_base(campaign_id, business_id)}/rounds").json() == []
    db = Prisma()
    await db.connect()
    assert await db.creative.count(where={"roundId": round_["id"]}) == 0
    assert await db.creative.count(where={"campaignId": campaign_id}) == 4
    await db.disconnect()
    assert _new_round(client, business_id, campaign_id).status_code == 201


@pytest.mark.asyncio
async def test_a_round_with_a_live_ad_cannot_be_deleted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    db = Prisma()
    await db.connect()
    ad_set = await db.adset.create(
        data={
            "campaignId": campaign_id,
            "name": "Pack 2",
            "budget": 10.0,
            "optimizationGoal": "OFFSITE_CONVERSIONS",
        }
    )
    ad = await db.ad.create(data={"adSetId": ad_set.id, "name": "Live ad"})
    await db.creative.update(
        where={"id": round_["creatives"][0]["id"]},
        data={"ad": {"connect": {"id": ad.id}}},
    )
    await db.disconnect()

    response = client.delete(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}")

    assert response.status_code == 409
    assert len(client.get(f"{_base(campaign_id, business_id)}/rounds").json()) == 1


def test_another_users_campaign_has_no_rounds(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    client.cookies.clear()

    response = client.get(f"{_base(campaign_id, business_id)}/rounds")

    assert response.status_code in (401, 403, 404)


def test_stored_angles_are_the_rounds_json(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    body = _new_round(client, business_id, campaign_id).json()

    assert json.loads(json.dumps(body["angles"]))[0]["avatar"] == "self_purchaser"


# ── Failure paths ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_round_needs_the_first_batch_to_exist(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, select=0)
    db = Prisma()
    await db.connect()
    await db.creativecard.delete_many()
    await db.creative.delete_many(where={"campaignId": campaign_id})
    await db.disconnect()

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 400
    assert "first ads" in response.json()["detail"]


def test_an_angle_failure_leaves_no_round_behind(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_round_angles: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    mock_round_angles.side_effect = StrategistError("model unavailable")

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 500
    assert client.get(f"{_base(campaign_id, business_id)}/rounds").json() == []


def test_a_rejected_batch_keeps_its_status_and_leaves_no_round_behind(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    monkeypatch.setattr(
        round_module,
        "generate_batch",
        AsyncMock(side_effect=HTTPException(status_code=400, detail="No photos")),
    )

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 400
    assert response.json()["detail"] == "No photos"
    assert client.get(f"{_base(campaign_id, business_id)}/rounds").json() == []


@pytest.mark.asyncio
async def test_selecting_needs_a_product_photo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    round_ = _new_round(client, business_id, campaign_id).json()
    db = Prisma()
    await db.connect()
    await db.productimage.delete_many()
    await db.disconnect()

    response = client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}"
        f"/creatives/{round_['creatives'][0]['id']}/select"
    )

    assert response.status_code == 428
    listed = client.get(f"{_base(campaign_id, business_id)}/rounds").json()
    assert listed[0]["selectedCount"] == 0
