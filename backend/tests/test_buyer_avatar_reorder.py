"""Tests for reordering a business's buyer avatars (POST .../avatars/reorder)."""

from fastapi.testclient import TestClient

from tests.test_buyer_avatars import (
    _create_business,
    _payload,
    _signed_up_client,
    _url,
)


def _make(client: TestClient, business_id: str, name: str) -> str:
    response = client.post(_url(business_id), json=_payload(name=name))
    assert response.status_code == 201, response.text
    avatar_id: str = response.json()["id"]
    return avatar_id


def _three(client: TestClient) -> tuple[str, list[str]]:
    _signed_up_client(client)
    business_id = _create_business(client)
    return business_id, [_make(client, business_id, n) for n in ("A", "B", "C")]


def _names(client: TestClient, business_id: str) -> list[str]:
    return [a["name"] for a in client.get(_url(business_id)).json()]


def test_reorder_requires_a_session(client: TestClient) -> None:
    assert client.post(_url("b", "/reorder"), json={"ids": []}).status_code == 401


def test_reorder_sets_the_new_order_and_renumbers_sort_order(
    client: TestClient,
) -> None:
    business_id, (a, b, c) = _three(client)

    response = client.post(_url(business_id, "/reorder"), json={"ids": [c, a, b]})

    assert response.status_code == 200
    assert [x["name"] for x in response.json()] == ["C", "A", "B"]
    assert [x["sortOrder"] for x in response.json()] == [0, 1, 2]
    assert _names(client, business_id) == ["C", "A", "B"]


def test_reorder_keeps_inactive_avatars_in_the_list(client: TestClient) -> None:
    business_id, (a, b, c) = _three(client)
    client.patch(_url(business_id, f"/{b}"), json={"isActive": False})

    response = client.post(_url(business_id, "/reorder"), json={"ids": [b, c, a]})

    assert response.status_code == 200
    assert _names(client, business_id) == ["B", "C", "A"]


def test_reorder_must_name_every_avatar_exactly_once(client: TestClient) -> None:
    business_id, (a, b, c) = _three(client)

    missing = client.post(_url(business_id, "/reorder"), json={"ids": [a, b]})
    extra = client.post(_url(business_id, "/reorder"), json={"ids": [a, b, c, "zzz"]})
    duplicate = client.post(_url(business_id, "/reorder"), json={"ids": [a, a, b, c]})

    assert missing.status_code == 409
    assert extra.status_code == 409
    assert duplicate.status_code == 422
    assert _names(client, business_id) == ["A", "B", "C"]  # nothing changed


def test_reorder_does_not_count_a_deleted_avatar(client: TestClient) -> None:
    business_id, (a, b, c) = _three(client)
    client.delete(_url(business_id, f"/{b}"))

    stale = client.post(_url(business_id, "/reorder"), json={"ids": [a, b, c]})
    ok = client.post(_url(business_id, "/reorder"), json={"ids": [c, a]})

    assert stale.status_code == 409  # the client's list is out of date
    assert ok.status_code == 200
    assert _names(client, business_id) == ["C", "A"]


def test_reorder_cannot_touch_another_users_business(client: TestClient) -> None:
    business_id, (a, b, c) = _three(client)
    client.post("/auth/logout")
    _signed_up_client(client, email="intruder@example.com")

    response = client.post(_url(business_id, "/reorder"), json={"ids": [c, b, a]})

    assert response.status_code == 404


def test_reorder_of_an_empty_library_is_fine(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_url(business_id, "/reorder"), json={"ids": []})

    assert response.status_code == 200
    assert response.json() == []
