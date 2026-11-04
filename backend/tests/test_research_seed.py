"""The test-only seed for the 7c screens: FAKE_LLM only, costs nothing."""

from collections.abc import Iterator

import httpx2
import pytest
from app.core.config import get_settings
from fastapi.testclient import TestClient

from tests.research_helpers import setup_business


@pytest.fixture
def seeding(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    monkeypatch.setenv("FAKE_LLM", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _seed(client: TestClient, business_id: str, **body: object) -> httpx2.Response:
    return client.post(f"/businesses/{business_id}/research-runs/fake-seed", json=body)


def test_seed_is_a_404_without_fake_llm(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    monkeypatch.delenv("FAKE_LLM", raising=False)
    get_settings.cache_clear()
    try:
        business_id = setup_business(client)
        assert _seed(client, business_id).status_code == 404
    finally:
        get_settings.cache_clear()


def test_seed_is_a_404_while_research_is_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("FAKE_LLM", "1")
    monkeypatch.delenv("AVATAR_RESEARCH_ENABLED", raising=False)
    get_settings.cache_clear()
    try:
        business_id = setup_business(client)
        assert _seed(client, business_id).status_code == 404
    finally:
        get_settings.cache_clear()


def test_seed_creates_a_run_ready_for_review(client: TestClient, seeding: None) -> None:
    business_id = setup_business(client)
    response = _seed(client, business_id)
    assert response.status_code == 201
    run = response.json()
    assert run["status"] == "NEEDS_REVIEW"
    assert run["evidenceLevel"] == "OK"
    findings = run["findings"]
    assert len(findings["problems"]) == 20
    assert len(findings["avatars"]) == 5
    statuses = {
        e["status"]
        for p in findings["problems"]
        for e in p["evidence"]
        if e["kind"] == "quote"
    }
    assert statuses == {"verified", "unverified"}
    assert "Spur" in findings["competitorTerms"]
    assert run["ignoredCompetitorTerms"] == ["Spur"]
    assert run["customerVoiceMinimum"] == 6


def test_seed_can_make_a_low_evidence_run(client: TestClient, seeding: None) -> None:
    business_id = setup_business(client)
    run = _seed(client, business_id, evidence="low").json()
    assert run["evidenceLevel"] == "LOW"
    assert run["evidenceReason"]
    assert run["customerVoiceSources"] < run["customerVoiceMinimum"]


def test_a_seeded_run_can_be_saved_from(client: TestClient, seeding: None) -> None:
    business_id = setup_business(client)
    run = _seed(client, business_id).json()
    avatar = run["findings"]["avatars"][0]
    saved = client.post(
        f"/businesses/{business_id}/avatars/bulk",
        json={
            "avatars": [
                {
                    "name": avatar["name"],
                    "who": avatar["who"],
                    "concepts": avatar["concepts"],
                }
            ],
            "researchRunId": run["id"],
            "researchDraftIndexes": [0],
        },
    )
    assert saved.status_code == 201, saved.text
    after = client.get(f"/businesses/{business_id}/research-runs/{run['id']}").json()
    # Saving leaves the run open; the owner marks it done.
    assert after["status"] == "NEEDS_REVIEW"
    assert after["savedDrafts"][0]["draftIndex"] == 0


def test_seed_needs_a_session(client: TestClient, seeding: None) -> None:
    business_id = setup_business(client)
    client.post("/auth/logout")
    assert _seed(client, business_id).status_code == 401


def test_seed_can_make_a_run_that_is_in_progress(
    client: TestClient, seeding: None
) -> None:
    business_id = setup_business(client)
    run = _seed(client, business_id, status="running").json()
    assert run["status"] == "RUNNING"
    assert run["phase"] == "voice"
    assert run["searchesUsed"] == 4
    assert run["findings"] == {}
    # It has a fresh heartbeat, so reading it does not sweep it to FAILED.
    again = client.get(f"/businesses/{business_id}/research-runs/{run['id']}").json()
    assert again["status"] == "RUNNING"
