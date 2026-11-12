"""Spend guardrails for ad-set rounds: the total-spend limit and the daily flag.

The total-spend limit is the sum, over the campaign's published ad sets, of each
ad set's daily budget x the plan's days: $1,000 for round 1 and $1,500 for each
later round with a winners ad set. The 25% daily flag judges each ad set against
its own budget. Meta is always mocked.
"""

from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import optimization_jobs
from app.services.meta import CampaignInsights
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_optimization_jobs import (
    _fetch_campaign,
    _make_creative_plan_campaign,
    _run,
    _seed_baseline,
    _seed_metric,
    mock_services,  # noqa: F401  (fixture, must be in this namespace)
)


async def _seed_rounds(
    campaign_id: str, ad_sets: list[tuple[int, float, bool]]
) -> list[str]:
    """Make the campaign's ad sets these (round, daily budget, is winners).

    The campaign's existing ad set (it has ads) becomes the first of them.
    """
    db = Prisma()
    await db.connect()
    try:
        existing = await db.adset.find_first(where={"campaignId": campaign_id})
        assert existing is not None
        ids = []
        for n, (round_number, budget, is_winners) in enumerate(ad_sets):
            fields: Any = {
                "name": f"Round {round_number}{' winners' if is_winners else ''}",
                "budget": budget,
                "metaAdSetId": f"meta_set_{n}",
                "packNumber": round_number,
                "isWinners": is_winners,
                "startDate": datetime.now(UTC) - timedelta(days=1),
                "endDate": datetime.now(UTC) + timedelta(days=9),
            }
            if n == 0:
                await db.adset.update(where={"id": existing.id}, data=fields)
                ids.append(existing.id)
            else:
                created: Any = {
                    "campaignId": campaign_id,
                    "optimizationGoal": "OFFSITE_CONVERSIONS",
                    "status": "LIVE",
                    **fields,
                }
                row = await db.adset.create(data=created)
                ids.append(row.id)
        return ids
    finally:
        await db.disconnect()


async def _rounds_campaign(
    client: TestClient, ad_sets: list[tuple[int, float, bool]]
) -> tuple[str, list[str]]:
    campaign_id = await _make_creative_plan_campaign(
        client,
        optimization_event="PURCHASE",
        daily_budget=100.0,
        bid_strategy="LOWEST_COST",
        rounds_budget="AD_SET",
    )
    return campaign_id, await _seed_rounds(campaign_id, ad_sets)


ROUND_ONE = [(1, 100.0, False)]
ROUND_TWO = [(1, 100.0, False), (2, 100.0, False), (2, 50.0, True)]


@pytest.mark.parametrize(
    ("ad_sets", "spend", "paused", "limit"),
    [
        (ROUND_ONE, 1100.0, True, "1,000.00"),
        (ROUND_ONE, 990.0, False, None),
        (ROUND_TWO, 2600.0, True, "2,500.00"),
        (ROUND_TWO, 2400.0, False, None),
    ],
)
@pytest.mark.asyncio
async def test_the_total_spend_limit_is_the_sum_of_every_rounds_planned_budget(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    ad_sets: list[tuple[int, float, bool]],
    spend: float,
    paused: bool,
    limit: str | None,
) -> None:
    campaign_id, _ = await _rounds_campaign(client, ad_sets)
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=spend, conversions=2
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = await _fetch_campaign(campaign_id)
    assert (campaign.status == "PAUSED") is paused
    if limit is not None:
        assert limit in str(campaign.pausedReason)
        assert f"{spend:,.2f}" in str(campaign.pausedReason)


@pytest.mark.asyncio
async def test_each_ad_sets_own_numbers_are_collected_but_not_added_to_the_total(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign_id, ad_set_ids = await _rounds_campaign(client, ROUND_TWO)
    per_ad_set = AsyncMock(
        return_value=CampaignInsights(
            impressions=10, clicks=1, spend=400.0, conversions=1
        )
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", per_ad_set)
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=1200.0, conversions=2
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    assert per_ad_set.await_count == 3
    total = _run(client, optimization_jobs._latest_total_spend, campaign_id)
    assert total == 1200.0  # the campaign's own figure, not 1200 + 3 x 400
    assert (await _fetch_campaign(campaign_id)).status == "LIVE"


@pytest.mark.asyncio
async def test_a_single_ad_set_is_read_at_the_campaign_level_only(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _rounds_campaign(client, ROUND_ONE)
    per_ad_set = AsyncMock()
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", per_ad_set)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    assert per_ad_set.await_count == 0


async def _seed_ad_set_spend(
    campaign_id: str, ad_set_id: str, *, before: float, now: float
) -> None:
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=1.05),
        spend=before,
        ad_set_id=ad_set_id,
    )
    await _seed_metric(
        campaign_id, fetched_at=datetime.now(UTC), spend=now, ad_set_id=ad_set_id
    )


@pytest.mark.asyncio
async def test_the_daily_flag_judges_each_ad_set_against_its_own_budget(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    campaign_id, ids = await _rounds_campaign(client, ROUND_TWO)
    await _seed_baseline(campaign_id, days_ago=1.05)
    # Round 1's ad set spent $120 (under 1.25 x $100), the winners ad set $70 (over
    # 1.25 x $50 = $62.50).
    await _seed_ad_set_spend(campaign_id, ids[0], before=0.0, now=120.0)
    await _seed_ad_set_spend(campaign_id, ids[1], before=0.0, now=80.0)
    await _seed_ad_set_spend(campaign_id, ids[2], before=0.0, now=70.0)

    async def run_flag() -> None:
        campaign = await _fetch_campaign(campaign_id)
        await optimization_jobs._enforce_daily_spend_flag(campaign)

    _run(client, run_flag)

    flag = str((await _fetch_campaign(campaign_id)).dailySpendFlag)
    assert "Round 2 winners: $70.00 vs $50.00/day budget" in flag
    assert "Round 1:" not in flag


# --- the pause rules judge only the current round ---------------------------------


async def _seed_ad(
    campaign_id: str, ad_set_id: str, name: str, *, hours_ago: float
) -> str:
    """An ad with two ad-level snapshots, the first `hours_ago` hours back."""
    db = Prisma()
    await db.connect()
    try:
        ad = await db.ad.create(
            data={
                "adSetId": ad_set_id,
                "name": name,
                "status": "LIVE",
                "metaAdId": f"meta_{name}",
            }
        )
        for hours, spend in ((hours_ago, 10.0), (0.0, 60.0)):
            await db.metric.create(
                data={
                    "campaignId": campaign_id,
                    "adId": ad.id,
                    "impressions": 100,
                    "clicks": 10,
                    "spend": spend,
                    "conversions": 0,
                    "fetchedAt": datetime.now(UTC) - timedelta(hours=hours),
                }
            )
        return ad.id
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_the_rules_look_only_at_the_current_rounds_ads_in_both_ad_sets(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    campaign_id, ids = await _rounds_campaign(client, ROUND_TWO)
    old = await _seed_ad(campaign_id, ids[0], "round1-ad", hours_ago=300)
    fresh = await _seed_ad(campaign_id, ids[1], "round2-ad", hours_ago=60)
    carried = await _seed_ad(campaign_id, ids[2], "round2-winner", hours_ago=58)

    async def read() -> tuple[list[str], Any]:
        campaign = await _fetch_campaign(campaign_id)
        snapshots, first, _ = await optimization_jobs._creative_test_ads(campaign)
        return [s.ad_id for s in snapshots], first

    ad_ids, first = _run(client, read)

    assert sorted(ad_ids) == sorted([fresh, carried])
    assert old not in ad_ids
    # The clock starts with the round, not with the campaign's first snapshot.
    assert datetime.now(UTC) - first < timedelta(hours=61)
