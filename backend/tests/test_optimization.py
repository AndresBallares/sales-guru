"""Tests for the Campaign Optimization Agent endpoints (PRD.md build step 10).

app/api/optimization.py imports generate_and_store_recommendation,
pause_meta_ad, update_meta_ad_set_budget, and OptimizerError directly, so
those are what get mocked here — mocking the underlying service modules
(app.services.optimization_jobs / app.services.meta) wouldn't intercept
calls made from this API module. Same "mock where it's imported" rule
already established for test_metric.py / test_publish.py.
"""

from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module
from app.api import optimization as optimization_module
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import BudgetRecommendation, StrategyContent, TargetAudience
from app.services import meta as meta_service_module
from app.services.meta import MetaConnectionError
from app.services.optimizer import OptimizerError
from fastapi.testclient import TestClient
from prisma import Prisma

_FAKE_STRATEGY = StrategyContent(
    objective="SALES",
    target_audience=TargetAudience(age_min=30, age_max=55),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
)

_FAKE_VARIANTS = [
    GeneratedCreativeVariant(
        headline=f"Headline {letter}",
        body_text=f"Primary text {letter}",
        description=f"Description {letter}",
        cta="SHOP_NOW",
        creative_angle=f"Angle {letter}",
        image_prompt=f"Image prompt {letter}",
        video_prompt=f"Video prompt {letter}",
    )
    for letter in "ABCD"
]


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def _create_business(client: TestClient, name: str = "Acme Jewelry") -> str:
    """Create a business with a website, return its id."""
    response = client.post(
        "/businesses", json={"name": name, "website": "https://acme.example"}
    )
    id_: str = response.json()["id"]
    return id_


def _create_campaign(client: TestClient, business_id: str) -> str:
    """Create a campaign under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    )
    id_: str = response.json()["id"]
    return id_


def _connect_meta(client: TestClient, business_id: str) -> None:
    """Drive a full connect -> callback -> finalize round-trip (mocked)."""
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )


def _live_campaign(client: TestClient) -> tuple[str, str]:
    """Build a campaign all the way to LIVE on Meta.

    Returns:
        (business_id, campaign_id).
    """
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    _connect_meta(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    return business_id, campaign_id


async def _seed_metric(campaign_id: str) -> None:
    """Insert a single Metric row so the "has any metrics" precondition passes."""
    seeder = Prisma()
    await seeder.connect()
    await seeder.metric.create(
        data={
            "campaignId": campaign_id,
            "impressions": 1000,
            "clicks": 50,
            "spend": 12.5,
            "conversions": 8,
        }
    )
    await seeder.disconnect()


async def _seed_recommendation(campaign_id: str, **overrides: object) -> str:
    """Insert a PENDING OptimizationRecommendation row directly, return its id."""
    defaults: dict[str, object] = {
        "campaignId": campaign_id,
        "actionType": "INCREASE_BUDGET",
        "currentBudget": 25.0,
        "suggestedBudget": 30.0,
        "reasoning": "CPA decreased 24% over the last 3 days.",
        "confidence": 0.91,
        "risk": "MEDIUM",
    }
    defaults.update(overrides)
    seeder = Prisma()
    await seeder.connect()
    rec = await seeder.optimizationrecommendation.create(data=cast(Any, defaults))
    await seeder.disconnect()
    return rec.id


@pytest.fixture(autouse=True)
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Mock strategy/creative generation and the full Meta OAuth/publish path."""
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=_FAKE_STRATEGY)
    )
    monkeypatch.setattr(
        creative_module, "generate_creatives", AsyncMock(return_value=_FAKE_VARIANTS)
    )
    monkeypatch.setattr(
        meta_api_module,
        "build_authorization_url",
        lambda state: f"https://meta.example/{state}",
    )
    monkeypatch.setattr(
        meta_api_module,
        "exchange_code_for_token",
        AsyncMock(return_value="short-token"),
    )
    monkeypatch.setattr(
        meta_api_module,
        "get_long_lived_token",
        AsyncMock(return_value=("long-token", datetime.now(UTC) + timedelta(days=60))),
    )
    monkeypatch.setattr(
        meta_api_module, "get_meta_user_id", AsyncMock(return_value="meta-user-1")
    )
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_campaign",
        AsyncMock(return_value="meta_campaign_1"),
    )
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(return_value="meta_adset_1"),
    )
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_creative",
        AsyncMock(return_value="meta_creative_1"),
    )
    monkeypatch.setattr(
        meta_service_module, "create_meta_ad", AsyncMock(return_value="meta_ad_1")
    )

    generate = AsyncMock()
    pause = AsyncMock()
    update_budget = AsyncMock()
    monkeypatch.setattr(
        optimization_module, "generate_and_store_recommendation", generate
    )
    monkeypatch.setattr(optimization_module, "pause_meta_ad", pause)
    monkeypatch.setattr(optimization_module, "update_meta_ad_set_budget", update_budget)
    return {"generate": generate, "pause": pause, "update_budget": update_budget}


# --- create_recommendation ---------------------------------------------------


def test_create_recommendation_requires_a_session(client: TestClient) -> None:
    """Requesting a recommendation with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/optimize")

    assert response.status_code == 401


def test_create_recommendation_404s_for_another_users_campaign(
    client: TestClient,
) -> None:
    """A user can't request a recommendation for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 404


def test_create_recommendation_400s_before_the_campaign_is_live(
    client: TestClient,
) -> None:
    """A campaign that isn't LIVE yet can't be analyzed."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 400
    assert "publish" in response.json()["detail"].lower()


def test_create_recommendation_400s_without_any_metrics_yet(
    client: TestClient,
) -> None:
    """A LIVE campaign with no Metric snapshots yet can't be analyzed."""
    business_id, campaign_id = _live_campaign(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 400
    assert "refresh" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_recommendation_500s_when_the_agent_fails(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """An OptimizerError from the agent surfaces as a clean 500."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(campaign_id)
    mock_services["generate"].side_effect = OptimizerError("Anthropic API call failed")

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 500
    assert "Anthropic API call failed" in response.json()["detail"]


@pytest.mark.asyncio
async def test_create_recommendation_400s_when_there_isnt_enough_history(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """No trend window yet (fresh campaign) returns a clear 400, not a crash."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(campaign_id)
    mock_services["generate"].return_value = None

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 400
    assert "not enough" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_recommendation_returns_the_stored_recommendation(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A successful call returns the newly created recommendation."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(campaign_id)
    rec_id = await _seed_recommendation(campaign_id)
    seeder = Prisma()
    await seeder.connect()
    stored = await seeder.optimizationrecommendation.find_unique(where={"id": rec_id})
    await seeder.disconnect()
    assert stored is not None
    mock_services["generate"].return_value = stored

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    )

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == rec_id
    assert body["actionType"] == "INCREASE_BUDGET"
    assert body["confidence"] == pytest.approx(0.91)
    assert body["risk"] == "MEDIUM"
    assert body["requiresApproval"] is True
    assert body["status"] == "PENDING"


# --- list_recommendations -----------------------------------------------------


def test_list_recommendations_requires_a_session(client: TestClient) -> None:
    """Listing recommendations with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns/some-id/optimize")

    assert response.status_code == 401


def test_list_recommendations_404s_for_another_users_campaign(
    client: TestClient,
) -> None:
    """A user can't list recommendations for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/optimize")

    assert response.status_code == 404


def test_list_recommendations_returns_an_empty_list_before_any_generated(
    client: TestClient,
) -> None:
    """No recommendations yet returns an empty list, not a 404."""
    business_id, campaign_id = _live_campaign(client)

    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/optimize")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_recommendations_returns_most_recent_first(
    client: TestClient,
) -> None:
    """Recommendations are listed most-recent-first."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_recommendation(campaign_id, reasoning="First recommendation")
    await _seed_recommendation(campaign_id, reasoning="Second recommendation")

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    ).json()

    assert len(listed) == 2
    assert listed[0]["reasoning"] == "Second recommendation"
    assert listed[1]["reasoning"] == "First recommendation"


# --- approve_recommendation ----------------------------------------------------


def test_approve_recommendation_requires_a_session(client: TestClient) -> None:
    """Approving with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/campaigns/some-id/optimize/some-id/approve"
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_approve_recommendation_404s_for_a_nonexistent_recommendation(
    client: TestClient,
) -> None:
    """Approving an unknown recommendation id returns 404."""
    business_id, campaign_id = _live_campaign(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/"
        "does-not-exist/approve"
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_approve_recommendation_400s_if_already_applied(
    client: TestClient,
) -> None:
    """Approving a recommendation that's already been acted on fails closed."""
    business_id, campaign_id = _live_campaign(client)
    rec_id = await _seed_recommendation(campaign_id, status="APPLIED")

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/approve"
    )

    assert response.status_code == 400
    assert "already been acted on" in response.json()["detail"]


@pytest.mark.asyncio
async def test_approve_recommendation_increase_budget_updates_meta_and_the_ad_set(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Approving an INCREASE_BUDGET recommendation pushes the new budget to Meta."""
    business_id, campaign_id = _live_campaign(client)
    rec_id = await _seed_recommendation(
        campaign_id, actionType="INCREASE_BUDGET", suggestedBudget=30.0
    )

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/approve"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "APPLIED"
    mock_services["update_budget"].assert_awaited_once()
    _, kwargs = mock_services["update_budget"].call_args
    assert kwargs["daily_budget_cents"] == 3000

    seeder = Prisma()
    await seeder.connect()
    ad_set = await seeder.adset.find_first(where={"campaignId": campaign_id})
    await seeder.disconnect()
    assert ad_set is not None
    assert ad_set.budget == pytest.approx(30.0)


@pytest.mark.asyncio
async def test_approve_recommendation_pause_ad_updates_meta_and_the_ad(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Approving a PAUSE_AD recommendation pauses the ad on Meta and locally."""
    business_id, campaign_id = _live_campaign(client)

    seeder = Prisma()
    await seeder.connect()
    ad_set = await seeder.adset.find_first(where={"campaignId": campaign_id})
    assert ad_set is not None
    ad = await seeder.ad.find_first(where={"adSetId": ad_set.id})
    assert ad is not None
    await seeder.disconnect()

    rec_id = await _seed_recommendation(
        campaign_id,
        actionType="PAUSE_AD",
        targetAdId=ad.id,
        suggestedBudget=None,
    )

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/approve"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "APPLIED"
    mock_services["pause"].assert_awaited_once()

    seeder2 = Prisma()
    await seeder2.connect()
    refreshed_ad = await seeder2.ad.find_unique(where={"id": ad.id})
    await seeder2.disconnect()
    assert refreshed_ad is not None
    assert refreshed_ad.status == "PAUSED"


@pytest.mark.asyncio
async def test_approve_recommendation_surfaces_meta_failures_as_500(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A Graph API failure while applying an approval becomes a clean 500."""
    business_id, campaign_id = _live_campaign(client)
    rec_id = await _seed_recommendation(
        campaign_id, actionType="INCREASE_BUDGET", suggestedBudget=30.0
    )
    mock_services["update_budget"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/approve"
    )

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]


# --- reject_recommendation -----------------------------------------------------


def test_reject_recommendation_requires_a_session(client: TestClient) -> None:
    """Rejecting with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/campaigns/some-id/optimize/some-id/reject"
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_reject_recommendation_404s_for_a_nonexistent_recommendation(
    client: TestClient,
) -> None:
    """Rejecting an unknown recommendation id returns 404."""
    business_id, campaign_id = _live_campaign(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/"
        "does-not-exist/reject"
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_reject_recommendation_400s_if_already_rejected(
    client: TestClient,
) -> None:
    """Rejecting a recommendation that's already been acted on fails closed."""
    business_id, campaign_id = _live_campaign(client)
    rec_id = await _seed_recommendation(campaign_id, status="REJECTED")

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/reject"
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_reject_recommendation_marks_it_rejected_without_calling_meta(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Rejecting just records the decision — no Graph API call at all."""
    business_id, campaign_id = _live_campaign(client)
    rec_id = await _seed_recommendation(campaign_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize/{rec_id}/reject"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "REJECTED"
    mock_services["pause"].assert_not_awaited()
    mock_services["update_budget"].assert_not_awaited()
