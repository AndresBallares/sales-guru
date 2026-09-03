"""Tests for authentication endpoints."""

from collections.abc import Iterator
from unittest.mock import AsyncMock

import httpx2
import pytest
from app.core.config import get_settings
from app.core.db import db
from fastapi.testclient import TestClient
from prisma.errors import UniqueViolationError


@pytest.fixture
def production_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Run a test as if ENVIRONMENT=production, restoring settings after."""
    monkeypatch.setenv("ENVIRONMENT", "production")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _session_set_cookie(response: httpx2.Response) -> str:
    """Return the raw Set-Cookie header for the session cookie."""
    for raw in response.headers.get_list("set-cookie"):
        if raw.startswith("session="):
            return raw
    raise AssertionError("no session Set-Cookie header found")


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
