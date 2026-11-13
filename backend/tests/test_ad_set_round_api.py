"""The round screen's API for ad-set rounds.

Overview, launch summary, choosing winners and ending a round early.

Meta is always mocked.
"""

from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_ad_set_round_publish import (
    _all_ad_sets,
    _finish_rounds,
    _published_round_one,
    _round_two_ready,
)
from tests.test_creative_rounds import (
    _base,
    _new_round,
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_data_driven_rounds import (
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_round_publish import (
    _publish_round,
    _round_with,
    post_mocks,  # noqa: F401  (fixture, must be in this namespace)
)


def _url(campaign_id: str, business_id: str, tail: str) -> str:
    return f"{_base(campaign_id, business_id)}/rounds{tail}"


# --- the overview -----------------------------------------------------------


def test_the_overview_lists_each_rounds_ad_sets_ads_dates_and_budget(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)

    body = client.get(_url(campaign_id, business_id, "/overview")).json()

    assert body["maxRounds"] == 3
    assert body["nextRoundProblem"].startswith("Round 1 is still running")
    [round_one] = body["rounds"]
    assert round_one["number"] == 1
    [ad_set] = round_one["adSets"]
    assert (ad_set["dailyBudget"], ad_set["isWinners"]) == (100.0, False)
    assert ad_set["startDate"] and ad_set["endDate"]
    assert len(ad_set["ads"]) == 4
    assert ad_set["spend"] == 0.0


@pytest.mark.asyncio
async def test_the_overview_shows_the_winners_ad_set_and_what_each_ad_carried(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    _publish_round(client, business_id, campaign_id, round_["id"])

    body = client.get(_url(campaign_id, business_id, "/overview")).json()

    round_two = next(r for r in body["rounds"] if r["number"] == 2)
    new_set, winners_set = round_two["adSets"]
    assert (new_set["isWinners"], new_set["dailyBudget"]) == (False, 100.0)
    assert (winners_set["isWinners"], winners_set["dailyBudget"]) == (True, 50.0)
    assert {a["carriedFromRound"] for a in winners_set["ads"]} == {1}
    assert all(a["carriedFromRound"] is None for a in new_set["ads"])
    assert body["nextRoundProblem"].startswith("Round 2 is still running")


# --- the launch summary -------------------------------------------------------


@pytest.mark.asyncio
async def test_the_launch_summary_shows_both_budgets_and_the_winners(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)

    summary = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    )

    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body["restartsCampaign"] is False
    assert (body["newAdSet"]["dailyBudget"], body["newAdSet"]["adCount"]) == (100.0, 4)
    assert body["winnersAdSet"]["dailyBudget"] == 50.0
    assert len(body["winnerCandidates"]) == 4
    assert all(w["chosen"] for w in body["winnerCandidates"])
    assert (body["dailyTotal"], body["plannedMax"], body["durationDays"]) == (
        150.0,
        1500.0,
        10,
    )
    assert body["needsChoice"] is False


@pytest.mark.asyncio
async def test_the_summary_says_when_publishing_restarts_a_paused_campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    client.post(f"{_base(campaign_id, business_id)}/pause")
    await _finish_rounds(campaign_id)
    round_ = _round_with(client, business_id, campaign_id, select=4)

    body = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    ).json()

    assert body["restartsCampaign"] is True


@pytest.mark.asyncio
async def test_with_no_active_ads_the_summary_has_no_winners_ad_set(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)
    mock_services["object_status"].return_value = "PAUSED"

    body = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    ).json()

    assert body["winnersAdSet"] is None
    assert (body["dailyTotal"], body["plannedMax"]) == (100.0, 1000.0)


# --- choosing winners ---------------------------------------------------------


async def _round_three_ready(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> tuple[str, str, dict[str, Any]]:
    """Round 2 published with four carried winners; round 3 started: eight active."""
    business_id, campaign_id, round_two = await _round_two_ready(client, monkeypatch)
    assert (
        _publish_round(client, business_id, campaign_id, round_two["id"]).status_code
        == 200
    )
    await _finish_rounds(campaign_id)
    return (
        business_id,
        campaign_id,
        _round_with(client, business_id, campaign_id, select=4),
    )


@pytest.mark.asyncio
async def test_more_than_four_active_ads_need_the_user_to_choose(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_three_ready(client, monkeypatch)

    summary = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    ).json()
    refused = _publish_round(client, business_id, campaign_id, round_["id"])

    assert summary["needsChoice"] is True
    assert len(summary["winnerCandidates"]) == 8
    assert not any(w["chosen"] for w in summary["winnerCandidates"])
    assert summary["maxWinners"] == 4
    assert refused.status_code == 400
    assert "at most 4" in refused.json()["detail"]


@pytest.mark.asyncio
async def test_the_chosen_winners_are_the_ones_carried_into_round_three(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_three_ready(client, monkeypatch)
    summary = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    ).json()
    by_round: dict[int, list[str]] = {}
    for w in summary["winnerCandidates"]:
        by_round.setdefault(w["firstRound"], []).append(w["creativeId"])
    picks = by_round[1][:2] + by_round[2][:2]  # winners of round 1 and round 2

    chosen = client.put(
        _url(campaign_id, business_id, f"/{round_['id']}/winners"),
        json={"creativeIds": picks},
    )
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["needsChoice"] is False
    post_mocks["reuse_post"].reset_mock()
    published = _publish_round(client, business_id, campaign_id, round_["id"])

    assert published.status_code == 200, published.text
    assert post_mocks["reuse_post"].await_count == 4
    db = Prisma()
    await db.connect()
    try:
        where: Any = {"roundId": round_["id"], "carriedFromCreativeId": {"not": None}}
        carried = await db.creative.find_many(where=where)
    finally:
        await db.disconnect()
    assert sorted(c.carriedFromRound for c in carried if c.carriedFromRound) == [
        1,
        1,
        2,
        2,
    ]
    # Three rounds, a winners ad set from round 2 on: $1,000 + $1,500 + $1,500.
    assert [(r.packNumber, r.isWinners) for r in await _all_ad_sets(campaign_id)] == [
        (1, False),
        (2, False),
        (2, True),
        (3, False),
        (3, True),
    ]


@pytest.mark.asyncio
async def test_a_pick_of_more_than_four_or_of_an_inactive_ad_is_refused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_three_ready(client, monkeypatch)
    summary = client.get(
        _url(campaign_id, business_id, f"/{round_['id']}/launch-summary")
    ).json()
    ids = [w["creativeId"] for w in summary["winnerCandidates"]]
    url = _url(campaign_id, business_id, f"/{round_['id']}/winners")

    too_many = client.put(url, json={"creativeIds": ids[:5]})
    unknown = client.put(url, json={"creativeIds": ["nope"]})

    assert too_many.status_code == 400
    assert "at most 4" in too_many.json()["detail"]
    assert unknown.status_code == 400


# --- restarting a paused campaign ----------------------------------------------


@pytest.mark.asyncio
async def test_a_paused_campaign_is_only_restarted_after_the_user_confirms(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    client.post(f"{_base(campaign_id, business_id)}/pause")
    await _finish_rounds(campaign_id)
    round_ = _round_with(client, business_id, campaign_id, select=4)
    mock_services["create_ad_set"].reset_mock()

    refused = _publish_round(client, business_id, campaign_id, round_["id"])

    assert refused.status_code == 409
    for text in ("$100/day", "$50/day", "$150/day", "$1,500", "10 days"):
        assert text in refused.json()["detail"]
    assert mock_services["create_ad_set"].await_count == 0

    ok = _publish_round(
        client, business_id, campaign_id, round_["id"], confirmRestart=True
    )

    assert ok.status_code == 200, ok.text
    assert mock_services["resume_campaign"].await_count == 1
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    campaign = next(c for c in campaigns if c["id"] == campaign_id)
    assert campaign["status"] == "LIVE"
    assert campaign["pausedReason"] is None


@pytest.mark.asyncio
async def test_a_live_campaign_needs_no_confirmation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)

    response = _publish_round(client, business_id, campaign_id, round_["id"])

    assert response.status_code == 200
    assert mock_services["resume_campaign"].await_count == 0


@pytest.mark.asyncio
async def test_a_round_cannot_be_published_paused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, round_ = await _round_two_ready(client, monkeypatch)

    response = _publish_round(
        client, business_id, campaign_id, round_["id"], paused=True
    )

    assert response.status_code == 400
    assert "live" in response.json()["detail"].lower()


# --- ending a round early -------------------------------------------------------


def test_ending_a_round_early_needs_a_confirmation(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)

    response = client.post(
        _url(campaign_id, business_id, "/end-early"), json={"confirmed": False}
    )

    assert response.status_code == 400
    assert mock_services["pause_ad_set"].await_count == 0


@pytest.mark.asyncio
async def test_ending_a_round_early_pauses_it_and_unlocks_the_next(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    before = datetime.now(UTC)

    response = client.post(
        _url(campaign_id, business_id, "/end-early"), json={"confirmed": True}
    )

    assert response.status_code == 200, response.text
    assert mock_services["pause_ad_set"].await_count == 1
    [row] = await _all_ad_sets(campaign_id)
    assert row.endDate is not None and before <= row.endDate <= datetime.now(UTC)
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    campaign = next(c for c in campaigns if c["id"] == campaign_id)
    assert campaign["status"] == "PAUSED"
    assert "Round 1 ended early" in campaign["pausedReason"]
    assert _new_round(client, business_id, campaign_id).status_code == 201


@pytest.mark.asyncio
async def test_a_round_that_has_already_finished_cannot_be_ended_early(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    await _finish_rounds(campaign_id)

    response = client.post(
        _url(campaign_id, business_id, "/end-early"), json={"confirmed": True}
    )

    assert response.status_code == 409
    assert "already finished" in response.json()["detail"]
