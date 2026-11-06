"""The Creative Agent's hook rules: shapes in the cached system prompt.

The assignment is in the tail.

The five shape rules, the no-invented-claims rules, no shaming, no competitor attacks,
the banned-phrase traps and the personal-attributes rule are static, so they sit in the
cached system prompt. Which shape a variant gets differs per request, so it rides in the
per-call tail. The model never chooses the shape and never returns one: the output
schema is unchanged.
"""

from typing import Any

import pytest
from app.schemas.creative import MAX_BODY_TEXT_LENGTH
from app.services import ad_quality, avatar_copy_prompt, creative, hook_shapes

from tests.test_creative_avatar_prompt import ASSIGNED, LIBRARY, PLAN
from tests.test_creative_service import _fake_business, _fake_product

SYSTEM = creative._build_system_prompt()  # noqa: SLF001
SLUGS = ["statement", "question", "contrast", "moment", "address"]


def _parts(**kwargs: Any) -> tuple[str, str]:  # noqa: ANN401
    return creative._build_prompt_parts(  # noqa: SLF001
        _fake_business(),
        _fake_product(),
        PLAN,
        buyer_avatars=LIBRARY,
        assigned_avatars=ASSIGNED,
        **kwargs,
    )


def _hook_block() -> str:
    start = SYSTEM.index("Hook shapes")
    return SYSTEM[start:]


# ---- the static rules (cached system prompt) -------------------------------


def test_the_system_prompt_defines_all_five_shapes() -> None:
    block = _hook_block()
    for slug in SLUGS:
        assert f"{slug}:" in block


def test_the_hook_is_the_primary_text_opening_and_the_headline_only_supports_it() -> (
    None
):
    block = _hook_block().lower()
    assert "first sentence of body_text" in block
    assert "headline supports" in block
    assert "not a second hook" in block


def test_every_shape_fits_the_length_limits_given_at_the_end_of_the_request() -> None:
    block = _hook_block().lower()
    assert "length limit" in block
    assert "complete sentence" in block


def test_only_supplied_facts_and_no_invented_proof() -> None:
    block = _hook_block().lower()
    assert "only facts and proof points the request gives" in block
    for invented in (
        "testimonials",
        "statistics",
        "scarcity",
        "certifications",
        "product tests",
        "guarantees",
    ):
        assert invented in block


def test_no_shaming_and_no_blaming_a_past_purchase() -> None:
    block = _hook_block().lower()
    assert "no shaming" in block
    assert "past purchase" in block


def test_no_competitor_attacks_and_contrast_is_generic_only() -> None:
    block = _hook_block().lower()
    assert "no attacks on competitors" in block
    contrast = next(
        line for line in block.splitlines() if line.startswith("- contrast")
    )
    assert "generic" in contrast
    assert "never a named brand or competitor" in contrast


def test_the_banned_phrase_traps_are_named() -> None:
    block = _hook_block().lower()
    for phrase in ("you won't believe", "wait until you see", "find out why"):
        assert phrase in ad_quality.BANNED_PHRASES
        assert f'"{phrase}"' in block


def test_a_question_must_be_answered_in_the_same_text() -> None:
    question = next(
        line
        for line in _hook_block().lower().splitlines()
        if line.startswith("- question")
    )
    assert "answered in the same text" in question


def test_personal_attributes_are_never_asserted_or_implied() -> None:
    block = _hook_block()
    lowered = block.lower()
    assert "never assert or imply a personal attribute" in lowered
    for attribute in ("relationship status", "age", "health", "finances"):
        assert attribute in lowered
    # The two examples the owner gave: one fine, one not.
    assert '"Your right hand has been waiting." is fine' in block
    assert '"Newly single?" is not' in block


def test_the_personal_attribute_rule_names_address_and_moment_first() -> None:
    rule = next(
        line
        for line in _hook_block().splitlines()
        if "personal attribute" in line.lower()
    )
    assert "address" in rule.lower()
    assert "moment" in rule.lower()


def test_the_avatar_profile_is_never_to_be_said_about_the_viewer() -> None:
    guidance = avatar_copy_prompt.GUIDANCE.lower()
    assert "never state or imply" in guidance
    assert "personal" in guidance


def test_the_hook_block_stays_small_enough_to_cache_cheaply() -> None:
    assert len(_hook_block().split()) <= 420


def test_the_system_prompt_stays_identical_for_every_request() -> None:
    assert creative._build_system_prompt() == SYSTEM  # noqa: SLF001
    assert "Variant" not in _hook_block()


def test_the_system_prompt_carries_no_assignment() -> None:
    for slug in SLUGS:
        assert f"variant a: {slug}" not in SYSTEM.lower()


# ---- the assignment (per-call tail) ----------------------------------------


def test_the_tail_names_each_variants_shape_in_order() -> None:
    _, tail = _parts(hook_shapes=["question", "moment", "contrast", "address"])

    assert "Variant A: question" in tail
    assert "Variant B: moment" in tail
    assert "Variant C: contrast" in tail
    assert "Variant D: address" in tail
    assert tail.index("Variant A: question") < tail.index("Variant D: address")


def test_the_assignment_is_in_the_tail_and_never_the_cached_context() -> None:
    context, tail = _parts(hook_shapes=["statement", "question", "contrast", "moment"])

    assert "Hook shape" in tail
    assert "Hook shape" not in context
    assert "Variant A: statement" not in context


def test_the_context_is_identical_with_and_without_a_shape() -> None:
    plain, _ = _parts()
    shaped, _ = _parts(hook_shapes=["statement", "question", "contrast", "moment"])
    assert plain == shaped


def test_without_shapes_the_tail_has_no_shape_line() -> None:
    _, tail = _parts()
    assert "Hook shape" not in tail


def test_a_one_variant_regenerate_names_only_its_own_shape() -> None:
    _, tail = _parts(
        single_variant=creative.SingleVariantTarget(
            "Self-purchaser – Craftsmanship", 1, "a2", "education"
        ),
        hook_shapes=["contrast"],
    )

    assert "Hook shape for this variant: contrast" in tail
    for other in ("statement", "question", "moment", "address"):
        assert f"this variant: {other}" not in tail


def test_the_tail_repeats_the_primary_text_limit_beside_the_shape() -> None:
    """A smoke test (2026-11-06): an address hook ran to 193 characters twice."""
    _, tail = _parts(hook_shapes=["statement", "question", "contrast", "moment"])

    line = next(ln for ln in tail.splitlines() if ln.startswith("Hook shape"))
    assert f"{MAX_BODY_TEXT_LENGTH} characters" in line
    assert "whole primary text" in line


def test_a_one_variant_regenerate_repeats_the_limit_too() -> None:
    _, tail = _parts(
        single_variant=creative.SingleVariantTarget(
            "Self-purchaser – Craftsmanship", 1, "a2", "education"
        ),
        hook_shapes=["address"],
    )
    line = next(ln for ln in tail.splitlines() if ln.startswith("Hook shape"))
    assert f"{MAX_BODY_TEXT_LENGTH} characters" in line


def test_craft_and_process_claims_are_not_invented_either() -> None:
    """The same smoke test: "hand-set" came out of nowhere; data said handcrafted."""
    assert "craft and process claims" in _hook_block().lower()


def test_the_closing_limits_paragraph_stays_last() -> None:
    _, tail = _parts(hook_shapes=["statement", "question", "contrast", "moment"])
    assert tail.rstrip().endswith("Submit them using the provided tool.")
    assert tail.index("Hook shape") < tail.index("Generate exactly")


def test_a_wrong_number_of_shapes_is_refused() -> None:
    with pytest.raises(ValueError, match="one shape per variant"):
        _parts(hook_shapes=["statement", "question"])


def test_an_unknown_shape_is_refused() -> None:
    with pytest.raises(ValueError, match="unknown hook shape"):
        _parts(hook_shapes=["curiosity", "question", "contrast", "moment"])


# ---- saved hooks as source material ----------------------------------------


def test_saved_hooks_are_source_material_for_address_and_moment() -> None:
    _, tail = _parts()

    assert "source material for the address and moment shapes" in tail
    assert "never copy" in tail.lower()


def test_the_avatar_guidance_keeps_the_existing_rules() -> None:
    guidance = avatar_copy_prompt.GUIDANCE
    assert "the avatar block wins" in guidance
    assert "business details above do not support" in guidance


def test_every_shape_is_known_to_the_prompt_builder() -> None:
    for slug in hook_shapes.HOOK_TYPES:
        _parts(hook_shapes=[slug, "statement", "question", "contrast"][:4])
