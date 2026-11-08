"""The Meta connection's expiry warning (app/services/connection_expiry.py).

A Meta token lasts about 60 days and can only be renewed by signing in to Meta
again, so the app warns from 14 days out. The status is worked out on the server
with the server's clock, and the connection endpoint returns it with the days left.
"""

from datetime import UTC, datetime, timedelta

import pytest
from app.core.crypto import encrypt_token
from app.services import connection_expiry as expiry
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_optimization_jobs import _create_business, _run, _signed_up_client

NOW = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)


def test_the_warning_starts_14_days_before_expiry() -> None:
    assert expiry.EXPIRY_WARNING_DAYS == 14


@pytest.mark.parametrize(
    ("remaining", "status", "days"),
    [
        (timedelta(days=60), "ok", 60),
        (timedelta(days=14, seconds=1), "ok", 14),
        (timedelta(days=14), "expiring_soon", 14),
        (timedelta(days=13, hours=5), "expiring_soon", 13),
        (timedelta(days=1), "expiring_soon", 1),
        (timedelta(hours=5), "expiring_soon", 0),
        (timedelta(seconds=1), "expiring_soon", 0),
        (timedelta(0), "expired", None),
        (timedelta(hours=-3), "expired", None),
        (timedelta(days=-20), "expired", None),
    ],
)
def test_status_and_days_left(
    remaining: timedelta, status: str, days: int | None
) -> None:
    result = expiry.connection_expiry(NOW + remaining, NOW)

    assert result.status == status
    assert result.days_until_expiry == days


# ---- the connection endpoint -----------------------------------------------


async def _seed_connection(business_id: str, expires_in: timedelta) -> None:
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
                "tokenExpiresAt": datetime.now(UTC) + expires_in,
            }
        )
    finally:
        await seeder.disconnect()


def _connection(client: TestClient, expires_in: timedelta) -> dict[str, object]:
    _signed_up_client(client)
    business_id = _create_business(client)
    _run(client, lambda: _seed_connection(business_id, expires_in))
    response = client.get(f"/businesses/{business_id}/meta")
    assert response.status_code == 200
    body: dict[str, object] = response.json()
    return body


def test_a_fresh_connection_is_ok(client: TestClient) -> None:
    body = _connection(client, timedelta(days=45))

    assert body["expiryStatus"] == "ok"
    assert body["daysUntilExpiry"] == 44 or body["daysUntilExpiry"] == 45


def test_a_connection_expiring_in_ten_days_warns(client: TestClient) -> None:
    body = _connection(client, timedelta(days=10, hours=1))

    assert body["expiryStatus"] == "expiring_soon"
    assert body["daysUntilExpiry"] == 10


def test_an_expired_connection_says_so_and_has_no_days_left(
    client: TestClient,
) -> None:
    body = _connection(client, timedelta(days=-2))

    assert body["expiryStatus"] == "expired"
    assert body["daysUntilExpiry"] is None
    assert "tokenExpiresAt" in body
