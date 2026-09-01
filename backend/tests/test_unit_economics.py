"""Tests for the unit-economics helper backing the Strategist Agent."""

from types import SimpleNamespace
from typing import cast

from app.services.unit_economics import UnitEconomics, compute_unit_economics
from prisma.models import Product


def _fake_product(**overrides: object) -> Product:
    defaults: dict[str, object] = {"price": None, "margin": None}
    defaults.update(overrides)
    return cast(Product, SimpleNamespace(**defaults))


def test_compute_unit_economics_returns_none_with_no_product() -> None:
    """No product selected means no unit economics to ground the agent with."""
    assert compute_unit_economics(None) is None


def test_compute_unit_economics_returns_none_without_a_price() -> None:
    """Price is optional onboarding data — missing it degrades gracefully."""
    assert compute_unit_economics(_fake_product(price=None, margin=0.4)) is None


def test_compute_unit_economics_returns_none_without_a_margin() -> None:
    """Margin is optional onboarding data — missing it degrades gracefully."""
    assert compute_unit_economics(_fake_product(price=500.0, margin=None)) is None


def test_compute_unit_economics_returns_none_with_a_zero_margin() -> None:
    """A 0%-margin product has no meaningful breakeven ROAS (division by zero)."""
    assert compute_unit_economics(_fake_product(price=500.0, margin=0.0)) is None


def test_compute_unit_economics_computes_gross_profit_and_cac_roas_targets() -> None:
    """gross_profit = price * margin; breakeven = gross profit; target = 33% of it;
    breakeven_roas = 1 / margin."""
    result = compute_unit_economics(_fake_product(price=500.0, margin=0.4))

    assert result == UnitEconomics(
        gross_profit=200.0, breakeven_cac=200.0, target_cac=66.0, breakeven_roas=2.5
    )
