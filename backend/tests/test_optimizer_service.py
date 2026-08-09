"""Tests for the Campaign Optimization Agent service.

The Anthropic client is mocked throughout — no test here needs a real
ANTHROPIC_API_KEY or makes a network call.
"""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import anthropic
import httpx
import pytest
from app.core.config import get_settings
from app.services import optimizer
from prisma.models import AdSet, Business, Campaign, Metric

_NOW = datetime(2026, 8, 9, 12, 0, tzinfo=UTC)

_VALID_TOOL_INPUT: dict[str, Any] = {
    "actionType": "INCREASE_BUDGET",
    "reasoning": "CPA decreased 24% over the last 3 days.",
    "confidence": 0.91,
    "risk": "MEDIUM",
    "suggestedBudget": 60.0,
}


def _fake_business(**overrides: object) -> Business:
    defaults: dict[str, object] = {"name": "Acme Jewelry"}
    defaults.update(overrides)
    return cast(Business, SimpleNamespace(**defaults))


def _fake_campaign(**overrides: object) -> Campaign:
    defaults: dict[str, object] = {
        "id": "camp-1",
        "name": "Custom Colombian Emerald Ring",
        "objective": "SALES",
    }
    defaults.update(overrides)
    return cast(Campaign, SimpleNamespace(**defaults))


def _fake_ad_set(**overrides: object) -> AdSet:
    defaults: dict[str, object] = {"budget": 50.0}
    defaults.update(overrides)
    return cast(AdSet, SimpleNamespace(**defaults))


def _fake_metric(**overrides: object) -> Metric:
    defaults: dict[str, object] = {
        "id": f"metric-{id(overrides)}",
        "fetchedAt": _NOW,
        "impressions": 1000,
        "clicks": 50,
        "spend": 12.5,
        "conversions": 8,
    }
    defaults.update(overrides)
    return cast(Metric, SimpleNamespace(**defaults))


def _mock_client_returning(
    monkeypatch: pytest.MonkeyPatch, content: list[SimpleNamespace]
) -> AsyncMock:
    """Patch AsyncAnthropic to return a canned response, return the create mock."""
    create = AsyncMock(return_value=SimpleNamespace(content=content))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(optimizer, "AsyncAnthropic", lambda **_kwargs: fake_client)
    return create


@pytest.fixture
def anthropic_api_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Set a fake ANTHROPIC_API_KEY for the duration of a test."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --- _derive_metrics -------------------------------------------------------


def test_derive_metrics_computes_the_six_ratios() -> None:
    """CTR/CPC/CPM/CPL/conversion rate/ROAS all compute correctly from raw counts."""
    derived = optimizer._derive_metrics(
        impressions=1000, clicks=50, spend=25.0, conversions=5, product_price=100.0
    )

    assert derived.ctr == pytest.approx(0.05)
    assert derived.cpc == pytest.approx(0.5)
    assert derived.cpm == pytest.approx(25.0)
    assert derived.cpl == pytest.approx(5.0)
    assert derived.conversion_rate == pytest.approx(0.1)
    # revenue = 5 conversions * $100 = $500; ROAS = 500 / 25 = 20x
    assert derived.roas == pytest.approx(20.0)


def test_derive_metrics_returns_none_for_zero_denominators() -> None:
    """No impressions/clicks/conversions yet gives None, not a ZeroDivisionError."""
    derived = optimizer._derive_metrics(
        impressions=0, clicks=0, spend=0.0, conversions=0, product_price=100.0
    )

    assert derived == optimizer.DerivedMetrics(
        ctr=None, cpc=None, cpm=None, cpl=None, roas=None, conversion_rate=None
    )


def test_derive_metrics_roas_is_none_without_a_product_price() -> None:
    """No product price to approximate revenue from means no ROAS, not a guess."""
    derived = optimizer._derive_metrics(
        impressions=1000, clicks=50, spend=12.5, conversions=8, product_price=None
    )

    assert derived.roas is None


# --- nearest_metric_at_or_before / compute_trend_windows -------------------


def test_nearest_metric_at_or_before_finds_the_latest_qualifying_snapshot() -> None:
    """The closest snapshot at-or-before the cutoff wins, not the earliest."""
    metrics = [
        _fake_metric(id="a", fetchedAt=_NOW - timedelta(days=2)),
        _fake_metric(id="b", fetchedAt=_NOW - timedelta(days=1)),
        _fake_metric(id="c", fetchedAt=_NOW),
    ]

    result = optimizer.nearest_metric_at_or_before(metrics, _NOW - timedelta(hours=12))

    assert result is not None
    assert result.id == "b"


def test_nearest_metric_at_or_before_returns_none_when_nothing_qualifies() -> None:
    """No snapshot old enough for the cutoff returns None, not the earliest anyway."""
    metrics = [_fake_metric(id="a", fetchedAt=_NOW)]

    result = optimizer.nearest_metric_at_or_before(metrics, _NOW - timedelta(days=1))

    assert result is None


def test_compute_trend_windows_computes_deltas_not_cumulative_totals() -> None:
    """A window's numbers are the delta since its baseline, not the latest
    snapshot's raw lifetime-to-date total."""
    metrics = [
        _fake_metric(
            id="baseline",
            fetchedAt=_NOW - timedelta(hours=25),
            impressions=1000,
            clicks=50,
            spend=10.0,
            conversions=2,
        ),
        _fake_metric(
            id="latest",
            fetchedAt=_NOW,
            impressions=1800,
            clicks=90,
            spend=22.0,
            conversions=5,
        ),
    ]

    windows = optimizer.compute_trend_windows(metrics, product_price=None, now=_NOW)

    day_window = next(w for w in windows if w.label == "24h")
    assert day_window.impressions == 800
    assert day_window.clicks == 40
    assert day_window.spend == pytest.approx(12.0)
    assert day_window.conversions == 3


def test_compute_trend_windows_skips_windows_with_no_baseline() -> None:
    """A campaign live for under 3 days has no real 3d/7d window yet."""
    metrics = [
        _fake_metric(id="a", fetchedAt=_NOW - timedelta(hours=25)),
        _fake_metric(id="b", fetchedAt=_NOW),
    ]

    windows = optimizer.compute_trend_windows(metrics, product_price=None, now=_NOW)

    labels = {w.label for w in windows}
    assert labels == {"24h"}


def test_compute_trend_windows_returns_empty_for_no_metrics() -> None:
    """No history at all means no windows, not a crash."""
    assert optimizer.compute_trend_windows([], product_price=None, now=_NOW) == []


# --- has_sufficient_data ----------------------------------------------------


def test_has_sufficient_data_requires_all_three_conditions() -> None:
    """Time, spend, and clicks must all clear their thresholds."""
    assert optimizer.has_sufficient_data(
        hours_since_last_check=optimizer.MIN_HOURS_BETWEEN_CHECKS,
        delta_spend=optimizer.MIN_SPEND_TO_ANALYZE,
        delta_clicks=optimizer.MIN_CLICKS_TO_ANALYZE,
    )
    assert not optimizer.has_sufficient_data(
        hours_since_last_check=optimizer.MIN_HOURS_BETWEEN_CHECKS - 1,
        delta_spend=optimizer.MIN_SPEND_TO_ANALYZE,
        delta_clicks=optimizer.MIN_CLICKS_TO_ANALYZE,
    )
    assert not optimizer.has_sufficient_data(
        hours_since_last_check=optimizer.MIN_HOURS_BETWEEN_CHECKS,
        delta_spend=optimizer.MIN_SPEND_TO_ANALYZE - 1,
        delta_clicks=optimizer.MIN_CLICKS_TO_ANALYZE,
    )
    assert not optimizer.has_sufficient_data(
        hours_since_last_check=optimizer.MIN_HOURS_BETWEEN_CHECKS,
        delta_spend=optimizer.MIN_SPEND_TO_ANALYZE,
        delta_clicks=optimizer.MIN_CLICKS_TO_ANALYZE - 1,
    )


def test_has_sufficient_data_treats_never_checked_as_time_satisfied() -> None:
    """float("inf") (never checked before) always satisfies the time leg —
    the spend/click legs still have to hold on their own."""
    assert optimizer.has_sufficient_data(
        hours_since_last_check=float("inf"),
        delta_spend=optimizer.MIN_SPEND_TO_ANALYZE,
        delta_clicks=optimizer.MIN_CLICKS_TO_ANALYZE,
    )
    assert not optimizer.has_sufficient_data(
        hours_since_last_check=float("inf"), delta_spend=0, delta_clicks=0
    )


# --- apply_budget_guardrail / compute_requires_approval ---------------------


def test_apply_budget_guardrail_caps_an_excessive_increase() -> None:
    """A suggestion beyond +20% is capped, not passed through raw."""
    capped = optimizer.apply_budget_guardrail(
        current_budget=50.0, suggested_budget=100.0
    )

    assert capped == pytest.approx(60.0)


def test_apply_budget_guardrail_caps_an_excessive_decrease() -> None:
    """A suggestion beyond -20% is capped too — the guardrail is symmetric."""
    capped = optimizer.apply_budget_guardrail(
        current_budget=50.0, suggested_budget=10.0
    )

    assert capped == pytest.approx(40.0)


def test_apply_budget_guardrail_passes_through_a_suggestion_within_range() -> None:
    """A suggestion already within +/-20% is left untouched."""
    capped = optimizer.apply_budget_guardrail(
        current_budget=50.0, suggested_budget=55.0
    )

    assert capped == pytest.approx(55.0)


def test_compute_requires_approval_auto_applies_a_confident_low_risk_change() -> None:
    """LOW risk + confidence >= the threshold, on a budget action, skips the click."""
    assert not optimizer.compute_requires_approval(
        action_type="INCREASE_BUDGET",
        risk="LOW",
        confidence=optimizer.AUTO_APPLY_CONFIDENCE_THRESHOLD,
        capped_by_guardrail=False,
    )
    assert not optimizer.compute_requires_approval(
        action_type="DECREASE_BUDGET",
        risk="LOW",
        confidence=0.99,
        capped_by_guardrail=False,
    )


def test_compute_requires_approval_high_risk_is_always_a_mandatory_checkpoint() -> None:
    """HIGH risk requires approval no matter how confident the model is."""
    assert optimizer.compute_requires_approval(
        action_type="INCREASE_BUDGET",
        risk="HIGH",
        confidence=0.99,
        capped_by_guardrail=False,
    )


def test_compute_requires_approval_medium_risk_always_requires_approval() -> None:
    """MEDIUM risk never auto-applies, regardless of confidence."""
    assert optimizer.compute_requires_approval(
        action_type="INCREASE_BUDGET",
        risk="MEDIUM",
        confidence=0.99,
        capped_by_guardrail=False,
    )


def test_compute_requires_approval_below_the_confidence_cutoff_requires_approval() -> (
    None
):
    """LOW risk below the confidence cutoff still needs a human click."""
    assert optimizer.compute_requires_approval(
        action_type="INCREASE_BUDGET",
        risk="LOW",
        confidence=optimizer.AUTO_APPLY_CONFIDENCE_THRESHOLD - 0.01,
        capped_by_guardrail=False,
    )


def test_compute_requires_approval_pause_ad_is_never_auto_apply_eligible() -> None:
    """Auto-apply is scoped to budget actions — PAUSE_AD always requires approval."""
    assert optimizer.compute_requires_approval(
        action_type="PAUSE_AD", risk="LOW", confidence=0.99, capped_by_guardrail=False
    )


def test_compute_requires_approval_a_capped_suggestion_requires_approval() -> None:
    """A suggestion the guardrail had to rein in disqualifies auto-apply on its own."""
    assert optimizer.compute_requires_approval(
        action_type="INCREASE_BUDGET",
        risk="LOW",
        confidence=0.99,
        capped_by_guardrail=True,
    )


# --- _build_prompt -----------------------------------------------------------


def test_build_prompt_includes_budget_and_window_ratios() -> None:
    """The prompt includes the current budget and each window's derived ratios."""
    windows = optimizer.compute_trend_windows(
        [
            _fake_metric(id="a", fetchedAt=_NOW - timedelta(hours=25)),
            _fake_metric(
                id="b", fetchedAt=_NOW, impressions=2000, clicks=100, conversions=16
            ),
        ],
        product_price=100.0,
        now=_NOW,
    )

    prompt = optimizer._build_prompt(
        _fake_business(), _fake_campaign(), _fake_ad_set(), windows
    )

    assert "Acme Jewelry" in prompt
    assert "Custom Colombian Emerald Ring" in prompt
    assert "SALES" in prompt
    assert "$50.0" in prompt
    assert "Last 24h" in prompt
    assert "CTR:" in prompt
    assert "CPC:" in prompt
    assert "CPM:" in prompt
    assert "CPL:" in prompt
    assert "Conversion rate:" in prompt
    assert "ROAS:" in prompt


# --- generate_recommendation -------------------------------------------------


@pytest.mark.asyncio
async def test_generate_recommendation_raises_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ANTHROPIC_API_KEY configured raises a clear error, not a crash."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    get_settings.cache_clear()

    with pytest.raises(optimizer.OptimizerError, match="not configured"):
        await optimizer.generate_recommendation(
            business=_fake_business(),
            campaign=_fake_campaign(),
            ad_set=_fake_ad_set(),
            windows=[],
        )

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_generate_recommendation_returns_the_parsed_and_capped_recommendation(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid tool-use response is parsed, and its budget suggestion
    guardrail-capped (60 from a $50 base is exactly +20%, right at the cap)."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]
    )

    result = await optimizer.generate_recommendation(
        business=_fake_business(),
        campaign=_fake_campaign(),
        ad_set=_fake_ad_set(budget=50.0),
        windows=[],
    )

    assert result.recommendation.action_type == "INCREASE_BUDGET"
    assert result.recommendation.confidence == 0.91
    assert result.recommendation.risk == "MEDIUM"
    assert result.recommendation.suggested_budget == pytest.approx(60.0)
    # 60 from a $50 base is exactly the +20% cap, not beyond it.
    assert result.capped_by_guardrail is False


@pytest.mark.asyncio
async def test_generate_recommendation_actually_caps_an_excessive_suggestion(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A raw suggestion beyond the guardrail is capped before it's ever returned."""
    _mock_client_returning(
        monkeypatch,
        [
            SimpleNamespace(
                type="tool_use", input={**_VALID_TOOL_INPUT, "suggestedBudget": 200.0}
            )
        ],
    )

    result = await optimizer.generate_recommendation(
        business=_fake_business(),
        campaign=_fake_campaign(),
        ad_set=_fake_ad_set(budget=50.0),
        windows=[],
    )

    assert result.recommendation.suggested_budget == pytest.approx(60.0)
    assert result.capped_by_guardrail is True


@pytest.mark.asyncio
async def test_generate_recommendation_pause_ad_is_never_capped_by_guardrail(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A PAUSE_AD recommendation has no suggested_budget, so nothing to cap."""
    _mock_client_returning(
        monkeypatch,
        [
            SimpleNamespace(
                type="tool_use",
                input={
                    **_VALID_TOOL_INPUT,
                    "actionType": "PAUSE_AD",
                    "suggestedBudget": None,
                },
            )
        ],
    )

    result = await optimizer.generate_recommendation(
        business=_fake_business(),
        campaign=_fake_campaign(),
        ad_set=_fake_ad_set(budget=50.0),
        windows=[],
    )

    assert result.recommendation.suggested_budget is None
    assert result.capped_by_guardrail is False


@pytest.mark.asyncio
async def test_generate_recommendation_raises_on_api_error(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An Anthropic API failure surfaces as OptimizerError, not a raw exception."""
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    create = AsyncMock(side_effect=anthropic.APIConnectionError(request=request))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(optimizer, "AsyncAnthropic", lambda **_kwargs: fake_client)

    with pytest.raises(optimizer.OptimizerError, match="Anthropic API call failed"):
        await optimizer.generate_recommendation(
            business=_fake_business(),
            campaign=_fake_campaign(),
            ad_set=_fake_ad_set(),
            windows=[],
        )


@pytest.mark.asyncio
async def test_generate_recommendation_raises_when_no_tool_call_returned(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the model responds with text instead of the forced tool call, that's
    a clear OptimizerError, not a silent bad result."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="text", text="I have thoughts...")]
    )

    with pytest.raises(optimizer.OptimizerError, match="did not return a tool call"):
        await optimizer.generate_recommendation(
            business=_fake_business(),
            campaign=_fake_campaign(),
            ad_set=_fake_ad_set(),
            windows=[],
        )


@pytest.mark.asyncio
async def test_generate_recommendation_raises_on_malformed_tool_input(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A tool call missing required fields fails validation clearly rather
    than silently storing garbage."""
    _mock_client_returning(
        monkeypatch,
        [SimpleNamespace(type="tool_use", input={"actionType": "DELETE_EVERYTHING"})],
    )

    with pytest.raises(Exception, match="validation error"):
        await optimizer.generate_recommendation(
            business=_fake_business(),
            campaign=_fake_campaign(),
            ad_set=_fake_ad_set(),
            windows=[],
        )
