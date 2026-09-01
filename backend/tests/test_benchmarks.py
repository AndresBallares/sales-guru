"""Tests for the benchmark range/zone helpers backing the Strategist Agent.

classify_performance_zone isn't wired into anything yet (Phase A of the
test-plan redesign only snapshots ranges onto a plan; the Optimizer that
will actually classify real results against them isn't built yet) — tested
directly here so it isn't shipped with zero coverage.
"""

from app.services.benchmarks import BenchmarkRange, classify_performance_zone

_HIGHER_IS_BETTER = BenchmarkRange(
    low=1.94,
    median=2.42,
    high=2.90,
    source="test",
    as_of="2026-09-01",
    direction="higher_is_better",
)

_LOWER_IS_BETTER = BenchmarkRange(
    low=36.40,
    median=45.50,
    high=54.60,
    source="test",
    as_of="2026-09-01",
    direction="lower_is_better",
)


def test_classify_performance_zone_higher_is_better_needs_attention() -> None:
    """Below the range's low end is the worst zone when higher is better."""
    assert classify_performance_zone(1.0, _HIGHER_IS_BETTER) == "needs_attention"


def test_classify_performance_zone_higher_is_better_within_acceptable_range() -> None:
    assert (
        classify_performance_zone(2.0, _HIGHER_IS_BETTER) == "within_acceptable_range"
    )


def test_classify_performance_zone_higher_is_better_strong() -> None:
    assert classify_performance_zone(2.6, _HIGHER_IS_BETTER) == "strong"


def test_classify_performance_zone_higher_is_better_exceptional() -> None:
    """Above the range's high end is the best zone when higher is better."""
    assert classify_performance_zone(3.5, _HIGHER_IS_BETTER) == "exceptional"


def test_classify_performance_zone_lower_is_better_needs_attention() -> None:
    """Above the range's high end is the worst zone when lower is better —
    the opposite of the higher-is-better case, same range shape."""
    assert classify_performance_zone(60.0, _LOWER_IS_BETTER) == "needs_attention"


def test_classify_performance_zone_lower_is_better_within_acceptable_range() -> None:
    assert (
        classify_performance_zone(50.0, _LOWER_IS_BETTER) == "within_acceptable_range"
    )


def test_classify_performance_zone_lower_is_better_strong() -> None:
    assert classify_performance_zone(40.0, _LOWER_IS_BETTER) == "strong"


def test_classify_performance_zone_lower_is_better_exceptional() -> None:
    """Below the range's low end is the best zone when lower is better."""
    assert classify_performance_zone(20.0, _LOWER_IS_BETTER) == "exceptional"
