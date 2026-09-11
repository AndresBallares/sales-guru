"""Unit tests for app/services/tool_use.py's parse_tool_input.

Pure function, no Anthropic client involved — see test_strategist_service.py
/ test_creative_service.py for the service-level tests that exercise this
through a real (mocked) generate_strategy/generate_creatives call.
"""

import json
import logging
from typing import Literal

import pytest
from app.schemas.strategy import GeneratedTestPlanFields
from app.services.tool_use import ToolInputRecoveryError, parse_tool_input
from pydantic import BaseModel


class _Flat(BaseModel):
    """A model with several flat top-level fields, like
    GeneratedDataDrivenStrategyFields."""

    offer: str
    positioning: str


class _SingleField(BaseModel):
    """A model with exactly one field, like GeneratedCreativeBatch."""

    variants: list[str]


class _WithEnumList(BaseModel):
    """A model with a list[Literal[...]] field, like TargetAudience.interests."""

    tags: list[Literal["red", "blue", "green"]]


def test_parse_tool_input_passes_through_already_correct_input() -> None:
    """The common case — no wrapping, no recovery needed."""
    result = parse_tool_input(
        {"offer": "Custom rings", "positioning": "Premium"}, _Flat
    )

    assert result.offer == "Custom rings"
    assert result.positioning == "Premium"


def test_parse_tool_input_unwraps_a_stray_dict_wrapper() -> None:
    """{"strategy": {flat fields}} recovers to the flat fields it wraps.

    This is the exact shape observed from a real claude-sonnet-5 call
    (2026-08-29): a "submit_strategy" tool call wrapping its real, correctly-
    shaped output under a "strategy" key instead of matching the flat
    schema directly.
    """
    result = parse_tool_input(
        {"strategy": {"offer": "Custom rings", "positioning": "Premium"}}, _Flat
    )

    assert result.offer == "Custom rings"
    assert result.positioning == "Premium"


def test_parse_tool_input_remaps_a_stray_key_for_a_single_field_model() -> None:
    """{"creatives": [...]} recovers when the schema's one field is "variants".

    Same wrapping instinct as the strategy case, but here the wrapper
    key's value isn't a dict — it's the list the single "variants" field
    actually wants, just filed under the wrong name.
    """
    result = parse_tool_input({"creatives": ["a", "b"]}, _SingleField)

    assert result.variants == ["a", "b"]


def test_parse_tool_input_raises_the_original_error_when_unrecoverable() -> None:
    """Genuinely malformed input (not a single stray wrapper) still raises —
    and raises the original validation error, not one from a failed
    unwrap attempt."""
    with pytest.raises(Exception, match="positioning"):
        parse_tool_input({"offer": "Custom rings"}, _Flat)


def test_parse_tool_input_does_not_unwrap_when_multiple_top_level_keys() -> None:
    """More than one top-level key never looks like a single stray wrapper,
    even if one of the extra keys happens to be a dict."""
    with pytest.raises(Exception, match="positioning"):
        parse_tool_input(
            {"offer": "Custom rings", "extra": {"positioning": "Premium"}}, _Flat
        )


def test_parse_tool_input_does_not_unwrap_a_multi_field_models_wrong_key() -> None:
    """A single stray key whose value isn't a dict only recovers for a
    single-field model — a multi-field model has no single "real" field
    name to remap the value onto, so this stays a real failure."""
    with pytest.raises(Exception, match="offer"):
        parse_tool_input({"wrong_key": "just a string"}, _Flat)


def test_parse_tool_input_decodes_a_json_encoded_list_field() -> None:
    """A "variants" field returned as a JSON-encoded string rather than a
    real array recovers — the exact shape observed from a real
    claude-sonnet-5 call (2026-09-08)."""
    result = parse_tool_input({"variants": '["a", "b"]'}, _SingleField)

    assert result.variants == ["a", "b"]


def test_parse_tool_input_recovers_from_a_stringified_and_wrapped_field() -> None:
    """The two quirks compound: the whole `{"variants": [...]}` shape,
    wrapper key and all, comes back stringified and stuffed under that
    same field name again — also observed from a real claude-sonnet-5
    call (2026-09-08). Decoding the string alone isn't enough (it leaves
    `variants` holding a dict, not a list); it takes unwrapping that
    dict's own stray key too."""
    result = parse_tool_input({"variants": '{"variants": ["a", "b"]}'}, _SingleField)

    assert result.variants == ["a", "b"]


def test_parse_tool_input_decodes_a_json_encoded_dict_field() -> None:
    """The same recovery works for a dict-shaped field, not just a list —
    _Nested's "detail" field expects a real object, not a JSON string."""

    class _Nested(BaseModel):
        detail: _Flat

    result = parse_tool_input(
        {"detail": '{"offer": "Custom rings", "positioning": "Premium"}'},
        _Nested,
    )

    assert result.detail.offer == "Custom rings"
    assert result.detail.positioning == "Premium"


def test_parse_tool_input_does_not_touch_a_plain_string_field() -> None:
    """A genuinely plain string value (not JSON-shaped) is left alone —
    only values starting with `[` or `{` are ever attempted, and a
    missing required field still raises normally."""
    with pytest.raises(Exception, match="positioning"):
        parse_tool_input({"offer": "Custom rings"}, _Flat)


def test_parse_tool_input_raises_original_error_when_decoded_json_still_fails() -> None:
    """A string that *is* valid JSON but decodes to the wrong shape (a list
    of ints where `list[str]` is expected) still falls through to the
    original error, not a new one from the failed decode attempt."""
    with pytest.raises(Exception, match="list_type|string_type"):
        parse_tool_input({"variants": "[1, 2, 3]"}, _SingleField)


def test_parse_tool_input_raises_the_original_error_for_unparseable_json() -> None:
    """A string that merely starts with `[`/`{` but isn't valid JSON is
    left alone — json.loads failing is caught, not left to bubble up as a
    confusing secondary error — and the original validation error still
    surfaces."""
    with pytest.raises(Exception, match="list_type"):
        parse_tool_input({"variants": "[not valid json"}, _SingleField)


def test_parse_tool_input_drops_an_invalid_enum_value_from_a_list() -> None:
    """A list[Literal] field with one bad value among good ones recovers by
    dropping just the bad one and keeping the rest — the general shape of
    the Strategist's real `interests` bug (2026-09-10), reproduced here
    against a small local model; see
    test_parse_tool_input_recovers_the_strategists_invalid_interest below
    for the exact production shape."""
    result = parse_tool_input(
        {"tags": ["red", "not_a_real_tag", "blue"]}, _WithEnumList
    )

    assert result.tags == ["red", "blue"]


def test_parse_tool_input_logs_the_rejected_enum_value(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The rejected value is logged (not silently discarded) so real
    invented values stay visible — "so we can see what the model keeps
    inventing"."""
    with caplog.at_level(logging.WARNING, logger="app.services.tool_use"):
        parse_tool_input({"tags": ["red", "not_a_real_tag"]}, _WithEnumList)

    assert "not_a_real_tag" in caplog.text


def test_parse_tool_input_raises_recovery_error_when_every_list_item_is_invalid() -> (
    None
):
    """Dropping every bad value would leave the list empty — that's not a
    silent recovery. A distinct ToolInputRecoveryError lets the caller
    (e.g. the Strategist Agent) surface its own clear, retryable error
    instead of quietly generating targeting with nothing in it."""
    with pytest.raises(ToolInputRecoveryError, match="tags"):
        parse_tool_input({"tags": ["not_real", "also_fake"]}, _WithEnumList)


def test_parse_tool_input_leaves_a_fully_valid_enum_list_unaffected() -> None:
    """Clean output — every item already valid — isn't touched by the new
    recovery path at all."""
    result = parse_tool_input({"tags": ["red", "blue", "green"]}, _WithEnumList)

    assert result.tags == ["red", "blue", "green"]


def test_parse_tool_input_drops_an_invalid_enum_value_nested_in_a_list_of_models() -> (
    None
):
    """The bad value can be nested past a list of models, not just a
    top-level list — e.g. a list[Item] where Item itself has the
    list[Literal] field. Dropping still finds and removes just the one
    bad element."""

    class _Item(BaseModel):
        tags: list[Literal["red", "blue"]]

    class _WithListOfItems(BaseModel):
        items: list[_Item]

    result = parse_tool_input(
        {"items": [{"tags": ["red"]}, {"tags": ["not_real", "blue"]}]},
        _WithListOfItems,
    )

    assert [item.tags for item in result.items] == [["red"], ["blue"]]


def test_parse_tool_input_raises_the_original_error_when_dropping_does_not_fix_it() -> (
    None
):
    """Dropping the bad enum value succeeds on its own terms, but the
    result still doesn't validate for an unrelated reason (a missing
    required field) — falls through to the other recoveries and then
    the *original* error, not a confusing one about the dropped value."""

    class _WithEnumListAndRequiredField(BaseModel):
        tags: list[Literal["red", "blue", "green"]]
        label: str

    with pytest.raises(Exception, match="label"):
        parse_tool_input(
            {"tags": ["red", "not_a_real_tag"]}, _WithEnumListAndRequiredField
        )


def _real_test_plan_targeting(interests: list[str]) -> dict[str, object]:
    """A well-formed hypothesisAudienceTargeting dict, interests aside —
    shared by the two "real production shape" tests below."""
    return {
        "ageMin": 30,
        "ageMax": 55,
        "genders": ["female"],
        "location": [],
        "interests": interests,
        "problem": "Struggling to find a meaningful gift",
        "desire": "waiting to be gifted.",
    }


def _real_test_plan_raw(targeting: dict[str, object] | str) -> dict[str, object]:
    """A full, otherwise-clean GeneratedTestPlanFields tool-call payload."""
    return {
        "hypothesisAudienceName": "Gift Seekers",
        "hypothesisAudienceTargeting": targeting,
        "hypothesisStatement": "Interest-based targeting outperforms broad.",
        "offer": "15% off your first order",
        "positioning": "Meaningful gifts for meaningful moments",
        "creativeAngles": ["Emotional gifting moment", "Craftsmanship close-up"],
        "copyStrategy": "Lead with the emotional payoff, back it with craft.",
    }


def test_parse_tool_input_recovers_the_strategists_invalid_interest() -> None:
    """Reproduces the exact real-claude-sonnet-5 shape observed 2026-09-10:
    GeneratedTestPlanFields.hypothesisAudienceTargeting.interests came
    back with 'fine_jewelry_adjacent_removed' — a value outside the
    curated InterestKey enum (app/services/interests.py) — alongside an
    otherwise well-formed, real interest and the rest of the payload."""
    raw = _real_test_plan_raw(
        _real_test_plan_targeting(["jewelry", "fine_jewelry_adjacent_removed"])
    )

    result = parse_tool_input(raw, GeneratedTestPlanFields)

    assert result.hypothesis_audience_targeting.interests == ["jewelry"]


def test_parse_tool_input_recovers_the_strategists_stringified_nested_field() -> None:
    """Reproduces the exact real-claude-sonnet-5 shape observed 2026-09-10:
    GeneratedTestPlanFields.hypothesisAudienceTargeting came back as a
    JSON-encoded string (starting '{"ageMin": 30, ...' and ending
    '...waiting to be gifted."}' in the real captured error, truncated by
    Pydantic's own error display) instead of a real object. Already
    covered generically by
    test_parse_tool_input_decodes_a_json_encoded_dict_field above — this
    pins the exact production field/model so a change to either can't
    silently stop covering the real case."""
    targeting = _real_test_plan_targeting(["jewelry"])
    raw = _real_test_plan_raw(json.dumps(targeting))

    result = parse_tool_input(raw, GeneratedTestPlanFields)

    assert result.hypothesis_audience_targeting.age_min == 30
    assert result.hypothesis_audience_targeting.desire == "waiting to be gifted."
    assert result.hypothesis_audience_targeting.interests == ["jewelry"]


def test_parse_tool_input_leaves_a_clean_strategist_payload_unaffected() -> None:
    """A well-formed GeneratedTestPlanFields payload — valid interests,
    no stringified fields — parses straight through untouched by either
    new recovery path."""
    raw = _real_test_plan_raw(_real_test_plan_targeting(["jewelry", "diamonds"]))

    result = parse_tool_input(raw, GeneratedTestPlanFields)

    assert result.hypothesis_audience_targeting.interests == ["jewelry", "diamonds"]
    assert result.hypothesis_audience_name == "Gift Seekers"
