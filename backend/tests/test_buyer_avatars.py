"""Tests for the per-business buyer avatar library endpoints."""

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma


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


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": "Deadline Gift-Giver",
        "who": "Someone with a birthday or anniversary days away who wants a "
        "gift that looks chosen, not rushed.",
        "primaryProblems": ["Has no idea what to buy", "Needs it to arrive in time"],
        "unknownProblems": ["Plated jewelry can tarnish within weeks"],
        "mechanisms": ["Solid gold: it will not fade or turn skin green"],
        "alternatives": ["Department-store necklaces", "Gift cards"],
        "objections": ["Is it worth the price?"],
        "hooks": [
            "Forgot the anniversary? Still time.",
            "Gold that outlasts the card.",
        ],
        "creativeAngles": ["last-minute rescue", "gift that feels chosen"],
    }
    payload.update(overrides)
    return payload


def _url(business_id: str, suffix: str = "") -> str:
    return f"/businesses/{business_id}/avatars{suffix}"


def test_every_avatar_route_requires_a_session(client: TestClient) -> None:
    """With no session cookie each route returns 401."""
    assert client.get(_url("b")).status_code == 401
    assert client.post(_url("b"), json=_payload()).status_code == 401
    assert client.get(_url("b", "/a")).status_code == 401
    assert client.patch(_url("b", "/a"), json={}).status_code == 401
    assert client.delete(_url("b", "/a")).status_code == 401


def test_avatar_routes_404_for_a_nonexistent_business(client: TestClient) -> None:
    """A business that does not exist is a 404, not an empty list."""
    _signed_up_client(client)

    assert client.get(_url("nope")).status_code == 404
    assert client.post(_url("nope"), json=_payload()).status_code == 404


def test_avatar_routes_404_for_another_users_business(client: TestClient) -> None:
    """A user cannot read or write another user's avatar library."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")

    assert client.get(_url(business_id)).status_code == 404
    assert client.post(_url(business_id), json=_payload()).status_code == 404
    assert client.get(_url(business_id, f"/{avatar_id}")).status_code == 404
    assert client.delete(_url(business_id, f"/{avatar_id}")).status_code == 404


def test_create_avatar_returns_every_field(client: TestClient) -> None:
    """A created avatar echoes its lists, starts active and gets sort order 0."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_url(business_id), json=_payload())

    assert response.status_code == 201
    body = response.json()
    assert body["businessId"] == business_id
    assert body["name"] == "Deadline Gift-Giver"
    assert body["primaryProblems"] == [
        "Has no idea what to buy",
        "Needs it to arrive in time",
    ]
    assert body["unknownProblems"] == ["Plated jewelry can tarnish within weeks"]
    assert body["mechanisms"] == ["Solid gold: it will not fade or turn skin green"]
    assert body["alternatives"] == ["Department-store necklaces", "Gift cards"]
    assert body["objections"] == ["Is it worth the price?"]
    assert body["hooks"] == [
        "Forgot the anniversary? Still time.",
        "Gold that outlasts the card.",
    ]
    assert body["creativeAngles"] == ["last-minute rescue", "gift that feels chosen"]
    assert body["isActive"] is True
    assert body["sortOrder"] == 0
    assert body["id"]


def test_create_avatar_with_only_the_required_fields(client: TestClient) -> None:
    """Only name and who are required; every list defaults to empty."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        _url(business_id), json={"name": "Self-Treater", "who": "Buys for herself."}
    )

    assert response.status_code == 201
    body = response.json()
    for field in (
        "primaryProblems",
        "unknownProblems",
        "mechanisms",
        "alternatives",
        "objections",
        "hooks",
        "creativeAngles",
    ):
        assert body[field] == []


def test_new_avatars_go_to_the_end_unless_given_a_sort_order(
    client: TestClient,
) -> None:
    """sortOrder defaults to one past the highest; an explicit value is kept."""
    _signed_up_client(client)
    business_id = _create_business(client)

    first = client.post(_url(business_id), json=_payload(name="A")).json()
    second = client.post(_url(business_id), json=_payload(name="B")).json()
    explicit = client.post(
        _url(business_id), json=_payload(name="C", sortOrder=-1)
    ).json()

    assert (first["sortOrder"], second["sortOrder"], explicit["sortOrder"]) == (
        0,
        1,
        -1,
    )
    names = [a["name"] for a in client.get(_url(business_id)).json()]
    assert names == ["C", "A", "B"]


def test_list_can_be_filtered_to_active_avatars(client: TestClient) -> None:
    """?active=true leaves out deactivated avatars; the default lists all."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.post(_url(business_id), json=_payload(name="On"))
    client.post(_url(business_id), json=_payload(name="Off", isActive=False))

    everything = client.get(_url(business_id)).json()
    active = client.get(_url(business_id), params={"active": "true"}).json()
    inactive = client.get(_url(business_id), params={"active": "false"}).json()

    assert [a["name"] for a in everything] == ["On", "Off"]
    assert [a["name"] for a in active] == ["On"]
    assert [a["name"] for a in inactive] == ["Off"]


def test_a_business_only_sees_its_own_avatars(client: TestClient) -> None:
    """Avatars are scoped to their business."""
    _signed_up_client(client)
    first = _create_business(client, "First")
    second = _create_business(client, "Second")
    client.post(_url(first), json=_payload())

    assert client.get(_url(second)).json() == []
    assert len(client.get(_url(first)).json()) == 1


def test_get_one_avatar_and_its_404s(client: TestClient) -> None:
    """GET by id returns it; an unknown id, or one from another business, is a 404."""
    _signed_up_client(client)
    first = _create_business(client, "First")
    second = _create_business(client, "Second")
    avatar_id = client.post(_url(first), json=_payload()).json()["id"]

    assert (
        client.get(_url(first, f"/{avatar_id}")).json()["name"] == "Deadline Gift-Giver"
    )
    assert client.get(_url(first, "/missing")).status_code == 404
    assert client.get(_url(second, f"/{avatar_id}")).status_code == 404


def test_patch_changes_only_the_fields_sent(client: TestClient) -> None:
    """A partial update leaves the other fields alone; a list is replaced whole."""
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]

    response = client.patch(
        _url(business_id, f"/{avatar_id}"),
        json={"name": "Renamed", "hooks": ["Only one"], "isActive": False},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Renamed"
    assert body["hooks"] == ["Only one"]
    assert body["isActive"] is False
    assert body["objections"] == ["Is it worth the price?"]
    assert body["who"].startswith("Someone with a birthday")


def test_patch_with_an_empty_list_clears_it(client: TestClient) -> None:
    """An explicit empty list empties a field; null leaves it unchanged."""
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]

    cleared = client.patch(
        _url(business_id, f"/{avatar_id}"), json={"alternatives": [], "hooks": None}
    ).json()

    assert cleared["alternatives"] == []
    assert len(cleared["hooks"]) == 2


def test_patch_with_no_fields_changes_nothing(client: TestClient) -> None:
    """An empty body returns the avatar as it is."""
    _signed_up_client(client)
    business_id = _create_business(client)
    created = client.post(_url(business_id), json=_payload()).json()

    response = client.patch(_url(business_id, f"/{created['id']}"), json={})

    assert response.status_code == 200
    assert response.json() == created


def test_patch_404s_for_an_unknown_avatar(client: TestClient) -> None:
    """Patching an id that is not in this business is a 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    assert (
        client.patch(_url(business_id, "/missing"), json={"name": "x"}).status_code
        == 404
    )


def test_delete_hides_the_avatar_from_every_live_read(client: TestClient) -> None:
    """DELETE returns 204; the avatar then drops out of reads and writes."""
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]

    response = client.delete(_url(business_id, f"/{avatar_id}"))

    assert response.status_code == 204
    assert client.get(_url(business_id)).json() == []
    assert client.get(_url(business_id), params={"active": "true"}).json() == []
    assert client.get(_url(business_id, f"/{avatar_id}")).status_code == 404
    assert (
        client.patch(_url(business_id, f"/{avatar_id}"), json={"name": "x"}).status_code
        == 404
    )
    assert client.delete(_url(business_id, f"/{avatar_id}")).status_code == 404


@pytest.mark.asyncio
async def test_delete_keeps_the_row_and_stamps_deleted_at(client: TestClient) -> None:
    """The avatar is soft deleted: the row stays, with deletedAt set."""
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]
    client.delete(_url(business_id, f"/{avatar_id}"))

    db = Prisma()
    await db.connect()
    row = await db.buyeravatar.find_unique(where={"id": avatar_id})
    await db.disconnect()

    assert row is not None
    assert row.deletedAt is not None
    assert row.name == "Deadline Gift-Giver"


def test_a_live_avatar_reports_no_deleted_at(client: TestClient) -> None:
    """deletedAt is null in a live avatar's response."""
    _signed_up_client(client)
    business_id = _create_business(client)

    body = client.post(_url(business_id), json=_payload()).json()

    assert body["deletedAt"] is None


def test_a_deleted_avatar_still_resolves_when_asked_for(client: TestClient) -> None:
    """includeDeleted lets old angles and results be labeled with a removed avatar."""
    _signed_up_client(client)
    business_id = _create_business(client)
    gone = client.post(_url(business_id), json=_payload(name="Gone")).json()["id"]
    kept = client.post(_url(business_id), json=_payload(name="Kept")).json()["id"]
    client.delete(_url(business_id, f"/{gone}"))

    one = client.get(_url(business_id, f"/{gone}"), params={"includeDeleted": "true"})
    everything = client.get(_url(business_id), params={"includeDeleted": "true"})
    live_only = client.get(_url(business_id))

    assert one.status_code == 200
    assert one.json()["name"] == "Gone"
    assert one.json()["deletedAt"] is not None
    by_name = {a["name"]: a for a in everything.json()}
    assert set(by_name) == {"Gone", "Kept"}
    assert by_name["Gone"]["deletedAt"] is not None
    assert by_name["Kept"]["deletedAt"] is None
    assert [a["id"] for a in live_only.json()] == [kept]


def test_include_deleted_does_not_cross_businesses(client: TestClient) -> None:
    """A deleted avatar resolves only inside its own business."""
    _signed_up_client(client)
    first = _create_business(client, "First")
    second = _create_business(client, "Second")
    gone = client.post(_url(first), json=_payload()).json()["id"]
    client.delete(_url(first, f"/{gone}"))

    response = client.get(_url(second, f"/{gone}"), params={"includeDeleted": "true"})

    assert response.status_code == 404


def test_a_business_holds_at_most_twelve_avatars(client: TestClient) -> None:
    """The thirteenth avatar is refused, and deleting one makes room."""
    _signed_up_client(client)
    business_id = _create_business(client)
    ids = [
        client.post(_url(business_id), json=_payload(name=f"Avatar {n}")).json()["id"]
        for n in range(12)
    ]

    refused = client.post(_url(business_id), json=_payload(name="One too many"))

    assert refused.status_code == 409
    assert "12" in refused.json()["detail"]
    client.delete(_url(business_id, f"/{ids[0]}"))
    assert (
        client.post(_url(business_id), json=_payload(name="Fits now")).status_code
        == 201
    )


def test_text_fields_are_trimmed_and_blank_list_items_dropped(
    client: TestClient,
) -> None:
    """Whitespace is stripped from every text field and blank list items vanish."""
    _signed_up_client(client)
    business_id = _create_business(client)

    body = client.post(
        _url(business_id),
        json=_payload(
            name="  Spaced  ", who="  Wide.  ", hooks=["  keep  ", "   ", ""]
        ),
    ).json()

    assert body["name"] == "Spaced"
    assert body["who"] == "Wide."
    assert body["hooks"] == ["keep"]


def test_name_and_who_cannot_be_blank(client: TestClient) -> None:
    """A name or who of only whitespace is a 422, on create and on patch."""
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]

    assert client.post(_url(business_id), json=_payload(name="   ")).status_code == 422
    assert client.post(_url(business_id), json=_payload(who="")).status_code == 422
    assert (
        client.patch(_url(business_id, f"/{avatar_id}"), json={"name": " "}).status_code
        == 422
    )
    assert (
        client.patch(_url(business_id, f"/{avatar_id}"), json={"who": " "}).status_code
        == 422
    )


def test_size_caps_keep_prompts_small(client: TestClient) -> None:
    """Over-long text, over-long list items and too many items are all 422s."""
    _signed_up_client(client)
    business_id = _create_business(client)

    assert (
        client.post(_url(business_id), json=_payload(name="n" * 61)).status_code == 422
    )
    assert (
        client.post(_url(business_id), json=_payload(who="w" * 601)).status_code == 422
    )
    assert (
        client.post(_url(business_id), json=_payload(who="w" * 600)).status_code == 201
    )
    assert (
        client.post(_url(business_id), json=_payload(hooks=["h" * 201])).status_code
        == 422
    )
    assert (
        client.post(_url(business_id), json=_payload(hooks=["h"] * 9)).status_code
        == 422
    )
    assert (
        client.post(_url(business_id), json=_payload(objections=["o"] * 9)).status_code
        == 422
    )
    assert (
        client.post(
            _url(business_id), json=_payload(creativeAngles=["a"] * 11)
        ).status_code
        == 422
    )
    assert (
        client.post(_url(business_id), json=_payload(mechanisms=["m"] * 7)).status_code
        == 422
    )


def test_blank_items_do_not_count_toward_the_list_cap(client: TestClient) -> None:
    """Eight real hooks plus blanks is fine: only the cleaned list is counted."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        _url(business_id), json=_payload(hooks=[f"hook {n}" for n in range(8)] + [" "])
    )

    assert response.status_code == 201
    assert len(response.json()["hooks"]) == 8


def test_patch_can_reorder_an_avatar(client: TestClient) -> None:
    """sortOrder is patchable, and the list follows it."""
    _signed_up_client(client)
    business_id = _create_business(client)
    first = client.post(_url(business_id), json=_payload(name="A")).json()
    client.post(_url(business_id), json=_payload(name="B"))

    moved = client.patch(_url(business_id, f"/{first['id']}"), json={"sortOrder": 5})

    assert moved.json()["sortOrder"] == 5
    assert [a["name"] for a in client.get(_url(business_id)).json()] == ["B", "A"]


def test_patch_with_only_nulls_changes_nothing(client: TestClient) -> None:
    """Null means unchanged, so a body of nulls is a no-op, not an error."""
    _signed_up_client(client)
    business_id = _create_business(client)
    created = client.post(_url(business_id), json=_payload()).json()

    response = client.patch(
        _url(business_id, f"/{created['id']}"), json={"name": None, "isActive": None}
    )

    assert response.status_code == 200
    assert response.json() == created
