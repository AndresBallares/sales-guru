"""Tests for recording failed Meta syncs (app/services/sync_health.py).

The latest failed attempt to read a business's numbers from Meta is stored on its
MetaConnection: when, from which job, Meta's error code and a scrubbed reason. A
job that works clears only its own failure, and the collector's failure is never
hidden behind the spend check's.
"""

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.services import sync_health
from app.services.meta import MetaConnectionError
from app.services.sync_health import SyncSource
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_optimization_jobs import _create_business, _run, _signed_up_client


async def _seed_connection(business_id: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metaconnection.create(
            data={
                "businessId": business_id,
                "metaUserId": "meta_user",
                "accessToken": "ciphertext",
                "tokenExpiresAt": datetime.now(UTC) + timedelta(days=30),
            }
        )
    finally:
        await seeder.disconnect()


def _business(client: TestClient) -> str:
    _signed_up_client(client)
    business_id = _create_business(client)
    _run(client, lambda: _seed_connection(business_id))
    return business_id


async def _failure(business_id: str) -> tuple[str | None, int | None, str | None]:
    row = await _row(business_id)
    return row.syncFailureSource, row.syncFailureCode, row.syncFailureReason


async def _row(business_id: str) -> Any:
    seeder = Prisma()
    await seeder.connect()
    try:
        row = await seeder.metaconnection.find_unique(where={"businessId": business_id})
        assert row is not None
        return row
    finally:
        await seeder.disconnect()


# ---- scrubbing -------------------------------------------------------------


def test_the_reason_never_carries_an_access_token() -> None:
    token = "EAAB" + "x" * 60
    text = f"call failed: https://graph.facebook.com/v21/act_1?access_token={token}&a=1"

    out = sync_health.scrub_reason(text)

    assert token not in out
    assert "access_token=" not in out
    assert "[removed]" in out


def test_a_bare_token_in_the_text_is_removed_too() -> None:
    token = "EAAB" + "y" * 40

    out = sync_health.scrub_reason(f"Invalid token {token} for this app")

    assert token not in out
    assert "Invalid token" in out


def test_a_long_reason_is_cut_to_300_characters() -> None:
    out = sync_health.scrub_reason("a" * 900)

    assert len(out) == 300
    assert out.endswith("…")


def test_an_empty_reason_still_says_something() -> None:
    assert sync_health.scrub_reason("   ") == "Unknown error"


def test_meta_error_codes_that_mean_the_token_is_no_longer_good() -> None:
    for bad in (190, 102, 463, 467):
        assert sync_health.is_token_problem(bad)
    for other in (None, 4, 17, 100, 613):
        assert not sync_health.is_token_problem(other)


# ---- recording -------------------------------------------------------------


def test_a_failure_is_stored_with_its_source_code_and_scrubbed_reason(
    client: TestClient,
) -> None:
    business_id = _business(client)
    error = MetaConnectionError(
        "Meta API call to /act_1 failed: Invalid OAuth access token", code=190
    )

    _run(
        client,
        lambda: sync_health.record_sync_failure(business_id, "collection", error),
    )

    row = _run(client, _row, business_id)
    assert row.syncFailureSource == "collection"
    assert row.syncFailureCode == 190
    assert row.syncFailureReason == (
        "Meta API call to /act_1 failed: Invalid OAuth access token"
    )
    assert row.syncFailedAt is not None
    assert abs(datetime.now(UTC) - row.syncFailedAt) < timedelta(minutes=1)


def test_a_failure_that_is_not_from_meta_has_no_code(client: TestClient) -> None:
    business_id = _business(client)

    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "reconcile", ValueError("boom")
        ),
    )

    source, code, reason = _run(client, _failure, business_id)
    assert (source, code) == ("reconcile", None)
    assert reason == "ValueError: boom"


def test_recording_for_a_business_without_a_connection_does_nothing(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("x")
        ),
    )  # must not raise


# ---- clearing and priority -------------------------------------------------


def test_a_job_clears_only_its_own_failure(client: TestClient) -> None:
    business_id = _business(client)
    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("down", code=190)
        ),
    )

    _run(client, lambda: sync_health.clear_sync_failure(business_id, "reconcile"))
    assert _run(client, _failure, business_id)[0] == "collection"

    _run(client, lambda: sync_health.clear_sync_failure(business_id, "collection"))
    assert _run(client, _failure, business_id) == (None, None, None)
    assert _run(client, _row, business_id).syncFailedAt is None


def test_the_spend_checks_failure_does_not_hide_the_collectors(
    client: TestClient,
) -> None:
    business_id = _business(client)
    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("collector down", code=190)
        ),
    )

    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "reconcile", MetaConnectionError("check down", code=190)
        ),
    )

    source, _, reason = _run(client, _failure, business_id)
    assert source == "collection"
    assert reason == "collector down"


def test_the_collectors_failure_replaces_the_spend_checks(client: TestClient) -> None:
    business_id = _business(client)
    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "reconcile", MetaConnectionError("check down")
        ),
    )

    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("collector down")
        ),
    )

    assert _run(client, _failure, business_id)[0] == "collection"


def test_a_repeated_failure_updates_the_time_and_reason(client: TestClient) -> None:
    business_id = _business(client)
    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("first", code=4)
        ),
    )
    first = _run(client, _row, business_id).syncFailedAt

    _run(
        client,
        lambda: sync_health.record_sync_failure(
            business_id, "collection", MetaConnectionError("second", code=190)
        ),
    )

    row = _run(client, _row, business_id)
    assert (row.syncFailureReason, row.syncFailureCode) == ("second", 190)
    assert first is not None and row.syncFailedAt is not None
    assert row.syncFailedAt >= first


@pytest.mark.parametrize("source", ["collection", "reconcile"])
def test_clearing_when_nothing_failed_does_nothing(
    client: TestClient, source: SyncSource
) -> None:
    business_id = _business(client)

    _run(client, lambda: sync_health.clear_sync_failure(business_id, source))

    assert _run(client, _failure, business_id) == (None, None, None)


# ---- what the user is told --------------------------------------------------


def test_a_bad_token_is_explained_as_needing_a_reconnect() -> None:
    text = sync_health.friendly_reason(190, "Meta API call to /x failed: Invalid OAuth")

    assert "no longer accepts your connection" in text
    assert "Invalid OAuth" not in text


def test_rate_limits_and_network_problems_say_it_will_retry() -> None:
    limited = sync_health.friendly_reason(4, "Application request limit reached")
    unreachable = sync_health.friendly_reason(None, "Meta API call failed: timed out")

    assert "limiting requests" in limited and "try again automatically" in limited
    assert "couldn’t reach Meta" in unreachable
    assert "try again automatically" in unreachable


def test_any_other_failure_shows_metas_own_words() -> None:
    text = sync_health.friendly_reason(100, "Meta API call to /x failed: Bad field")

    assert text == "Meta API call to /x failed: Bad field"
