"""Prompt rules found by the Phase 4 smoke test (2026-11-01).

The Strategist wrote hook wording and headlines into angle descriptions, and the
Creative Agent followed the description over the avatar's own problem, mechanism and
teach-it entries. So: descriptions say what the ad shows and promises and never
carry a headline or a hook; where description and avatar block differ, the block wins;
and an offer ad answers the avatar's objection with the single most relevant stored
proof point, qualifiers kept.
"""

from collections.abc import Callable
from typing import Any

import pytest
from app.schemas.strategy import CreativeAngle
from app.services import creative, strategist
from app.services.strategist import _REQUEST_MARKER
from prisma.models import BuyerAvatar

from tests.test_creative_avatar_prompt import ASSIGNED, LIBRARY, PLAN
from tests.test_creative_service import _fake_business as creative_business
from tests.test_creative_service import _fake_product as creative_product
from tests.test_creative_test_plan import _business, _product
from tests.test_creative_test_plan_publish import _creative_plan
from tests.test_library_test_plan import _THREE

_RULE_PARTS = ("never a headline", "never quote or paraphrase", "hook")


def _first_batch_prompt(avatars: list[BuyerAvatar] | None) -> str:
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


def _round_prompt(avatars: list[BuyerAvatar] | None) -> str:
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


# ---- the Strategist ---------------------------------------------------------


@pytest.mark.parametrize("build", [_first_batch_prompt, _round_prompt])
def test_a_library_prompt_forbids_headlines_and_hooks_in_angle_descriptions(
    build: Callable[[list[BuyerAvatar] | None], str],
) -> None:
    prompt = build(_THREE)
    instructions = prompt.split(_REQUEST_MARKER)[0]

    for part in _RULE_PARTS:
        assert part in instructions
    assert "what the ad shows and promises" in instructions


@pytest.mark.parametrize("build", [_first_batch_prompt, _round_prompt])
def test_the_rule_is_not_added_without_a_library(
    build: Callable[[list[BuyerAvatar] | None], str],
) -> None:
    libraries: list[list[BuyerAvatar] | None] = [None, []]
    for avatars in libraries:
        prompt = build(avatars)

        assert "never a headline" not in prompt
        assert "never quote or paraphrase" not in prompt


# ---- the Creative Agent -----------------------------------------------------


def _tail(plan: Any = PLAN) -> str:  # noqa: ANN401
    return creative._build_prompt_parts(  # noqa: SLF001
        creative_business(),
        creative_product(),
        plan,
        buyer_avatars=LIBRARY,
        assigned_avatars=ASSIGNED,
    )[1]


def test_where_the_description_and_the_avatar_block_differ_the_block_wins() -> None:
    tail = _tail()

    assert "avatar block wins" in tail
    assert "problem" in tail.split("avatar block wins")[0][-300:]
    assert "mechanism" in tail.split("avatar block wins")[0][-300:]
    assert "teach" in tail.split("avatar block wins")[0][-300:]


def test_an_offer_objection_gets_the_single_most_relevant_proof_point() -> None:
    tail = _tail()
    block = tail.split("Avatar for variant C")[1].split("Avatar for variant D")[0]

    assert "single most relevant proof point" in block
    assert "qualifiers" in block
    assert "on US orders" in block  # the worked example of a qualifier to keep
    assert "never invent an offer" in block.lower()


def test_the_offer_rule_matches_the_worry_not_just_any_perk() -> None:
    tail = _tail()

    assert "return or refund" in tail
    assert "not by shipping" in tail


def test_the_guidance_is_written_once_however_many_blocks_there_are() -> None:
    assert _tail().count("avatar block wins") == 1


# ---- winners carried into the round --------------------------------------------


def _carried_prompt(carried: list[strategist.CarriedAd] | None) -> str:
    return strategist._build_round_angles_prompt(  # noqa: SLF001
        _business(),
        _product(),
        None,
        _creative_plan(),
        [CreativeAngle(avatar="self_purchaser", concept="x", description="d")],
        4,
        None,
        None,
        carried=carried,
    )


def test_the_round_prompt_lists_the_ads_that_stay_live_and_asks_for_complements() -> (
    None
):
    prompt = _carried_prompt(
        [
            strategist.CarriedAd(
                avatar="gift_buyer",
                concept="made-to-last",
                pillar="mechanism",
                hook_type="question",
                headline="Built to be handed down",
            )
        ]
    )

    assert "staying live" in prompt
    assert "gift_buyer / made-to-last" in prompt
    assert "pillar mechanism" in prompt
    assert "hook question" in prompt
    assert "Built to be handed down" in prompt
    assert "complement" in prompt


def test_without_carried_ads_the_round_prompt_has_no_such_block() -> None:
    assert "staying live" not in _carried_prompt(None)
    assert "staying live" not in _carried_prompt([])
