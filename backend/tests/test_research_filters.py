"""Banned phrases and competitor names in hooks, angles and concepts (Phase 7b)."""

from app.schemas.research import ResearchAvatar, ResearchConcept
from app.services.research_filters import (
    competitor_terms_from_urls,
    drop_violations,
    find_violations,
    terms_in,
)


def _avatar(**over: object) -> ResearchAvatar:
    data: dict[str, object] = {
        "name": "A",
        "who": "w",
        "purchase_for": "self",
        "primary_problems": [1],
        "unknown_problems": [],
        "primary_solutions": [1],
        "alternatives": [],
        "objections": [],
        "hooks": ["h1", "h2", "h3", "h4", "h5"],
        "creative_angles": ["a1", "a2", "a3"],
        "concepts": [
            ResearchConcept(name="c1", pillar="offer", description="d1"),
            ResearchConcept(name="c2", pillar="education", description="d2"),
        ],
        "inferred": False,
    }
    data.update(over)
    return ResearchAvatar.model_validate(data)


def test_competitor_terms_come_from_domains() -> None:
    terms = competitor_terms_from_urls(
        ["https://www.bulgari.com/en-us/rings", "https://shop.tiffany.co.uk/x", "bad"]
    )
    assert "bulgari" in terms
    assert "tiffany" in terms


def test_short_domain_labels_are_skipped() -> None:
    assert competitor_terms_from_urls(["https://ice.com"]) == []


def test_terms_in_is_case_insensitive_and_whole_word() -> None:
    assert terms_in("Our Bulgari-style ring", ["bulgari"]) == ["bulgari"]
    assert terms_in("Free shipping!", ["free shipping"]) == ["free shipping"]
    assert terms_in("a cartiering of words", ["cartier"]) == []
    assert terms_in("it’s a steal", ["it's a steal"]) == ["it's a steal"]


def test_find_violations_reports_where() -> None:
    avatar = _avatar(
        hooks=["h1", "Like a Serpenti", "h3", "h4", "h5"],
        creative_angles=["a1", "guaranteed results", "a3"],
        concepts=[
            ResearchConcept(name="c1", pillar="offer", description="bulgari vibes"),
            ResearchConcept(name="c2", pillar="education", description="d2"),
        ],
    )
    found = find_violations([avatar], ["serpenti", "guaranteed results", "bulgari"])
    where = {(v.avatar, v.field, v.index, v.term) for v in found}
    assert where == {
        (0, "hooks", 1, "serpenti"),
        (0, "creative_angles", 1, "guaranteed results"),
        (0, "concepts", 0, "bulgari"),
    }


def test_clean_avatars_have_no_violations() -> None:
    assert find_violations([_avatar()], ["serpenti"]) == []


def test_drop_violations_removes_items_and_warns() -> None:
    avatar = _avatar(hooks=["h1", "Serpenti magic", "h3", "h4", "h5"])
    kept, warnings = drop_violations([avatar], ["serpenti"])
    assert kept[0].hooks == ["h1", "h3", "h4", "h5"]
    assert len(warnings) == 1
    assert "serpenti" in warnings[0].lower()
    assert "A" in warnings[0]
