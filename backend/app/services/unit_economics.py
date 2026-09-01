"""Unit-economics math grounding the Strategist Agent's budget/CAC reasoning.

Confirmed with the user 2026-08-31. Deliberately not asked of the LLM —
like Campaign.objective, this is exact
arithmetic on data we already have, computed once here and injected into
the prompt/response rather than risking the model getting the math wrong
or contradicting it.
"""

from typing import NamedTuple

from prisma.models import Product


class UnitEconomics(NamedTuple):
    """Per-unit profit math for a Product, and the CAC/ROAS targets it implies."""

    gross_profit: float
    # Breakeven CAC equals gross profit: spending exactly your per-unit
    # profit to acquire a customer nets zero.
    breakeven_cac: float
    # A conservative target, leaving room for costs beyond acquisition.
    target_cac: float
    # ROAS (revenue/spend) at which ad spend exactly consumes gross profit:
    # breakeven_roas = 1 / margin (price cancels out — a $500 item at 40%
    # margin and a $50 item at 40% margin have the same breakeven ROAS).
    breakeven_roas: float


_TARGET_CAC_FRACTION_OF_GROSS_PROFIT = 0.33


def compute_unit_economics(product: Product | None) -> UnitEconomics | None:
    """Compute gross profit and CAC/ROAS targets for a product, if possible.

    Args:
        product: The campaign's product, if one was selected.

    Returns:
        None if no product was selected, if either `price` or `margin` is
        missing (both are optional onboarding fields, PRD.md §7, and this
        is common for a newly-onboarded business), or if `margin` is zero
        (a 0%-margin product has no meaningful breakeven ROAS — division
        by zero). Callers should fall back to industry-benchmark CAC
        (app/services/benchmarks.py) in that case rather than blocking
        generation on it.

    Note:
        `margin` is treated as a fraction of price (0.4 == 40% margin),
        per the formula as given (gross_profit = price * margin) — PRD.md
        §7 itself flags this field's exact unit as unconfirmed ("assumed
        profit margin %; revisit if meant differently"). If margin is
        actually meant to be entered as a whole percentage (40, not 0.4),
        this is off by 100x; revisit alongside that PRD note.
    """
    if (
        product is None
        or product.price is None
        or product.margin is None
        or product.margin == 0
    ):
        return None

    gross_profit = product.price * product.margin
    return UnitEconomics(
        gross_profit=gross_profit,
        breakeven_cac=gross_profit,
        target_cac=gross_profit * _TARGET_CAC_FRACTION_OF_GROSS_PROFIT,
        breakeven_roas=1 / product.margin,
    )
