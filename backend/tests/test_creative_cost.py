"""Tests for the Creative Agent's cost changes (2026-10 token review).

Four behaviors: static instructions live in a cached ``system`` block, a
single slot can be regenerated as one variant instead of a discarded batch
of four, the visual prompts are no longer generated, and every call is
logged with its usage.
"""

import logging
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.schemas.creative import (
    MAX_BODY_TEXT_LENGTH,
    GeneratedCreativeBatch,
    GeneratedCreativeVariant,
)
from app.services import ad_quality, creative
from pydantic import ValidationError

from tests.test_creative_service import (
    _FAKE_STRATEGY,
    _ONE_VARIANT,
    _creative_plan,
    _fake_brand_profile,
    _fake_business,
    _fake_product,
    _structured_plan,
    anthropic_api_key,  # noqa: F401 — pytest fixture re-exported for this module
)

_NO_VISUAL_PROMPTS = dict(_ONE_VARIANT)


def _batch_of(count: int) -> dict[str, Any]:
    angles = ["Craftsmanship", "Luxury", "Personalization", "Heritage"]
    return {
        "variants": [
            {**_NO_VISUAL_PROMPTS, "creativeAngle": angles[i]} for i in range(count)
        ]
    }


def _client_returning(
    monkeypatch: pytest.MonkeyPatch, *inputs: dict[str, Any]
) -> AsyncMock:
    usage = SimpleNamespace(
        input_tokens=100,
        output_tokens=50,
        cache_creation_input_tokens=0,
        cache_read_input_tokens=0,
        output_tokens_details=SimpleNamespace(thinking_tokens=0),
    )
    create = AsyncMock(
        side_effect=[
            SimpleNamespace(
                content=[SimpleNamespace(type="tool_use", input=i)],
                usage=usage,
                stop_reason="tool_use",
            )
            for i in inputs
        ]
    )
    client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(creative, "AsyncAnthropic", lambda **_kwargs: client)
    return create


# ---------- the visual prompts are no longer generated ----------


def test_the_variant_schema_no_longer_asks_for_visual_prompts() -> None:
    schema = GeneratedCreativeBatch.model_json_schema()
    variant_props = schema["$defs"]["GeneratedCreativeVariant"]["properties"]

    assert "imagePrompt" not in variant_props
    assert "videoPrompt" not in variant_props


def test_a_variant_validates_without_visual_prompts() -> None:
    variant = GeneratedCreativeVariant.model_validate(_NO_VISUAL_PROMPTS)

    assert variant.headline == "Emeralds With a Story"


def test_no_prompt_text_mentions_the_visual_prompts() -> None:
    system = creative._build_system_prompt()
    user = creative._build_prompt(_fake_business(), _fake_product(), _FAKE_STRATEGY)

    for text in (system, user):
        assert "image_prompt" not in text
        assert "video_prompt" not in text


def test_fake_mode_variants_carry_no_visual_prompts() -> None:
    for variant in creative._FAKE_VARIANTS:
        assert not hasattr(variant, "image_prompt")
        assert not hasattr(variant, "video_prompt")


# ---------- batch size is a request, not a constant ----------


def test_the_batch_schema_allows_one_to_four_variants_so_one_tool_serves_both() -> None:
    """One schema for the batch and the single-variant call keeps the cached
    tools+system prefix identical between them."""
    variants = GeneratedCreativeBatch.model_json_schema()["properties"]["variants"]

    assert variants["minItems"] == 1
    assert variants["maxItems"] == 4


def test_a_batch_defaults_to_requiring_exactly_four_variants() -> None:
    with pytest.raises(ValidationError, match="exactly 4"):
        GeneratedCreativeBatch.model_validate(_batch_of(3))

    assert len(GeneratedCreativeBatch.model_validate(_batch_of(4)).variants) == 4


def test_a_batch_accepts_exactly_the_requested_count() -> None:
    batch = GeneratedCreativeBatch.model_validate(
        _batch_of(1), context={"variant_count": 1}
    )

    assert len(batch.variants) == 1


def test_a_batch_rejects_a_count_other_than_the_requested_one() -> None:
    with pytest.raises(ValidationError, match="exactly 1"):
        GeneratedCreativeBatch.model_validate(
            _batch_of(2), context={"variant_count": 1}
        )


# ---------- static instructions are a cached system block ----------


def test_the_system_prompt_is_static_and_holds_the_rules_and_limits() -> None:
    system = creative._build_system_prompt()

    assert "Ad quality rules" in system
    assert "Ad structure" in system
    assert "Meta ad quality rules" in system
    assert creative._build_system_prompt() == system


def test_the_slot_limits_and_shared_cta_close_the_request_prompt() -> None:
    """Moved into the cached block, these made the first attempt fail
    validation on 6 of 6 real calls (primary text over 125 characters, mixed
    CTAs). They close the request, as they always did, so they are the last
    thing the model reads before writing."""
    system = creative._build_system_prompt()
    user = creative._build_prompt(_fake_business(), _fake_product(), _FAKE_STRATEGY)

    assert "Each variant needs" not in system
    assert "the one shared CTA chosen above" not in system
    assert "must use that same CTA" in user
    closing = user[user.index("Generate exactly 4 variants") :]
    assert f"at most {MAX_BODY_TEXT_LENGTH} characters" in closing
    assert "the one shared CTA chosen above" in closing
    assert closing.rstrip().endswith("Submit them using the provided tool.")


def test_the_system_prompt_holds_nothing_specific_to_one_request() -> None:
    system = creative._build_system_prompt()

    for per_request in ("Acme Jewelry", "SALES", "Business:", "Positioning:", "Price:"):
        assert per_request not in system


def test_the_user_prompt_no_longer_repeats_the_static_rules() -> None:
    user = creative._build_prompt(_fake_business(), _fake_product(), _FAKE_STRATEGY)

    assert "Ad quality rules" not in user
    assert "Ad structure (apply to every variant)" not in user
    assert "Meta ad quality rules" not in user


def test_the_industry_materials_rule_rides_in_the_user_prompt() -> None:
    """The one industry-specific sentence stays out of the cached block, so
    the cache is shared by every industry."""
    note = ad_quality.materials_note("FASHION_JEWELRY")
    user = creative._build_prompt(
        _fake_business(industry="FASHION_JEWELRY"), _fake_product(), _FAKE_STRATEGY
    )

    assert note
    assert note in user
    assert note not in creative._build_system_prompt()
    assert ad_quality.materials_note(None) == ""


@pytest.mark.asyncio
async def test_generate_creatives_sends_the_static_block_as_a_cached_system_prompt(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _client_returning(monkeypatch, _batch_of(4))

    await creative.generate_creatives(
        business=_fake_business(), product=_fake_product(), strategy=_FAKE_STRATEGY
    )

    kwargs = create.call_args.kwargs
    system = kwargs["system"]
    assert system == [
        {
            "type": "text",
            "text": creative._build_system_prompt(),
            "cache_control": {"type": "ephemeral"},
        }
    ]
    assert "Acme Jewelry" in kwargs["messages"][0]["content"]


@pytest.mark.asyncio
async def test_the_system_block_and_tools_are_identical_for_batch_and_single(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Same prefix means a regenerate right after a batch reads the cache."""
    create = _client_returning(monkeypatch, _batch_of(4), _batch_of(1))

    await creative.generate_creatives(
        business=_fake_business(), product=_fake_product(), strategy=_FAKE_STRATEGY
    )
    await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        single_variant=creative.SingleVariantTarget("Luxury"),
    )

    first, second = (c.kwargs for c in create.call_args_list)
    assert first["system"] == second["system"]
    assert first["tools"] == second["tools"]


# ---------- single-variant mode ----------


@pytest.mark.asyncio
async def test_a_single_variant_call_returns_exactly_one_variant(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _client_returning(monkeypatch, _batch_of(1))

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        single_variant=creative.SingleVariantTarget("Craftsmanship"),
    )

    assert len(result) == 1
    assert result[0].creative_angle == "Craftsmanship"
    user = create.call_args.kwargs["messages"][0]["content"]
    assert "Generate exactly 1 variant" in user
    assert "Craftsmanship" in user


@pytest.mark.asyncio
async def test_a_single_variant_call_keeps_the_guards_and_retries(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A wrong count (4 back for 1 asked) fails validation and takes the
    same one retry, which asks for one variant, not four."""
    create = _client_returning(monkeypatch, _batch_of(4), _batch_of(1))

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        single_variant=creative.SingleVariantTarget("Craftsmanship"),
    )

    assert create.call_count == 2
    assert len(result) == 1
    retry_text = create.call_args.kwargs["messages"][0]["content"]
    assert "corrected batch of 1 variant" in retry_text


@pytest.mark.asyncio
async def test_a_single_variant_call_coerces_a_disallowed_cta_like_a_batch(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = {"variants": [{**_NO_VISUAL_PROMPTS, "cta": "LEARN_MORE"}]}
    _client_returning(monkeypatch, bad, bad)

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        single_variant=creative.SingleVariantTarget("Craftsmanship"),
    )

    assert [v.cta for v in result] == ["SHOP_NOW"]


@pytest.mark.asyncio
async def test_a_single_variant_on_a_test_plan_carries_that_angles_context(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regenerating one test ad keeps its avatar/concept/pillar framing and
    the persona, and does not list the other angles."""
    plan = _creative_plan()
    create = _client_returning(monkeypatch, _batch_of(1))

    await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=plan,
        single_variant=creative.SingleVariantTarget("Social proof", plan_angle_index=1),
    )

    user = create.call_args.kwargs["messages"][0]["content"]
    assert "Social proof" in user
    assert "Milestone gift buyers" in user
    assert "Product on skin" not in user
    assert "Gifting" not in user


def test_find_plan_angle_index_maps_a_label_back_to_its_position() -> None:
    plan = _structured_plan()

    assert creative.find_plan_angle_index(plan, "Gift buyer – The perfect gift") == 2
    assert creative.find_plan_angle_index(plan, " gift buyer – social proof ") == 3
    assert creative.find_plan_angle_index(plan, "no such angle") is None


def test_find_plan_angle_index_is_none_without_avatars_or_for_other_plans() -> None:
    assert creative.find_plan_angle_index(_creative_plan(), "social-proof") is None
    assert creative.find_plan_angle_index(_FAKE_STRATEGY, "Luxury") is None


@pytest.mark.asyncio
async def test_a_single_variant_on_a_test_plan_gets_its_plan_angle_label(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Whatever angle text the model wrote, the variant is stamped with the
    plan angle's label, which api/creative.py maps back to avatar/concept."""
    _client_returning(monkeypatch, _batch_of(1))

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_structured_plan(),
        single_variant=creative.SingleVariantTarget(
            "Gift buyer – The perfect gift", plan_angle_index=2
        ),
    )

    assert result[0].creative_angle == "Gift buyer – The perfect gift"


@pytest.mark.asyncio
async def test_a_single_variant_without_a_plan_angle_keeps_the_creatives_own_angle(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An older, avatar-less creative test still gets the single-variant
    framing, with the whole test listed only for context."""
    create = _client_returning(monkeypatch, _batch_of(1))

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_creative_plan(),
        single_variant=creative.SingleVariantTarget("My own angle"),
    )

    user = create.call_args.kwargs["messages"][0]["content"]
    assert result[0].creative_angle == "My own angle"
    assert "Creative angles in this test, for context:" in user
    assert "return the variants in the order listed" not in user
    assert "built on this creative angle: My own angle" in user


@pytest.mark.asyncio
async def test_fake_mode_returns_one_variant_for_a_single_variant_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.core.config import get_settings

    monkeypatch.setenv("FAKE_LLM", "true")
    get_settings.cache_clear()
    try:
        result = await creative.generate_creatives(
            business=_fake_business(),
            product=_fake_product(),
            strategy=_FAKE_STRATEGY,
            single_variant=creative.SingleVariantTarget("Luxury"),
        )
        carousel = await creative.generate_creatives(
            business=_fake_business(),
            product=_fake_product(),
            strategy=_FAKE_STRATEGY,
            format="CAROUSEL",
            card_images=cast(Any, [SimpleNamespace(), SimpleNamespace()]),
            single_variant=creative.SingleVariantTarget("Luxury"),
        )
    finally:
        monkeypatch.delenv("FAKE_LLM")
        get_settings.cache_clear()

    assert len(result) == 1
    assert len(carousel) == 1
    assert carousel[0].cards is not None


# ---------- every call is logged ----------


@pytest.mark.asyncio
async def test_a_batch_is_logged_as_creative_batch_and_its_retry_as_attempt_two(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _client_returning(monkeypatch, _batch_of(3), _batch_of(4))

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        await creative.generate_creatives(
            business=_fake_business(),
            product=_fake_product(),
            strategy=_FAKE_STRATEGY,
            campaign_id="camp_9",
        )

    lines = [r.getMessage() for r in caplog.records if "llm_usage" in r.getMessage()]
    assert len(lines) == 2
    assert all("agent=creative call_type=creative_batch" in x for x in lines)
    assert all("campaign_id=camp_9" in x for x in lines)
    assert "attempt=1" in lines[0] and "attempt=2" in lines[1]


@pytest.mark.asyncio
async def test_a_single_variant_is_logged_as_slot_regenerate(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    _client_returning(monkeypatch, _batch_of(1))

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        await creative.generate_creatives(
            business=_fake_business(),
            product=_fake_product(),
            strategy=_FAKE_STRATEGY,
            single_variant=creative.SingleVariantTarget("Craftsmanship"),
        )

    assert "call_type=slot_regenerate" in caplog.text


# ---------- brand profile still reaches the per-request half ----------


def test_the_brand_profile_and_offer_stay_in_the_user_prompt() -> None:
    user = creative._build_prompt(
        _fake_business(),
        _fake_product(),
        _FAKE_STRATEGY,
        brand_profile=_fake_brand_profile(offer="20% off with WELCOME20"),
    )

    assert "Brand voice" in user
    assert "20% off with WELCOME20" in user
