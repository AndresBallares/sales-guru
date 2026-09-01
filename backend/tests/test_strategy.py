"""Tests for the Marketing Strategist Agent endpoints.

generate_strategy (the actual LLM call) is mocked here — its own behavior
is covered by test_strategist_service.py. These tests cover auth,
ownership scoping, storage, response shape, and plan_type resolution
(real Meta history vs. the one-time self-report question, confirmed with
the user 2026-08-31).
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from app.api import strategy as strategy_module
from app.schemas.strategy import (
    BudgetRecommendation,
    DataDrivenStrategyContent,
    GeneratedTestPlanFields,
    NormalizedMetrics,
    TargetAudience,
    TestPlanContent,
)
from app.services import strategist as strategist_service
from app.services.meta import AccountCampaignInsights, MetaConnectionError
from fastapi.testclient import TestClient

_FAKE_DATA_DRIVEN_STRATEGY = DataDrivenStrategyContent(
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
    key_learnings=["Craftsmanship angle performed best"],
    recommended_adjustments=["Drop the price angle"],
    scaling_trigger="Increase budget once CAC stays under target",
)

# Built from the real assembly helpers (not a hand-rolled duplicate shape)
# so this fixture can't silently drift from what generate_strategy() itself
# produces — see app/services/strategist.py.
_GENERATED_TEST_PLAN_FIELDS = GeneratedTestPlanFields(
    hypothesis_audience_name="Luxury Jewelry Interest Audience",
    hypothesis_audience_targeting=TargetAudience(
        age_min=30, age_max=55, interests=["fine jewelry"]
    ),
    hypothesis_statement="The hypothesis-driven audience will produce a lower CAC.",
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Price value"],
    copy_strategy="Lead with the story behind each piece",
)
_FAKE_BENCHMARK_CONTEXT = strategist_service._build_benchmark_context()
_FAKE_TEST_PLAN = TestPlanContent(
    objective="SALES",
    audience_variants=[
        strategist_service._build_broad_baseline_variant(),
        strategist_service._build_hypothesis_variant(_GENERATED_TEST_PLAN_FIELDS),
    ],
    hypotheses=[
        strategist_service._build_primary_hypothesis(
            _GENERATED_TEST_PLAN_FIELDS.hypothesis_statement
        )
    ],
    offer=_GENERATED_TEST_PLAN_FIELDS.offer,
    positioning=_GENERATED_TEST_PLAN_FIELDS.positioning,
    creative_angles=_GENERATED_TEST_PLAN_FIELDS.creative_angles,
    copy_strategy=_GENERATED_TEST_PLAN_FIELDS.copy_strategy,
    daily_budget=50,
    duration_days=10,
    total_budget=1000,
    success_criteria=strategist_service._build_success_criteria(
        _FAKE_BENCHMARK_CONTEXT, None
    ),
    baseline_metrics=NormalizedMetrics(),
    benchmark_context=_FAKE_BENCHMARK_CONTEXT,
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


@pytest.fixture(autouse=True)
def mock_generate_strategy(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """By default, generating a strategy succeeds with a canned
    DATA_DRIVEN_STRATEGY result."""
    mock = AsyncMock(return_value=_FAKE_DATA_DRIVEN_STRATEGY)
    monkeypatch.setattr(strategy_module, "generate_strategy", mock)
    return mock


@pytest.fixture(autouse=True)
def mock_meta_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mock the Meta OAuth service calls _connect_meta drives through."""
    from app.api import meta as meta_api_module

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


@pytest.fixture
def mock_no_account_history(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """A connected Meta account with no historical spend."""
    mock = AsyncMock(return_value=[])
    monkeypatch.setattr(strategy_module, "fetch_account_historical_performance", mock)
    return mock


@pytest.fixture
def mock_real_account_history(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """A connected Meta account with real historical spend."""
    mock = AsyncMock(
        return_value=[
            AccountCampaignInsights(
                campaign_name="Spring Sale",
                impressions=5000,
                clicks=200,
                spend=150.0,
                conversions=5,
            )
        ]
    )
    monkeypatch.setattr(strategy_module, "fetch_account_historical_performance", mock)
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


def test_create_strategy_without_meta_or_answer_requires_an_answer(
    client: TestClient,
) -> None:
    """No Meta connection and no self-report yet -> 428, asking the frontend
    to prompt for the one-time question."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )

    assert response.status_code == 428


def test_create_strategy_answering_no_generates_a_test_plan(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """Answering "no" to the one-time question resolves to TEST_PLAN."""
    mock_generate_strategy.return_value = _FAKE_TEST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": False},
    )

    assert response.status_code == 201
    assert response.json()["content"]["planType"] == "TEST_PLAN"
    assert mock_generate_strategy.call_args.kwargs["plan_type"] == "TEST_PLAN"


def test_create_strategy_answering_yes_generates_a_data_driven_strategy_plan(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """Answering "yes" resolves to DATA_DRIVEN_STRATEGY even with no real
    numeric history available."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )

    assert response.status_code == 201
    assert response.json()["content"]["planType"] == "DATA_DRIVEN_STRATEGY"
    assert (
        mock_generate_strategy.call_args.kwargs["plan_type"] == "DATA_DRIVEN_STRATEGY"
    )


def test_create_strategy_only_asks_the_question_once(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """Once answered, the business's stored answer is reused — the frontend
    never needs to ask again."""
    mock_generate_strategy.return_value = _FAKE_TEST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": False},
    )

    second_campaign_id = _create_campaign(client, business_id)
    response = client.post(
        f"/businesses/{business_id}/campaigns/{second_campaign_id}/strategy"
    )

    assert response.status_code == 201
    assert mock_generate_strategy.call_args.kwargs["plan_type"] == "TEST_PLAN"


def test_create_strategy_uses_real_meta_history_over_a_no_answer(
    client: TestClient,
    mock_generate_strategy: AsyncMock,
    mock_real_account_history: AsyncMock,
) -> None:
    """Real Meta ad-account spend overrides even a "no" self-report — never
    trust self-report over real evidence."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": False},
    )

    assert response.status_code == 201
    call_kwargs = mock_generate_strategy.call_args.kwargs
    assert call_kwargs["plan_type"] == "DATA_DRIVEN_STRATEGY"
    assert len(call_kwargs["account_history"]) == 1
    assert call_kwargs["account_history"][0].campaign_name == "Spring Sale"


def test_create_strategy_with_meta_connected_but_no_history_still_needs_an_answer(
    client: TestClient,
    mock_generate_strategy: AsyncMock,
    mock_no_account_history: AsyncMock,
) -> None:
    """A connected Meta account with zero historical spend falls back to the
    self-report question, same as no connection at all."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )

    assert response.status_code == 428


def test_create_strategy_degrades_gracefully_when_the_insights_call_fails(
    client: TestClient,
    mock_generate_strategy: AsyncMock,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Meta Insights outage falls back to the self-report path rather than
    failing strategy generation outright."""
    monkeypatch.setattr(
        strategy_module,
        "fetch_account_historical_performance",
        AsyncMock(side_effect=MetaConnectionError("Meta API call failed: boom")),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _connect_meta(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )

    assert response.status_code == 201
    assert (
        mock_generate_strategy.call_args.kwargs["plan_type"] == "DATA_DRIVEN_STRATEGY"
    )


def test_create_strategy_stores_and_returns_the_strategy(
    client: TestClient, mock_generate_strategy: AsyncMock
) -> None:
    """A generated strategy is stored and returned with the full structured content."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
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

    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "STRATEGY_GENERATED"


def test_create_strategy_replaces_an_existing_one(client: TestClient) -> None:
    """Calling create again regenerates rather than erroring or duplicating."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    first = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )
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
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
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
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )
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
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    ).json()

    response = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")

    assert response.status_code == 200
    assert response.json() == created
