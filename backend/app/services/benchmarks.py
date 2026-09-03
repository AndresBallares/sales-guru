"""Jewelry & accessories industry ad-performance benchmarks.

MVP is scoped to this vertical only — see PRD.md §1. Meta figures are used
as the numeric context in a TEST_PLAN's success criteria
(app/services/strategist.py) and as the fallback CAC context when a
campaign's own unit economics can't be computed (app/services/
unit_economics.py). Google figures are never acted on directly — this
product only publishes to Meta Ads (PRD.md §4 explicitly defers Google/
TikTok) — they're informational grounding only, letting the Strategist
Agent justify channel choice (e.g. Meta's lower CAC vs. Google's cost per
lead) in its narrative output.

Meta benchmarks are stored as ranges with metadata, not single points
(confirmed with the user 2026-09-01) — a single number invites false
precision downstream ("your CTR of 2.38% failed the 2.42% threshold" is
noise, not signal, when the underlying source is one validated median).
low/median/high define four directional performance zones via
classify_performance_zone below, giving the Optimizer (PRD.md §5 step 10)
room to call a result "within acceptable range" or "strong" instead of a
binary pass/fail against a point estimate.
"""

from typing import Literal, NamedTuple, Protocol

Direction = Literal["higher_is_better", "lower_is_better"]
PerformanceZone = Literal[
    "needs_attention", "within_acceptable_range", "strong", "exceptional"
]

# Directional metadata for metrics tracked by a TEST_PLAN (confirmed with
# the user 2026-09-01) — covers metrics with no numeric benchmark range
# yet (CPC, ROAS) as well as the four that do, so any comparison logic
# (a TEST_PLAN's success criteria now, the Optimizer's variant-vs-variant
# comparison later) can tell "better" from "worse" even without a range
# to classify against. add_to_cart_rate/conversion_rate aren't part of
# the user-confirmed set above but are unambiguously higher-is-better.
METRIC_DIRECTIONS: dict[str, Direction] = {
    "ctr": "higher_is_better",
    "cvr": "higher_is_better",
    "conversion_rate": "higher_is_better",
    "add_to_cart_rate": "higher_is_better",
    "roas": "higher_is_better",
    "cac": "lower_is_better",
    "cpc": "lower_is_better",
    "cpm": "lower_is_better",
}


class BenchmarkRange(NamedTuple):
    """A benchmark expressed as a range, not a single point.

    low < median < high numerically regardless of direction — `direction`
    is what determines which end of the range is actually "good"
    (e.g. a low CPM/CAC is good, but a low CTR/CVR is bad).
    """

    low: float
    median: float
    high: float
    source: str
    as_of: str
    direction: Direction


class RangeLike(Protocol):
    """Structural type for anything shaped like a benchmark range.

    Lets classify_performance_zone accept both BenchmarkRange (the live
    constants below) and app/schemas/strategy.py's BenchmarkContextEntry
    (a Pydantic snapshot of one, stored on a persisted TEST_PLAN) without
    those two modules needing a shared base class. Declared as read-only
    properties, not plain attributes — BenchmarkRange is an immutable
    NamedTuple, which a read-write Protocol attribute wouldn't match.
    """

    @property
    def low(self) -> float:
        """The range's low end."""

    @property
    def median(self) -> float:
        """The range's median."""

    @property
    def high(self) -> float:
        """The range's high end."""

    @property
    def direction(self) -> Direction:
        """Which end is "good": higher_is_better or lower_is_better."""


def classify_performance_zone(value: float, benchmark: RangeLike) -> PerformanceZone:
    """Classify a value into one of four zones relative to a benchmark range.

    Args:
        value: The actual (or hypothetical) metric value being classified.
        benchmark: The range to classify it against.

    Returns:
        "needs_attention" (worst), "within_acceptable_range",
        "strong", or "exceptional" (best) — the meaning of "worst"/"best"
        is resolved by benchmark.direction, not by the raw low/high
        ordering, so this reads correctly for both higher-is-better
        metrics (CTR, CVR) and lower-is-better ones (CPM, CAC).
    """
    if benchmark.direction == "higher_is_better":
        if value < benchmark.low:
            return "needs_attention"
        if value < benchmark.median:
            return "within_acceptable_range"
        if value < benchmark.high:
            return "strong"
        return "exceptional"

    if value > benchmark.high:
        return "needs_attention"
    if value > benchmark.median:
        return "within_acceptable_range"
    if value > benchmark.low:
        return "strong"
    return "exceptional"


# The user validated a single median figure per metric for this vertical
# (2026-08-31); no independently-sourced percentile data exists yet, so
# low/high here are an estimated +/-20% band around that median — a
# deliberately labeled placeholder methodology, not a second validated
# data point. Revisit with real percentile benchmarks if/when available.
_META_SOURCE = (
    "User-validated median for jewelry & accessories (2026-08-31); "
    "low/high are an estimated +/-20% band, not independently sourced."
)
_META_AS_OF = "2026-08-31"

# CAC's low/median/high were each given directly by the user (2026-09-03),
# not derived as a +/-20% band like the other three metrics above — kept
# as its own source/as_of pair so this distinction stays honest rather
# than implying a uniform methodology across all four metrics.
_CAC_SOURCE = "User-provided low/median/high for jewelry & accessories (2026-09-03)."
_CAC_AS_OF = "2026-09-03"


class MetaJewelryBenchmarks(NamedTuple):
    """Meta/Facebook ad benchmark ranges for the jewelry & accessories industry."""

    ctr: BenchmarkRange
    cpm: BenchmarkRange
    cvr: BenchmarkRange
    cac: BenchmarkRange


JEWELRY_META_BENCHMARKS = MetaJewelryBenchmarks(
    ctr=BenchmarkRange(
        low=1.94,
        median=2.42,
        high=2.90,
        source=_META_SOURCE,
        as_of=_META_AS_OF,
        direction="higher_is_better",
    ),
    cpm=BenchmarkRange(
        low=7.49,
        median=9.36,
        high=11.23,
        source=_META_SOURCE,
        as_of=_META_AS_OF,
        direction="lower_is_better",
    ),
    cvr=BenchmarkRange(
        low=0.68,
        median=0.85,
        high=1.02,
        source=_META_SOURCE,
        as_of=_META_AS_OF,
        direction="higher_is_better",
    ),
    cac=BenchmarkRange(
        low=45.0,
        median=55.0,
        high=65.0,
        source=_CAC_SOURCE,
        as_of=_CAC_AS_OF,
        direction="lower_is_better",
    ),
)


class GoogleJewelryBenchmarks(NamedTuple):
    """Google Ads benchmarks for the jewelry & accessories industry.

    Informational only — see module docstring; this product doesn't
    publish to Google. Kept as flat points, not ranges: nothing is ever
    measured against these, so the false-precision risk a range guards
    against doesn't apply here.
    """

    ctr_pct: float
    cpc_usd: float
    cvr_pct: float
    cost_per_lead_usd: float


JEWELRY_GOOGLE_BENCHMARKS = GoogleJewelryBenchmarks(
    ctr_pct=6.64, cpc_usd=4.44, cvr_pct=4.50, cost_per_lead_usd=97.51
)
