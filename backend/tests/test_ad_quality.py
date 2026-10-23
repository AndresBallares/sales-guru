"""Tests for the Meta ad-quality grounding and the banned-phrase guard."""

from types import SimpleNamespace
from typing import Any

import pytest
from app.schemas.creative import GeneratedCreativeVariant
from app.services import ad_quality, creative
from pydantic import ValidationError

_VARIANT: dict[str, Any] = {
    "headline": "Hand-set 18k gold",
    "bodyText": "Hand-set in 18k gold. Shop the collection.",
    "description": "Made to last",
    "cta": "SHOP_NOW",
    "creativeAngle": "Craftsmanship",
    "imagePrompt": "Ring on a hand.",
    "videoPrompt": "Ring turning.",
}


def _copy(**overrides: object) -> Any:
    defaults: dict[str, object] = {
        "headline": "Hand-set 18k gold",
        "bodyText": "Hand-set in 18k gold. Shop the collection.",
        "description": "Made to last",
        "cards": [],
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# --- the guard's phrase list ---------------------------------------------------


@pytest.mark.parametrize("phrase", ad_quality.BANNED_PHRASES)
def test_every_banned_phrase_is_caught(phrase: str) -> None:
    assert ad_quality.banned_phrases_in(f"Gorgeous ring. {phrase} friend!") == [phrase]


@pytest.mark.parametrize(
    "text",
    [
        "TAG A FRIEND who loves gold.",
        "Comment Below with your size.",
        "SHARE THIS with her.",
        "You Won't Believe the shine.",
        "WAIT UNTIL YOU SEE it on skin.",
        "Find Out Why she cried.",
    ],
)
def test_matching_ignores_case(text: str) -> None:
    assert ad_quality.banned_phrases_in(text)


def test_a_curly_apostrophe_still_matches() -> None:
    assert ad_quality.banned_phrases_in("You won’t believe this ring.") == [
        "you won't believe"
    ]


def test_extra_whitespace_between_the_words_still_matches() -> None:
    assert ad_quality.banned_phrases_in("Comment\n  below now.") == ["comment below"]


def test_the_variants_of_tag_are_caught() -> None:
    assert ad_quality.banned_phrases_in("Tag your sister.") == ["tag your"]
    assert ad_quality.banned_phrases_in("Tag someone special.") == ["tag someone"]
    assert ad_quality.banned_phrases_in("Tag an engaged friend.") == ["tag an"]


def test_each_phrase_is_reported_once_in_list_order() -> None:
    found = ad_quality.banned_phrases_in(
        "Find out why. Find out why! Tag a friend and comment below."
    )

    assert found == ["tag a", "comment below", "find out why"]


@pytest.mark.parametrize(
    "text",
    [
        "Hand-set in 18k gold. Shop the collection.",
        "The price tag accompanies every piece.",
        "A vintage a-line setting.",
        "Shared by makers, not factories.",
        "Why 18k gold lasts.",
        "",
        None,
    ],
)
def test_clean_copy_and_near_misses_are_not_flagged(text: str | None) -> None:
    assert ad_quality.banned_phrases_in(text) == []


def test_field_problems_name_the_field_and_the_phrase() -> None:
    [problem] = ad_quality.copy_field_problems("headline", "Tag a friend")

    assert problem.startswith("headline contains 'tag a'")
    assert "Meta" in problem
    assert ad_quality.copy_field_problems("headline", "Hand-set gold") == []


# --- the prompt grounding ------------------------------------------------------


def _rules(industry: str | None = "FASHION_JEWELRY") -> str:
    return "\n".join(ad_quality.rule_lines(industry))


def test_the_rules_block_is_under_200_words_for_every_industry() -> None:
    for industry in ("FASHION_JEWELRY", None, "RESTAURANT"):
        assert len(_rules(industry).split()) < 200


def test_the_rules_cover_all_seven_points() -> None:
    text = _rules()

    assert "Meta ad quality rules" in text
    for expected in (
        "quality, engagement likelihood and conversion likelihood",
        "No engagement bait",
        '"tag a friend", "comment below", "share if you agree"',
        "Never withhold information",
        "price teasing",
        "curiosity-gap",
        "claims must match what the product page shows",
        "first line of primary text and the visual's first seconds",
        "strongest concrete hook",
        "native content for the person in the variant's avatar",
        "ALL CAPS",
        "emoji walls",
    ):
        assert expected in text


def test_the_jewelry_materials_line_is_only_for_jewelry() -> None:
    assert "18k gold, hand-set" in _rules("FASHION_JEWELRY")
    assert "18k gold" not in _rules("RESTAURANT")
    assert "18k gold" not in _rules(None)


def test_the_rules_hold_no_bidding_pacing_or_budget_mechanics() -> None:
    text = _rules().lower()

    for word in ("bid", "pacing", "cost cap", "daily budget", "cpa", "cac", "roas"):
        assert word not in text


# --- the schema and publish guards ----------------------------------------------


def test_a_variant_with_bait_in_any_slot_is_rejected() -> None:
    for field, text in (
        ("headline", "Tag a friend"),
        ("bodyText", "Gold you won't believe."),
        ("description", "Find out why"),
    ):
        with pytest.raises(ValidationError, match="engagement bait"):
            GeneratedCreativeVariant.model_validate({**_VARIANT, field: text})


def test_a_carousel_card_with_bait_is_rejected_and_named() -> None:
    cards = [
        {"headline": "Hand-set gold", "description": "Made to last"},
        {"headline": "Share this ring", "description": None},
    ]

    with pytest.raises(ValidationError, match="card 2 headline contains 'share this'"):
        GeneratedCreativeVariant.model_validate({**_VARIANT, "cards": cards})


def test_clean_copy_validates() -> None:
    assert GeneratedCreativeVariant.model_validate(_VARIANT).headline


@pytest.mark.parametrize("phrase", ad_quality.BANNED_PHRASES)
def test_the_publish_guard_catches_every_banned_phrase(phrase: str) -> None:
    problems = creative.copy_problems(_copy(bodyText=f"{phrase} friend. Shop now."))

    assert any(f"'{phrase}'" in p for p in problems)


def test_the_publish_guard_checks_headline_description_and_cards() -> None:
    problems = creative.copy_problems(
        _copy(
            headline="COMMENT BELOW",
            description="wait until you see",
            cards=[
                SimpleNamespace(headline="Tag a friend", description=None),
                SimpleNamespace(headline="Fine", description="Find out why"),
            ],
        )
    )

    assert len(problems) == 4
    assert any(p.startswith("headline contains") for p in problems)
    assert any(p.startswith("description contains") for p in problems)
    assert any(p.startswith("card 1 headline contains") for p in problems)
    assert any(p.startswith("card 2 description contains") for p in problems)


def test_the_publish_guard_passes_clean_copy() -> None:
    assert creative.copy_problems(_copy()) == []


# --- Ad structure rules ---------------------------------------------------------


def test_the_structure_block_is_under_150_words() -> None:
    assert len(" ".join(ad_quality.structure_lines()).split()) <= 150


def test_the_structure_rules_cover_offer_mechanism_praise_education_and_pillar() -> (
    None
):
    text = "\n".join(ad_quality.structure_lines())

    assert "Ad structure (apply to every variant):" in text
    for expected in (
        "at least one offer element or risk-reducer",
        "standing promotion",
        "guarantee, free returns, free shipping",
        "Never invent one",
        "connect it to the benefit",
        "why the promise is believable, not a spec to list",
        "ceramic inlay means the color never fades",
        "No generic praise",
        "Education is a valid angle",
        "why a material lasts, how to spot quality",
        "pillar",
        "avatar",
    ):
        assert expected in text


def test_the_structure_rules_hold_no_bidding_or_budget_mechanics() -> None:
    text = "\n".join(ad_quality.structure_lines()).lower()

    for word in ("bid", "pacing", "cost cap", "budget", "cpa", "roas"):
        assert word not in text


# --- generic-praise openers -----------------------------------------------------


@pytest.mark.parametrize(
    ("text", "word"),
    [
        ("Beautiful jewelry for every day.", "Beautiful"),
        ("Stunning pieces for her.", "Stunning"),
        ("AMAZING rings, made for you.", "AMAZING"),
        ("Stunning.", "Stunning"),
        ("Gorgeous! Shop the collection.", "Gorgeous"),
        ("  beautiful jewelry", "beautiful"),
        ('"Stunning pieces," she said.', "Stunning"),
    ],
)
def test_a_praise_only_opener_is_blocked(text: str, word: str) -> None:
    assert ad_quality.generic_praise_opener(text) == word
    [problem] = ad_quality.praise_opener_problems("primary text", text)
    assert f"'{word}'" in problem
    assert "names no material or specific detail" in problem


@pytest.mark.parametrize(
    "text",
    [
        "Stunning 18k gold, hand-set in New York.",
        "Beautiful ceramic inlay that never fades.",
        "Amazing 2-carat diamonds at a fair price.",
        "Beautiful sterling silver, made to last.",
        "Stunning handcrafted rings.",
        # Praise after the opener is fine, however generic.
        "Hand-set in 18k gold. Stunning from every angle.",
        "Made to last, and beautiful with it.",
        "The stunning 18k gold ring you will keep.",
        # Not praise at all.
        "Solid gold, hand-set.",
        "Beautifully made in solid gold.",
        "",
    ],
)
def test_a_concrete_opener_or_mid_copy_praise_is_allowed(text: str) -> None:
    assert ad_quality.generic_praise_opener(text) is None
    assert ad_quality.praise_opener_problems("primary text", text) == []


def test_only_the_first_sentence_has_to_be_concrete() -> None:
    """The concrete word has to be in the opener's own sentence, not later."""
    assert ad_quality.generic_praise_opener("Stunning pieces. Solid 18k gold.")


def test_no_text_has_no_opener() -> None:
    assert ad_quality.generic_praise_opener(None) is None


def test_a_variant_that_opens_with_praise_alone_is_rejected() -> None:
    with pytest.raises(ValidationError, match="opens with generic praise"):
        GeneratedCreativeVariant.model_validate(
            {**_VARIANT, "bodyText": "Beautiful jewelry for her. Shop the collection."}
        )


def test_a_variant_with_mid_copy_praise_is_accepted() -> None:
    variant = GeneratedCreativeVariant.model_validate(
        {**_VARIANT, "bodyText": "Hand-set in stunning 18k gold. Shop the collection."}
    )

    assert "stunning" in variant.body_text


def test_the_headline_may_open_with_praise_only_the_primary_text_is_checked() -> None:
    """The brief is about the primary text's opener."""
    variant = GeneratedCreativeVariant.model_validate(
        {**_VARIANT, "headline": "Beautiful gold"}
    )

    assert variant.headline == "Beautiful gold"


def test_the_publish_guard_blocks_a_praise_only_opener() -> None:
    problems = creative.copy_problems(
        _copy(bodyText="Stunning pieces for her. Shop the collection.")
    )

    assert any("opens with generic praise ('Stunning')" in p for p in problems)


def test_the_publish_guard_allows_mid_copy_praise() -> None:
    assert (
        creative.copy_problems(
            _copy(bodyText="Hand-set in stunning 18k gold. Shop the collection.")
        )
        == []
    )
