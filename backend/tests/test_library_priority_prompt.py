"""The library's order is a priority the first-batch Strategist is told about.

The owner sets the order of the buyer avatars (the Avatars tab: drag, or move up and
down). The first batch uses four different avatars, so with more than four active
avatars the prompt must say that earlier ones are preferred, without dropping any of
the existing coverage rules. Later rounds keep steering toward the winning avatar and
get no such sentence.
"""

from app.schemas.strategy import CreativeAngle
from app.services import avatar_library_prompt, strategist
from prisma.models import BuyerAvatar

from tests.test_creative_test_plan import _business, _product
from tests.test_creative_test_plan_publish import _creative_plan
from tests.test_library_test_plan import _avatar

_PRIORITY = "earlier in the library"


def _six() -> list[BuyerAvatar]:
    return [
        _avatar("a1"),
        _avatar("a2"),
        _avatar("a3"),
        _avatar("g1", "gift"),
        _avatar("a4"),
        _avatar("g2", "gift"),
    ]


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


def test_more_than_four_avatars_prefer_the_earlier_ones() -> None:
    sentence = avatar_library_prompt.coverage_sentence(
        {a.id: a.purchaseFor for a in _six()}
    )

    assert _PRIORITY in sentence
    assert "priority" in sentence


def test_the_priority_sentence_keeps_every_existing_coverage_rule() -> None:
    sentence = avatar_library_prompt.coverage_sentence(
        {a.id: a.purchaseFor for a in _six()}
    )

    assert "four different avatars of the library, one for each angle" in sentence
    assert "cover at least one of each" in sentence


def test_four_or_fewer_avatars_get_no_priority_sentence() -> None:
    for count in (1, 2, 3, 4):
        library = {a.id: a.purchaseFor for a in _six()[:count]}

        assert _PRIORITY not in avatar_library_prompt.coverage_sentence(library)


def test_the_first_batch_prompt_carries_the_priority_sentence() -> None:
    assert _PRIORITY in _first_batch(_six())


def test_the_first_batch_prompt_for_four_avatars_does_not() -> None:
    assert _PRIORITY not in _first_batch(_six()[:4])


def test_the_library_block_lists_the_avatars_in_the_order_given() -> None:
    block = avatar_library_prompt.library_block(_six())

    positions = [block.index(f"id {a.id} ") for a in _six()]
    assert positions == sorted(positions)


def test_a_round_prompt_gets_no_priority_sentence() -> None:
    assert _PRIORITY not in _round(_six())
