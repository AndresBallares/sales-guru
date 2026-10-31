"""Side-by-side check of the avatar import on two models, with actual costs.

Phase 2 validation (2026-10-30): reads one real research document with
``claude-sonnet-5`` and ``claude-haiku-5-5`` through the same ``generate_avatar_drafts``
the endpoint uses, then prints what each produced and what each cost, so the
cheaper model's extraction quality can be judged by eye. It changes nothing in the
app and saves no avatars.

It is inert by default. Without ``--run`` it prints the plan and a worst-case cost
and makes NO API calls. ``--run`` spends real money and needs a real
ANTHROPIC_API_KEY and an explicit ``--cap`` in dollars: the worst case (two attempts
per model, each filling ``max_tokens``) must fit under the cap before anything is
called, and spend is checked again before the second model.

Usage:
    uv run python scripts/compare_avatar_import_models.py --document doc.txt
    uv run python scripts/compare_avatar_import_models.py --document doc.txt \
        --run --cap 0.75
"""

import argparse
import asyncio
import json
import logging
import re
import sys
from pathlib import Path
from types import SimpleNamespace

from app.core.config import get_settings
from app.schemas.avatar_import import MAX_DOCUMENT_LENGTH
from app.services import avatar_import
from app.services.avatar_import import AvatarImportError, generate_avatar_drafts
from app.services.llm_call import UsageTotals, price_for

DEFAULT_MODELS = ("claude-sonnet-5", "claude-haiku-5-5")
_CHARS_PER_TOKEN = 3.5  # conservative: prose averages closer to 4
_OVERHEAD_TOKENS = 1500  # system prompt, tool schema, wrapper


def _worst_case_usd(model: str, document_chars: int) -> float:
    """Two attempts, each reading the whole prompt and filling ``max_tokens``."""
    price = price_for(model)
    prompt_tokens = document_chars / _CHARS_PER_TOKEN + _OVERHEAD_TOKENS
    one = (prompt_tokens * price.input + avatar_import._MAX_TOKENS * price.output) / 1e6
    return 2 * one


class _UsageLines(logging.Handler):
    """Collects the ``llm_usage`` line of every request."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[dict[str, str]] = []

    def emit(self, record: logging.LogRecord) -> None:
        text = record.getMessage()
        if text.startswith("llm_usage "):
            self.lines.append(dict(re.findall(r"(\w+)=(\S+)", text)))


def _cost(model: str, lines: list[dict[str, str]]) -> tuple[UsageTotals, int]:
    totals = UsageTotals()
    for row in lines:
        totals.add(
            SimpleNamespace(
                input_tokens=int(row["input_tokens"]),
                output_tokens=int(row["output_tokens"]),
                cache_creation_input_tokens=int(row["cache_creation_input_tokens"]),
                cache_read_input_tokens=int(row["cache_read_input_tokens"]),
            ),
            model,
        )
    return totals, len(lines)


def _plan(document: str, models: tuple[str, ...]) -> None:
    print(f"Document: {len(document)} characters (limit {MAX_DOCUMENT_LENGTH})")
    for model in models:
        print(f"  {model}: worst case ${_worst_case_usd(model, len(document)):.2f}")
    total = sum(_worst_case_usd(m, len(document)) for m in models)
    print(f"Worst case for both: ${total:.2f}. A typical run costs a few cents each.")
    print("No API calls made. Re-run with --run --cap <dollars> to spend.")


async def _run(
    document: str, cap: float, out_dir: Path, models: tuple[str, ...]
) -> int:
    settings = get_settings()
    if settings.fake_llm_enabled or not settings.anthropic_api_key:
        print("Needs a real ANTHROPIC_API_KEY and FAKE_LLM unset.")
        return 1
    collector = _UsageLines()
    usage_log = logging.getLogger("app.services.llm_usage")
    usage_log.addHandler(collector)
    usage_log.setLevel(logging.INFO)

    spent = 0.0
    summary: list[str] = []
    for model in models:
        worst = _worst_case_usd(model, len(document))
        if spent + worst > cap:
            print(
                f"\nSkipping {model}: ${spent:.4f} spent, worst case ${worst:.2f}, "
                f"cap ${cap:.2f}."
            )
            break
        settings.avatar_import_model = model
        seen = len(collector.lines)
        print(f"\n=== {model} ===")
        try:
            result = await generate_avatar_drafts(document)
        except AvatarImportError as exc:
            print(f"FAILED: {exc}")
            totals, requests = _cost(model, collector.lines[seen:])
            spent += totals.cost_usd
            summary.append(
                f"{model}: failed ({exc}), {requests} request(s), "
                f"${totals.cost_usd:.4f}"
            )
            continue
        totals, requests = _cost(model, collector.lines[seen:])
        spent += totals.cost_usd
        (out_dir / f"drafts-{model}.json").write_text(
            json.dumps(
                {
                    "drafts": [d.model_dump() for d in result.drafts],
                    "warnings": result.warnings,
                },
                indent=2,
            )
        )
        for draft in result.drafts:
            counts = {
                k: len(getattr(draft, k))
                for k in (
                    "primary_problems",
                    "unknown_problems",
                    "mechanisms",
                    "alternatives",
                    "objections",
                    "hooks",
                    "creative_angles",
                )
            }
            print(f"- {draft.name}: {draft.who}")
            print("    " + ", ".join(f"{k}={v}" for k, v in counts.items()))
        for warning in result.warnings:
            print(f"  warning: {warning}")
        line = (
            f"{model}: {len(result.drafts)} avatars, {requests} request(s), "
            f"in={totals.input_tokens} out={totals.output_tokens} "
            f"cost=${totals.cost_usd:.4f}"
        )
        print(line)
        summary.append(line)

    print("\nSummary")
    for line in summary:
        print(f"  {line}")
    print(f"  TOTAL ${spent:.4f} of ${cap:.2f} cap. Full drafts: {out_dir}")
    return 0


def main() -> int:
    """Print the plan, or run both models with ``--run --cap``."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--document", type=Path, required=True)
    parser.add_argument("--run", action="store_true", help="make real, paid calls")
    parser.add_argument("--cap", type=float, help="dollar cap for the whole run")
    parser.add_argument("--out", type=Path, default=Path("."), help="where drafts go")
    parser.add_argument(
        "--models",
        nargs="+",
        default=list(DEFAULT_MODELS),
        help="models to compare (default: both)",
    )
    args = parser.parse_args()
    models = tuple(args.models)
    document = args.document.read_text().strip()
    if not document or len(document) > MAX_DOCUMENT_LENGTH:
        print(f"The document must be 1 to {MAX_DOCUMENT_LENGTH} characters.")
        return 2
    if not args.run:
        _plan(document, models)
        return 0
    if args.cap is None or args.cap <= 0:
        print("--run needs an explicit --cap in dollars.")
        return 2
    return asyncio.run(_run(document, args.cap, args.out, models))


if __name__ == "__main__":
    sys.exit(main())
