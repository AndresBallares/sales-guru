"""The Strategist uses the concepts an avatar has saved.

Each library avatar's line in the prompt lists up to three of its saved concepts
(slug, pillar, description); the model is told to prefer them. The code, not the
prompt, makes it true: an angle whose (avatar, slug) matches a saved concept gets
the stored pillar, and ``from_saved_concept`` is recorded on that angle when it is
created. A concept an avatar already used in this campaign is no longer offered.
"""

import json
from typing import Any

import pytest
from app.schemas.strategy import CreativeAngle
from app.services import avatar_library_prompt
from prisma.models import BuyerAvatar

from tests.test_library_round_angles import _generate as _generate_round
from tests.test_library_round_angles import _reply
from tests.test_library_test_plan import _angle, _avatar, _generate, _raw, _sent


def _saved(slug: str, pillar: str, description: str | None = None) -> dict[str, str]:
    return {
        "slug": slug,
        "pillar": pillar,
        "description": description or f"{slug} description",
    }


def _with(id_: str, purchase_for: str, *concepts: dict[str, str]) -> BuyerAvatar:
    return _avatar(id_, purchase_for, concepts=json.dumps(list(concepts)))


def _library() -> list[BuyerAvatar]:
    return [
        _with(
            "a1",
            "self",
            _saved("nobody-chose-this-for", "emotion", "Nobody chose this for her"),
            _saved("your-year-designed", "offer"),
        ),
        _with("a2", "self", _saved("sanitizer-test", "mechanism")),
        _with("g1", "gift"),
    ]


# ---- what the Strategist is shown -----------------------------------------


def test_each_avatars_line_lists_its_saved_concepts_in_order() -> None:
    block = avatar_library_prompt.library_block(_library())

    assert (
        "concepts: nobody-chose-this-for (emotion): Nobody chose this for her; "
        "your-year-designed (offer): your-year-designed description" in block
    )
    assert "sanitizer-test (mechanism)" in block


def test_at_most_three_concepts_are_listed_each_cut_short() -> None:
    long = "word " * 60
    avatar = _with(
        "a1",
        "self",
        _saved("one", "offer", long),
        _saved("two", "emotion"),
        _saved("three", "education"),
        _saved("four", "mechanism"),
    )

    block = avatar_library_prompt.library_block([avatar])

    assert "three (education)" in block and "four (mechanism)" not in block
    first = block.split("one (offer): ")[1].split(";")[0]
    assert len(first) <= 120 and first.endswith("…")


def test_an_avatar_with_no_concepts_gets_no_concepts_part() -> None:
    block = avatar_library_prompt.library_block([_with("g1", "gift")])

    assert "concepts:" not in block


def test_a_concept_the_campaign_already_used_is_no_longer_offered() -> None:
    block = avatar_library_prompt.library_block(
        _library(), used={("a1", "nobody-chose-this-for")}
    )

    assert "nobody-chose-this-for (" not in block
    assert "your-year-designed (offer)" in block
    # The same slug used for another avatar does not hide it from this one.
    other = avatar_library_prompt.library_block(
        _library(), used={("a2", "nobody-chose-this-for")}
    )
    assert "nobody-chose-this-for (emotion)" in other


def test_a_concept_whose_slug_cannot_be_an_angle_slug_is_left_out() -> None:
    avatar = _with(
        "a1",
        "self",
        _saved("x" * 31, "offer"),
        _saved("Not A Slug", "emotion"),
        _saved("fine-slug", "education"),
    )

    block = avatar_library_prompt.library_block([avatar])
    pillars = avatar_library_prompt.saved_concept_pillars([avatar])

    assert "fine-slug (education)" in block
    assert "Not A Slug" not in block and "x" * 31 not in block
    assert pillars == {"a1": {"fine-slug": "education"}}


# ---- the first batch ------------------------------------------------------


@pytest.mark.asyncio
async def test_the_first_batch_prompt_lists_the_concepts_and_says_to_prefer_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    good = [
        _angle("a1", "nobody-chose-this-for", "emotion"),
        _angle("a2", "sanitizer-test", "mechanism"),
        _angle("g1", "the-perfect-gift", "education"),
        _angle("a1", "social-proof", "offer"),
    ]

    _, agent = await _generate(monkeypatch, _library(), _raw(good))

    prompt = _sent(agent)["prompt"]
    assert "nobody-chose-this-for (emotion)" in prompt
    assert "copy its slug and pillar exactly" in prompt
    assert "Invent a new concept only" in prompt


@pytest.mark.asyncio
async def test_a_saved_concept_gets_its_stored_pillar_and_is_marked(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wrong_pillars = [
        _angle("a1", "nobody-chose-this-for", "offer"),  # saved as emotion
        _angle("a2", "sanitizer-test", "emotion"),  # saved as mechanism
        _angle("g1", "the-perfect-gift", "education"),
        _angle("a1", "social-proof", "offer"),
    ]

    plan, _ = await _generate(monkeypatch, _library(), _raw(wrong_pillars))

    by_concept = {a.concept: a for a in plan.creative_angles}
    assert by_concept["nobody-chose-this-for"].pillar == "emotion"
    assert by_concept["nobody-chose-this-for"].from_saved_concept is True
    assert by_concept["sanitizer-test"].pillar == "mechanism"
    assert by_concept["sanitizer-test"].from_saved_concept is True
    # An invented concept keeps the model's pillar and is not marked.
    assert by_concept["the-perfect-gift"].pillar == "education"
    assert by_concept["the-perfect-gift"].from_saved_concept is False
    assert by_concept["social-proof"].from_saved_concept is False


@pytest.mark.asyncio
async def test_the_model_cannot_mark_an_invented_concept_as_saved(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sneaky: dict[str, Any] = {
        **_angle("g1", "the-perfect-gift", "education"),
        "fromSavedConcept": True,
    }
    angles: list[dict[str, Any]] = [
        _angle("a1", "nobody-chose-this-for", "emotion"),
        _angle("a2", "sanitizer-test", "mechanism"),
        sneaky,
        _angle("a1", "social-proof", "offer"),
    ]

    plan, _ = await _generate(monkeypatch, _library(), _raw(angles))

    assert {a.concept: a.from_saved_concept for a in plan.creative_angles}[
        "the-perfect-gift"
    ] is False


@pytest.mark.asyncio
async def test_a_saved_slug_of_another_avatar_is_not_a_saved_concept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    angles = [
        _angle("a2", "nobody-chose-this-for", "emotion"),  # a1's concept, not a2's
        _angle("a1", "your-year-designed", "offer"),
        _angle("g1", "the-perfect-gift", "education"),
        _angle("a2", "sanitizer-test", "mechanism"),
    ]

    plan, _ = await _generate(monkeypatch, _library(), _raw(angles))

    flags = {
        (a.buyer_avatar_id, a.concept): a.from_saved_concept
        for a in plan.creative_angles
    }
    assert flags[("a2", "nobody-chose-this-for")] is False
    assert flags[("a1", "your-year-designed")] is True


@pytest.mark.asyncio
async def test_forcing_the_pillar_cannot_break_the_three_pillar_rule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    library = [
        _with("a1", "self", _saved("x-one", "emotion")),
        _with("a2", "self", _saved("y-two", "emotion")),
        _with("g1", "gift", _saved("z-three", "emotion")),
    ]
    collapses = [
        _angle("a1", "x-one", "offer"),
        _angle("a2", "y-two", "education"),
        _angle("g1", "z-three", "mechanism"),
        _angle("a1", "invented", "mechanism"),
    ]  # forced: emotion, emotion, emotion, mechanism: only two pillars
    fixed = [
        _angle("a1", "x-one", "emotion"),
        _angle("a2", "invented-two", "mechanism"),
        _angle("g1", "invented-three", "education"),
        _angle("a1", "invented", "offer"),
    ]

    plan, agent = await _generate(monkeypatch, library, _raw(collapses), _raw(fixed))

    assert agent.await_count == 2
    assert "distinct pillars" in _sent(agent)["prompt"]
    assert len({a.pillar for a in plan.creative_angles}) >= 3


@pytest.mark.asyncio
async def test_without_saved_concepts_nothing_is_marked_and_the_prompt_is_unchanged(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    avatars = [_with("a1", "self"), _with("a2", "self"), _with("g1", "gift")]
    angles = [
        _angle("a1", "everyday-wear", "emotion"),
        _angle("a2", "craftsmanship", "mechanism"),
        _angle("g1", "the-perfect-gift", "education"),
        _angle("a1", "social-proof", "offer"),
    ]

    plan, agent = await _generate(monkeypatch, avatars, _raw(angles))

    assert all(a.from_saved_concept is False for a in plan.creative_angles)
    assert "concepts:" not in _sent(agent)["prompt"]


# ---- the follow-up rounds -------------------------------------------------

_USED = [
    CreativeAngle(
        avatar="self_purchaser",
        concept="nobody-chose-this-for",
        pillar="emotion",
        description="d",
        buyer_avatar_id="a1",
        from_saved_concept=True,
    )
]


@pytest.mark.asyncio
async def test_a_round_prefers_concepts_not_yet_used_and_marks_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    angles = [
        _angle("a1", "your-year-designed", "education"),  # saved as offer
        _angle("a2", "sanitizer-test", "mechanism"),
        _angle("g1", "easy-returns", "emotion"),
        _angle("a2", "daily-ritual", "education"),
    ]

    result, agent = await _generate_round(
        monkeypatch, _reply(angles), avatars=_library(), excluded=_USED
    )

    prompt = _sent(agent)["prompt"]
    assert "your-year-designed (offer)" in prompt
    assert "nobody-chose-this-for (" not in prompt  # used by this campaign already
    assert "copy its slug and pillar exactly" in prompt
    by_concept = {a.concept: a for a in result}
    assert by_concept["your-year-designed"].pillar == "offer"
    assert by_concept["your-year-designed"].from_saved_concept is True
    assert by_concept["easy-returns"].from_saved_concept is False


@pytest.mark.asyncio
async def test_a_concept_used_by_an_earlier_ad_cannot_be_used_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    again = [
        _angle("a1", "nobody-chose-this-for", "emotion"),
        _angle("a2", "sanitizer-test", "mechanism"),
        _angle("g1", "easy-returns", "offer"),
        _angle("a2", "daily-ritual", "education"),
    ]
    fresh = [
        _angle("a1", "your-year-designed", "offer"),
        _angle("a2", "sanitizer-test", "mechanism"),
        _angle("g1", "easy-returns", "emotion"),
        _angle("a2", "daily-ritual", "education"),
    ]

    result, agent = await _generate_round(
        monkeypatch, _reply(again), _reply(fresh), avatars=_library(), excluded=_USED
    )

    assert agent.await_count == 2
    assert "already used" in _sent(agent)["prompt"]
    assert {a.concept for a in result} >= {"your-year-designed"}


# ---- fake mode ------------------------------------------------------------


def _canned() -> list[object]:
    return [
        {
            "avatar": "self_purchaser",
            "concept": f"canned-{n}",
            "pillar": pillar,
            "description": "d",
        }
        for n, pillar in enumerate(["emotion", "mechanism", "education", "offer"])
    ]


def test_fake_angles_use_a_saved_concept_when_the_avatar_has_one() -> None:
    library = _library()

    angles = avatar_library_prompt.fake_library_angles(_canned(), library)

    saved = [
        a
        for a in angles
        if a["concept"]
        in {"nobody-chose-this-for", "sanitizer-test", "your-year-designed"}
    ]
    assert saved, "no saved concept was used"
    # Each saved concept at most once, and the angle's pillar is the stored one.
    slugs = [(a["buyer_avatar_id"], a["concept"]) for a in saved]
    assert len(slugs) == len(set(slugs))
    stored = {
        ("a1", "nobody-chose-this-for"): "emotion",
        ("a2", "sanitizer-test"): "mechanism",
        ("a1", "your-year-designed"): "offer",
    }
    assert all(
        stored[(str(a["buyer_avatar_id"]), str(a["concept"]))] == a["pillar"]
        for a in saved
    )
    assert len({a["pillar"] for a in angles}) >= 3


def test_fake_angles_skip_concepts_already_used() -> None:
    used = {
        ("a1", "nobody-chose-this-for"),
        ("a1", "your-year-designed"),
        ("a2", "sanitizer-test"),
    }

    angles = avatar_library_prompt.fake_library_angles(_canned(), _library(), used=used)

    assert not any((a["buyer_avatar_id"], a["concept"]) in used for a in angles)


def test_fake_angles_for_avatars_without_concepts_are_unchanged() -> None:
    bare = [_with("a1", "self"), _with("a2", "self"), _with("g1", "gift")]

    angles = avatar_library_prompt.fake_library_angles(_canned(), bare)

    assert [a["concept"] for a in angles] == [f"canned-{n}" for n in range(4)]
