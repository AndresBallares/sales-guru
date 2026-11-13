"""Shared helpers for publishing a creative round (the guards are in
test_round_publish_guards.py, the ad-set round publish in test_ad_set_round_publish.py).

Every round runs on ad sets that own their budgets: a published first test, then a
later round once the first has run its days (`_finish_rounds` pretends it has).
Meta is always mocked.
"""

import itertools
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative_round as round_module
from app.services import meta as meta_service_module
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_rounds import (
    ROUND_ANGLES,
    _base,
    _new_round,
)
from tests.test_creative_test_plan_publish import (
    _creative_plan,
    _creative_plan_campaign,
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (fixture, must be in this namespace)
)


@pytest.fixture(autouse=True)
def mock_round_angles(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    angles = AsyncMock(side_effect=lambda **kw: ROUND_ANGLES[: kw["count"]])
    monkeypatch.setattr(round_module, "generate_round_angles", angles)
    return angles


def _live_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, **plan: Any
) -> tuple[str, str]:
    """A published first test (four ads, each ad set owning its budget)."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client,
        monkeypatch,
        plan=_creative_plan(
            **{
                "bid_strategy": "LOWEST_COST",
                "daily_budget": 100.0,
                "total_budget": 1000.0,
                "rounds_budget": "AD_SET",
                **plan,
            }
        ),
        select=4,
        approve=True,
        photo_count=4,
    )
    response = client.post(f"{_base(campaign_id, business_id)}/publish")
    assert response.status_code == 200, response.text
    return business_id, campaign_id


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


@pytest.fixture
def post_mocks(
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> dict[str, AsyncMock]:
    """Unique Meta ids per call, and the post-reuse helpers."""
    ad_sets = itertools.count(1)
    ads = itertools.count(1)
    creatives = itertools.count(1)
    mock_services["create_ad_set"].side_effect = lambda **_: (
        f"meta_adset_{next(ad_sets)}"
    )
    mock_services["create_ad"].side_effect = lambda **_: f"meta_ad_{next(ads)}"
    mock_services["create_ad_creative"].side_effect = lambda **_: (
        f"meta_creative_{next(creatives)}"
    )
    fetch = AsyncMock(side_effect=lambda **kw: f"page_post_of_{kw['meta_ad_id']}")
    monkeypatch.setattr(meta_service_module, "fetch_ad_post_id", fetch)
    reuse = AsyncMock(side_effect=lambda **_: f"post_creative_{next(creatives)}")
    monkeypatch.setattr(meta_service_module, "create_meta_post_ad_creative", reuse)
    return {"fetch_post": fetch, "reuse_post": reuse}
