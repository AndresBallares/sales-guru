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

The two quirks also compound (also observed 2026-09-08, same day): a
tool call came back as `{"variants": '{"variants": [...]}'}` — the
*whole* correctly-shaped object, wrapper key and all, stringified and
then stuffed under that same key again. JSON-decoding the string alone
recovers `{"variants": {"variants": [...]}}`, which still doesn't
validate (`variants` is now a dict, not a list) — it takes unwrapping
*that* result's own stray key to reach the real `{"variants": [...]}`.
parse_tool_input tries every combination of the two recoveries (decode,
unwrap, and unwrap-of-decode) rather than just one pass of each, so a
compounded quirk like this one still resolves.

A third quirk, independent of the two above (observed 2026-09-10): the
Marketing Strategist Agent's `hypothesisAudienceTargeting.interests`
came back with an invented value outside the curated, Meta-backed
InterestKey enum (app/services/interests.py) — the rest of the audience
was otherwise well-formed. Failing the whole audience over one bad
interest would waste the call, so parse_tool_input drops just the
invalid item(s) (logging the rejected value, since it's worth knowing
what the model keeps inventing) and keeps the rest. If every proposed
interest is invalid, dropping them all would leave an empty list — that
resolvable-but-unhelpful shape raises ToolInputRecoveryError instead of
silently returning it, so the caller can surface a clear, retryable
error rather than quietly generating an audience with no interests.
"""

import copy
import json
import logging

from pydantic import BaseModel, ValidationError

logger = logging.getLogger(__name__)


class ToolInputRecoveryError(ValueError):
    """A recoverable quirk was identified but recovering would help no one.

    Specifically: every item in an otherwise-valid list came back
    invalid (see _drop_invalid_enum_list_items), so the only "recovery"
    available is returning an empty list — silently doing that would
    trade one failure for a worse, quieter one (a real request going out
    with no targeting at all). Raised instead of a plain ValidationError
    so callers can tell "the model's answer was unusable in a specific,
    nameable way" apart from "the shape was wrong in some generic way",
    and respond with their own clear, retryable error.
    """


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
                # Logged (not raised — this is one candidate recovery
                # among several, not itself the final failure) so a real
                # occurrence shows the actual offending text next time,
                # confirmed 2026-09-12 — the field's own ValidationError
                # only ever said "expected a dict/list, got a string,"
                # with no way to tell a genuinely truncated response
                # (max_tokens cut off mid-JSON) apart from one that was
                # just malformed from the start. Capped at 200 chars so a
                # very long field doesn't flood the log.
                logger.warning(
                    "Field %r looked JSON-encoded but failed to decode "
                    "(first 200 chars): %r",
                    key,
                    value[:200],
                )
        decoded[key] = value
    return decoded if changed else None


def _drop_invalid_enum_list_items(
    raw: dict[str, object], exc: ValidationError
) -> dict[str, object] | None:
    """Recover from individual list items that fail Literal/enum validation.

    Observed in production (2026-09-10): the Strategist Agent invented an
    interest key outside the curated InterestKey enum — everything else
    about the audience was fine. Dropping just the invalid item(s) (and
    logging the rejected value, so real invented values stay visible)
    keeps the rest of a well-formed answer usable.

    Args:
        raw: The tool call's raw input, already known not to validate
            as-is.
        exc: The validation error raised by attempting to validate `raw`.

    Returns:
        A dict worth retrying validation with, or None if no error in
        `exc` looks like a droppable list item.

    Raises:
        ToolInputRecoveryError: If every item in one of the offending
            lists was invalid, so dropping them all would leave it empty
            — see the class docstring for why that's raised rather than
            returned as a candidate.
    """
    bad_indices: dict[tuple[int | str, ...], set[int]] = {}
    for error in exc.errors():
        if error["type"] != "literal_error":
            continue
        loc = error["loc"]
        if len(loc) < 2 or not isinstance(loc[-1], int):
            continue
        bad_indices.setdefault(loc[:-1], set()).add(loc[-1])
    if not bad_indices:
        return None

    result = copy.deepcopy(raw)
    for path, indices in bad_indices.items():
        target: object = result
        for segment in path:
            if (  # noqa: SIM114 -- separate branches needed for type narrowing below
                isinstance(target, dict)
                and isinstance(segment, str)
                and segment in target
            ):
                target = target[segment]
            elif (
                isinstance(target, list)
                and isinstance(segment, int)
                and segment < len(target)
            ):
                target = target[segment]
            else:
                target = None
                break
        if not isinstance(target, list):
            continue
        rejected = [target[i] for i in sorted(indices) if i < len(target)]
        logger.warning("Dropping invalid enum value(s) at %s: %r", path, rejected)
        if len(indices) >= len(target):
            raise ToolInputRecoveryError(
                f"All values at {path!r} were invalid: {rejected!r}"
            )
        for index in sorted(indices, reverse=True):
            del target[index]
    return result


def _recovery_candidates(
    raw: dict[str, object], model: type[BaseModel]
) -> list[dict[str, object]]:
    """Build every recoverable reshaping of `raw` worth retrying, in order.

    Composes both known recoveries — JSON-decoding a stringified field
    and unwrapping a stray top-level key — including applying the second
    to the result of the first, so a compounded quirk (the whole
    `{field: [...]}` shape stringified and wrapped under its own field
    name again) still resolves, not just each quirk in isolation.

    Args:
        raw: The tool call's raw input, already known not to validate
            as-is.
        model: The Pydantic model it was supposed to match.

    Returns:
        Candidate dicts to try validating, most-likely-first, without
        duplicates. Empty if neither recovery applies.
    """
    candidates: list[dict[str, object]] = []
    seen: list[dict[str, object]] = []

    def _add(candidate: dict[str, object] | None) -> None:
        if candidate is not None and candidate not in seen:
            candidates.append(candidate)
            seen.append(candidate)

    decoded = _decode_json_string_fields(raw)
    _add(decoded)
    _add(_unwrap_stray_key(raw, model))
    if decoded is not None:
        _add(_unwrap_stray_key(decoded, model))
    return candidates


def parse_tool_input[ModelT: BaseModel](
    raw: dict[str, object],
    model: type[ModelT],
    *,
    context: dict[str, object] | None = None,
) -> ModelT:
    """Validate a tool call's raw input, tolerating known model quirks.

    Args:
        raw: The tool_use.input dict as returned by the Anthropic API.
        model: The Pydantic model the input should validate against.
        context: Optional Pydantic validation context, threaded through
            every model_validate call below (including recovery retries)
            via `model.model_validate(data, context=context)`. Lets a
            model's own validators enforce rules that depend on data the
            LLM never sees (e.g. GeneratedCreativeBatch's objective-aware
            CTA check, app/schemas/creative.py) without adding that data
            as a field the tool schema would expose back to the model.
            None (the default) skips any context-dependent checks a
            model's validators define.

    Returns:
        The validated model instance.

    Raises:
        ToolInputRecoveryError: See _drop_invalid_enum_list_items — a
            list field's invalid items could all be identified, but
            dropping them all would leave it empty.
        ValidationError: If `raw` doesn't match `model`, even after every
            recovery attempt (see _recovery_candidates) — the original
            error, not one from a failed recovery attempt.
    """
    try:
        return model.model_validate(raw, context=context)
    except ValidationError as exc:
        # Known model quirks, tried in this order: (1) drop individual
        # invalid enum/Literal values out of an otherwise-valid list
        # (interests, observed 2026-09-10) — raises ToolInputRecoveryError
        # rather than yielding a candidate if that would empty a list
        # that had items; (2)/(3) below, tried together via
        # _recovery_candidates: a stray top-level wrapper key
        # (2026-08-29), and a field JSON-encoded as a string instead of
        # the real object/array it should be (2026-09-08) — including
        # the compounded case where both apply at once. Don't remove any
        # of these without checking the module docstring for the
        # production case each one exists to handle.
        dropped = _drop_invalid_enum_list_items(raw, exc)
        if dropped is not None:
            try:
                return model.model_validate(dropped, context=context)
            except ValidationError:
                pass
        for candidate in _recovery_candidates(raw, model):
            try:
                return model.model_validate(candidate, context=context)
            except ValidationError:
                continue
        raise exc
