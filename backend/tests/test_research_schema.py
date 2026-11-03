"""Tests for the submit_research tool schema (Phase 7a: defined, not called yet)."""

from typing import Any

import pytest
from app.schemas.research import (
    ANGLES_PER_AVATAR,
    AVATAR_COUNT,
    CONCEPTS_PER_AVATAR,
    HOOKS_PER_AVATAR,
    PROBLEM_COUNT,
    SOLUTION_COUNT,
    SubmitResearch,
    count_warnings,
)
from app.services.tool_use import strict_input_schema, tool_input_schema
from pydantic import ValidationError


def _walk(node: Any) -> list[dict[str, Any]]:  # noqa: ANN401
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("type") == "object" or "properties" in node:
            found.append(node)
        for value in node.values():
            found.extend(_walk(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_walk(value))
    return found


def _source(n: int = 1) -> dict[str, Any]:
    return {"url": f"https://example.com/{n}", "title": "Page", "reached": True}


def _problem(n: int) -> dict[str, Any]:
    return {
        "number": n,
        "problem": f"Problem {n}",
        "evidence": [
            {
                "kind": "quote",
                "text": "it faded after two weeks",
                "source_url": "https://example.com/1",
            }
        ],
        "inferred": False,
    }


def _solution(n: int) -> dict[str, Any]:
    return {
        "number": n,
        "solution": f"Solution {n}",
        "problem_numbers": [n],
        "mechanism": "Solid gold",
        "inferred": False,
    }


def _avatar(n: int) -> dict[str, Any]:
    return {
        "name": f"Avatar {n}",
        "who": "Someone",
        "purchase_for": "self",
        "primary_problems": [1],
        "unknown_problems": ["x"],
        "primary_solutions": [1],
        "alternatives": ["y"],
        "objections": ["z"],
        "hooks": [f"hook {i}" for i in range(HOOKS_PER_AVATAR)],
        "creative_angles": [f"angle {i}" for i in range(ANGLES_PER_AVATAR)],
        "concepts": [
            {"name": "Rescue", "pillar": "offer", "description": "Last-minute gift"},
            {"name": "Solid", "pillar": "mechanism", "description": "Gold all through"},
        ],
        "inferred": False,
    }


def _valid(**overrides: Any) -> dict[str, Any]:  # noqa: ANN401
    data: dict[str, Any] = {
        "problems": [_problem(n) for n in range(1, PROBLEM_COUNT + 1)],
        "solutions": [_solution(n) for n in range(1, SOLUTION_COUNT + 1)],
        "gaps": [],
        "avatars": [_avatar(n) for n in range(AVATAR_COUNT)],
        "coverage_note": "Reached 3 of 4 sources.",
        "sources": [_source()],
    }
    data.update(overrides)
    return data


def test_the_fixed_counts_are_the_agreed_ones() -> None:
    assert (PROBLEM_COUNT, SOLUTION_COUNT, AVATAR_COUNT) == (20, 20, 5)
    assert (HOOKS_PER_AVATAR, ANGLES_PER_AVATAR, CONCEPTS_PER_AVATAR) == (5, 3, (2, 3))


def test_the_strict_schema_check_passes_with_zero_optional_properties() -> None:
    schema = tool_input_schema(SubmitResearch)
    strict = strict_input_schema(SubmitResearch)  # raises over a strict-mode limit
    for obj in _walk(schema):
        properties = obj.get("properties", {})
        assert set(obj.get("required", [])) == set(properties), obj
    for obj in _walk(strict):
        assert obj.get("additionalProperties") is False


def test_a_valid_submission_parses() -> None:
    parsed = SubmitResearch.model_validate(_valid())
    assert len(parsed.avatars) == 5
    assert count_warnings(parsed) == []


def test_quotes_over_fourteen_words_are_rejected() -> None:
    bad = _problem(1)
    bad["evidence"][0]["text"] = " ".join(["word"] * 15)
    with pytest.raises(ValidationError, match="14 words"):
        SubmitResearch.model_validate(_valid(problems=[bad]))


def test_a_quote_without_a_source_url_is_rejected() -> None:
    bad = _problem(1)
    bad["evidence"][0]["source_url"] = ""
    with pytest.raises(ValidationError):
        SubmitResearch.model_validate(_valid(problems=[bad]))


def test_an_inference_carries_its_inferred_flag_and_no_quote() -> None:
    item = _problem(1)
    item["evidence"] = [
        {"kind": "inference", "text": "Likely because plating wears", "source_url": ""}
    ]
    item["inferred"] = True
    assert SubmitResearch.model_validate(_valid(problems=[item])).problems[0].inferred


def test_wrong_counts_are_not_a_validation_error_but_a_warning() -> None:
    parsed = SubmitResearch.model_validate(
        _valid(problems=[_problem(1)], avatars=[_avatar(0)])
    )
    warnings = count_warnings(parsed)
    assert any("20 problems" in w for w in warnings)
    assert any("5 avatars" in w for w in warnings)
    assert not any("solutions" in w for w in warnings)  # 20 were sent


def test_per_avatar_counts_are_warnings_too() -> None:
    avatar = _avatar(0)
    avatar["hooks"] = ["only one"]
    avatar["concepts"] = avatar["concepts"][:1]
    parsed = SubmitResearch.model_validate(_valid(avatars=[avatar] * 5))
    warnings = count_warnings(parsed)
    assert any("hooks" in w for w in warnings)
    assert any("concepts" in w for w in warnings)


def test_a_concept_pillar_must_be_one_of_the_four() -> None:
    avatar = _avatar(0)
    avatar["concepts"][0]["pillar"] = "vibes"
    with pytest.raises(ValidationError):
        SubmitResearch.model_validate(_valid(avatars=[avatar]))
