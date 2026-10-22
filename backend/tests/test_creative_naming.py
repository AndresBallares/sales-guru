"""Tests for a creative test ad's name and UTM parameters."""

from urllib.parse import parse_qs

import pytest
from app.services import creative_naming


@pytest.mark.parametrize(
    ("avatar", "concept", "label"),
    [
        ("self_purchaser", "everyday-wear", "Self-purchaser – Everyday wear"),
        ("gift_buyer", "social-proof", "Gift buyer – Social proof"),
        ("gift_buyer", "gift", "Gift buyer – Gift"),
    ],
)
def test_an_angle_is_named_avatar_dash_concept(
    avatar: str, concept: str, label: str
) -> None:
    assert creative_naming.angle_label(avatar, concept) == label


def test_an_unknown_avatar_is_named_as_it_is() -> None:
    assert creative_naming.angle_label("collector", "rings") == "collector – Rings"


def test_an_ad_is_named_by_its_angle_or_by_the_fallback_when_it_has_none() -> None:
    assert (
        creative_naming.ad_name("gift_buyer", "gifting", "Headline")
        == "Gift buyer – Gifting"
    )
    assert creative_naming.ad_name(None, None, "Headline") == "Headline"
    assert creative_naming.ad_name("gift_buyer", None, "Headline") == "Headline"


def test_url_tags_carry_the_four_utm_parameters() -> None:
    tags = creative_naming.url_tags(
        campaign_name="Spring & Summer push",
        avatar="self_purchaser",
        concept="everyday-wear",
        name="Self-purchaser – Everyday wear",
    )

    parsed = {key: values[0] for key, values in parse_qs(tags).items()}
    assert parsed == {
        "utm_source": "paid_social",
        "utm_medium": "self-purchaser-everyday-wear",
        "utm_campaign": "Spring & Summer push",
        "utm_content": "Self-purchaser – Everyday wear",
    }


def test_url_tags_are_percent_encoded_so_a_name_cannot_add_a_parameter() -> None:
    tags = creative_naming.url_tags(
        campaign_name="a&utm_source=evil", avatar="gift_buyer", concept="x", name="n"
    )

    assert tags.count("utm_source=") == 1
    assert "evil" in tags and "a%26utm_source%3Devil" in tags


def test_an_ad_without_an_angle_gets_a_generic_medium() -> None:
    tags = creative_naming.url_tags(
        campaign_name="Campaign", avatar=None, concept=None, name="Headline"
    )

    assert "utm_medium=paid&" in tags


# --- pillar (composes with the avatar; an ad without one is named as before) ---


@pytest.mark.parametrize(
    ("pillar", "label"),
    [
        ("offer", "Gift buyer – Social proof – Offer"),
        ("mechanism", "Gift buyer – Social proof – Mechanism"),
        ("education", "Gift buyer – Social proof – Education"),
        ("emotion", "Gift buyer – Social proof – Emotion"),
    ],
)
def test_a_pillar_goes_last_in_the_angle_label(pillar: str, label: str) -> None:
    assert creative_naming.angle_label("gift_buyer", "social-proof", pillar) == label


def test_no_pillar_leaves_the_label_exactly_as_before() -> None:
    assert (
        creative_naming.angle_label("gift_buyer", "social-proof")
        == "Gift buyer – Social proof"
    )
    assert (
        creative_naming.angle_label("gift_buyer", "social-proof", None)
        == "Gift buyer – Social proof"
    )


def test_an_ad_name_includes_the_pillar_when_it_has_one() -> None:
    assert (
        creative_naming.ad_name("self_purchaser", "craftsmanship", "H", "mechanism")
        == "Self-purchaser – Craftsmanship – Mechanism"
    )
    assert creative_naming.ad_name(None, None, "Headline", "mechanism") == "Headline"


def test_url_tags_add_the_pillar_as_utm_term_and_keep_the_medium() -> None:
    tags = creative_naming.url_tags(
        campaign_name="C",
        avatar="self_purchaser",
        concept="craftsmanship",
        name="N",
        pillar="mechanism",
    )

    parsed = {key: values[0] for key, values in parse_qs(tags).items()}
    assert parsed["utm_medium"] == "self-purchaser-craftsmanship"
    assert parsed["utm_term"] == "mechanism"


def test_url_tags_without_a_pillar_have_no_utm_term() -> None:
    tags = creative_naming.url_tags(
        campaign_name="C", avatar="gift_buyer", concept="x", name="N"
    )

    assert "utm_term" not in tags
