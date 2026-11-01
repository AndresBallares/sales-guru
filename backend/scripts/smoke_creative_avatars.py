"""Smoke test of the Creative Agent writing ads to a business's buyer avatars (Phase 4).

Runs the real model against a business's dev data to see whether the ads follow what
the code asks of them:

  A. one first-batch creative test plan (the Strategist), to get four assigned angles;
  B. one batch of four ads written to those avatars, with the business's banned
     phrases and the stored proof points;
  C. one regenerate of the offer-pillar ad, to see whether the cached campaign context
     is read back and whether the ad cites only what is stored.

It prints every ad in full with its avatar, pillar and the avatar fields it was given,
whether the banned phrases held on the first attempt, any retry, and the tokens and
actual cost. It writes nothing to the database and never touches Meta.

It is inert by default. Without ``--run`` it prints the plan and the worst case of one
attempt and makes NO API calls. ``--run`` spends real money and needs a real
ANTHROPIC_API_KEY and an explicit ``--cap`` in dollars: before every call the spend so
far plus that one call's worst case (its prompt plus a full ``max_tokens`` reply) must
fit under the cap, otherwise the run stops.

Usage:
    uv run python scripts/smoke_creative_avatars.py --business BIZ --campaign CAMP
    uv run python scripts/smoke_creative_avatars.py --business BIZ --campaign CAMP \
        --run --cap 0.25
"""

import argparse
import asyncio
import json
import re
import sys
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.schemas.strategy import CreativeTestPlanContent
from app.services import ad_quality, creative, strategist
from app.services.brand_rules import banned_phrases_for
from app.services.buyer_avatars import avatars_for_copy
from app.services.creative_naming import angle_label
from app.services.llm_call import UsageTotals, price_for
from prisma import Prisma
from prisma.models import BuyerAvatar

_CHARS_PER_TOKEN = 3.5  # conservative: prose averages closer to 4

# Words that make an ad promise something. Each one found in an ad is looked up in the
# stored proof points and the standing offer; one that is not there is flagged. A
# heuristic for a person to read alongside the ad's full text, not a verdict.
_PROMISE_WORDS = (
    "free",
    "refund",
    "guarantee",
    "discount",
    "% off",
    "sale",
    "shipping",
    "return",
    "warranty",
    "lifetime",
    "complimentary",
    "bonus",
    "engrav",
    "certificate",
    "gia",
    "new york",
    "gift",
    "days",
    "$",
)
_STOP = frozenset(
    [
        "that",
        "this",
        "with",
        "from",
        "your",
        "have",
        "their",
        "they",
        "them",
        "what",
        "when",
        "will",
        "would",
        "about",
        "into",
        "more",
        "than",
        "then",
        "there",
        "which",
        "while",
        "where",
        "also",
        "been",
        "being",
        "were",
        "does",
    ]  # noqa: SIM905
)


class CapExceededError(RuntimeError):
    """The next call could take spending past the cap."""


class _Meter:
    """Counts calls, tokens and dollars, and refuses a call that could pass the cap."""

    def __init__(self, cap: float) -> None:
        self.cap = cap
        self.totals = UsageTotals()
        self.calls: list[dict[str, Any]] = []
        self.step = "A"
        self.tool_inputs: dict[str, list[dict[str, Any]]] = {}
        self.sent: dict[str, list[str]] = {}

    @staticmethod
    def worst_case(model: str, input_chars: int, max_tokens: int) -> float:
        price = price_for(model)
        return (
            input_chars / _CHARS_PER_TOKEN * price.input + max_tokens * price.output
        ) / 1e6

    def guard(self, model: str, input_chars: int, max_tokens: int) -> None:
        worst = self.worst_case(model, input_chars, max_tokens)
        if self.totals.cost_usd + worst > self.cap:
            raise CapExceededError(
                f"${self.totals.cost_usd:.4f} spent + ${worst:.4f} worst case for the "
                f"next call is over the ${self.cap:.2f} cap"
            )

    def record(self, model: str, usage: object) -> None:
        before = self.totals.cost_usd
        self.totals.add(usage, model)
        self.calls.append(
            {
                "step": self.step,
                "input_tokens": getattr(usage, "input_tokens", 0),
                "output_tokens": getattr(usage, "output_tokens", 0),
                "cache_write": getattr(usage, "cache_creation_input_tokens", 0),
                "cache_read": getattr(usage, "cache_read_input_tokens", 0),
                "cost_usd": round(self.totals.cost_usd - before, 5),
            }
        )


def _install(meter: _Meter) -> None:
    """Wrap both agents' model call; behavior is unchanged."""
    real = getattr(strategist, "call_with_tool")  # noqa: B009

    async def metered(*args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        chars = len(json.dumps(kwargs.get("system", ""), default=str)) + len(
            json.dumps(kwargs.get("messages", ""), default=str)
        )
        chars += len(json.dumps(kwargs["tool"].input_schema))
        meter.guard(kwargs["model"], chars, kwargs["max_tokens"])
        response = await real(*args, **kwargs)
        meter.record(kwargs["model"], response.usage)
        for block in response.content:
            if getattr(block, "type", "") == "tool_use":
                meter.tool_inputs.setdefault(meter.step, []).append(block.input)
        content = kwargs["messages"][0]["content"]
        meter.sent.setdefault(meter.step, []).append(
            content
            if isinstance(content, str)
            else "\n".join(b["text"] for b in content if b.get("type") == "text")
        )
        return response

    setattr(strategist, "call_with_tool", metered)  # noqa: B010
    setattr(creative, "call_with_tool", metered)  # noqa: B010


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{5,}", text.lower()) if w not in _STOP}


def _longest_shared_run(a: str, b: str) -> int:
    """Length, in words, of the longest run of words the two texts share."""
    wa, wb = re.findall(r"\w+", a.lower()), re.findall(r"\w+", b.lower())
    best = 0
    for i in range(len(wa)):
        for j in range(len(wb)):
            n = 0
            while i + n < len(wa) and j + n < len(wb) and wa[i + n] == wb[j + n]:
                n += 1
            best = max(best, n)
    return best


def _blocks_in(tail: str) -> dict[str, str]:
    """The avatar block text each variant was given, from the real prompt tail."""
    found = re.findall(
        r"Avatar for ([A-Za-z0-9 ]+?) \(user-provided[^\n]*"
        r"\n<<<START>>>\n(.*?)\n<<<END>>>",
        tail,
        re.DOTALL,
    )
    return dict(found)


def _ad_text(variant: Any) -> str:  # noqa: ANN401
    return "\n".join(
        part
        for part in (variant.headline, variant.body_text, variant.description)
        if part
    )


def _check_ad(
    variant: Any,  # noqa: ANN401
    block: str,
    avatar: BuyerAvatar,
    proof_points: list[str],
    offer: str | None,
    banned: list[str],
) -> dict[str, Any]:
    text = _ad_text(variant)
    lowered = text.lower()
    allowed = " ".join([*proof_points, offer or ""]).lower()
    promises = [w for w in _PROMISE_WORDS if w in lowered]
    unsupported = [w for w in promises if w not in allowed]
    given_hooks = json.loads(avatar.hooks)
    copied = [hook for hook in given_hooks if _longest_shared_run(hook, text) >= 5]
    entry_lines = [ln.split(": ", 1)[1] for ln in block.splitlines() if ": " in ln][1:4]
    overlap = sorted(_words(text) & _words(" ".join(entry_lines)))
    return {
        "banned_phrase_hits": ad_quality.business_phrases_in(text, banned)
        + ad_quality.banned_phrases_in(text),
        "promise_words_in_ad": promises,
        "promise_words_not_in_stored_proof": unsupported,
        "hooks_with_a_5_word_run_copied": copied,
        "words_shared_with_the_fields_given": overlap,
        "lengths": {
            "headline": len(variant.headline),
            "body_text": len(variant.body_text),
            "description": len(variant.description or ""),
        },
    }


def _print_ad(title: str, variant: Any, meta: dict[str, Any], block: str) -> None:  # noqa: ANN401
    print(f"\n----- {title} -----")
    print(
        f"Avatar: {meta['avatar']} ({meta['purchase_for']}) | pillar: {meta['pillar']}"
    )
    print(f"Angle: {meta['concept']} — {meta['description']}")
    print("Fields it was given:")
    for line in block.splitlines():
        print(f"    {line}")
    print("The ad:")
    print(f"    Headline: {variant.headline}")
    print(f"    Primary text: {variant.body_text}")
    print(f"    Description: {variant.description}")
    print(f"    CTA: {variant.cta}")
    print("Checks:", json.dumps(meta["checks"], indent=2, ensure_ascii=False))


async def _run(args: argparse.Namespace) -> int:
    settings = get_settings()
    if settings.fake_llm_enabled or not settings.anthropic_api_key:
        print("Needs a real ANTHROPIC_API_KEY and FAKE_LLM unset.")
        return 1
    meter = _Meter(args.cap)
    _install(meter)
    report: dict[str, Any] = {
        "cap": args.cap,
        "models": [settings.strategist_model, settings.creative_model],
    }

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
        banned = await banned_phrases_for(business.id, client=db)
        assignable, _ = await avatars_for_copy(business.id, [], client=db)
        # Every avatar of the business, deleted or inactive ones too, so any assigned
        # id resolves exactly as it does in the app (avatars_by_id).
        every_avatar = {
            a.id: a
            for a in await db.buyeravatar.find_many(where={"businessId": business.id})
        }
    finally:
        await db.disconnect()
    assert brand is not None
    proof_points = json.loads(brand.proofPoints) if brand.proofPoints else []
    print(
        f"Models: strategist {settings.strategist_model}, creative "
        f"{settings.creative_model}   cap ${args.cap:.2f}"
    )
    print(f"Business: {business.name}   offer stored: {brand.offer!r}")
    print(f"Proof points stored ({len(proof_points)}):")
    for n, p in enumerate(proof_points, 1):
        print(f"  {n}. {p}")
    print(
        f"Banned phrases: {len(banned)}   Library: "
        + ", ".join(f"{a.name} ({a.purchaseFor})" for a in assignable)
    )

    # ---- A. the plan --------------------------------------------------------
    meter.step = "A plan"
    print("\n=== A. First-batch plan (Strategist) ===")
    try:
        plan = await strategist.generate_strategy(
            business=business,
            product=product,
            audience=audience,
            objective="SALES",
            plan_type="CREATIVE_TEST_PLAN",
            brand_profile=brand,
            buyer_avatars=assignable,
        )
    except (strategist.StrategistError, CapExceededError) as exc:
        print(f"FAILED: {exc}")
        return 2
    assert isinstance(plan, CreativeTestPlanContent)
    names = every_avatar
    forced = ""
    if not any(a.pillar == "offer" for a in plan.creative_angles):
        # The test needs an offer-pillar ad: make the last angle one, and say so.
        angles = list(plan.creative_angles)
        angles[-1] = angles[-1].model_copy(update={"pillar": "offer"})
        plan = plan.model_copy(update={"creative_angles": angles})
        forced = (
            f"pillar of angle {len(angles)} was set to 'offer' by this script "
            "(the plan had none)"
        )
    for n, a in enumerate(plan.creative_angles):
        print(
            f"  {chr(65 + n)}. {names[a.buyer_avatar_id or ''].name} | "
            f"{a.concept} | {a.pillar}"
        )
    if forced:
        print("  NOTE:", forced)
    report["plan_note"] = forced

    # ---- B. the batch -------------------------------------------------------
    meter.step = "B batch"
    print("\n=== B. Batch of four ads (Creative Agent) ===")
    library, assigned = assignable, every_avatar

    async def write(**extra: Any) -> list[Any]:  # noqa: ANN401
        return await creative.generate_creatives(
            business=business,
            product=product,
            strategy=plan,
            brand_profile=brand,
            banned_phrases=banned,
            buyer_avatars=library,
            assigned_avatars=assigned,
            **extra,
        )

    try:
        variants = await write(campaign_id=None, batch_size=4)
    except (creative.CreativeAgentError, CapExceededError) as exc:
        print(f"FAILED: {exc}")
        return 2
    b_calls = [c for c in meter.calls if c["step"] == "B batch"]
    first_inputs = meter.tool_inputs.get("B batch", [{}])[0].get("variants", [])
    first_hits = [
        ad_quality.business_phrases_in(
            " ".join(
                str(v.get(k) or "") for k in ("headline", "bodyText", "description")
            ),
            banned,
        )
        for v in first_inputs
    ]
    print(
        f"Attempts: {len(b_calls)} (retries: {len(b_calls) - 1}); banned-phrase "
        f"hits on the FIRST attempt per ad: {first_hits}"
    )
    if len(b_calls) > 1:
        print("Retry note sent:", meter.sent["B batch"][-1][-700:])
    context, tail = creative._build_prompt_parts(  # noqa: SLF001
        business,
        product,
        plan,
        brand_profile=brand,
        batch_size=4,
        banned_phrases=banned,
        buyer_avatars=library,
        assigned_avatars=assigned,
    )
    blocks = _blocks_in(tail)
    ads: list[dict[str, Any]] = []
    for n, (variant, angle) in enumerate(
        zip(variants, plan.creative_angles, strict=False)
    ):
        avatar = assigned[angle.buyer_avatar_id or ""]
        block = blocks.get(f"variant {chr(65 + n)}", "(block not found)")
        meta = {
            "avatar": avatar.name,
            "purchase_for": avatar.purchaseFor,
            "pillar": angle.pillar,
            "concept": angle.concept,
            "description": angle.description,
            "checks": _check_ad(
                variant, block, avatar, proof_points, brand.offer, banned
            ),
        }
        _print_ad(f"Ad {chr(65 + n)}", variant, meta, block)
        ads.append({"variant": variant.model_dump(), "given": block, **meta})
    report["B"] = {
        "attempts": len(b_calls),
        "first_attempt_hits": first_hits,
        "ads": ads,
    }

    # ---- C. regenerate the offer ad ----------------------------------------
    offer_index = next(
        i for i, a in enumerate(plan.creative_angles) if a.pillar == "offer"
    )
    offer_angle = plan.creative_angles[offer_index]
    meter.step = "C regenerate"
    print(f"\n=== C. Regenerate ad {chr(65 + offer_index)} (the offer ad) ===")
    target = creative.SingleVariantTarget(
        angle_label(str(offer_angle.avatar), offer_angle.concept, offer_angle.pillar),
        offer_index,
        offer_angle.buyer_avatar_id,
        offer_angle.pillar,
    )
    others = [
        (v.headline, v.body_text) for i, v in enumerate(variants) if i != offer_index
    ]
    try:
        again = await write(single_variant=target, other_texts=others, campaign_id=None)
    except (creative.CreativeAgentError, CapExceededError) as exc:
        print(f"FAILED: {exc}")
        return 2
    c_calls = [c for c in meter.calls if c["step"] == "C regenerate"]
    _, tail_c = creative._build_prompt_parts(  # noqa: SLF001
        business,
        product,
        plan,
        brand_profile=brand,
        single_variant=target,
        banned_phrases=banned,
        buyer_avatars=library,
        assigned_avatars=assigned,
    )
    block_c = _blocks_in(tail_c).get(
        f"variant {chr(65 + offer_index)}", "(block not found)"
    )
    avatar_c = assigned[offer_angle.buyer_avatar_id or ""]
    meta_c = {
        "avatar": avatar_c.name,
        "purchase_for": avatar_c.purchaseFor,
        "pillar": offer_angle.pillar,
        "concept": offer_angle.concept,
        "description": offer_angle.description,
        "checks": _check_ad(
            again[0], block_c, avatar_c, proof_points, brand.offer, banned
        ),
    }
    print(
        f"Attempts: {len(c_calls)}; cache read tokens on the first call: "
        f"{c_calls[0]['cache_read']}"
    )
    _print_ad(f"Regenerated ad {chr(65 + offer_index)}", again[0], meta_c, block_c)
    report["C"] = {
        "attempts": len(c_calls),
        "cache_read_tokens": c_calls[0]["cache_read"],
        "ad": again[0].model_dump(),
        "given": block_c,
        **meta_c,
    }

    print("\n=== Tokens and cost ===")
    for c in meter.calls:
        print(
            f"  {c['step']}: in={c['input_tokens']} out={c['output_tokens']} "
            f"cache_w={c['cache_write']} cache_r={c['cache_read']} ${c['cost_usd']:.4f}"
        )
    t = meter.totals
    print(
        f"  TOTAL: {len(meter.calls)} request(s), in={t.input_tokens} "
        f"out={t.output_tokens} -> ${t.cost_usd:.4f} of ${args.cap:.2f} cap"
    )
    report.update({"calls": meter.calls, "total_usd": round(t.cost_usd, 5)})
    if args.out:
        Path(args.out).write_text(
            json.dumps(report, indent=2, default=str, ensure_ascii=False)
        )
        print(f"Saved {args.out}")
    return 0


def _plan(args: argparse.Namespace) -> None:
    settings = get_settings()
    worst = _Meter.worst_case(settings.creative_model, 20_000, 8192)
    print(
        f"Models: strategist {settings.strategist_model}, creative "
        f"{settings.creative_model}."
    )
    print(
        "Plan: one first-batch plan, one batch of four ads, one regenerate of the "
        "offer ad."
    )
    print(
        "Worst case of ONE attempt (a ~6k-token prompt and a full 8192-token reply): "
        f"${worst:.3f}."
    )
    print("Each call is checked against the cap before it is sent. No API calls made.")
    print("Re-run with --run --cap <dollars> to spend.")


def main() -> int:
    """Parse the arguments and print the plan or run the smoke test."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--business", required=True)
    parser.add_argument("--campaign", required=True)
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--cap", type=float, default=None)
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
