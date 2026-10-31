"""Tests for the brand profile's key messages, customer problems and mechanisms.

Three lists of up to 10 entries (200 characters each), stored like proof points.
The Avatar Research Agent's prompt template reads them; nothing else does yet.
"""

import pytest
from fastapi.testclient import TestClient

from tests.test_brand_profile import _create_business, _signed_up_client, _valid_payload

FIELDS = ["keyMessages", "customerProblems", "mechanisms"]


def _url(business_id: str) -> str:
    return f"/businesses/{business_id}/brand-profile"


def _business(client: TestClient) -> str:
    _signed_up_client(client)
    return _create_business(client)


def test_a_profile_without_them_returns_empty_lists(client: TestClient) -> None:
    business_id = _business(client)

    body = client.post(_url(business_id), json=_valid_payload()).json()

    for field in FIELDS:
        assert body[field] == []


@pytest.mark.parametrize("field", FIELDS)
def test_each_list_round_trips_on_create_and_get(
    client: TestClient, field: str
) -> None:
    business_id = _business(client)

    created = client.post(
        _url(business_id), json=_valid_payload(**{field: ["First", "Second"]})
    )

    assert created.status_code == 201
    assert created.json()[field] == ["First", "Second"]
    assert client.get(_url(business_id)).json()[field] == ["First", "Second"]


@pytest.mark.parametrize("field", FIELDS)
def test_entries_are_trimmed_and_blanks_dropped(client: TestClient, field: str) -> None:
    business_id = _business(client)

    response = client.post(
        _url(business_id), json=_valid_payload(**{field: ["  Kept  ", "   ", ""]})
    )

    assert response.json()[field] == ["Kept"]


@pytest.mark.parametrize("field", FIELDS)
def test_an_entry_of_exactly_200_characters_is_accepted(
    client: TestClient, field: str
) -> None:
    business_id = _business(client)

    response = client.post(
        _url(business_id), json=_valid_payload(**{field: ["x" * 200] * 10})
    )

    assert response.status_code == 201


@pytest.mark.parametrize("field", FIELDS)
def test_201_characters_and_11_entries_are_rejected(
    client: TestClient, field: str
) -> None:
    business_id = _business(client)

    too_long = client.post(
        _url(business_id), json=_valid_payload(**{field: ["x" * 201]})
    )
    too_many = client.post(
        _url(business_id), json=_valid_payload(**{field: ["a"] * 11})
    )

    assert too_long.status_code == 422
    assert "200" in str(too_long.json())
    assert too_many.status_code == 422


@pytest.mark.parametrize("field", FIELDS)
def test_patch_replaces_clears_or_leaves_the_list(
    client: TestClient, field: str
) -> None:
    business_id = _business(client)
    client.post(_url(business_id), json=_valid_payload(**{field: ["Old"]}))

    replaced = client.patch(_url(business_id), json={field: ["New", "Newer"]})
    untouched = client.patch(_url(business_id), json={"tagline": "A tagline"})
    cleared = client.patch(_url(business_id), json={field: []})

    assert replaced.json()[field] == ["New", "Newer"]
    assert untouched.json()[field] == ["New", "Newer"]
    assert cleared.json()[field] == []
    assert client.get(_url(business_id)).json()[field] == []


def test_patch_validates_each_list(client: TestClient) -> None:
    business_id = _business(client)
    client.post(_url(business_id), json=_valid_payload())

    for field in FIELDS:
        response = client.patch(_url(business_id), json={field: ["x" * 201]})
        assert response.status_code == 422
