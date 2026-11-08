"""Tests for the Pixel health check.

Covers app/services/pixel_health.py and app/api/pixel_health.py.

The check answers "is the Pixel Sales Guru uses actually receiving this business's
website events, and when did we last look?" It is worked out on demand (when the
dashboard or the publish screen loads) and kept for a few minutes, so a stale warning
cannot linger and a page that is opened again and again cannot hammer Meta.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.core.crypto import encrypt_token
from app.schemas.meta import MetaPixel
from app.services import pixel_health
from app.services.meta import MetaConnectionError
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_dashboard import _seed_campaign
from tests.test_optimization_jobs import _create_business, _run, _signed_up_client

NOW = datetime(2026, 11, 8, 12, 0, tzinfo=UTC)
VENZI = MetaPixel(
    id="2024258651467538",
    name="venzi jewelry",
    last_fired_at=NOW - timedelta(hours=16),
)


@pytest.fixture(autouse=True)
def _fresh_cache() -> None:
    pixel_health.clear_cache()


# ---- the rules -------------------------------------------------------------


def assess(
    counts: dict[str, int],
    *,
    pixels: list[MetaPixel] | None = None,
    pixel_id: str | None = "2024258651467538",
) -> pixel_health.PixelHealth:
    return pixel_health.assess(
        pixel_id=pixel_id,
        pixels=[VENZI] if pixels is None else pixels,
        counts=counts,
        now=NOW,
    )


def test_no_pixel_selected_has_nothing_to_warn_about() -> None:
    result = assess({}, pixel_id=None)

    assert result.status == "none_selected"
    assert result.warning is None
    assert result.pixel_name is None


def test_a_pixel_receiving_events_including_purchases_is_ok() -> None:
    result = assess({"PageView": 400, "InitiateCheckout": 4, "Purchase": 2})

    assert result.status == "ok"
    assert result.warning is None
    assert result.pixel_id == "2024258651467538"
    assert result.pixel_name == "venzi jewelry"
    assert result.last_fired_at == VENZI.last_fired_at
    assert result.checked_at == NOW


def test_a_pixel_with_no_events_at_all_says_the_store_may_use_another_dataset() -> None:
    result = assess({})

    assert result.status == "no_events"
    assert result.warning is not None
    assert "venzi jewelry" in result.warning
    assert "no website events in the last 30 days" in result.warning
    assert "different dataset" in result.warning


def test_other_datasets_that_did_receive_events_are_named() -> None:
    other = MetaPixel(
        id="1595307142179160", name="Sales Guru", last_fired_at=NOW - timedelta(days=2)
    )
    stale = MetaPixel(
        id="920564097324429",
        name="Marketing Guru",
        last_fired_at=NOW - timedelta(days=90),
    )
    never = MetaPixel(id="1", name="Never fired")

    result = assess({}, pixels=[VENZI, other, stale, never])

    assert [p.id for p in result.other_pixels] == ["1595307142179160"]
    assert result.warning is not None
    assert "Sales Guru" in result.warning
    assert "Marketing Guru" not in result.warning


def test_checkouts_without_a_purchase_keeps_the_existing_purchase_warning() -> None:
    result = assess({"PageView": 50, "InitiateCheckout": 4})

    assert result.status == "no_purchase"
    assert result.warning is not None
    assert "Purchase event may not be firing" in result.warning


def test_page_views_alone_are_not_a_problem() -> None:
    result = assess({"PageView": 10})

    assert result.status == "ok"
    assert result.warning is None


def test_a_pixel_meta_marks_unavailable_is_flagged() -> None:
    result = assess(
        {"PageView": 10},
        pixels=[VENZI.model_copy(update={"is_unavailable": True})],
    )

    assert result.status == "unavailable"
    assert result.warning is not None


def test_a_selected_pixel_that_is_no_longer_on_the_ad_account_is_flagged() -> None:
    result = assess({"PageView": 10}, pixels=[MetaPixel(id="other", name="Other")])

    assert result.status == "unavailable"
    assert result.warning is not None
    assert "no longer" in result.warning


# ---- on demand, rate limited -----------------------------------------------


def _connection(pixel_id: str | None = "2024258651467538") -> SimpleNamespace:
    return SimpleNamespace(pixelId=pixel_id, accessToken="t", adAccountId="act_1")


class Meta:
    """The two Meta reads the check makes, counted."""

    def __init__(
        self,
        monkeypatch: pytest.MonkeyPatch,
        *,
        counts: dict[str, int] | None = None,
        pixel_id: str | None = "2024258651467538",
    ) -> None:
        self.connection = AsyncMock(return_value=_connection(pixel_id))
        self.pixels = AsyncMock(return_value=[VENZI])
        self.counts = AsyncMock(
            return_value={"PageView": 9, "Purchase": 1} if counts is None else counts
        )
        monkeypatch.setattr(pixel_health, "get_meta_connection", self.connection)
        monkeypatch.setattr(pixel_health, "list_ad_pixels", self.pixels)
        monkeypatch.setattr(pixel_health, "fetch_pixel_event_counts", self.counts)

    @property
    def calls(self) -> int:
        return self.pixels.await_count + self.counts.await_count


@pytest.mark.asyncio
async def test_it_reads_meta_and_stamps_when_it_checked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)

    result = await pixel_health.get_pixel_health("biz", now=NOW)

    assert result.status == "ok"
    assert result.checked_at == NOW
    assert meta.calls == 2


@pytest.mark.asyncio
async def test_with_no_pixel_selected_meta_is_not_asked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch, pixel_id=None)

    result = await pixel_health.get_pixel_health("biz", now=NOW)

    assert result.status == "none_selected"
    assert meta.calls == 0


@pytest.mark.asyncio
async def test_with_no_connection_there_is_nothing_to_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    meta.connection.return_value = None

    result = await pixel_health.get_pixel_health("biz", now=NOW)

    assert result.status == "none_selected"
    assert meta.calls == 0


@pytest.mark.asyncio
async def test_a_second_look_within_ten_minutes_reuses_the_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    first = await pixel_health.get_pixel_health("biz", now=NOW)

    second = await pixel_health.get_pixel_health("biz", now=NOW + timedelta(minutes=9))

    assert second.checked_at == first.checked_at == NOW
    assert meta.calls == 2


@pytest.mark.asyncio
async def test_after_ten_minutes_it_looks_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    await pixel_health.get_pixel_health("biz", now=NOW)
    later = NOW + timedelta(minutes=10, seconds=1)

    second = await pixel_health.get_pixel_health("biz", now=later)

    assert second.checked_at == later
    assert meta.calls == 4


@pytest.mark.asyncio
async def test_check_again_is_honoured_but_not_more_than_once_a_minute(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    await pixel_health.get_pixel_health("biz", now=NOW)

    too_soon = await pixel_health.get_pixel_health(
        "biz", refresh=True, now=NOW + timedelta(seconds=30)
    )
    assert too_soon.checked_at == NOW
    assert meta.calls == 2

    allowed_at = NOW + timedelta(seconds=61)
    again = await pixel_health.get_pixel_health("biz", refresh=True, now=allowed_at)
    assert again.checked_at == allowed_at
    assert meta.calls == 4


@pytest.mark.asyncio
async def test_choosing_a_different_pixel_is_never_answered_from_the_old_one(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    await pixel_health.get_pixel_health("biz", now=NOW)
    meta.connection.return_value = _connection("another")

    result = await pixel_health.get_pixel_health("biz", now=NOW + timedelta(seconds=5))

    assert result.checked_at == NOW + timedelta(seconds=5)
    assert meta.calls == 4


@pytest.mark.asyncio
async def test_clearing_the_cache_for_a_business_forces_a_new_look(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    await pixel_health.get_pixel_health("biz", now=NOW)

    pixel_health.clear_cache("biz")
    await pixel_health.get_pixel_health("biz", now=NOW + timedelta(seconds=5))

    assert meta.calls == 4


@pytest.mark.asyncio
async def test_a_failed_read_says_it_could_not_check_and_is_retried_soon(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    meta.counts.side_effect = MetaConnectionError(
        "Meta API call to /x/stats failed: Invalid OAuth access token", code=190
    )

    first = await pixel_health.get_pixel_health("biz", now=NOW)

    assert first.status == "unreadable"
    assert first.warning is not None
    assert "couldn’t check" in first.warning
    assert "Invalid OAuth" not in first.warning
    assert first.checked_at == NOW

    meta.counts.side_effect = None
    meta.counts.return_value = {"PageView": 3}
    still = await pixel_health.get_pixel_health("biz", now=NOW + timedelta(seconds=30))
    assert still.status == "unreadable"
    recovered = await pixel_health.get_pixel_health(
        "biz", now=NOW + timedelta(seconds=61)
    )
    assert recovered.status == "ok"


@pytest.mark.asyncio
async def test_fake_meta_gets_a_canned_healthy_answer_without_reading_anything(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    meta = Meta(monkeypatch)
    monkeypatch.setattr(
        pixel_health, "get_settings", lambda: SimpleNamespace(fake_meta_enabled=True)
    )

    result = await pixel_health.get_pixel_health("biz", now=NOW)

    assert result.status == "ok"
    assert meta.calls == 0


# ---- the endpoint ----------------------------------------------------------


async def _seed_connection(business_id: str, pixel_id: str | None) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metaconnection.create(
            data={
                "businessId": business_id,
                "metaUserId": "meta_user",
                "accessToken": encrypt_token("a-token"),
                "adAccountId": "act_1",
                "pageId": "page_1",
                "pixelId": pixel_id,
                "tokenExpiresAt": datetime.now(UTC) + timedelta(days=30),
            }
        )
    finally:
        await seeder.disconnect()


def _business(client: TestClient, *, pixel_id: str | None = "2024258651467538") -> str:
    _signed_up_client(client)
    business_id = _create_business(client)
    _run(client, lambda: _seed_connection(business_id, pixel_id))
    return business_id


def test_the_endpoint_requires_a_session(client: TestClient) -> None:
    assert client.get("/businesses/x/pixel-health").status_code == 401


def test_the_endpoint_404s_for_another_users_business(client: TestClient) -> None:
    business_id = _business(client)
    client.post("/auth/logout")
    _signed_up_client(client, "two@example.com")

    assert client.get(f"/businesses/{business_id}/pixel-health").status_code == 404


def test_the_endpoint_returns_the_health_with_when_it_was_checked(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = _business(client)
    Meta(monkeypatch, counts={"PageView": 9})
    monkeypatch.setattr(
        pixel_health, "get_meta_connection", AsyncMock(return_value=_connection())
    )

    body = client.get(f"/businesses/{business_id}/pixel-health").json()

    assert body["status"] == "ok"
    assert body["pixelName"] == "venzi jewelry"
    assert body["checkedAt"] is not None
    assert body["lastFiredAt"] is not None
    assert body["windowDays"] == 30


def test_the_endpoint_says_no_events_when_the_pixel_received_none(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = _business(client)
    Meta(monkeypatch, counts={})

    body = client.get(f"/businesses/{business_id}/pixel-health").json()

    assert body["status"] == "no_events"
    assert "no website events" in body["warning"]


def test_check_again_is_accepted_and_rate_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = _business(client)
    meta = Meta(monkeypatch)

    client.get(f"/businesses/{business_id}/pixel-health")
    client.get(f"/businesses/{business_id}/pixel-health?refresh=true")

    assert meta.calls == 2  # the second look within a minute reused the first


def test_a_business_without_a_connection_has_nothing_to_check(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    body = client.get(f"/businesses/{business_id}/pixel-health").json()

    assert body["status"] == "none_selected"


# ---- a stale stored warning cannot outlive a healthy check ------------------

STALE = "Purchase event may not be firing: 0 Purchase events but 4 InitiateCheckout."


async def _stored_warning(campaign_id: str) -> str | None:
    seeder = Prisma()
    await seeder.connect()
    try:
        row = await seeder.campaign.find_unique(where={"id": campaign_id})
        assert row is not None
        return row.pixelWarning
    finally:
        await seeder.disconnect()


def _healthy_pixel(monkeypatch: pytest.MonkeyPatch) -> None:
    Meta(monkeypatch, counts={"PageView": 9, "InitiateCheckout": 2, "Purchase": 2})


def test_a_healthy_check_clears_a_warning_stored_while_the_campaign_was_live(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Snake-Ring kept its Purchase warning after it stopped being checked."""
    business_id = _business(client)
    archived = _run(
        client,
        lambda: _seed_campaign(business_id, status="ARCHIVED", pixel_warning=STALE),
    )
    live = _run(
        client, lambda: _seed_campaign(business_id, status="LIVE", pixel_warning=STALE)
    )
    _healthy_pixel(monkeypatch)

    assert (
        client.get(f"/businesses/{business_id}/pixel-health").json()["status"] == "ok"
    )

    assert _run(client, _stored_warning, archived) is None
    assert _run(client, _stored_warning, live) is None


def test_a_problem_found_leaves_stored_warnings_alone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = _business(client)
    campaign_id = _run(
        client, lambda: _seed_campaign(business_id, status="LIVE", pixel_warning=STALE)
    )
    Meta(monkeypatch, counts={})

    client.get(f"/businesses/{business_id}/pixel-health")

    assert _run(client, _stored_warning, campaign_id) == STALE


def test_another_businesses_warning_is_never_touched(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = _business(client)
    other = _create_business(client, "Other business")
    other_campaign = _run(
        client, lambda: _seed_campaign(other, status="LIVE", pixel_warning=STALE)
    )
    _healthy_pixel(monkeypatch)

    client.get(f"/businesses/{business_id}/pixel-health")

    assert _run(client, _stored_warning, other_campaign) == STALE
