"""Tests for SINGLE_VIDEO creatives: generation, selection, editing, approval.

A video creative points at a product VIDEO (ProductImage with mediaType VIDEO)
through the same productImageId an image creative uses for its photo, and its
imageUrl is that video's thumbnail. Publishing is in test_video_publish.py.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import strategy as strategy_module
from app.api.product_image import product_image_url
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.media_fixtures import make_mp4
from tests.test_creative_test_plan_publish import (
    _creative_plan,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_product_image import _valid_jpeg
from tests.test_publish import (
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
    """The Creative Agent, mocked so tests can read what it was asked."""
    mock = AsyncMock(return_value=_FAKE_VARIANTS)
    monkeypatch.setattr(creative_module, "generate_creatives", mock)
    return mock


def _upload_video(
    client: TestClient,
    business_id: str,
    product_id: str,
    *,
    width: int = 1080,
    height: int = 1920,
    seconds: float = 10.0,
) -> dict[str, Any]:
    response = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={
            "file": ("clip.mp4", make_mp4(width, height, seconds), "video/mp4"),
            "thumbnail": ("t.jpg", _THUMB, "image/jpeg"),
        },
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


def _video_campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    test_format: str | None = "SINGLE_VIDEO",
    videos: int = 1,
    photos: int = 1,
    standard: bool = False,
) -> tuple[str, str, str, list[str], list[str]]:
    """A SALES campaign whose product has videos and photos.

    test_format picks the stored creative-test plan's format; standard=True
    makes it a standard (DATA_DRIVEN) campaign instead of a creative test.

    Returns:
        (business_id, campaign_id, product_id, video_ids, photo_ids).
    """
    from tests.test_publish import _FAKE_STRATEGY

    plan = (
        _FAKE_STRATEGY
        if standard
        else _creative_plan(creative_format=test_format or "SINGLE_IMAGE")
    )
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=plan)
    )
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id: str = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Custom rings", "url": "https://acme.example/ring"},
    ).json()["id"]
    photo_ids = []
    for n in range(photos):
        photo = client.post(
            f"/businesses/{business_id}/products/{product_id}/images",
            files={"file": (f"p{n}.jpg", _valid_jpeg(), "image/jpeg")},
        ).json()
        photo_ids.append(photo["id"])
    video_ids = [
        _upload_video(client, business_id, product_id)["id"] for _ in range(videos)
    ]
    audience_id = _create_audience(client, business_id)
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": standard},
    )
    _connect_meta(client, business_id)
    return business_id, campaign_id, product_id, video_ids, photo_ids


def _creatives_url(business_id: str, campaign_id: str) -> str:
    return f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"


def _thumbnail_url(media_id: str) -> str:
    return f"http://localhost:8000/product-images/{media_id}/thumbnail"


# ── Generating video creatives ───────────────────────────────


def test_a_video_test_generates_video_creatives_pointing_at_the_products_video(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(client, monkeypatch)

    response = client.post(_creatives_url(business_id, campaign_id))

    assert response.status_code == 201
    created = response.json()
    assert len(created) == 4
    assert {c["format"] for c in created} == {"SINGLE_VIDEO"}
    # One video reused across the test's ads (the message is what differs).
    assert {c["imageUrl"] for c in created} == {
        product_image_url(videos[0]) + "/thumbnail"
    }


def test_a_video_creative_exposes_its_playable_video_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(client, monkeypatch)

    created = client.post(_creatives_url(business_id, campaign_id)).json()

    assert created[0]["videoUrl"] == product_image_url(videos[0])


def test_an_image_creative_has_no_video_url(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, test_format="SINGLE_IMAGE"
    )

    created = client.post(_creatives_url(business_id, campaign_id)).json()

    assert created[0]["videoUrl"] is None


def test_generation_hands_the_agent_the_videos_thumbnail_and_duration(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, generate_mock: AsyncMock
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch)

    client.post(_creatives_url(business_id, campaign_id))

    kwargs = generate_mock.call_args.kwargs
    assert kwargs["format"] == "SINGLE_VIDEO"
    assert kwargs["video"].duration_seconds == pytest.approx(10.0)
    assert kwargs["video"].thumbnail_content_type == "image/jpeg"
    assert kwargs["primary_image"] is None  # the thumbnail rides in `video`


def test_the_first_video_by_position_is_used(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(
        client, monkeypatch, videos=2
    )

    created = client.post(_creatives_url(business_id, campaign_id)).json()

    assert created[0]["imageUrl"].endswith(f"{videos[0]}/thumbnail")


def test_a_video_test_needs_a_video_on_the_product(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch, videos=0)

    response = client.post(_creatives_url(business_id, campaign_id))

    assert response.status_code == 400
    assert "video" in response.json()["detail"].lower()


def test_a_video_test_refuses_image_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch)

    response = client.post(
        _creatives_url(business_id, campaign_id), json={"format": "SINGLE_IMAGE"}
    )

    assert response.status_code == 400
    assert "video test" in response.json()["detail"].lower()


def test_an_image_test_refuses_video_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, test_format="SINGLE_IMAGE"
    )

    response = client.post(
        _creatives_url(business_id, campaign_id), json={"format": "SINGLE_VIDEO"}
    )

    assert response.status_code == 400
    assert "image test" in response.json()["detail"].lower()


def test_a_creative_test_still_refuses_carousel(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch, photos=3)

    response = client.post(
        _creatives_url(business_id, campaign_id), json={"format": "CAROUSEL"}
    )

    assert response.status_code == 400


def test_an_image_test_without_a_format_still_generates_image_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, test_format="SINGLE_IMAGE"
    )

    created = client.post(_creatives_url(business_id, campaign_id)).json()

    assert {c["format"] for c in created} == {"SINGLE_IMAGE"}


def test_a_standard_campaign_can_choose_a_video_per_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(
        client, monkeypatch, standard=True
    )

    response = client.post(
        _creatives_url(business_id, campaign_id), json={"format": "SINGLE_VIDEO"}
    )

    assert response.status_code == 201
    assert response.json()[0]["format"] == "SINGLE_VIDEO"
    assert response.json()[0]["imageUrl"].endswith(f"{videos[0]}/thumbnail")


def test_a_standard_campaign_without_a_format_defaults_to_images(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, standard=True
    )

    created = client.post(_creatives_url(business_id, campaign_id)).json()

    assert {c["format"] for c in created} == {"SINGLE_IMAGE"}


# ── Selecting and swapping the video ─────────────────────────


def _first_creative(client: TestClient, business_id: str, campaign_id: str) -> str:
    created = client.post(_creatives_url(business_id, campaign_id)).json()
    first: str = created[0]["id"]
    return first


def test_selecting_a_video_ad_keeps_its_video(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(client, monkeypatch)
    creative_id = _first_creative(client, business_id, campaign_id)

    response = client.post(
        f"{_creatives_url(business_id, campaign_id)}/{creative_id}/select"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "SELECTED"
    assert response.json()["imageUrl"].endswith(f"{videos[0]}/thumbnail")


def test_selecting_a_video_ad_can_pick_another_video(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(
        client, monkeypatch, videos=2
    )
    creative_id = _first_creative(client, business_id, campaign_id)

    response = client.post(
        f"{_creatives_url(business_id, campaign_id)}/{creative_id}/select",
        json={"productImageId": videos[1]},
    )

    assert response.json()["imageUrl"].endswith(f"{videos[1]}/thumbnail")


def test_a_video_ad_cannot_be_given_a_photo(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, photos = _video_campaign(client, monkeypatch)
    creative_id = _first_creative(client, business_id, campaign_id)
    base = f"{_creatives_url(business_id, campaign_id)}/{creative_id}"

    assert (
        client.post(f"{base}/select", json={"productImageId": photos[0]}).status_code
        == 404
    )
    assert (
        client.put(f"{base}/image", json={"productImageId": photos[0]}).status_code
        == 404
    )


def test_the_video_can_be_swapped_without_selecting(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(
        client, monkeypatch, videos=2
    )
    creative_id = _first_creative(client, business_id, campaign_id)

    response = client.put(
        f"{_creatives_url(business_id, campaign_id)}/{creative_id}/image",
        json={"productImageId": videos[1]},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "GENERATED"
    assert response.json()["imageUrl"].endswith(f"{videos[1]}/thumbnail")


def test_selecting_a_video_ad_after_its_video_was_removed_asks_for_a_video(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, product_id, videos, _ = _video_campaign(
        client, monkeypatch
    )
    creative_id = _first_creative(client, business_id, campaign_id)
    client.delete(f"/businesses/{business_id}/products/{product_id}/images/{videos[0]}")

    response = client.post(
        f"{_creatives_url(business_id, campaign_id)}/{creative_id}/select"
    )

    assert response.status_code == 428
    assert "video" in response.json()["detail"].lower()


def test_regenerating_a_video_ads_copy_keeps_it_a_video_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, generate_mock: AsyncMock
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch)
    creative_id = _first_creative(client, business_id, campaign_id)
    generate_mock.reset_mock()

    response = client.post(
        f"{_creatives_url(business_id, campaign_id)}/{creative_id}/regenerate",
        json={"fields": ["headline"]},
    )

    assert response.status_code == 200
    assert generate_mock.call_args.kwargs["format"] == "SINGLE_VIDEO"
    assert generate_mock.call_args.kwargs["video"] is not None


# ── Publish guard: format and media checks ───────────────────


def _approve(client: TestClient, business_id: str, campaign_id: str) -> None:
    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    assert response.status_code == 200, response.text


def _publish(client: TestClient, business_id: str, campaign_id: str) -> Any:
    return client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish",
        json={"paused": True},
    )


def _select_all(
    client: TestClient, business_id: str, campaign_id: str, count: int = 3
) -> list[str]:
    created = client.post(_creatives_url(business_id, campaign_id)).json()
    ids = [c["id"] for c in created[:count]]
    for creative_id in ids:
        client.post(f"{_creatives_url(business_id, campaign_id)}/{creative_id}/select")
    return ids


def test_a_video_test_with_video_ads_can_be_approved(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch)
    _select_all(client, business_id, campaign_id)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 200


async def _set_format(creative_id: str, creative_format: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.creative.update(
            where={"id": creative_id}, data={"format": creative_format}
        )
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_mixed_formats_in_one_test_cannot_be_published(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(client, monkeypatch)
    ids = _select_all(client, business_id, campaign_id)
    _approve(client, business_id, campaign_id)
    await _set_format(ids[0], "SINGLE_IMAGE")

    response = _publish(client, business_id, campaign_id)

    assert response.status_code == 400
    assert "video" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_an_image_test_cannot_be_published_with_a_video_ad(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, _, _ = _video_campaign(
        client, monkeypatch, test_format="SINGLE_IMAGE"
    )
    ids = _select_all(client, business_id, campaign_id)
    _approve(client, business_id, campaign_id)
    await _set_format(ids[0], "SINGLE_VIDEO")

    response = _publish(client, business_id, campaign_id)

    assert response.status_code == 400


def test_publishing_fails_if_a_selected_ads_video_was_removed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, product_id, videos, _ = _video_campaign(
        client, monkeypatch
    )
    _select_all(client, business_id, campaign_id)
    _approve(client, business_id, campaign_id)
    client.delete(f"/businesses/{business_id}/products/{product_id}/images/{videos[0]}")

    response = _publish(client, business_id, campaign_id)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "video" in detail.lower()
    assert "no longer" in detail


@pytest.mark.asyncio
async def test_publishing_fails_if_a_videos_thumbnail_is_missing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _, videos, _ = _video_campaign(client, monkeypatch)
    _select_all(client, business_id, campaign_id)
    _approve(client, business_id, campaign_id)
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.productimage.update(
            where={"id": videos[0]},
            data={"thumbnailData": None, "thumbnailContentType": None},
        )
    finally:
        await seeder.disconnect()

    response = _publish(client, business_id, campaign_id)

    assert response.status_code == 400
    assert "thumbnail" in response.json()["detail"].lower()
