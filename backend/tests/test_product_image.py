"""Tests for product image upload endpoints (PRD.md §2 step 4)."""

import httpx2
from app.schemas.product_image import MAX_IMAGE_BYTES
from fastapi.testclient import TestClient

_JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"fake jpeg content"


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
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
    assert "createdAt" in body


def test_upload_accepts_png_and_webp(client: TestClient) -> None:
    """png and webp are supported alongside jpeg."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)

    png_response = _upload(
        client, business_id, product_id, filename="ring.png", content_type="image/png"
    )
    webp_response = _upload(
        client,
        business_id,
        product_id,
        filename="ring.webp",
        content_type="image/webp",
    )

    assert png_response.status_code == 201
    assert webp_response.status_code == 201


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


def test_list_images_returns_oldest_first(client: TestClient) -> None:
    """Multiple uploads list in upload order."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = _create_product(client, business_id)
    first = _upload(client, business_id, product_id, filename="a.jpg").json()
    second = _upload(client, business_id, product_id, filename="b.jpg").json()

    response = client.get(f"/businesses/{business_id}/products/{product_id}/images")

    assert response.status_code == 200
    ids = [img["id"] for img in response.json()]
    assert ids == [first["id"], second["id"]]


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
