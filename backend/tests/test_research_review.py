"""Tests for the 7c review endpoints: save from a run, discard, review fields."""

import json
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import httpx2
import pytest
from app.core.config import get_settings
from app.core.db import db
from app.services import research_access
from fastapi.testclient import TestClient
from prisma.types import ResearchRunCreateInput

from tests.research_helpers import pcall, setup_business, sql


@pytest.fixture(autouse=True)
def research_on(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _findings() -> dict[str, Any]:
    return {
        "problems": [],
        "solutions": [],
        "gaps": [],
        "avatars": [{"name": f"Draft {n}"} for n in range(5)],
        "sources": [],
        "competitorTerms": ["Rivalring", "Spur", "Rival Serpent Line", "Cartier"],
        "droppedQuotes": [],
        "warnings": [],
        "quotes": {"verified": 0, "unverified": 0, "dropped": 0},
        "partial": False,
        "phasesVersion": "phases_v2",
    }


async def _make_run(
    business_id: str, status: str = "NEEDS_REVIEW", depth: str = "standard"
) -> str:
    data: ResearchRunCreateInput = {
        "businessId": business_id,
        "status": status,
        "depth": depth,
        "model": "claude-opus-5-5",
        "maxSearches": 15,
        "maxFetches": 20,
        "maxCostUsd": 3.0,
        "costUsd": 1.2,
        "promptVersion": "avatar_research_v3",
        "promptHash": "h" * 64,
        "findings": json.dumps(_findings()),
        "customerVoiceSources": 4,
        "evidenceLevel": "LOW",
        "evidenceReason": "Reached 4 customer-voice sources; a standard run needs 6.",
    }
    run = await db.researchrun.create(data=data)
    return run.id


def _run(client: TestClient, business_id: str, **kw: str) -> str:
    run_id: str = pcall(client, _make_run, business_id=business_id, **kw)
    return run_id


def _avatar(name: str = "The Plain-Gold Loyalist") -> dict[str, object]:
    return {
        "name": name,
        "who": "Wears plain gold every day.",
        "purchaseFor": "self",
        "primaryProblems": ["Fears color is fragile"],
        "mechanisms": ["Ceramic inlay"],
        "hooks": ["The blue stays blue."],
        "concepts": [
            {"name": "The Sanitizer Test", "pillar": "mechanism", "description": "d"}
        ],
    }


def _bulk(
    client: TestClient, business_id: str, avatars: list[dict[str, object]], **extra: Any
) -> httpx2.Response:
    if "researchRunId" in extra and "researchDraftIndexes" not in extra:
        extra["researchDraftIndexes"] = list(range(len(avatars)))
    return client.post(
        f"/businesses/{business_id}/avatars/bulk",
        json={"avatars": avatars, **extra},
    )


def _get(client: TestClient, business_id: str, run_id: str) -> dict[str, Any]:
    body: dict[str, Any] = client.get(
        f"/businesses/{business_id}/research-runs/{run_id}"
    ).json()
    return body


def _status(run_id: str) -> tuple[str, str | None]:
    row = sql('select status, reviewedAt from "ResearchRun" where id = ?', run_id)[0]
    return str(row[0]), row[1]


# --- saving from a run ------------------------------------------------------------


def test_saving_from_a_run_records_the_avatars_and_leaves_the_run_open(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    response = _bulk(
        client, business_id, [_avatar("A"), _avatar("B")], researchRunId=run_id
    )
    assert response.status_code == 201, response.text
    created = response.json()
    assert [a["sourceRunId"] for a in created] == [run_id, run_id]
    status, reviewed_at = _status(run_id)
    assert status == "NEEDS_REVIEW"
    assert reviewed_at is None
    run = _get(client, business_id, run_id)
    assert run["status"] == "NEEDS_REVIEW"
    assert run["reviewedAt"] is None
    assert sorted(run["savedAvatarIds"]) == sorted(a["id"] for a in created)
    assert run["savedDrafts"] == [
        {"draftIndex": 0, "avatarId": created[0]["id"]},
        {"draftIndex": 1, "avatarId": created[1]["id"]},
    ]


def test_save_two_reopen_and_save_a_third(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    first = _bulk(
        client,
        business_id,
        [_avatar("A"), _avatar("C")],
        researchRunId=run_id,
        researchDraftIndexes=[0, 2],
    )
    assert first.status_code == 201
    reopened = _get(client, business_id, run_id)
    assert reopened["status"] == "NEEDS_REVIEW"
    assert [d["draftIndex"] for d in reopened["savedDrafts"]] == [0, 2]
    third = _bulk(
        client,
        business_id,
        [_avatar("B")],
        researchRunId=run_id,
        researchDraftIndexes=[1],
    )
    assert third.status_code == 201, third.text
    run = _get(client, business_id, run_id)
    assert sorted(d["draftIndex"] for d in run["savedDrafts"]) == [0, 1, 2]
    assert len(run["savedAvatarIds"]) == 3


def test_the_same_draft_cannot_be_saved_twice(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    assert (
        _bulk(client, business_id, [_avatar("A")], researchRunId=run_id).status_code
        == 201
    )
    # Even renamed, it is the same draft of the same run.
    again = _bulk(client, business_id, [_avatar("A renamed")], researchRunId=run_id)
    assert again.status_code == 409
    assert "already saved" in again.json()["detail"].lower()
    names = [a["name"] for a in client.get(f"/businesses/{business_id}/avatars").json()]
    assert names == ["A"]


def test_a_repeated_draft_in_one_request_is_refused(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    response = _bulk(
        client,
        business_id,
        [_avatar("A"), _avatar("B")],
        researchRunId=run_id,
        researchDraftIndexes=[1, 1],
    )
    assert response.status_code == 422
    assert client.get(f"/businesses/{business_id}/avatars").json() == []


def test_a_double_submit_that_slips_past_the_check_is_still_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The database refuses a draft saved twice even if two requests overlap."""
    from app.api import buyer_avatar

    business_id = setup_business(client)
    run_id = _run(client, business_id)
    assert (
        _bulk(client, business_id, [_avatar("A")], researchRunId=run_id).status_code
        == 201
    )

    async def nothing_saved_yet(run_id: str, indexes: list[int]) -> set[int]:
        return set()

    monkeypatch.setattr(buyer_avatar, "_already_saved_drafts", nothing_saved_yet)
    second = _bulk(client, business_id, [_avatar("A2")], researchRunId=run_id)
    assert second.status_code == 409
    assert len(client.get(f"/businesses/{business_id}/avatars").json()) == 1


def test_deleting_a_saved_avatar_frees_its_draft(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    created = _bulk(client, business_id, [_avatar("A")], researchRunId=run_id).json()
    assert (
        client.delete(
            f"/businesses/{business_id}/avatars/{created[0]['id']}"
        ).status_code
        == 204
    )
    assert _get(client, business_id, run_id)["savedDrafts"] == []
    again = _bulk(client, business_id, [_avatar("A")], researchRunId=run_id)
    assert again.status_code == 201


def test_draft_indexes_must_match_the_run_and_the_request(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    cases: list[dict[str, Any]] = [
        {"researchRunId": run_id, "researchDraftIndexes": [5]},  # no such draft
        {"researchRunId": run_id, "researchDraftIndexes": [-1]},
        {"researchRunId": run_id, "researchDraftIndexes": [0, 1]},  # wrong length
        {"researchDraftIndexes": [0]},  # indexes without a run
    ]
    for extra in cases:
        assert _bulk(client, business_id, [_avatar()], **extra).status_code == 422
    no_indexes = client.post(
        f"/businesses/{business_id}/avatars/bulk",
        json={"avatars": [_avatar()], "researchRunId": run_id},
    )
    assert no_indexes.status_code == 422
    assert client.get(f"/businesses/{business_id}/avatars").json() == []


def test_saved_concepts_are_kept(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    created = _bulk(client, business_id, [_avatar()], researchRunId=run_id).json()
    assert created[0]["concepts"][0]["slug"]
    assert created[0]["concepts"][0]["pillar"] == "mechanism"


def test_saving_without_a_run_is_unchanged(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    response = _bulk(client, business_id, [_avatar()])
    assert response.status_code == 201
    assert response.json()[0]["sourceRunId"] is None
    assert _status(run_id)[0] == "NEEDS_REVIEW"


@pytest.mark.parametrize(
    "status", ["QUEUED", "RUNNING", "FAILED", "CANCELED", "REVIEWED", "DISCARDED"]
)
def test_only_a_run_in_review_can_be_saved(client: TestClient, status: str) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status=status)
    response = _bulk(client, business_id, [_avatar()], researchRunId=run_id)
    assert response.status_code == 409
    assert client.get(f"/businesses/{business_id}/avatars").json() == []
    assert _status(run_id)[0] == status


def test_saving_after_mark_as_done_says_the_run_is_finished(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    _bulk(client, business_id, [_avatar("A")], researchRunId=run_id)
    client.post(f"/businesses/{business_id}/research-runs/{run_id}/done")
    response = _bulk(
        client,
        business_id,
        [_avatar("B")],
        researchRunId=run_id,
        researchDraftIndexes=[1],
    )
    assert response.status_code == 409
    assert "finished" in response.json()["detail"].lower()


def test_an_unknown_run_or_another_businesses_run_is_a_404(client: TestClient) -> None:
    mine = setup_business(client)
    other = client.post(
        "/businesses", json={"name": "Other", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    others_run = _run(client, other)
    for run_id in ("does-not-exist", others_run):
        response = _bulk(client, mine, [_avatar()], researchRunId=run_id)
        assert response.status_code == 404
    assert client.get(f"/businesses/{mine}/avatars").json() == []
    assert _status(others_run)[0] == "NEEDS_REVIEW"


def test_when_the_library_is_full_nothing_is_written_and_the_run_stays_open(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    for n in range(11):
        assert _bulk(client, business_id, [_avatar(f"Existing {n}")]).status_code == 201
    run_id = _run(client, business_id)
    response = _bulk(
        client, business_id, [_avatar("X"), _avatar("Y")], researchRunId=run_id
    )
    assert response.status_code == 409
    assert _status(run_id)[0] == "NEEDS_REVIEW"
    assert len(client.get(f"/businesses/{business_id}/avatars").json()) == 11
    assert _get(client, business_id, run_id)["savedDrafts"] == []


def test_an_invalid_avatar_writes_nothing_and_the_run_stays_open(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    bad = {**_avatar("Bad"), "hooks": ["x" * 201]}
    response = _bulk(client, business_id, [_avatar("Good"), bad], researchRunId=run_id)
    assert response.status_code == 422
    assert client.get(f"/businesses/{business_id}/avatars").json() == []
    assert _status(run_id)[0] == "NEEDS_REVIEW"


def test_the_saved_avatar_lists_its_source_run_when_read_back(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    _bulk(client, business_id, [_avatar()], researchRunId=run_id)
    listed = client.get(f"/businesses/{business_id}/avatars").json()
    assert listed[0]["sourceRunId"] == run_id


# --- discarding -------------------------------------------------------------------


def test_discard_ends_the_review_and_keeps_the_findings(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    response = client.post(f"/businesses/{business_id}/research-runs/{run_id}/discard")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "DISCARDED"
    assert body["reviewedAt"] is not None
    assert body["findings"]["competitorTerms"]
    assert body["savedAvatarIds"] == []


def test_discard_is_refused_once_something_was_saved(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    _bulk(client, business_id, [_avatar("A")], researchRunId=run_id)
    response = client.post(f"/businesses/{business_id}/research-runs/{run_id}/discard")
    assert response.status_code == 409
    assert "mark" in response.json()["detail"].lower()
    assert _status(run_id)[0] == "NEEDS_REVIEW"


_NOT_IN_REVIEW = ["QUEUED", "RUNNING", "FAILED", "CANCELED", "REVIEWED", "DISCARDED"]


@pytest.mark.parametrize("status", _NOT_IN_REVIEW)
def test_discard_only_works_on_a_run_in_review(client: TestClient, status: str) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status=status)
    response = client.post(f"/businesses/{business_id}/research-runs/{run_id}/discard")
    assert response.status_code == 409
    assert _status(run_id)[0] == status


def test_discard_unknown_run_is_404_and_needs_a_session(client: TestClient) -> None:
    business_id = setup_business(client)
    assert (
        client.post(f"/businesses/{business_id}/research-runs/nope/discard").status_code
        == 404
    )
    client.post("/auth/logout")
    assert (
        client.post(f"/businesses/{business_id}/research-runs/nope/discard").status_code
        == 401
    )


def test_discard_is_a_404_while_the_feature_is_off(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "0")
    get_settings.cache_clear()
    response = client.post(f"/businesses/{business_id}/research-runs/{run_id}/discard")
    assert response.status_code == 404
    assert _status(run_id)[0] == "NEEDS_REVIEW"


# --- marking a review as done ----------------------------------------------------


def _done(client: TestClient, business_id: str, run_id: str) -> httpx2.Response:
    return client.post(f"/businesses/{business_id}/research-runs/{run_id}/done")


def test_mark_as_done_finishes_a_review_and_keeps_the_saved_avatars(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    created = _bulk(
        client, business_id, [_avatar("A"), _avatar("B")], researchRunId=run_id
    ).json()
    response = _done(client, business_id, run_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "REVIEWED"
    assert body["reviewedAt"] is not None
    assert sorted(body["savedAvatarIds"]) == sorted(a["id"] for a in created)
    # Reopening a done run still shows what was saved.
    reopened = _get(client, business_id, run_id)
    assert reopened["status"] == "REVIEWED"
    assert [d["draftIndex"] for d in reopened["savedDrafts"]] == [0, 1]


def test_mark_as_done_needs_a_saved_avatar(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    response = _done(client, business_id, run_id)
    assert response.status_code == 409
    assert "discard" in response.json()["detail"].lower()
    assert _status(run_id)[0] == "NEEDS_REVIEW"


@pytest.mark.parametrize("status", _NOT_IN_REVIEW)
def test_mark_as_done_only_works_on_a_run_in_review(
    client: TestClient, status: str
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status=status)
    assert _done(client, business_id, run_id).status_code == 409
    assert _status(run_id)[0] == status


def test_mark_as_done_unknown_run_is_404_and_needs_a_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    assert _done(client, business_id, "nope").status_code == 404
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "0")
    get_settings.cache_clear()
    assert _done(client, business_id, run_id).status_code == 404
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    get_settings.cache_clear()
    client.post("/auth/logout")
    assert _done(client, business_id, run_id).status_code == 401


# --- reopening a run marked as done -----------------------------------------------


def _reopen(client: TestClient, business_id: str, run_id: str) -> httpx2.Response:
    return client.post(f"/businesses/{business_id}/research-runs/{run_id}/reopen")


def test_reopening_a_done_run_lets_the_owner_save_more(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    _bulk(client, business_id, [_avatar("A")], researchRunId=run_id)
    _done(client, business_id, run_id)
    response = _reopen(client, business_id, run_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "NEEDS_REVIEW"
    assert body["reviewedAt"] is None
    assert [d["draftIndex"] for d in body["savedDrafts"]] == [0]
    assert _status(run_id) == ("NEEDS_REVIEW", None)
    more = _bulk(
        client,
        business_id,
        [_avatar("B")],
        researchRunId=run_id,
        researchDraftIndexes=[1],
    )
    assert more.status_code == 201, more.text


@pytest.mark.parametrize(
    "status",
    ["QUEUED", "RUNNING", "NEEDS_REVIEW", "FAILED", "CANCELED", "DISCARDED"],
)
def test_only_a_done_run_can_be_reopened(client: TestClient, status: str) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status=status)
    assert _reopen(client, business_id, run_id).status_code == 409
    assert _status(run_id)[0] == status


def test_reopen_unknown_run_is_404_off_is_404_and_needs_a_session(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status="REVIEWED")
    assert _reopen(client, business_id, "nope").status_code == 404
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "0")
    get_settings.cache_clear()
    assert _reopen(client, business_id, run_id).status_code == 404
    monkeypatch.setenv("AVATAR_RESEARCH_ENABLED", "1")
    get_settings.cache_clear()
    client.post("/auth/logout")
    assert _reopen(client, business_id, run_id).status_code == 401


def test_reopening_does_not_change_the_monthly_count(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id, status="REVIEWED")
    _reopen(client, business_id, run_id)
    used = pcall(
        client,
        research_access.runs_used_this_month,
        business_id=business_id,
        now=datetime.now(UTC),
    )
    assert used == 1


# --- the monthly limit ------------------------------------------------------------


@pytest.mark.parametrize("status", ["REVIEWED", "DISCARDED"])
def test_a_reviewed_or_discarded_run_still_counts_toward_the_monthly_limit(
    client: TestClient, status: str
) -> None:
    business_id = setup_business(client)
    _run(client, business_id, status=status)
    used = pcall(
        client,
        research_access.runs_used_this_month,
        business_id=business_id,
        now=datetime.now(UTC),
    )
    assert used == 1


# --- fields the review screen reads -----------------------------------------------


def test_saving_and_marking_done_do_not_change_the_monthly_count(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)

    def used() -> int:
        count: int = pcall(
            client,
            research_access.runs_used_this_month,
            business_id=business_id,
            now=datetime.now(UTC),
        )
        return count

    assert used() == 1
    _bulk(client, business_id, [_avatar("A")], researchRunId=run_id)
    assert used() == 1
    _done(client, business_id, run_id)
    assert used() == 1


def test_the_run_reports_the_minimum_customer_voice_sources_for_its_depth(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    for depth, minimum in (("light", 3), ("standard", 6), ("deep", 10)):
        run = _get(client, business_id, _run(client, business_id, depth=depth))
        assert run["customerVoiceMinimum"] == minimum


def test_common_english_words_are_ignored_but_brand_names_stay(
    client: TestClient,
) -> None:
    business_id = setup_business(client)
    run = _get(client, business_id, _run(client, business_id))
    assert run["competitorTerms"] == ["Rivalring", "Rival Serpent Line", "Cartier"]
    assert run["ignoredCompetitorTerms"] == ["Spur"]
    # The stored findings are not rewritten.
    assert "Spur" in run["findings"]["competitorTerms"]


def test_a_run_without_a_review_has_no_saved_avatars(client: TestClient) -> None:
    business_id = setup_business(client)
    run = _get(client, business_id, _run(client, business_id))
    assert run["reviewedAt"] is None
    assert run["savedAvatarIds"] == []


def test_the_list_carries_the_new_fields_too(client: TestClient) -> None:
    business_id = setup_business(client)
    run_id = _run(client, business_id)
    _bulk(client, business_id, [_avatar()], researchRunId=run_id)
    listed = client.get(f"/businesses/{business_id}/research-runs").json()
    assert listed[0]["status"] == "NEEDS_REVIEW"
    assert len(listed[0]["savedAvatarIds"]) == 1
    assert listed[0]["savedDrafts"][0]["draftIndex"] == 0
