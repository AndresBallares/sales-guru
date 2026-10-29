"""Follow-ups to a creative test's distinct text and Personalized angle.

A single-ad regenerate is checked against the test's other ads, and editing a
product's personalization makes its unpublished ads stale (published ones are
left alone).
"""

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.schemas.creative import GeneratedCreativeBatch, GeneratedCreativeVariant
from app.services.creative import is_creative_stale, personalization_snapshot
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tests.test_creative_edit import _url, regenerated  # noqa: F401
from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    _creatives,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

# ---------- a single-ad regenerate is compared with the other ads ----------

_OTHERS = [
    ("Worn every single day", "From coffee runs to date nights, it keeps up."),
    ("Handmade in New York", "Each piece is poured, enameled and finished by hand."),
    ("She will keep it forever", "Give her something she will wear for decades."),
]


def _one(headline: str, body: str) -> dict[str, Any]:
    return {
        "variants": [
            GeneratedCreativeVariant(
                headline=headline,
                body_text=body,
                description=None,
                cta="SHOP_NOW",
                creative_angle="Angle",
            ).model_dump(by_alias=True)
        ]
    }


def _validate(raw: dict[str, Any], **context: Any) -> None:
    GeneratedCreativeBatch.model_validate(
        raw, context={"variant_count": 1, "distinct_text": True, **context}
    )


def test_a_regenerated_headline_that_copies_another_ad_is_rejected() -> None:
    with pytest.raises(ValidationError, match="different headline"):
        _validate(
            _one("Worn every single day.", "A brand new line of text."),
            other_texts=_OTHERS,
        )


def test_a_regenerated_primary_text_that_copies_another_ad_is_rejected() -> None:
    with pytest.raises(ValidationError, match="different primary text"):
        _validate(
            _one(
                "Something new entirely",
                "Each piece is poured, enameled and finished by hand.",
            ),
            other_texts=_OTHERS,
        )


def test_a_clearly_different_regenerate_passes() -> None:
    _validate(
        _one("Loved by 2,000 buyers", "Our customers keep coming back."),
        other_texts=_OTHERS,
    )


def test_only_the_fields_being_replaced_are_compared() -> None:
    """Regenerating the primary text must not fail on a headline it won't keep."""
    _validate(
        _one("Worn every single day.", "A brand new line of text."),
        other_texts=_OTHERS,
        check_fields=("bodyText",),
    )


def test_the_other_ads_are_not_compared_with_each_other() -> None:
    twins = [_OTHERS[0], _OTHERS[0]]

    _validate(
        _one("Loved by 2,000 buyers", "Our customers keep coming back."),
        other_texts=twins,
    )


def test_other_campaigns_are_not_checked() -> None:
    GeneratedCreativeBatch.model_validate(
        _one("Worn every single day", "From coffee runs to date nights, it keeps up."),
        context={"variant_count": 1, "other_texts": _OTHERS},
    )


def test_the_regenerate_endpoint_hands_over_the_other_ads(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    regenerated: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    everyone = {c["id"]: c for c in _creatives(client, business_id, campaign_id)}

    response = client.post(
        _url(business_id, campaign_id, selected[0], "regenerate"),
        json={"fields": ["headline"]},
    )

    assert response.status_code == 200
    assert regenerated.await_args is not None
    kwargs = regenerated.await_args.kwargs
    assert sorted(kwargs["other_texts"]) == sorted(
        (c["headline"], c["bodyText"])
        for cid, c in everyone.items()
        if cid != selected[0]
    )
    assert kwargs["check_fields"] == ("headline",)


# ---------- editing the personalization makes unpublished ads stale ----------


def _product(**overrides: object) -> Any:
    defaults: dict[str, object] = {
        "description": "Ring",
        "url": "https://a.co/p",
        "personalizable": False,
        "personalizationOptions": None,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def _creative(snapshot: str | None, **overrides: object) -> Any:
    fields: dict[str, object] = {
        "sourceBusinessDescription": "Biz",
        "sourceProductId": "p1",
        "sourceDescription": "Ring",
        "sourceUrl": "https://a.co/p",
        "sourcePersonalization": snapshot,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _campaign(**overrides: object) -> Any:
    fields: dict[str, object] = {"productId": "p1", "metaCampaignId": None}
    fields.update(overrides)
    return SimpleNamespace(**fields)


_BUSINESS: Any = SimpleNamespace(description="Biz")


def test_the_snapshot_is_empty_unless_the_product_is_personalizable() -> None:
    assert personalization_snapshot(_product()) == ""
    assert personalization_snapshot(None) == ""
    assert personalization_snapshot(_product(personalizable=True)) == "1|"
    assert (
        personalization_snapshot(
            _product(personalizable=True, personalizationOptions=" 6 colors ")
        )
        == "1|6 colors"
    )


def test_an_older_ad_with_no_snapshot_is_not_stale_for_a_plain_product() -> None:
    assert not is_creative_stale(_creative(None), _campaign(), _product(), _BUSINESS)


def test_turning_personalization_on_makes_an_unpublished_ad_stale() -> None:
    product = _product(personalizable=True)

    assert is_creative_stale(_creative(""), _campaign(), product, _BUSINESS)


def test_changing_the_options_makes_an_unpublished_ad_stale() -> None:
    before = personalization_snapshot(
        _product(personalizable=True, personalizationOptions="6 colors")
    )
    product = _product(personalizable=True, personalizationOptions="3 colors")

    assert is_creative_stale(_creative(before), _campaign(), product, _BUSINESS)


def test_unchanged_personalization_is_not_stale() -> None:
    product = _product(personalizable=True, personalizationOptions="6 colors")
    snapshot = personalization_snapshot(product)

    assert not is_creative_stale(_creative(snapshot), _campaign(), product, _BUSINESS)


def test_a_published_campaign_is_unaffected() -> None:
    product = _product(personalizable=True, personalizationOptions="3 colors")
    published = _campaign(metaCampaignId="123")

    assert not is_creative_stale(_creative(""), published, product, _BUSINESS)


def test_editing_a_product_flag_marks_its_ads_stale_through_the_api(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    assert not any(c["isStale"] for c in _creatives(client, business_id, campaign_id))
    product_id = client.get(f"/businesses/{business_id}/campaigns").json()[0][
        "productId"
    ]

    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"personalizable": True, "personalizationOptions": "6 ceramic colors"},
    )

    assert all(c["isStale"] for c in _creatives(client, business_id, campaign_id))


def test_a_published_test_stays_fresh_when_the_product_is_personalized(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    assert (
        client.post(
            f"/businesses/{business_id}/campaigns/{campaign_id}/publish"
        ).status_code
        == 200
    )
    product_id = client.get(f"/businesses/{business_id}/campaigns").json()[0][
        "productId"
    ]

    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"personalizable": True},
    )

    assert not any(c["isStale"] for c in _creatives(client, business_id, campaign_id))
