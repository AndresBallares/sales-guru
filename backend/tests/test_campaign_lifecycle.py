"""Deleting and archiving campaigns (app/services/campaign_lifecycle.py).

A campaign that never delivered is deleted, on Meta first and then locally; one
that has delivered is archived (paused on Meta if live) and kept whole.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import meta as meta_service_module
from app.services import optimization_jobs
from app.services.meta import CampaignInsights, MetaConnectionError
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.types import MetricCreateInput

from tests.test_publish import (
    _ready_campaign,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

NOT_FOUND = 33  # Meta's "object does not exist or cannot be loaded" subcode


@pytest.fixture
def meta_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> dict[str, AsyncMock]:
    """Meta deletion and the insights guard, mocked (nothing real is called)."""
    delete = AsyncMock(return_value=True)
    monkeypatch.setattr(meta_service_module, "delete_meta_object", delete)
    insights = AsyncMock(
        return_value=CampaignInsights(impressions=0, clicks=0, spend=0.0, conversions=0)
    )
    monkeypatch.setattr(meta_service_module, "fetch_campaign_insights", insights)
    return {"delete": delete, "insights": insights}


def _publish(client: TestClient, *, paused: bool = False) -> tuple[str, str]:
    business_id, campaign_id = _ready_campaign(client)
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish",
        json={"paused": paused},
    )
    assert response.status_code == 200
    return business_id, campaign_id


def _url(business_id: str, campaign_id: str, suffix: str = "") -> str:
    return f"/businesses/{business_id}/campaigns/{campaign_id}{suffix}"


async def _seed_metric(
    campaign_id: str, *, spend: float = 0.0, purchases: int | None = None
) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        data: MetricCreateInput = {
            "campaignId": campaign_id,
            "impressions": 100,
            "clicks": 5,
            "spend": spend,
            "conversions": 0,
        }
        if purchases is not None:
            data["purchases"] = purchases
        await seeder.metric.create(data=data)
    finally:
        await seeder.disconnect()


async def _seed_recommendation_and_evaluation(campaign_id: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.optimizationrecommendation.create(
            data={
                "campaignId": campaign_id,
                "actionType": "INCREASE_BUDGET",
                "reasoning": "Doing well",
                "confidence": 0.9,
                "risk": "LOW",
            }
        )
    finally:
        await seeder.disconnect()


async def _counts(campaign_id: str) -> dict[str, int]:
    """How many rows of each kind still exist for the campaign."""
    seeder = Prisma()
    await seeder.connect()
    try:
        ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
        ids = [a.id for a in ad_sets]
        return {
            "campaign": await seeder.campaign.count(where={"id": campaign_id}),
            "ad_sets": len(ad_sets),
            "ads": await seeder.ad.count(where={"adSetId": {"in": ids}}) if ids else 0,
            "creatives": await seeder.creative.count(where={"campaignId": campaign_id}),
            "strategy": await seeder.strategy.count(where={"campaignId": campaign_id}),
            "metrics": await seeder.metric.count(where={"campaignId": campaign_id}),
            "recommendations": await seeder.optimizationrecommendation.count(
                where={"campaignId": campaign_id}
            ),
        }
    finally:
        await seeder.disconnect()


async def _campaign_row(campaign_id: str) -> Any:
    seeder = Prisma()
    await seeder.connect()
    try:
        return await seeder.campaign.find_unique(where={"id": campaign_id})
    finally:
        await seeder.disconnect()


def _deleted_ids(meta_calls: dict[str, AsyncMock]) -> list[str]:
    return [c.kwargs["meta_object_id"] for c in meta_calls["delete"].await_args_list]


# ── Delete: a campaign that never delivered ──────────────────


@pytest.mark.asyncio
async def test_a_campaign_never_published_is_deleted_without_touching_meta(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 204
    meta_calls["delete"].assert_not_awaited()
    meta_calls["insights"].assert_not_awaited()
    counts = await _counts(campaign_id)
    assert counts["campaign"] == 0
    assert counts["creatives"] == 0
    assert counts["strategy"] == 0


@pytest.mark.asyncio
async def test_a_published_campaign_that_never_delivered_is_deleted_on_meta_first(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client, paused=True)
    await _seed_metric(campaign_id, spend=0.0)  # an all-zero snapshot is not delivery
    before = await _counts(campaign_id)
    assert before["ads"] >= 1 and before["ad_sets"] >= 1 and before["metrics"] == 1

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 204
    # Ads, then ad sets, then the campaign, then the creatives.
    assert _deleted_ids(meta_calls) == [
        "meta_ad_1",
        "meta_adset_1",
        "meta_campaign_1",
        "meta_creative_1",
    ]
    assert all(v == 0 for v in (await _counts(campaign_id)).values())


@pytest.mark.asyncio
async def test_the_stuck_case_a_meta_campaign_with_no_ad_sets_or_ads_can_be_deleted(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """A campaign object exists on Meta but publishing never got further."""
    business_id, campaign_id = _publish(client, paused=True)
    seeder = Prisma()
    await seeder.connect()
    ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
    await seeder.ad.delete_many(where={"adSetId": {"in": [a.id for a in ad_sets]}})
    await seeder.adset.delete_many(where={"campaignId": campaign_id})
    for creative in await seeder.creative.find_many(where={"campaignId": campaign_id}):
        await seeder.creative.update(
            where={"id": creative.id},
            data={"metaCreativeId": None, "ad": {"disconnect": True}},
        )
    await seeder.disconnect()

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 204
    assert _deleted_ids(meta_calls) == ["meta_campaign_1"]
    assert (await _counts(campaign_id))["campaign"] == 0


@pytest.mark.asyncio
async def test_a_campaign_that_is_already_gone_on_meta_still_deletes_locally(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """Archived or removed in Ads Manager (the Venus case): Meta reports each
    object as already gone, and its insights as absent."""
    business_id, campaign_id = _publish(client, paused=True)
    meta_calls["delete"].return_value = False  # already gone
    meta_calls["insights"].side_effect = MetaConnectionError(
        "Object does not exist", error_subcode=NOT_FOUND
    )

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 204
    assert (await _counts(campaign_id))["campaign"] == 0


# ── Delete: refused when it has results ──────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(("spend", "purchases"), [(12.5, None), (0.0, 1), (3.0, 2)])
async def test_a_campaign_that_has_delivered_cannot_be_deleted(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    spend: float,
    purchases: int | None,
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=spend, purchases=purchases)
    before = await _counts(campaign_id)

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 409
    assert "archive it" in response.json()["detail"]
    meta_calls["delete"].assert_not_awaited()
    assert await _counts(campaign_id) == before


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "insights",
    [
        CampaignInsights(impressions=900, clicks=40, spend=18.0, conversions=0),
        CampaignInsights(
            impressions=10, clicks=1, spend=0.0, conversions=1, purchases=1
        ),
    ],
)
async def test_meta_reporting_results_blocks_a_delete_the_snapshots_missed(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    insights: CampaignInsights,
) -> None:
    """Snapshots are 15 minutes apart: a campaign that just began spending can
    look "never delivered" locally. Meta's own numbers are the final word."""
    business_id, campaign_id = _publish(client)
    meta_calls["insights"].return_value = insights
    before = await _counts(campaign_id)

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 409
    meta_calls["delete"].assert_not_awaited()
    assert await _counts(campaign_id) == before


# ── Delete: failures leave local state alone ─────────────────


@pytest.mark.asyncio
async def test_a_meta_failure_leaves_every_local_row_and_a_retry_finishes_the_job(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client, paused=True)
    before = await _counts(campaign_id)
    # The ad and the ad set go; deleting the campaign itself fails.
    meta_calls["delete"].side_effect = [True, True, MetaConnectionError("Meta says no")]

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 500
    assert "Meta says no" in response.json()["detail"]
    assert "nothing was removed" in response.json()["detail"]
    assert await _counts(campaign_id) == before
    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "PAUSED"

    # Retry: what is already gone on Meta counts as deleted.
    meta_calls["delete"].side_effect = [False, False, True, True]
    retry = client.delete(_url(business_id, campaign_id))

    assert retry.status_code == 204
    assert all(v == 0 for v in (await _counts(campaign_id)).values())


@pytest.mark.asyncio
async def test_a_failure_in_the_insights_check_leaves_everything_alone(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client, paused=True)
    before = await _counts(campaign_id)
    meta_calls["insights"].side_effect = MetaConnectionError("Meta is down")

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 500
    meta_calls["delete"].assert_not_awaited()
    assert await _counts(campaign_id) == before


@pytest.mark.asyncio
async def test_objects_on_meta_but_no_connection_cannot_be_cleaned_up(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client, paused=True)
    assert client.delete(f"/businesses/{business_id}/meta").status_code == 204
    before = await _counts(campaign_id)

    response = client.delete(_url(business_id, campaign_id))

    assert response.status_code == 400
    assert "Reconnect Meta" in response.json()["detail"]
    meta_calls["delete"].assert_not_awaited()
    assert await _counts(campaign_id) == before


# ── Archive: a campaign that has delivered ───────────────────


@pytest.mark.asyncio
async def test_archiving_a_paused_campaign_keeps_all_its_results(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0, purchases=2)
    await _seed_recommendation_and_evaluation(campaign_id)
    assert client.post(_url(business_id, campaign_id, "/pause")).status_code == 200
    mock_services["pause_ad_set"].reset_mock()
    before = await _counts(campaign_id)

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ARCHIVED"
    assert body["hasDelivered"] is True
    assert body["pausedReason"] == "Manually paused"  # why it was paused is kept
    mock_services["pause_ad_set"].assert_not_awaited()  # already paused: no Meta call
    meta_calls["delete"].assert_not_awaited()
    after = await _counts(campaign_id)
    assert after["metrics"] >= before["metrics"]
    assert {k: after[k] for k in ("campaign", "ads", "creatives", "strategy")} == {
        k: before[k] for k in ("campaign", "ads", "creatives", "strategy")
    }
    assert after["recommendations"] == before["recommendations"] == 1


@pytest.mark.asyncio
async def test_archiving_a_live_campaign_pauses_it_on_meta_first(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0)
    metrics_before = (await _counts(campaign_id))["metrics"]

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 200
    assert response.json()["status"] == "ARCHIVED"
    assert response.json()["pausedReason"] == "Archived"
    mock_services["pause_ad_set"].assert_awaited_once()  # paused on Meta
    meta_calls["delete"].assert_not_awaited()  # never deleted
    # The pause took a final snapshot, so the numbers are complete.
    assert (await _counts(campaign_id))["metrics"] == metrics_before + 1


@pytest.mark.asyncio
async def test_a_failed_pause_leaves_a_live_campaign_live_and_unarchived(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0)
    mock_services["pause_ad_set"].side_effect = MetaConnectionError("Meta says no")

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 500
    assert "not archived" in response.json()["detail"]
    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "LIVE"


@pytest.mark.asyncio
async def test_archiving_a_live_campaign_without_a_meta_connection_is_refused(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0)
    assert client.delete(f"/businesses/{business_id}/meta").status_code == 204

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 400
    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "LIVE"


@pytest.mark.asyncio
async def test_a_campaign_that_never_ran_is_deleted_not_archived(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client, paused=True)

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 400
    assert "delete it" in response.json()["detail"]
    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "PAUSED"


@pytest.mark.asyncio
async def test_a_campaign_that_was_never_published_cannot_be_archived(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(_url(business_id, campaign_id, "/archive"))

    assert response.status_code == 400
    assert "never published" in response.json()["detail"]


@pytest.mark.asyncio
async def test_archiving_twice_is_harmless(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0)
    assert client.post(_url(business_id, campaign_id, "/archive")).status_code == 200

    again = client.post(_url(business_id, campaign_id, "/archive"))

    assert again.status_code == 200
    assert again.json()["status"] == "ARCHIVED"
    assert mock_services["pause_ad_set"].await_count == 1


@pytest.mark.asyncio
async def test_archive_requires_a_session_and_an_owned_campaign(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    assert client.post("/businesses/x/campaigns/y/archive").status_code == 401
    business_id, _ = _ready_campaign(client)
    assert (
        client.post(_url(business_id, "does-not-exist", "/archive")).status_code == 404
    )


# ── What archiving leaves alone ──────────────────────────────


@pytest.mark.asyncio
async def test_an_archived_campaign_stays_in_the_list_and_the_dashboard(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """The campaign list returns it (the page hides it unless asked) and the
    dashboard still counts its results."""
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0, purchases=2)
    assert client.post(_url(business_id, campaign_id, "/archive")).status_code == 200

    listed = client.get(f"/businesses/{business_id}/campaigns").json()
    mine = next(c for c in listed if c["id"] == campaign_id)
    assert mine["status"] == "ARCHIVED" and mine["hasDelivered"] is True
    dashboard = client.get(f"/businesses/{business_id}/dashboard").json()
    assert any(c["campaignId"] == campaign_id for c in dashboard["campaigns"])


@pytest.mark.asyncio
async def test_an_archived_campaign_is_no_longer_collected_or_activated(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0)
    assert client.post(_url(business_id, campaign_id, "/archive")).status_code == 200
    fetch = AsyncMock(
        return_value=CampaignInsights(impressions=1, clicks=1, spend=1.0, conversions=0)
    )
    monkeypatch.setattr(optimization_jobs, "fetch_campaign_insights", fetch)
    metrics_before = (await _counts(campaign_id))["metrics"]

    assert client.portal is not None
    client.portal.call(optimization_jobs.collect_metrics_for_all_live_campaigns)

    fetch.assert_not_awaited()
    assert (await _counts(campaign_id))["metrics"] == metrics_before
    # And it cannot be brought back with Activate.
    assert client.post(_url(business_id, campaign_id, "/activate")).status_code == 400


@pytest.mark.asyncio
async def test_a_delivered_campaign_reports_has_delivered_and_a_fresh_one_does_not(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _publish(client)

    fresh = client.get(f"/businesses/{business_id}/campaigns").json()[0]
    assert fresh["hasDelivered"] is False
    await _seed_metric(campaign_id, spend=0.0, purchases=1)
    delivered = client.get(f"/businesses/{business_id}/campaigns").json()[0]
    assert delivered["hasDelivered"] is True


# ── Restore: an archived campaign comes back, locally only ───


async def _archived_campaign(
    client: TestClient, *, live: bool = True
) -> tuple[str, str]:
    """A published campaign that delivered and has been archived."""
    business_id, campaign_id = _publish(client)
    await _seed_metric(campaign_id, spend=40.0, purchases=2)
    if not live:
        assert client.post(_url(business_id, campaign_id, "/pause")).status_code == 200
    assert client.post(_url(business_id, campaign_id, "/archive")).status_code == 200
    return business_id, campaign_id


@pytest.mark.asyncio
async def test_restoring_an_archived_campaign_pauses_it_locally_without_touching_meta(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = await _archived_campaign(client)
    for mock in (*mock_services.values(), *meta_calls.values()):
        mock.reset_mock()
    before = await _counts(campaign_id)

    response = client.post(_url(business_id, campaign_id, "/restore"))

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "PAUSED"
    assert body["pausedReason"] == "Restored from archive"
    assert body["hasDelivered"] is True
    # Nothing at all was sent to Meta.
    for name in ("pause_ad_set", "resume_ad_set", "resume_campaign", "resume_ad"):
        mock_services[name].assert_not_awaited()
    meta_calls["delete"].assert_not_awaited()
    meta_calls["insights"].assert_not_awaited()
    # Its history is as it was, and it is back in the list.
    assert await _counts(campaign_id) == before
    listed = client.get(f"/businesses/{business_id}/campaigns").json()
    assert next(c for c in listed if c["id"] == campaign_id)["status"] == "PAUSED"


@pytest.mark.asyncio
async def test_restoring_keeps_the_reason_the_campaign_was_paused_for(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """Only the plain "Archived" reason stops applying; an earlier reason is kept."""
    business_id, campaign_id = await _archived_campaign(client, live=False)

    response = client.post(_url(business_id, campaign_id, "/restore"))

    assert response.status_code == 200
    assert response.json()["pausedReason"] == "Manually paused"


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["LIVE", "PAUSED", "APPROVED"])
async def test_only_an_archived_campaign_can_be_restored(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    status: str,
) -> None:
    business_id, campaign_id = _publish(client, paused=(status == "PAUSED"))
    if status == "APPROVED":
        seeder = Prisma()
        await seeder.connect()
        await seeder.campaign.update(
            where={"id": campaign_id}, data={"status": "APPROVED"}
        )
        await seeder.disconnect()
    before = await _campaign_row(campaign_id)

    response = client.post(_url(business_id, campaign_id, "/restore"))

    assert response.status_code == 400
    assert "archived" in response.json()["detail"]
    after = await _campaign_row(campaign_id)
    assert before is not None and after is not None and after.status == before.status


@pytest.mark.asyncio
async def test_restore_requires_a_session_and_an_owned_campaign(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    assert client.post("/businesses/x/campaigns/y/restore").status_code == 401
    business_id, _ = _ready_campaign(client)
    assert (
        client.post(_url(business_id, "does-not-exist", "/restore")).status_code == 404
    )


@pytest.mark.asyncio
async def test_a_restored_campaign_can_be_archived_again(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = await _archived_campaign(client)
    assert client.post(_url(business_id, campaign_id, "/restore")).status_code == 200

    again = client.post(_url(business_id, campaign_id, "/archive"))

    assert again.status_code == 200
    assert again.json()["status"] == "ARCHIVED"


@pytest.mark.asyncio
async def test_a_restored_campaign_is_not_activatable_as_if_it_were_never_published(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = await _archived_campaign(client)
    client.post(_url(business_id, campaign_id, "/restore"))

    assert client.post(_url(business_id, campaign_id, "/activate")).status_code == 400


@pytest.mark.asyncio
async def test_the_meta_status_sync_and_collection_pick_a_restored_campaign_up_again(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Restored as PAUSED it is read from Meta every cycle: running there, it
    becomes LIVE and its results are collected again."""
    business_id, campaign_id = await _archived_campaign(client)
    assert client.post(_url(business_id, campaign_id, "/restore")).status_code == 200
    delivery = AsyncMock(
        return_value=meta_service_module.MetaDeliveryStatus("ACTIVE", ["ACTIVE"])
    )
    monkeypatch.setattr(meta_service_module, "fetch_meta_delivery_status", delivery)
    insights = AsyncMock(
        return_value=CampaignInsights(impressions=1, clicks=1, spend=1.0, conversions=0)
    )
    monkeypatch.setattr(optimization_jobs, "fetch_campaign_insights", insights)
    assert client.portal is not None
    metrics_before = (await _counts(campaign_id))["metrics"]

    client.portal.call(optimization_jobs.collect_metrics_for_all_live_campaigns)

    delivery.assert_awaited()
    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "LIVE"
    insights.assert_awaited()
    assert (await _counts(campaign_id))["metrics"] == metrics_before + 1


@pytest.mark.asyncio
async def test_a_restored_campaign_that_is_paused_on_meta_stays_paused(
    client: TestClient,
    meta_calls: dict[str, AsyncMock],
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    business_id, campaign_id = await _archived_campaign(client)
    assert client.post(_url(business_id, campaign_id, "/restore")).status_code == 200
    delivery = AsyncMock(
        return_value=meta_service_module.MetaDeliveryStatus("PAUSED", ["PAUSED"])
    )
    monkeypatch.setattr(meta_service_module, "fetch_meta_delivery_status", delivery)
    insights = AsyncMock(
        return_value=CampaignInsights(impressions=1, clicks=1, spend=1.0, conversions=0)
    )
    monkeypatch.setattr(optimization_jobs, "fetch_campaign_insights", insights)
    assert client.portal is not None

    client.portal.call(optimization_jobs.collect_metrics_for_all_live_campaigns)

    row = await _campaign_row(campaign_id)
    assert row is not None and row.status == "PAUSED"
    insights.assert_not_awaited()
