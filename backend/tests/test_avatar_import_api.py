"""Tests for the avatar import and bulk-save endpoints."""

from collections.abc import Iterator
from typing import Any

import pytest
from app.core.config import get_settings
from app.schemas.buyer_avatar import (
    MAX_BUYER_AVATARS_PER_BUSINESS,
    BuyerAvatarCreateRequest,
)
from app.services import avatar_import
from app.services.avatar_import import AvatarImportError
from fastapi.testclient import TestClient

from tests.test_buyer_avatars import _create_business, _payload, _signed_up_client


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("FAKE_LLM", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _import(business_id: str) -> str:
    return f"/businesses/{business_id}/avatars/import"


def _bulk(business_id: str) -> str:
    return f"/businesses/{business_id}/avatars/bulk"


def _doc(text: str = "Some research.") -> dict[str, str]:
    return {"document": text}


# --- import ---------------------------------------------------------------


def test_import_requires_a_session_and_an_owned_business(client: TestClient) -> None:
    assert client.post(_import("b"), json=_doc()).status_code == 401
    _signed_up_client(client)
    assert client.post(_import("nope"), json=_doc()).status_code == 404


def test_import_404s_for_another_users_business(
    client: TestClient, fake_llm: None
) -> None:
    _signed_up_client(client, "owner@example.com")
    business_id = _create_business(client)
    client.post("/auth/logout")
    _signed_up_client(client, "intruder@example.com")

    assert client.post(_import(business_id), json=_doc()).status_code == 404


def test_import_is_off_unless_enabled(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FAKE_LLM", raising=False)
    monkeypatch.delenv("AVATAR_IMPORT_ENABLED", raising=False)
    get_settings.cache_clear()
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_import(business_id), json=_doc())

    assert response.status_code == 404
    get_settings.cache_clear()


def test_import_works_when_the_flag_is_on(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("FAKE_LLM", raising=False)
    monkeypatch.setenv("AVATAR_IMPORT_ENABLED", "true")
    get_settings.cache_clear()

    async def fake_generate(document: str) -> avatar_import.AvatarImportResult:
        return await _canned()

    monkeypatch.setattr("app.api.buyer_avatar.generate_avatar_drafts", fake_generate)
    _signed_up_client(client)
    business_id = _create_business(client)

    assert client.post(_import(business_id), json=_doc()).status_code == 200
    get_settings.cache_clear()


async def _canned() -> avatar_import.AvatarImportResult:
    return avatar_import.AvatarImportResult(
        drafts=[BuyerAvatarCreateRequest.model_validate(_payload(name="Canned"))],
        warnings=[],
    )


def test_import_returns_drafts_and_saves_nothing(
    client: TestClient, fake_llm: None
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_import(business_id), json=_doc())

    assert response.status_code == 200
    body = response.json()
    assert [d["name"] for d in body["drafts"]] == [
        "Deadline Gift-Giver",
        "Self-Purchaser Collector",
    ]
    assert "primaryProblems" in body["drafts"][0]
    assert body["warnings"] == []
    assert client.get(f"/businesses/{business_id}/avatars").json() == []


def test_import_warns_about_a_name_already_in_the_library(
    client: TestClient, fake_llm: None
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(
        f"/businesses/{business_id}/avatars",
        json=_payload(name="deadline gift-giver"),
    )

    body = client.post(_import(business_id), json=_doc()).json()

    assert len(body["drafts"]) == 2
    assert any("Deadline Gift-Giver" in w and "already" in w for w in body["warnings"])


@pytest.mark.parametrize("document", ["", "   \n  ", "x" * 30_001])
def test_import_rejects_an_empty_or_oversize_document(
    client: TestClient, fake_llm: None, document: str
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    assert client.post(_import(business_id), json=_doc(document)).status_code == 422


def test_import_failure_is_a_502_with_the_reason(
    client: TestClient, fake_llm: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def boom(document: str) -> Any:  # noqa: ANN401
        raise AvatarImportError("The model's answer was too long")

    monkeypatch.setattr("app.api.buyer_avatar.generate_avatar_drafts", boom)
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_import(business_id), json=_doc())

    assert response.status_code == 502
    assert "too long" in response.json()["detail"]


# --- bulk save --------------------------------------------------------------


def test_bulk_requires_a_session_and_an_owned_business(client: TestClient) -> None:
    body = {"avatars": [_payload()]}
    assert client.post(_bulk("b"), json=body).status_code == 401
    _signed_up_client(client)
    assert client.post(_bulk("nope"), json=body).status_code == 404


def test_bulk_saves_every_avatar_after_the_existing_ones(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(f"/businesses/{business_id}/avatars", json=_payload(name="First"))

    response = client.post(
        _bulk(business_id),
        json={"avatars": [_payload(name="Second"), _payload(name="Third")]},
    )

    assert response.status_code == 201
    saved = response.json()
    assert [a["name"] for a in saved] == ["Second", "Third"]
    assert [a["sortOrder"] for a in saved] == [1, 2]
    listed = client.get(f"/businesses/{business_id}/avatars").json()
    assert [a["name"] for a in listed] == ["First", "Second", "Third"]


def test_bulk_over_the_limit_saves_nothing(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    for n in range(MAX_BUYER_AVATARS_PER_BUSINESS - 1):
        client.post(f"/businesses/{business_id}/avatars", json=_payload(name=f"A{n}"))

    response = client.post(
        _bulk(business_id),
        json={"avatars": [_payload(name="X"), _payload(name="Y")]},
    )

    assert response.status_code == 409
    listed = client.get(f"/businesses/{business_id}/avatars").json()
    assert len(listed) == MAX_BUYER_AVATARS_PER_BUSINESS - 1


def test_bulk_with_one_invalid_avatar_saves_nothing(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        _bulk(business_id),
        json={"avatars": [_payload(name="Good"), _payload(name="")]},
    )

    assert response.status_code == 422
    assert client.get(f"/businesses/{business_id}/avatars").json() == []


@pytest.mark.parametrize("count", [0, MAX_BUYER_AVATARS_PER_BUSINESS + 1])
def test_bulk_needs_between_one_and_twelve_avatars(
    client: TestClient, count: int
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_bulk(business_id), json={"avatars": [_payload()] * count})

    assert response.status_code == 422


def test_bulk_saves_in_one_batch_not_an_interactive_transaction(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An interactive transaction expires when SQLite is busy (a full e2e run hit it:
    the commit failed with a 500 and the browser saw "Failed to fetch"). One batch is
    a single quick write and just as atomic, so the endpoint must not open one."""
    from prisma import Prisma

    def no_interactive_transaction(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("bulk save must not open an interactive transaction")

    monkeypatch.setattr(Prisma, "tx", no_interactive_transaction)
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        _bulk(business_id),
        json={"avatars": [_payload(name="One"), _payload(name="Two")]},
    )

    assert response.status_code == 201
    assert [a["name"] for a in response.json()] == ["One", "Two"]
    assert len({a["id"] for a in response.json()}) == 2
    listed = client.get(f"/businesses/{business_id}/avatars").json()
    assert [a["name"] for a in listed] == ["One", "Two"]
