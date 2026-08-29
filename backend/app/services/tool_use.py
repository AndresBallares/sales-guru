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
"""

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


def parse_tool_input[ModelT: BaseModel](
    raw: dict[str, object], model: type[ModelT]
) -> ModelT:
    """Validate a tool call's raw input, tolerating one stray wrapper key.

    Args:
        raw: The tool_use.input dict as returned by the Anthropic API.
        model: The Pydantic model the input should validate against.

    Returns:
        The validated model instance.

    Raises:
        ValidationError: If `raw` doesn't match `model`, even after
            attempting to unwrap a single stray top-level key — the
            original error, not one from the failed unwrap attempt.
    """
    try:
        return model.model_validate(raw)
    except ValidationError as exc:
        unwrapped = _unwrap_stray_key(raw, model)
        if unwrapped is not None:
            try:
                return model.model_validate(unwrapped)
            except ValidationError:
                pass
        raise exc
