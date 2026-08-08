"""Tests for the Marketing Strategist Agent endpoints.

generate_strategy (the actual LLM call) is mocked here — its own behavior
is covered by test_strategist_service.py. These tests cover auth, ownership
scoping, storage, and response shape.
"""

from unittest.mock import AsyncMock

import pytest
from app.api import strategy as strategy_module
from app.schemas.strategy import (
    BudgetRecommendation,
    StrategyContent,
    TargetAudience,
)
from fastapi.testclient import TestClient

_FAKE_STRATEGY = StrategyContent(
    objective="SALES",
    target_audience=TargetAudience(
        age_min=30,
        age_max=55,
        location=["New York"],
        interests=["fine jewelry"],
        problem="Hard to find quality pieces",
        desire="Own something unique",
    ),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
)


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post("/businesses", json={"name": name})
    id_: str = response.json()["id"]
    return id_


def _create_campaign(client: TestClient, business_id: str) -> str:
    """Create a campaign under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    )
    id_: str = response.json()["id"]
    return id_


@pytest.fixture(autouse=True)
def mock_generate_strategy(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """By default, generating a strategy succeeds with a canned result."""
    mock = AsyncMock(return_value=_FAKE_STRATEGY)
    monkeypatch.setattr(strategy_module, "generate_strategy", mock)
    return mock


def test_create_strategy_requires_a_session(client: TestClient) -> None:
    """Generating a strategy with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/strategy")

    assert response.status_code == 401


def test_create_strategy_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Generating a strategy for a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/strategy"
    )

    assert response.status_code == 404


def test_create_strategy_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't generate a strategy for a campaign they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )

    assert response.status_code == 404


def test_create_strategy_stores_and_returns_the_strategy(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """A generated strategy is stored and returned with the full structured content."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )

    assert response.status_code == 201
    body = response.json()
    assert body["campaignId"] == campaign_id
    assert body["content"]["objective"] == "SALES"
    assert body["content"]["targetAudience"]["ageMin"] == 30
    assert body["content"]["creativeAngles"] == ["Craftsmanship", "Luxury"]
    assert body["content"]["budgetRecommendation"]["daily"] == 25
    assert "id" in body
    assert "createdAt" in body
    mock_generate_strategy.assert_awaited_once()


def test_create_strategy_marks_the_campaign_as_strategy_generated(
    client: TestClient,
) -> None:
    """Generating a strategy advances Campaign.status."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "STRATEGY_GENERATED"


def test_create_strategy_replaces_an_existing_one(client: TestClient) -> None:
    """Calling create again regenerates rather than erroring or duplicating."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    first = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    second = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    assert first.status_code == 201
    assert second.status_code == 201
    assert first.json()["id"] != second.json()["id"]

    fetched = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    assert fetched.json()["id"] == second.json()["id"]


def test_create_strategy_surfaces_agent_failures_as_500(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """A StrategistError (e.g. missing API key, LLM failure) becomes a clean 500."""
    from app.services.strategist import StrategistError

    mock_generate_strategy.side_effect = StrategistError(
        "ANTHROPIC_API_KEY is not configured"
    )

    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )

    assert response.status_code == 500
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


def test_get_strategy_requires_a_session(client: TestClient) -> None:
    """Fetching a strategy with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns/some-id/strategy")

    assert response.status_code == 401


def test_get_strategy_404s_when_none_generated_yet(client: TestClient) -> None:
    """Fetching a strategy before one was ever generated returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    assert response.status_code == 404


def test_get_strategy_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't fetch a strategy for a campaign they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    assert response.status_code == 404


def test_get_strategy_returns_the_stored_strategy(client: TestClient) -> None:
    """The previously generated strategy round-trips correctly on fetch."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    created = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    ).json()

    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    assert response.status_code == 200
    assert response.json() == created
