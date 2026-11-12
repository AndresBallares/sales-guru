"""Data-Driven rounds and the pause offer (PR 1, tests first).

A Data-Driven campaign is a creative test whose plan also carries an
`audience_source` (targeting chosen from the ad account's history). It must
publish its first ad set and every later round with that targeting instead of a
broad Advantage+ audience, and its plan must be generated with that block.

The pause offer lets the user ask "should round 1's losers be paused before I
launch the next round?". It only ever records proposals the user then approves;
it never pauses anything itself.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative_round as round_module
from app.core.config import get_settings
from app.schemas.strategy import AudienceSource, CreativeTestPlanContent, TargetAudience
from app.services import optimization_jobs
from app.services import strategist as strategist_module
from app.services.creative_test_rules import AdSnapshot
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_rounds import (
    ROUND_ANGLES,
    _base,
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)
from tests.test_creative_test_plan import _business, _product
from tests.test_creative_test_plan_publish import (
    _cbo_plan,
    _kwargs,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_round_publish import _live_campaign, _round_with


@pytest.fixture(autouse=True)
def mock_round_angles(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    angles = AsyncMock(side_effect=lambda **kw: ROUND_ANGLES[: kw["count"]])
    monkeypatch.setattr(round_module, "generate_round_angles", angles)
    return angles


def _history_audience() -> AudienceSource:
    return AudienceSource(
        target_audience=TargetAudience(
            age_min=30,
            age_max=55,
            interests=["jewelry"],
            problem="Hard to find quality pieces",
            desire="Own something unique",
        ),
        key_learnings=["Craftsmanship performed best"],
    )


# --- the first ad set ------------------------------------------------------


def test_a_data_driven_first_ad_set_targets_the_history_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    _live_campaign(client, monkeypatch, audience_source=_history_audience())

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["advantage_audience"] == 0
    assert kwargs["age_min"] == 30
    assert kwargs["age_max"] == 55
    assert [i["name"] for i in kwargs["interests"]]  # the resolved Meta interests
    # The budget still sits on the campaign, not on the ad set.
    assert kwargs["daily_budget_cents"] is None


def test_a_creative_test_keeps_the_broad_advantage_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    _live_campaign(client, monkeypatch)

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["advantage_audience"] == 1
    assert kwargs["age_max"] is None


# --- later rounds ----------------------------------------------------------


def test_a_data_driven_round_targets_the_same_history_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(
        client, monkeypatch, audience_source=_history_audience()
    )
    round_ = _round_with(client, business_id, campaign_id, select=4)

    response = client.post(
        f"{_base(campaign_id, business_id)}/rounds/{round_['id']}/publish"
    )

    assert response.status_code == 200, response.text
    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["advantage_audience"] == 0
    assert kwargs["age_min"] == 30
    assert kwargs["age_max"] == 55
    assert kwargs["daily_budget_cents"] is None


def test_a_creative_test_round_keeps_the_broad_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    round_ = _round_with(client, business_id, campaign_id, select=4)

    client.post(f"{_base(campaign_id, business_id)}/rounds/{round_['id']}/publish")

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["advantage_audience"] == 1
    assert kwargs["age_max"] is None


# --- generating a Data-Driven plan ----------------------------------------


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("FAKE_LLM", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_the_strategist_attaches_a_history_audience_for_data_driven(
    fake_llm: None,
) -> None:
    plan = await strategist_module.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        campaign_type="DATA_DRIVEN",
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert plan.audience_source is not None
    assert plan.audience_source.kind == "ACCOUNT_HISTORY"
    assert plan.audience_source.key_learnings
    assert plan.audience_source.target_audience.age_min == 25


@pytest.mark.asyncio
async def test_a_creative_test_plan_has_no_history_audience(fake_llm: None) -> None:
    plan = await strategist_module.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        campaign_type="CREATIVE_TEST",
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert plan.audience_source is None


# --- the pause offer -------------------------------------------------------


async def _ads_of(campaign_id: str) -> list[Any]:
    db = Prisma()
    await db.connect()
    try:
        ad_sets = await db.adset.find_many(where={"campaignId": campaign_id})
        return await db.ad.find_many(
            where={"adSetId": {"in": [s.id for s in ad_sets]}},
            order={"createdAt": "asc"},
        )
    finally:
        await db.disconnect()


def _snapshots(ads: list[Any], *, loser: int) -> list[AdSnapshot]:
    """Four live ads; the one at `loser` spent a lot and produced nothing."""
    return [
        AdSnapshot(
            ad_id=ad.id,
            name=ad.name,
            live=True,
            spend=10_000.0 if i == loser else 100.0,
            add_to_cart=0 if i == loser else 20,
            cost_per_add_to_cart=None if i == loser else 5.0,
            purchases=0 if i == loser else 5,
            cac=None if i == loser else 10.0,
        )
        for i, ad in enumerate(ads)
    ]


def _stub_snapshots(
    monkeypatch: pytest.MonkeyPatch, snapshots: list[AdSnapshot]
) -> None:
    first = datetime.now(UTC) - timedelta(hours=72)
    monkeypatch.setattr(
        optimization_jobs,
        "_creative_test_ads",
        AsyncMock(return_value=(snapshots, first, "the last 3 days")),
    )


@pytest.mark.asyncio
async def test_the_offer_proposes_pauses_but_never_pauses_anything(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    ads = await _ads_of(campaign_id)
    _stub_snapshots(monkeypatch, _snapshots(ads, loser=2))
    pause = AsyncMock()
    monkeypatch.setattr(optimization_jobs, "pause_meta_ad", pause)

    response = client.post(f"{_base(campaign_id, business_id)}/rounds/pause-offer")

    assert response.status_code == 200, response.text
    offers = response.json()
    assert len(offers) == 1
    assert offers[0]["targetAdId"] == ads[2].id
    assert offers[0]["actionType"] == "PAUSE_AD"
    assert offers[0]["requiresApproval"] is True
    assert offers[0]["status"] == "PENDING"
    pause.assert_not_awaited()
    assert [a.status for a in await _ads_of(campaign_id)] == ["LIVE"] * len(ads)


@pytest.mark.asyncio
async def test_asking_twice_does_not_duplicate_the_offer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    ads = await _ads_of(campaign_id)
    _stub_snapshots(monkeypatch, _snapshots(ads, loser=1))
    url = f"{_base(campaign_id, business_id)}/rounds/pause-offer"

    first = client.post(url).json()
    second = client.post(url).json()

    assert [o["id"] for o in first] == [o["id"] for o in second]


@pytest.mark.asyncio
async def test_no_losers_means_an_empty_offer(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    ads = await _ads_of(campaign_id)
    healthy = [
        s._replace(spend=100.0, add_to_cart=20, cost_per_add_to_cart=5.0)
        for s in _snapshots(ads, loser=-1)
    ]
    _stub_snapshots(monkeypatch, healthy)

    response = client.post(f"{_base(campaign_id, business_id)}/rounds/pause-offer")

    assert response.status_code == 200
    assert response.json() == []


def test_the_offer_needs_a_published_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    from tests.test_creative_test_plan_publish import _creative_plan_campaign

    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=_cbo_plan(), select=4, photo_count=4
    )

    response = client.post(f"{_base(campaign_id, business_id)}/rounds/pause-offer")

    assert response.status_code == 400
