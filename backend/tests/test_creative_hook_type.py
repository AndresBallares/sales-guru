"""Each creative remembers its assigned hook shape (Creative.hookType).

The code assigns the shape (see test_hook_shapes.py) and stores it with the ad; the
model never returns one. The API shows it. Nothing reads it yet: it is data collected
for a later look at which shapes do better.
"""

import hashlib
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_edit import _url as creative_url
from tests.test_creative_edit import regenerated  # noqa: F401  (fixture, used by name)
from tests.test_creative_rounds import (
    _campaign,
    _new_round,
    generate_mock,  # noqa: F401  (a fixture, used by name)
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    _creatives,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

SLUGS = ["statement", "question", "contrast", "moment", "address"]


def _expected(campaign_id: str, round_number: int, count: int) -> list[str]:
    """The shapes, worked out here from the rule rather than by calling the code."""
    start = int(hashlib.sha256(campaign_id.encode()).hexdigest(), 16) % 5
    start = (start + round_number - 1) % 5
    return [SLUGS[(start + i) % 5] for i in range(count)]


def _sent(mock: AsyncMock) -> dict[str, Any]:
    call = mock.await_args
    assert call is not None
    return dict(call.kwargs)


def test_the_first_batch_stores_four_different_shapes_in_order(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    shapes = [c["hookType"] for c in _creatives(client, business_id, campaign_id)]

    assert shapes == _expected(campaign_id, 1, 4)
    assert len(set(shapes)) == 4


def test_the_agent_is_told_the_shapes_it_was_assigned(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    _, campaign_id, _ = _campaign(client, monkeypatch)

    assert _sent(generate_mock)["hook_shapes"] == _expected(campaign_id, 1, 4)


def test_a_round_starts_one_shape_later_than_the_round_before(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    body = _new_round(client, business_id, campaign_id).json()

    assert body["number"] == 2
    assert [c["hookType"] for c in body["creatives"]] == _expected(campaign_id, 2, 4)
    assert _sent(generate_mock)["hook_shapes"] == _expected(campaign_id, 2, 4)


def test_a_thin_product_round_of_three_gets_three_different_shapes(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch, photo_count=3)

    body = _new_round(client, business_id, campaign_id).json()

    shapes = [c["hookType"] for c in body["creatives"]]
    assert shapes == _expected(campaign_id, 2, 3)
    assert len(set(shapes)) == 3


def test_the_shape_is_kept_with_the_ad_and_shown_by_the_api(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    first = _creatives(client, business_id, campaign_id)
    again = _creatives(client, business_id, campaign_id)

    assert [c["hookType"] for c in first] == [c["hookType"] for c in again]
    assert all(c["hookType"] in SLUGS for c in first)


@pytest.mark.asyncio
async def test_a_regenerate_is_written_in_the_shape_the_ad_already_has(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    regenerated: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _campaign(client, monkeypatch, select=3)
    before = {
        c["id"]: c["hookType"] for c in _creatives(client, business_id, campaign_id)
    }

    response = client.post(
        creative_url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 200
    assert _sent(regenerated)["hook_shapes"] == [before[selected[0]]]
    assert response.json()["hookType"] == before[selected[0]]
    after = {
        c["id"]: c["hookType"] for c in _creatives(client, business_id, campaign_id)
    }
    assert after == before


@pytest.mark.asyncio
async def test_an_older_ad_with_no_shape_is_regenerated_without_one(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    regenerated: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _campaign(client, monkeypatch, select=3)
    db = Prisma()
    await db.connect()
    try:
        await db.creative.update(where={"id": selected[0]}, data={"hookType": None})
    finally:
        await db.disconnect()

    response = client.post(
        creative_url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 200
    assert not _sent(regenerated).get("hook_shapes")
    assert response.json()["hookType"] is None
