"""Tests for the campaign dashboard endpoints (app/api/dashboard.py).

Rows are seeded straight into the database (a fresh connection, as in
test_optimization_jobs.py) so each test controls exactly which snapshots exist,
then the real endpoints are driven through the TestClient.
"""

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.core.config import get_settings
from app.schemas.strategy import (
    AudienceConstraints,
    BudgetRecommendation,
    CreativePersona,
    CreativeTestPlanContent,
    DataDrivenStrategyContent,
    NormalizedMetrics,
    TargetAudience,
    UnitEconomicsFields,
)
from app.services import strategist as strategist_module
from fastapi.testclient import TestClient
from prisma import Prisma

NOW = datetime.now(UTC)


def _run[T](client: TestClient, func: Callable[..., Awaitable[T]], *args: Any) -> T:
    """Run an async seeding helper on the TestClient's portal loop."""
    assert client.portal is not None
    return client.portal.call(func, *args)


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def _create_business(client: TestClient, name: str = "Acme Jewelry") -> str:
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


def _data_driven(unit_economics: UnitEconomicsFields | None = None) -> str:
    return DataDrivenStrategyContent(
        objective="SALES",
        target_audience=TargetAudience(age_min=30, age_max=55),
        offer="Offer",
        positioning="Positioning",
        creative_angles=["a", "b"],
        copy_strategy="Copy",
        budget_recommendation=BudgetRecommendation(daily=25, rationale="Test"),
        key_learnings=["x"],
        recommended_adjustments=["y"],
        scaling_trigger="z",
        unit_economics=unit_economics,
    ).model_dump_json(by_alias=True)


def _creative_plan(
    daily_budget: float = 50.0, target_cpatc: float | None = None
) -> str:
    benchmark_context = strategist_module._build_benchmark_context()
    return CreativeTestPlanContent(
        objective="SALES",
        audience_constraints=AudienceConstraints(),
        creative_persona=CreativePersona(name="Gift buyers", description="Women"),
        hypotheses=[strategist_module._build_creative_hypothesis("A wins.")],
        offer="Offer",
        positioning="Positioning",
        creative_angles=["a", "b", "c"],
        copy_strategy="Copy",
        daily_budget=daily_budget,
        duration_days=10,
        total_budget=daily_budget * 10,
        optimization_event="PURCHASE",
        target_cost_per_add_to_cart=target_cpatc,
        success_criteria=strategist_module._build_creative_success_criteria(
            benchmark_context, None, target_cpatc
        ),
        baseline_metrics=NormalizedMetrics(),
        benchmark_context=benchmark_context,
    ).model_dump_json(by_alias=True)


async def _seed_campaign(
    business_id: str,
    *,
    name: str = "Test campaign",
    status: str = "LIVE",
    published: bool = True,
    strategy: str | None = None,
    pixel_warning: str | None = None,
    ad_sets: int = 1,
    paused_at: datetime | None = None,
    paused_reason: str | None = None,
) -> str:
    seeder = Prisma()
    await seeder.connect()
    try:
        campaign = await seeder.campaign.create(
            data={
                "businessId": business_id,
                "name": name,
                "objective": "SALES",
                "status": status,
                "metaCampaignId": "meta_campaign" if published else None,
                "pixelWarning": pixel_warning,
                "pausedAt": paused_at,
                "pausedReason": paused_reason,
            }
        )
        if strategy is not None:
            await seeder.strategy.create(
                data={"campaignId": campaign.id, "content": strategy}
            )
        for n in range(ad_sets):
            await seeder.adset.create(
                data={
                    "campaignId": campaign.id,
                    "name": f"Ad set {n}",
                    "budget": 50.0,
                    "optimizationGoal": "OFFSITE_CONVERSIONS",
                    "status": "LIVE",
                    "metaAdSetId": f"meta_ad_set_{n}",
                }
            )
        return campaign.id
    finally:
        await seeder.disconnect()


async def _seed_metric(
    campaign_id: str,
    *,
    hours_ago: float = 0.0,
    ad_id: str | None = None,
    ad_set_id: str | None = None,
    impressions: int = 1000,
    spend: float = 10.0,
    link_clicks: int | None = None,
    landing_page_views: int | None = None,
    add_to_cart: int | None = None,
    initiated_checkout: int | None = None,
    purchases: int | None = None,
    purchase_value: float | None = None,
) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metric.create(
            data={
                "campaignId": campaign_id,
                "adSetId": ad_set_id,
                "adId": ad_id,
                "impressions": impressions,
                "clicks": 0,
                "spend": spend,
                "conversions": 0,
                "linkClicks": link_clicks,
                "landingPageViews": landing_page_views,
                "addToCart": add_to_cart,
                "initiatedCheckout": initiated_checkout,
                "purchases": purchases,
                "purchaseValue": purchase_value,
                "fetchedAt": NOW - timedelta(hours=hours_ago),
            }
        )
    finally:
        await seeder.disconnect()


async def _seed_ads(campaign_id: str, names: list[str]) -> list[tuple[str, str]]:
    """Ads under the campaign's first ad set: (local id, ad set id)."""
    seeder = Prisma()
    await seeder.connect()
    try:
        ad_set = await seeder.adset.find_first(where={"campaignId": campaign_id})
        assert ad_set is not None
        out = []
        for name in names:
            ad = await seeder.ad.create(
                data={
                    "adSetId": ad_set.id,
                    "name": name,
                    "status": "LIVE",
                    "metaAdId": f"meta_{name}",
                }
            )
            out.append((ad.id, ad_set.id))
        return out
    finally:
        await seeder.disconnect()


async def _ad_set_ids(campaign_id: str) -> list[str]:
    seeder = Prisma()
    await seeder.connect()
    try:
        rows = await seeder.adset.find_many(
            where={"campaignId": campaign_id}, order={"createdAt": "asc"}
        )
        return [r.id for r in rows]
    finally:
        await seeder.disconnect()


async def _set_ad_status(ad_id: str, status: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.ad.update(where={"id": ad_id}, data={"status": status})
    finally:
        await seeder.disconnect()


async def _seed_recommendation(
    campaign_id: str,
    *,
    action_type: str = "PAUSE_AD",
    status: str = "PENDING",
    target_ad_id: str | None = None,
    reasoning: str = "Spent well above target with no result.",
) -> str:
    seeder = Prisma()
    await seeder.connect()
    try:
        rec = await seeder.optimizationrecommendation.create(
            data={
                "campaignId": campaign_id,
                "actionType": action_type,
                "targetAdId": target_ad_id,
                "reasoning": reasoning,
                "confidence": 0.8,
                "risk": "LOW",
                "status": status,
            }
        )
        return rec.id
    finally:
        await seeder.disconnect()


async def _metric_count(campaign_id: str) -> int:
    seeder = Prisma()
    await seeder.connect()
    try:
        return await seeder.metric.count(where={"campaignId": campaign_id})
    finally:
        await seeder.disconnect()


def _url(business_id: str, campaign_id: str, query: str = "") -> str:
    return f"/businesses/{business_id}/campaigns/{campaign_id}/dashboard{query}"


def _setup(client: TestClient, **campaign_kwargs: Any) -> tuple[str, str]:
    """Sign up, create a business and seed one campaign under it."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id, **campaign_kwargs))
    return business_id, campaign_id


# --- access ----------------------------------------------------------


def test_dashboard_requires_a_session(client: TestClient) -> None:
    assert client.get("/businesses/x/campaigns/y/dashboard").status_code == 401
    assert client.get("/businesses/x/dashboard").status_code == 401


def test_dashboard_404s_for_another_users_campaign(client: TestClient) -> None:
    _signed_up_client(client, "one@example.com")
    business_id = _create_business(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id))
    client.post("/auth/logout")
    _signed_up_client(client, "two@example.com")

    assert client.get(_url(business_id, campaign_id)).status_code == 404
    assert client.get(f"/businesses/{business_id}/dashboard").status_code == 404


# --- no data yet -----------------------------------------------------


def test_campaign_with_no_snapshots_has_no_tiers(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["hasData"] is False
    assert body["asOf"] is None
    assert body["tier1"] is None
    assert body["tier2"] is None
    assert body["tier3"] is None
    assert body["isSample"] is False
    assert body["proposals"] == []


# --- delivered or not, live or paused ---------------------------------------------


def test_snapshots_with_no_delivery_count_as_no_data(client: TestClient) -> None:
    """A live campaign Meta hasn't delivered yet still gets (all-zero) snapshots:
    that is "no results yet", not $0.00 of results."""
    business_id, campaign_id = _setup(client)
    for hours_ago in (2.0, 1.0, 0.0):
        _run(
            client,
            lambda h=hours_ago: _seed_metric(
                campaign_id, hours_ago=h, impressions=0, spend=0.0
            ),
        )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["hasData"] is False
    assert body["tier1"] is None
    assert body["tier2"] is None
    assert body["asOf"] is None


def test_spend_without_impressions_still_counts_as_delivered(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    _run(client, lambda: _seed_metric(campaign_id, impressions=0, spend=2.5))

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["hasData"] is True
    assert body["tier1"]["spend"]["value"] == 2.5


def test_a_paused_campaign_that_never_ran_has_no_data_and_no_paused_time(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(
        client, status="PAUSED", paused_reason="Published paused"
    )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["status"] == "PAUSED"
    assert body["hasData"] is False
    assert body["pausedAt"] is None
    assert body["pausedReason"] == "Published paused"


def test_a_campaign_paused_after_delivering_keeps_its_last_numbers(
    client: TestClient,
) -> None:
    """Collection only runs for LIVE campaigns, so a paused one keeps whatever
    was stored when it stopped, and says when and why."""
    paused_at = NOW - timedelta(hours=3)
    business_id, campaign_id = _setup(
        client,
        status="PAUSED",
        paused_at=paused_at,
        paused_reason="Manually paused",
    )
    _run(
        client,
        lambda: _seed_metric(
            campaign_id,
            hours_ago=4.0,
            impressions=3000,
            spend=45.0,
            purchases=1,
            purchase_value=90.0,
        ),
    )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["status"] == "PAUSED"
    assert body["hasData"] is True
    assert body["tier1"]["spend"]["value"] == 45.0
    assert body["tier1"]["purchases"]["value"] == 1
    assert body["pausedReason"] == "Manually paused"
    assert abs(datetime.fromisoformat(body["pausedAt"]) - paused_at) < timedelta(
        seconds=1
    )


def test_a_live_campaign_has_no_paused_fields(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["pausedAt"] is None
    assert body["pausedReason"] is None


# --- latest lifetime totals, never summed over time ------------------


def test_totals_are_the_latest_snapshot_not_a_sum_of_the_15_minute_snapshots(
    client: TestClient,
) -> None:
    """Seven snapshots of one campaign at 15-minute spacing, each holding
    Meta's lifetime-to-date total: the dashboard reads the newest ($42), not
    the sum of all seven."""
    business_id, campaign_id = _setup(client)
    lifetime_spend = [6.0, 12.0, 18.0, 24.0, 30.0, 36.0, 42.0]
    for n, spend in enumerate(lifetime_spend):
        _run(
            client,
            lambda n=n, spend=spend: _seed_metric(
                campaign_id,
                hours_ago=(len(lifetime_spend) - 1 - n) * 0.25,
                spend=spend,
                impressions=100 * (n + 1),
                link_clicks=n + 1,
                purchases=n // 2,
                purchase_value=float(n // 2) * 100,
            ),
        )

    body = client.get(_url(business_id, campaign_id)).json()

    assert sum(lifetime_spend) == 168.0  # what summing would have shown
    assert body["tier1"]["spend"]["value"] == 42.0
    assert body["tier1"]["purchases"]["value"] == 3
    assert body["tier1"]["revenue"]["value"] == 300.0
    assert [s["count"] for s in body["tier2"]["funnel"]][:2] == [700, 7]


def test_two_ad_set_campaign_adds_each_ad_sets_latest_row_once(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client, ad_sets=2)
    set_a, set_b = _run(client, lambda: _ad_set_ids(campaign_id))
    history = ((2.0, 5.0, 4.0), (1.0, 12.0, 9.0), (0.0, 30.0, 20.0))
    for hours_ago, spend_a, spend_b in history:
        _run(
            client,
            lambda h=hours_ago, a=spend_a: _seed_metric(
                campaign_id, hours_ago=h, ad_set_id=set_a, spend=a
            ),
        )
        _run(
            client,
            lambda h=hours_ago, b=spend_b: _seed_metric(
                campaign_id, hours_ago=h, ad_set_id=set_b, spend=b
            ),
        )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["tier1"]["spend"]["value"] == 50.0
    assert body["tier1"]["spend"]["plannedTotal"] is None


def test_ad_level_rows_do_not_change_the_campaign_totals(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)
    ads = _run(client, lambda: _seed_ads(campaign_id, ["Ad one", "Ad two"]))
    _run(client, lambda: _seed_metric(campaign_id, spend=30.0))
    for ad_id, ad_set_id in ads:
        _run(
            client,
            lambda a=ad_id, s=ad_set_id: _seed_metric(
                campaign_id, ad_id=a, ad_set_id=s, spend=15.0
            ),
        )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["tier1"]["spend"]["value"] == 30.0


def test_each_ad_row_shows_its_latest_lifetime_numbers(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)
    (ad, ad_set), _other = _run(
        client, lambda: _seed_ads(campaign_id, ["Ad one", "Ad two"])
    )
    _run(client, lambda: _seed_metric(campaign_id, spend=40.0))
    for hours_ago, spend, atc in ((1.0, 5.0, 1), (0.5, 12.0, 3), (0.0, 20.0, 6)):
        _run(
            client,
            lambda h=hours_ago, s=spend, a=atc: _seed_metric(
                campaign_id,
                hours_ago=h,
                ad_id=ad,
                ad_set_id=ad_set,
                spend=s,
                add_to_cart=a,
            ),
        )

    body = client.get(_url(business_id, campaign_id)).json()

    rows = {r["name"]: r for r in body["tier3"]["ads"]}
    assert rows["Ad one"]["spend"] == 20.0
    assert rows["Ad one"]["addToCart"] == 6
    assert rows["Ad one"]["costPerAddToCart"] == pytest.approx(20.0 / 6)


# --- tiers -----------------------------------------------------------


def test_full_dashboard_for_a_creative_test(client: TestClient) -> None:
    business_id, campaign_id = _setup(
        client,
        strategy=_creative_plan(daily_budget=50.0, target_cpatc=12.0),
        pixel_warning="Purchase event may not be firing",
    )
    ads = _run(client, lambda: _seed_ads(campaign_id, ["Ad A", "Ad B", "Ad C"]))
    _run(
        client,
        lambda: _seed_metric(
            campaign_id,
            impressions=12400,
            spend=142.5,
            link_clicks=148,
            landing_page_views=126,
            add_to_cart=14,
            initiated_checkout=6,
            purchases=3,
            purchase_value=420.0,
        ),
    )
    finals = [(52.0, 7, 2), (48.0, 5, 1), (42.5, 2, 0)]
    for (ad_id, ad_set_id), (spend, atc, purchases) in zip(ads, finals, strict=True):
        _run(
            client,
            lambda a=ad_id, s=ad_set_id, sp=spend, t=atc, p=purchases: _seed_metric(
                campaign_id,
                ad_id=a,
                ad_set_id=s,
                impressions=4000,
                spend=sp,
                link_clicks=40,
                add_to_cart=t,
                purchases=p,
            ),
        )
    _run(
        client,
        lambda: _seed_recommendation(campaign_id, target_ad_id=ads[2][0]),
    )

    body = client.get(_url(business_id, campaign_id)).json()

    t1 = body["tier1"]
    assert t1["spend"]["value"] == 142.5
    assert t1["spend"]["plannedTotal"] == 500.0  # $50/day x 1 ad set x 10 days
    assert t1["spend"]["plannedDaily"] == 50.0
    assert t1["spend"]["percentOfPlan"] == pytest.approx(28.5)
    assert t1["purchases"]["value"] == 3
    assert t1["revenue"]["value"] == 420.0
    assert (
        t1["purchases"]["confidence"]["label"]
        == "Based on 3 purchases — too early to judge"
    )
    assert t1["costPerPurchase"]["value"] == pytest.approx(47.5)
    assert t1["costPerPurchase"]["targetSource"] == "industry_benchmark"
    assert t1["costPerPurchase"]["target"] == 55.0
    assert t1["costPerPurchase"]["position"] == "below_target"
    assert t1["roas"]["value"] == pytest.approx(420.0 / 142.5)
    assert t1["roas"]["breakeven"] is None

    t2 = body["tier2"]
    assert t2["linkCtr"]["value"] == pytest.approx(148 / 12400 * 100)
    assert t2["addToCart"]["count"] == 14
    assert t2["addToCart"]["targetCostPer"] == 12.0
    assert t2["checkout"]["count"] == 6
    assert [s["key"] for s in t2["funnel"]] == [
        "impressions",
        "link_clicks",
        "add_to_cart",
        "checkout",
        "purchase",
    ]

    t3 = body["tier3"]
    assert [r["name"] for r in t3["ads"]] == ["Ad A", "Ad B", "Ad C"]
    assert t3["leader"] is None  # the third ad has only 2 add-to-carts
    assert t3["leaderMessage"] == "No clear leader yet"
    assert {r["name"]: r["status"] for r in t3["ads"]}["Ad C"] == "proposed_pause"

    assert body["pixelWarning"] == "Purchase event may not be firing"
    assert [p["targetAdName"] for p in body["proposals"]] == ["Ad C"]
    assert body["proposals"][0]["actionType"] == "PAUSE_AD"
    assert (
        body["proposals"][0]["reasoning"] == "Spent well above target with no result."
    )


def test_target_and_breakeven_come_from_the_plans_unit_economics(
    client: TestClient,
) -> None:
    economics = UnitEconomicsFields(
        gross_profit=120.0, breakeven_cac=120.0, target_cac=40.0, breakeven_roas=2.5
    )
    business_id, campaign_id = _setup(client, strategy=_data_driven(economics))
    _run(
        client,
        lambda: _seed_metric(
            campaign_id, spend=100.0, purchases=2, purchase_value=200.0
        ),
    )

    t1 = client.get(_url(business_id, campaign_id)).json()["tier1"]

    assert t1["costPerPurchase"]["targetSource"] == "unit_economics"
    assert t1["costPerPurchase"]["target"] == 40.0
    assert t1["costPerPurchase"]["breakeven"] == 120.0
    assert t1["costPerPurchase"]["position"] == "above_target"
    assert t1["roas"]["value"] == 2.0
    assert t1["roas"]["breakeven"] == 2.5
    assert t1["roas"]["position"] == "below_breakeven"
    # A data-driven strategy has a daily figure but no planned total.
    assert t1["spend"]["plannedDaily"] == 25.0
    assert t1["spend"]["plannedTotal"] is None


def test_dashboard_without_a_strategy_falls_back_to_the_benchmark_cac(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    _run(client, lambda: _seed_metric(campaign_id, spend=100.0, purchases=2))

    t1 = client.get(_url(business_id, campaign_id)).json()["tier1"]

    assert t1["costPerPurchase"]["targetSource"] == "industry_benchmark"
    assert t1["spend"]["plannedTotal"] is None
    assert t1["spend"]["plannedDaily"] is None


def test_tier2_flags_thin_data(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)
    _run(
        client,
        lambda: _seed_metric(
            campaign_id,
            impressions=640,
            spend=6.4,
            link_clicks=9,
            landing_page_views=7,
            add_to_cart=2,
            initiated_checkout=1,
        ),
    )

    t2 = client.get(_url(business_id, campaign_id)).json()["tier2"]

    assert (
        t2["linkCtr"]["confidence"]["label"]
        == "Based on 640 impressions — too early to judge"
    )
    assert t2["cpm"]["confidence"]["sufficient"] is False
    assert (
        t2["addToCart"]["confidence"]["label"]
        == "Based on 2 add-to-carts — too early to judge"
    )
    assert (
        t2["checkout"]["confidence"]["label"]
        == "Based on 1 checkout — too early to judge"
    )


def test_older_snapshots_without_link_fields_read_as_unavailable(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    _run(client, lambda: _seed_metric(campaign_id, impressions=5000, spend=50.0))

    t2 = client.get(_url(business_id, campaign_id)).json()["tier2"]

    assert t2["linkCtr"]["value"] is None
    assert t2["checkout"]["count"] is None
    assert t2["funnel"][1]["count"] is None


def test_applied_pause_and_user_pause_are_labelled_differently(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(client)
    ads = _run(client, lambda: _seed_ads(campaign_id, ["Auto", "Manual", "Live"]))
    _run(client, lambda: _seed_metric(campaign_id, spend=30.0))
    for ad_id, ad_set_id in ads:
        _run(
            client,
            lambda a=ad_id, s=ad_set_id: _seed_metric(
                campaign_id, ad_id=a, ad_set_id=s, spend=10.0
            ),
        )
    _run(client, lambda: _set_ad_status(ads[0][0], "PAUSED"))
    _run(client, lambda: _set_ad_status(ads[1][0], "PAUSED"))
    _run(
        client,
        lambda: _seed_recommendation(
            campaign_id, status="APPLIED", target_ad_id=ads[0][0]
        ),
    )

    rows = client.get(_url(business_id, campaign_id)).json()["tier3"]["ads"]

    assert {r["name"]: r["status"] for r in rows} == {
        "Auto": "paused_by_optimizer",
        "Manual": "paused",
        "Live": "live",
    }


def test_only_pending_recommendations_show_as_proposals(client: TestClient) -> None:
    business_id, campaign_id = _setup(client)
    _run(client, lambda: _seed_metric(campaign_id))
    for status in ("PENDING", "APPLIED", "REJECTED", "SUPERSEDED"):
        _run(
            client,
            lambda st=status: _seed_recommendation(
                campaign_id, action_type="INCREASE_BUDGET", status=st, reasoning=st
            ),
        )

    proposals = client.get(_url(business_id, campaign_id)).json()["proposals"]

    assert [p["reasoning"] for p in proposals] == ["PENDING"]
    assert proposals[0]["targetAdName"] is None


def test_proposals_and_pixel_warning_show_even_before_any_snapshot(
    client: TestClient,
) -> None:
    business_id, campaign_id = _setup(
        client, pixel_warning="Purchase event may not be firing"
    )
    _run(
        client, lambda: _seed_recommendation(campaign_id, action_type="DECREASE_BUDGET")
    )

    body = client.get(_url(business_id, campaign_id)).json()

    assert body["hasData"] is False
    assert body["pixelWarning"] == "Purchase event may not be firing"
    assert len(body["proposals"]) == 1


# --- business summary ------------------------------------------------


def test_business_summary_adds_each_campaigns_latest_totals_only(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    live_a = _run(client, lambda: _seed_campaign(business_id, name="A"))
    live_b = _run(client, lambda: _seed_campaign(business_id, name="B"))
    paused = _run(
        client, lambda: _seed_campaign(business_id, name="C", status="PAUSED")
    )
    draft = _run(
        client,
        lambda: _seed_campaign(
            business_id, name="Draft", status="DRAFT", published=False
        ),
    )
    for hours_ago, spend, purchases, value in (
        (2.0, 10.0, 0, 0.0),
        (1.0, 40.0, 1, 90.0),
        (0.0, 100.0, 2, 250.0),
    ):
        _run(
            client,
            lambda h=hours_ago, s=spend, p=purchases, v=value: _seed_metric(
                live_a, hours_ago=h, spend=s, purchases=p, purchase_value=v
            ),
        )
    for hours_ago, spend, purchases, value in (
        (1.0, 20.0, 0, 0.0),
        (0.0, 60.0, 3, 300.0),
    ):
        _run(
            client,
            lambda h=hours_ago, s=spend, p=purchases, v=value: _seed_metric(
                live_b, hours_ago=h, spend=s, purchases=p, purchase_value=v
            ),
        )
    _run(
        client,
        lambda: _seed_metric(paused, spend=40.0, purchases=0, purchase_value=0.0),
    )
    _run(
        client,
        lambda: _seed_metric(draft, spend=999.0, purchases=9, purchase_value=999.0),
    )

    body = client.get(f"/businesses/{business_id}/dashboard").json()

    assert body["activeCampaigns"] == 2
    assert body["totalSpend"] == 200.0  # 100 + 60 + 40, not the sum of every snapshot
    assert body["purchases"] == 5
    assert body["revenue"] == 550.0
    assert body["costPerPurchase"] == 40.0
    assert {c["name"] for c in body["campaigns"]} == {"A", "B", "C"}
    assert body["isSample"] is False
    assert body["confidence"]["sufficient"] is False
    assert body["confidence"]["label"] == "Based on 5 purchases — too early to judge"


def test_business_summary_with_no_published_campaigns(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    body = client.get(f"/businesses/{business_id}/dashboard").json()

    assert body["activeCampaigns"] == 0
    assert body["totalSpend"] == 0
    assert body["purchases"] is None
    assert body["costPerPurchase"] is None
    assert body["campaigns"] == []
    assert body["confidence"]["label"] == "Based on 0 purchases — too early to judge"


def test_business_summary_ignores_other_businesses(client: TestClient) -> None:
    _signed_up_client(client)
    mine = _create_business(client, "Mine")
    other = _create_business(client, "Other")
    mine_campaign = _run(client, lambda: _seed_campaign(mine))
    other_campaign = _run(client, lambda: _seed_campaign(other))
    _run(client, lambda: _seed_metric(mine_campaign, spend=10.0))
    _run(client, lambda: _seed_metric(other_campaign, spend=500.0))

    body = client.get(f"/businesses/{mine}/dashboard").json()

    assert body["totalSpend"] == 10.0


# --- sample data (local fake mode only) ------------------------------


def test_sample_data_is_a_404_when_fake_mode_is_off(client: TestClient) -> None:
    """The default (and production) configuration: ?sample=true is refused, never
    silently ignored and never served."""
    business_id, campaign_id = _setup(client)

    campaign = client.get(_url(business_id, campaign_id, "?sample=true"))
    business = client.get(f"/businesses/{business_id}/dashboard?sample=true")

    assert campaign.status_code == 404
    assert business.status_code == 404
    assert "local" in campaign.json()["detail"]


def test_sample_data_with_the_sample_flag_is_labelled_and_never_stored(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """DASHBOARD_SAMPLE_DATA is the dev switch: it leaves real Meta calls alone."""
    monkeypatch.setenv("DASHBOARD_SAMPLE_DATA", "true")
    get_settings.cache_clear()
    try:
        business_id, campaign_id = _setup(client)

        body = client.get(_url(business_id, campaign_id, "?sample=true")).json()
        strip = client.get(f"/businesses/{business_id}/dashboard?sample=true").json()

        assert body["isSample"] is True
        assert body["hasData"] is True
        assert body["tier1"]["purchases"]["value"] == 3
        assert body["tier1"]["revenue"]["value"] == 420.0
        assert body["tier1"]["spend"]["value"] == 142.5
        assert body["tier3"]["leader"] is None
        assert len(body["proposals"]) == 1
        assert strip["isSample"] is True
        assert strip["activeCampaigns"] == 2
        # Nothing was written: the real campaign still has no snapshots.
        assert _run(client, lambda: _metric_count(campaign_id)) == 0
        real = client.get(_url(business_id, campaign_id)).json()
        assert real["hasData"] is False
        assert real["isSample"] is False
    finally:
        get_settings.cache_clear()


def test_sample_data_is_also_allowed_in_full_fake_mode(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        business_id, campaign_id = _setup(client)

        response = client.get(_url(business_id, campaign_id, "?sample=true"))

        assert response.status_code == 200
        assert response.json()["isSample"] is True
    finally:
        get_settings.cache_clear()


def test_sample_data_only_appears_when_asked_for(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Even with the flag on, the plain endpoint never returns sample numbers."""
    monkeypatch.setenv("DASHBOARD_SAMPLE_DATA", "true")
    get_settings.cache_clear()
    try:
        business_id, campaign_id = _setup(client)

        body = client.get(_url(business_id, campaign_id)).json()
        strip = client.get(f"/businesses/{business_id}/dashboard").json()

        assert body["isSample"] is False
        assert body["hasData"] is False
        assert strip["isSample"] is False
        assert strip["campaigns"] == []
    finally:
        get_settings.cache_clear()
