"""Side-by-side check: can a smaller model run the Optimizer's routine evaluation?

Token cost review (2026-10). The routine ``optimizer_eval`` call is small and
its output is a bounded decision (PAUSE_AD / INCREASE_BUDGET / DECREASE_BUDGET),
so a smaller model may do it for a fraction of the cost. This script answers
"does it make the same decisions?" on 10 fixed scenarios before anything is
switched. It changes nothing in the app: it only reads ``optimizer._MODEL`` for
the duration of a run.

It is inert by default. Without ``--run`` it prints the plan and an estimated
cost and makes NO API calls. ``--run`` spends real money (20 calls plus the
compatibility probe) and needs a real ANTHROPIC_API_KEY and an explicit
``--cap`` in dollars, enforced before every call.

What it checks, per scenario, baseline model vs candidate model:

* the same action type (the headline number)
* the same risk level
* the same auto-apply outcome (``compute_requires_approval``), the
  safety-relevant one: a model that auto-applies what the baseline would have
  sent to a human is not a drop-in replacement
* the same ad named for a pause, when several ads compete
* a suggested budget within 5% of the baseline's, after the guardrail cap
* confidence, reported as the difference rather than judged

It also runs a forced-tool-use compatibility probe on the candidate first,
because the app forces the tool call (``tool_choice={"type": "tool", ...}``),
which some newer models reject with a 400. If the probe fails, the candidate
cannot be a drop-in, whatever its decisions look like, and the run stops there.

Verdict thresholds are printed with the result but are only a suggestion: the
decision to switch is a human one.

Usage:
    uv run python scripts/compare_optimizer_models.py                  # plan only
    uv run python scripts/compare_optimizer_models.py --run            # real calls
    uv run python scripts/compare_optimizer_models.py --run --cap 0.50
"""

import argparse
import asyncio
import sys
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field, replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import anthropic  # noqa: E402
from anthropic import AsyncAnthropic  # noqa: E402
from anthropic.resources.messages.messages import AsyncMessages  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.services import optimizer  # noqa: E402
from app.services.optimizer import (  # noqa: E402
    AUTO_APPLY_CONFIDENCE_THRESHOLD,
    AdPerformance,
    RecommendationResult,
    TrendWindow,
    compute_requires_approval,
)

DEFAULT_BASELINE = "claude-sonnet-5"
DEFAULT_CANDIDATE = "claude-haiku-5-5"
BUDGET_TOLERANCE = 0.05

# Suggested pass bar, printed with the verdict. Not enforced anywhere.
MIN_ACTION_AGREEMENT = 9
MIN_AUTO_APPLY_AGREEMENT = 9

# Per-million-token (input, output) prices. Cache writes cost 1.25x input and
# cache reads 0.1x. A model missing here is costed at the baseline's rate, never
# as free, so the spend cap errs on the side of stopping early.
_PRICES = {
    "claude-sonnet-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
_CACHE_WRITE_FACTOR = 1.25
_CACHE_READ_FACTOR = 0.10
# Worst case for one optimizer evaluation on the baseline model (measured about
# $0.0076); used to refuse a call that could cross the cap.
_PER_CALL_MAX = 0.03
_EST_INPUT_TOKENS = 1500  # measured 1,519 on a real optimizer_eval (2026-10-24)
_EST_OUTPUT_TOKENS = 460  # same call


@dataclass(frozen=True)
class Scenario:
    """One campaign situation to evaluate, built from raw counts.

    Attributes:
        name: Short label for the report.
        budget: The ad set's current daily budget.
        windows: ``(label, impressions, clicks, spend, conversions)`` rows,
            most recent first, as compute_trend_windows would produce.
        product_price: Feeds the ROAS approximation; None means no ROAS.
        ads: ``(ad_id, name, spend, clicks, add_to_cart)`` rows when the ad set
            runs several competing ads (a creative test); empty otherwise.
    """

    name: str
    budget: float
    windows: tuple[tuple[str, int, int, float, int], ...]
    product_price: float | None = 450.0
    ads: tuple[tuple[str, str, float, int, int], ...] = field(default_factory=tuple)


SCENARIOS: tuple[Scenario, ...] = (
    Scenario(
        "improving: CAC falling, CTR up",
        50.0,
        (
            ("last 24h", 5200, 130, 48.0, 5),
            ("last 3d", 14000, 310, 140.0, 9),
            ("last 7d", 30000, 560, 310.0, 14),
        ),
    ),
    Scenario(
        "steady: flat across windows",
        40.0,
        (
            ("last 24h", 4000, 60, 40.0, 2),
            ("last 3d", 12000, 180, 120.0, 6),
            ("last 7d", 28000, 420, 280.0, 14),
        ),
    ),
    Scenario(
        "deteriorating: CTR collapsing",
        60.0,
        (
            ("last 24h", 9000, 45, 60.0, 0),
            ("last 3d", 26000, 300, 175.0, 3),
            ("last 7d", 52000, 900, 410.0, 12),
        ),
    ),
    Scenario(
        "spending with no conversions",
        30.0,
        (
            ("last 24h", 3500, 40, 30.0, 0),
            ("last 3d", 10000, 120, 90.0, 0),
            ("last 7d", 24000, 260, 210.0, 0),
        ),
    ),
    Scenario(
        "strong ROAS, budget-limited",
        25.0,
        (
            ("last 24h", 3000, 110, 25.0, 6),
            ("last 3d", 9000, 320, 75.0, 17),
            ("last 7d", 21000, 760, 175.0, 40),
        ),
    ),
    Scenario(
        "single noisy day, healthy week",
        45.0,
        (
            ("last 24h", 2000, 20, 45.0, 0),
            ("last 3d", 13000, 260, 135.0, 8),
            ("last 7d", 31000, 640, 315.0, 21),
        ),
    ),
    Scenario(
        "only 24h of data",
        35.0,
        (("last 24h", 4100, 70, 35.0, 2),),
    ),
    Scenario(
        "high CPM, decent conversion rate",
        80.0,
        (
            ("last 24h", 4000, 96, 80.0, 4),
            ("last 3d", 12500, 270, 240.0, 11),
            ("last 7d", 29000, 640, 560.0, 26),
        ),
    ),
    Scenario(
        "creative test: one ad clearly worst",
        50.0,
        (
            ("last 24h", 6000, 90, 50.0, 2),
            ("last 3d", 17000, 250, 150.0, 6),
            ("last 7d", 38000, 540, 350.0, 12),
        ),
        ads=(
            ("ad-1", "Self-purchaser - Everyday wear", 90.0, 150, 14),
            ("ad-2", "Self-purchaser - Craftsmanship", 88.0, 140, 12),
            ("ad-3", "Gift buyer - Perfect gift", 86.0, 130, 11),
            ("ad-4", "Gift buyer - Free engraving", 86.0, 120, 1),
        ),
    ),
    Scenario(
        "tiny budget, thin signal",
        10.0,
        (
            ("last 24h", 900, 12, 10.0, 0),
            ("last 3d", 2700, 33, 30.0, 1),
            ("last 7d", 6000, 70, 70.0, 2),
        ),
    ),
)


@dataclass(frozen=True)
class Outcome:
    """What one model decided for one scenario, post-guardrail."""

    action_type: str
    risk: str
    confidence: float
    suggested_budget: float | None
    target_ad_id: str | None
    requires_approval: bool
    usage: "CallUsage | None" = None


def outcome_of(result: RecommendationResult) -> Outcome:
    """Reduce a RecommendationResult to the fields the comparison looks at."""
    rec = result.recommendation
    return Outcome(
        action_type=rec.action_type,
        risk=rec.risk,
        confidence=rec.confidence,
        suggested_budget=rec.suggested_budget,
        target_ad_id=rec.target_ad_id,
        requires_approval=compute_requires_approval(
            action_type=rec.action_type,
            risk=rec.risk,
            confidence=rec.confidence,
            capped_by_guardrail=result.capped_by_guardrail,
        ),
    )


def confidence_band(confidence: float) -> str:
    """A coarse band for a self-reported confidence, ending at the auto-apply bar.

    Agreement on the exact number is meaningless (two runs of one model differ),
    so the comparison asks whether both land in the same band, and the top band
    starts at the app's auto-apply threshold because crossing it changes what
    happens to the recommendation.
    """
    if confidence >= AUTO_APPLY_CONFIDENCE_THRESHOLD:
        return "AUTO_APPLY"
    if confidence >= 0.75:
        return "HIGH"
    if confidence >= 0.5:
        return "MEDIUM"
    return "LOW"


@dataclass(frozen=True)
class CallUsage:
    """What one real call used and cost."""

    model: str
    input_tokens: int
    output_tokens: int
    thinking_tokens: int
    cost: float
    latency_s: float


def _tokens(value: object) -> int:
    return value if isinstance(value, int) else 0


def call_cost(model: str, usage: object) -> float:
    """Dollar cost of one response's usage on ``model``."""
    price_in, price_out = _PRICES.get(model, _PRICES[DEFAULT_BASELINE])
    plain = _tokens(getattr(usage, "input_tokens", 0))
    written = _tokens(getattr(usage, "cache_creation_input_tokens", 0))
    read = _tokens(getattr(usage, "cache_read_input_tokens", 0))
    out = _tokens(getattr(usage, "output_tokens", 0))
    return (
        plain * price_in
        + written * price_in * _CACHE_WRITE_FACTOR
        + read * price_in * _CACHE_READ_FACTOR
        + out * price_out
    ) / 1e6


class CapReachedError(RuntimeError):
    """Raised before a call that could take total spend past the approved cap."""


class SpendLedger:
    """Counts what real calls cost and refuses the one that could cross the cap.

    Per CLAUDE.md, real API calls that cost money need an explicit approved cap;
    this enforces it in code rather than trusting the estimate.
    """

    def __init__(self, cap: float, per_call_max: float = _PER_CALL_MAX) -> None:
        """Start empty with an approved ``cap`` and a worst-case cost per call."""
        self.cap = cap
        self.per_call_max = per_call_max
        self.spent = 0.0
        self.calls: list[CallUsage] = []

    def check(self) -> None:
        """Raise CapReachedError if one more call could take spend past the cap."""
        if self.spent + self.per_call_max > self.cap + 1e-9:
            raise CapReachedError(
                f"cap ${self.cap:.2f} reached (spent ${self.spent:.4f}; the next "
                f"call could cost up to ${self.per_call_max:.2f})"
            )

    def record(self, model: str, usage: object, latency_s: float) -> CallUsage:
        """Add one finished call's cost and return its usage record."""
        details = getattr(usage, "output_tokens_details", None)
        entry = CallUsage(
            model=model,
            input_tokens=_tokens(getattr(usage, "input_tokens", 0))
            + _tokens(getattr(usage, "cache_creation_input_tokens", 0))
            + _tokens(getattr(usage, "cache_read_input_tokens", 0)),
            output_tokens=_tokens(getattr(usage, "output_tokens", 0)),
            thinking_tokens=_tokens(getattr(details, "thinking_tokens", 0)),
            cost=call_cost(model, usage),
            latency_s=latency_s,
        )
        self.spent += entry.cost
        self.calls.append(entry)
        return entry

    @contextmanager
    def patched(self) -> Iterator[None]:
        """Wrap ``messages.create`` so every call is checked and recorded."""
        original = AsyncMessages.create
        ledger = self

        async def _measured(self_: object, **kwargs: object) -> object:
            ledger.check()
            started = time.monotonic()
            response = await cast(Any, original)(self_, **kwargs)
            ledger.record(
                str(kwargs.get("model", "unknown")),
                response.usage,
                time.monotonic() - started,
            )
            return response

        cast(Any, AsyncMessages).create = _measured
        try:
            yield
        finally:
            cast(Any, AsyncMessages).create = original


@dataclass(frozen=True)
class Comparison:
    """Baseline vs candidate on one scenario."""

    scenario: str
    baseline: Outcome
    candidate: Outcome

    @property
    def same_action(self) -> bool:
        """Whether both chose the same action type."""
        return self.baseline.action_type == self.candidate.action_type

    @property
    def same_risk(self) -> bool:
        """Whether both assessed the same risk level."""
        return self.baseline.risk == self.candidate.risk

    @property
    def same_auto_apply(self) -> bool:
        """Whether both would take the same path: auto-apply or human approval."""
        return self.baseline.requires_approval == self.candidate.requires_approval

    @property
    def same_target_ad(self) -> bool:
        """Whether both named the same ad (trivially true when neither did)."""
        return self.baseline.target_ad_id == self.candidate.target_ad_id

    @property
    def budget_close(self) -> bool:
        """Whether the suggested budgets agree within BUDGET_TOLERANCE."""
        a, b = self.baseline.suggested_budget, self.candidate.suggested_budget
        if a is None or b is None:
            return a is None and b is None
        return abs(a - b) <= BUDGET_TOLERANCE * a

    @property
    def same_confidence_band(self) -> bool:
        """Whether both confidences fall in the same band (see confidence_band)."""
        return confidence_band(self.baseline.confidence) == confidence_band(
            self.candidate.confidence
        )

    @property
    def confidence_delta(self) -> float:
        """Candidate confidence minus baseline confidence."""
        return self.candidate.confidence - self.baseline.confidence

    @property
    def riskier_than_baseline(self) -> bool:
        """The candidate auto-applies something the baseline sent to a human."""
        return self.baseline.requires_approval and not self.candidate.requires_approval


def summarize(comparisons: list[Comparison]) -> dict[str, Any]:
    """Counts and a suggested verdict for a finished run.

    Args:
        comparisons: One per scenario that completed on both models.

    Returns:
        Agreement counts, the scenarios where the candidate was riskier, and a
        ``suggest_switch`` flag against the printed thresholds.
    """
    total = len(comparisons)
    action = sum(c.same_action for c in comparisons)
    auto = sum(c.same_auto_apply for c in comparisons)
    riskier = [c.scenario for c in comparisons if c.riskier_than_baseline]
    return {
        "total": total,
        "same_action": action,
        "same_risk": sum(c.same_risk for c in comparisons),
        "same_confidence_band": sum(c.same_confidence_band for c in comparisons),
        "same_auto_apply": auto,
        "same_target_ad": sum(c.same_target_ad for c in comparisons),
        "budget_close": sum(c.budget_close for c in comparisons),
        "mean_confidence_delta": (
            sum(c.confidence_delta for c in comparisons) / total if total else 0.0
        ),
        "riskier": riskier,
        "suggest_switch": (
            total > 0
            and action >= MIN_ACTION_AGREEMENT
            and auto >= MIN_AUTO_APPLY_AGREEMENT
            and not riskier
        ),
    }


def estimate_cost(model: str, calls: int) -> float:
    """Rough dollar cost of ``calls`` optimizer evaluations on ``model``."""
    price_in, price_out = _PRICES.get(model, (2.0, 10.0))
    return calls * (_EST_INPUT_TOKENS * price_in + _EST_OUTPUT_TOKENS * price_out) / 1e6


def build_windows(scenario: Scenario) -> list[TrendWindow]:
    """Turn a scenario's raw counts into the TrendWindows the agent reads."""
    windows: list[TrendWindow] = []
    for label, impressions, clicks, spend, conversions in scenario.windows:
        derived = optimizer._derive_metrics(
            impressions=impressions,
            clicks=clicks,
            spend=spend,
            conversions=conversions,
            product_price=scenario.product_price,
        )
        windows.append(
            TrendWindow(label, impressions, clicks, spend, conversions, derived)
        )
    return windows


def build_ads(scenario: Scenario) -> list[AdPerformance] | None:
    """The scenario's competing ads, or None for a single-ad ad set."""
    if not scenario.ads:
        return None
    return [
        AdPerformance(
            ad_id=ad_id,
            name=name,
            spend=spend,
            clicks=clicks,
            add_to_cart=add_to_cart,
            cost_per_add_to_cart=spend / add_to_cart if add_to_cart else None,
            purchases=None,
            cac=None,
        )
        for ad_id, name, spend, clicks, add_to_cart in scenario.ads
    ]


async def probe_forced_tool_use(model: str) -> str | None:
    """Whether ``model`` accepts the forced ``tool_choice`` the app relies on.

    Args:
        model: The model id to test.

    Returns:
        None when the call succeeds, otherwise the API's error text. One tiny
        request (a few hundred tokens).
    """
    settings = get_settings()
    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    try:
        await client.messages.create(
            model=model,
            max_tokens=64,
            tools=[
                {
                    "name": "ping",
                    "description": "Reply with ok=true.",
                    "input_schema": {
                        "type": "object",
                        "properties": {"ok": {"type": "boolean"}},
                        "required": ["ok"],
                    },
                }
            ],
            tool_choice={"type": "tool", "name": "ping"},
            messages=[{"role": "user", "content": "Call the tool."}],
        )
    except anthropic.APIStatusError as exc:
        return f"{exc.status_code}: {exc.message}"
    return None


async def evaluate(
    model: str, scenario: Scenario, ledger: SpendLedger | None = None
) -> Outcome:
    """Run the app's own ``generate_recommendation`` on ``model`` for a scenario.

    With a ledger, the call is checked against the spend cap first (CapReachedError
    before any money is spent) and its cost, tokens and latency come back on the
    outcome.
    """
    original = optimizer._MODEL
    optimizer._MODEL = model
    seen = len(ledger.calls) if ledger is not None else 0

    async def _call() -> RecommendationResult:
        return await optimizer.generate_recommendation(
            business=cast(Any, SimpleNamespace(name="Acme Jewelry")),
            campaign=cast(
                Any,
                SimpleNamespace(
                    id="compare-run", name="Emerald Ring", objective="SALES"
                ),
            ),
            ad_set=cast(Any, SimpleNamespace(budget=scenario.budget)),
            windows=build_windows(scenario),
            ads=build_ads(scenario),
        )

    try:
        if ledger is None:
            result = await _call()
        else:
            with ledger.patched():
                result = await _call()
    finally:
        optimizer._MODEL = original
    outcome = outcome_of(result)
    if ledger is not None and len(ledger.calls) > seen:
        outcome = replace(outcome, usage=ledger.calls[-1])
    return outcome


def print_plan(baseline: str, candidate: str) -> None:
    """Print what ``--run`` would do and cost, without calling anything."""
    calls = len(SCENARIOS)
    print(f"Baseline : {baseline}")
    print(f"Candidate: {candidate}")
    print(f"Scenarios: {calls}")
    print(f"Calls    : {2 * calls} evaluations + 1 forced-tool-use probe")
    est = estimate_cost(baseline, calls) + estimate_cost(candidate, calls)
    print(f"Est. cost: about ${est:.3f}")
    print("\nNo API calls made. Re-run with --run to spend that.")
    for scenario in SCENARIOS:
        print(f"  - {scenario.name}")


def _model_totals(label: str, usages: list[CallUsage]) -> str:
    if not usages:
        return f"  {label}  no usage recorded"
    cost = sum(u.cost for u in usages)
    latency = sum(u.latency_s for u in usages) / len(usages)
    return (
        f"  {label}  total ${cost:.4f} over {len(usages)} calls "
        f"(${cost / len(usages):.4f}/call), mean latency {latency:.1f}s, "
        f"input tokens {sum(u.input_tokens for u in usages)}, "
        f"output tokens {sum(u.output_tokens for u in usages)}, "
        f"thinking tokens {sum(u.thinking_tokens for u in usages)}"
    )


def print_report(comparisons: list[Comparison], baseline: str, candidate: str) -> None:
    """Print the per-input table, agreement counts, cost and latency, and the bar."""
    print(
        f"\n{'input':44s} {'action':>20s}  {'risk':>11s}  {'conf band':>20s}  "
        f"{'target ad':>9s}  {'cost b/c':>15s}  {'latency b/c':>11s}"
    )
    for c in comparisons:
        action = (
            c.baseline.action_type
            if c.same_action
            else f"{c.baseline.action_type[:9]}!={c.candidate.action_type[:9]}"
        )
        bands = (
            confidence_band(c.baseline.confidence)
            if c.same_confidence_band
            else (
                f"{confidence_band(c.baseline.confidence)}!="
                f"{confidence_band(c.candidate.confidence)}"
            )
        )
        bu, cu = c.baseline.usage, c.candidate.usage
        cost = f"{bu.cost:.4f}/{cu.cost:.4f}" if bu and cu else "n/a"
        lat = f"{bu.latency_s:.1f}/{cu.latency_s:.1f}s" if bu and cu else "n/a"
        print(
            f"{c.scenario[:44]:44s} {action:>20s}  "
            f"{c.baseline.risk:>5s}/{c.candidate.risk:<5s}  {bands:>20s}  "
            f"{'same' if c.same_target_ad else 'DIFFERS':>9s}  {cost:>15s}  {lat:>11s}"
        )
    s = summarize(comparisons)
    print(
        f"\nsame action     : {s['same_action']}/{s['total']}"
        f"\nsame risk       : {s['same_risk']}/{s['total']}"
        f"\nsame conf. band : {s['same_confidence_band']}/{s['total']}"
        f"\nsame auto-apply : {s['same_auto_apply']}/{s['total']}"
        f"\nsame target ad  : {s['same_target_ad']}/{s['total']}"
        f"\nbudget within 5%: {s['budget_close']}/{s['total']}"
        f"\nmean confidence : {s['mean_confidence_delta']:+.3f} "
        f"({candidate} minus {baseline})"
    )
    print("\nCost and latency:")
    print(
        _model_totals(
            f"{baseline:18s}",
            [c.baseline.usage for c in comparisons if c.baseline.usage],
        )
    )
    print(
        _model_totals(
            f"{candidate:18s}",
            [c.candidate.usage for c in comparisons if c.candidate.usage],
        )
    )
    if s["riskier"]:
        print(f"\nCANDIDATE AUTO-APPLIES WHAT THE BASELINE WOULD NOT: {s['riskier']}")
    verdict = "meets" if s["suggest_switch"] else "does NOT meet"
    print(
        f"\nSuggested bar ({MIN_ACTION_AGREEMENT}/10 action, "
        f"{MIN_AUTO_APPLY_AGREEMENT}/10 auto-apply, none riskier): "
        f"candidate {verdict} it. The decision to switch is yours."
    )


async def run(baseline: str, candidate: str, cap: float) -> int:
    """Probe the candidate, then evaluate every scenario on both models.

    Args:
        baseline: The model to compare against.
        candidate: The model being considered.
        cap: The approved dollar cap for the whole run (CLAUDE.md requires one).

    Returns:
        0 on a full run, 1 if the candidate rejects forced tool use, 2 without an
        API key, 3 if the cap stopped the run (a partial report is printed).
    """
    settings = get_settings()
    if not settings.anthropic_api_key:
        print("ANTHROPIC_API_KEY is not configured.", file=sys.stderr)
        return 2

    print(f"Probing forced tool use on {candidate} ...")
    problem = await probe_forced_tool_use(candidate)
    if problem is not None:
        print(
            f"{candidate} rejects forced tool use ({problem}).\n"
            "The app forces the tool call, so it is not a drop-in replacement; "
            "stopping before any evaluation."
        )
        return 1
    print("  accepted.\n")

    ledger = SpendLedger(cap)
    comparisons: list[Comparison] = []
    stopped: CapReachedError | None = None
    for scenario in SCENARIOS:
        try:
            base = await evaluate(baseline, scenario, ledger)
            cand = await evaluate(candidate, scenario, ledger)
        except CapReachedError as exc:
            stopped = exc
            break
        comparisons.append(Comparison(scenario.name, base, cand))
        print(f"  done: {scenario.name}")
    if comparisons:
        print_report(comparisons, baseline, candidate)
    if stopped is not None:
        print(
            f"\nSTOPPED: {stopped}. Compared {len(comparisons)} of "
            f"{len(SCENARIOS)} inputs; spend so far ${ledger.spent:.4f}."
        )
        return 3
    print(f"\nSpend: ${ledger.spent:.4f} of the ${cap:.2f} cap.")
    return 0


def main() -> int:
    """Parse arguments; plan only unless ``--run`` is given."""
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--baseline", default=DEFAULT_BASELINE)
    parser.add_argument("--candidate", default=DEFAULT_CANDIDATE)
    parser.add_argument(
        "--run", action="store_true", help="Make the real API calls (costs money)."
    )
    parser.add_argument(
        "--cap",
        type=float,
        help="Approved spend cap in dollars; required with --run, enforced in code.",
    )
    args = parser.parse_args()
    if not args.run:
        print_plan(args.baseline, args.candidate)
        return 0
    if args.cap is None:
        print(
            "--run spends real money and needs an approved cap: pass --cap DOLLARS.",
            file=sys.stderr,
        )
        return 2
    return asyncio.run(run(args.baseline, args.candidate, args.cap))


if __name__ == "__main__":
    sys.exit(main())
