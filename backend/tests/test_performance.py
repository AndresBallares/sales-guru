"""Tests for the Advertising Performance endpoint (app/api/performance.py).

Rows are seeded straight into the database, then the real endpoint is driven
through the TestClient; the period math itself is covered in
test_performance_service.py.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_dashboard import (
    _create_business,
    _run,
    _seed_campaign,
    _signed_up_client,
)


async def _seed_snapshot(
    campaign_id: str,
    *,
    hours_ago: float,
    spend: float,
    impressions: int = 10000,
    clicks: int = 200,
    link_clicks: int | None = 100,
    landing_page_views: int | None = 80,
    add_to_cart: int | None = 20,
    initiated_checkout: int | None = 10,
    purchases: int | None = 5,
    purchase_value: float | None = 420.0,
    reach: int | None = 8000,
    frequency: float | None = 1.25,
    ad_set_id: str | None = None,
) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metric.create(
            data={
                "campaignId": campaign_id,
                "adSetId": ad_set_id,
                "impressions": impressions,
                "clicks": clicks,
                "spend": spend,
                "conversions": 0,
                "reach": reach,
                "frequency": frequency,
                "linkClicks": link_clicks,
                "landingPageViews": landing_page_views,
                "addToCart": add_to_cart,
                "initiatedCheckout": initiated_checkout,
                "purchases": purchases,
                "purchaseValue": purchase_value,
                "fetchedAt": datetime.now(UTC) - timedelta(hours=hours_ago),
            }
        )
    finally:
        await seeder.disconnect()


async def _seed_connection(business_id: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metaconnection.create(
            data={
                "businessId": business_id,
                "metaUserId": "meta_user",
                "accessToken": "not-a-real-token",
                "tokenExpiresAt": datetime.now(UTC) + timedelta(days=30),
            }
        )
    finally:
        await seeder.disconnect()


def _setup(client: TestClient, *, connected: bool = True) -> str:
    _signed_up_client(client)
    business_id = _create_business(client)
    if connected:
        _run(client, lambda: _seed_connection(business_id))
    return business_id


def _get(client: TestClient, business_id: str, **params: Any) -> Any:
    return client.get(f"/businesses/{business_id}/performance", params=params)


def test_performance_requires_a_session(client: TestClient) -> None:
    assert client.get("/businesses/x/performance").status_code == 401


def test_performance_404s_for_another_users_business(client: TestClient) -> None:
    business_id = _setup(client)
    client.post("/auth/logout")
    _signed_up_client(client, "two@example.com")

    assert _get(client, business_id).status_code == 404


def test_a_business_with_no_published_campaign_has_no_numbers(
    client: TestClient,
) -> None:
    business_id = _setup(client)
    _run(client, lambda: _seed_campaign(business_id, published=False))

    body = _get(client, business_id, days=7).json()

    assert body["current"] is None
    assert body["campaigns"] == []
    assert body["sync"]["status"] == "waiting"
    assert body["sync"]["lastSyncedAt"] is None


def test_the_response_carries_the_stored_numbers_and_the_syncs_own_timestamp(
    client: TestClient,
) -> None:
    business_id = _setup(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id, name="Spring"))
    _run(client, lambda: _seed_snapshot(campaign_id, hours_ago=0.1, spend=100))

    body = _get(client, business_id, days=0).json()

    current = body["current"]
    assert current["spend"] == 100
    assert current["purchases"] == 5
    assert current["purchaseValue"] == 420
    assert current["roas"] == 4.2
    assert current["costPerSale"] == 20
    assert current["linkClicks"] == 100
    assert current["clicks"] == 200
    assert body["days"] is None
    assert body["reach"] == 8000
    assert body["frequency"] == 1.25
    assert body["campaigns"][0]["name"] == "Spring"
    assert body["sync"]["status"] == "ok"
    synced = datetime.fromisoformat(body["sync"]["lastSyncedAt"])
    assert abs(datetime.now(UTC) - synced - timedelta(hours=0.1)) < timedelta(minutes=1)


def test_the_window_comes_from_the_days_parameter(client: TestClient) -> None:
    business_id = _setup(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id))
    _run(
        client,
        lambda: _seed_snapshot(
            campaign_id, hours_ago=24 * 20, spend=30, purchases=1, purchase_value=40
        ),
    )
    _run(client, lambda: _seed_snapshot(campaign_id, hours_ago=0.1, spend=100))

    week = _get(client, business_id, days=7).json()
    all_time = _get(client, business_id, days=0).json()

    assert week["days"] == 7
    assert week["current"]["spend"] == 70
    assert all_time["current"]["spend"] == 100
    assert len(week["daily"]) == 7


def test_days_defaults_to_seven_and_rejects_other_windows(client: TestClient) -> None:
    business_id = _setup(client)

    assert _get(client, business_id).json()["days"] == 7
    assert _get(client, business_id, days=14).status_code == 200
    assert _get(client, business_id, days=30).status_code == 200
    assert _get(client, business_id, days=90).status_code == 200
    assert _get(client, business_id, days=5).status_code == 422


def test_without_a_meta_connection_the_sync_says_not_connected(
    client: TestClient,
) -> None:
    business_id = _setup(client, connected=False)

    assert _get(client, business_id).json()["sync"]["status"] == "not_connected"


def test_a_stale_sync_is_reported_with_the_last_good_time(client: TestClient) -> None:
    business_id = _setup(client)
    campaign_id = _run(client, lambda: _seed_campaign(business_id, status="LIVE"))
    _run(client, lambda: _seed_snapshot(campaign_id, hours_ago=3, spend=100))

    sync = _get(client, business_id).json()["sync"]

    assert sync["status"] == "stale"
    assert sync["lastSyncedAt"] is not None


def test_ad_set_rows_under_a_campaign_budget_are_not_counted_twice(
    client: TestClient,
) -> None:
    business_id = _setup(client)
    campaign_id = _run(
        client, lambda: _seed_campaign(business_id, budget_level="CAMPAIGN", ad_sets=1)
    )
    ad_set_id = _run(client, lambda: _first_ad_set(campaign_id))
    _run(client, lambda: _seed_snapshot(campaign_id, hours_ago=0.1, spend=100))
    _run(
        client,
        lambda: _seed_snapshot(
            campaign_id, hours_ago=0.1, spend=100, ad_set_id=ad_set_id
        ),
    )

    body = _get(client, business_id, days=0).json()

    assert body["current"]["spend"] == 100


async def _first_ad_set(campaign_id: str) -> str:
    seeder = Prisma()
    await seeder.connect()
    try:
        row = await seeder.adset.find_first(where={"campaignId": campaign_id})
        assert row is not None
        return row.id
    finally:
        await seeder.disconnect()
