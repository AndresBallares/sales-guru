"""Campaign type: the user-chosen structure of a campaign (PR 1, tests first).

A campaign's type decides its plan shape, where its budget sits and whether it
can take follow-up rounds:

- CREATIVE_TEST: campaign budget (CBO), 4 ads per round, up to 3 rounds.
- DATA_DRIVEN: the same round structure; the targeting comes from the account's
  history. It reuses the creative-test plan shape (CREATIVE_TEST_PLAN) plus an
  `audienceSource` block.
- STANDARD: budget on the ad set, no rounds (explicit opt-in).
- GEO: built in PR 2; refused for now.
- LEGACY_AUDIENCE_TEST: the older audience test, kept for non-SALES objectives.

Nothing here is routed behind the user's back: the recommendation only
preselects, and an explicit choice always wins.
"""

import pathlib
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import campaign_type as ct
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_strategy import (
    _FAKE_CREATIVE_TEST_PLAN as _OLD_STYLE_PLAN,
)
from tests.test_strategy import (
    _FAKE_DATA_DRIVEN_STRATEGY,
    _FAKE_TEST_PLAN,
    _connect_meta,
    _create_business,
    _create_campaign,
    _signed_up_client,
    mock_generate_strategy,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_meta_oauth,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_no_account_history,  # noqa: F401  (fixture)
    mock_real_account_history,  # noqa: F401  (fixture)
)

# What the Strategist now generates: lowest-cost bidding, so the budget can sit on
# the campaign. (The shared fixture is an older cost-cap plan.)
_LOWEST_COST_PLAN = _OLD_STYLE_PLAN.model_copy(update={"bid_strategy": "LOWEST_COST"})


# --- the pure rules --------------------------------------------------------


def test_new_sales_accounts_are_recommended_a_creative_test() -> None:
    assert (
        ct.recommend_campaign_type(objective="SALES", has_history=False)
        == "CREATIVE_TEST"
    )


def test_an_account_with_real_history_is_recommended_data_driven() -> None:
    assert (
        ct.recommend_campaign_type(objective="SALES", has_history=True) == "DATA_DRIVEN"
    )


@pytest.mark.parametrize("objective", ["TRAFFIC", "LEADS", "MESSAGES", "AWARENESS"])
def test_other_objectives_keep_the_legacy_audience_test(objective: str) -> None:
    for has_history in (False, True):
        assert (
            ct.recommend_campaign_type(objective=objective, has_history=has_history)
            == "LEGACY_AUDIENCE_TEST"
        )


@pytest.mark.parametrize(
    ("campaign_type", "plan_type", "budget_level", "rounds"),
    [
        ("CREATIVE_TEST", "CREATIVE_TEST_PLAN", "CAMPAIGN", True),
        ("DATA_DRIVEN", "CREATIVE_TEST_PLAN", "CAMPAIGN", True),
        ("STANDARD", "DATA_DRIVEN_STRATEGY", "AD_SET", False),
        ("LEGACY_AUDIENCE_TEST", "TEST_PLAN", "AD_SET", False),
    ],
)
def test_each_type_maps_to_a_plan_a_budget_level_and_round_support(
    campaign_type: ct.CampaignType, plan_type: str, budget_level: str, rounds: bool
) -> None:
    assert ct.plan_type_for(campaign_type) == plan_type
    assert ct.budget_level_for(campaign_type) == budget_level
    assert ct.supports_rounds(campaign_type) is rounds


def test_the_review_screen_says_what_will_be_published() -> None:
    assert ct.structure_summary("CREATIVE_TEST", ad_count=4, daily_budget=100) == (
        "Creative Test: round 1 of 3, 4 ads, $100/day on the campaign"
    )
    assert ct.structure_summary("DATA_DRIVEN", ad_count=3, daily_budget=75) == (
        "Data-Driven: round 1 of 3, 3 ads, $75/day on the campaign"
    )
    assert ct.structure_summary("STANDARD", ad_count=2, daily_budget=40) == (
        "Standard: budget on the ad set, no rounds"
    )


@pytest.mark.parametrize(
    ("plan_type", "budget_level", "expected"),
    [
        ("CREATIVE_TEST_PLAN", "CAMPAIGN", "CREATIVE_TEST"),
        ("CREATIVE_TEST_PLAN", "AD_SET", "CREATIVE_TEST"),
        ("DATA_DRIVEN_STRATEGY", "AD_SET", "STANDARD"),
        ("DATA_DRIVEN_STRATEGY", "CAMPAIGN", "DATA_DRIVEN"),
        ("TEST_PLAN", "AD_SET", "LEGACY_AUDIENCE_TEST"),
    ],
)
def test_backfill_rule_for_existing_campaigns(
    plan_type: str, budget_level: str, expected: str
) -> None:
    assert ct.backfill_campaign_type(plan_type, budget_level) == expected


def test_a_campaign_without_a_strategy_has_no_type_yet() -> None:
    assert ct.backfill_campaign_type(None, "AD_SET") is None


# --- the options a user picks from ----------------------------------------


def _options(client: TestClient, business_id: str, campaign_id: str) -> Any:
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/campaign-types"
    )
    assert response.status_code == 200
    return response.json()


def _by_type(options: Any) -> dict[str, Any]:
    return {o["type"]: o for o in options["options"]}


def test_options_recommend_a_creative_test_for_a_new_account(
    client: TestClient,
    mock_no_account_history: AsyncMock,  # noqa: F811
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    options = _options(client, business_id, campaign_id)

    assert options["recommended"] == "CREATIVE_TEST"
    by_type = _by_type(options)
    carry_on = "The ads you keep active carry on in a $50/day winners ad set."
    assert by_type["CREATIVE_TEST"]["description"] == (
        "4 new ads per round at $100/day for 10 days, up to 3 rounds. " + carry_on
    )
    assert by_type["DATA_DRIVEN"]["description"] == (
        "Uses your account history to choose audiences. "
        "4 new ads per round at $100/day for 10 days, up to 3 rounds. " + carry_on
    )
    assert by_type["STANDARD"]["available"] is True
    assert "cannot run rounds" in by_type["STANDARD"]["warning"].lower()


def test_options_recommend_data_driven_once_the_history_threshold_is_met(
    client: TestClient,
    mock_real_account_history: AsyncMock,  # noqa: F811
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    options = _options(client, business_id, campaign_id)

    assert options["recommended"] == "DATA_DRIVEN"
    # The user can always pick the other one.
    assert _by_type(options)["CREATIVE_TEST"]["available"] is True


def test_options_without_meta_recommend_a_creative_test(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    assert _options(client, business_id, campaign_id)["recommended"] == (
        "CREATIVE_TEST"
    )


def test_geo_targeting_is_listed_but_coming_soon(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    geo = _by_type(_options(client, business_id, campaign_id))["GEO"]

    assert geo["available"] is False
    assert "coming soon" in geo["reason"].lower()


def test_other_objectives_only_offer_the_legacy_audience_test(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id, objective="TRAFFIC")

    options = _options(client, business_id, campaign_id)

    assert options["recommended"] == "LEGACY_AUDIENCE_TEST"
    by_type = _by_type(options)
    assert by_type["CREATIVE_TEST"]["available"] is False
    assert by_type["DATA_DRIVEN"]["available"] is False
    assert by_type["STANDARD"]["available"] is False


# --- the options before a campaign exists ---------------------------------


def _business_options(client: TestClient, business_id: str, objective: str) -> Any:
    response = client.get(
        f"/businesses/{business_id}/campaign-types", params={"objective": objective}
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_options_can_be_asked_for_before_the_campaign_exists(
    client: TestClient,
    mock_no_account_history: AsyncMock,  # noqa: F811
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)

    options = _business_options(client, business_id, "SALES")

    assert options["recommended"] == "CREATIVE_TEST"
    by_type = _by_type(options)
    assert by_type["DATA_DRIVEN"]["available"] is True
    assert by_type["GEO"]["available"] is False


def test_options_before_a_campaign_recommend_data_driven_with_history(
    client: TestClient,
    mock_real_account_history: AsyncMock,  # noqa: F811
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)

    assert (
        _business_options(client, business_id, "SALES")["recommended"] == "DATA_DRIVEN"
    )


def test_options_before_a_campaign_for_other_objectives(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    options = _business_options(client, business_id, "TRAFFIC")

    assert options["recommended"] == "LEGACY_AUDIENCE_TEST"
    assert _by_type(options)["CREATIVE_TEST"]["available"] is False


def test_options_before_a_campaign_reject_an_unknown_objective(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(
        f"/businesses/{business_id}/campaign-types", params={"objective": "NOPE"}
    )

    assert response.status_code == 422


def test_options_before_a_campaign_hide_another_users_business(
    client: TestClient,
) -> None:
    response = client.get(
        "/businesses/not-mine/campaign-types", params={"objective": "SALES"}
    )

    assert response.status_code in (401, 404)


async def _publish_marker(campaign_id: str, meta_campaign_id: str | None) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.campaign.update(
            where={"id": campaign_id}, data={"metaCampaignId": meta_campaign_id}
        )
    finally:
        await seeder.disconnect()


# --- choosing a type -------------------------------------------------------


def _choose(
    client: TestClient, business_id: str, campaign_id: str, **body: object
) -> Any:
    return client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy", json=body
    )


def _campaign(client: TestClient, business_id: str, campaign_id: str) -> Any:
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return next(c for c in campaigns if c["id"] == campaign_id)


def test_choosing_a_creative_test_puts_the_budget_on_the_campaign(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="CREATIVE_TEST")

    assert response.status_code == 201
    kwargs = mock_generate_strategy.call_args.kwargs
    assert kwargs["plan_type"] == "CREATIVE_TEST_PLAN"
    assert kwargs["campaign_type"] == "CREATIVE_TEST"
    campaign = _campaign(client, business_id, campaign_id)
    assert campaign["campaignType"] == "CREATIVE_TEST"
    assert campaign["budgetLevel"] == "CAMPAIGN"


def test_a_creative_test_needs_no_prior_experience_answer(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    """The type is chosen, not inferred, so the old question is not a gate."""
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="CREATIVE_TEST")

    assert response.status_code == 201


@pytest.mark.asyncio
async def test_a_published_creative_test_no_longer_forces_later_campaigns_to_standard(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    """The bug that started this: 'Test #1 happens once per business'."""
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    first = _create_campaign(client, business_id)
    _choose(client, business_id, first, campaignType="CREATIVE_TEST")
    await _publish_marker(first, "meta_campaign_1")
    second = _create_campaign(client, business_id)

    options = _options(client, business_id, second)
    _choose(client, business_id, second, campaignType="CREATIVE_TEST")

    assert options["recommended"] == "CREATIVE_TEST"
    assert mock_generate_strategy.call_args.kwargs["plan_type"] == "CREATIVE_TEST_PLAN"
    assert _campaign(client, business_id, second)["budgetLevel"] == "CAMPAIGN"


def test_with_no_choice_the_recommendation_is_used(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    _choose(client, business_id, campaign_id)

    assert (
        _campaign(client, business_id, campaign_id)["campaignType"] == "CREATIVE_TEST"
    )


def test_choosing_data_driven_reuses_the_creative_test_shape_with_history(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
    mock_real_account_history: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="DATA_DRIVEN")

    assert response.status_code == 201
    kwargs = mock_generate_strategy.call_args.kwargs
    assert kwargs["plan_type"] == "CREATIVE_TEST_PLAN"
    assert kwargs["campaign_type"] == "DATA_DRIVEN"
    # The account-history insights still reach the Strategist.
    assert kwargs["account_history"]
    campaign = _campaign(client, business_id, campaign_id)
    assert campaign["campaignType"] == "DATA_DRIVEN"
    assert campaign["budgetLevel"] == "CAMPAIGN"


def test_choosing_standard_keeps_the_budget_on_the_ad_set(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_DATA_DRIVEN_STRATEGY
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="STANDARD")

    assert response.status_code == 201
    assert (
        mock_generate_strategy.call_args.kwargs["plan_type"] == "DATA_DRIVEN_STRATEGY"
    )
    campaign = _campaign(client, business_id, campaign_id)
    assert campaign["campaignType"] == "STANDARD"
    assert campaign["budgetLevel"] == "AD_SET"


def test_choosing_the_legacy_audience_test_for_another_objective(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_TEST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id, objective="TRAFFIC")

    response = _choose(client, business_id, campaign_id)

    assert response.status_code == 201
    assert mock_generate_strategy.call_args.kwargs["plan_type"] == "TEST_PLAN"
    assert (
        _campaign(client, business_id, campaign_id)["campaignType"]
        == "LEGACY_AUDIENCE_TEST"
    )


def test_geo_targeting_cannot_be_chosen_yet(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="GEO")

    assert response.status_code == 400
    assert "coming soon" in response.json()["detail"].lower()
    mock_generate_strategy.assert_not_called()


@pytest.mark.parametrize("chosen", ["CREATIVE_TEST", "DATA_DRIVEN", "STANDARD"])
def test_round_based_and_standard_types_are_sales_only(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
    chosen: str,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id, objective="TRAFFIC")

    response = _choose(client, business_id, campaign_id, campaignType=chosen)

    assert response.status_code == 400
    assert "sales" in response.json()["detail"].lower()
    mock_generate_strategy.assert_not_called()


def test_an_unknown_type_is_rejected(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = _choose(client, business_id, campaign_id, campaignType="NONSENSE")

    assert response.status_code == 422


def test_the_old_strategy_mode_field_still_works_as_an_alias(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    """A client that still sends strategyMode: STANDARD gets a Standard campaign."""
    mock_generate_strategy.return_value = _FAKE_DATA_DRIVEN_STRATEGY
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    _choose(client, business_id, campaign_id, strategyMode="STANDARD")

    assert _campaign(client, business_id, campaign_id)["campaignType"] == "STANDARD"


@pytest.mark.parametrize("chosen", ["CREATIVE_TEST", "DATA_DRIVEN"])
def test_carousel_is_allowed_in_both_round_based_types(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
    mock_real_account_history: AsyncMock,  # noqa: F811
    chosen: str,
) -> None:
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = _choose(
        client, business_id, campaign_id, campaignType=chosen, testFormat="CAROUSEL"
    )

    assert response.status_code == 201
    assert mock_generate_strategy.call_args.kwargs["creative_format"] == "CAROUSEL"


def test_the_strategy_response_states_what_will_be_published(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _LOWEST_COST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    body = _choose(
        client, business_id, campaign_id, campaignType="CREATIVE_TEST"
    ).json()

    assert body["campaignType"] == "CREATIVE_TEST"
    assert body["structureSummary"].startswith(
        "Creative Test: round 1 of 3, "
    ) and body["structureSummary"].endswith("/day on the campaign")


def test_the_strategy_response_for_standard_says_there_are_no_rounds(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_DATA_DRIVEN_STRATEGY
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    body = _choose(client, business_id, campaign_id, campaignType="STANDARD").json()

    assert body["structureSummary"] == "Standard: budget on the ad set, no rounds"


def test_the_stored_strategy_keeps_its_summary_on_get(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_DATA_DRIVEN_STRATEGY
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _choose(client, business_id, campaign_id, campaignType="STANDARD")

    body = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    ).json()

    assert body["structureSummary"] == "Standard: budget on the ad set, no rounds"


# --- rounds ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_standard_campaign_cannot_start_a_round(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_DATA_DRIVEN_STRATEGY
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _choose(client, business_id, campaign_id, campaignType="STANDARD")
    await _publish_marker(campaign_id, "meta_campaign_1")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/rounds")

    assert response.status_code == 400
    assert "can't run rounds" in response.json()["detail"].lower()


# --- the backfill migration -----------------------------------------------

_MIGRATION = (
    pathlib.Path(__file__).parent.parent
    / "prisma"
    / "migrations"
    / "20261111000000_add_campaign_type"
    / "migration.sql"
)


def test_the_migration_exists_for_both_databases() -> None:
    postgres = _MIGRATION.parents[2] / "postgres" / "migrations"
    assert _MIGRATION.exists()
    assert (postgres / _MIGRATION.parent.name / "migration.sql").exists()


def _backfill_statements() -> list[str]:
    statements = []
    for chunk in _MIGRATION.read_text().split(";"):
        lines = [x for x in chunk.splitlines() if not x.strip().startswith("--")]
        statement = "\n".join(lines).strip()
        if statement.upper().startswith("UPDATE"):
            statements.append(statement)
    return statements


@pytest.mark.asyncio
async def test_the_backfill_types_existing_campaigns_and_is_idempotent(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    cases = {
        ("CREATIVE_TEST_PLAN", "CAMPAIGN"): "CREATIVE_TEST",
        ("CREATIVE_TEST_PLAN", "AD_SET"): "CREATIVE_TEST",
        ("DATA_DRIVEN_STRATEGY", "AD_SET"): "STANDARD",
        ("TEST_PLAN", "AD_SET"): "LEGACY_AUDIENCE_TEST",
    }
    ids: dict[tuple[str, str], str] = {}
    db = Prisma()
    await db.connect()
    try:
        for (plan_type, level), _ in cases.items():
            campaign_id = _create_campaign(client, business_id)
            ids[(plan_type, level)] = campaign_id
            await db.campaign.update(
                where={"id": campaign_id}, data={"budgetLevel": level}
            )
            await db.strategy.create(
                data={
                    "campaignId": campaign_id,
                    "content": f'{{"planType":"{plan_type}"}}',
                }
            )
        no_strategy = _create_campaign(client, business_id)

        for _ in range(2):  # running it twice changes nothing
            for statement in _backfill_statements():
                await db.execute_raw(statement)
            for key, expected in cases.items():
                row = await db.campaign.find_unique(where={"id": ids[key]})
                assert row is not None
                assert row.campaignType == expected, key
            untouched = await db.campaign.find_unique(where={"id": no_strategy})
            assert untouched is not None and untouched.campaignType is None
    finally:
        await db.disconnect()


def test_the_round_limit_in_the_descriptions_follows_the_setting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    monkeypatch.setenv("CREATIVE_TEST_MAX_ROUNDS", "2")
    get_settings.cache_clear()
    try:
        text = ct.describe("CREATIVE_TEST")
    finally:
        get_settings.cache_clear()

    assert "up to 2 rounds" in text
