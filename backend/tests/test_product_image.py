"""Tests for product image upload endpoints (PRD.md §2 step 4)."""

import struct

import httpx2
from app.schemas.product_image import MAX_IMAGE_BYTES
from fastapi.testclient import TestClient


def _valid_jpeg(width: int = 800, height: int = 800) -> bytes:
    """A structurally-valid minimal JPEG — real header, fake scan data.

    Good enough for app/services/image_dimensions.py, which never reads
    past the first start-of-frame marker.
    """
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


def _valid_png(width: int = 800, height: int = 800) -> bytes:
    """A structurally-valid minimal PNG — real IHDR chunk, no real pixel data."""
    return (
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )


_JPEG_BYTES = _valid_jpeg()


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post(
        "/auth/signup",
        json={"email": email, "password": "supersecret123", "termsAccepted": True},
    )
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post(
        "/businesses", json={"name": name, "industry": "FASHION_JEWELRY"}
    )
    id_: str = response.json()["id"]
    return id_


def _create_product(client: TestClient, business_id: str) -> str:
    """Create a product under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/products", json={"description": "Widgets"}
    )
    id_: str = response.json()["id"]
    return id_


def _upload(
    client: TestClient,
    business_id: str,
    product_id: str,
    *,
    filename: str = "ring.jpg",
    content: bytes = _JPEG_BYTES,
    content_type: str = "image/jpeg",
) -> httpx2.Response:
    return client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": (filename, content, content_type)},
    )


def test_upload_requires_a_session(client: TestClient) -> None:
    """Uploading with no session cookie returns 401."""
    response = _upload(client, "some-id", "some-id")

    assert response.status_code == 401


def test_upload_404s_for_a_nonexistent_business(client: TestClient) -> None:
    """Uploading under a nonexistent business returns 404."""
    _signed_up_client(client)

    response = _upload(client, "does-not-exist", "some-id")

    assert response.status_code == 404


def test_upload_404s_for_a_product_from_another_business(client: TestClient) -> None:
    """A product belonging to a different business (even one you own) 404s."""
    _signed_up_client(client)
    business_a = _create_business(client, name="Business A")
    business_b = _create_business(client, name="Business B")
    product_from_b = _create_product(client, business_b)

    response = _upload(client, business_a, product_from_b)

    assert response.status_code == 404
    assert response.json()["detail"] == "Product not found"


def test_upload_404s_for_another_users_business(client: TestClient) -> None:
    """A user can't upload an image under a business they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = _upload(client, business_id, product_id)

    assert response.status_code == 404


def test_upload_succeeds_with_a_valid_jpeg(client: TestClient) -> None:
    """A supported image type uploads successfully and returns a public URL."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(client, business_id, product_id)

    assert response.status_code == 201
    body = response.json()
    assert "id" in body
    assert body["url"] == f"http://localhost:8000/product-images/{body['id']}"
    assert body["aspectRatioWarning"] is None
    assert "createdAt" in body


def test_upload_accepts_png(client: TestClient) -> None:
    """png is supported alongside jpeg."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(
        client,
        business_id,
        product_id,
        filename="ring.png",
        content=_valid_png(),
        content_type="image/png",
    )

    assert response.status_code == 201


def test_upload_rejects_webp(client: TestClient) -> None:
    """webp is no longer accepted (confirmed 2026-09-09 — jpeg/png only)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(
        client,
        business_id,
        product_id,
        filename="ring.webp",
        content=b"fake webp bytes",
        content_type="image/webp",
    )

    assert response.status_code == 400
    assert "Unsupported image type" in response.json()["detail"]


def test_upload_rejects_an_unsupported_content_type(client: TestClient) -> None:
    """A non-image content type (or an unsupported image format) is rejected."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(
        client,
        business_id,
        product_id,
        filename="notes.txt",
        content=b"just some text",
        content_type="text/plain",
    )

    assert response.status_code == 400
    assert "Unsupported image type" in response.json()["detail"]


def test_upload_rejects_a_file_over_the_size_limit(client: TestClient) -> None:
    """A file larger than MAX_IMAGE_BYTES is rejected, not silently truncated."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    oversized = b"\xff\xd8\xff\xe0" + b"x" * MAX_IMAGE_BYTES

    response = _upload(client, business_id, product_id, content=oversized)

    assert response.status_code == 400
    assert "exceeds" in response.json()["detail"]


def test_upload_rejects_unreadable_image_bytes(client: TestClient) -> None:
    """A declared jpeg content-type whose bytes aren't actually a jpeg
    (corrupted upload, wrong extension, etc.) is rejected with a clear
    message, not a 500 from a failed struct.unpack somewhere downstream."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(client, business_id, product_id, content=b"not a real jpeg")

    assert response.status_code == 400
    assert "could not read" in response.json()["detail"].lower()


def test_upload_rejects_an_image_smaller_than_the_minimum(client: TestClient) -> None:
    """Below 600px on the short side is rejected outright, not just warned."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(client, business_id, product_id, content=_valid_jpeg(500, 500))

    assert response.status_code == 400
    assert "600px" in response.json()["detail"]


def test_upload_allows_a_short_side_exactly_at_the_minimum(client: TestClient) -> None:
    """The 600px minimum is inclusive, not exclusive."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(client, business_id, product_id, content=_valid_jpeg(600, 900))

    assert response.status_code == 201


def test_upload_warns_but_does_not_block_an_out_of_range_aspect_ratio(
    client: TestClient,
) -> None:
    """Outside Meta's recommended 1:1-4:5 range is a warning, not a block —
    the image still uploads."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    # 800x2000 -> ratio 0.4, well under the 4:5 (0.8) floor.
    response = _upload(client, business_id, product_id, content=_valid_jpeg(800, 2000))

    assert response.status_code == 201
    assert response.json()["aspectRatioWarning"] is not None


def test_upload_no_warning_within_the_recommended_aspect_ratio(
    client: TestClient,
) -> None:
    """A 4:5 portrait photo (the tighter edge of the recommended range) is fine."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = _upload(client, business_id, product_id, content=_valid_jpeg(800, 1000))

    assert response.status_code == 201
    assert response.json()["aspectRatioWarning"] is None


def test_list_images_requires_a_session(client: TestClient) -> None:
    """Listing images with no session cookie returns 401."""
    response = client.get("/businesses/some-id/products/some-id/images")

    assert response.status_code == 401


def test_list_images_returns_an_empty_list_before_any_uploaded(
    client: TestClient,
) -> None:
    """No images yet is a normal state, not a 404."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = client.get(f"/businesses/{business_id}/products/{product_id}/images")

    assert response.status_code == 200
    assert response.json() == []


def test_list_images_returns_upload_order_by_default(client: TestClient) -> None:
    """With no reordering, photos list in upload order — first uploaded is
    primary."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    first = _upload(client, business_id, product_id, filename="a.jpg").json()
    second = _upload(client, business_id, product_id, filename="b.jpg").json()

    response = client.get(f"/businesses/{business_id}/products/{product_id}/images")

    assert response.status_code == 200
    ids = [img["id"] for img in response.json()]
    assert ids == [first["id"], second["id"]]


def test_a_new_upload_appends_after_the_highest_position_even_with_gaps(
    client: TestClient,
) -> None:
    """Deleting an earlier photo must never make a later upload collide
    with — or sort ahead of — a photo that's still there (confirmed
    2026-09-09: a plain count-based position would have this bug)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    first = _upload(client, business_id, product_id, filename="a.jpg").json()
    second = _upload(client, business_id, product_id, filename="b.jpg").json()
    client.delete(
        f"/businesses/{business_id}/products/{product_id}/images/{first['id']}"
    )

    third = _upload(client, business_id, product_id, filename="c.jpg").json()

    response = client.get(f"/businesses/{business_id}/products/{product_id}/images")
    ids = [img["id"] for img in response.json()]
    assert ids == [second["id"], third["id"]]


def test_reorder_requires_a_session(client: TestClient) -> None:
    """Reordering with no session cookie returns 401."""
    response = client.put(
        "/businesses/some-id/products/some-id/images/order",
        json={"imageIds": []},
    )

    assert response.status_code == 401


def test_reorder_404s_for_a_nonexistent_product(client: TestClient) -> None:
    """Reordering images on a nonexistent product returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.put(
        f"/businesses/{business_id}/products/does-not-exist/images/order",
        json={"imageIds": []},
    )

    assert response.status_code == 404


def test_reorder_sets_the_new_display_order(client: TestClient) -> None:
    """Reordering rewrites every photo's position to match the given list."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    first = _upload(client, business_id, product_id, filename="a.jpg").json()
    second = _upload(client, business_id, product_id, filename="b.jpg").json()
    third = _upload(client, business_id, product_id, filename="c.jpg").json()

    response = client.put(
        f"/businesses/{business_id}/products/{product_id}/images/order",
        json={"imageIds": [third["id"], first["id"], second["id"]]},
    )

    assert response.status_code == 200
    assert [img["id"] for img in response.json()] == [
        third["id"],
        first["id"],
        second["id"],
    ]
    listed = client.get(
        f"/businesses/{business_id}/products/{product_id}/images"
    ).json()
    assert [img["id"] for img in listed] == [third["id"], first["id"], second["id"]]


def test_reorder_rejects_a_list_missing_an_existing_photo(client: TestClient) -> None:
    """Every current photo must be named exactly once — a partial list
    would leave some photo's position ambiguous."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    first = _upload(client, business_id, product_id, filename="a.jpg").json()
    _upload(client, business_id, product_id, filename="b.jpg")

    response = client.put(
        f"/businesses/{business_id}/products/{product_id}/images/order",
        json={"imageIds": [first["id"]]},
    )

    assert response.status_code == 400


def test_reorder_rejects_an_id_from_a_different_product(client: TestClient) -> None:
    """Naming a photo that doesn't belong to this product is rejected, not
    silently ignored or reassigned to it."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_a = _create_product(client, business_id)
    product_b = _create_product(client, business_id)
    image_a = _upload(client, business_id, product_a).json()
    image_b = _upload(client, business_id, product_b).json()

    response = client.put(
        f"/businesses/{business_id}/products/{product_a}/images/order",
        json={"imageIds": [image_b["id"]]},
    )

    assert response.status_code == 400
    assert image_a  # sanity: product_a's own photo was never touched


def test_reorder_rejects_a_duplicated_id(client: TestClient) -> None:
    """The same id twice isn't a valid full ordering of a product's photos."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    image = _upload(client, business_id, product_id).json()

    response = client.put(
        f"/businesses/{business_id}/products/{product_id}/images/order",
        json={"imageIds": [image["id"], image["id"]]},
    )

    assert response.status_code == 400


def test_delete_image_requires_a_session(client: TestClient) -> None:
    """Deleting with no session cookie returns 401."""
    response = client.delete("/businesses/some-id/products/some-id/images/some-id")

    assert response.status_code == 401


def test_delete_image_removes_it(client: TestClient) -> None:
    """A deleted image no longer appears in the list or serves."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    image = _upload(client, business_id, product_id).json()

    delete_response = client.delete(
        f"/businesses/{business_id}/products/{product_id}/images/{image['id']}"
    )

    assert delete_response.status_code == 204
    listed = client.get(
        f"/businesses/{business_id}/products/{product_id}/images"
    ).json()
    assert listed == []
    served = client.get(f"/product-images/{image['id']}")
    assert served.status_code == 404


def test_delete_image_404s_for_a_nonexistent_image(client: TestClient) -> None:
    """Deleting an image that doesn't exist on this product returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    response = client.delete(
        f"/businesses/{business_id}/products/{product_id}/images/does-not-exist"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Product image not found"


def test_delete_image_404s_for_an_image_from_another_product(
    client: TestClient,
) -> None:
    """An image belonging to a different product can't be deleted through
    this one — same "not found" treatment as any other cross-resource
    ownership check in this app."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_a = _create_product(client, business_id)
    product_b = _create_product(client, business_id)
    image = _upload(client, business_id, product_a).json()

    response = client.delete(
        f"/businesses/{business_id}/products/{product_b}/images/{image['id']}"
    )

    assert response.status_code == 404


def test_serve_image_is_public_and_needs_no_session(client: TestClient) -> None:
    """Meta's own servers fetch this URL directly, with no session cookie —
    it must work unauthenticated (PRD.md §2 step 4)."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    image = _upload(client, business_id, product_id).json()
    client.post("/auth/logout")

    response = client.get(f"/product-images/{image['id']}")

    assert response.status_code == 200
    assert response.content == _JPEG_BYTES
    assert response.headers["content-type"] == "image/jpeg"


def test_serve_image_404s_for_a_nonexistent_image(client: TestClient) -> None:
    """A nonexistent image id 404s rather than serving empty/garbage bytes."""
    response = client.get("/product-images/does-not-exist")

    assert response.status_code == 404


def test_serve_image_404s_once_its_business_is_soft_deleted(client: TestClient) -> None:
    """A soft-deleted business's product image stops being served, even
    though this route isn't behind get_owned_business (Meta's own servers
    fetch it unauthenticated) and the row itself is untouched."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    image = _upload(client, business_id, product_id).json()

    client.delete(f"/businesses/{business_id}")

    response = client.get(f"/product-images/{image['id']}")

    assert response.status_code == 404
