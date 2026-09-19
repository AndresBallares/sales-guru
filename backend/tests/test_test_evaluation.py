"""Tests for the TEST_PLAN Optimizer endpoints ("Phase B").

app/api/test_evaluation.py imports generate_and_store_test_evaluation
directly, so that's what gets mocked on this API module — same "mock
where it's imported" rule already established for test_optimization.py.
generate_and_store_test_evaluation's own real behavior (the data-
sufficiency gate, backend-only INSUFFICIENT_DATA construction, the LLM
call path) is covered directly in test_optimization_jobs.py.
"""

import json
import struct
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module
from app.api import strategy as strategy_module
from app.api import test_evaluation as test_evaluation_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    DataDrivenStrategyContent,
    GeneratedTestPlanFields,
    NormalizedMetrics,
    TargetAudience,
    TestPlanContent,
)
from app.services import meta as meta_service_module
from app.services import strategist as strategist_module
from fastapi.testclient import TestClient
from prisma import Prisma


def _fake_test_plan() -> TestPlanContent:
    """Build a real TestPlanContent from the strategist's own assembly
    helpers, not a hand-rolled duplicate shape."""
    generated = GeneratedTestPlanFields(
        hypothesis_audience_name="Luxury Jewelry Interest Audience",
        hypothesis_audience_targeting=TargetAudience(
            age_min=30, age_max=55, interests=["jewelry"]
        ),
        hypothesis_statement="The hypothesis-driven audience will produce a lower CAC.",
        offer="Custom emerald rings",
        positioning="Premium and personal",
        creative_angles=["Craftsmanship", "Price value"],
        copy_strategy="Lead with the story behind each piece",
    )
    benchmark_context = strategist_module._build_benchmark_context()
    return TestPlanContent(
        objective="SALES",
        audience_variants=[
            strategist_module._build_broad_baseline_variant(),
            strategist_module._build_hypothesis_variant(generated),
        ],
        hypotheses=[
            strategist_module._build_primary_hypothesis(generated.hypothesis_statement)
        ],
        offer=generated.offer,
        positioning=generated.positioning,
        creative_angles=generated.creative_angles,
        copy_strategy=generated.copy_strategy,
        daily_budget=50.0,
        duration_days=10,
        total_budget=1000.0,
        success_criteria=strategist_module._build_success_criteria(
            benchmark_context, None
        ),
        baseline_metrics=NormalizedMetrics(),
        benchmark_context=benchmark_context,
    )


_FAKE_TEST_PLAN = _fake_test_plan()

_FAKE_DATA_DRIVEN_STRATEGY = DataDrivenStrategyContent(
    objective="SALES",
    target_audience=TargetAudience(age_min=30, age_max=55),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
    key_learnings=["Craftsmanship angle performed best"],
    recommended_adjustments=["Drop the price angle"],
    scaling_trigger="Increase budget once CAC stays under target",
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
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def _create_business(client: TestClient, name: str = "Acme Jewelry") -> str:
    """Create a business with a website, return its id."""
    response = client.post(
        "/businesses",
        json={
            "name": name,
            "website": "https://acme.example",
            "industry": "FASHION_JEWELRY",
        },
    )
    id_: str = response.json()["id"]
    return id_


def _valid_jpeg(width: int = 800, height: int = 800) -> bytes:
    """A minimal but structurally valid JPEG header, same construction as
    test_creative.py / test_product_image.py — select_creative now 428s a
    product with zero uploaded photos (confirmed 2026-09-09), so every
    helper here that auto-creates a product feeding a /select call needs
    one on file first.
    """
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


def _create_campaign(client: TestClient, business_id: str) -> str:
    """Create a campaign under a business, return its id.

    Auto-creates a default product/audience — every campaign needs both
    to generate a strategy now (readiness gate, app/services/
    campaign_readiness.py).
    """
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("ring.jpg", _valid_jpeg(), "image/jpeg")},
    )
    audience_id = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Busy professionals, 30-55"},
    ).json()["id"]
    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
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
    client.post(
        f"/businesses/{business_id}/meta/pixel",
        json={"pixelId": "pixel_1"},
    )


def _live_campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    test_plan: bool = True,
) -> tuple[str, str]:
    """Build a campaign all the way to LIVE on Meta.

    Args:
        monkeypatch: Used to override the autouse mock_services fixture's
            default TEST_PLAN strategy when test_plan=False.
        test_plan: Whether the mocked strategy should be a TEST_PLAN
            (the default) or a DATA_DRIVEN_STRATEGY.

    Returns:
        (business_id, campaign_id).
    """
    if not test_plan:
        monkeypatch.setattr(
            strategy_module,
            "generate_strategy",
            AsyncMock(return_value=_FAKE_DATA_DRIVEN_STRATEGY),
        )
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )
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


async def _seed_test_evaluation(campaign_id: str, **overrides: object) -> str:
    """Insert a TestEvaluation row directly, return its id."""
    defaults: dict[str, object] = {
        "campaignId": campaign_id,
        "status": "SUFFICIENT_DATA",
        "winningVariant": None,
        "confidence": "DIRECTIONAL",
        "hypothesisResult": "INCONCLUSIVE",
        "keyFindings": json.dumps(["CTR is within the typical range."]),
        "recommendedAction": "continue_testing",
        "reasoning": "Not enough conversion volume yet.",
    }
    defaults.update(overrides)
    seeder = Prisma()
    await seeder.connect()
    evaluation = await seeder.testevaluation.create(data=cast(Any, defaults))
    await seeder.disconnect()
    return evaluation.id


@pytest.fixture(autouse=True)
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Mock strategy/creative generation, the full Meta OAuth/publish path,
    and generate_and_store_test_evaluation itself."""
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=_FAKE_TEST_PLAN)
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
        meta_service_module,
        "upload_meta_ad_image",
        AsyncMock(return_value="fake_image_hash_1"),
    )
    monkeypatch.setattr(
        meta_service_module, "create_meta_ad", AsyncMock(return_value="meta_ad_1")
    )

    generate = AsyncMock()
    monkeypatch.setattr(
        test_evaluation_module, "generate_and_store_test_evaluation", generate
    )
    return {"generate": generate}


# --- create_test_evaluation --------------------------------------------------


def test_create_test_evaluation_requires_a_session(client: TestClient) -> None:
    """Requesting an evaluation with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/test-evaluation")

    assert response.status_code == 401


def test_create_test_evaluation_404s_for_another_users_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A user can't request an evaluation for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 404


def test_create_test_evaluation_400s_before_the_campaign_is_live(
    client: TestClient,
) -> None:
    """A campaign that isn't LIVE yet can't be evaluated."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 400
    assert "publish" in response.json()["detail"].lower()


def test_create_test_evaluation_400s_for_a_data_driven_strategy(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A DATA_DRIVEN_STRATEGY campaign isn't evaluated by this endpoint —
    that's what app/api/optimization.py is for."""
    business_id, campaign_id = _live_campaign(client, monkeypatch, test_plan=False)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 400
    assert "not a test_plan" in response.json()["detail"].lower()


def test_create_test_evaluation_400s_without_any_metrics_yet(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A LIVE TEST_PLAN campaign with no Metric snapshots yet can't be evaluated."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 400
    assert "refresh" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_create_test_evaluation_500s_when_the_agent_fails(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An OptimizerError from the agent surfaces as a clean 500."""
    from app.services.optimizer import OptimizerError

    business_id, campaign_id = _live_campaign(client, monkeypatch)
    await _seed_metric(campaign_id)
    mock_services["generate"].side_effect = OptimizerError("Anthropic API call failed")

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 500
    assert "Anthropic API call failed" in response.json()["detail"]


@pytest.mark.asyncio
async def test_create_test_evaluation_returns_the_stored_evaluation(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A successful call returns the newly created evaluation."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    await _seed_metric(campaign_id)
    evaluation_id = await _seed_test_evaluation(campaign_id)
    seeder = Prisma()
    await seeder.connect()
    stored = await seeder.testevaluation.find_unique(where={"id": evaluation_id})
    await seeder.disconnect()
    assert stored is not None
    mock_services["generate"].return_value = stored

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 201
    body = response.json()
    assert body["id"] == evaluation_id
    assert body["status"] == "SUFFICIENT_DATA"
    assert body["hypothesisResult"] == "INCONCLUSIVE"
    assert body["winningVariant"] is None
    assert body["keyFindings"] == ["CTR is within the typical range."]
    assert body["recommendedAction"] == "continue_testing"


# --- list_test_evaluations ----------------------------------------------------


def test_list_test_evaluations_requires_a_session(client: TestClient) -> None:
    """Listing evaluations with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns/some-id/test-evaluation")

    assert response.status_code == 401


def test_list_test_evaluations_404s_for_another_users_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A user can't list evaluations for a campaign they don't own."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 404


def test_list_test_evaluations_returns_an_empty_list_before_any_generated(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """No evaluations yet returns an empty list, not a 404."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)

    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    )

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_list_test_evaluations_returns_most_recent_first(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Evaluations are listed most-recent-first."""
    business_id, campaign_id = _live_campaign(client, monkeypatch)
    await _seed_test_evaluation(campaign_id, reasoning="First evaluation")
    await _seed_test_evaluation(campaign_id, reasoning="Second evaluation")

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()

    assert len(listed) == 2
    assert listed[0]["reasoning"] == "Second evaluation"
    assert listed[1]["reasoning"] == "First evaluation"
