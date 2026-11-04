"""DELETE .../products/{id} and the video thumbnail fallback (Products tab, 2026-11).

A product no campaign uses can be deleted together with its photos and videos. One a
campaign uses is refused with a message naming the campaigns, whatever their status,
and nothing is removed.
"""

from typing import Any

from fastapi.testclient import TestClient

from tests.research_helpers import sql
from tests.test_creative import _create_campaign
from tests.test_product_media import (
    _product,
    _setup,
    _upload_photo,
    _upload_video,
)

_PRODUCT_ROWS = 'SELECT count(*) FROM "Product" WHERE id = ?'
_MEDIA_ROWS = 'SELECT count(*) FROM "ProductImage" WHERE productId = ?'


def _delete(client: TestClient, business_id: str, product_id: str) -> Any:
    return client.delete(f"/businesses/{business_id}/products/{product_id}")


def _count(query: str, product_id: str) -> int:
    (row,) = sql(query, product_id)
    return int(row[0])


def test_deleting_requires_a_session(client: TestClient) -> None:
    assert _delete(client, "b", "p").status_code == 401


def test_an_unknown_product_is_a_404(client: TestClient) -> None:
    business_id, _ = _setup(client)

    assert _delete(client, business_id, "missing").status_code == 404


def test_another_owners_product_is_a_404_and_stays(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    client.post("/auth/logout")
    client.post(
        "/auth/signup",
        json={
            "email": "bob@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )

    assert _delete(client, business_id, product_id).status_code == 404
    assert _count(_PRODUCT_ROWS, product_id) == 1


def test_an_unused_product_is_deleted_with_its_photos_and_videos(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    _upload_photo(client, business_id, product_id, 800, 800)
    _upload_video(client, business_id, product_id)
    assert _count(_MEDIA_ROWS, product_id) == 2

    response = _delete(client, business_id, product_id)

    assert response.status_code == 204
    assert _count(_PRODUCT_ROWS, product_id) == 0
    assert _count(_MEDIA_ROWS, product_id) == 0
    listed = client.get(f"/businesses/{business_id}/products").json()
    assert [p["id"] for p in listed] == []


def test_deleting_twice_is_a_404(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _delete(client, business_id, product_id)

    assert _delete(client, business_id, product_id).status_code == 404


def test_a_product_a_campaign_uses_is_refused_and_nothing_is_removed(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    _upload_photo(client, business_id, product_id, 800, 800)
    _create_campaign(client, business_id, product_id=product_id)

    response = _delete(client, business_id, product_id)

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "used by 1 campaign" in detail
    assert "change" in detail.lower()
    assert _count(_PRODUCT_ROWS, product_id) == 1
    assert _count(_MEDIA_ROWS, product_id) == 1


def test_the_refusal_names_every_campaign_and_its_status(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    first = _create_campaign(client, business_id, product_id=product_id)
    second = _create_campaign(client, business_id, product_id=product_id)
    update = 'UPDATE "Campaign" SET name = ?, status = ? WHERE id = ?'
    sql(update, "Snake-Ring", "LIVE", first)
    sql(update, "Spring", "ARCHIVED", second)

    detail = _delete(client, business_id, product_id).json()["detail"]

    assert "used by 2 campaigns" in detail
    assert "Snake-Ring (LIVE)" in detail
    assert "Spring (ARCHIVED)" in detail


def test_a_campaign_on_another_product_does_not_block(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _create_campaign(client, business_id)  # makes its own product

    assert _delete(client, business_id, product_id).status_code == 204


def test_deleting_one_product_leaves_the_others_media(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    other: str = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Other", "url": "https://acme.example/other"},
    ).json()["id"]
    _upload_photo(client, business_id, other, 800, 800)

    _delete(client, business_id, product_id)

    assert _count(_MEDIA_ROWS, other) == 1
    assert _count(_PRODUCT_ROWS, other) == 1


# ── The list thumbnail falls back to a video's thumbnail ────────────────


def test_a_product_with_only_a_video_shows_the_videos_thumbnail(
    client: TestClient,
) -> None:
    business_id, product_id = _setup(client)
    video = _upload_video(client, business_id, product_id).json()

    product = _product(client, business_id, product_id)

    assert product["primaryImageUrl"] == f"{video['url']}/thumbnail"


def test_a_photo_beats_a_video_for_the_thumbnail(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    _upload_video(client, business_id, product_id)  # position 0
    photo = _upload_photo(client, business_id, product_id, 800, 800).json()

    assert _product(client, business_id, product_id)["primaryImageUrl"] == photo["url"]


def test_the_first_video_by_position_supplies_the_thumbnail(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    first = _upload_video(client, business_id, product_id).json()
    _upload_video(client, business_id, product_id)

    url = _product(client, business_id, product_id)["primaryImageUrl"]

    assert url == f"{first['url']}/thumbnail"


def test_a_video_without_a_stored_thumbnail_gives_none(client: TestClient) -> None:
    business_id, product_id = _setup(client)
    video = _upload_video(client, business_id, product_id).json()
    # A video stored before thumbnails were required has neither column.
    sql(
        'UPDATE "ProductImage" SET thumbnailData = NULL, thumbnailContentType = NULL '
        "WHERE id = ?",
        video["id"],
    )

    assert _product(client, business_id, product_id)["primaryImageUrl"] is None


def test_a_product_with_no_media_has_no_thumbnail(client: TestClient) -> None:
    business_id, product_id = _setup(client)

    assert _product(client, business_id, product_id)["primaryImageUrl"] is None
