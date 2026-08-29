"""Unit tests for app/services/tool_use.py's parse_tool_input.

Pure function, no Anthropic client involved — see test_strategist_service.py
/ test_creative_service.py for the service-level tests that exercise this
through a real (mocked) generate_strategy/generate_creatives call.
"""

import pytest
from app.services.tool_use import parse_tool_input
from pydantic import BaseModel


class _Flat(BaseModel):
    """A model with several flat top-level fields, like GeneratedStrategyFields."""

    offer: str
    positioning: str


class _SingleField(BaseModel):
    """A model with exactly one field, like GeneratedCreativeBatch."""

    variants: list[str]


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
