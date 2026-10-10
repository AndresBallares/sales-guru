"""Tests for publishing an ad that carries a feed asset and a story asset.

A pair publishes as ONE creative (asset_feed_spec) and one ad, so a creative
test still compares messages, not placements. Single-asset ads keep their
existing paths; those are covered in test_publish.py and test_video_publish.py.
"""

import hashlib
import time
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services.meta import MetaConnectionError
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_test_plan_publish import (
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_placement_assets import (
    PHOTOS_FEED_STORY,
    THREE_PHOTOS,
    THREE_VIDEOS,
    VIDEOS_FEED_STORY,
    Setup,
    campaign_with,
    creatives_url,
    generate,
    seed_class,
    square_url,
    story_url,
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def _hash_by_bytes(mock: AsyncMock) -> None:
    """Make the image-upload mock return a distinct hash per distinct file."""

    async def upload(*, image_data: bytes, **_: Any) -> str:
        return "hash_" + hashlib.sha1(image_data).hexdigest()[:8]

    mock.side_effect = upload


def _approve(client: TestClient, setup: Setup) -> None:
    response = client.post(
        f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/approve"
    )
    assert response.status_code == 200, response.text


def _publish(client: TestClient, setup: Setup) -> Any:
    return client.post(
        f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/publish",
        json={"paused": True},
    )


def _wait_done(client: TestClient, setup: Setup) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        body: dict[str, Any] = client.get(
            f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}"
            "/publish/status"
        ).json()
        if body["state"] in ("DONE", "FAILED"):
            return body
        time.sleep(0.05)
    raise AssertionError("publish job never finished")


def _ready_pair(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    media: list[tuple[str, int, int]],
    fmt: str,
    *,
    ads: int = 3,
) -> Setup:
    """A creative test of `fmt` whose ads each carry the product's feed+story pair."""
    setup = campaign_with(client, monkeypatch, media=media, test_format=fmt)
    created = generate(client, setup)
    for ad in created[:ads]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    _approve(client, setup)
    return setup


# ── Image pairs publish synchronously ────────────────────────


def test_an_image_pair_publishes_as_one_placement_creative(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    _hash_by_bytes(mock_services["upload_ad_image"])
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")

    response = _publish(client, setup)

    assert response.status_code == 200  # photos upload quickly: no background job
    placement = mock_services["create_placement_creative"]
    assert placement.await_count == 3  # three ads, one creative each
    call = placement.await_args_list[0].kwargs
    assert call["feed"].image_hash != call["story"].image_hash
    assert call["feed"].image_hash and call["story"].image_hash
    assert call["feed"].video_id is None
    assert call["link"] == "https://acme.example/ring"
    assert call["cta"] and call["headline"] and call["body_text"]
    mock_services["create_ad_creative"].assert_not_awaited()
    assert mock_services["create_ad"].await_count == 3  # one ad per pair


def test_a_pair_shares_one_copy_across_both_placements(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    ads = {
        a["headline"]: a
        for a in client.get(creatives_url(setup)).json()
        if a["status"] == "SELECTED"
    }

    _publish(client, setup)

    sent = {
        c.kwargs["headline"]: c.kwargs["body_text"]
        for c in mock_services["create_placement_creative"].await_args_list
    }
    assert sent == {h: a["bodyText"] for h, a in ads.items()}


# ── Video pairs: each video uploaded once, in the background job ──


def test_a_video_pair_uploads_each_video_once_and_publishes_one_creative_per_ad(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    mock_services["upload_video"].side_effect = ["meta_video_feed", "meta_video_story"]
    _hash_by_bytes(mock_services["upload_ad_image"])
    setup = _ready_pair(client, monkeypatch, VIDEOS_FEED_STORY, "SINGLE_VIDEO")

    response = _publish(client, setup)
    final = _wait_done(client, setup)

    assert response.status_code == 202  # a video publish runs in the background
    assert final["state"] == "DONE"
    assert mock_services["upload_video"].await_count == 2  # not 6
    assert mock_services["wait_video"].await_count == 2
    assert mock_services["upload_ad_image"].await_count == 2  # one cover per video
    placement = mock_services["create_placement_creative"]
    assert placement.await_count == 3
    for call in placement.await_args_list:
        assert call.kwargs["feed"].video_id == "meta_video_feed"
        assert call.kwargs["story"].video_id == "meta_video_story"
        assert call.kwargs["feed"].thumbnail_hash
        assert call.kwargs["story"].thumbnail_hash
    mock_services["create_video_creative"].assert_not_awaited()


def test_nothing_is_created_on_meta_if_a_pair_video_fails_processing(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    mock_services["wait_video"].side_effect = [None, MetaConnectionError("boom")]
    setup = _ready_pair(client, monkeypatch, VIDEOS_FEED_STORY, "SINGLE_VIDEO")

    _publish(client, setup)
    final = _wait_done(client, setup)

    assert final["state"] == "FAILED"
    assert "boom" in final["error"]
    mock_services["create_campaign"].assert_not_awaited()
    mock_services["create_placement_creative"].assert_not_awaited()


# ── Single-asset ads are untouched ───────────────────────────


def test_an_ad_without_a_story_asset_publishes_exactly_as_before(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1080)],
        test_format="SINGLE_IMAGE",
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    _approve(client, setup)

    response = _publish(client, setup)

    assert response.status_code == 200
    mock_services["create_placement_creative"].assert_not_awaited()
    assert mock_services["create_ad_creative"].await_count == 3


def test_removing_the_story_asset_makes_an_ad_single_asset_again(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=PHOTOS_FEED_STORY, test_format="SINGLE_IMAGE"
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    client.put(story_url(setup, created[0]["id"]), json={"productImageId": None})
    _approve(client, setup)

    _publish(client, setup)

    assert mock_services["create_placement_creative"].await_count == 2
    assert mock_services["create_ad_creative"].await_count == 1


# ── The story asset is locked once published ─────────────────


def test_the_story_asset_cannot_change_after_publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    _publish(client, setup)
    ad = next(
        a for a in client.get(creatives_url(setup)).json() if a["status"] == "SELECTED"
    )

    response = client.put(story_url(setup, ad["id"]), json={"productImageId": None})

    assert response.status_code == 400
    assert "already published" in response.json()["detail"]


# ── The pre-publish guard ────────────────────────────────────


def _blocked(client: TestClient, setup: Setup) -> str:
    response = _publish(client, setup)
    assert response.status_code == 400, response.text
    return str(response.json()["detail"])


def test_publishing_is_blocked_if_the_story_asset_was_deleted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    story = setup.media_ids[1]
    client.delete(
        f"/businesses/{setup.business_id}/products/{setup.product_id}/images/{story}"
    )

    detail = _blocked(client, setup)

    assert "Stories & Reels asset no longer exists" in detail


def test_publishing_is_blocked_if_the_feed_asset_was_deleted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    feed = setup.media_ids[0]
    client.delete(
        f"/businesses/{setup.business_id}/products/{setup.product_id}/images/{feed}"
    )

    detail = _blocked(client, setup)

    assert "feed asset no longer exists" in detail


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_story_asset_is_no_longer_9x16(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    await seed_class(setup.media_ids[1], "FEED")

    detail = _blocked(client, setup)

    assert "Stories & Reels asset must be 9:16" in detail


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_feed_asset_is_not_1x1_or_4x5(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, PHOTOS_FEED_STORY, "SINGLE_IMAGE")
    await seed_class(setup.media_ids[0], "UNCLASSIFIED")

    detail = _blocked(client, setup)

    assert "feed asset must be 1:1 or 4:5" in detail


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_two_assets_differ_in_media_type(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=PHOTOS_FEED_STORY + [("video", 1080, 1920)],
        test_format="SINGLE_IMAGE",
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    _approve(client, setup)
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.creative.update_many(
            where={"campaignId": setup.campaign_id, "status": "SELECTED"},
            data={"storyProductImageId": setup.media_ids[2]},
        )
    finally:
        await seeder.disconnect()

    detail = _blocked(client, setup)

    assert "same media type" in detail


def test_a_story_video_without_a_thumbnail_blocks_publishing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import asyncio

    setup = _ready_pair(client, monkeypatch, VIDEOS_FEED_STORY, "SINGLE_VIDEO")

    async def strip() -> None:
        seeder = Prisma()
        await seeder.connect()
        try:
            await seeder.productimage.update(
                where={"id": setup.media_ids[1]},
                data={"thumbnailData": None, "thumbnailContentType": None},
            )
        finally:
            await seeder.disconnect()

    assert client.portal is not None
    client.portal.call(strip)
    del asyncio

    detail = _blocked(client, setup)

    assert "thumbnail" in detail.lower()


# ── Three assets: feed + story + square ──────────────────────


async def seed_dims(media_id: str, width: int, height: int) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.productimage.update(
            where={"id": media_id}, data={"width": width, "height": height}
        )
    finally:
        await seeder.disconnect()


def test_an_image_ad_with_three_assets_publishes_one_creative_with_all_three(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    _hash_by_bytes(mock_services["upload_ad_image"])
    setup = _ready_pair(client, monkeypatch, THREE_PHOTOS, "SINGLE_IMAGE")

    response = _publish(client, setup)

    assert response.status_code == 200
    placement = mock_services["create_placement_creative"]
    assert placement.await_count == 3
    call = placement.await_args_list[0].kwargs
    hashes = {
        call["feed"].image_hash,
        call["story"].image_hash,
        call["square"].image_hash,
    }
    assert len(hashes) == 3 and None not in hashes
    mock_services["create_ad_creative"].assert_not_awaited()
    assert mock_services["create_ad"].await_count == 3  # still one ad per ad


def test_three_videos_are_each_uploaded_once_across_all_the_ads(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    mock_services["upload_video"].side_effect = ["v_feed", "v_story", "v_square"]
    setup = _ready_pair(client, monkeypatch, THREE_VIDEOS, "SINGLE_VIDEO")

    response = _publish(client, setup)
    final = _wait_done(client, setup)

    assert response.status_code == 202
    assert final["state"] == "DONE"
    assert mock_services["upload_video"].await_count == 3  # not 9
    assert mock_services["wait_video"].await_count == 3
    assert mock_services["upload_ad_image"].await_count == 3  # one cover per video
    for call in mock_services["create_placement_creative"].await_args_list:
        assert call.kwargs["feed"].video_id == "v_feed"
        assert call.kwargs["story"].video_id == "v_story"
        assert call.kwargs["square"].video_id == "v_square"


def test_a_feed_and_square_ad_without_a_story_asset_still_publishes_as_a_pair(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1080)],
        test_format="SINGLE_IMAGE",
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
        client.put(
            square_url(setup, ad["id"]),
            json={"productImageId": setup.media_ids[1]},
        )
    _approve(client, setup)

    response = _publish(client, setup)

    assert response.status_code == 200
    call = mock_services["create_placement_creative"].await_args_list[0].kwargs
    assert call["story"] is None
    assert call["square"].image_hash
    mock_services["create_ad_creative"].assert_not_awaited()


def test_removing_the_square_asset_returns_to_a_two_asset_ad(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=THREE_PHOTOS, test_format="SINGLE_IMAGE"
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    client.put(square_url(setup, created[0]["id"]), json={"productImageId": None})
    _approve(client, setup)

    _publish(client, setup)

    calls = mock_services["create_placement_creative"].await_args_list
    assert sum(1 for c in calls if c.kwargs["square"] is None) == 1
    assert sum(1 for c in calls if c.kwargs["square"] is not None) == 2


def test_the_square_asset_is_locked_after_publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    setup = _ready_pair(client, monkeypatch, THREE_PHOTOS, "SINGLE_IMAGE")
    _publish(client, setup)
    ad = next(
        a for a in client.get(creatives_url(setup)).json() if a["status"] == "SELECTED"
    )

    response = client.put(square_url(setup, ad["id"]), json={"productImageId": None})

    assert response.status_code == 400
    assert "already published" in response.json()["detail"]


def test_publishing_is_blocked_if_the_square_asset_was_deleted(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, THREE_PHOTOS, "SINGLE_IMAGE")
    square = setup.media_ids[2]
    client.delete(
        f"/businesses/{setup.business_id}/products/{setup.product_id}/images/{square}"
    )

    assert "Square asset no longer exists" in _blocked(client, setup)


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_square_asset_is_no_longer_1x1(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, THREE_PHOTOS, "SINGLE_IMAGE")
    await seed_dims(setup.media_ids[2], 1080, 1350)

    assert "Square asset must be 1:1" in _blocked(client, setup)


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_square_asset_is_the_feed_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, THREE_PHOTOS, "SINGLE_IMAGE")
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.creative.update_many(
            where={"campaignId": setup.campaign_id, "status": "SELECTED"},
            data={"squareProductImageId": setup.media_ids[0]},
        )
    finally:
        await seeder.disconnect()

    assert "Square asset must be different from the feed asset" in _blocked(
        client, setup
    )


@pytest.mark.asyncio
async def test_publishing_is_blocked_if_the_square_asset_differs_in_media_type(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=THREE_PHOTOS + [("video", 1080, 1080)],
        test_format="SINGLE_IMAGE",
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    _approve(client, setup)
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.creative.update_many(
            where={"campaignId": setup.campaign_id, "status": "SELECTED"},
            data={"squareProductImageId": setup.media_ids[3]},
        )
    finally:
        await seeder.disconnect()

    assert "same media type" in _blocked(client, setup)


def test_a_square_video_without_a_thumbnail_blocks_publishing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = _ready_pair(client, monkeypatch, THREE_VIDEOS, "SINGLE_VIDEO")

    async def strip() -> None:
        seeder = Prisma()
        await seeder.connect()
        try:
            await seeder.productimage.update(
                where={"id": setup.media_ids[2]},
                data={"thumbnailData": None, "thumbnailContentType": None},
            )
        finally:
            await seeder.disconnect()

    assert client.portal is not None
    client.portal.call(strip)

    detail = _blocked(client, setup)

    assert "Square video has no thumbnail" in detail
