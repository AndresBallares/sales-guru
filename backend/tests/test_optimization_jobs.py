"""Tests for the scheduled optimization jobs (PRD.md build step 10).

collect_metrics_for_all_live_campaigns / generate_and_store_recommendation /
evaluate_all_live_campaigns all read and write through the shared
app.core.db.db singleton, which is only connected inside the TestClient's
own portal thread (see conftest.py / app.main's lifespan) — awaiting them
directly from a pytest-asyncio test's own event loop fails, the same
cross-loop issue documented elsewhere in this suite for the singleton.
client.portal.call(fn, *args) (Starlette's TestClient keeps its
anyio.BlockingPortal alive for the lifetime of the `with` block, see
starlette.testclient.TestClient.__enter__) runs the job on that same
thread/loop, so it's used everywhere a job function is invoked here. Fresh
Prisma() connections are still used for direct seeding/inspection, same
convention as test_metric.py / test_publish.py, since those are
self-contained (connect, use, disconnect on one loop) regardless of which
loop that is.

optimization_jobs.py does `from app.services import optimizer` (module
import) so optimizer.generate_recommendation is mocked on that module, but
`from app.services.meta import ... fetch_campaign_insights` (direct
import) so fetch_campaign_insights must be mocked on optimization_jobs
itself — the same "mock where it's imported, not where it's defined" rule
already established for test_metric.py / test_publish.py.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.optimization import GeneratedRecommendation
from app.schemas.strategy import BudgetRecommendation, StrategyContent, TargetAudience
from app.services import meta as meta_service_module
from app.services import optimization_jobs
from app.services import optimizer as optimizer_module
from app.services.meta import CampaignInsights, MetaConnectionError
from fastapi.testclient import TestClient
from prisma import Prisma


def _run[T](client: TestClient, func: Callable[..., Awaitable[T]], *args: object) -> T:
    """Run an async job function on the TestClient's own portal thread/loop.

    Needed because the job functions read/write through the shared
    app.core.db.db singleton, which is only connected inside the
    TestClient's portal thread — see the module docstring.
    """
    assert client.portal is not None
    return client.portal.call(func, *args)


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

_FAKE_RECOMMENDATION = GeneratedRecommendation(
    action_type="INCREASE_BUDGET",
    reasoning="CPA decreased 24% over the last 3 days.",
    confidence=0.91,
    risk="MEDIUM",
    suggested_budget=30.0,
)


def _fake_result(
    recommendation: GeneratedRecommendation = _FAKE_RECOMMENDATION,
    *,
    capped_by_guardrail: bool = False,
) -> optimizer_module.RecommendationResult:
    """Wrap a GeneratedRecommendation as generate_recommendation's real return shape."""
    return optimizer_module.RecommendationResult(
        recommendation=recommendation, capped_by_guardrail=capped_by_guardrail
    )


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


def _publish_campaign(client: TestClient, business_id: str) -> str:
    """Build and publish one campaign under an already Meta-connected business.

    Returns:
        The new campaign's id.
    """
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    ).json()["id"]
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    return campaign_id


def _live_campaign(client: TestClient) -> tuple[str, str]:
    """Sign up, connect Meta, and publish a single campaign.

    Returns:
        (business_id, campaign_id).
    """
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_campaign(client, business_id)
    return business_id, campaign_id


async def _seed_metric(
    campaign_id: str,
    *,
    fetched_at: datetime,
    impressions: int = 1000,
    clicks: int = 50,
    spend: float = 12.5,
    conversions: int = 8,
) -> None:
    """Insert a Metric snapshot with a controlled fetchedAt via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    await seeder.metric.create(
        data={
            "campaignId": campaign_id,
            "impressions": impressions,
            "clicks": clicks,
            "spend": spend,
            "conversions": conversions,
            "fetchedAt": fetched_at,
        }
    )
    await seeder.disconnect()


@pytest.fixture(autouse=True)
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Mock strategy/creative generation, Meta OAuth, and Meta object creation."""
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
        return_value=CampaignInsights(
            impressions=1000, clicks=50, spend=12.5, conversions=3
        )
    )
    monkeypatch.setattr(optimization_jobs, "fetch_campaign_insights", insights)
    return {"insights": insights}


# --- collect_metrics_for_all_live_campaigns ---------------------------------


def test_collect_metrics_creates_a_snapshot_for_each_live_campaign(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A live, Meta-connected campaign gets a fresh Metric row."""
    business_id, campaign_id = _live_campaign(client)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert len(listed) == 1
    assert listed[0]["impressions"] == 1000
    assert listed[0]["spend"] == 12.5


def test_collect_metrics_skips_a_campaign_whose_meta_call_fails(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """One campaign's Graph API failure doesn't block collection for others."""
    business_id, campaign_id = _live_campaign(client)
    other_campaign_id = _publish_campaign(client, business_id)

    mock_services["insights"].side_effect = [
        MetaConnectionError("Invalid OAuth access token"),
        CampaignInsights(impressions=500, clicks=20, spend=5.0, conversions=1),
    ]

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    failed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    succeeded = client.get(
        f"/businesses/{business_id}/campaigns/{other_campaign_id}/metrics"
    ).json()
    assert failed == []
    assert len(succeeded) == 1


@pytest.mark.asyncio
async def test_collect_metrics_skips_a_campaign_with_no_meta_connection(
    client: TestClient,
) -> None:
    """Defense in depth: no MetaConnection means skipped, not crashed."""
    business_id, campaign_id = _live_campaign(client)

    seeder = Prisma()
    await seeder.connect()
    await seeder.metaconnection.delete_many(where={"businessId": business_id})
    await seeder.disconnect()

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert listed == []


# --- generate_and_store_recommendation --------------------------------------


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_returns_none_without_history(
    client: TestClient,
) -> None:
    """A single, just-taken snapshot has no baseline to diff against yet."""
    _, campaign_id = _live_campaign(client)
    await _seed_metric(campaign_id, fetched_at=datetime.now(UTC))

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()
    assert campaign is not None

    result = _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    assert result is None
    listed = client.get(
        f"/businesses/{campaign.businessId}/campaigns/{campaign_id}/optimize"
    ).json()
    assert listed == []


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_stores_a_pending_recommendation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A real trend window produces and stores a PENDING recommendation."""
    business_id, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(campaign_id, fetched_at=now - timedelta(hours=25), spend=10.0)
    await _seed_metric(campaign_id, fetched_at=now, spend=25.0)
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result()),
    )

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()
    assert campaign is not None

    result = _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    assert result is not None
    assert result.status == "PENDING"
    assert result.actionType == "INCREASE_BUDGET"
    assert result.confidence == pytest.approx(0.91)
    assert result.risk == "MEDIUM"
    assert result.currentBudget == pytest.approx(25.0)

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/optimize"
    ).json()
    assert len(listed) == 1


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_sets_target_ad_id_for_pause(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A PAUSE_AD recommendation records which local Ad it targets."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(campaign_id, fetched_at=now - timedelta(hours=25), spend=10.0)
    await _seed_metric(campaign_id, fetched_at=now, spend=25.0)
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(
            return_value=_fake_result(
                _FAKE_RECOMMENDATION.model_copy(
                    update={"action_type": "PAUSE_AD", "suggested_budget": None}
                )
            )
        ),
    )

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    ad_set = await seeder.adset.find_first(where={"campaignId": campaign_id})
    assert ad_set is not None
    ad = await seeder.ad.find_first(where={"adSetId": ad_set.id})
    await seeder.disconnect()
    assert campaign is not None
    assert ad is not None

    result = _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    assert result is not None
    assert result.actionType == "PAUSE_AD"
    assert result.targetAdId == ad.id


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_auto_applies_when_eligible(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """LOW risk + high confidence budget change applies to Meta with no click."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(campaign_id, fetched_at=now - timedelta(hours=25), spend=10.0)
    await _seed_metric(campaign_id, fetched_at=now, spend=25.0)
    auto_eligible = GeneratedRecommendation(
        action_type="INCREASE_BUDGET",
        reasoning="Strong, consistent performance across all windows.",
        confidence=0.95,
        risk="LOW",
        suggested_budget=27.0,
    )
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result(auto_eligible)),
    )
    update_budget = AsyncMock()
    monkeypatch.setattr(optimization_jobs, "update_meta_ad_set_budget", update_budget)

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()
    assert campaign is not None

    result = _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    assert result is not None
    assert result.status == "APPLIED"
    assert result.requiresApproval is False
    update_budget.assert_awaited_once()

    seeder = Prisma()
    await seeder.connect()
    ad_set = await seeder.adset.find_first(where={"campaignId": campaign_id})
    await seeder.disconnect()
    assert ad_set is not None
    assert ad_set.budget == pytest.approx(27.0)


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_falls_back_when_auto_apply_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A Meta failure during auto-apply falls back to manual approval."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(campaign_id, fetched_at=now - timedelta(hours=25), spend=10.0)
    await _seed_metric(campaign_id, fetched_at=now, spend=25.0)
    auto_eligible = GeneratedRecommendation(
        action_type="INCREASE_BUDGET",
        reasoning="Strong, consistent performance across all windows.",
        confidence=0.95,
        risk="LOW",
        suggested_budget=27.0,
    )
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result(auto_eligible)),
    )
    monkeypatch.setattr(
        optimization_jobs,
        "update_meta_ad_set_budget",
        AsyncMock(side_effect=MetaConnectionError("Invalid OAuth access token")),
    )

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()
    assert campaign is not None

    result = _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    assert result is not None
    assert result.status == "PENDING"
    assert result.requiresApproval is True


@pytest.mark.asyncio
async def test_generate_and_store_recommendation_supersedes_a_prior_pending_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Generating a new recommendation supersedes any still-PENDING prior one."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(campaign_id, fetched_at=now - timedelta(hours=25), spend=10.0)
    await _seed_metric(campaign_id, fetched_at=now, spend=25.0)
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result()),
    )

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    assert campaign is not None
    prior = await seeder.optimizationrecommendation.create(
        data={
            "campaignId": campaign_id,
            "actionType": "INCREASE_BUDGET",
            "currentBudget": 25.0,
            "suggestedBudget": 30.0,
            "reasoning": "An earlier recommendation.",
            "confidence": 0.5,
            "risk": "LOW",
        }
    )
    await seeder.disconnect()

    _run(client, optimization_jobs.generate_and_store_recommendation, campaign)

    seeder2 = Prisma()
    await seeder2.connect()
    refreshed_prior = await seeder2.optimizationrecommendation.find_unique(
        where={"id": prior.id}
    )
    all_recs = await seeder2.optimizationrecommendation.find_many(
        where={"campaignId": campaign_id}
    )
    await seeder2.disconnect()

    assert refreshed_prior is not None
    assert refreshed_prior.status == "SUPERSEDED"
    assert sum(1 for r in all_recs if r.status == "PENDING") == 1


# --- evaluate_all_live_campaigns / _evaluate_campaign -----------------------


@pytest.mark.asyncio
async def test_evaluate_waits_and_still_records_the_check_when_data_is_insufficient(
    client: TestClient,
) -> None:
    """Below-threshold spend/clicks means WAIT, but the check time still advances."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(
        campaign_id,
        fetched_at=now - timedelta(hours=1),
        spend=2.0,
        clicks=4,
    )

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    recs = await seeder.optimizationrecommendation.find_many(
        where={"campaignId": campaign_id}
    )
    await seeder.disconnect()

    assert campaign is not None
    assert campaign.lastOptimizationCheckAt is not None
    assert recs == []


@pytest.mark.asyncio
async def test_evaluate_skips_campaigns_with_no_metrics_at_all(
    client: TestClient,
) -> None:
    """No Metric rows yet means _evaluate_campaign bails before the checkpoint."""
    _, campaign_id = _live_campaign(client)

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()

    assert campaign is not None
    assert campaign.lastOptimizationCheckAt is None


@pytest.mark.asyncio
async def test_evaluate_generates_a_recommendation_when_the_gate_passes(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Enough elapsed time, spend, and clicks triggers a real recommendation."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(
        campaign_id,
        fetched_at=now - timedelta(hours=25),
        spend=0.0,
        clicks=0,
        impressions=0,
        conversions=0,
    )
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        spend=25.0,
        clicks=40,
        impressions=2000,
        conversions=6,
    )
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result()),
    )

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder = Prisma()
    await seeder.connect()
    recs = await seeder.optimizationrecommendation.find_many(
        where={"campaignId": campaign_id}
    )
    await seeder.disconnect()
    assert len(recs) == 1
    assert recs[0].status == "PENDING"


@pytest.mark.asyncio
async def test_evaluate_respects_the_minimum_gap_between_recommendations(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A gate pass within 24h of the last recommendation still doesn't fire again."""
    _, campaign_id = _live_campaign(client)
    now = datetime.now(UTC)
    await _seed_metric(
        campaign_id,
        fetched_at=now - timedelta(hours=7),
        spend=0.0,
        clicks=0,
        impressions=0,
        conversions=0,
    )
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        spend=25.0,
        clicks=40,
        impressions=2000,
        conversions=6,
    )
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(return_value=_fake_result()),
    )

    seeder = Prisma()
    await seeder.connect()
    await seeder.optimizationrecommendation.create(
        data={
            "campaignId": campaign_id,
            "actionType": "INCREASE_BUDGET",
            "currentBudget": 25.0,
            "suggestedBudget": 30.0,
            "reasoning": "A very recent recommendation.",
            "confidence": 0.7,
            "risk": "LOW",
        }
    )
    await seeder.disconnect()

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder2 = Prisma()
    await seeder2.connect()
    recs = await seeder2.optimizationrecommendation.find_many(
        where={"campaignId": campaign_id}
    )
    await seeder2.disconnect()
    assert len(recs) == 1  # still just the one seeded above, no new one added


@pytest.mark.asyncio
async def test_evaluate_isolates_failures_between_campaigns(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One campaign's LLM failure doesn't stop the batch from evaluating the rest."""
    business_id, first_campaign_id = _live_campaign(client)
    second_campaign_id = _publish_campaign(client, business_id)
    now = datetime.now(UTC)
    for campaign_id in (first_campaign_id, second_campaign_id):
        await _seed_metric(
            campaign_id,
            fetched_at=now - timedelta(hours=25),
            spend=0.0,
            clicks=0,
            impressions=0,
            conversions=0,
        )
        await _seed_metric(
            campaign_id,
            fetched_at=now,
            spend=25.0,
            clicks=40,
            impressions=2000,
            conversions=6,
        )
    monkeypatch.setattr(
        optimizer_module,
        "generate_recommendation",
        AsyncMock(
            side_effect=[
                optimizer_module.OptimizerError("boom"),
                _fake_result(),
            ]
        ),
    )

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder = Prisma()
    await seeder.connect()
    all_recs = await seeder.optimizationrecommendation.find_many()
    await seeder.disconnect()
    assert len(all_recs) == 1
