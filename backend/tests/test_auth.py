"""Tests for authentication endpoints."""

import re
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import httpx2
import pytest
from app.api import auth as auth_module
from app.core.config import get_settings
from app.core.db import db
from app.core.password_reset import _hash_token
from app.services.email import EmailDeliveryError
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.errors import UniqueViolationError


@pytest.fixture
def production_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run a test as if ENVIRONMENT=production, restoring settings after."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def resend_configured(monkeypatch: pytest.MonkeyPatch) -> Iterator[AsyncMock]:
    """Configure RESEND_API_KEY and replace the real send with a mock.

    Yields:
        The AsyncMock standing in for app.services.email.send_email —
        assert on its call_args to inspect what would have been sent.
    """
    monkeypatch.setenv("RESEND_API_KEY", "test-resend-key")
    get_settings.cache_clear()
    mock_send = AsyncMock()
    monkeypatch.setattr(auth_module, "send_email", mock_send)
    yield mock_send
    get_settings.cache_clear()


def _extract_token(mock_send: AsyncMock) -> str:
    """Pull the raw reset token out of the last mocked send's email body."""
    html = mock_send.call_args.kwargs["html"]
    match = re.search(r"token=([\w-]+)", html)
    assert match is not None, f"no token found in email body: {html!r}"
    return match.group(1)


async def _expire_token(token: str) -> None:
    """Force a reset token's expiresAt into the past, via a fresh connection."""
    seeder = Prisma()
    await seeder.connect()
    await seeder.passwordresettoken.update_many(
        where={"tokenHash": _hash_token(token)},
        data={"expiresAt": datetime.now(UTC) - timedelta(minutes=1)},
    )
    await seeder.disconnect()


def _session_set_cookie(response: httpx2.Response) -> str:
    """Return the raw Set-Cookie header for the session cookie."""
    for raw in response.headers.get_list("set-cookie"):
        if raw.startswith("session="):
            return raw
    raise AssertionError("no session Set-Cookie header found")


def _session_token(response: httpx2.Response) -> str:
    """Return just the raw session token value from a login/signup response."""
    raw = _session_set_cookie(response)
    return raw.split(";", 1)[0].split("=", 1)[1]


def test_login_cookie_is_lax_in_development(client: TestClient) -> None:
    """Dev (same-origin localhost) keeps SameSite=Lax and no Secure flag."""
    response = client.post(
        "/auth/signup",
        json={"email": "dev-cookie@example.com", "password": "supersecret123"},
    )

    raw = _session_set_cookie(response)
    assert "samesite=lax" in raw.lower()
    assert "secure" not in raw.lower()


def test_login_cookie_is_none_secure_in_production(
    client: TestClient, production_environment: None
) -> None:
    """Prod (separate Render subdomains) needs SameSite=None; Secure."""
    response = client.post(
        "/auth/signup",
        json={"email": "prod-cookie@example.com", "password": "supersecret123"},
    )

    raw = _session_set_cookie(response)
    assert "samesite=none" in raw.lower()
    assert "secure" in raw.lower()


def test_logout_clears_cookie_with_matching_attrs_in_production(
    client: TestClient, production_environment: None
) -> None:
    """Logout's Set-Cookie (deletion) also uses SameSite=None; Secure in prod."""
    client.post(
        "/auth/signup",
        json={"email": "prod-logout@example.com", "password": "supersecret123"},
    )

    response = client.post("/auth/logout")

    raw = _session_set_cookie(response)
    assert "samesite=none" in raw.lower()
    assert "secure" in raw.lower()


def test_signup_creates_user(client: TestClient) -> None:
    """A new signup returns 201 with the created user's id and email."""
    response = client.post(
        "/auth/signup",
        json={"email": "new@example.com", "password": "supersecret123"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "new@example.com"
    assert "id" in body
    assert "password" not in body
    assert "hashedPassword" not in body


def test_signup_rejects_duplicate_email(client: TestClient) -> None:
    """Signing up twice with the same email returns 409, not a second user."""
    payload = {"email": "dupe@example.com", "password": "supersecret123"}

    first = client.post("/auth/signup", json=payload)
    assert first.status_code == 201

    second = client.post("/auth/signup", json=payload)
    assert second.status_code == 409


def test_signup_lowercases_the_email(client: TestClient) -> None:
    """A mixed-case email is stored (and returned) lowercase."""
    response = client.post(
        "/auth/signup",
        json={"email": "MixedCase@Example.com", "password": "supersecret123"},
    )

    assert response.status_code == 201
    assert response.json()["email"] == "mixedcase@example.com"


def test_signup_rejects_duplicate_email_case_insensitively(client: TestClient) -> None:
    """A different-cased duplicate of an existing email is still rejected."""
    first = client.post(
        "/auth/signup",
        json={"email": "dupe-case@example.com", "password": "supersecret123"},
    )
    assert first.status_code == 201

    second = client.post(
        "/auth/signup",
        json={"email": "Dupe-Case@Example.com", "password": "supersecret123"},
    )
    assert second.status_code == 409


def test_login_matches_regardless_of_email_case(client: TestClient) -> None:
    """Logging in with a different-cased email than used at signup still works."""
    client.post(
        "/auth/signup",
        json={"email": "casetest@example.com", "password": "supersecret123"},
    )
    client.post("/auth/logout")

    response = client.post(
        "/auth/login",
        json={"email": "CaseTest@Example.com", "password": "supersecret123"},
    )

    assert response.status_code == 200
    assert response.json()["email"] == "casetest@example.com"


def test_signup_rejects_short_password(client: TestClient) -> None:
    """A password under the minimum length is rejected with 422."""
    response = client.post(
        "/auth/signup", json={"email": "short@example.com", "password": "short"}
    )

    assert response.status_code == 422


def test_signup_rejects_invalid_email(client: TestClient) -> None:
    """A malformed email is rejected with 422."""
    response = client.post(
        "/auth/signup",
        json={"email": "not-an-email", "password": "supersecret123"},
    )

    assert response.status_code == 422


def test_signup_handles_races_as_409(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A unique-constraint violation at write time still surfaces as 409, not 500."""
    # UserActions uses __slots__, so the mock must replace the class method,
    # not an instance attribute (setattr on the instance would raise).
    monkeypatch.setattr(
        type(db.user), "create", AsyncMock(side_effect=UniqueViolationError({}))
    )

    response = client.post(
        "/auth/signup",
        json={"email": "race@example.com", "password": "supersecret123"},
    )

    assert response.status_code == 409


def test_signup_logs_in_immediately(client: TestClient) -> None:
    """Signup sets a session cookie that /auth/me accepts right away."""
    client.post(
        "/auth/signup",
        json={"email": "auto@example.com", "password": "supersecret123"},
    )

    response = client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["email"] == "auto@example.com"


def test_me_requires_a_session(client: TestClient) -> None:
    """/auth/me with no session cookie returns 401."""
    response = client.get("/auth/me")

    assert response.status_code == 401


def test_login_succeeds_with_correct_credentials(client: TestClient) -> None:
    """Logging in with the right password sets a session and returns the user."""
    payload = {"email": "returning@example.com", "password": "supersecret123"}
    client.post("/auth/signup", json=payload)
    client.post("/auth/logout")

    response = client.post("/auth/login", json=payload)

    assert response.status_code == 200
    assert response.json()["email"] == "returning@example.com"
    assert client.get("/auth/me").status_code == 200


def test_login_rejects_wrong_password(client: TestClient) -> None:
    """Logging in with the wrong password returns 401."""
    client.post(
        "/auth/signup",
        json={"email": "wrongpw@example.com", "password": "supersecret123"},
    )
    client.post("/auth/logout")

    response = client.post(
        "/auth/login",
        json={"email": "wrongpw@example.com", "password": "notthepassword"},
    )

    assert response.status_code == 401


def test_login_rejects_unknown_email(client: TestClient) -> None:
    """Logging in with an email that was never registered returns 401."""
    response = client.post(
        "/auth/login",
        json={"email": "ghost@example.com", "password": "supersecret123"},
    )

    assert response.status_code == 401


def test_logout_invalidates_the_session(client: TestClient) -> None:
    """After logout, the old session cookie no longer authenticates."""
    client.post(
        "/auth/signup",
        json={"email": "loggingout@example.com", "password": "supersecret123"},
    )
    assert client.get("/auth/me").status_code == 200

    client.post("/auth/logout")

    assert client.get("/auth/me").status_code == 401


# --- forgot-password / reset-password ----------------------------------------


def test_forgot_password_requires_resend_to_be_configured(client: TestClient) -> None:
    """With no RESEND_API_KEY set, the endpoint 500s rather than silently no-op."""
    response = client.post(
        "/auth/forgot-password", json={"email": "anyone@example.com"}
    )

    assert response.status_code == 500


def test_forgot_password_sends_an_email_for_a_registered_user(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A real account gets a reset email with a working link."""
    client.post(
        "/auth/signup",
        json={"email": "reset-me@example.com", "password": "supersecret123"},
    )

    response = client.post(
        "/auth/forgot-password", json={"email": "reset-me@example.com"}
    )

    assert response.status_code == 200
    resend_configured.assert_awaited_once()
    assert resend_configured.call_args.kwargs["to"] == "reset-me@example.com"
    assert "reset-password?token=" in resend_configured.call_args.kwargs["html"]


def test_forgot_password_lowercases_the_email(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A mixed-case request still matches the lowercase-stored account."""
    client.post(
        "/auth/signup",
        json={"email": "casematch@example.com", "password": "supersecret123"},
    )

    response = client.post(
        "/auth/forgot-password", json={"email": "CaseMatch@Example.com"}
    )

    assert response.status_code == 200
    resend_configured.assert_awaited_once()


def test_forgot_password_is_silent_for_an_unregistered_email(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """An unknown email gets the same generic response, no email sent —
    nothing distinguishes it from a registered one."""
    response = client.post(
        "/auth/forgot-password", json={"email": "nobody@example.com"}
    )

    assert response.status_code == 200
    resend_configured.assert_not_awaited()


def test_forgot_password_returns_the_generic_message_even_when_send_fails(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A Resend failure doesn't surface — same response either way."""
    resend_configured.side_effect = EmailDeliveryError("boom")
    client.post(
        "/auth/signup",
        json={"email": "send-fails@example.com", "password": "supersecret123"},
    )

    response = client.post(
        "/auth/forgot-password", json={"email": "send-fails@example.com"}
    )

    assert response.status_code == 200


def test_forgot_password_is_rate_limited_after_three_requests(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A 4th request within the hour is silently skipped — still 200, no email."""
    client.post(
        "/auth/signup",
        json={"email": "rate-limited@example.com", "password": "supersecret123"},
    )

    for _ in range(3):
        response = client.post(
            "/auth/forgot-password", json={"email": "rate-limited@example.com"}
        )
        assert response.status_code == 200
    assert resend_configured.await_count == 3

    fourth = client.post(
        "/auth/forgot-password", json={"email": "rate-limited@example.com"}
    )

    assert fourth.status_code == 200
    assert resend_configured.await_count == 3


def test_forgot_password_supersedes_the_previous_token(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """Only the latest requested link works — an earlier one is invalidated
    the moment a new one is issued, not just once the new one is used."""
    client.post(
        "/auth/signup",
        json={"email": "supersede@example.com", "password": "supersecret123"},
    )

    client.post("/auth/forgot-password", json={"email": "supersede@example.com"})
    old_token = _extract_token(resend_configured)

    client.post("/auth/forgot-password", json={"email": "supersede@example.com"})
    new_token = _extract_token(resend_configured)

    old_attempt = client.post(
        "/auth/reset-password",
        json={"token": old_token, "newPassword": "brandnewpassword"},
    )
    assert old_attempt.status_code == 400

    new_attempt = client.post(
        "/auth/reset-password",
        json={"token": new_token, "newPassword": "brandnewpassword"},
    )
    assert new_attempt.status_code == 200


def test_reset_password_updates_the_password(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """The new password works at login afterward; the old one no longer does."""
    client.post(
        "/auth/signup",
        json={"email": "full-reset@example.com", "password": "originalpassword"},
    )
    client.post("/auth/forgot-password", json={"email": "full-reset@example.com"})
    token = _extract_token(resend_configured)

    response = client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "brandnewpassword"},
    )
    assert response.status_code == 200

    old_password_attempt = client.post(
        "/auth/login",
        json={"email": "full-reset@example.com", "password": "originalpassword"},
    )
    assert old_password_attempt.status_code == 401

    new_password_attempt = client.post(
        "/auth/login",
        json={"email": "full-reset@example.com", "password": "brandnewpassword"},
    )
    assert new_password_attempt.status_code == 200


@pytest.mark.asyncio
async def test_reset_password_bumps_updated_at(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """updatedAt moves once a reset is applied through Prisma.

    Reads via a fresh Prisma() connection, not the app's shared `db` —
    TestClient runs the app on its own event loop, so awaiting the
    shared client directly from here (a different loop) breaks.
    """
    signup = client.post(
        "/auth/signup",
        json={"email": "bumps-updated-at@example.com", "password": "supersecret123"},
    )
    user_id = signup.json()["id"]

    seeder = Prisma()
    await seeder.connect()
    before = await seeder.user.find_unique(where={"id": user_id})
    assert before is not None

    client.post("/auth/forgot-password", json={"email": "bumps-updated-at@example.com"})
    token = _extract_token(resend_configured)
    client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "brandnewpassword"},
    )

    after = await seeder.user.find_unique(where={"id": user_id})
    await seeder.disconnect()
    assert after is not None
    assert after.updatedAt > before.updatedAt


def test_reset_password_rejects_an_unknown_token(client: TestClient) -> None:
    """A made-up token is rejected, not silently accepted."""
    response = client.post(
        "/auth/reset-password",
        json={"token": "not-a-real-token", "newPassword": "brandnewpassword"},
    )

    assert response.status_code == 400


@pytest.mark.asyncio
async def test_reset_password_rejects_an_expired_token(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A token past its 1-hour TTL is rejected, even if otherwise unused."""
    client.post(
        "/auth/signup",
        json={"email": "expired-token@example.com", "password": "supersecret123"},
    )
    client.post("/auth/forgot-password", json={"email": "expired-token@example.com"})
    token = _extract_token(resend_configured)
    await _expire_token(token)

    response = client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "brandnewpassword"},
    )

    assert response.status_code == 400


def test_reset_password_rejects_a_replayed_token(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """A token already used once can't be used again."""
    client.post(
        "/auth/signup",
        json={"email": "replay@example.com", "password": "supersecret123"},
    )
    client.post("/auth/forgot-password", json={"email": "replay@example.com"})
    token = _extract_token(resend_configured)

    first = client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "brandnewpassword"},
    )
    assert first.status_code == 200

    replay = client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "anotherpassword"},
    )
    assert replay.status_code == 400


def test_reset_password_rejects_a_short_new_password(client: TestClient) -> None:
    """The new password is held to the same 8-character minimum as signup."""
    response = client.post(
        "/auth/reset-password", json={"token": "irrelevant", "newPassword": "short"}
    )

    assert response.status_code == 422


def test_reset_password_invalidates_every_existing_session(
    client: TestClient, resend_configured: AsyncMock
) -> None:
    """If someone else (or another tab) had the account open, a reset logs
    them out too — not just the browser that requested the reset.

    Simulates "another browser" as a second session token, swapped onto
    the client's own cookie jar between assertions, rather than a second
    TestClient — a second TestClient not opened via its own `with` block
    runs the app on a different event loop than the shared `db`
    connection is bound to.
    """
    signup = client.post(
        "/auth/signup",
        json={"email": "kicks-out@example.com", "password": "supersecret123"},
    )
    session_one = _session_token(signup)
    assert client.get("/auth/me").status_code == 200

    login = client.post(
        "/auth/login",
        json={"email": "kicks-out@example.com", "password": "supersecret123"},
    )
    assert login.status_code == 200
    session_two = _session_token(login)
    assert client.get("/auth/me").status_code == 200

    client.post("/auth/forgot-password", json={"email": "kicks-out@example.com"})
    token = _extract_token(resend_configured)
    client.post(
        "/auth/reset-password",
        json={"token": token, "newPassword": "brandnewpassword"},
    )

    client.cookies.set("session", session_one)
    assert client.get("/auth/me").status_code == 401
    client.cookies.set("session", session_two)
    assert client.get("/auth/me").status_code == 401
