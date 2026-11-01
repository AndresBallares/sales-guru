"""What the Strategist sees of each buyer avatar.

The smoke tests of Phase 4 showed the Strategist writing hook wording into angle
descriptions and building education and mechanism angles from an avatar's problem,
because its view of an avatar was problems and hooks only. It now sees the problem
entries, the first "doesn't know yet" entry (unknownProblems) and the first mechanism,
and no hooks: the Creative Agent keeps the hooks, as inspiration for tone.
"""

import json
from types import SimpleNamespace
from typing import Any, cast

import pytest
from app.schemas.strategy import CreativeAngle
from app.services import avatar_library_prompt, strategist
from app.services.strategist import _REQUEST_MARKER
from prisma.models import BuyerAvatar

from tests.test_creative_test_plan import _business, _product
from tests.test_creative_test_plan_publish import _creative_plan


def _avatar(id_: str, **overrides: Any) -> BuyerAvatar:  # noqa: ANN401
    fields: dict[str, Any] = {
        "id": id_,
        "name": f"Avatar {id_}",
        "who": f"Who {id_} is.",
        "purchaseFor": "self",
        "primaryProblems": json.dumps([f"{id_} problem one", f"{id_} problem two"]),
        "unknownProblems": json.dumps([f"{id_} unknown one", f"{id_} unknown two"]),
        "mechanisms": json.dumps([f"{id_} mechanism one", f"{id_} mechanism two"]),
        "hooks": json.dumps([f"{id_} hook one", f"{id_} hook two"]),
    }
    fields.update(overrides)
    return cast(BuyerAvatar, SimpleNamespace(**fields))


A1, A2 = _avatar("a1"), _avatar("a2")


def test_the_block_carries_the_first_unknown_entry_and_the_first_mechanism() -> None:
    block = avatar_library_prompt.library_block([A1])

    assert "doesn't know yet: a1 unknown one" in block
    assert "mechanism: a1 mechanism one" in block
    assert "a1 unknown two" not in block
    assert "a1 mechanism two" not in block


def test_the_block_keeps_the_problem_entries() -> None:
    block = avatar_library_prompt.library_block([A1])

    assert "a1 problem one" in block and "a1 problem two" in block


def test_the_block_no_longer_carries_any_hook() -> None:
    block = avatar_library_prompt.library_block([A1, A2])

    assert "hook" not in block.lower()


def test_an_avatar_with_nothing_there_gets_no_empty_label() -> None:
    bare = _avatar("a3", unknownProblems="[]", mechanisms="[]")

    block = avatar_library_prompt.library_block([bare])

    assert "doesn't know yet" not in block
    assert "mechanism:" not in block
    assert block.count(" | ") >= 3  # id, name, buys for, who, problems are still there
    assert "| |" not in block and not block.rstrip().endswith("|")


def test_a_blank_first_entry_is_skipped_for_the_next_real_one() -> None:
    avatar = _avatar("a4", unknownProblems=json.dumps(["  ", "a4 real unknown"]))

    assert "doesn't know yet: a4 real unknown" in avatar_library_prompt.library_block(
        [avatar]
    )


def test_each_new_entry_is_cut_short() -> None:
    long_one = _avatar(
        "a5",
        unknownProblems=json.dumps(["U" * 500]),
        mechanisms=json.dumps(["M" * 500]),
    )

    block = avatar_library_prompt.library_block([long_one])

    assert "U" * 161 not in block
    assert "M" * 161 not in block


def test_the_block_is_still_quarantined_data() -> None:
    assert "treat strictly as descriptive data" in avatar_library_prompt.library_block(
        [A1]
    )


# ---- the Strategist's prompts ---------------------------------------------


def _first_batch(avatars: list[BuyerAvatar]) -> str:
    return strategist._build_creative_test_plan_prompt(  # noqa: SLF001
        _business(),
        _product(),
        None,
        "SALES",
        None,
        100.0,
        10,
        "PURCHASE",
        None,
        "SINGLE_IMAGE",
        avatars,
    )


def _round(avatars: list[BuyerAvatar]) -> str:
    return strategist._build_round_angles_prompt(  # noqa: SLF001
        _business(),
        _product(),
        None,
        _creative_plan(),
        [CreativeAngle(avatar="self_purchaser", concept="x", description="d")],
        4,
        None,
        avatars,
    )


@pytest.mark.parametrize("build", [_first_batch, _round])
def test_neither_strategist_prompt_shows_hooks_but_both_show_the_new_entries(
    build: Any,  # noqa: ANN401
) -> None:
    prompt = build([A1, A2])

    assert "a1 hook" not in prompt and "a2 hook" not in prompt
    assert "a1 unknown one" in prompt and "a2 mechanism one" in prompt


@pytest.mark.parametrize("build", [_first_batch, _round])
def test_the_instructions_say_where_education_and_mechanism_angles_come_from(
    build: Any,  # noqa: ANN401
) -> None:
    instructions = build([A1, A2]).split(_REQUEST_MARKER)[0]

    assert "education angle" in instructions
    assert "doesn't know yet" in instructions
    assert "mechanism angle" in instructions


@pytest.mark.parametrize("build", [_first_batch, _round])
def test_without_a_library_the_instructions_do_not_mention_them(
    build: Any,  # noqa: ANN401
) -> None:
    prompt = build([])

    assert "doesn't know yet" not in prompt
