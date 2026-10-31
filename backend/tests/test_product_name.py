"""Tests for Product.name: an optional label the owner types, up to 80 characters."""

from fastapi.testclient import TestClient

from tests.test_product import _create_business, _signed_up_client


def _setup(client: TestClient) -> str:
    _signed_up_client(client)
    return _create_business(client)


def _products(business_id: str, suffix: str = "") -> str:
    return f"/businesses/{business_id}/products{suffix}"


def test_a_product_has_no_name_unless_given(client: TestClient) -> None:
    business_id = _setup(client)

    body = client.post(_products(business_id), json={"description": "A ring"}).json()

    assert body["name"] is None


def test_create_with_a_name_trims_it(client: TestClient) -> None:
    business_id = _setup(client)

    response = client.post(
        _products(business_id),
        json={"description": "A ring", "name": "  Geo Ring  "},
    )

    assert response.status_code == 201
    assert response.json()["name"] == "Geo Ring"
    listed = client.get(_products(business_id)).json()
    assert [p["name"] for p in listed] == ["Geo Ring"]


def test_a_blank_name_is_stored_as_no_name(client: TestClient) -> None:
    business_id = _setup(client)

    response = client.post(
        _products(business_id), json={"description": "A ring", "name": "   "}
    )

    assert response.status_code == 201
    assert response.json()["name"] is None


def test_a_name_is_capped_at_80_characters(client: TestClient) -> None:
    business_id = _setup(client)

    ok = client.post(
        _products(business_id), json={"description": "A ring", "name": "n" * 80}
    )
    too_long = client.post(
        _products(business_id), json={"description": "A ring", "name": "n" * 81}
    )

    assert ok.status_code == 201
    assert too_long.status_code == 422


def test_patch_sets_clears_and_leaves_the_name(client: TestClient) -> None:
    business_id = _setup(client)
    product_id = client.post(
        _products(business_id), json={"description": "A ring"}
    ).json()["id"]
    url = _products(business_id, f"/{product_id}")

    named = client.patch(url, json={"name": "Geo Ring"})
    other_edit = client.patch(url, json={"description": "A bigger ring"})
    cleared = client.patch(url, json={"name": None})

    assert named.json()["name"] == "Geo Ring"
    assert other_edit.json()["name"] == "Geo Ring"
    assert other_edit.json()["description"] == "A bigger ring"
    assert cleared.json()["name"] is None


def test_patch_rejects_a_name_over_80_characters(client: TestClient) -> None:
    business_id = _setup(client)
    product_id = client.post(
        _products(business_id), json={"description": "A ring"}
    ).json()["id"]

    response = client.patch(
        _products(business_id, f"/{product_id}"), json={"name": "n" * 81}
    )

    assert response.status_code == 422
