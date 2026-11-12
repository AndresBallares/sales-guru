"""Ad-set-budget creative rounds (2026-11-12, stacked on the campaign-type PR).

Round 1 is one ad set with its own $100/day budget and a 10-day end. Every later
round is a new ad set at $100/day for 10 days plus one "winners" ad set at $50/day
that carries the earlier ads still active, reusing each winner's Facebook post.
Rounds never overlap. This file grows step by step; Meta is always mocked.
"""

from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.core.config import Settings, get_settings
from app.schemas.strategy import CreativeTestPlanContent
from app.services import campaign_type as ct
from app.services import strategist as strategist_module
from fastapi.testclient import TestClient

from tests.test_creative_test_plan import _business, _product
from tests.test_creative_test_plan_publish import _creative_plan
from tests.test_strategy import (
    _connect_meta,
    _create_business,
    _create_campaign,
    _signed_up_client,
    mock_generate_strategy,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_meta_oauth,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def ad_set_plan(**overrides: Any) -> CreativeTestPlanContent:
    """A creative-test plan as the Strategist now writes it: budgets on the ad sets."""
    return _creative_plan(
        bid_strategy="LOWEST_COST",
        daily_budget=100.0,
        total_budget=1000.0,
        rounds_budget="AD_SET",
        **overrides,
    )


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("FAKE_LLM", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --- the plan -------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_new_creative_test_plan_keeps_the_budget_on_each_ad_set(
    fake_llm: None,
) -> None:
    plan = await strategist_module.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        campaign_type="CREATIVE_TEST",
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert plan.rounds_budget == "AD_SET"
    assert plan.daily_budget == 100.0
    assert plan.duration_days == 10
    assert plan.winners_daily_budget == 50.0
    assert plan.max_winners == 4


def test_a_plan_stored_before_ad_set_rounds_keeps_its_campaign_budget() -> None:
    stored = _creative_plan().model_dump(mode="json")
    for field in ("rounds_budget", "winners_daily_budget", "max_winners"):
        stored.pop(field, None)

    plan = CreativeTestPlanContent.model_validate(stored)

    assert plan.rounds_budget == "CAMPAIGN"


def test_the_round_limit_is_a_setting_that_defaults_to_three() -> None:
    assert Settings().creative_test_max_rounds == 3


# --- the structure line -----------------------------------------------------


def test_the_structure_line_describes_ad_set_rounds() -> None:
    line = ct.structure_summary(
        "CREATIVE_TEST",
        ad_count=4,
        daily_budget=100.0,
        budget_level="AD_SET",
        duration_days=10,
    )

    assert (
        line
        == "Creative Test: round 1 of 3, 4 ads, $100/day for 10 days on its own ad set"
    )


def test_the_structure_line_keeps_the_campaign_budget_wording_for_old_plans() -> None:
    line = ct.structure_summary("CREATIVE_TEST", ad_count=4, daily_budget=100.0)

    assert line == "Creative Test: round 1 of 3, 4 ads, $100/day on the campaign"


# --- choosing the type puts the budget on the ad set -----------------------


def test_a_new_creative_test_is_stored_with_its_budget_on_the_ad_set(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = ad_set_plan()
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"campaignType": "CREATIVE_TEST"},
    )

    assert response.status_code == 201, response.text
    # The product has no fourth photo, so the test needs three ads.
    assert response.json()["structureSummary"] == (
        "Creative Test: round 1 of 3, 3 ads, $100/day for 10 days on its own ad set"
    )
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    campaign = next(c for c in campaigns if c["id"] == campaign_id)
    assert campaign["budgetLevel"] == "AD_SET"
    assert campaign["campaignType"] == "CREATIVE_TEST"


# --- the migration for drafts that were never published ----------------------------


def test_the_migration_moves_only_unpublished_campaign_budget_drafts() -> None:
    import pathlib
    import sqlite3

    sql = (
        pathlib.Path(__file__).parent.parent
        / "prisma/migrations"
        / "20261112000001_unpublished_creative_tests_to_ad_set_budgets"
        / "migration.sql"
    ).read_text()
    db = sqlite3.connect(":memory:")
    db.executescript(
        'CREATE TABLE "Campaign" ("id" TEXT, "metaCampaignId" TEXT, '
        '"budgetLevel" TEXT);'
        'CREATE TABLE "Strategy" ("campaignId" TEXT, "content" TEXT);'
    )
    plan = '{"planType":"CREATIVE_TEST_PLAN","objective":"SALES"}'
    rows = [
        ("draft", None, "CAMPAIGN", plan),  # moves
        ("published", "meta_1", "CAMPAIGN", plan),  # on Meta: untouched
        ("cost-cap", None, "AD_SET", plan),  # already on the ad set: untouched
        ("standard", None, "AD_SET", '{"planType":"DATA_DRIVEN_STRATEGY"}'),
    ]
    for campaign_id, meta_id, level, content in rows:
        db.execute(
            'INSERT INTO "Campaign" VALUES (?, ?, ?)', (campaign_id, meta_id, level)
        )
        db.execute('INSERT INTO "Strategy" VALUES (?, ?)', (campaign_id, content))

    db.executescript(sql)
    db.executescript(sql)  # running it again changes nothing

    levels = dict(db.execute('SELECT "id", "budgetLevel" FROM "Campaign"'))
    contents = dict(db.execute('SELECT "campaignId", "content" FROM "Strategy"'))
    assert levels == {
        "draft": "AD_SET",
        "published": "CAMPAIGN",
        "cost-cap": "AD_SET",
        "standard": "AD_SET",
    }
    assert contents["draft"].count('"roundsBudget":"AD_SET"') == 1
    assert contents["published"] == plan
    assert contents["standard"] == '{"planType":"DATA_DRIVEN_STRATEGY"}'
