"""Starting a research run: refusals, access settings and monthly limits (Phase 7b)."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from app.core.config import get_settings
from app.core.db import db
from app.services import research_access, research_runner
from app.services.research_fakes import fake_fetch
from fastapi.testclient import TestClient

from tests.research_helpers import (
    Scripted,
    brand_turn,
    healthy_script,
    pcall,
    run_to_end,
    setup_business,
    start,
    wait_done,
)


@pytest.fixture
def on(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> Iterator[str]:
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    get_settings.cache_clear()
    scripted = Scripted(healthy_script() * 4)
    monkeypatch.setattr(research_runner, "client_factory", lambda: scripted)
    monkeypatch.setattr(research_runner, "page_fetcher", fake_fetch)

    async def no_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(research_runner, "_sleep", no_sleep)
    yield setup_business(client)
    get_settings.cache_clear()


def _row(business_id: str, **over: Any) -> dict[str, Any]:  # noqa: ANN401
    data: dict[str, Any] = {
        "businessId": business_id,
        "depth": "light",
        "model": "claude-opus-5-5",
        "maxSearches": 6,
        "maxFetches": 8,
        "maxCostUsd": 1.0,
        "promptVersion": "v",
        "promptHash": "h",
    }
    data.update(over)
    return data


def _seed(client: TestClient, business_id: str, **over: Any) -> Any:  # noqa: ANN401
    return pcall(client, db.researchrun.create, data=_row(business_id, **over))


def _set_access(client: TestClient, business_id: str, **kwargs: Any) -> None:  # noqa: ANN401
    pcall(client, research_access.set_access, business_id=business_id, **kwargs)


# --- the flag and the session --------------------------------------------------


def test_start_and_cancel_are_404_while_the_flag_is_off(client: TestClient) -> None:
    business_id = setup_business(client)
    base = f"/businesses/{business_id}/research-runs"
    assert start(client, business_id).status_code == 404
    assert client.post(f"{base}/x/cancel").status_code == 404


def test_start_requires_a_session_and_an_owned_business(
    client: TestClient, on: str
) -> None:
    other = TestClient(client.app)
    assert start(other, on).status_code == 401
    client.post("/auth/logout")
    client.post(
        "/auth/signup",
        json={
            "email": "b@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )
    assert start(client, on).status_code == 404


# --- a successful start --------------------------------------------------------


def test_start_returns_202_with_the_run_and_a_default_cap_from_the_estimate(
    client: TestClient, on: str
) -> None:
    response = start(client, on)
    assert response.status_code == 202
    body = response.json()
    assert body["status"] in ("QUEUED", "RUNNING")
    assert (body["depth"], body["model"]) == ("light", "claude-opus-5-5")
    assert (body["maxSearches"], body["maxFetches"]) == (6, 8)
    estimate = client.post(
        f"/businesses/{on}/research-runs/estimate",
        json={"depth": "light", "model": "claude-opus-5-5"},
    ).json()
    assert body["maxCostUsd"] == estimate["suggestedMaxCostUsd"]
    assert body["promptVersion"] == "avatar_research_v3"
    assert body["extraCompetitorUrls"] == ["https://www.rivalring.com/rings"]
    wait_done(client, on, body["id"])


def test_an_explicit_cap_is_used(client: TestClient, on: str) -> None:
    body = start(client, on, maxCostUsd=2.5).json()
    assert body["maxCostUsd"] == 2.5
    wait_done(client, on, body["id"])


@pytest.mark.parametrize(
    "body",
    [
        {"depth": "huge"},
        {"model": "claude-sonnet-5-5"},
        {"maxCostUsd": 0},
        {"maxCostUsd": -1},
        {"maxCostUsd": 26},
        {"productIds": ["a", "b", "c", "d"]},
        {"competitorUrls": ["https://a.com"] * 6},
    ],
)
def test_start_validates_its_input(
    client: TestClient, on: str, body: dict[str, Any]
) -> None:
    assert start(client, on, **body).status_code == 422


def test_a_product_that_is_not_in_the_business_is_a_404(
    client: TestClient, on: str
) -> None:
    assert start(client, on, productIds=["nope"]).status_code == 404


# --- refusals --------------------------------------------------------------------


def test_a_second_concurrent_run_for_the_business_is_refused(
    client: TestClient, on: str
) -> None:
    _seed(client, on, status="RUNNING", heartbeatAt=datetime.now(UTC))
    response = start(client, on)
    assert response.status_code == 409
    assert "already in progress" in response.json()["detail"]


def test_a_queued_run_also_blocks_a_new_one(client: TestClient, on: str) -> None:
    _seed(client, on, status="QUEUED")
    assert start(client, on).status_code == 409


def test_a_stale_run_is_swept_and_does_not_block(client: TestClient, on: str) -> None:
    stale = _seed(
        client,
        on,
        status="RUNNING",
        heartbeatAt=datetime.now(UTC) - timedelta(minutes=30),
    )
    response = start(client, on)
    assert response.status_code == 202
    wait_done(client, on, response.json()["id"])
    row = pcall(client, db.researchrun.find_unique, where={"id": stale.id})
    assert row.status == "FAILED"
    assert row.stopReason == "stale"


def test_another_business_does_not_block(client: TestClient, on: str) -> None:
    other = client.post(
        "/businesses", json={"name": "Other", "industry": "OTHER"}
    ).json()["id"]
    _seed(client, other, status="RUNNING", heartbeatAt=datetime.now(UTC))
    assert start(client, on).status_code == 202


def test_a_model_the_business_may_not_use_is_refused_with_a_clear_message(
    client: TestClient, on: str
) -> None:
    response = start(client, on, model="claude-fable-5-1")
    assert response.status_code == 403
    detail = response.json()["detail"]
    assert "claude-fable-5-1" in detail
    assert "not enabled" in detail


def test_the_estimate_refuses_a_model_the_business_may_not_use(
    client: TestClient, on: str
) -> None:
    response = client.post(
        f"/businesses/{on}/research-runs/estimate",
        json={"depth": "light", "model": "claude-fable-5-1"},
    )
    assert response.status_code == 403


def test_an_enabled_premium_model_can_run(client: TestClient, on: str) -> None:
    _set_access(client, on, models=["claude-opus-5-5", "claude-fable-5-1"])
    run = run_to_end(client, on, model="claude-fable-5-1")
    assert run["model"] == "claude-fable-5-1"


def test_a_run_over_the_monthly_limit_is_refused_with_a_clear_message(
    client: TestClient, on: str
) -> None:
    assert run_to_end(client, on)["status"] == "NEEDS_REVIEW"
    response = start(client, on)
    assert response.status_code == 429
    detail = response.json()["detail"]
    assert "monthly limit" in detail
    assert "1 of 1" in detail


def test_raising_the_limit_allows_another_run(client: TestClient, on: str) -> None:
    run_to_end(client, on)
    _set_access(client, on, runs_per_month=2)
    assert run_to_end(client, on)["status"] == "NEEDS_REVIEW"
    assert start(client, on).status_code == 429


def test_a_limit_of_zero_blocks_every_run(client: TestClient, on: str) -> None:
    _set_access(client, on, runs_per_month=0)
    assert start(client, on).status_code == 429


def test_runs_that_spent_nothing_do_not_use_up_the_month(
    client: TestClient, on: str
) -> None:
    _seed(client, on, status="FAILED", costUsd=0.0, error="never started")
    _seed(client, on, status="CANCELED", costUsd=0.0)
    assert start(client, on).status_code == 202


def test_a_failed_run_never_counts_even_if_it_spent_money(
    client: TestClient, on: str
) -> None:
    # A FAILED run delivered nothing: a bug, a provider error or a cap-guard
    # misfire is the system's fault, not the business's (decided 2026-11-03).
    _seed(client, on, status="FAILED", costUsd=0.96, stopReason="cap", error="x")
    assert start(client, on).status_code == 202


def test_a_completed_run_counts(client: TestClient, on: str) -> None:
    _seed(client, on, status="NEEDS_REVIEW", costUsd=0.5)
    assert start(client, on).status_code == 429


def test_a_run_canceled_after_spending_counts(client: TestClient, on: str) -> None:
    _seed(client, on, status="CANCELED", costUsd=0.3, stopReason="canceled")
    assert start(client, on).status_code == 429


def test_a_run_in_progress_counts(client: TestClient, on: str) -> None:
    _seed(client, on, status="RUNNING", heartbeatAt=datetime.now(UTC))
    assert start(client, on).status_code == 409  # one at a time, before the limit


def test_the_estimate_does_not_count_failed_runs(client: TestClient, on: str) -> None:
    _seed(client, on, status="FAILED", costUsd=0.96, stopReason="cap", error="x")
    body = client.post(
        f"/businesses/{on}/research-runs/estimate",
        json={"depth": "light", "model": "claude-opus-5-5"},
    ).json()
    assert (body["runsUsed"], body["runsRemaining"]) == (0, 1)


def test_after_a_system_failure_that_spent_money_the_business_can_run_again(
    client: TestClient, on: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    scripted = Scripted([brand_turn(), RuntimeError("bug"), *healthy_script()])
    monkeypatch.setattr(research_runner, "client_factory", lambda: scripted)
    failed = run_to_end(client, on)
    assert failed["status"] == "FAILED"
    assert failed["costUsd"] > 0
    assert failed["stopReason"] == "system_error"
    second = run_to_end(client, on)
    assert second["status"] == "NEEDS_REVIEW"
    assert start(client, on).status_code == 429  # the completed run now uses the month


def test_last_months_runs_do_not_count(client: TestClient, on: str) -> None:
    now = datetime.now(UTC)
    first_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    _seed(
        client,
        on,
        status="NEEDS_REVIEW",
        costUsd=1.0,
        createdAt=first_of_month - timedelta(days=1),
    )
    assert start(client, on).status_code == 202


def test_missing_api_key_is_a_clear_503_and_creates_no_run(
    client: TestClient, on: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(research_runner, "client_factory", None)
    response = start(client, on)
    assert response.status_code == 503
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]
    assert client.get(f"/businesses/{on}/research-runs").json() == []


def test_under_fake_llm_the_canned_run_completes_without_any_client(
    client: TestClient, on: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(research_runner, "client_factory", None)
    monkeypatch.setattr(research_runner, "page_fetcher", None)
    monkeypatch.setenv("FAKE_LLM", "1")
    get_settings.cache_clear()
    run = run_to_end(client, on)
    assert run["status"] == "NEEDS_REVIEW"
    assert len(run["findings"]["problems"]) == 20
    assert len(run["findings"]["avatars"]) == 5
    assert run["findings"]["quotes"]["verified"] == 4
    assert run["evidenceLevel"] == "OK"


# --- estimate extras -------------------------------------------------------------


def test_the_estimate_reports_access_limits_and_readiness(
    client: TestClient, on: str
) -> None:
    body = client.post(
        f"/businesses/{on}/research-runs/estimate",
        json={"depth": "light", "model": "claude-opus-5-5"},
    ).json()
    assert body["allowedModels"] == ["claude-opus-5-5"]
    assert (body["runsPerMonth"], body["runsUsed"], body["runsRemaining"]) == (1, 0, 1)
    fields = {item["field"]: item["empty"] for item in body["readiness"]}
    assert fields == {
        "key_messages": True,
        "customer_problems": True,
        "competitors": True,
        "product_names": True,
        "product_descriptions": True,
    }
    run_to_end(client, on)
    again = client.post(
        f"/businesses/{on}/research-runs/estimate",
        json={"depth": "light", "model": "claude-opus-5-5"},
    ).json()
    assert (again["runsUsed"], again["runsRemaining"]) == (1, 0)


# --- the access settings -----------------------------------------------------------


def test_no_http_route_can_change_the_access_settings(
    client: TestClient, on: str
) -> None:
    for method, path in (
        ("patch", f"/businesses/{on}"),
        ("put", f"/businesses/{on}"),
    ):
        response = getattr(client, method)(
            path,
            json={
                "allowedResearchModels": ["claude-fable-5-1"],
                "researchRunsPerMonth": 99,
            },
        )
        assert response.status_code in (200, 405, 422)
    row = pcall(client, db.business.find_unique, where={"id": on})
    assert json.loads(row.allowedResearchModels) == ["claude-opus-5-5"]
    assert row.researchRunsPerMonth == 1
    assert "allowedResearchModels" not in client.get(f"/businesses/{on}").json()


def test_set_access_validates_and_writes_both_columns(
    client: TestClient, on: str
) -> None:
    _set_access(
        client, on, models=["claude-opus-5-5", "claude-fable-5-1"], runs_per_month=3
    )
    row = pcall(client, db.business.find_unique, where={"id": on})
    assert json.loads(row.allowedResearchModels) == [
        "claude-opus-5-5",
        "claude-fable-5-1",
    ]
    assert row.researchRunsPerMonth == 3
    with pytest.raises(ValueError, match="Unknown research model"):
        pcall(client, research_access.set_access, business_id=on, models=["gpt-9"])
    with pytest.raises(ValueError, match="at least one model"):
        pcall(client, research_access.set_access, business_id=on, models=[])
    with pytest.raises(ValueError, match="0 or more"):
        pcall(client, research_access.set_access, business_id=on, runs_per_month=-1)
    with pytest.raises(ValueError, match="Business not found"):
        pcall(client, research_access.set_access, business_id="nope", runs_per_month=1)
    # a value left out is left alone
    _set_access(client, on, runs_per_month=5)
    row = pcall(client, db.business.find_unique, where={"id": on})
    assert json.loads(row.allowedResearchModels) == [
        "claude-opus-5-5",
        "claude-fable-5-1",
    ]
    assert row.researchRunsPerMonth == 5


def test_a_corrupt_stored_model_list_falls_back_to_the_default(
    client: TestClient, on: str
) -> None:
    pcall(
        client,
        db.business.update,
        where={"id": on},
        data={"allowedResearchModels": "not json"},
    )
    assert start(client, on).status_code == 202
