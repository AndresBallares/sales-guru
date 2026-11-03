"""Quote text rules for the research runner (Phase 7b)."""

import pytest
from app.services.research_text import (
    norm_url,
    normalize,
    quote_in_text,
    quote_problem,
)


def test_normalize_folds_quotes_dashes_case_and_whitespace() -> None:
    assert normalize("  It’s  “fine” — really\n\tOK ") == normalize(
        'it\'s "fine" - really ok'
    )


@pytest.mark.parametrize(
    ("quote", "text", "found"),
    [
        (
            "I can't find a ring that fits",
            "Honestly I CAN’T find a ring that fits.",
            True,
        ),
        ("ring that fits well", "I can't find a ring that fits", False),
        ("x", "", False),
        ("", "some text", False),
    ],
)
def test_quote_in_text(quote: str, text: str, found: bool) -> None:
    assert quote_in_text(quote, text) is found


@pytest.mark.parametrize(
    ("text", "problem"),
    [
        ("it keeps turning my finger green", None),
        ("   ", "empty"),
        (" ".join(["word"] * 15), "too_long"),
        (" ".join(["word"] * 14), None),
        ("thanks u/ring_fan99 it works", "username"),
        ("as @jewelrylover said, it tarnishes", "username"),
    ],
)
def test_quote_problem(text: str, problem: str | None) -> None:
    assert quote_problem(text) == problem


def test_norm_url_ignores_fragment_scheme_case_and_trailing_slash() -> None:
    assert norm_url("HTTPS://Example.com/a/b/#top") == norm_url(
        "http://example.com/a/b"
    )
