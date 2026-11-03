"""Cutting long text at a word boundary instead of mid-word."""

import pytest
from app.services.text_cut import cut_at_word


def test_text_within_the_limit_is_untouched() -> None:
    assert cut_at_word("alpha beta", 10) == "alpha beta"
    assert cut_at_word("alpha beta", 50) == "alpha beta"


@pytest.mark.parametrize(
    ("text", "limit", "expected"),
    [
        # cut lands inside "gamma": back up to the last whole word
        ("alpha beta gamma delta", 15, "alpha beta…"),
        # the character after the head is a space: keep the whole word
        ("alpha beta gamma", 11, "alpha beta…"),
        # a newline is whitespace too
        ("alpha beta\ngamma delta", 14, "alpha beta…"),
        # trailing spaces before the ellipsis are dropped
        ("alpha  beta gamma", 13, "alpha  beta…"),
    ],
)
def test_it_cuts_at_the_last_whole_word(text: str, limit: int, expected: str) -> None:
    result = cut_at_word(text, limit)
    assert result == expected
    assert len(result) <= limit


def test_a_single_unbroken_word_is_cut_hard_with_an_ellipsis() -> None:
    assert cut_at_word("d" * 700, 500) == "d" * 499 + "…"


def test_a_tiny_limit_still_returns_something_within_it() -> None:
    assert cut_at_word("alpha beta", 1) == "…"


def test_the_result_never_exceeds_the_limit_or_ends_mid_word() -> None:
    text = "The quick brown fox, jumps over the lazy dog! " * 40
    # From the length of the first word up: below that a hard cut is the only option.
    for limit in range(8, 400, 7):
        result = cut_at_word(text, limit)
        assert len(result) <= limit
        assert result.endswith("…")
        head = result[:-1]
        assert text.startswith(head)
        # whatever follows the kept text is whitespace: no word was split
        assert text[len(head)].isspace()
