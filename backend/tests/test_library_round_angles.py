"""Follow-up round angles for a business with library avatars, and the winner.

The model names a library avatar per angle (buyer_avatar_id) and the code derives
the fixed avatar from it. Freshness is keyed by (library avatar, concept). The
winning ad's avatar is passed in; steering toward it is a soft rule (one retry,
then accept with a warning), while count, fresh pairs and valid ids stay hard.
"""

import json
import logging
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.schemas.strategy import CreativeAngle, GeneratedLibraryRoundAngles
from app.services import strategist
from app.services.round_results import AdAngle, AdResult, RoundResults
from app.services.strategist import StrategistError
from app.services.tool_use import tool_input_schema
from prisma.models import BuyerAvatar

from tests.test_creative_test_plan_publish import _creative_plan
from tests.test_strategist_service import _fake_audience, _fake_business, _fake_product


def _sent(agent: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of the agent's latest call."""
    call = agent.await_args
    assert call is not None
    return dict(call.kwargs)


def _avatar(id_: str, purchase_for: str = "self") -> BuyerAvatar:
    return cast(
        BuyerAvatar,
        SimpleNamespace(
            id=id_,
            name=f"Avatar {id_}",
            who=f"Who {id_} is.",
            purchaseFor=purchase_for,
            primaryProblems=json.dumps([f"{id_} problem"]),
            hooks=json.dumps([f"{id_} hook"]),
        ),
    )


def _angle(avatar_id: str, concept: str, pillar: str) -> dict[str, str]:
    """An angle as the model sends it: camelCase keys, as the tool schema names them."""
    return {
        "buyerAvatarId": avatar_id,
        "concept": concept,
        "pillar": pillar,
        "description": f"What {concept} shows.",
    }


def _reply(angles: list[dict[str, str]]) -> dict[str, Any]:
    return {"creativeAngles": angles}


LIBRARY = [_avatar("a1"), _avatar("a2"), _avatar("g1", "gift")]
# Two of four on the winning avatar a1; a2 and g1 explore.
STEERED = [
    _angle("a1", "daily-ritual", "emotion"),
    _angle("a1", "made-to-last", "mechanism"),
    _angle("a2", "easy-returns", "offer"),
    _angle("g1", "anniversary-surprise", "education"),
]
# Nothing on the winning avatar a1.
UNSTEERED = [
    _angle("a2", "daily-ritual", "emotion"),
    _angle("a2", "made-to-last", "mechanism"),
    _angle("g1", "easy-returns", "offer"),
    _angle("g1", "anniversary-surprise", "education"),
]


def _result(
    avatar_id: str | None, label: str = "Self-purchaser – Everyday wear – Emotion"
) -> AdResult:
    return AdResult(
        ad_id="ad1",
        angle=AdAngle(label, avatar_id, "self_purchaser", "everyday-wear", "emotion"),
        spend=100.0,
        results=10,
        cost=10.0,
    )


def _winner(avatar_id: str | None = "a1") -> RoundResults:
    weakest = AdResult(
        "ad2",
        AdAngle(
            "Gift buyer – Social proof", "g1", "gift_buyer", "social-proof", "offer"
        ),
        100.0,
        5,
        20.0,
    )
    return RoundResults("cost_per_add_to_cart", _result(avatar_id), weakest, 4)


EXCLUDED = [
    CreativeAngle(
        avatar="self_purchaser",
        concept="everyday-wear",
        pillar="emotion",
        description="d",
        buyer_avatar_id="a1",
    )
]


async def _generate(
    monkeypatch: pytest.MonkeyPatch,
    *replies: dict[str, Any],
    avatars: list[BuyerAvatar] | None = None,
    results: RoundResults | None = None,
    excluded: list[CreativeAngle] | None = None,
    count: int = 4,
) -> tuple[list[Any], AsyncMock]:
    agent = AsyncMock(side_effect=list(replies))
    monkeypatch.setattr(strategist, "_call_agent", agent)
    angles = await strategist.generate_round_angles(
        business=_fake_business(),
        product=_fake_product(),
        audience=_fake_audience(),
        plan=_creative_plan(),
        excluded_angles=EXCLUDED if excluded is None else excluded,
        count=count,
        buyer_avatars=LIBRARY if avatars is None else avatars,
        previous_results=results,
    )
    return list(angles), agent


# ---- deriving the fixed avatar, and the hard rules ------------------------


def test_the_round_tool_asks_for_a_library_avatar_not_a_buyer_type() -> None:
    schema = tool_input_schema(GeneratedLibraryRoundAngles)

    angle = schema["$defs"]["LibraryAngle"]
    assert "buyerAvatarId" in angle["required"]
    assert "avatar" not in angle["properties"]


@pytest.mark.asyncio
async def test_angles_get_their_fixed_avatar_from_the_library_avatar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    angles, agent = await _generate(monkeypatch, _reply(STEERED))

    assert [(a.buyer_avatar_id, a.avatar) for a in angles] == [
        ("a1", "self_purchaser"),
        ("a1", "self_purchaser"),
        ("a2", "self_purchaser"),
        ("g1", "gift_buyer"),
    ]
    assert "LibraryAngle" in _sent(agent)["tool_schema"]["$defs"]


@pytest.mark.asyncio
async def test_an_unknown_avatar_id_is_retried_with_the_valid_ones_named(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = [*STEERED[:3], _angle("ghost", "anniversary-surprise", "education")]

    angles, agent = await _generate(monkeypatch, _reply(bad), _reply(STEERED))

    assert agent.await_count == 2
    retry = agent.await_args_list[1].kwargs["prompt"]
    assert "ghost" in retry
    assert "a1, a2, g1" in retry
    assert len(angles) == 4


@pytest.mark.asyncio
async def test_freshness_is_per_library_avatar_and_concept(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """a1 already used everyday-wear; a2 using it is a different angle."""
    reused = [_angle("a1", "everyday-wear", "emotion"), *STEERED[1:]]
    other_avatar = [_angle("a2", "everyday-wear", "emotion"), *STEERED[1:]]

    angles, agent = await _generate(monkeypatch, _reply(reused), _reply(other_avatar))

    assert agent.await_count == 2
    assert (
        "already used by an earlier round" in agent.await_args_list[1].kwargs["prompt"]
    )
    assert angles[0].buyer_avatar_id == "a2"


@pytest.mark.asyncio
async def test_an_older_angle_with_no_avatar_blocks_its_concept_for_everyone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = [CreativeAngle(concept="daily-ritual", description="old free text")]

    other_concept = [_angle("a1", "morning-light", "emotion"), *STEERED[1:]]

    angles, agent = await _generate(
        monkeypatch, _reply(STEERED), _reply(other_concept), excluded=old
    )

    # STEERED uses daily-ritual, so the first reply is rejected.
    assert agent.await_count == 2
    assert [a.concept for a in angles][0] == "morning-light"


@pytest.mark.asyncio
async def test_an_old_angle_known_only_by_buyer_type_does_not_block_a_library_avatar(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The key is (library avatar, concept) once an angle has one: the older plain
    (self_purchaser, concept) angle is a different key, as decided for Phase 3."""
    old = [
        CreativeAngle(
            avatar="self_purchaser",
            concept="daily-ritual",
            pillar="emotion",
            description="d",
        )
    ]

    angles, agent = await _generate(monkeypatch, _reply(STEERED), excluded=old)

    assert agent.await_count == 1
    assert angles[0].concept == "daily-ritual"


@pytest.mark.asyncio
async def test_the_count_and_pillar_and_name_rules_still_hold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    three = STEERED[:3]
    same_name = [
        _angle("a1", "daily-ritual", "emotion"),
        _angle("a2", "daily-ritual", "emotion"),
        _angle("g1", "easy-returns", "offer"),
        _angle("a1", "made-to-last", "mechanism"),
    ]

    with pytest.raises(StrategistError):
        await _generate(monkeypatch, _reply(three), _reply(three))
    with pytest.raises(StrategistError):
        await _generate(monkeypatch, _reply(same_name), _reply(same_name))


# ---- the prompt -----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_prompt_lists_the_library_and_names_the_winner(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _reply(STEERED), results=_winner())

    prompt = _sent(agent)["prompt"]
    assert "Buyer avatar library" in prompt
    assert "id a1" in prompt
    assert "Results so far" in prompt
    assert "Self-purchaser – Everyday wear – Emotion" in prompt
    assert "$10.00" in prompt
    assert "cost per add-to-cart" in prompt
    assert "Weakest" in prompt
    assert "Gift buyer – Social proof" in prompt
    assert "at least half" in prompt


@pytest.mark.asyncio
async def test_with_no_clear_leader_the_prompt_says_so_and_does_not_steer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    undecided = RoundResults(None, None, None, 4)

    _, agent = await _generate(monkeypatch, _reply(STEERED), results=undecided)

    prompt = _sent(agent)["prompt"]
    assert "no ad is clearly ahead" in prompt
    assert "at least half" not in prompt


@pytest.mark.asyncio
async def test_without_results_there_is_no_results_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _reply(STEERED))

    assert "Results so far" not in _sent(agent)["prompt"]


@pytest.mark.asyncio
async def test_the_taken_list_names_library_avatars_by_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _reply(STEERED))

    assert "- a1 / everyday-wear" in _sent(agent)["prompt"]


# ---- steering toward the winner (soft) ------------------------------------


@pytest.mark.asyncio
async def test_angles_that_ignore_the_winning_avatar_are_asked_for_again_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    angles, agent = await _generate(
        monkeypatch, _reply(UNSTEERED), _reply(STEERED), results=_winner()
    )

    assert agent.await_count == 2
    assert "winning avatar" in agent.await_args_list[1].kwargs["prompt"]
    assert sum(a.buyer_avatar_id == "a1" for a in angles) == 2


@pytest.mark.asyncio
async def test_after_the_retry_unsteered_angles_are_accepted_with_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger=strategist.logger.name):
        angles, agent = await _generate(
            monkeypatch, _reply(UNSTEERED), _reply(UNSTEERED), results=_winner()
        )

    assert agent.await_count == 2
    assert len(angles) == 4
    assert any("winning avatar" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_angles_that_follow_the_winner_need_no_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _reply(STEERED), results=_winner())

    assert agent.await_count == 1


@pytest.mark.asyncio
async def test_all_angles_on_the_winner_are_asked_to_explore_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    all_a1 = [
        _angle("a1", "daily-ritual", "emotion"),
        _angle("a1", "made-to-last", "mechanism"),
        _angle("a1", "easy-returns", "offer"),
        _angle("a1", "anniversary-surprise", "education"),
    ]

    angles, agent = await _generate(
        monkeypatch, _reply(all_a1), _reply(STEERED), results=_winner()
    )

    assert agent.await_count == 2
    assert "different avatar" in agent.await_args_list[1].kwargs["prompt"]
    assert {a.buyer_avatar_id for a in angles} != {"a1"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "results",
    [
        None,
        RoundResults(None, None, None, 4),  # no clear leader
        _winner(None),  # the winner was an older ad with no library avatar
        _winner("deleted-avatar"),  # its avatar is no longer assignable
    ],
)
async def test_nothing_is_steered_without_a_winning_library_avatar(
    monkeypatch: pytest.MonkeyPatch, results: RoundResults | None
) -> None:
    _, agent = await _generate(monkeypatch, _reply(UNSTEERED), results=results)

    assert agent.await_count == 1


@pytest.mark.asyncio
async def test_a_one_avatar_library_is_never_asked_to_explore(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    solo = [_avatar("a1")]
    all_a1 = [
        _angle("a1", "daily-ritual", "emotion"),
        _angle("a1", "made-to-last", "mechanism"),
        _angle("a1", "easy-returns", "offer"),
        _angle("a1", "anniversary-surprise", "education"),
    ]

    _, agent = await _generate(
        monkeypatch, _reply(all_a1), avatars=solo, results=_winner()
    )

    assert agent.await_count == 1


@pytest.mark.asyncio
async def test_a_soft_miss_survives_a_hard_failure_on_the_retry(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Attempt 1 is valid but ignores the winner; the retry breaks a hard rule. The
    valid first answer is kept rather than failing the round."""
    broken = [*STEERED[:3], _angle("ghost", "anniversary-surprise", "education")]

    with caplog.at_level(logging.WARNING, logger=strategist.logger.name):
        angles, agent = await _generate(
            monkeypatch, _reply(UNSTEERED), _reply(broken), results=_winner()
        )

    assert agent.await_count == 2
    assert [a.concept for a in angles] == [a["concept"] for a in UNSTEERED]
    assert any("winning avatar" in r.getMessage() for r in caplog.records)


@pytest.mark.asyncio
async def test_a_hard_failure_with_nothing_valid_to_fall_back_on_still_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    broken = [*STEERED[:3], _angle("ghost", "anniversary-surprise", "education")]

    with pytest.raises(StrategistError):
        await _generate(monkeypatch, _reply(broken), _reply(broken), results=_winner())


# ---- fake mode ------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [3, 4])
async def test_fake_mode_gives_the_round_valid_library_angles_led_by_the_winner(
    monkeypatch: pytest.MonkeyPatch, count: int
) -> None:
    monkeypatch.setattr(
        strategist, "get_settings", lambda: SimpleNamespace(fake_llm_enabled=True)
    )

    angles, _ = await _generate(
        monkeypatch,
        dict(strategist._FAKE_ROUND_ANGLES_FIELDS),  # noqa: SLF001
        results=_winner("g1"),
        count=count,
        excluded=[],
    )

    assert len(angles) == count
    assert all(a.buyer_avatar_id for a in angles)
    assert sum(a.buyer_avatar_id == "g1" for a in angles) >= -(-count // 2)
