"""Tests for the per-business brand rules endpoints (banned phrases, disclosures)."""

from fastapi.testclient import TestClient


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


def _url(business_id: str) -> str:
    return f"/businesses/{business_id}/brand-rules"


def test_brand_rules_routes_require_a_session(client: TestClient) -> None:
    """With no session cookie each route returns 401."""
    assert client.get(_url("b")).status_code == 401
    assert client.put(_url("b"), json={}).status_code == 401
    assert client.delete(_url("b")).status_code == 401


def test_brand_rules_404_for_a_nonexistent_or_foreign_business(
    client: TestClient,
) -> None:
    """Rules of a business that is not yours do not exist as far as you can tell."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    client.put(_url(business_id), json={"bannedPhrases": ["cheap"]})
    client.post("/auth/logout")
    _signed_up_client(client, email="bob@example.com")

    assert client.get(_url("nope")).status_code == 404
    assert client.get(_url(business_id)).status_code == 404
    assert client.put(_url(business_id), json={"bannedPhrases": []}).status_code == 404
    assert client.delete(_url(business_id)).status_code == 404


def test_a_business_with_no_rules_reads_as_empty_lists(client: TestClient) -> None:
    """GET before any PUT is 200 with empty lists, not a 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.get(_url(business_id))

    assert response.status_code == 200
    assert response.json() == {
        "businessId": business_id,
        "bannedPhrases": [],
        "requiredDisclosures": [],
    }


def test_put_creates_then_replaces_the_rules(client: TestClient) -> None:
    """PUT is an upsert: the second call replaces the first whole."""
    _signed_up_client(client)
    business_id = _create_business(client)

    first = client.put(
        _url(business_id),
        json={
            "bannedPhrases": ["Elevate your style", "timeless elegance"],
            "requiredDisclosures": ["Made to order: ships in 2 weeks"],
        },
    )
    second = client.put(_url(business_id), json={"bannedPhrases": ["cheap"]})

    assert first.status_code == 200
    assert first.json()["bannedPhrases"] == ["Elevate your style", "timeless elegance"]
    assert first.json()["requiredDisclosures"] == ["Made to order: ships in 2 weeks"]
    assert second.json()["bannedPhrases"] == ["cheap"]
    assert second.json()["requiredDisclosures"] == []
    assert client.get(_url(business_id)).json()["bannedPhrases"] == ["cheap"]


def test_delete_clears_the_rules(client: TestClient) -> None:
    """DELETE returns 204 and the rules read as empty again; repeating it is fine."""
    _signed_up_client(client)
    business_id = _create_business(client)
    client.put(_url(business_id), json={"bannedPhrases": ["cheap"]})

    assert client.delete(_url(business_id)).status_code == 204
    assert client.get(_url(business_id)).json()["bannedPhrases"] == []
    assert client.delete(_url(business_id)).status_code == 204


def test_phrases_are_trimmed_and_deduplicated_ignoring_case(
    client: TestClient,
) -> None:
    """Blanks vanish and a repeat in another case keeps the first spelling."""
    _signed_up_client(client)
    business_id = _create_business(client)

    body = client.put(
        _url(business_id),
        json={
            "bannedPhrases": ["  Turn heads ", "", "turn heads", "TURN  HEADS", "cheap"]
        },
    ).json()

    assert body["bannedPhrases"] == ["Turn heads", "cheap"]


def test_a_phrase_needs_a_letter_or_digit(client: TestClient) -> None:
    """A phrase of only punctuation could never match whole words, so it is a 422."""
    _signed_up_client(client)
    business_id = _create_business(client)

    assert (
        client.put(_url(business_id), json={"bannedPhrases": ["!!!"]}).status_code
        == 422
    )
    assert (
        client.put(_url(business_id), json={"bannedPhrases": ["18k"]}).status_code
        == 200
    )


def test_size_caps_keep_prompts_small(client: TestClient) -> None:
    """Too many or too long phrases and disclosures are 422s."""
    _signed_up_client(client)
    business_id = _create_business(client)

    too_many = [f"phrase {n}" for n in range(51)]
    assert (
        client.put(_url(business_id), json={"bannedPhrases": too_many}).status_code
        == 422
    )
    assert (
        client.put(_url(business_id), json={"bannedPhrases": too_many[:50]}).status_code
        == 200
    )
    assert (
        client.put(_url(business_id), json={"bannedPhrases": ["p" * 81]}).status_code
        == 422
    )
    assert (
        client.put(
            _url(business_id), json={"requiredDisclosures": ["d"] * 11}
        ).status_code
        == 422
    )
    assert (
        client.put(
            _url(business_id), json={"requiredDisclosures": ["d" * 201]}
        ).status_code
        == 422
    )
    assert (
        client.put(
            _url(business_id), json={"requiredDisclosures": ["d" * 200]}
        ).status_code
        == 200
    )
