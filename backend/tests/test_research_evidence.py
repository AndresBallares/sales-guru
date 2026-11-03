"""Customer-voice evidence counting and level (Phase 7b)."""

import pytest
from app.services.research_evidence import (
    MIN_CUSTOMER_VOICE,
    assess_evidence,
    classify_source,
)


@pytest.mark.parametrize(
    ("url", "kind"),
    [
        ("https://www.reddit.com/r/jewelry/comments/abc/x/", "reddit"),
        ("https://old.reddit.com/r/rings", "reddit"),
        ("https://www.trustpilot.com/review/brand.com", "review"),
        ("https://www.sitejabber.com/reviews/brand.com", "review"),
        ("https://www.quora.com/Does-gold-vermeil-tarnish", "qa"),
        ("https://jewelry.stackexchange.com/questions/12/x", "qa"),
        ("https://community.example.com/t/ring-sizing/55", "forum"),
        ("https://forum.example.org/threads/rings.9/", "forum"),
        ("https://www.bulgari.com/en-us/rings", None),
        ("https://example.com/blog/how-to-clean", None),
        ("not a url", None),
    ],
)
def test_classify_source(url: str, kind: str | None) -> None:
    assert classify_source(url) == kind


def test_minimums_grow_with_depth() -> None:
    assert MIN_CUSTOMER_VOICE["light"] < MIN_CUSTOMER_VOICE["standard"]
    assert MIN_CUSTOMER_VOICE["standard"] < MIN_CUSTOMER_VOICE["deep"]


def test_enough_customer_voice_sources_is_ok() -> None:
    urls = [f"https://www.reddit.com/r/x/comments/{i}/t/" for i in range(3)]
    reading = assess_evidence("light", urls)
    assert (reading.count, reading.level, reading.reason) == (3, "OK", None)


def test_too_few_is_low_with_a_reason_naming_the_numbers() -> None:
    reading = assess_evidence("standard", ["https://www.reddit.com/r/x/comments/1/t/"])
    assert reading.level == "LOW"
    assert reading.count == 1
    assert reading.reason is not None
    assert "1" in reading.reason
    assert str(MIN_CUSTOMER_VOICE["standard"]) in reading.reason


def test_duplicates_and_non_customer_pages_are_not_counted() -> None:
    urls = [
        "https://www.reddit.com/r/x/comments/1/t/",
        "https://www.reddit.com/r/x/comments/1/t",
        "https://www.bulgari.com/en-us/rings",
    ]
    assert assess_evidence("light", urls).count == 1
