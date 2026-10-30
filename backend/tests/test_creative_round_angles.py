"""The Strategist's angles for a follow-up round, and a three-ad Creative batch.

Anthropic is always mocked: the model call is replaced by a canned tool reply.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from app.schemas.strategy import (
    CreativeAngle,
    GeneratedCreativeAngle,
    GeneratedRoundAngles,
)
from app.services import creative as creative_service
from app.services import strategist
from app.services.strategist import StrategistError
from pydantic import ValidationError

from tests.test_creative_service import _fake_business as _creative_business
from tests.test_creative_service import _fake_product as _creative_product
from tests.test_creative_test_plan_publish import _creative_plan
from tests.test_strategist_service import (
    _fake_audience,
    _fake_business,
    _fake_product,
    anthropic_api_key,  # noqa: F401  (fixture, must be in this namespace)
)


def _angle(avatar: str, concept: str, pillar: str = "emotion") -> dict[str, str]:
    return {
        "avatar": avatar,
        "concept": concept,
        "pillar": pillar,
        "description": f"What {concept} shows.",
    }


FRESH = [
    _angle("self_purchaser", "daily-ritual"),
    _angle("self_purchaser", "made-to-last", "mechanism"),
    _angle("gift_buyer", "anniversary-surprise"),
    _angle("gift_buyer", "easy-returns", "offer"),
]
EXCLUDED = [
    CreativeAngle(
        avatar="self_purchaser",
        concept="everyday-wear",
        description="d",
        pillar="emotion",
    ),
    CreativeAngle(
        avatar="gift_buyer",
        concept="the-perfect-gift",
        description="d",
        pillar="emotion",
    ),
]


def _reply(angles: list[dict[str, str]]) -> SimpleNamespace:
    return SimpleNamespace(
        content=[SimpleNamespace(type="tool_use", input={"creativeAngles": angles})],
        stop_reason="end_turn",
    )


def _mock_model(
    monkeypatch: pytest.MonkeyPatch, *replies: SimpleNamespace
) -> AsyncMock:
    create = AsyncMock(side_effect=list(replies))
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(strategist, "AsyncAnthropic", lambda **_kwargs: client)
    return create


async def _generate(count: int = 4) -> list[GeneratedCreativeAngle]:
    return list(
        await strategist.generate_round_angles(
            business=_fake_business(),
            product=_fake_product(),
            audience=_fake_audience(),
            plan=_creative_plan(),
            excluded_angles=EXCLUDED,
            count=count,
        )
    )


@pytest.mark.asyncio
async def test_fresh_angles_are_returned(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_model(monkeypatch, _reply(FRESH))

    angles = await _generate()

    assert [a.concept for a in angles] == [
        "daily-ritual",
        "made-to-last",
        "anniversary-surprise",
        "easy-returns",
    ]
    assert create.call_count == 1


@pytest.mark.asyncio
async def test_the_prompt_lists_the_concepts_already_used(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_model(monkeypatch, _reply(FRESH))

    await _generate()

    sent = str(create.call_args.kwargs["system"]) + str(
        create.call_args.kwargs["messages"]
    )
    assert "everyday-wear" in sent
    assert "the-perfect-gift" in sent
    assert "exactly 4 NEW angles" in sent


@pytest.mark.asyncio
async def test_a_reused_concept_is_retried_once_with_the_problem_named(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reused = [_angle("gift_buyer", "everyday-wear"), *FRESH[1:]]
    create = _mock_model(monkeypatch, _reply(reused), _reply(FRESH))

    angles = await _generate()

    assert create.call_count == 2
    retry_prompt = str(create.call_args_list[1].kwargs["messages"])
    assert "already used by an earlier round" in retry_prompt
    assert "everyday-wear" in retry_prompt
    assert len(angles) == 4


@pytest.mark.asyncio
async def test_angles_still_stale_after_the_retry_fail_cleanly(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reused = [_angle("gift_buyer", "everyday-wear"), *FRESH[1:]]
    create = _mock_model(monkeypatch, _reply(reused), _reply(reused))

    with pytest.raises(StrategistError, match="invalid angles"):
        await _generate()

    assert create.call_count == 2


@pytest.mark.asyncio
async def test_a_thin_product_asks_for_three_and_rejects_four(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_model(monkeypatch, _reply(FRESH), _reply(FRESH[:3]))

    angles = await _generate(count=3)

    assert len(angles) == 3
    assert create.call_count == 2
    assert "exactly 3 NEW angles" in str(create.call_args_list[0].kwargs["system"])


@pytest.mark.asyncio
async def test_fake_mode_returns_canned_angles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        strategist, "get_settings", lambda: SimpleNamespace(fake_llm_enabled=True)
    )

    angles = await _generate()

    assert len(angles) == 4


def test_the_angles_schema_enforces_count_freshness_and_distinct_pairs() -> None:
    context = {"count": 4, "excluded_concepts": ["everyday-wear"]}
    GeneratedRoundAngles.model_validate({"creativeAngles": FRESH}, context=context)
    for bad, message in (
        (FRESH[:3], "exactly 4"),
        ([_angle("gift_buyer", "everyday-wear"), *FRESH[1:]], "earlier round"),
        ([FRESH[0], FRESH[0], *FRESH[2:]], "own avatar and concept pair"),
    ):
        with pytest.raises(ValidationError, match=message):
            GeneratedRoundAngles.model_validate(
                {"creativeAngles": bad}, context=context
            )


# ── A three-ad Creative batch (a round for a thin product) ───


def test_the_creative_prompt_asks_for_the_batch_size() -> None:
    plan = _creative_plan()

    three = creative_service._build_prompt(
        _creative_business(), _creative_product(), plan, batch_size=3
    )
    four = creative_service._build_prompt(
        _creative_business(), _creative_product(), plan
    )

    assert "Generate exactly 3 variants" in three
    assert "All three variants in this batch" in three
    assert "Generate exactly 4 variants" in four
    assert "All four variants in this batch" in four


@pytest.mark.asyncio
async def test_fake_mode_trims_a_batch_to_its_size(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        creative_service, "get_settings", lambda: SimpleNamespace(fake_llm_enabled=True)
    )

    variants = await creative_service.generate_creatives(
        business=_creative_business(),
        product=_creative_product(),
        strategy=_creative_plan(),
        batch_size=3,
    )

    assert len(variants) == 3
