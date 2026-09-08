"""Shared parsing for Claude's forced tool-use output.

`tool_choice={"type": "tool", "name": ...}` only forces *which* tool gets
called — it doesn't guarantee the model's input strictly matches the
tool's JSON schema every time. Observed in production against a real
`claude-sonnet-5` call (2026-08-29): the Marketing Strategist Agent's
"submit_strategy" tool call came back as `{"strategy": {...the real flat
fields...}}` instead of the flat fields the schema actually asked for —
the model appears to reflexively wrap its answer under a key echoing the
tool's own name/purpose. parse_tool_input tolerates exactly that one
shape (a single stray top-level key) before giving up and raising the
real validation error, so one wrapper key doesn't break generation
outright.

A second, independent quirk observed in production (2026-09-08): the
Creative Agent's "submit_creatives" tool call came back with the right
top-level shape (`{"variants": ...}`) but the value itself was a
JSON-encoded *string* — `'[{"headline": ...}]'` — instead of a real
array, so `GeneratedCreativeBatch` failed with a `list_type` error even
though nothing was structurally wrong with the answer. A retry of the
identical request succeeded, confirming this is model output
variability, not a bug in the request itself. parse_tool_input also
tries json.loads() on any string field that looks JSON-shaped before
giving up, for the same "don't let one recoverable quirk break
generation outright" reasoning as the stray-key case.
"""

import json

from pydantic import BaseModel, ValidationError


def _unwrap_stray_key(
    raw: dict[str, object], model: type[BaseModel]
) -> dict[str, object] | None:
    """Try to recover the real input from underneath one stray wrapper key.

    Two shapes are tolerated, both seen or anticipated from real models
    echoing a tool's name in its own output:

    - `{"strategy": {"offer": ..., "positioning": ...}}` — the model has
      several flat fields, and the single value is itself a dict: that
      inner dict is almost certainly the real, correctly-shaped input.
    - `{"creatives": [...]}` when the schema's one real field is actually
      named "variants" — the model has exactly one field, and the wrapper
      just used the wrong key name for it.

    Args:
        raw: The tool call's raw input, already known not to validate
            as-is.
        model: The Pydantic model it was supposed to match.

    Returns:
        A dict worth retrying validation with, or None if `raw` doesn't
        look like either recoverable shape.
    """
    if len(raw) != 1:
        return None
    ((_, value),) = raw.items()
    if isinstance(value, dict):
        return value
    fields = model.model_fields
    if len(fields) == 1:
        (only_field_name,) = fields.keys()
        return {only_field_name: value}
    return None


def _decode_json_string_fields(raw: dict[str, object]) -> dict[str, object] | None:
    """Try recovering fields the model JSON-encoded as strings.

    Observed 2026-09-08: a "variants" field came back as the string
    '[{"headline": ...}]' rather than an actual array.

    Only touches string values that look JSON-shaped (start with `[` or
    `{`) — a plain string field like a headline is left alone, since
    attempting to JSON-decode arbitrary ad copy would be both pointless
    and a source of new, confusing failures.

    Args:
        raw: The tool call's raw input, already known not to validate
            as-is.

    Returns:
        A dict worth retrying validation with, or None if no field
        actually looked like a JSON-encoded string (nothing changed, so
        re-validating it would just fail the same way again).
    """
    changed = False
    decoded: dict[str, object] = {}
    for key, value in raw.items():
        if isinstance(value, str) and value.strip()[:1] in "[{":
            try:
                decoded[key] = json.loads(value)
                changed = True
                continue
            except ValueError:
                pass
        decoded[key] = value
    return decoded if changed else None


def parse_tool_input[ModelT: BaseModel](
    raw: dict[str, object], model: type[ModelT]
) -> ModelT:
    """Validate a tool call's raw input, tolerating two known model quirks.

    Args:
        raw: The tool_use.input dict as returned by the Anthropic API.
        model: The Pydantic model the input should validate against.

    Returns:
        The validated model instance.

    Raises:
        ValidationError: If `raw` doesn't match `model`, even after
            attempting to unwrap a single stray top-level key and to
            JSON-decode any string field that looked JSON-shaped — the
            original error, not one from a failed recovery attempt.
    """
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        decoded = _decode_json_string_fields(raw)
        if decoded is not None:
            try:
                return model.model_validate(decoded)
            except ValidationError:
                pass
        unwrapped = _unwrap_stray_key(raw, model)
        if unwrapped is not None:
            try:
                return model.model_validate(unwrapped)
            except ValidationError:
                pass
        raise exc
