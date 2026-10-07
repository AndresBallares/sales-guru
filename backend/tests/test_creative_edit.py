"""Tests for editing one creative: swap its image, regenerate its copy.

Both work on any ad the user is reviewing (selected or not) in the controlled
creative test and the standard flow, and are refused once a creative test is
published, same as selecting/deselecting.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.schemas.creative import GeneratedCreativeVariant
from fastapi.testclient import TestClient

from tests.test_creative_test_plan_publish import (
    _campaign_status,  # noqa: F401
    _creative_plan_campaign,
    _creatives,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def _variant(letter: str, **overrides: Any) -> GeneratedCreativeVariant:
    fields: dict[str, Any] = {
        "headline": f"Fresh headline {letter}",
        "body_text": f"Fresh primary text {letter}. It reads well and stops here.",
        "description": f"Fresh description {letter}",
        "cta": "SHOP_NOW",
        "creative_angle": f"Angle {letter}",
        "image_prompt": "img",
        "video_prompt": "vid",
    }
    fields.update(overrides)
    return GeneratedCreativeVariant(**fields)


@pytest.fixture
def regenerated(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    mock = AsyncMock(return_value=[_variant(letter) for letter in "ABCD"])
    monkeypatch.setattr(creative_module, "generate_creatives", mock)
    return mock


def _url(business_id: str, campaign_id: str, creative_id: str, tail: str) -> str:
    return (
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creative_id}/{tail}"
    )


def _photo_ids(client: TestClient, business_id: str) -> list[str]:
    product_id = client.get(f"/businesses/{business_id}/products").json()[0]["id"]
    images = client.get(f"/businesses/{business_id}/products/{product_id}/images")
    return [image["id"] for image in images.json()]


# ── Change the image ─────────────────────────────────────────


def test_an_ad_can_be_given_a_different_photo_without_being_selected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False, photo_count=2
    )
    unselected = _creatives(client, business_id, campaign_id)[3]
    second_photo = _photo_ids(client, business_id)[1]

    response = client.put(
        _url(business_id, campaign_id, unselected["id"], "image"),
        json={"productImageId": second_photo},
    )

    assert response.status_code == 200
    assert response.json()["imageUrl"].endswith(second_photo)
    assert response.json()["status"] == "GENERATED"


def test_changing_an_image_keeps_the_ad_selected_and_the_test_pending(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False, photo_count=2
    )
    second_photo = _photo_ids(client, business_id)[1]

    response = client.put(
        _url(business_id, campaign_id, selected[0], "image"),
        json={"productImageId": second_photo},
    )

    assert response.json()["status"] == "SELECTED"
    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_changing_an_approved_ads_image_requires_approving_again(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=True, photo_count=2
    )
    assert _campaign_status(client, business_id, campaign_id) == "APPROVED"

    client.put(
        _url(business_id, campaign_id, selected[0], "image"),
        json={"productImageId": _photo_ids(client, business_id)[1]},
    )

    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_a_photo_from_another_product_is_rejected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )

    response = client.put(
        _url(business_id, campaign_id, selected[0], "image"),
        json={"productImageId": "not-this-products-photo"},
    )

    assert response.status_code == 404


def test_changing_the_image_404s_for_an_unknown_creative(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    response = client.put(
        _url(business_id, campaign_id, "nope", "image"),
        json={"productImageId": "x"},
    )

    assert response.status_code == 404


def test_a_published_creative_tests_images_are_fixed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=True, photo_count=2
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    response = client.put(
        _url(business_id, campaign_id, selected[0], "image"),
        json={"productImageId": _photo_ids(client, business_id)[1]},
    )

    assert response.status_code == 400


# ── Regenerate the copy ──────────────────────────────────────


def test_regenerating_the_headline_replaces_only_the_headline(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    before = next(
        c
        for c in _creatives(client, business_id, campaign_id)
        if c["id"] == selected[0]
    )

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 200
    after = response.json()
    assert after["headline"].startswith("Fresh headline")
    assert after["bodyText"] == before["bodyText"]
    assert after["description"] == before["description"]


def test_regenerating_the_primary_text_replaces_only_the_primary_text(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    before = next(
        c
        for c in _creatives(client, business_id, campaign_id)
        if c["id"] == selected[0]
    )

    after = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["bodyText"]},
    ).json()

    assert after["bodyText"].startswith("Fresh primary text")
    assert after["headline"] == before["headline"]


def test_several_fields_can_be_regenerated_at_once(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )

    after = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline", "bodyText", "description"]},
    ).json()

    assert after["headline"].startswith("Fresh headline")
    assert after["bodyText"].startswith("Fresh primary text")
    assert after["description"].startswith("Fresh description")


def test_regeneration_keeps_the_ads_creative_angle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    """The ad is one of the test's angles: new words, same angle."""
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    before = next(
        c
        for c in _creatives(client, business_id, campaign_id)
        if c["id"] == selected[0]
    )
    regenerated.return_value = [
        _variant("X", creative_angle="Something else entirely"),
        _variant("Y", creative_angle=before["creativeAngle"], headline="On angle"),
    ]

    after = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    ).json()

    assert after["headline"] == "On angle"
    assert after["creativeAngle"] == before["creativeAngle"]


def test_regenerating_an_approved_ad_requires_approving_again(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=True
    )

    client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_regenerating_needs_at_least_one_field(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": []},
    )

    assert response.status_code == 422


def test_regenerating_rejects_an_unknown_field(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["cta"]},
    )

    assert response.status_code == 422


def test_regenerating_404s_for_an_unknown_creative(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    response = client.post(
        _url(business_id, campaign_id, "nope", "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 404


def test_regenerating_surfaces_agent_failures_as_500(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    from app.services.creative import CreativeAgentError

    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)
    regenerated.side_effect = CreativeAgentError("model down")

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 500
    assert "model down" in response.json()["detail"]


def test_a_published_creative_tests_copy_is_fixed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, regenerated: AsyncMock
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=True
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 400
