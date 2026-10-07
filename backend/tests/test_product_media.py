"""Tests for product media: video uploads, metadata, classification, exclusions.

Videos live in the same table and endpoints as photos (ProductImage, with a
mediaType), so these cover the new behavior; test_product_image.py covers the
unchanged photo basics.
"""

from typing import Any

import httpx2
import pytest
from app.api import product_image as product_image_module
from app.schemas.product_image import MAX_VIDEO_SECONDS
from fastapi.testclient import TestClient
from prisma import Base64, Prisma

from tests.media_fixtures import make_mp4
from tests.test_product_image import (
    _create_business,
    _signed_up_client,
    _valid_jpeg,
)

_THUMB = _valid_jpeg(360, 640)


def _upload_video(
    client: TestClient,
    business_id: str,
    product_id: str,
    *,
    video: bytes | None = None,
    content_type: str = "video/mp4",
    thumbnail: bytes | None = _THUMB,
    thumbnail_type: str = "image/jpeg",
) -> httpx2.Response:
    files: dict[str, Any] = {
        "file": ("clip.mp4", video if video is not None else make_mp4(), content_type)
    }
    if thumbnail is not None:
        files["thumbnail"] = ("thumb.jpg", thumbnail, thumbnail_type)
    return client.post(
        f"/businesses/{business_id}/products/{product_id}/images", files=files
    )


def _upload_photo(
    client: TestClient, business_id: str, product_id: str, width: int, height: int
) -> httpx2.Response:
    return client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("p.jpg", _valid_jpeg(width, height), "image/jpeg")},
    )


def _setup(client: TestClient) -> tuple[str, str]:
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id: str = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Widgets", "url": "https://acme.example/widgets"},
    ).json()["id"]
    return business_id, product_id


# ── Video upload ─────────────────────────────────────────────


def test_a_video_upload_stores_its_metadata_and_thumbnail(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    video = make_mp4(1080, 1920, 12.5, padding=2048)

    response = _upload_video(client, business_id, product_id, video=video)

    assert response.status_code == 201
    body = response.json()
    assert body["mediaType"] == "VIDEO"
    assert (body["width"], body["height"]) == (1080, 1920)
    assert body["durationSeconds"] == pytest.approx(12.5)
    assert body["sizeBytes"] == len(video)
    assert body["aspectClass"] == "STORY"
    assert body["aspectRatioWarning"] is None
    assert body["thumbnailUrl"].endswith(f"/product-images/{body['id']}/thumbnail")


def test_a_quicktime_video_is_accepted(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(
        client,
        business_id,
        product_id,
        video=make_mp4(1080, 1350, 8.0, brand=b"qt  "),
        content_type="video/quicktime",
    )

    assert response.status_code == 201
    assert response.json()["aspectClass"] == "FEED"


def test_an_unsupported_video_type_is_rejected(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(client, business_id, product_id, content_type="video/webm")

    assert response.status_code == 400
    assert "mp4" in response.json()["detail"].lower()


def test_a_video_needs_a_thumbnail(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(client, business_id, product_id, thumbnail=None)

    assert response.status_code == 400
    assert "thumbnail" in response.json()["detail"].lower()


def test_an_unreadable_thumbnail_is_rejected(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(client, business_id, product_id, thumbnail=b"junk")

    assert response.status_code == 400
    assert "thumbnail" in response.json()["detail"].lower()


def test_a_thumbnail_must_be_a_jpeg_or_png(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(
        client, business_id, product_id, thumbnail_type="image/gif"
    )

    assert response.status_code == 400
    assert "thumbnail" in response.json()["detail"].lower()


def test_an_oversized_thumbnail_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, product_id = _setup(client)
    monkeypatch.setattr(product_image_module, "MAX_IMAGE_BYTES", len(_THUMB) - 1)

    response = _upload_video(client, business_id, product_id)

    assert response.status_code == 400
    assert "thumbnail" in response.json()["detail"].lower()


def test_unreadable_video_bytes_are_rejected(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(client, business_id, product_id, video=b"not a movie")

    assert response.status_code == 400
    assert "could not read" in response.json()["detail"].lower()


def test_a_video_over_sixty_seconds_is_rejected(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(
        client, business_id, product_id, video=make_mp4(duration_seconds=60.5)
    )

    assert response.status_code == 400
    assert f"{MAX_VIDEO_SECONDS} seconds" in response.json()["detail"]


def test_a_video_of_exactly_sixty_seconds_is_accepted(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_video(
        client, business_id, product_id, video=make_mp4(duration_seconds=60.0)
    )

    assert response.status_code == 201


def test_a_video_over_the_size_cap_is_rejected_with_guidance(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, product_id = _setup(client)
    video = make_mp4(padding=4096)
    monkeypatch.setattr(product_image_module, "MAX_VIDEO_BYTES", len(video) - 1)

    response = _upload_video(client, business_id, product_id, video=video)

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert "50MB" in detail
    assert "under 30 seconds" in detail


def test_the_video_size_cap_is_fifty_megabytes() -> None:
    from app.schemas.product_image import MAX_VIDEO_BYTES

    assert MAX_VIDEO_BYTES == 50 * 1024 * 1024


# ── Photo metadata and the "unclassified" warning ───────────


def test_a_photo_records_its_size_and_aspect_class(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    body = _upload_photo(client, business_id, product_id, 1080, 1350).json()

    assert body["mediaType"] == "IMAGE"
    assert (body["width"], body["height"]) == (1080, 1350)
    assert body["aspectClass"] == "FEED"
    assert body["durationSeconds"] is None
    assert body["thumbnailUrl"] is None
    assert body["sizeBytes"] == len(_valid_jpeg(1080, 1350))
    assert body["aspectRatioWarning"] is None


@pytest.mark.parametrize(
    ("width", "height", "aspect_class"),
    [(1080, 1920, "STORY"), (1200, 628, "LANDSCAPE")],
)
def test_story_and_landscape_photos_are_classified_without_a_warning(
    client: TestClient, width: int, height: int, aspect_class: str
) -> None:
    business_id, product_id = _setup(client)

    body = _upload_photo(client, business_id, product_id, width, height).json()

    assert body["aspectClass"] == aspect_class
    assert body["aspectRatioWarning"] is None


def test_an_unclassified_photo_uploads_with_a_warning(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    response = _upload_photo(client, business_id, product_id, 1000, 1500)

    assert response.status_code == 201
    body = response.json()
    assert body["aspectClass"] == "UNCLASSIFIED"
    assert "standard ad shape" in body["aspectRatioWarning"]


def test_an_unclassified_video_also_warns(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    body = _upload_video(
        client, business_id, product_id, video=make_mp4(1000, 1500, 5.0)
    ).json()

    assert body["aspectClass"] == "UNCLASSIFIED"
    assert "standard ad shape" in body["aspectRatioWarning"]


def test_the_list_includes_metadata_but_not_the_one_time_warning(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    _upload_video(client, business_id, product_id)

    listed = client.get(
        f"/businesses/{business_id}/products/{product_id}/images"
    ).json()

    assert listed[0]["mediaType"] == "VIDEO"
    assert listed[0]["aspectClass"] == "STORY"
    assert listed[0]["aspectRatioWarning"] is None
    assert listed[0]["thumbnailUrl"] is not None


# ── Serving ──────────────────────────────────────────────────


def test_a_video_is_served_publicly_with_its_content_type(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    video = make_mp4(padding=128)
    image = _upload_video(client, business_id, product_id, video=video).json()
    client.post("/auth/logout")

    response = client.get(f"/product-images/{image['id']}")

    assert response.status_code == 200
    assert response.content == video
    assert response.headers["content-type"] == "video/mp4"


def test_a_thumbnail_is_served_publicly_as_an_image(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    image = _upload_video(client, business_id, product_id).json()
    client.post("/auth/logout")

    response = client.get(f"/product-images/{image['id']}/thumbnail")

    assert response.status_code == 200
    assert response.content == _THUMB
    assert response.headers["content-type"] == "image/jpeg"


def test_a_photo_has_no_thumbnail_route(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    photo = _upload_photo(client, business_id, product_id, 800, 800).json()

    assert client.get(f"/product-images/{photo['id']}/thumbnail").status_code == 404


def test_a_thumbnail_404s_for_an_unknown_id(client: TestClient) -> None:
    assert client.get("/product-images/nope/thumbnail").status_code == 404


def test_a_thumbnail_404s_once_its_business_is_soft_deleted(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    image = _upload_video(client, business_id, product_id).json()

    client.delete(f"/businesses/{business_id}")

    assert client.get(f"/product-images/{image['id']}/thumbnail").status_code == 404


# ── Videos stay out of photo-only paths ─────────────────────


def test_a_video_is_never_the_products_primary_image(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _upload_video(client, business_id, product_id)  # position 0
    photo = _upload_photo(client, business_id, product_id, 800, 800).json()

    product = _product(client, business_id, product_id)

    assert product["primaryImageUrl"] == photo["url"]


def test_a_product_with_only_a_video_has_no_primary_image(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _upload_video(client, business_id, product_id)

    product = _product(client, business_id, product_id)

    assert product["primaryImageUrl"] is None


def _product(client: TestClient, business_id: str, product_id: str) -> dict[str, Any]:
    listed = client.get(f"/businesses/{business_id}/products").json()
    return next(p for p in listed if p["id"] == product_id)


def _sales_campaign(client: TestClient, business_id: str, product_id: str) -> str:
    audience_id: str = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Busy professionals, 30-55"},
    ).json()["id"]
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns",
        json={
            "objective": "SALES",
            "productId": product_id,
            "audienceId": audience_id,
        },
    ).json()["id"]
    return campaign_id


async def _seed_creative(campaign_id: str) -> str:
    seeder = Prisma()
    await seeder.connect()
    try:
        creative = await seeder.creative.create(
            data={
                "campaignId": campaign_id,
                "headline": "H",
                "bodyText": "Body.",
                "cta": "SHOP_NOW",
            }
        )
        return creative.id
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_selecting_an_ad_for_a_product_with_only_videos_asks_for_a_photo(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    _upload_video(client, business_id, product_id)
    campaign_id = _sales_campaign(client, business_id, product_id)
    creative_id = await _seed_creative(campaign_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creative_id}/select"
    )

    assert response.status_code == 428


@pytest.mark.asyncio
async def test_a_video_cannot_be_attached_as_an_ads_image(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _upload_photo(client, business_id, product_id, 800, 800)
    video = _upload_video(client, business_id, product_id).json()
    campaign_id = _sales_campaign(client, business_id, product_id)
    creative_id = await _seed_creative(campaign_id)
    base = f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{creative_id}"

    selected = client.post(f"{base}/select", json={"productImageId": video["id"]})
    swapped = client.put(f"{base}/image", json={"productImageId": video["id"]})

    assert selected.status_code == 404
    assert swapped.status_code == 404


# ── Backfill ─────────────────────────────────────────────────


async def _seed_unmeasured_photo(product_id: str, data: bytes) -> str:
    seeder = Prisma()
    await seeder.connect()
    try:
        row = await seeder.productimage.create(
            data={
                "productId": product_id,
                "data": Base64.encode(data),
                "contentType": "image/jpeg",
            }
        )
        return row.id
    finally:
        await seeder.disconnect()


async def _row(image_id: str) -> Any:
    seeder = Prisma()
    await seeder.connect()
    try:
        return await seeder.productimage.find_unique(where={"id": image_id})
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_backfill_measures_existing_photos(client: TestClient) -> None:
    from app.services.media_backfill import backfill_image_metadata

    business_id, product_id = _setup(client)
    photo = _valid_jpeg(1080, 1350)
    image_id = await _seed_unmeasured_photo(product_id, photo)
    assert client.portal is not None

    result = client.portal.call(backfill_image_metadata)

    assert (result.updated, result.skipped, result.failed) == (1, 0, 0)
    row = await _row(image_id)
    assert (row.width, row.height) == (1080, 1350)
    assert row.aspectClass == "FEED"
    assert row.sizeBytes == len(photo)
    assert row.mediaType == "IMAGE"


@pytest.mark.asyncio
async def test_backfill_is_idempotent_and_leaves_measured_rows_alone(
    client: TestClient,
) -> None:
    from app.services.media_backfill import backfill_image_metadata

    business_id, product_id = _setup(client)
    _upload_photo(client, business_id, product_id, 800, 800)  # already measured
    await _seed_unmeasured_photo(product_id, _valid_jpeg(1080, 1920))
    assert client.portal is not None

    first = client.portal.call(backfill_image_metadata)
    second = client.portal.call(backfill_image_metadata)

    assert (first.updated, first.skipped) == (1, 1)
    assert (second.updated, second.skipped) == (0, 2)


@pytest.mark.asyncio
async def test_backfill_reports_photos_it_cannot_read(client: TestClient) -> None:
    from app.services.media_backfill import backfill_image_metadata

    business_id, product_id = _setup(client)
    image_id = await _seed_unmeasured_photo(product_id, b"corrupt")
    assert client.portal is not None

    result = client.portal.call(backfill_image_metadata)

    assert (result.updated, result.failed) == (0, 1)
    assert (await _row(image_id)).width is None
