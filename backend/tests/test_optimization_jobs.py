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
from app.schemas.strategy import (
    BudgetRecommendation,
    DataDrivenStrategyContent,
    GeneratedTestPlanFields,
    NormalizedMetrics,
    TargetAudience,
    TestPlanContent,
    UnitEconomicsFields,
)
from app.schemas.test_evaluation import GeneratedTestEvaluation
from app.services import meta as meta_service_module
from app.services import optimization_jobs
from app.services import optimizer as optimizer_module
from app.services import strategist as strategist_module
from app.services.benchmarks import JEWELRY_META_BENCHMARKS
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


_FAKE_STRATEGY = DataDrivenStrategyContent(
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
        "/businesses",
        json={
            "name": name,
            "website": "https://acme.example",
            "industry": "FASHION_JEWELRY",
        },
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
    # SALES (the default objective in these tests) maps to OFFSITE_CONVERSIONS,
    # which requires a configured Pixel to publish (real API behavior
    # confirmed 2026-08-29) — set one so these "build a live campaign"
    # helpers keep working for tests that aren't about the Pixel requirement
    # itself (see test_meta.py / test_campaign.py for those).
    client.post(
        f"/businesses/{business_id}/meta/pixel",
        json={"pixelId": "pixel_1"},
    )


def _publish_campaign(client: TestClient, business_id: str) -> str:
    """Build and publish one campaign under an already Meta-connected business.

    Auto-creates a default product/audience — every campaign needs both
    to generate a strategy now (readiness gate, app/services/
    campaign_readiness.py).

    Returns:
        The new campaign's id.
    """
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    audience_id = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Busy professionals, 30-55"},
    ).json()["id"]
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
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
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    return campaign_id


def _publish_test_plan_campaign(
    client: TestClient, business_id: str, monkeypatch: pytest.MonkeyPatch
) -> str:
    """Same as _publish_campaign, but with a TEST_PLAN strategy instead of
    the DATA_DRIVEN_STRATEGY the autouse mock_services fixture defaults to
    — overrides that mock's return value just for the strategy-generation
    call this helper makes.

    Returns:
        The new campaign's id.
    """
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=_FAKE_TEST_PLAN)
    )
    return _publish_campaign(client, business_id)


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
    ad_set_id: str | None = None,
    cac: float | None = None,
    purchases: int | None = None,
) -> None:
    """Insert a Metric snapshot with a controlled fetchedAt via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    await seeder.metric.create(
        data={
            "campaignId": campaign_id,
            "adSetId": ad_set_id,
            "impressions": impressions,
            "clicks": clicks,
            "spend": spend,
            "conversions": conversions,
            "cac": cac,
            "purchases": purchases,
            "fetchedAt": fetched_at,
        }
    )
    await seeder.disconnect()


async def _fetch_ad_sets_by_variant(campaign_id: str) -> dict[str, str]:
    """Fetch a campaign's real AdSet ids, keyed by variantId, via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
    await seeder.disconnect()
    return {a.variantId: a.id for a in ad_sets if a.variantId is not None}


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
    pause_ad_set = AsyncMock(return_value=None)
    monkeypatch.setattr(meta_service_module, "pause_meta_ad_set", pause_ad_set)

    insights = AsyncMock(
        return_value=CampaignInsights(
            impressions=1000, clicks=50, spend=12.5, conversions=3
        )
    )
    monkeypatch.setattr(optimization_jobs, "fetch_campaign_insights", insights)
    return {"insights": insights, "pause_ad_set": pause_ad_set}


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


def test_collect_metrics_collects_per_adset_for_a_test_plan_campaign(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A TEST_PLAN campaign (two real AdSets, "Phase C") collects one
    Metric snapshot per AdSet, each tagged with its own adSetId, instead
    of one undifferentiated campaign-level aggregate."""
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(side_effect=["meta_adset_a", "meta_adset_b"]),
    )
    ad_set_insights = AsyncMock(
        side_effect=[
            CampaignInsights(impressions=100, clicks=5, spend=10.0, conversions=1),
            CampaignInsights(impressions=200, clicks=10, spend=20.0, conversions=2),
        ]
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", ad_set_insights)
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert len(listed) == 2
    ad_set_ids = {m["adSetId"] for m in listed}
    assert None not in ad_set_ids
    assert len(ad_set_ids) == 2
    mock_services["insights"].assert_not_awaited()  # campaign-level call unused


def test_collect_metrics_one_variant_failing_doesnt_block_the_other(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One TEST_PLAN variant's Meta call failing still records the other."""
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(side_effect=["meta_adset_a", "meta_adset_b"]),
    )
    ad_set_insights = AsyncMock(
        side_effect=[
            MetaConnectionError("Invalid OAuth access token"),
            CampaignInsights(impressions=200, clicks=10, spend=20.0, conversions=2),
        ]
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", ad_set_insights)
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/metrics"
    ).json()
    assert len(listed) == 1
    assert listed[0]["impressions"] == 200


# --- _enforce_spend_circuit_breaker (via collect_metrics_for_all_live_campaigns) --


def _campaign_status(
    client: TestClient, business_id: str, campaign_id: str
) -> dict[str, object]:
    """Fetch one campaign's current API representation, by id."""
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return next(c for c in campaigns if c["id"] == campaign_id)


def test_circuit_breaker_pauses_a_test_plan_that_exceeded_its_total_budget(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Combined spend across both variants exceeding total_budget ($1,000
    for the fake test plan: $50/day x 2 variants x 10 days) auto-pauses
    the campaign — deterministic, no LLM call involved. Also auto-
    triggers a test evaluation right away, stopReason
    TOTAL_SPEND_CIRCUIT_BREAKER."""
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(side_effect=["meta_adset_a", "meta_adset_b"]),
    )
    ad_set_insights = AsyncMock(
        side_effect=[
            CampaignInsights(impressions=100, clicks=50, spend=600.0, conversions=10),
            CampaignInsights(impressions=100, clicks=50, spend=600.0, conversions=10),
        ]
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", ad_set_insights)
    monkeypatch.setattr(
        optimizer_module,
        "evaluate_test_plan",
        AsyncMock(return_value=_VALID_TEST_EVALUATION),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    paused_reason = str(campaign["pausedReason"])
    assert "1,200.00" in paused_reason
    assert "1,000.00" in paused_reason
    assert mock_services["pause_ad_set"].await_count == 2
    paused_ids = {
        c.kwargs["meta_ad_set_id"] for c in mock_services["pause_ad_set"].call_args_list
    }
    assert paused_ids == {"meta_adset_a", "meta_adset_b"}

    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert len(evaluations) == 1
    assert evaluations[0]["stopReason"] == "TOTAL_SPEND_CIRCUIT_BREAKER"


def test_circuit_breaker_leaves_a_test_plan_under_budget_live(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Combined spend still under total_budget doesn't trigger anything."""
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(side_effect=["meta_adset_a", "meta_adset_b"]),
    )
    ad_set_insights = AsyncMock(
        side_effect=[
            CampaignInsights(impressions=100, clicks=50, spend=400.0, conversions=10),
            CampaignInsights(impressions=100, clicks=50, spend=400.0, conversions=10),
        ]
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", ad_set_insights)
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    assert campaign["pausedReason"] is None
    mock_services["pause_ad_set"].assert_not_awaited()


def test_circuit_breaker_never_touches_a_data_driven_strategy_campaign(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """DATA_DRIVEN_STRATEGY has no total_budget concept — no spend level
    triggers an auto-pause, however high."""
    mock_services["insights"].return_value = CampaignInsights(
        impressions=100000, clicks=5000, spend=999999.0, conversions=100
    )
    business_id, campaign_id = _live_campaign(client)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    mock_services["pause_ad_set"].assert_not_awaited()


# --- _enforce_cac_circuit_breaker (via collect_metrics_for_all_live_campaigns) ---


@pytest.mark.asyncio
async def test_cac_circuit_breaker_pauses_when_rolling_cac_exceeds_2x_target(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Rolling 3-day CAC blowing past 2x the target (the jewelry benchmark
    median, $55, since the default fake strategy has no product unit
    economics) auto-pauses — deterministic, no LLM call involved."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=4),
        spend=0.0,
        conversions=0,
        purchases=0,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=1200.0, conversions=10, purchases=10
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    assert "Rolling 3-day CAC" in str(campaign["pausedReason"])
    mock_services["pause_ad_set"].assert_awaited_once()

    # DATA_DRIVEN_STRATEGY (the default fake strategy _live_campaign
    # publishes) has no test hypothesis to evaluate — only TEST_PLAN
    # campaigns get an auto-evaluation after a circuit-breaker pause.
    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert evaluations == []


@pytest.mark.asyncio
async def test_cac_circuit_breaker_auto_evaluates_a_test_plan_it_pauses(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Unlike the total-spend breaker (TEST_PLAN only), the CAC breaker
    applies to any plan type — but only a TEST_PLAN it pauses gets an
    auto-evaluation right away, stopReason CAC_CIRCUIT_BREAKER."""
    monkeypatch.setattr(
        meta_service_module,
        "create_meta_ad_set",
        AsyncMock(side_effect=["meta_adset_a", "meta_adset_b"]),
    )
    monkeypatch.setattr(
        optimizer_module,
        "evaluate_test_plan",
        AsyncMock(return_value=_VALID_TEST_EVALUATION),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    ad_sets_by_variant = await _fetch_ad_sets_by_variant(campaign_id)

    old = datetime.now(UTC) - timedelta(days=4)
    for ad_set_id in ad_sets_by_variant.values():
        await _seed_metric(
            campaign_id,
            fetched_at=old,
            ad_set_id=ad_set_id,
            spend=0.0,
            conversions=0,
            purchases=0,
        )
    # $400/variant ($800 combined) stays under the $1,000 total_budget, so
    # the total-spend breaker doesn't fire first — only 3 purchases each
    # ($6 combined) pushes the rolling CAC ($800/6 ≈ $133) past 2x the
    # $55 benchmark target ($110).
    ad_set_insights = AsyncMock(
        side_effect=[
            CampaignInsights(
                impressions=1000, clicks=100, spend=400.0, conversions=3, purchases=3
            ),
            CampaignInsights(
                impressions=1000, clicks=100, spend=400.0, conversions=3, purchases=3
            ),
        ]
    )
    monkeypatch.setattr(optimization_jobs, "fetch_ad_set_insights", ad_set_insights)

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    assert "Rolling 3-day CAC" in str(campaign["pausedReason"])

    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert len(evaluations) == 1
    assert evaluations[0]["stopReason"] == "CAC_CIRCUIT_BREAKER"


@pytest.mark.asyncio
async def test_cac_circuit_breaker_leaves_a_campaign_within_target_live(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A rolling CAC within 2x the target doesn't trigger anything."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=4),
        spend=0.0,
        conversions=0,
        purchases=0,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=500.0, conversions=10, purchases=10
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    mock_services["pause_ad_set"].assert_not_awaited()


@pytest.mark.asyncio
async def test_cac_circuit_breaker_pauses_on_real_spend_with_zero_purchases(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """Real spend with zero purchases over the window is worse than any
    finite CAC ratio — not silently skipped as "can't compute"."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=4),
        spend=0.0,
        conversions=0,
        purchases=0,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=150.0, conversions=0, purchases=0
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    assert "zero purchases" in str(campaign["pausedReason"])


@pytest.mark.asyncio
async def test_cac_circuit_breaker_skips_below_the_minimum_rolling_spend(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A rolling window with less than $100 of spend isn't trusted yet,
    however bad the ratio looks."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=4),
        spend=1195.0,
        conversions=10,
        purchases=10,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=1200.0, conversions=10, purchases=10
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    mock_services["pause_ad_set"].assert_not_awaited()


@pytest.mark.asyncio
async def test_cac_circuit_breaker_uses_the_products_own_target_cac(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A campaign with real product unit economics is judged against its
    own target_cac, not the industry benchmark — never blended."""
    strategy_with_economics = _FAKE_STRATEGY.model_copy(
        update={
            "unit_economics": UnitEconomicsFields(
                gross_profit=200.0,
                breakeven_cac=200.0,
                target_cac=1000.0,
                breakeven_roas=2.5,
            )
        }
    )
    monkeypatch.setattr(
        strategy_module,
        "generate_strategy",
        AsyncMock(return_value=strategy_with_economics),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_campaign(client, business_id)

    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=4),
        spend=0.0,
        conversions=0,
        purchases=0,
    )
    # $1200 for 10 purchases = $120 CAC — under 2x this product's own
    # $1,000 target, even though it would blow well past 2x the $55
    # jewelry benchmark median.
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=1200.0, conversions=10, purchases=10
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    assert JEWELRY_META_BENCHMARKS.cac.median < 120 / 2  # sanity: benchmark would fire


# --- _enforce_daily_spend_flag (via collect_metrics_for_all_live_campaigns) ---


@pytest.mark.asyncio
async def test_daily_spend_flag_set_when_a_days_spend_exceeds_1_25x_budget(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A single day's spend over 1.25x the ad set's daily budget flags the
    campaign — a monitoring signal, never a pause."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=1, hours=1),
        spend=0.0,
        conversions=0,
    )
    # The fake strategy's DATA_DRIVEN_STRATEGY budget_recommendation.daily
    # is $25 — 1.25x that is $31.25.
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=40.0, conversions=2
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    assert campaign["dailySpendFlag"] is not None
    assert "1.25x" in str(campaign["dailySpendFlag"])
    mock_services["pause_ad_set"].assert_not_awaited()


@pytest.mark.asyncio
async def test_daily_spend_flag_stays_clear_within_budget(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A day's spend within 1.25x the budget never sets the flag."""
    business_id, campaign_id = _live_campaign(client)
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=1, hours=1),
        spend=0.0,
        conversions=0,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=20.0, conversions=2
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["dailySpendFlag"] is None


@pytest.mark.asyncio
async def test_daily_spend_flag_clears_once_no_longer_overspending(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """The flag is refreshed every cycle — it clears once the condition
    that set it no longer holds, rather than staying stuck."""
    business_id, campaign_id = _live_campaign(client)
    seeder = Prisma()
    await seeder.connect()
    await seeder.campaign.update(
        where={"id": campaign_id}, data={"dailySpendFlag": "stale flag from before"}
    )
    await seeder.disconnect()
    await _seed_metric(
        campaign_id,
        fetched_at=datetime.now(UTC) - timedelta(days=1, hours=1),
        spend=0.0,
        conversions=0,
    )
    mock_services["insights"].return_value = CampaignInsights(
        impressions=1000, clicks=100, spend=20.0, conversions=2
    )

    _run(client, optimization_jobs.collect_metrics_for_all_live_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["dailySpendFlag"] is None


# --- pause_expired_campaigns -------------------------------------------------


async def _set_end_date(campaign_id: str, end_date: datetime) -> None:
    """Set a campaign's endDate directly via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    await seeder.campaign.update(where={"id": campaign_id}, data={"endDate": end_date})
    await seeder.disconnect()


@pytest.mark.asyncio
async def test_pause_expired_campaigns_pauses_one_past_its_end_date(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A live campaign whose endDate is in the past gets auto-paused."""
    business_id, campaign_id = _live_campaign(client)
    await _set_end_date(campaign_id, datetime.now(UTC) - timedelta(days=1))

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    assert campaign["pausedReason"] == "Planned end date reached"
    mock_services["pause_ad_set"].assert_awaited_once()

    # DATA_DRIVEN_STRATEGY (the default fake strategy _live_campaign
    # publishes) has no test hypothesis to evaluate.
    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert evaluations == []


@pytest.mark.asyncio
async def test_pause_expired_campaigns_auto_evaluates_a_test_plan_it_pauses(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Auto-pausing a TEST_PLAN once its duration has elapsed also
    records its verdict right away, stopReason TEST_DURATION_ELAPSED."""
    monkeypatch.setattr(
        optimizer_module,
        "evaluate_test_plan",
        AsyncMock(return_value=_VALID_TEST_EVALUATION),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    await _seed_metric(campaign_id, fetched_at=datetime.now(UTC), spend=500.0)
    await _set_end_date(campaign_id, datetime.now(UTC) - timedelta(days=1))

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"

    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert len(evaluations) == 1
    assert evaluations[0]["stopReason"] == "TEST_DURATION_ELAPSED"


@pytest.mark.asyncio
async def test_pause_expired_campaigns_skips_evaluation_without_any_metrics(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A TEST_PLAN paused before metric collection ever ran has nothing
    to evaluate yet — the auto-pause still succeeds."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    await _set_end_date(campaign_id, datetime.now(UTC) - timedelta(days=1))

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert evaluations == []


@pytest.mark.asyncio
async def test_auto_evaluation_failure_after_pause_is_logged_not_raised(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An LLM failure during the auto-evaluation half doesn't undo the
    pause or crash the job — the campaign stays safely paused, and a
    human can still evaluate manually later."""
    monkeypatch.setattr(
        optimizer_module,
        "evaluate_test_plan",
        AsyncMock(side_effect=optimizer_module.OptimizerError("boom")),
    )
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    await _seed_metric(campaign_id, fetched_at=datetime.now(UTC), spend=500.0)
    await _set_end_date(campaign_id, datetime.now(UTC) - timedelta(days=1))

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "PAUSED"
    evaluations = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/test-evaluation"
    ).json()
    assert evaluations == []


@pytest.mark.asyncio
async def test_pause_expired_campaigns_leaves_a_future_end_date_live(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A live campaign whose endDate hasn't arrived yet is untouched."""
    business_id, campaign_id = _live_campaign(client)
    await _set_end_date(campaign_id, datetime.now(UTC) + timedelta(days=1))

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    mock_services["pause_ad_set"].assert_not_awaited()


def test_pause_expired_campaigns_leaves_a_campaign_with_no_end_date_live(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign with no endDate at all (no event venue, DATA_DRIVEN_STRATEGY)
    runs indefinitely — never touched by this job."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_campaign(client, business_id)

    _run(client, optimization_jobs.pause_expired_campaigns)

    campaign = _campaign_status(client, business_id, campaign_id)
    assert campaign["status"] == "LIVE"
    mock_services["pause_ad_set"].assert_not_awaited()


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
async def test_evaluate_skips_test_plan_campaigns(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A TEST_PLAN campaign is evaluated by generate_and_store_test_evaluation
    instead — the general recommender assumes one AdSet per campaign, which
    doesn't hold once a TEST_PLAN's two audience variants are both published
    (Phase C), so it must never fire a recommendation for one even when the
    gate would otherwise pass."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
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
    generate_recommendation = AsyncMock(return_value=_fake_result())
    monkeypatch.setattr(
        optimizer_module, "generate_recommendation", generate_recommendation
    )

    _run(client, optimization_jobs.evaluate_all_live_campaigns)

    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    recs = await seeder.optimizationrecommendation.find_many(
        where={"campaignId": campaign_id}
    )
    await seeder.disconnect()

    generate_recommendation.assert_not_awaited()
    assert recs == []
    # Skipped before the checkpoint update, unlike the "insufficient data"
    # WAIT path — a TEST_PLAN campaign is never this job's business at all.
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


# --- generate_and_store_test_evaluation ("Phase B") -------------------------

_VALID_TEST_EVALUATION = GeneratedTestEvaluation(
    key_findings=["CTR is within the typical range for this vertical."],
    recommended_action="continue_testing",
    reasoning="Not enough conversion volume yet to read economic indicators.",
)


@pytest.mark.asyncio
async def test_generate_and_store_test_evaluation_insufficient_data(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Low spend and little time elapsed stores an INSUFFICIENT_DATA
    evaluation without ever calling the LLM."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    await _seed_metric(campaign_id, fetched_at=datetime.now(UTC), spend=1.0)

    evaluate = AsyncMock(return_value=_VALID_TEST_EVALUATION)
    monkeypatch.setattr(optimizer_module, "evaluate_test_plan", evaluate)

    campaign = await _fetch_campaign(campaign_id)
    result = _run(
        client,
        optimization_jobs.generate_and_store_test_evaluation,
        campaign,
        _FAKE_TEST_PLAN,
    )

    assert result.status == "INSUFFICIENT_DATA"
    assert result.hypothesisResult == "INCONCLUSIVE"
    assert result.winningVariant is None
    assert result.recommendedAction == "continue_testing"
    assert result.stopReason == "MANUAL"
    evaluate.assert_not_awaited()


@pytest.mark.asyncio
async def test_generate_and_store_test_evaluation_sufficient_data(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Enough of the test's budget spent triggers a real LLM evaluation,
    stored as SUFFICIENT_DATA."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    await _seed_metric(campaign_id, fetched_at=datetime.now(UTC), spend=500.0)

    evaluate = AsyncMock(return_value=_VALID_TEST_EVALUATION)
    monkeypatch.setattr(optimizer_module, "evaluate_test_plan", evaluate)

    campaign = await _fetch_campaign(campaign_id)
    result = _run(
        client,
        optimization_jobs.generate_and_store_test_evaluation,
        campaign,
        _FAKE_TEST_PLAN,
    )

    assert result.status == "SUFFICIENT_DATA"
    assert result.confidence == "LOW"
    assert result.recommendedAction == "continue_testing"
    assert result.hypothesisResult == "INCONCLUSIVE"
    assert result.winningVariant is None
    assert result.stopReason == "MANUAL"
    evaluate.assert_awaited_once()


@pytest.mark.asyncio
async def test_generate_and_store_test_evaluation_real_two_variant_comparison(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Once both real AdSets have their own per-variant Metric data with
    enough conversion volume, the backend computes a real winningVariant/
    hypothesisResult — overriding whatever recommendedAction the LLM
    returned with prefer_hypothesis, since the hypothesis-driven variant's
    real CAC is lower here."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    ad_sets_by_variant = await _fetch_ad_sets_by_variant(campaign_id)
    baseline_ad_set_id = ad_sets_by_variant["broad_baseline"]
    hypothesis_ad_set_id = ad_sets_by_variant["hypothesis_audience"]

    now = datetime.now(UTC)
    # $500/variant fair share (daily_budget=50 * duration_days=10) -> 50%
    # spend clears the per-variant gate on both sides.
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=baseline_ad_set_id,
        spend=250.0,
        conversions=10,
        cac=50.0,
    )
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=hypothesis_ad_set_id,
        spend=250.0,
        conversions=10,
        cac=30.0,
    )

    evaluate = AsyncMock(return_value=_VALID_TEST_EVALUATION)
    monkeypatch.setattr(optimizer_module, "evaluate_test_plan", evaluate)

    campaign = await _fetch_campaign(campaign_id)
    result = _run(
        client,
        optimization_jobs.generate_and_store_test_evaluation,
        campaign,
        _FAKE_TEST_PLAN,
    )

    assert result.status == "SUFFICIENT_DATA"
    assert result.winningVariant == "hypothesis_audience"
    assert result.hypothesisResult == "SUPPORTED"
    assert result.recommendedAction == "prefer_hypothesis"
    # 10 conversions and $250 spent each — clears both the confident-
    # conversion floor and 2x the (benchmark-fallback) $55 target CAC.
    assert result.confidence == "CONFIDENT"
    evaluate.assert_awaited_once()
    _, kwargs = evaluate.call_args
    assert kwargs["hypothesis_metric"] is not None


@pytest.mark.asyncio
async def test_generate_and_store_test_evaluation_prefers_the_broad_baseline(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When the broad baseline's real CAC is lower, the hypothesis is
    rejected and recommendedAction becomes prefer_broad."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    ad_sets_by_variant = await _fetch_ad_sets_by_variant(campaign_id)

    now = datetime.now(UTC)
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=ad_sets_by_variant["broad_baseline"],
        spend=250.0,
        conversions=10,
        cac=30.0,
    )
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=ad_sets_by_variant["hypothesis_audience"],
        spend=250.0,
        conversions=10,
        cac=50.0,
    )

    evaluate = AsyncMock(return_value=_VALID_TEST_EVALUATION)
    monkeypatch.setattr(optimizer_module, "evaluate_test_plan", evaluate)

    campaign = await _fetch_campaign(campaign_id)
    result = _run(
        client,
        optimization_jobs.generate_and_store_test_evaluation,
        campaign,
        _FAKE_TEST_PLAN,
    )

    assert result.winningVariant == "broad_baseline"
    assert result.hypothesisResult == "REJECTED"
    assert result.recommendedAction == "prefer_broad"
    assert result.confidence == "CONFIDENT"


@pytest.mark.asyncio
async def test_generate_and_store_test_evaluation_insufficient_with_lopsided_variants(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two real AdSets exist, but only one has meaningful spend yet — not
    a real comparison, so this stays INSUFFICIENT_DATA without calling
    the LLM, even though a naive combined-total read might look ready."""
    _signed_up_client(client)
    business_id = _create_business(client)
    _connect_meta(client, business_id)
    campaign_id = _publish_test_plan_campaign(client, business_id, monkeypatch)
    ad_sets_by_variant = await _fetch_ad_sets_by_variant(campaign_id)

    now = datetime.now(UTC)
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=ad_sets_by_variant["broad_baseline"],
        spend=400.0,
        conversions=8,
    )
    await _seed_metric(
        campaign_id,
        fetched_at=now,
        ad_set_id=ad_sets_by_variant["hypothesis_audience"],
        spend=5.0,
        conversions=0,
    )

    evaluate = AsyncMock(return_value=_VALID_TEST_EVALUATION)
    monkeypatch.setattr(optimizer_module, "evaluate_test_plan", evaluate)

    campaign = await _fetch_campaign(campaign_id)
    result = _run(
        client,
        optimization_jobs.generate_and_store_test_evaluation,
        campaign,
        _FAKE_TEST_PLAN,
    )

    assert result.status == "INSUFFICIENT_DATA"
    evaluate.assert_not_awaited()


async def _fetch_campaign(campaign_id: str) -> object:
    """Fetch a real Campaign row by id via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.disconnect()
    assert campaign is not None
    return campaign
