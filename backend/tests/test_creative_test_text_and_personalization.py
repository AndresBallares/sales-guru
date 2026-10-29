"""Tests for a creative test's distinct ad text and its Personalized angle.

Two rules keep the four ads of one test from being the same ad: their primary
texts and headlines must be clearly different from one another, and at most one
angle is the Personalized angle (customer picks colors or materials), offered
only for a personalizable product that has a URL, and naming only the options
the product lists.
"""

from typing import Any

import pytest
from app.schemas.creative import (
    GeneratedCreativeBatch,
    GeneratedCreativeVariant,
    too_similar,
)
from app.schemas.strategy import (
    PERSONALIZATION_CONCEPT,
    Avatar,
    CreativeAngle,
    CreativePersona,
    GeneratedCreativeAngle,
    GeneratedCreativeTestPlanFields,
)
from app.services import creative, strategist
from app.services.strategist import is_personalized
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tests.test_creative_service import (
    _fake_business,
    _fake_product,
    _structured_plan,
)
from tests.test_product import _create_business, _signed_up_client

# ---------- near-duplicate text ----------


def _variant(headline: str, body: str, angle: str) -> GeneratedCreativeVariant:
    return GeneratedCreativeVariant(
        headline=headline,
        body_text=body,
        description=None,
        cta="SHOP_NOW",
        creative_angle=angle,
    )


_DIFFERENT = [
    _variant(
        "Worn every single day",
        "From coffee runs to date nights, this ring keeps up with your life.",
        "Everyday",
    ),
    _variant(
        "Handmade in New York",
        "Each piece is poured, enameled and finished by one pair of hands.",
        "Craft",
    ),
    _variant(
        "She will keep it forever",
        "Give her something she will still be wearing in twenty years.",
        "Gift",
    ),
    _variant(
        "Loved by 2,000 buyers",
        "Our customers keep coming back, and they tell their friends too.",
        "Proof",
    ),
]
_CONTEXT = {"variant_count": 4, "distinct_text": True}


def _batch(variants: list[GeneratedCreativeVariant], **context: Any) -> None:
    GeneratedCreativeBatch.model_validate(
        {"variants": [v.model_dump(by_alias=True) for v in variants]},
        context={"variant_count": len(variants), **context},
    )


def test_clearly_different_ads_pass_the_distinct_text_check() -> None:
    _batch(_DIFFERENT, distinct_text=True)


def test_two_near_identical_headlines_are_rejected() -> None:
    variants = [*_DIFFERENT]
    variants[1] = variants[1].model_copy(update={"headline": "Worn every single day."})

    with pytest.raises(ValidationError, match="different headline"):
        _batch(variants, distinct_text=True)


def test_a_reworded_headline_with_the_same_words_is_rejected() -> None:
    variants = [*_DIFFERENT]
    variants[2] = variants[2].model_copy(update={"headline": "Every single day worn"})

    with pytest.raises(ValidationError, match="different headline"):
        _batch(variants, distinct_text=True)


def test_two_near_identical_primary_texts_are_rejected() -> None:
    variants = [*_DIFFERENT]
    variants[3] = variants[3].model_copy(
        update={
            "body_text": "From coffee runs to date nights, this ring keeps up with you."
        }
    )

    with pytest.raises(ValidationError, match="different primary text"):
        _batch(variants, distinct_text=True)


def test_the_check_only_runs_when_a_creative_test_asks_for_it() -> None:
    variants = [*_DIFFERENT]
    variants[1] = variants[1].model_copy(update={"headline": variants[0].headline})

    _batch(variants)  # no distinct_text context: other campaigns are unaffected


def test_too_similar_ignores_filler_words() -> None:
    assert too_similar("The ring", "A ring", overlap_limit=0.6)
    assert not too_similar(
        "Made in Your Colors", "Choose Your Colors", overlap_limit=0.6
    )


# ---------- the Personalized angle in the plan ----------


def _angles(
    personalized_avatar: Avatar = "self_purchaser", *, count: int = 1
) -> list[GeneratedCreativeAngle]:
    base = [
        GeneratedCreativeAngle(
            avatar="gift_buyer",
            concept="the-perfect-gift",
            pillar="emotion",
            description="The gift she keeps",
        ),
        GeneratedCreativeAngle(
            avatar="self_purchaser",
            concept="craftsmanship",
            pillar="mechanism",
            description="The craft",
        ),
        GeneratedCreativeAngle(
            avatar="gift_buyer",
            concept="social-proof",
            pillar="education",
            description="Loved by buyers",
        ),
    ]
    personalized = GeneratedCreativeAngle(
        avatar=personalized_avatar,
        concept=PERSONALIZATION_CONCEPT,
        pillar="mechanism",
        description="Pick your colors",
    )
    return [*base, *([personalized] * count)][:4] if count else [*base, base[1]]


def _plan_fields(angles: list[GeneratedCreativeAngle]) -> dict[str, Any]:
    return {
        "creativePersona": CreativePersona(
            name="Buyers", description="Women"
        ).model_dump(by_alias=True),
        "hypothesisStatement": "Personalized wins on cost per add-to-cart.",
        "offer": "Offer",
        "positioning": "Positioning",
        "creativeAngles": [a.model_dump(by_alias=True) for a in angles],
        "copyStrategy": "Copy",
    }


def test_a_personalizable_product_needs_exactly_one_personalized_angle() -> None:
    GeneratedCreativeTestPlanFields.model_validate(
        _plan_fields(_angles()), context={"personalization": "required"}
    )


def test_a_personalizable_product_without_the_angle_is_rejected() -> None:
    angles = _angles(count=0)
    angles[3] = angles[3].model_copy(update={"concept": "another-idea"})

    with pytest.raises(ValidationError, match="Exactly one angle"):
        GeneratedCreativeTestPlanFields.model_validate(
            _plan_fields(angles), context={"personalization": "required"}
        )


def test_a_product_that_is_not_personalizable_may_not_get_the_angle() -> None:
    with pytest.raises(ValidationError, match="not personalizable"):
        GeneratedCreativeTestPlanFields.model_validate(
            _plan_fields(_angles()), context={"personalization": "forbidden"}
        )


def test_a_gift_buyer_personalized_angle_needs_another_self_purchase_angle() -> None:
    angles = _angles(personalized_avatar="gift_buyer")
    angles[1] = angles[1].model_copy(update={"avatar": "gift_buyer"})
    # gift_buyer everywhere: invalid for the both-avatars rule too, but the
    # personalization rule names the real problem first.
    with pytest.raises(ValidationError):
        GeneratedCreativeTestPlanFields.model_validate(
            _plan_fields(angles), context={"personalization": "required"}
        )


def test_a_gift_buyer_personalized_angle_is_fine_when_others_cover_self_purchase() -> (
    None
):
    GeneratedCreativeTestPlanFields.model_validate(
        _plan_fields(_angles(personalized_avatar="gift_buyer")),
        context={"personalization": "required"},
    )


def test_without_a_context_the_personalization_rule_does_not_apply() -> None:
    GeneratedCreativeTestPlanFields.model_validate(_plan_fields(_angles()))


# ---------- when a product gets the angle ----------


def test_only_a_personalizable_product_with_a_url_gets_the_angle() -> None:
    assert is_personalized(
        _fake_product(personalizable=True, url="https://acme.example/p")
    )
    assert not is_personalized(_fake_product(personalizable=True, url=None))
    assert not is_personalized(_fake_product(personalizable=False, url="https://a.co"))
    assert not is_personalized(_fake_product())
    assert not is_personalized(None)


def test_the_strategist_prompt_asks_for_the_angle_only_when_allowed() -> None:
    allowed = strategist._personalization_instruction(
        _fake_product(personalizable=True, url="https://acme.example/p")
    )
    refused = strategist._personalization_instruction(_fake_product())

    assert "Exactly one of the four angles is the Personalized angle" in allowed
    assert PERSONALIZATION_CONCEPT in allowed
    assert "do not use" in refused


# ---------- the Creative Agent's rules for it ----------


def _plan_with_personalized_angle() -> Any:
    plan = _structured_plan()
    angles = list(plan.creative_angles)
    angles[3] = CreativeAngle(
        avatar="self_purchaser",
        concept=PERSONALIZATION_CONCEPT,
        pillar="mechanism",
        description="Pick your colors",
    )
    return plan.model_copy(update={"creative_angles": angles})


def test_the_creative_prompt_names_only_the_listed_options() -> None:
    product = _fake_product(
        personalizable=True,
        url="https://acme.example/p",
        personalizationOptions="6 ceramic colors, yellow/white/rose gold",
    )

    _, tail = creative._build_prompt_parts(
        _fake_business(), product, _plan_with_personalized_angle()
    )

    assert "The Personalized angle" in tail
    assert "6 ceramic colors, yellow/white/rose gold" in tail
    assert "Never mention, imply or promise any other" in tail
    assert "SHOP_NOW" in tail


def test_without_an_option_list_the_ad_names_no_specific_option() -> None:
    product = _fake_product(personalizable=True, url="https://acme.example/p")

    _, tail = creative._build_prompt_parts(
        _fake_business(), product, _plan_with_personalized_angle()
    )

    assert "do not name any specific color" in tail


def test_a_test_without_the_angle_has_no_personalization_rules() -> None:
    _, tail = creative._build_prompt_parts(
        _fake_business(), _fake_product(), _structured_plan()
    )

    assert "The Personalized angle" not in tail


def test_the_creative_prompt_tells_the_agent_each_ad_needs_its_own_wording() -> None:
    _, tail = creative._build_prompt_parts(
        _fake_business(), _fake_product(), _structured_plan()
    )

    assert "different" in tail


# ---------- the product fields ----------


def test_a_product_stores_and_returns_its_personalization(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    created = client.post(
        f"/businesses/{business_id}/products",
        json={
            "description": "Ceramic ring",
            "url": "https://acme.example/ring",
            "personalizable": True,
            "personalizationOptions": "6 ceramic colors",
        },
    ).json()
    assert created["personalizable"] is True
    assert created["personalizationOptions"] == "6 ceramic colors"

    patched = client.patch(
        f"/businesses/{business_id}/products/{created['id']}",
        json={"personalizationOptions": "yellow, white and rose gold"},
    ).json()
    assert patched["personalizable"] is True
    assert patched["personalizationOptions"] == "yellow, white and rose gold"

    cleared = client.patch(
        f"/businesses/{business_id}/products/{created['id']}",
        json={"personalizable": False, "personalizationOptions": None},
    ).json()
    assert cleared["personalizable"] is False
    assert cleared["personalizationOptions"] is None


def test_a_product_is_not_personalizable_by_default(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    created = client.post(
        f"/businesses/{business_id}/products", json={"description": "Plain ring"}
    ).json()

    assert created["personalizable"] is False
    assert created["personalizationOptions"] is None
