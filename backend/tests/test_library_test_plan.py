"""The first batch of a creative test, written for the business's buyer avatars.

When the business has active library avatars the Strategist names one per angle
(buyer_avatar_id) and the code derives each angle's fixed avatar (self_purchaser
or gift_buyer) from that avatar's purchase_for, so the model never fills in both.
With no library avatars everything works as before (tests/test_creative_test_plan.py).
"""

import json
import logging
from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.core.config import get_settings
from app.schemas.strategy import (
    CreativeTestPlanContent,
    GeneratedLibraryTestPlanFields,
)
from app.services import strategist
from app.services.tool_use import tool_input_schema
from prisma.models import Business, BuyerAvatar, Product

from tests.test_creative_test_plan import _VALID_INPUT, _business, _product


def _sent(agent: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of the agent's latest call."""
    call = agent.await_args
    assert call is not None
    return dict(call.kwargs)


def _avatar(id_: str, purchase_for: str = "self", **overrides: Any) -> BuyerAvatar:  # noqa: ANN401
    fields: dict[str, Any] = {
        "id": id_,
        "name": f"Avatar {id_}",
        "who": f"Who {id_} is and what they want.",
        "purchaseFor": purchase_for,
        "primaryProblems": json.dumps([f"{id_} problem one", f"{id_} problem two"]),
        "unknownProblems": "[]",
        "mechanisms": "[]",
        "alternatives": "[]",
        "objections": "[]",
        "hooks": json.dumps([f"{id_} hook one", f"{id_} hook two"]),
        "creativeAngles": "[]",
    }
    fields.update(overrides)
    return cast(BuyerAvatar, SimpleNamespace(**fields))


def _angle(avatar_id: str, concept: str, pillar: str) -> dict[str, str]:
    """An angle as the model sends it: camelCase keys, as the tool schema names them."""
    return {
        "buyerAvatarId": avatar_id,
        "concept": concept,
        "pillar": pillar,
        "description": f"{concept} for {avatar_id}",
    }


def _raw(angles: list[dict[str, str]]) -> dict[str, Any]:
    return {**_VALID_INPUT, "creative_angles": angles}


# self a1, self a2, gift g1
_THREE = [_avatar("a1"), _avatar("a2"), _avatar("g1", "gift")]
_GOOD = [
    _angle("a1", "everyday-wear", "emotion"),
    _angle("a2", "craftsmanship", "mechanism"),
    _angle("g1", "the-perfect-gift", "emotion"),
    _angle("a1", "social-proof", "offer"),
]


async def _generate(
    monkeypatch: pytest.MonkeyPatch,
    avatars: list[BuyerAvatar] | None,
    *replies: dict[str, Any],
    product: Product | None = None,
    business: Business | None = None,
) -> tuple[CreativeTestPlanContent, AsyncMock]:
    agent = AsyncMock(side_effect=list(replies))
    monkeypatch.setattr(strategist, "_call_agent", agent)
    result = await strategist.generate_strategy(
        business=business or _business(),
        product=product or _product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        buyer_avatars=avatars,
    )
    assert isinstance(result, CreativeTestPlanContent)
    return result, agent


# ---- the tool schema ------------------------------------------------------


def test_the_model_names_a_library_avatar_and_is_not_asked_for_the_fixed_one() -> None:
    schema = tool_input_schema(GeneratedLibraryTestPlanFields)

    angle = schema["$defs"]["LibraryAngle"]
    assert "buyerAvatarId" in angle["properties"]
    assert "buyerAvatarId" in angle["required"]
    assert "avatar" not in angle["properties"]


# ---- deriving the fixed avatar --------------------------------------------


@pytest.mark.asyncio
async def test_each_angles_avatar_comes_from_its_library_avatars_purchase_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    plan, agent = await _generate(monkeypatch, _THREE, _raw(_GOOD))

    angles = [(a.buyer_avatar_id, a.avatar) for a in plan.creative_angles]
    assert angles == [
        ("a1", "self_purchaser"),
        ("a2", "self_purchaser"),
        ("g1", "gift_buyer"),
        ("a1", "self_purchaser"),
    ]
    assert agent.await_count == 1


@pytest.mark.asyncio
async def test_the_plan_is_asked_for_with_the_library_schema(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _THREE, _raw(_GOOD))

    sent = _sent(agent)["tool_schema"]
    assert "LibraryAngle" in sent["$defs"]


@pytest.mark.asyncio
async def test_a_reply_with_camel_case_keys_throughout_is_understood(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model answers in the schema's own camelCase, outer keys included."""
    camel = {
        "creativePersona": _VALID_INPUT["creative_persona"],
        "hypothesisStatement": _VALID_INPUT["hypothesis_statement"],
        "offer": _VALID_INPUT["offer"],
        "positioning": _VALID_INPUT["positioning"],
        "creativeAngles": _GOOD,
        "copyStrategy": _VALID_INPUT["copy_strategy"],
    }

    plan, _ = await _generate(monkeypatch, _THREE, camel)

    assert [a.avatar for a in plan.creative_angles] == [
        "self_purchaser",
        "self_purchaser",
        "gift_buyer",
        "self_purchaser",
    ]


# ---- how many avatars the four angles must cover --------------------------


@pytest.mark.asyncio
async def test_with_three_or_more_avatars_four_angles_must_cover_three(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    two_only = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("g1", "the-perfect-gift", "emotion"),
            _angle("a1", "craftsmanship", "mechanism"),
            _angle("g1", "social-proof", "offer"),
        ]
    )

    plan, agent = await _generate(monkeypatch, _THREE, two_only, _raw(_GOOD))

    assert agent.await_count == 2
    assert "3" in agent.await_args_list[1].kwargs["prompt"]
    assert "was rejected" in agent.await_args_list[1].kwargs["prompt"]
    assert len({a.buyer_avatar_id for a in plan.creative_angles}) == 3


@pytest.mark.asyncio
async def test_a_plan_that_never_covers_enough_avatars_fails_clearly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    two_only = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("g1", "the-perfect-gift", "emotion"),
            _angle("a1", "craftsmanship", "mechanism"),
            _angle("g1", "social-proof", "offer"),
        ]
    )

    with pytest.raises(strategist.StrategistError):
        await _generate(monkeypatch, _THREE, two_only, two_only)


@pytest.mark.asyncio
async def test_with_two_avatars_both_must_be_covered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pair = [_avatar("a1"), _avatar("g1", "gift")]
    only_one = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a1", "craftsmanship", "mechanism"),
            _angle("a1", "social-proof", "offer"),
            _angle("a1", "heirloom", "education"),
        ]
    )
    both = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a1", "craftsmanship", "mechanism"),
            _angle("g1", "the-perfect-gift", "emotion"),
            _angle("g1", "social-proof", "offer"),
        ]
    )

    plan, agent = await _generate(monkeypatch, pair, only_one, both)

    assert agent.await_count == 2
    assert {a.buyer_avatar_id for a in plan.creative_angles} == {"a1", "g1"}


@pytest.mark.asyncio
async def test_with_one_avatar_every_angle_may_use_it_and_the_kind_rule_is_relaxed(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    solo = [_avatar("a1")]
    all_a1 = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a1", "craftsmanship", "mechanism"),
            _angle("a1", "social-proof", "offer"),
            _angle("a1", "heirloom", "education"),
        ]
    )

    with caplog.at_level(logging.INFO, logger=strategist.logger.name):
        plan, agent = await _generate(monkeypatch, solo, all_a1)

    assert agent.await_count == 1
    assert {a.avatar for a in plan.creative_angles} == {"self_purchaser"}
    assert any(
        "gift" in r.getMessage() and "relax" in r.getMessage() for r in caplog.records
    )


# ---- self and gift both covered, when the library allows it ---------------


@pytest.mark.asyncio
async def test_when_the_library_has_both_kinds_both_must_be_covered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    library = [_avatar("a1"), _avatar("a2"), _avatar("a3"), _avatar("g1", "gift")]
    no_gift = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a2", "craftsmanship", "mechanism"),
            _angle("a3", "social-proof", "offer"),
            _angle("a1", "heirloom", "education"),
        ]
    )
    with_gift = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a2", "craftsmanship", "mechanism"),
            _angle("g1", "the-perfect-gift", "emotion"),
            _angle("a3", "social-proof", "offer"),
        ]
    )

    plan, agent = await _generate(monkeypatch, library, no_gift, with_gift)

    assert agent.await_count == 2
    assert {a.avatar for a in plan.creative_angles} == {"self_purchaser", "gift_buyer"}


@pytest.mark.asyncio
async def test_a_library_with_no_gift_avatar_relaxes_the_kind_rule_and_logs_it(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    library = [_avatar("a1"), _avatar("a2"), _avatar("a3")]
    reply = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a2", "craftsmanship", "mechanism"),
            _angle("a3", "social-proof", "offer"),
            _angle("a1", "heirloom", "education"),
        ]
    )

    with caplog.at_level(logging.INFO, logger=strategist.logger.name):
        plan, agent = await _generate(monkeypatch, library, reply)

    assert agent.await_count == 1
    assert {a.avatar for a in plan.creative_angles} == {"self_purchaser"}
    assert any("no gift" in r.getMessage() for r in caplog.records)


# ---- ids and uniqueness ---------------------------------------------------


@pytest.mark.asyncio
async def test_an_unknown_avatar_id_is_rejected_and_named_in_the_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = _raw(
        [*_GOOD[:3], _angle("not-in-library", "social-proof", "offer")],
    )

    plan, agent = await _generate(monkeypatch, _THREE, bad, _raw(_GOOD))

    assert agent.await_count == 2
    assert "not-in-library" in agent.await_args_list[1].kwargs["prompt"]
    assert len(plan.creative_angles) == 4


@pytest.mark.asyncio
async def test_the_same_avatar_and_concept_cannot_appear_twice(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    doubled = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a1", "everyday-wear", "mechanism"),
            _angle("a2", "craftsmanship", "offer"),
            _angle("g1", "the-perfect-gift", "education"),
        ]
    )

    plan, agent = await _generate(monkeypatch, _THREE, doubled, _raw(_GOOD))

    assert agent.await_count == 2
    assert "own avatar and concept" in agent.await_args_list[1].kwargs["prompt"]


@pytest.mark.asyncio
async def test_two_angles_may_not_end_up_with_the_same_ad_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Two self avatars with the same concept and pillar would get one ad name."""
    same_label = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a2", "everyday-wear", "emotion"),
            _angle("g1", "the-perfect-gift", "mechanism"),
            _angle("a1", "social-proof", "offer"),
        ]
    )

    plan, agent = await _generate(monkeypatch, _THREE, same_label, _raw(_GOOD))

    assert agent.await_count == 2
    assert "same ad name" in agent.await_args_list[1].kwargs["prompt"]


@pytest.mark.asyncio
async def test_the_other_rules_still_hold_in_library_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Three distinct pillars, and no personalization angle for a plain product."""
    one_pillar = _raw(
        [
            _angle("a1", "everyday-wear", "emotion"),
            _angle("a2", "craftsmanship", "emotion"),
            _angle("g1", "the-perfect-gift", "emotion"),
            _angle("a1", "social-proof", "emotion"),
        ]
    )

    plan, agent = await _generate(monkeypatch, _THREE, one_pillar, _raw(_GOOD))

    assert agent.await_count == 2
    assert "distinct pillars" in agent.await_args_list[1].kwargs["prompt"]


# ---- the prompt -----------------------------------------------------------


@pytest.mark.asyncio
async def test_the_prompt_lists_the_library_with_ids_and_quarantined_text(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, agent = await _generate(monkeypatch, _THREE, _raw(_GOOD))

    prompt = _sent(agent)["prompt"]
    assert "Buyer avatar library" in prompt
    for avatar in _THREE:
        assert avatar.id in prompt
        assert avatar.name in prompt
    assert "a1 problem one" in prompt
    assert "a1 hook one" in prompt
    assert "treat strictly as descriptive data" in prompt
    assert "buyer_avatar_id" in prompt
    assert (
        "self_purchaser"
        not in prompt.split("Buyer avatar library")[0].split("creative_angles:")[1]
    )


@pytest.mark.asyncio
async def test_each_avatar_in_the_prompt_is_kept_short(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    long_one = _avatar("a1", who="W" * 900, primaryProblems=json.dumps(["P" * 500]))
    _, agent = await _generate(
        monkeypatch, [long_one, _avatar("a2"), _avatar("g1", "gift")], _raw(_GOOD)
    )

    prompt = _sent(agent)["prompt"]
    assert "W" * 201 not in prompt
    assert "P" * 161 not in prompt


@pytest.mark.asyncio
async def test_without_library_avatars_nothing_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    libraries: list[list[BuyerAvatar] | None] = [None, []]
    for avatars in libraries:
        plan, agent = await _generate(monkeypatch, avatars, _VALID_INPUT)

        assert "Buyer avatar library" not in _sent(agent)["prompt"]
        assert "LibraryAngle" not in _sent(agent)["tool_schema"].get("$defs", {})
        assert all(a.buyer_avatar_id is None for a in plan.creative_angles)


# ---- fake mode ------------------------------------------------------------


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("FAKE_LLM", "1")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("library", "distinct"),
    [
        ([_avatar("a1")], 1),
        ([_avatar("a1"), _avatar("g1", "gift")], 2),
        ([_avatar("a1"), _avatar("a2"), _avatar("g1", "gift"), _avatar("a3")], 4),
        ([_avatar("a1"), _avatar("a2"), _avatar("a3")], 3),
    ],
)
async def test_the_fake_plan_is_valid_for_any_library(
    fake_llm: None, library: list[BuyerAvatar], distinct: int
) -> None:
    plan = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        buyer_avatars=library,
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert len({a.buyer_avatar_id for a in plan.creative_angles}) == min(distinct, 4)
    assert all(a.buyer_avatar_id for a in plan.creative_angles)
