"""avoidPhrases is frozen once a business has brand rules.

The banned phrases in BrandRules replace the free-text avoidPhrases list, so
once a business has a BrandRules row the old field can no longer change. The
brand profile form always sends the field back, so sending its stored value
unchanged stays fine.
"""

from typing import Any

from fastapi.testclient import TestClient

_AVOID = "Turn heads, Make a statement"


def _setup(client: TestClient, *, avoid: str | None = _AVOID) -> str:
    """Sign up, create a business and a brand profile, return the business id."""
    client.post(
        "/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )
    business_id = client.post(
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    client.post(f"/businesses/{business_id}/brand-profile", json=_profile(avoid))
    return str(business_id)


def _profile(avoid: str | None = None) -> dict[str, object]:
    body: dict[str, object] = {
        "description": "Handcrafted gold jewelry.",
        "idealCustomer": "Women 30-55.",
        "voiceTraits": ["WARM"],
        "pricePositioning": "PREMIUM",
    }
    if avoid is not None:
        body["avoidPhrases"] = avoid
    return body


def _freeze(client: TestClient, business_id: str) -> None:
    """Give the business brand rules, which is what freezes avoidPhrases."""
    client.put(
        f"/businesses/{business_id}/brand-rules", json={"bannedPhrases": ["cheap"]}
    )


def _patch(client: TestClient, business_id: str, body: dict[str, object]) -> Any:
    return client.patch(f"/businesses/{business_id}/brand-profile", json=body)


def _stored(client: TestClient, business_id: str) -> str | None:
    value = client.get(f"/businesses/{business_id}/brand-profile").json()[
        "avoidPhrases"
    ]
    return str(value) if value is not None else None


def test_without_brand_rules_avoid_phrases_still_edits(client: TestClient) -> None:
    """Nothing changes for a business that has no brand rules."""
    business_id = _setup(client)

    response = _patch(client, business_id, {"avoidPhrases": "Something else"})

    assert response.status_code == 200
    assert _stored(client, business_id) == "Something else"


def test_changing_avoid_phrases_is_refused_once_rules_exist(
    client: TestClient,
) -> None:
    """A different value is a 422 that points at brand rules, and nothing is saved."""
    business_id = _setup(client)
    _freeze(client, business_id)

    response = _patch(client, business_id, {"avoidPhrases": "Something else"})

    assert response.status_code == 422
    assert "brand rules" in response.json()["detail"].lower()
    assert _stored(client, business_id) == _AVOID


def test_clearing_avoid_phrases_counts_as_a_change(client: TestClient) -> None:
    """Emptying a stored list is refused too."""
    business_id = _setup(client)
    _freeze(client, business_id)

    assert _patch(client, business_id, {"avoidPhrases": None}).status_code == 422
    assert _patch(client, business_id, {"avoidPhrases": ""}).status_code == 422
    assert _stored(client, business_id) == _AVOID


def test_sending_the_stored_value_back_is_accepted(client: TestClient) -> None:
    """The form echoes the field, so the same value saves the other fields."""
    business_id = _setup(client)
    _freeze(client, business_id)

    response = _patch(
        client, business_id, {"avoidPhrases": _AVOID, "tagline": "New tagline"}
    )

    assert response.status_code == 200
    assert response.json()["tagline"] == "New tagline"
    assert _stored(client, business_id) == _AVOID


def test_other_fields_edit_freely_while_frozen(client: TestClient) -> None:
    """Leaving avoidPhrases out entirely is no problem."""
    business_id = _setup(client)
    _freeze(client, business_id)

    response = _patch(client, business_id, {"tagline": "Still editable"})

    assert response.status_code == 200
    assert response.json()["tagline"] == "Still editable"


def test_an_empty_field_can_be_echoed_as_null_or_blank(client: TestClient) -> None:
    """With nothing stored, null and blank both mean no change."""
    business_id = _setup(client, avoid=None)
    _freeze(client, business_id)

    assert _patch(client, business_id, {"avoidPhrases": None}).status_code == 200
    assert _patch(client, business_id, {"avoidPhrases": ""}).status_code == 200
    assert _patch(client, business_id, {"avoidPhrases": "New"}).status_code == 422


def test_deleting_the_rules_unfreezes_the_field(client: TestClient) -> None:
    """With no brand rules the old field is editable again."""
    business_id = _setup(client)
    _freeze(client, business_id)
    client.delete(f"/businesses/{business_id}/brand-rules")

    response = _patch(client, business_id, {"avoidPhrases": "Back to editing"})

    assert response.status_code == 200
    assert _stored(client, business_id) == "Back to editing"


def test_a_profile_created_after_the_rules_cannot_set_avoid_phrases(
    client: TestClient,
) -> None:
    """Creating a profile with avoidPhrases is refused when rules already exist."""
    client.post(
        "/auth/signup",
        json={
            "email": "owner@example.com",
            "password": "supersecret123",
            "termsAccepted": True,
        },
    )
    business_id = client.post(
        "/businesses", json={"name": "Acme", "industry": "FASHION_JEWELRY"}
    ).json()["id"]
    _freeze(client, business_id)
    url = f"/businesses/{business_id}/brand-profile"

    refused = client.post(url, json=_profile("Turn heads"))
    allowed = client.post(url, json=_profile())

    assert refused.status_code == 422
    assert allowed.status_code == 201
    assert allowed.json()["avoidPhrases"] is None
