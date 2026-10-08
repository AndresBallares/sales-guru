"""Tests for publishing SINGLE_VIDEO ads and the background publish job.

A video publish uploads each distinct video to Meta, waits for it to finish
processing, uploads the thumbnail, and only then creates any campaign object,
so a processing failure never leaves a half-published campaign. Because that
can take minutes, a publish with a video runs as a background job the frontend
polls (GET .../publish/status); an image-only publish stays synchronous.
"""

import asyncio
import time
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services.meta import MetaConnectionError
from fastapi.testclient import TestClient

from tests.test_creative_test_plan_publish import mock_locales  # noqa: F401
from tests.test_publish import mock_services  # noqa: F401
from tests.test_video_ads import (
    _approve,
    _creatives_url,
    _select_all,
    _video_campaign,
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)


def _publish(client: TestClient, business_id: str, campaign_id: str) -> Any:
    return client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish",
        json={"paused": True},
    )


def _status(client: TestClient, business_id: str, campaign_id: str) -> dict[str, Any]:
    body: dict[str, Any] = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish/status"
    ).json()
    return body


def _wait_for(
    client: TestClient, business_id: str, campaign_id: str, states: set[str]
) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        body = _status(client, business_id, campaign_id)
        if body["state"] in states:
            return body
        time.sleep(0.05)
    raise AssertionError(f"publish job never reached {states}: {body}")


def _campaign_status(client: TestClient, business_id: str, campaign_id: str) -> str:
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return str(next(c for c in campaigns if c["id"] == campaign_id)["status"])


def _ready_video_test(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, **kwargs: Any
) -> tuple[str, str, str, list[str]]:
    business_id, campaign_id, product_id, videos, _ = _video_campaign(
        client, monkeypatch, **kwargs
    )
    client.post(_creatives_url(business_id, campaign_id))
    _select_all(client, business_id, campaign_id, count=3)
    _approve(client, business_id, campaign_id)
    return business_id, campaign_id, product_id, videos


# ── Video publish ────────────────────────────────────────────


def test_a_video_test_publishes_paused_through_the_background_job(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)

    response = _publish(client, business_id, campaign_id)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert response.status_code == 202
    assert response.json()["publishing"] is True
    assert final["state"] == "DONE"
    assert _campaign_status(client, business_id, campaign_id) == "PAUSED"
    assert mock_services["create_ad"].await_count == 3


def test_one_video_reused_by_three_ads_is_uploaded_and_processed_once(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)

    _publish(client, business_id, campaign_id)
    _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert mock_services["upload_video"].await_count == 1
    assert mock_services["wait_video"].await_count == 1
    # The thumbnail goes up once too (through the image endpoint).
    assert mock_services["upload_ad_image"].await_count == 1
    assert mock_services["upload_ad_image"].await_args is not None
    upload = mock_services["upload_ad_image"].await_args.kwargs
    assert upload["content_type"] == "image/jpeg"
    # Three ads, each with its own copy, all on the one video.
    creatives = mock_services["create_video_creative"].await_args_list
    assert len(creatives) == 3
    assert {c.kwargs["video_id"] for c in creatives} == {"meta_video_1"}
    assert {c.kwargs["image_hash"] for c in creatives} == {"fake_image_hash_1"}
    assert len({c.kwargs["headline"] for c in creatives}) == 3
    assert all(c.kwargs["link"] == "https://acme.example/ring" for c in creatives)
    mock_services["create_ad_creative"].assert_not_awaited()  # the image path


def test_two_different_videos_are_each_uploaded(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, product_id, videos = _ready_video_test(
        client, monkeypatch, videos=2
    )
    creatives = client.get(_creatives_url(business_id, campaign_id)).json()
    selected = [c for c in creatives if c["status"] == "SELECTED"]
    client.put(
        f"{_creatives_url(business_id, campaign_id)}/{selected[0]['id']}/image",
        json={"productImageId": videos[1]},
    )
    _approve(client, business_id, campaign_id)
    mock_services["upload_video"].side_effect = ["meta_video_a", "meta_video_b"]

    _publish(client, business_id, campaign_id)
    _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert mock_services["upload_video"].await_count == 2
    assert {
        c.kwargs["video_id"]
        for c in mock_services["create_video_creative"].await_args_list
    } == {"meta_video_a", "meta_video_b"}


def test_nothing_is_created_on_meta_until_the_video_is_processed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    order: list[str] = []

    def recorder(label: str, result: Any) -> Any:
        async def record(*_args: Any, **_kwargs: Any) -> Any:
            order.append(label)
            return result

        return record

    for name, label in (
        ("upload_video", "video uploaded"),
        ("wait_video", "video ready"),
        ("upload_ad_image", "thumbnail uploaded"),
        ("create_campaign", "campaign created"),
    ):
        mock_services[name].side_effect = recorder(
            label, mock_services[name].return_value
        )

    _publish(client, business_id, campaign_id)
    _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert order.index("campaign created") > order.index("video ready")
    assert order.index("campaign created") > order.index("thumbnail uploaded")
    assert order.index("video uploaded") < order.index("video ready")


def test_a_video_meta_cannot_process_fails_cleanly_with_nothing_created(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    mock_services["wait_video"].side_effect = MetaConnectionError(
        "Meta could not process the video: Unsupported codec"
    )

    _publish(client, business_id, campaign_id)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert final["state"] == "FAILED"
    assert "Unsupported codec" in final["error"]
    assert _campaign_status(client, business_id, campaign_id) == "FAILED"
    mock_services["create_campaign"].assert_not_awaited()
    mock_services["create_ad"].assert_not_awaited()


def test_a_failed_video_publish_can_be_retried(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    mock_services["wait_video"].side_effect = [
        MetaConnectionError("still processing"),
        None,
    ]

    _publish(client, business_id, campaign_id)
    _wait_for(client, business_id, campaign_id, {"FAILED"})
    retry = _publish(client, business_id, campaign_id)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert retry.status_code == 202
    assert final["state"] == "DONE"
    assert _campaign_status(client, business_id, campaign_id) == "PAUSED"


def test_an_unexpected_error_in_the_job_is_reported_not_swallowed(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    mock_services["upload_video"].side_effect = RuntimeError("boom")

    _publish(client, business_id, campaign_id)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert final["state"] == "FAILED"
    assert "Something went wrong" in final["error"]
    assert _campaign_status(client, business_id, campaign_id) == "FAILED"


def test_a_standard_campaign_publishes_a_single_video_ad(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, standard=True
    )
    created = client.post(
        _creatives_url(business_id, campaign_id), json={"format": "SINGLE_VIDEO"}
    ).json()
    client.post(f"{_creatives_url(business_id, campaign_id)}/{created[0]['id']}/select")
    _approve(client, business_id, campaign_id)

    response = _publish(client, business_id, campaign_id)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert response.status_code == 202
    assert final["state"] == "DONE"
    assert mock_services["upload_video"].await_count == 1
    assert mock_services["create_video_creative"].await_count >= 1
    assert _campaign_status(client, business_id, campaign_id) == "PAUSED"


# ── The background job's status ──────────────────────────────


def test_the_status_shows_processing_with_progress_and_blocks_a_second_publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    release = asyncio.Event()

    async def slow_wait(
        *, access_token: str, video_id: str, on_progress: Any = None, **_: Any
    ) -> None:
        if on_progress is not None:
            on_progress(40)
        await release.wait()

    mock_services["wait_video"].side_effect = slow_wait
    assert client.portal is not None

    first = _publish(client, business_id, campaign_id)
    processing = _wait_for(client, business_id, campaign_id, {"PROCESSING"})
    while processing["progress"] != 40:
        processing = _status(client, business_id, campaign_id)
    second = _publish(client, business_id, campaign_id)
    listed = next(
        c
        for c in client.get(f"/businesses/{business_id}/campaigns").json()
        if c["id"] == campaign_id
    )
    client.portal.call(release.set)
    final = _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})

    assert listed["publishing"] is True  # a reload mid-publish still knows
    assert first.status_code == 202
    assert processing["step"] == "Processing video"
    assert processing["progress"] == 40
    assert processing["elapsedSeconds"] >= 0
    assert second.status_code == 409
    assert final["state"] == "DONE"
    after = next(
        c
        for c in client.get(f"/businesses/{business_id}/campaigns").json()
        if c["id"] == campaign_id
    )
    assert after["publishing"] is False


def test_the_status_is_idle_before_any_publish(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)

    body = _status(client, business_id, campaign_id)

    assert body["state"] == "IDLE"


def test_the_status_404s_for_another_users_campaign(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(client, monkeypatch)
    client.post("/auth/logout")
    from tests.test_publish import _signed_up_client

    _signed_up_client(client, email="mallory@example.com")

    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish/status"
    )

    assert response.status_code == 404


def test_the_status_requires_a_session(client: TestClient) -> None:
    assert client.get("/businesses/b/campaigns/c/publish/status").status_code == 401


def test_an_image_publish_stays_synchronous_and_has_no_job(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, _ = _ready_video_test(
        client, monkeypatch, test_format="SINGLE_IMAGE"
    )
    creatives = client.post(_creatives_url(business_id, campaign_id)).json()
    for creative in creatives[:3]:
        client.post(
            f"{_creatives_url(business_id, campaign_id)}/{creative['id']}/select"
        )
    _approve(client, business_id, campaign_id)

    response = _publish(client, business_id, campaign_id)

    assert response.status_code == 200
    assert _status(client, business_id, campaign_id)["state"] == "IDLE"
    mock_services["upload_video"].assert_not_awaited()


# ── Editing a video ad's video: locking rules match images ───


def test_a_video_ads_video_cannot_change_after_publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _, videos = _ready_video_test(
        client, monkeypatch, videos=2
    )
    _publish(client, business_id, campaign_id)
    _wait_for(client, business_id, campaign_id, {"DONE", "FAILED"})
    creatives = client.get(_creatives_url(business_id, campaign_id)).json()

    response = client.put(
        f"{_creatives_url(business_id, campaign_id)}/{creatives[0]['id']}/image",
        json={"productImageId": videos[1]},
    )

    assert response.status_code == 400
    assert "already published" in response.json()["detail"]


def test_changing_a_selected_video_ads_video_sends_an_approved_test_back_to_pending(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos = _ready_video_test(
        client, monkeypatch, videos=2
    )
    assert _campaign_status(client, business_id, campaign_id) == "APPROVED"
    selected = next(
        c
        for c in client.get(_creatives_url(business_id, campaign_id)).json()
        if c["status"] == "SELECTED"
    )

    response = client.put(
        f"{_creatives_url(business_id, campaign_id)}/{selected['id']}/image",
        json={"productImageId": videos[1]},
    )

    assert response.status_code == 200
    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_changing_one_video_ads_video_leaves_the_other_ads_alone(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos = _ready_video_test(
        client, monkeypatch, videos=2
    )
    creatives = client.get(_creatives_url(business_id, campaign_id)).json()

    client.put(
        f"{_creatives_url(business_id, campaign_id)}/{creatives[0]['id']}/image",
        json={"productImageId": videos[1]},
    )

    after = client.get(_creatives_url(business_id, campaign_id)).json()
    assert after[0]["imageUrl"].endswith(f"{videos[1]}/thumbnail")
    assert after[0]["videoUrl"].endswith(videos[1])
    for other in after[1:]:
        assert other["imageUrl"].endswith(f"{videos[0]}/thumbnail")
        assert other["videoUrl"].endswith(videos[0])
