"""Lenient parsing of the two submit tools (Phase 7b).

A submit can arrive cut off by ``max_tokens`` or with one bad item among good
ones. Throwing the whole answer away would waste a paid run, so each item is
validated on its own: good items are kept, bad ones dropped with a warning, and a
missing list becomes an empty one. The runner then applies the count checks.
"""

from typing import Any

from pydantic import BaseModel, TypeAdapter, ValidationError

from app.schemas.research import (
    ResearchAvatar,
    ResearchGap,
    ResearchProblem,
    ResearchSolution,
    ResearchSource,
    SubmitAvatars,
    SubmitFindings,
)


def _items[ItemT: BaseModel](
    raw: object, model: type[ItemT], label: str, warnings: list[str]
) -> list[ItemT]:
    if not isinstance(raw, list):
        return []
    adapter = TypeAdapter(model)
    kept: list[ItemT] = []
    for position, item in enumerate(raw, start=1):
        try:
            kept.append(adapter.validate_python(item))
        except ValidationError:
            warnings.append(f"Dropped {label} {position}: it was incomplete or invalid")
    return kept


def _strings(raw: object) -> list[str]:
    return [x for x in raw if isinstance(x, str)] if isinstance(raw, list) else []


def salvage_findings(raw: dict[str, Any]) -> tuple[SubmitFindings, list[str]]:
    """Keep every valid problem, solution and gap of a ``submit_findings`` input.

    Args:
        raw: The tool call's input, possibly cut off or partly invalid.

    Returns:
        The findings and one warning per dropped item.
    """
    warnings: list[str] = []
    return (
        SubmitFindings(
            problems=_items(raw.get("problems"), ResearchProblem, "problem", warnings),
            solutions=_items(
                raw.get("solutions"), ResearchSolution, "solution", warnings
            ),
            gaps=_items(raw.get("gaps"), ResearchGap, "gap", warnings),
            competitor_terms=_strings(raw.get("competitor_terms")),
        ),
        warnings,
    )


def salvage_avatars(raw: dict[str, Any]) -> tuple[SubmitAvatars, list[str]]:
    """Keep every valid avatar of a ``submit_avatars`` input.

    Args:
        raw: The tool call's input, possibly cut off or partly invalid.

    Returns:
        The avatars with the coverage note and sources that arrived, and one
        warning per dropped item.
    """
    warnings: list[str] = []
    note = raw.get("coverage_note")
    return (
        SubmitAvatars(
            avatars=_items(raw.get("avatars"), ResearchAvatar, "avatar", warnings),
            coverage_note=note if isinstance(note, str) else "",
            sources=_items(raw.get("sources"), ResearchSource, "source", warnings),
        ),
        warnings,
    )
