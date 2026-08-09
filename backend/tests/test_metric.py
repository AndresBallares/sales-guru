"""Tests for the results dashboard endpoints (PRD.md build step 9).

Strategy/creative generation, the Meta OAuth connect flow, and the actual
Meta object-creation calls are all mocked (same conventions as
test_publish.py) so a campaign can be driven all the way to LIVE through
the real endpoints. Only fetch_campaign_insights is mocked for the
metrics endpoints themselves.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module

# app.api.metric imports fetch_campaign_insights directly, so that's the
# module to patch for it — same reasoning as strategy_module/creative_module
# above (their own API modules, not app.services.meta/creative directly).
from app.api import metric as metric_module
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    StrategyContent,
    TargetAudience,
)
from app.services import meta as meta_service_module
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


@pytest.fixture(autouse=True)
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Mock strategy/creative generation, Meta OAuth, Meta object creation, insights."""
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

    insights = AsyncMock(
        return_value=meta_service_module.CampaignInsights(
            impressions=1000, clicks=50, spend=12.5, conversions=3
        )
    )
    monkeypatch.setattr(metric_module, "fetch_campaign_insights", insights)
    return {"insights": insights}


def test_refresh_metrics_requires_a_session(client: TestClient) -> None:
    """Refreshing metrics with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/metrics/refresh")

    assert response.status_code == 401


def test_refresh_metrics_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Refreshing metrics for a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/metrics/refresh"
    )

    assert response.status_code == 404


def test_refresh_metrics_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't refresh metrics for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh"
    )

    assert response.status_code == 404


def test_refresh_metrics_400s_before_the_campaign_is_published(
    client: TestClient,
) -> None:
    """A campaign with no metaCampaignId yet can't have its metrics refreshed."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh"
    )

    assert response.status_code == 400
    assert "publish" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_refresh_metrics_400s_if_meta_gets_disconnected_after_publishing(
    client: TestClient,
) -> None:
    """Defense in depth: a MetaConnection removed after publish fails closed.

    Uses a fresh Prisma() connection to delete the connection directly,
    since disconnect() would normally only be called before publishing —
    same reasoning as test_meta.py's / test_publish.py's fresh-Prisma
    tests for otherwise-unreachable states.
    """
    business_id, campaign_id = _live_campaign(client)

    seeder = Prisma()
    await seeder.connect()
    await seeder.metaconnection.delete_many(where={"businessId": business_id})
    await seeder.disconnect()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh"
    )

    assert response.status_code == 400
    assert "connected" in response.json()["detail"].lower()


def test_refresh_metrics_stores_a_new_snapshot(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A successful refresh stores and returns the fetched numbers."""
    business_id, campaign_id = _live_campaign(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh"
    )

    assert response.status_code == 201
    body = response.json()
    assert body["campaignId"] == campaign_id
    assert body["impressions"] == 1000
    assert body["clicks"] == 50
    assert body["spend"] == 12.5
    assert body["conversions"] == 3
    mock_services["insights"].assert_awaited_once()


def test_refresh_metrics_appends_rather_than_overwrites(client: TestClient) -> None:
    """Refreshing twice keeps both snapshots, not just the latest."""
    business_id, campaign_id = _live_campaign(client)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh")

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert len(listed) == 2


def test_refresh_metrics_surfaces_meta_failures_as_500(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A Graph API failure becomes a clean 500."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _live_campaign(client)
    mock_services["insights"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh"
    )

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]


def test_list_metrics_requires_a_session(client: TestClient) -> None:
    """Listing metrics with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns/some-id/metrics")

    assert response.status_code == 401


def test_list_metrics_returns_an_empty_list_before_any_refresh(
    client: TestClient,
) -> None:
    """No snapshots yet returns an empty list, not a 404 — a normal state."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics")

    assert response.status_code == 200
    assert response.json() == []


def test_list_metrics_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't list metrics for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics")

    assert response.status_code == 404


def test_list_metrics_returns_most_recent_first(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Snapshots are listed most-recent-first."""
    business_id, campaign_id = _live_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh")

    mock_services["insights"].return_value = meta_service_module.CampaignInsights(
        impressions=2000, clicks=90, spend=30.0, conversions=8
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/metrics/refresh")

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert len(listed) == 2
    assert listed[0]["impressions"] == 2000
    assert listed[1]["impressions"] == 1000
