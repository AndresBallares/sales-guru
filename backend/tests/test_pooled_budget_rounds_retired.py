"""Every ad set a round publishes owns its budget; the old "pack" path is gone.

Before ad-set rounds, a later round was published as a "pack": an ad set with no
budget of its own, drawing on one campaign budget shared with every other ad. That
publish path was retired. These tests pin the two halves of that:

1. A round published under the ad-set round design creates every ad set with its own
   daily budget, on a campaign created with ad set budget sharing off.
2. Nothing can create a budget-less ad set on an ad-set-budget campaign, and a
   campaign still on the old shared budget is told so, in words, before anything is
   made on Meta.

Meta is always mocked.
"""

import json
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.services import meta as meta_service_module
from app.services import publish as publish_module
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.models import Campaign

from tests.test_ad_set_round_publish import _round_two_ready
from tests.test_creative_rounds import _base, generate_mock  # noqa: F401
from tests.test_creative_test_plan_publish import (
    _cbo_plan,
    _creative_plan_campaign,
    _kwargs,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_data_driven_rounds import mock_round_angles  # noqa: F401
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_round_publish import (
    _publish_round,
    post_mocks,  # noqa: F401  (fixture, must be in this namespace)
)


def _campaign(*, id: str, budgetLevel: str) -> Campaign:  # noqa: A002, N803
    """Just the two fields the guard reads."""
    return cast(Campaign, SimpleNamespace(id=id, budgetLevel=budgetLevel))


# Captured at import, before any fixture replaces it with a mock.
_REAL_CREATE_CAMPAIGN = meta_service_module.create_meta_campaign


# --- 1. The ad-set round design gives every ad set its own budget -------------


@pytest.mark.asyncio
async def test_every_ad_set_of_rounds_one_and_two_owns_its_budget_with_sharing_off(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    campaign_kwargs = _kwargs(mock_services["create_campaign"])
    published = _publish_round(client, business_id, campaign_id, round_["id"])
    assert published.status_code == 200, published.text

    # Round 1's new ad set, then round 2's new ad set and its winners ad set.
    ad_sets = [c.kwargs for c in mock_services["create_ad_set"].await_args_list]
    assert [a["daily_budget_cents"] for a in ad_sets] == [10000, 10000, 5000]
    assert all(a.get("daily_min_spend_cents") is None for a in ad_sets)

    # The campaign holds no budget, so Meta is told sharing is off: sent for real
    # by the very arguments the publish used.
    assert campaign_kwargs["daily_budget_cents"] is None
    sent: list[dict[str, str]] = []

    async def capture(_url: str, payload: dict[str, str]) -> dict[str, str]:
        sent.append(payload)
        return {"id": "meta_campaign"}

    monkeypatch.setattr(meta_service_module, "_post_json", capture)
    await _REAL_CREATE_CAMPAIGN(**campaign_kwargs)
    assert sent[0]["is_adset_budget_sharing_enabled"] == "false"
    assert "daily_budget" not in sent[0]


# --- 2. A budget-less ad set on an ad-set-budget campaign is refused ----------


def test_an_ad_set_budget_campaign_refuses_an_ad_set_with_no_budget() -> None:
    campaign = _campaign(id="camp_1", budgetLevel="AD_SET")

    with pytest.raises(publish_module.AdSetBudgetError) as raised:
        publish_module.require_ad_set_budget(campaign, None)

    assert "camp_1" in str(raised.value)
    assert "own daily budget" in str(raised.value)


def test_an_ad_set_with_a_budget_is_allowed_and_a_shared_budget_is_left_alone() -> None:
    own = _campaign(id="a", budgetLevel="AD_SET")
    shared = _campaign(id="b", budgetLevel="CAMPAIGN")

    publish_module.require_ad_set_budget(own, 10000)
    publish_module.require_ad_set_budget(shared, None)  # a campaign budget: allowed


def test_the_pack_publish_function_no_longer_exists() -> None:
    assert not hasattr(publish_module, "publish_round_to_meta")
    assert not hasattr(publish_module, "pack_daily_min_spend")


def _old_budget_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> tuple[str, str]:
    """A published creative test whose plan still keeps its budget on the campaign."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client,
        monkeypatch,
        plan=_cbo_plan(),
        select=4,
        approve=True,
        photo_count=4,
    )
    response = client.post(f"{_base(campaign_id, business_id)}/publish")
    assert response.status_code == 200, response.text
    return business_id, campaign_id


@pytest.mark.asyncio
async def test_a_publish_that_would_reach_the_old_path_is_rejected_with_the_message(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _old_budget_campaign(client, monkeypatch)
    db = Prisma()
    await db.connect()
    try:
        round_ = await db.creativeround.create(
            data={
                "campaignId": campaign_id,
                "number": 2,
                "generatedCount": 4,
                "angles": json.dumps([]),
            }
        )
    finally:
        await db.disconnect()
    mock_services["create_ad_set"].reset_mock()

    response = _publish_round(client, business_id, campaign_id, round_.id)

    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    assert "shared campaign budget" in detail
    assert "new campaign" in detail
    assert mock_services["create_ad_set"].await_count == 0  # nothing reached Meta


def test_a_new_round_is_not_generated_for_a_campaign_that_cannot_publish_it(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _old_budget_campaign(client, monkeypatch)
    generate_mock.reset_mock()

    response = client.post(f"{_base(campaign_id, business_id)}/rounds")

    assert response.status_code == 400, response.text
    assert "shared campaign budget" in response.json()["detail"]
    assert generate_mock.await_count == 0  # no tokens spent on ads that can't run


def test_the_campaign_response_still_says_where_its_budget_lives(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _old_budget_campaign(client, monkeypatch)

    campaigns: list[dict[str, Any]] = client.get(
        f"/businesses/{business_id}/campaigns"
    ).json()

    assert next(c for c in campaigns if c["id"] == campaign_id)["budgetLevel"] == (
        "CAMPAIGN"
    )
