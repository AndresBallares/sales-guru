"""Tests for placement asset customization: one ad, a feed asset and a story asset.

A creative's productImageId is its feed asset (1:1 or 4:5); the optional
storyProductImageId is its Stories & Reels (9:16) version, the same media type
(both photos or both videos). Without a story asset an ad is single-asset and
behaves exactly as before. Publishing a pair is in test_placement_publish.py.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import strategy as strategy_module
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.media_fixtures import make_mp4
from tests.test_creative_test_plan_publish import (
    _creative_plan,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_product_image import _valid_jpeg
from tests.test_publish import (
    _FAKE_STRATEGY,
    _FAKE_VARIANTS,
    _connect_meta,
    _create_audience,
    _create_business,
    _signed_up_client,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

_THUMB = _valid_jpeg(360, 640)


@pytest.fixture
def generate_mock(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    mock = AsyncMock(return_value=_FAKE_VARIANTS)
    monkeypatch.setattr(creative_module, "generate_creatives", mock)
    return mock


def upload_photo(
    client: TestClient, business_id: str, product_id: str, width: int, height: int
) -> str:
    response = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("p.jpg", _valid_jpeg(width, height), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def upload_video(
    client: TestClient, business_id: str, product_id: str, width: int, height: int
) -> str:
    response = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={
            "file": ("c.mp4", make_mp4(width, height, 8.0), "video/mp4"),
            "thumbnail": ("t.jpg", _THUMB, "image/jpeg"),
        },
    )
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


class Setup:
    """A SALES campaign (standard, or a creative test) with a product's media."""

    def __init__(self) -> None:
        self.business_id = ""
        self.campaign_id = ""
        self.product_id = ""
        self.media_ids: list[str] = []


def campaign_with(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    media: list[tuple[str, int, int]],
    test_format: str | None = None,
) -> Setup:
    """media: (kind 'photo'|'video', width, height) uploaded in order.

    test_format None makes a standard campaign; SINGLE_IMAGE/SINGLE_VIDEO a
    creative test of that format.
    """
    plan = (
        _FAKE_STRATEGY
        if test_format is None
        else _creative_plan(creative_format=test_format)
    )
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=plan)
    )
    _signed_up_client(client)
    setup = Setup()
    setup.business_id = _create_business(client, website="https://acme.example")
    setup.product_id = client.post(
        f"/businesses/{setup.business_id}/products",
        json={"description": "Custom rings", "url": "https://acme.example/ring"},
    ).json()["id"]
    ids = []
    for kind, width, height in media:
        upload = upload_photo if kind == "photo" else upload_video
        ids.append(upload(client, setup.business_id, setup.product_id, width, height))
    setup.media_ids = ids
    audience_id = _create_audience(client, setup.business_id)
    setup.campaign_id = client.post(
        f"/businesses/{setup.business_id}/campaigns",
        json={
            "objective": "SALES",
            "productId": setup.product_id,
            "audienceId": audience_id,
        },
    ).json()["id"]
    client.post(
        f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": test_format is None},
    )
    _connect_meta(client, setup.business_id)
    return setup


def creatives_url(setup: Setup) -> str:
    return f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/creatives"


def generate(
    client: TestClient, setup: Setup, fmt: str | None = None
) -> list[dict[str, Any]]:
    body = {"format": fmt} if fmt else None
    response = client.post(creatives_url(setup), json=body)
    assert response.status_code == 201, response.text
    created: list[dict[str, Any]] = response.json()
    return created


# ── Preselection when ads are generated ──────────────────────

PHOTOS_FEED_STORY = [("photo", 1080, 1350), ("photo", 1080, 1920)]
VIDEOS_FEED_STORY = [("video", 1080, 1350), ("video", 1080, 1920)]


def test_image_ads_preselect_a_feed_photo_and_a_story_photo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=PHOTOS_FEED_STORY)
    feed, story = setup.media_ids

    created = generate(client, setup)

    assert {c["storyAssetId"] for c in created} == {story}
    assert all(c["imageUrl"].endswith(feed) for c in created)
    assert all(c["storyImageUrl"].endswith(story) for c in created)
    assert all(c["storyVideoUrl"] is None for c in created)


def test_image_ads_prefer_a_feed_photo_even_when_a_story_photo_comes_first(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1920), ("photo", 1080, 1080)]
    )
    story, feed = setup.media_ids

    created = generate(client, setup)

    assert created[0]["imageUrl"].endswith(feed)
    assert created[0]["storyAssetId"] == story


def test_image_ads_stay_single_asset_without_a_story_photo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1350), ("photo", 1080, 1080)]
    )

    created = generate(client, setup)

    assert {c["storyAssetId"] for c in created} == {None}
    assert {c["imageUrl"] for c in created} == {None}  # attached at select, as before


def test_video_ads_preselect_a_feed_video_and_a_story_video(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=VIDEOS_FEED_STORY, test_format="SINGLE_VIDEO"
    )
    feed, story = setup.media_ids

    created = generate(client, setup)

    assert len(created) == 4  # one pair per ad: the test still compares messages
    assert {c["storyAssetId"] for c in created} == {story}
    assert created[0]["videoUrl"].endswith(feed)
    assert created[0]["storyVideoUrl"].endswith(story)
    assert created[0]["imageUrl"].endswith(f"{feed}/thumbnail")
    assert created[0]["storyImageUrl"].endswith(f"{story}/thumbnail")


def test_a_lone_story_video_is_still_a_single_asset_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Today's behaviour is unchanged: with nothing to pair, the first video is it."""
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("video", 1080, 1920)],
        test_format="SINGLE_VIDEO",
    )
    (only,) = setup.media_ids

    created = generate(client, setup)

    assert created[0]["videoUrl"].endswith(only)
    assert created[0]["storyAssetId"] is None


def test_a_video_ad_never_pairs_with_a_photo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("video", 1080, 1350), ("photo", 1080, 1920)],
        test_format="SINGLE_VIDEO",
    )

    created = generate(client, setup)

    assert created[0]["storyAssetId"] is None


def test_a_carousel_has_no_story_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1080)],
    )

    created = generate(client, setup, "CAROUSEL")

    assert {c["storyAssetId"] for c in created} == {None}


# ── Setting and clearing the story asset ─────────────────────


def story_url(setup: Setup, creative_id: str) -> str:
    return f"{creatives_url(setup)}/{creative_id}/story-asset"


def first_ad(client: TestClient, setup: Setup, fmt: str | None = None) -> str:
    created = generate(client, setup, fmt)
    return str(created[0]["id"])


def test_a_story_photo_can_be_added_to_an_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1350)])
    story = upload_photo(client, setup.business_id, setup.product_id, 1080, 1920)
    ad = first_ad(client, setup)

    response = client.put(story_url(setup, ad), json={"productImageId": story})

    assert response.status_code == 200
    body = response.json()
    assert body["storyAssetId"] == story
    assert body["storyImageUrl"].endswith(story)
    assert body["status"] == "GENERATED"


def test_the_story_asset_can_be_removed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=PHOTOS_FEED_STORY)
    ad = first_ad(client, setup)

    response = client.put(story_url(setup, ad), json={"productImageId": None})

    assert response.status_code == 200
    assert response.json()["storyAssetId"] is None
    assert response.json()["storyImageUrl"] is None


def test_the_story_asset_must_be_a_9x16_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1350), ("photo", 1080, 1080)]
    )
    feed_two = setup.media_ids[1]
    ad = first_ad(client, setup)

    response = client.put(story_url(setup, ad), json={"productImageId": feed_two})

    assert response.status_code == 400
    assert "9:16" in response.json()["detail"]


def test_the_story_asset_must_be_the_same_media_type(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1350)])
    story_video = upload_video(client, setup.business_id, setup.product_id, 1080, 1920)
    ad = first_ad(client, setup)

    response = client.put(story_url(setup, ad), json={"productImageId": story_video})

    assert response.status_code == 404


def test_a_story_asset_needs_a_feed_shaped_main_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The feed slot must be 1:1 or 4:5 before a story version is added."""
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1920)])
    other_story = upload_photo(client, setup.business_id, setup.product_id, 1080, 1920)
    ad = first_ad(client, setup)
    client.post(f"{creatives_url(setup)}/{ad}/select")  # attaches the only photo

    response = client.put(story_url(setup, ad), json={"productImageId": other_story})

    assert response.status_code == 400
    assert "feed" in response.json()["detail"].lower()


def test_a_story_asset_from_another_product_is_not_found(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=PHOTOS_FEED_STORY)
    ad = first_ad(client, setup)

    response = client.put(story_url(setup, ad), json={"productImageId": "nope"})

    assert response.status_code == 404


def test_a_carousel_cannot_have_a_story_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1080)],
    )
    ad = first_ad(client, setup, "CAROUSEL")
    story = setup.media_ids[1]

    response = client.put(story_url(setup, ad), json={"productImageId": story})

    assert response.status_code == 400


def test_the_story_asset_endpoint_404s_for_an_unknown_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=PHOTOS_FEED_STORY)
    generate(client, setup)

    response = client.put(story_url(setup, "nope"), json={"productImageId": None})

    assert response.status_code == 404


def test_changing_a_selected_ads_story_asset_sends_an_approved_campaign_back(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=PHOTOS_FEED_STORY, test_format="SINGLE_IMAGE"
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    client.post(
        f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/approve"
    )
    campaigns = client.get(f"/businesses/{setup.business_id}/campaigns").json()
    assert (
        next(c for c in campaigns if c["id"] == setup.campaign_id)["status"]
        == "APPROVED"
    )

    response = client.put(
        story_url(setup, created[0]["id"]), json={"productImageId": None}
    )

    assert response.status_code == 200
    campaigns = client.get(f"/businesses/{setup.business_id}/campaigns").json()
    assert (
        next(c for c in campaigns if c["id"] == setup.campaign_id)["status"]
        == "PENDING_APPROVAL"
    )


# ── Changing the feed asset when a story asset is present ────


def test_the_feed_asset_of_a_pair_must_stay_feed_shaped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1920)],
    )
    other_story = setup.media_ids[2]
    ad = first_ad(client, setup)  # pair: photo 0 + photo 1

    response = client.put(
        f"{creatives_url(setup)}/{ad}/image", json={"productImageId": other_story}
    )

    assert response.status_code == 400
    assert "1:1 or 4:5" in response.json()["detail"]


def test_the_feed_asset_of_a_pair_can_change_to_another_feed_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1350)],
    )
    other_feed = setup.media_ids[2]
    ad = first_ad(client, setup)

    response = client.put(
        f"{creatives_url(setup)}/{ad}/image", json={"productImageId": other_feed}
    )

    assert response.status_code == 200
    assert response.json()["imageUrl"].endswith(other_feed)
    assert response.json()["storyAssetId"] is not None


def test_a_single_asset_ad_may_still_use_any_shape(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The Feed/Story rule only applies once there is a story asset."""
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1350), ("photo", 1080, 1920)]
    )
    story_shaped = setup.media_ids[1]
    ad = first_ad(client, setup)
    client.put(story_url(setup, ad), json={"productImageId": None})

    response = client.put(
        f"{creatives_url(setup)}/{ad}/image", json={"productImageId": story_shaped}
    )

    assert response.status_code == 200


def test_selecting_with_a_story_shaped_main_photo_is_refused_for_a_pair(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1920)],
    )
    other_story = setup.media_ids[2]
    ad = first_ad(client, setup)

    response = client.post(
        f"{creatives_url(setup)}/{ad}/select", json={"productImageId": other_story}
    )

    assert response.status_code == 400


async def seed_class(media_id: str, aspect_class: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.productimage.update(
            where={"id": media_id}, data={"aspectClass": aspect_class}
        )
    finally:
        await seeder.disconnect()


# ── The optional Square (1:1) asset ──────────────────────────

THREE_PHOTOS = [("photo", 1080, 1350), ("photo", 1080, 1920), ("photo", 1080, 1080)]
THREE_VIDEOS = [("video", 1080, 1350), ("video", 1080, 1920), ("video", 1080, 1080)]


def square_url(setup: Setup, creative_id: str) -> str:
    return f"{creatives_url(setup)}/{creative_id}/square-asset"


def test_image_ads_preselect_a_square_photo_when_the_product_has_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=THREE_PHOTOS)
    feed, story, square = setup.media_ids

    created = generate(client, setup)

    assert created[0]["imageUrl"].endswith(feed)
    assert created[0]["storyAssetId"] == story
    assert created[0]["squareAssetId"] == square
    assert created[0]["squareImageUrl"].endswith(square)
    assert created[0]["squareVideoUrl"] is None


def test_video_ads_preselect_a_square_video_too(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=THREE_VIDEOS, test_format="SINGLE_VIDEO"
    )
    feed, story, square = setup.media_ids

    created = generate(client, setup)

    assert created[0]["videoUrl"].endswith(feed)
    assert created[0]["storyVideoUrl"].endswith(story)
    assert created[0]["squareVideoUrl"].endswith(square)
    assert created[0]["squareImageUrl"].endswith(f"{square}/thumbnail")


def test_the_feed_slot_prefers_a_4x5_asset_over_a_1x1_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A square listed first stays the square asset; the 4:5 is the feed asset."""
    setup = campaign_with(
        client,
        monkeypatch,
        media=[("photo", 1080, 1080), ("photo", 1080, 1350), ("photo", 1080, 1920)],
    )
    square, feed, story = setup.media_ids

    created = generate(client, setup)

    assert created[0]["imageUrl"].endswith(feed)
    assert created[0]["squareAssetId"] == square
    assert created[0]["storyAssetId"] == story


def test_no_square_is_preselected_without_a_distinct_1x1(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The only Feed-shaped asset is a 1:1: it is the feed asset, not the square."""
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1080), ("photo", 1080, 1920)]
    )

    created = generate(client, setup)

    assert created[0]["squareAssetId"] is None
    assert created[0]["storyAssetId"] is not None


def test_a_square_photo_can_be_added_changed_and_removed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=PHOTOS_FEED_STORY)
    square = upload_photo(client, setup.business_id, setup.product_id, 1080, 1080)
    ad = first_ad(client, setup)

    added = client.put(square_url(setup, ad), json={"productImageId": square})
    removed = client.put(square_url(setup, ad), json={"productImageId": None})

    assert added.status_code == 200
    assert added.json()["squareAssetId"] == square
    assert added.json()["status"] == "GENERATED"
    assert removed.json()["squareAssetId"] is None
    assert removed.json()["squareImageUrl"] is None


def test_the_square_asset_must_be_exactly_1x1(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=[("photo", 1080, 1350), ("photo", 1080, 1350)]
    )
    four_by_five = setup.media_ids[1]
    ad = first_ad(client, setup)

    response = client.put(square_url(setup, ad), json={"productImageId": four_by_five})

    assert response.status_code == 400
    assert "1:1" in response.json()["detail"]


def test_the_square_asset_must_be_the_same_media_type(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1350)])
    square_video = upload_video(client, setup.business_id, setup.product_id, 1080, 1080)
    ad = first_ad(client, setup)

    response = client.put(square_url(setup, ad), json={"productImageId": square_video})

    assert response.status_code == 404


def test_the_square_asset_must_differ_from_the_feed_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1080)])
    only = setup.media_ids[0]
    ad = first_ad(client, setup)
    client.post(
        f"{creatives_url(setup)}/{ad}/select"
    )  # attaches the 1:1 as the feed asset

    response = client.put(square_url(setup, ad), json={"productImageId": only})

    assert response.status_code == 400
    assert "different" in response.json()["detail"]


def test_a_square_asset_needs_a_feed_shaped_main_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=[("photo", 1080, 1920)])
    square = upload_photo(client, setup.business_id, setup.product_id, 1080, 1080)
    ad = first_ad(client, setup)
    client.post(f"{creatives_url(setup)}/{ad}/select")  # attaches the only photo (9:16)

    response = client.put(square_url(setup, ad), json={"productImageId": square})

    assert response.status_code == 400
    assert "feed" in response.json()["detail"].lower()


def test_a_carousel_cannot_have_a_square_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=THREE_PHOTOS)
    ad = first_ad(client, setup, "CAROUSEL")

    response = client.put(
        square_url(setup, ad), json={"productImageId": setup.media_ids[2]}
    )

    assert response.status_code == 400


def test_the_square_endpoint_404s_for_an_unknown_ad_or_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=THREE_PHOTOS)
    ad = first_ad(client, setup)

    assert (
        client.put(square_url(setup, "nope"), json={"productImageId": None}).status_code
        == 404
    )
    assert (
        client.put(square_url(setup, ad), json={"productImageId": "nope"}).status_code
        == 404
    )


def test_changing_a_selected_ads_square_asset_sends_an_approved_campaign_back(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(
        client, monkeypatch, media=THREE_PHOTOS, test_format="SINGLE_IMAGE"
    )
    created = generate(client, setup)
    for ad in created[:3]:
        client.post(f"{creatives_url(setup)}/{ad['id']}/select")
    client.post(
        f"/businesses/{setup.business_id}/campaigns/{setup.campaign_id}/approve"
    )

    response = client.put(
        square_url(setup, created[0]["id"]), json={"productImageId": None}
    )

    assert response.status_code == 200
    campaigns = client.get(f"/businesses/{setup.business_id}/campaigns").json()
    assert (
        next(c for c in campaigns if c["id"] == setup.campaign_id)["status"]
        == "PENDING_APPROVAL"
    )


def test_the_feed_asset_cannot_be_swapped_for_the_square_asset(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    setup = campaign_with(client, monkeypatch, media=THREE_PHOTOS)
    square = setup.media_ids[2]
    ad = first_ad(client, setup)  # preselected: feed 4:5, story 9:16, square 1:1

    response = client.put(
        f"{creatives_url(setup)}/{ad}/image", json={"productImageId": square}
    )

    assert response.status_code == 400
    assert "square" in response.json()["detail"].lower()
