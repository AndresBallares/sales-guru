"""Tests for the campaign publish endpoint (PRD.md build step 8).

Strategy/creative generation and the Meta OAuth connect flow are mocked
here (same conventions as their own test files) so a full "ready to
publish" campaign can be built through the real endpoints. Only the
individual Graph API object-creation calls (app/services/meta.py's
create_meta_*) are mocked for publish itself — the orchestration
(app/services/publish.py) and its DB writes run for real against the test
database, exercised through the real endpoint via TestClient.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module

# app.api.strategy/creative import generate_strategy/generate_creatives
# directly, so those API modules (not the underlying service modules) are
# what need patching — mirrors test_strategy.py / test_creative.py exactly.
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    DataDrivenStrategyContent,
    GeneratedTestPlanFields,
    NormalizedMetrics,
    TargetAudience,
    TargetLocation,
    TestPlanContent,
    UnitEconomicsFields,
)
from app.services import geo as geo_module
from app.services import meta as meta_service_module
from app.services import strategist as strategist_module
from app.services.benchmarks import JEWELRY_META_BENCHMARKS
from app.services.event_venues import EVENT_VENUES
from app.services.meta import ResolvedGeoLocation
from app.services.publish import requires_pixel
from fastapi.testclient import TestClient
from prisma import Prisma

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


def _fake_test_plan() -> TestPlanContent:
    """Build a real TestPlanContent from the strategist's own assembly
    helpers, not a hand-rolled duplicate shape — same pattern already
    used in test_optimization.py/test_optimization_jobs.py."""
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


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def _create_business(
    client: TestClient, name: str = "Acme Jewelry", website: str | None = None
) -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    payload = {"name": name, **({"website": website} if website else {})}
    response = client.post("/businesses", json=payload)
    id_: str = response.json()["id"]
    return id_


def _create_product(client: TestClient, business_id: str, url: str) -> str:
    """Create a product with a destination URL, return its id."""
    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Custom emerald rings", "url": url},
    )
    id_: str = response.json()["id"]
    return id_


def _create_campaign(
    client: TestClient, business_id: str, product_id: str | None = None
) -> str:
    """Create a campaign under a business, return its id."""
    payload: dict[str, str] = {"objective": "SALES"}
    if product_id:
        payload["productId"] = product_id
    response = client.post(f"/businesses/{business_id}/campaigns", json=payload)
    id_: str = response.json()["id"]
    return id_


def _connect_meta(
    client: TestClient, business_id: str, *, with_pixel: bool = True
) -> None:
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
    # itself. with_pixel=False is for the tests that are about exactly that.
    if with_pixel:
        client.post(
            f"/businesses/{business_id}/meta/pixel",
            json={"pixelId": "pixel_1"},
        )


def _ready_campaign(
    client: TestClient,
    *,
    with_destination_url: bool = True,
    with_pixel: bool = True,
    objective: str = "SALES",
    event_venue_key: str | None = None,
    monkeypatch: pytest.MonkeyPatch | None = None,
    test_plan: bool = False,
) -> tuple[str, str]:
    """Build a campaign all the way to APPROVED, Meta connected, ready to publish.

    test_plan=True overrides the mocked strategy to a TEST_PLAN
    (_FAKE_TEST_PLAN) instead of the default DataDrivenStrategyContent —
    requires monkeypatch to be given.

    Returns:
        (business_id, campaign_id).
    """
    if test_plan:
        assert monkeypatch is not None
        monkeypatch.setattr(
            strategy_module,
            "generate_strategy",
            AsyncMock(return_value=_FAKE_TEST_PLAN),
        )
    _signed_up_client(client)
    business_id = _create_business(
        client, website="https://acme.example" if with_destination_url else None
    )
    payload: dict[str, str] = {"objective": objective}
    if event_venue_key is not None:
        payload["eventVenueKey"] = event_venue_key
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns", json=payload
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
    _connect_meta(client, business_id, with_pixel=with_pixel)
    return business_id, campaign_id


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

    create_campaign = AsyncMock(return_value="meta_campaign_1")
    monkeypatch.setattr(meta_service_module, "create_meta_campaign", create_campaign)
    create_ad_set = AsyncMock(return_value="meta_adset_1")
    monkeypatch.setattr(meta_service_module, "create_meta_ad_set", create_ad_set)
    create_ad_creative = AsyncMock(return_value="meta_creative_1")
    monkeypatch.setattr(
        meta_service_module, "create_meta_ad_creative", create_ad_creative
    )
    create_ad = AsyncMock(return_value="meta_ad_1")
    monkeypatch.setattr(meta_service_module, "create_meta_ad", create_ad)
    pause_ad_set = AsyncMock(return_value=None)
    monkeypatch.setattr(meta_service_module, "pause_meta_ad_set", pause_ad_set)

    return {
        "create_campaign": create_campaign,
        "create_ad_set": create_ad_set,
        "create_ad_creative": create_ad_creative,
        "create_ad": create_ad,
        "pause_ad_set": pause_ad_set,
    }


def test_requires_pixel_is_true_for_sales() -> None:
    """SALES maps to OFFSITE_CONVERSIONS, a confirmed conversion-tracking goal."""
    assert requires_pixel("SALES") is True


def test_requires_pixel_is_false_for_non_conversion_objectives() -> None:
    """LEADS/TRAFFIC/MESSAGES/AWARENESS don't map to OFFSITE_CONVERSIONS."""
    for objective in ("LEADS", "TRAFFIC", "MESSAGES", "AWARENESS"):
        assert requires_pixel(objective) is False


def test_publish_requires_a_session(client: TestClient) -> None:
    """Publishing with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/publish")

    assert response.status_code == 401


def test_publish_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Publishing a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/publish"
    )

    assert response.status_code == 404


def test_publish_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't publish a campaign they don't own."""
    business_id, campaign_id = _ready_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 404


def test_publish_400s_before_approval(client: TestClient) -> None:
    """A freshly created (DRAFT) campaign can't be published yet."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "approve" in response.json()["detail"].lower()


def test_publish_400s_without_meta_connected(client: TestClient) -> None:
    """An approved campaign with no Meta connection at all can't publish."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
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

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "connect meta ads" in response.json()["detail"].lower()


def test_publish_400s_without_ad_account_and_page_selected(client: TestClient) -> None:
    """A Meta connection still pending (no ad account/Page chosen) can't publish."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
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
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "connect meta ads" in response.json()["detail"].lower()


def test_publish_400s_without_a_destination_url(client: TestClient) -> None:
    """No product URL and no business website means nowhere for the ad to link."""
    business_id, campaign_id = _ready_campaign(client, with_destination_url=False)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "destination" in response.json()["detail"].lower()


def test_publish_400s_without_a_pixel_for_a_conversion_objective(
    client: TestClient,
) -> None:
    """SALES maps to OFFSITE_CONVERSIONS, which needs a configured Pixel."""
    business_id, campaign_id = _ready_campaign(client, with_pixel=False)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "pixel" in response.json()["detail"].lower()


def test_publish_succeeds_without_a_pixel_for_a_non_conversion_objective(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """TRAFFIC maps to LINK_CLICKS, which doesn't need a Pixel — no check blocks it."""
    business_id, campaign_id = _ready_campaign(
        client, with_pixel=False, objective="TRAFFIC"
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["pixel_id"] is None


@pytest.mark.asyncio
async def test_publish_400s_without_a_selected_creative(client: TestClient) -> None:
    """Defense in depth: APPROVED with no SELECTED creative (shouldn't happen
    via normal flow — selecting is required to reach PENDING_APPROVAL, and
    regenerating creatives always resets status away from APPROVED) still
    fails closed rather than crashing.

    Uses a fresh Prisma() connection to desync the two tables directly,
    same reasoning as test_meta.py's no-organization test.
    """
    business_id, campaign_id = _ready_campaign(client)

    seeder = Prisma()
    await seeder.connect()
    await seeder.creative.update_many(
        where={"campaignId": campaign_id}, data={"status": "REJECTED"}
    )
    await seeder.disconnect()

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "select an ad creative" in response.json()["detail"].lower()


def test_publish_succeeds_and_marks_the_campaign_live(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A full success creates the campaign live on Meta and marks it LIVE."""
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "LIVE"
    assert body["metaCampaignId"] == "meta_campaign_1"
    mock_services["create_campaign"].assert_awaited_once()
    mock_services["create_ad_set"].assert_awaited_once()
    mock_services["create_ad_creative"].assert_awaited_once()
    mock_services["create_ad"].assert_awaited_once()
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["pixel_id"] == "pixel_1"

    creatives = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    selected = next(c for c in creatives if c["status"] == "SELECTED")
    assert selected["adId"] is not None


@pytest.mark.asyncio
async def test_publish_creates_two_real_adsets_for_a_test_plan_campaign(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A TEST_PLAN campaign publishes both audience variants as real,
    independent AdSets/Ads on Meta ("Phase C," confirmed 2026-09-02),
    reusing one ad creative object across both, with the per-variant
    budget (not split) and the right advantage_audience/interests split
    between the broad baseline and the hypothesis-driven variant."""
    mock_services["create_ad_set"].side_effect = ["meta_adset_a", "meta_adset_b"]
    mock_services["create_ad"].side_effect = ["meta_ad_a", "meta_ad_b"]
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"
    mock_services["create_campaign"].assert_awaited_once()
    mock_services["create_ad_creative"].assert_awaited_once()  # one creative, reused
    assert mock_services["create_ad_set"].await_count == 2
    assert mock_services["create_ad"].await_count == 2

    baseline_kwargs = mock_services["create_ad_set"].call_args_list[0].kwargs
    hypothesis_kwargs = mock_services["create_ad_set"].call_args_list[1].kwargs
    assert baseline_kwargs["daily_budget_cents"] == 5000  # $50/day, per variant
    assert hypothesis_kwargs["daily_budget_cents"] == 5000  # same rate, not split
    assert baseline_kwargs["advantage_audience"] == 1
    assert baseline_kwargs["interests"] == []
    assert hypothesis_kwargs["advantage_audience"] == 0
    assert hypothesis_kwargs["interests"] == [
        {"id": "6003266225248", "name": "Jewelry"}
    ]

    used_ad_set_ids = {
        c.kwargs["meta_ad_set_id"] for c in mock_services["create_ad"].call_args_list
    }
    assert used_ad_set_ids == {"meta_adset_a", "meta_adset_b"}

    creatives = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    selected = [c for c in creatives if c["status"] == "SELECTED"]
    assert len(selected) == 2  # the original row plus one duplicate
    assert all(c["adId"] is not None for c in selected)
    assert len({c["adId"] for c in selected}) == 2  # two distinct Ads

    seeder = Prisma()
    await seeder.connect()
    db_creatives = await seeder.creative.find_many(
        where={"campaignId": campaign_id, "status": "SELECTED"}
    )
    await seeder.disconnect()
    assert {c.metaCreativeId for c in db_creatives} == {"meta_creative_1"}


def test_publish_targets_the_curated_venue_for_an_event_campaign(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """An event-venue campaign's AdSet is created with a custom_location
    targeting the venue's coordinates/radius, instead of the default
    broad-US geo (PRD.md build step 11)."""
    business_id, campaign_id = _ready_campaign(client, event_venue_key="jck_las_vegas")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _, kwargs = mock_services["create_ad_set"].call_args
    custom_location = kwargs["custom_location"]
    assert custom_location is not None
    assert custom_location.lat == EVENT_VENUES["jck_las_vegas"].lat
    assert custom_location.lng == EVENT_VENUES["jck_las_vegas"].lng
    assert (
        custom_location.radius_miles
        == EVENT_VENUES["jck_las_vegas"].recommended_radius_miles
    )


def test_publish_uses_broad_geo_for_a_non_event_campaign(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign with no eventVenueKey still publishes with custom_location
    unset, unchanged from before this feature (PRD.md build step 11)."""
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["custom_location"] is None


def test_publish_sends_no_end_time_for_a_data_driven_strategy(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A DATA_DRIVEN_STRATEGY campaign with no event venue has no duration
    concept — it publishes with no end_time, running indefinitely."""
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["endDate"] is None
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["end_time"] is None


def test_publish_uses_the_jewelry_cac_benchmark_as_the_default_bid_cap(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """No product unit economics (the default fake strategy has none) falls
    back to the jewelry CAC benchmark median as the COST_CAP bid_amount —
    never left uncapped."""
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["target_cac_cents"] == round(JEWELRY_META_BENCHMARKS.cac.median * 100)


def test_publish_uses_the_products_own_target_cac_when_available(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A campaign with real product unit economics uses its own target_cac
    as the COST_CAP bid_amount, not the industry benchmark — the two are
    never blended (app/services/strategist.py's _build_success_criteria)."""
    strategy_with_economics = _FAKE_STRATEGY.model_copy(
        update={
            "unit_economics": UnitEconomicsFields(
                gross_profit=200.0,
                breakeven_cac=200.0,
                target_cac=66.0,
                breakeven_roas=2.5,
            )
        }
    )
    monkeypatch.setattr(
        strategy_module,
        "generate_strategy",
        AsyncMock(return_value=strategy_with_economics),
    )
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["target_cac_cents"] == 6600


def test_publish_computes_end_time_from_duration_days_for_a_test_plan(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A TEST_PLAN with no event venue gets an end_time computed from its
    own duration_days, starting from publish time — and that computed
    date is persisted on the campaign, not just sent to Meta."""
    mock_services["create_ad_set"].side_effect = ["meta_adset_a", "meta_adset_b"]
    mock_services["create_ad"].side_effect = ["meta_ad_a", "meta_ad_b"]
    before_publish = datetime.now(UTC)
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    end_date = response.json()["endDate"]
    assert end_date is not None
    parsed_end_date = datetime.fromisoformat(end_date)
    assert parsed_end_date > before_publish + timedelta(days=9)
    assert parsed_end_date < before_publish + timedelta(days=11)

    # SQLite storage rounds sub-millisecond precision, so the round-tripped
    # endDate and the raw end_time kwarg sent to Meta differ by a few
    # microseconds — a real, expected artifact of the DB round trip, not a
    # bug; compare within a generous tolerance instead of exact equality.
    for call in mock_services["create_ad_set"].call_args_list:
        assert abs(call.kwargs["end_time"] - parsed_end_date) < timedelta(seconds=1)


def test_publish_uses_the_campaigns_existing_end_date_for_an_event_venue_test_plan(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An event-venue TEST_PLAN already has a real endDate from its venue
    window (PRD.md build step 11) — publish uses that directly instead of
    computing a new one from duration_days."""
    mock_services["create_ad_set"].side_effect = ["meta_adset_a", "meta_adset_b"]
    mock_services["create_ad"].side_effect = ["meta_ad_a", "meta_ad_b"]
    business_id, campaign_id = _ready_campaign(
        client,
        event_venue_key="jck_las_vegas",
        monkeypatch=monkeypatch,
        test_plan=True,
    )
    existing_end_date = client.get(f"/businesses/{business_id}/campaigns").json()[0][
        "endDate"
    ]
    assert existing_end_date is not None

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["endDate"] == existing_end_date
    parsed_end_date = datetime.fromisoformat(existing_end_date)
    for call in mock_services["create_ad_set"].call_args_list:
        assert call.kwargs["end_time"] == parsed_end_date


def test_publish_resolves_real_locations_when_the_audience_has_any(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A TargetAudience with real structured locations gets them resolved
    against Meta's live Geo Search (PRD.md build step 5, geo-taxonomy
    resolution) and passed through to create_meta_ad_set."""
    strategy_with_location = DataDrivenStrategyContent(
        objective="SALES",
        target_audience=TargetAudience(
            age_min=30,
            age_max=55,
            location=[TargetLocation(city="New York", region="New York")],
        ),
        offer="Custom emerald rings",
        positioning="Premium and personal",
        creative_angles=["Craftsmanship", "Luxury"],
        copy_strategy="Lead with the story behind each piece",
        budget_recommendation=BudgetRecommendation(
            daily=25, rationale="Small test spend"
        ),
        key_learnings=["Craftsmanship angle performed best"],
        recommended_adjustments=["Drop the price angle"],
        scaling_trigger="Increase budget once CAC stays under target",
    )
    monkeypatch.setattr(
        strategy_module,
        "generate_strategy",
        AsyncMock(return_value=strategy_with_location),
    )
    resolve = AsyncMock(return_value=ResolvedGeoLocation(key="2490299", type="city"))
    monkeypatch.setattr(geo_module, "resolve_target_location", resolve)
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    resolve.assert_awaited_once_with(
        access_token="long-token", city="New York", region="New York"
    )
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["resolved_locations"] == [
        ResolvedGeoLocation(key="2490299", type="city")
    ]


def test_publish_skips_location_resolution_for_an_event_venue_campaign(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An event venue's radius overrides audience locations entirely — no
    geo resolution call is made at all, matching _resolve_custom_location's
    "applies uniformly, not per-variant" precedence."""
    strategy_with_location = DataDrivenStrategyContent(
        objective="SALES",
        target_audience=TargetAudience(
            age_min=30,
            age_max=55,
            location=[TargetLocation(city="New York")],
        ),
        offer="Custom emerald rings",
        positioning="Premium and personal",
        creative_angles=["Craftsmanship", "Luxury"],
        copy_strategy="Lead with the story behind each piece",
        budget_recommendation=BudgetRecommendation(
            daily=25, rationale="Small test spend"
        ),
        key_learnings=["Craftsmanship angle performed best"],
        recommended_adjustments=["Drop the price angle"],
        scaling_trigger="Increase budget once CAC stays under target",
    )
    monkeypatch.setattr(
        strategy_module,
        "generate_strategy",
        AsyncMock(return_value=strategy_with_location),
    )
    resolve = AsyncMock()
    monkeypatch.setattr(geo_module, "resolve_target_location", resolve)
    business_id, campaign_id = _ready_campaign(client, event_venue_key="jck_las_vegas")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    resolve.assert_not_awaited()
    _, kwargs = mock_services["create_ad_set"].call_args
    assert kwargs["resolved_locations"] == []


def test_publish_uses_the_product_url_when_available(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign with a product uses the product's URL, not the business's."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id = _create_product(client, business_id, url="https://acme.example/rings")
    campaign_id = _create_campaign(client, business_id, product_id=product_id)
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

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _args, kwargs = mock_services["create_ad_creative"].call_args
    assert kwargs["link"] == "https://acme.example/rings"


def test_publish_surfaces_meta_failures_as_500_and_marks_failed(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A Meta API failure becomes a clean 500 and moves the campaign to FAILED."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_campaign"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "FAILED"


def test_publish_can_be_retried_after_a_failure(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign that previously FAILED can be published again."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_campaign"].side_effect = MetaConnectionError("boom")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    mock_services["create_campaign"].side_effect = None
    mock_services["create_campaign"].return_value = "meta_campaign_1"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"


def test_publish_400s_once_already_live(client: TestClient) -> None:
    """A campaign that's already LIVE can't be published again."""
    business_id, campaign_id = _ready_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400


def test_pause_requires_a_session(client: TestClient) -> None:
    """Pausing with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/pause")

    assert response.status_code == 401


def test_pause_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Pausing a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(f"/businesses/{business_id}/campaigns/does-not-exist/pause")

    assert response.status_code == 404


def test_pause_400s_for_a_campaign_thats_not_live(client: TestClient) -> None:
    """A DRAFT campaign (never published) can't be paused."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    assert response.status_code == 400
    assert "live" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_pause_succeeds_and_pauses_every_adset_in_a_test_plan_campaign(
    client: TestClient,
    mock_services: dict[str, AsyncMock],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One pause call stops every AdSet in a two-variant TEST_PLAN campaign,
    not just one — distinct from the Optimizer's single-Ad PAUSE_AD — and
    the local mirror (AdSet/Ad rows) reflects it too, not just Meta."""
    mock_services["create_ad_set"].side_effect = ["meta_adset_a", "meta_adset_b"]
    mock_services["create_ad"].side_effect = ["meta_ad_a", "meta_ad_b"]
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "PAUSED"
    assert body["pausedReason"] == "Manually paused"
    assert mock_services["pause_ad_set"].await_count == 2
    paused_ids = {
        c.kwargs["meta_ad_set_id"] for c in mock_services["pause_ad_set"].call_args_list
    }
    assert paused_ids == {"meta_adset_a", "meta_adset_b"}

    seeder = Prisma()
    await seeder.connect()
    ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
    ads = await seeder.ad.find_many(where={"adSetId": {"in": [a.id for a in ad_sets]}})
    await seeder.disconnect()
    assert len(ad_sets) == 2
    assert all(a.status == "PAUSED" for a in ad_sets)
    assert len(ads) == 2
    assert all(a.status == "PAUSED" for a in ads)


def test_pause_500s_when_the_meta_call_fails(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A Graph API failure surfaces as 500, not a silent no-op."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _ready_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    mock_services["pause_ad_set"].side_effect = MetaConnectionError("boom")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    assert response.status_code == 500


def test_pause_400s_if_meta_was_disconnected_after_publishing(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign can be LIVE with its Meta connection later removed
    (DELETE .../meta) — pausing then 400s instead of crashing."""
    business_id, campaign_id = _ready_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    client.delete(f"/businesses/{business_id}/meta")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    assert response.status_code == 400
    assert "meta connection" in response.json()["detail"].lower()


def test_pause_400s_once_already_paused(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign that's already PAUSED can't be paused again."""
    business_id, campaign_id = _ready_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/pause")

    assert response.status_code == 400
