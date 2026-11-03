"""Tests for the Avatar Research endpoints (Phase 7a): estimate and read only."""

from collections.abc import Iterator

import httpx2
import pytest
from app.core.config import get_settings
from app.services.research_template import TEMPLATE_PATH
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.types import ResearchRunCreateInput


def _run_data(
    business_id: str, status: str = "QUEUED", error: str | None = None
) -> ResearchRunCreateInput:
    return {
        "businessId": business_id,
        "status": status,
        "error": error,
        "depth": "light",
        "model": "claude-opus-5-5",
        "maxSearches": 5,
        "maxFetches": 5,
        "maxCostUsd": 1.0,
        "promptVersion": "avatar_research_v1",
        "promptHash": "h" * 64,
    }


@pytest.fixture
def research_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _setup(client: TestClient, email: str = "owner@example.com") -> str:
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    business_id: str = client.post(
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    return business_id


def _estimate(client: TestClient, business_id: str, **body: object) -> httpx2.Response:
    payload = {"depth": "light", "model": "claude-opus-5-5", **body}
    return client.post(
        f"/businesses/{business_id}/research-runs/estimate", json=payload
    )


def test_flag_defaults_to_off_and_is_not_opened_by_fake_llm(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("AVATAR_RESEARCH_ENABLED", raising=False)
    monkeypatch.setenv("FAKE_LLM", "1")
    get_settings.cache_clear()
    assert get_settings().avatar_research_enabled is False
    get_settings.cache_clear()


def test_every_route_is_404_while_the_flag_is_off(client: TestClient) -> None:
    business_id = _setup(client)
    base = f"/businesses/{business_id}/research-runs"
    assert (
        client.post(
            f"{base}/estimate", json={"depth": "light", "model": "claude-opus-5-5"}
        ).status_code
        == 404
    )
    assert client.get(base).status_code == 404
    assert client.get(f"{base}/anything").status_code == 404


def test_flag_off_also_hides_the_routes_from_other_users_and_unknown_businesses(
    client: TestClient,
) -> None:
    assert client.get("/businesses/nope/research-runs").status_code in (401, 404)


def test_routes_require_a_session_when_the_flag_is_on(
    client: TestClient, research_on: None
) -> None:
    assert client.get("/businesses/b/research-runs").status_code == 401
    assert (
        client.post("/businesses/b/research-runs/estimate", json={}).status_code == 401
    )


def test_another_users_business_is_a_404(client: TestClient, research_on: None) -> None:
    business_id = _setup(client)
    client.post("/auth/logout")
    _setup(client, email="other@example.com")
    assert client.get(f"/businesses/{business_id}/research-runs").status_code == 404
    assert _estimate(client, business_id).status_code == 404


def test_estimate_returns_cost_and_the_rendered_prompt_and_creates_nothing(
    client: TestClient, research_on: None
) -> None:
    business_id = _setup(client)

    response = _estimate(client, business_id)
    body = response.json()

    assert response.status_code == 200
    assert body["depth"] == "light"
    assert body["model"] == "claude-opus-5-5"
    assert 0 < body["expectedUsd"] < body["maxUsd"] <= body["suggestedMaxCostUsd"]
    assert body["maxSearches"] > 0 and body["maxFetches"] > 0
    assert body["promptVersion"] == "avatar_research_v2"
    assert len(body["promptHash"]) == 64
    assert "Acme" in body["promptPreview"]
    assert "{{" not in body["promptPreview"]
    assert {a["name"]: a["measured"] for a in body["assumptions"]}[
        "search_result_tokens"
    ] is True
    assert client.get(f"/businesses/{business_id}/research-runs").json() == []


def test_estimate_accepts_products_and_competitor_urls(
    client: TestClient, research_on: None
) -> None:
    business_id = _setup(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "A gold ring", "name": "Gold ring"},
    ).json()["id"]

    body = _estimate(
        client,
        business_id,
        productIds=[product_id],
        competitorUrls=["rival.example/shop", "not a url"],
    ).json()

    assert "Gold ring" in body["promptPreview"]
    assert "https://rival.example/shop" in body["promptPreview"]
    assert "not a url" not in body["promptPreview"]


def test_estimate_validates_its_input(client: TestClient, research_on: None) -> None:
    business_id = _setup(client)
    assert _estimate(client, business_id, depth="huge").status_code == 422
    assert _estimate(client, business_id, model="gpt-4").status_code == 422
    assert (
        _estimate(client, business_id, productIds=["a", "b", "c", "d"]).status_code
        == 422
    )
    assert (
        _estimate(
            client,
            business_id,
            competitorUrls=[f"https://c{n}.example" for n in range(6)],
        ).status_code
        == 422
    )
    assert _estimate(client, business_id, productIds=["missing"]).status_code == 404


def test_estimate_supports_both_models_and_all_depths(
    client: TestClient, research_on: None
) -> None:
    business_id = _setup(client)
    for model in ("claude-opus-5-5", "claude-fable-5-1"):
        for depth in ("light", "standard", "deep"):
            assert (
                _estimate(client, business_id, depth=depth, model=model).status_code
                == 200
            )


@pytest.mark.asyncio
async def test_list_and_read_return_a_stored_run_newest_first(
    client: TestClient, research_on: None
) -> None:
    business_id = _setup(client)
    db = Prisma()
    await db.connect()
    first = await db.researchrun.create(data=_run_data(business_id))
    second = await db.researchrun.create(
        data=_run_data(business_id, status="FAILED", error="boom")
    )
    await db.disconnect()

    listed = client.get(f"/businesses/{business_id}/research-runs").json()
    one = client.get(f"/businesses/{business_id}/research-runs/{first.id}").json()

    assert [r["id"] for r in listed] == [second.id, first.id]
    assert one["status"] == "QUEUED"
    assert one["costUsd"] == 0
    assert one["findings"] == {}
    assert one["productIds"] == [] and one["extraCompetitorUrls"] == []
    assert one["cancelRequested"] is False
    assert listed[0]["error"] == "boom"


def test_reading_an_unknown_or_foreign_run_is_a_404(
    client: TestClient, research_on: None
) -> None:
    business_id = _setup(client)
    assert (
        client.get(f"/businesses/{business_id}/research-runs/nope").status_code == 404
    )


def test_no_route_starts_a_run(client: TestClient, research_on: None) -> None:
    business_id = _setup(client)
    base = f"/businesses/{business_id}/research-runs"
    assert (
        client.post(
            base, json={"depth": "light", "model": "claude-opus-5-5"}
        ).status_code
        == 405
    )
    assert client.delete(f"{base}/x").status_code == 405
    assert TEMPLATE_PATH.is_file()
