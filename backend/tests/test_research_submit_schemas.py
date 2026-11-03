"""The two submit tools of a research run and their lenient parsing (Phase 7b)."""

from typing import Any

from app.schemas.research import (
    ResearchSource,
    SubmitAvatars,
    SubmitFindings,
    avatar_count_warnings,
    findings_count_warnings,
)
from app.services.research_parse import salvage_avatars, salvage_findings
from app.services.tool_use import strict_input_schema, tool_input_schema


def _problem(n: int) -> dict[str, Any]:
    return {
        "number": n,
        "problem": f"problem {n}",
        "evidence": [{"kind": "inference", "text": "likely", "source_url": ""}],
        "inferred": True,
    }


def _solution(n: int) -> dict[str, Any]:
    return {
        "number": n,
        "solution": f"solution {n}",
        "problem_numbers": [n],
        "mechanism": "m",
        "inferred": False,
    }


def _avatar(
    name: str = "A", hooks: int = 5, angles: int = 3, concepts: int = 2
) -> dict[str, Any]:
    return {
        "name": name,
        "who": "w",
        "purchase_for": "self",
        "primary_problems": [1],
        "unknown_problems": [],
        "primary_solutions": [1],
        "alternatives": [],
        "objections": [],
        "hooks": [f"h{i}" for i in range(hooks)],
        "creative_angles": [f"a{i}" for i in range(angles)],
        "concepts": [
            {"name": f"c{i}", "pillar": "offer", "description": "d"}
            for i in range(concepts)
        ],
        "inferred": False,
    }


def _findings(problems: int = 20, solutions: int = 20) -> SubmitFindings:
    return SubmitFindings.model_validate(
        {
            "problems": [_problem(i) for i in range(1, problems + 1)],
            "solutions": [_solution(i) for i in range(1, solutions + 1)],
            "gaps": [],
            "competitor_terms": ["Serpenti"],
        }
    )


def test_submit_findings_is_strict_compatible_with_no_optional_fields() -> None:
    schema = strict_input_schema(SubmitFindings)
    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {
        "problems",
        "solutions",
        "gaps",
        "competitor_terms",
    }


def test_submit_avatars_schema_builds_without_strict() -> None:
    schema = tool_input_schema(SubmitAvatars)
    assert {"avatars", "coverage_note", "sources"} <= set(schema["properties"])


def test_findings_count_warnings() -> None:
    assert findings_count_warnings(_findings()) == []
    assert findings_count_warnings(_findings(18, 20)) == [
        "Expected 20 problems, got 18"
    ]
    assert findings_count_warnings(_findings(20, 19)) == [
        "Expected 20 solutions, got 19"
    ]


def test_avatar_count_warnings() -> None:
    ok = SubmitAvatars(
        avatars=[
            SubmitAvatars.model_validate(
                {"avatars": [_avatar(f"A{i}")], "coverage_note": "", "sources": []}
            ).avatars[0]
            for i in range(5)
        ],
        coverage_note="n",
        sources=[ResearchSource(url="https://a.com", title="t", reached=True)],
    )
    assert avatar_count_warnings(ok) == []
    short = ok.model_copy(update={"avatars": ok.avatars[:4]})
    assert avatar_count_warnings(short) == ["Expected 5 avatars, got 4"]
    odd = SubmitAvatars.model_validate(
        {
            "avatars": [_avatar("Z", hooks=4, angles=2, concepts=4)] * 5,
            "coverage_note": "",
            "sources": [],
        }
    )
    lines = avatar_count_warnings(odd)
    assert any("hooks" in line for line in lines)
    assert any("creative angles" in line for line in lines)
    assert any("concepts" in line for line in lines)


def test_salvage_findings_keeps_valid_items_and_warns_about_the_rest() -> None:
    raw: dict[str, Any] = {
        "problems": [_problem(1), {"number": "x"}, _problem(3)],
        "solutions": [_solution(1)],
    }
    result, warnings = salvage_findings(raw)
    assert [p.number for p in result.problems] == [1, 3]
    assert result.gaps == []
    assert result.competitor_terms == []
    assert any("problem" in w.lower() for w in warnings)


def test_salvage_findings_tolerates_a_truncated_payload() -> None:
    result, warnings = salvage_findings({"problems": [_problem(1)]})
    assert len(result.problems) == 1
    assert result.solutions == []
    assert warnings == []


def test_salvage_findings_tolerates_garbage() -> None:
    result, _ = salvage_findings({"problems": "not a list", "gaps": 3})
    assert result.problems == []
    assert result.gaps == []


def test_salvage_avatars_drops_a_truncated_last_avatar() -> None:
    raw: dict[str, Any] = {
        "avatars": [_avatar("Good"), {"name": "Cut off"}],
        "coverage_note": "partial",
    }
    result, warnings = salvage_avatars(raw)
    assert [a.name for a in result.avatars] == ["Good"]
    assert result.coverage_note == "partial"
    assert result.sources == []
    assert any("avatar" in w.lower() for w in warnings)
