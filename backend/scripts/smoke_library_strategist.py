"""Smoke test of the Strategist with a business's buyer avatar library (Phase 3).

Runs the real model twice against dev data, to see whether it follows the rules
the code enforces:

  A. one first-batch creative test plan, written for the library's avatars;
  B. one follow-up round, with a simulated winner (one of A's angles).

It prints each answer, whether the hard rules held on the first attempt, any
retries, and the tokens and actual cost. It writes nothing to the database and
never touches Meta: it calls ``generate_strategy`` and ``generate_round_angles``
directly, which only read.

It is inert by default. Without ``--run`` it prints the plan and the worst case
of a single attempt and makes NO API calls. ``--run`` spends real money and needs
a real ANTHROPIC_API_KEY and an explicit ``--cap`` in dollars: before every call
the spend so far plus that one call's worst case (its prompt plus a full
``max_tokens`` reply) must fit under the cap, otherwise the run stops.

Usage:
    uv run python scripts/smoke_library_strategist.py --business BIZ --campaign CAMP
    uv run python scripts/smoke_library_strategist.py --business BIZ --campaign CAMP \
        --run --cap 0.25
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.schemas.strategy import CreativeAngle, CreativeTestPlanContent
from app.services import strategist
from app.services.buyer_avatars import assignable_avatars
from app.services.creative_naming import angle_label
from app.services.llm_call import UsageTotals, price_for
from app.services.round_results import AdAngle, AdResult, RoundResults
from prisma import Prisma
from prisma.models import BuyerAvatar

_CHARS_PER_TOKEN = 3.5  # conservative: prose averages closer to 4


class CapExceededError(RuntimeError):
    """The next call could take spending past the cap."""


class _Lines(logging.Handler):
    """Collects the strategist's log lines (relaxed rules, steering warnings)."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(f"{record.levelname}: {record.getMessage()}")


class _Meter:
    """Counts calls, tokens and dollars, and refuses a call that could pass the cap."""

    def __init__(self, cap: float, model: str) -> None:
        self.cap = cap
        self.model = model
        self.totals = UsageTotals()
        self.calls: list[dict[str, Any]] = []
        self.prompts: list[str] = []

    def worst_case(self, input_chars: int, max_tokens: int) -> float:
        price = price_for(self.model)
        return (
            input_chars / _CHARS_PER_TOKEN * price.input + max_tokens * price.output
        ) / 1e6

    def guard(self, input_chars: int, max_tokens: int) -> None:
        worst = self.worst_case(input_chars, max_tokens)
        if self.totals.cost_usd + worst > self.cap:
            raise CapExceededError(
                f"${self.totals.cost_usd:.4f} spent + ${worst:.4f} worst case for "
                f"the next call is over the ${self.cap:.2f} cap"
            )

    def record(self, step: str, usage: object) -> None:
        before = self.totals.cost_usd
        self.totals.add(usage, self.model)
        self.calls.append(
            {
                "step": step,
                "input_tokens": getattr(usage, "input_tokens", 0),
                "output_tokens": getattr(usage, "output_tokens", 0),
                "cache_write": getattr(usage, "cache_creation_input_tokens", 0),
                "cache_read": getattr(usage, "cache_read_input_tokens", 0),
                "cost_usd": round(self.totals.cost_usd - before, 5),
            }
        )


def _install(meter: _Meter, step: dict[str, str]) -> None:
    """Wrap the two seams the strategist calls through; behavior is unchanged."""
    real_call = getattr(strategist, "call_with_tool")  # noqa: B009
    real_agent = strategist._call_agent  # noqa: SLF001

    async def metered_call(*args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        chars = len(json.dumps(kwargs.get("system", ""), default=str)) + len(
            json.dumps(kwargs.get("messages", ""), default=str)
        )
        chars += len(json.dumps(kwargs["tool"].input_schema))
        meter.guard(chars, kwargs["max_tokens"])
        response = await real_call(*args, **kwargs)
        meter.record(step["name"], response.usage)
        return response

    async def spy_agent(**kwargs: Any) -> Any:  # noqa: ANN401
        meter.prompts.append(kwargs["prompt"])
        return await real_agent(**kwargs)

    setattr(strategist, "call_with_tool", metered_call)  # noqa: B010
    setattr(strategist, "_call_agent", spy_agent)  # noqa: B010


def _retry_reason(prompt: str) -> str:
    """The tail the strategist appends when it asks again."""
    marker = "\n\nYour previous"
    return prompt[prompt.index(marker) :].strip() if marker in prompt else ""


def _show(
    angles: list[Any], names: dict[str, str], kinds: dict[str, str]
) -> list[dict[str, str]]:
    rows = []
    for n, a in enumerate(angles, 1):
        row = {
            "avatar": names.get(a.buyer_avatar_id, "?"),
            "purchase_for": kinds.get(a.buyer_avatar_id, "?"),
            "buyer_type": str(a.avatar),
            "concept": a.concept,
            "pillar": a.pillar,
            "description": a.description,
        }
        rows.append(row)
        print(
            f"  {n}. {row['avatar']} (buys for: {row['purchase_for']} -> "
            f"{row['buyer_type']})\n     concept={row['concept']}  "
            f"pillar={row['pillar']}\n     {row['description']}"
        )
    return rows


def _first_batch_checks(
    angles: list[Any], kinds: dict[str, str]
) -> dict[str, bool | int]:
    ids = [a.buyer_avatar_id for a in angles]
    distinct = len(set(ids))
    both = {kinds[i] for i in ids if i in kinds}
    needs_both = set(kinds.values()) >= {"self", "gift"}
    return {
        "valid_ids": all(i in kinds for i in ids),
        "distinct_avatars": distinct,
        "needs_at_least": min(3, len(kinds)),
        "distinct_ok": distinct >= min(3, len(kinds)),
        "self_and_gift_covered": both >= {"self", "gift"} if needs_both else True,
    }


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    if settings.fake_llm_enabled or not settings.anthropic_api_key:
        print("Needs a real ANTHROPIC_API_KEY and FAKE_LLM unset.")
        return 1
    model = settings.strategist_model
    meter = _Meter(args.cap, model)
    lines = _Lines()
    for name in ("app.services.strategist", "app.services.avatar_library_prompt"):
        logger = logging.getLogger(name)
        logger.addHandler(lines)
        logger.setLevel(logging.INFO)

    db = Prisma()
    await db.connect()
    try:
        business = await db.business.find_unique(where={"id": args.business})
        campaign = await db.campaign.find_unique(where={"id": args.campaign})
        assert business is not None and campaign is not None
        product = (
            await db.product.find_unique(where={"id": campaign.productId})
            if campaign.productId
            else None
        )
        audience = (
            await db.audience.find_unique(where={"id": campaign.audienceId})
            if campaign.audienceId
            else None
        )
        brand = await db.brandprofile.find_unique(where={"businessId": business.id})
        avatars: list[BuyerAvatar] = await assignable_avatars(business.id, client=db)
    finally:
        await db.disconnect()

    names = {a.id: a.name for a in avatars}
    kinds = {a.id: a.purchaseFor for a in avatars}
    print(f"Model: {model}   cap: ${args.cap:.2f}   business: {business.name}")
    print(
        "Library: "
        + ", ".join(f"{a.name} ({a.purchaseFor})" for a in avatars)
        + f"\nProduct: {(product.description if product else '-')[:70]!r}"
    )
    step = {"name": "A first batch"}
    _install(meter, step)
    report: dict[str, Any] = {"model": model, "cap": args.cap}

    print("\n=== A. First-batch creative test plan ===")
    try:
        plan = await strategist.generate_strategy(
            business=business,
            product=product,
            audience=audience,
            objective="SALES",
            plan_type="CREATIVE_TEST_PLAN",
            brand_profile=brand,
            buyer_avatars=avatars,
        )
    except (strategist.StrategistError, CapExceededError) as exc:
        print(f"FAILED: {exc}")
        report["A_failed"] = str(exc)
        plan = None
    a_calls = len(meter.calls)
    if plan is not None:
        assert isinstance(plan, CreativeTestPlanContent)
        angles = list(plan.creative_angles)
        checks = _first_batch_checks(angles, kinds)
        print(f"Attempts: {a_calls}  (retries: {a_calls - 1})")
        if a_calls > 1:
            print(f"Retry reason: {_retry_reason(meter.prompts[1])[:600]}")
        print(f"Hard rules: {checks}")
        report["A"] = {
            "attempts": a_calls,
            "retry_reason": _retry_reason(meter.prompts[1]) if a_calls > 1 else "",
            "checks": checks,
            "angles": _show(angles, names, kinds),
        }

    if plan is not None:
        step["name"] = "B round"
        angles = list(plan.creative_angles)
        lead = angles[args.leader]
        weak = angles[-1] if args.leader != len(angles) - 1 else angles[0]

        def result(a: CreativeAngle, cost: float, got: int) -> AdResult:
            return AdResult(
                ad_id=f"sim-{a.concept}",
                angle=AdAngle(
                    angle_label(str(a.avatar), a.concept, a.pillar),
                    a.buyer_avatar_id,
                    a.avatar,
                    a.concept,
                    a.pillar,
                ),
                spend=cost * got,
                results=got,
                cost=cost,
            )

        simulated = RoundResults(
            "cost_per_add_to_cart", result(lead, 10.0, 10), result(weak, 20.0, 5), 4
        )
        print(
            f"\n=== B. Follow-up round, simulated winner: "
            f"{names[lead.buyer_avatar_id or '']} / {lead.concept} / {lead.pillar} ==="
        )
        try:
            round_angles = await strategist.generate_round_angles(
                business=business,
                product=product,
                audience=audience,
                plan=plan,
                excluded_angles=angles,
                count=4,
                brand_profile=brand,
                buyer_avatars=avatars,
                previous_results=simulated,
            )
        except (strategist.StrategistError, CapExceededError) as exc:
            print(f"FAILED: {exc}")
            report["B_failed"] = str(exc)
            round_angles = []
        b_calls = len(meter.calls) - a_calls
        if round_angles:
            winner = lead.buyer_avatar_id
            on_winner = sum(a.buyer_avatar_id == winner for a in round_angles)
            on_both = sum(
                a.buyer_avatar_id == winner and a.pillar == lead.pillar
                for a in round_angles
            )
            others = sum(a.buyer_avatar_id != winner for a in round_angles)
            print(f"Attempts: {b_calls}  (retries: {b_calls - 1})")
            if b_calls > 1:
                print(f"Retry reason: {_retry_reason(meter.prompts[-1])[:600]}")
            print(
                f"Steering: {on_winner}/4 on the winning avatar (need >=2), "
                f"{on_both}/4 on winning avatar AND pillar, {others} on other avatars "
                f"(need >=1)"
            )
            report["B"] = {
                "attempts": b_calls,
                "retry_reason": _retry_reason(meter.prompts[-1]) if b_calls > 1 else "",
                "winner_avatar": names.get(winner or "", "?"),
                "winner_pillar": lead.pillar,
                "on_winner": on_winner,
                "on_winner_and_pillar": on_both,
                "on_other_avatars": others,
                "angles": _show(list(round_angles), names, kinds),
            }

    print("\n=== Log lines from the Strategist ===")
    for line in lines.lines or ["(none)"]:
        print(" ", line)
    print("\n=== Tokens and cost ===")
    for call in meter.calls:
        print(
            f"  {call['step']}: in={call['input_tokens']} out={call['output_tokens']} "
            f"cache_w={call['cache_write']} cache_r={call['cache_read']} "
            f"${call['cost_usd']:.4f}"
        )
    t = meter.totals
    print(
        f"  TOTAL: {len(meter.calls)} request(s), in={t.input_tokens} "
        f"out={t.output_tokens} -> ${t.cost_usd:.4f} of ${args.cap:.2f} cap"
    )
    report.update(
        {"calls": meter.calls, "total_usd": round(t.cost_usd, 5), "log": lines.lines}
    )
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=2, default=str))
        print(f"Saved {args.out}")
    return 0


def _plan(args: argparse.Namespace) -> None:
    model = get_settings().strategist_model
    worst = _Meter(args.cap or 0.0, model).worst_case(14_000, 8192)
    print(f"Model: {model}. Plan: one first-batch plan, one follow-up round.")
    print(
        f"Worst case of ONE attempt (a ~4k-token prompt and a full 8192-token reply): "
        f"${worst:.3f}. Each call is checked against the cap before it is sent."
    )
    print("No API calls made. Re-run with --run --cap <dollars> to spend.")


def main() -> int:
    """Parse the arguments and print the plan or run the smoke test."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--business", required=True)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--cap", type=float, default=None)
    parser.add_argument("--leader", type=int, default=0, help="angle 0-3 to crown")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    if not args.run:
        _plan(args)
        return 0
    if args.cap is None or args.cap <= 0:
        print("--run needs an explicit --cap in dollars.")
        return 2
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
