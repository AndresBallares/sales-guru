"""Tests for the CREATIVE_TEST_PLAN plan type (PRD.md §5 step 5, Stage 1).

A CREATIVE_TEST_PLAN is the cold-start plan for a SALES campaign: one
prospecting ad set on a broad Advantage+ audience, with the creative angle
as the test variable. The old audience-vs-audience TEST_PLAN is untouched
(see test_strategist_service.py / test_strategy.py).
"""

from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.core.config import get_settings
from app.schemas.strategy import (
    AudienceConstraints,
    CreativeTestPlanContent,
    NormalizedMetrics,
    StrategyContentAdapter,
    UnitEconomicsFields,
    daily_budget,
    primary_audience,
)
from app.services import optimizer, strategist
from app.services.benchmarks import JEWELRY_META_BENCHMARKS
from prisma.models import Business, Product
from pydantic import ValidationError

_VALID_INPUT: dict[str, Any] = {
    "creative_persona": {
        "name": "Milestone gift buyers",
        "description": "Women 30-55 buying a meaningful piece for themselves.",
        "problem": "Hard to find a ring that feels personal",
        "desire": "Own something unique",
    },
    "hypothesis_statement": (
        "The on-skin angle will produce the lowest cost per add-to-cart."
    ),
    "offer": "Custom emerald rings",
    "positioning": "Premium and personal",
    "creative_angles": [
        "Product on skin",
        "Social proof",
        "Gifting",
        "Collection carousel",
    ],
    "copy_strategy": "Lead with the story behind each piece",
}


def _business() -> Business:
    return cast(
        Business,
        SimpleNamespace(
            name="Acme Jewelry",
            website=None,
            industry="FASHION_JEWELRY",
            location=None,
            description=None,
        ),
    )


def _product(**overrides: object) -> Product:
    defaults: dict[str, object] = {
        "description": "Custom emerald rings",
        "price": None,
        "margin": None,
        "features": None,
        "benefits": None,
    }
    defaults.update(overrides)
    return cast(Product, SimpleNamespace(**defaults))


def _plan_dict(**overrides: object) -> dict[str, Any]:
    plan: dict[str, Any] = {
        "objective": "SALES",
        "audience_constraints": AudienceConstraints(),
        "creative_persona": _VALID_INPUT["creative_persona"],
        "hypotheses": [
            strategist._build_creative_hypothesis(_VALID_INPUT["hypothesis_statement"])
        ],
        "offer": "Offer",
        "positioning": "Positioning",
        "creative_angles": ["a", "b", "c"],
        "copy_strategy": "Copy",
        "daily_budget": 50.0,
        "duration_days": 10,
        "total_budget": 500.0,
        "optimization_event": "PURCHASE",
        "success_criteria": strategist._build_creative_success_criteria(
            strategist._build_benchmark_context(), None, None
        ),
        "baseline_metrics": NormalizedMetrics(),
        "benchmark_context": strategist._build_benchmark_context(),
    }
    plan.update(overrides)
    return plan


# ── Schema ───────────────────────────────────────────────────


def test_creative_test_plan_validates_and_has_its_own_plan_type() -> None:
    plan = CreativeTestPlanContent.model_validate(_plan_dict())

    assert plan.plan_type == "CREATIVE_TEST_PLAN"
    assert plan.objective == "SALES"


def test_creative_test_plan_is_sales_only() -> None:
    with pytest.raises(ValidationError):
        CreativeTestPlanContent.model_validate(_plan_dict(objective="TRAFFIC"))


@pytest.mark.parametrize("angles", [["a", "b"], ["a", "b", "c", "d", "e"]])
def test_creative_test_plan_needs_three_or_four_angles(angles: list[str]) -> None:
    with pytest.raises(ValidationError):
        CreativeTestPlanContent.model_validate(_plan_dict(creative_angles=angles))


def test_audience_constraints_default_to_the_hard_constraints_only() -> None:
    constraints = AudienceConstraints()

    assert constraints.country == "US"
    assert constraints.age_min == 18
    assert constraints.languages == ["English"]


@pytest.mark.parametrize("age_min", [17, 26])
def test_audience_constraints_age_min_must_be_18_to_25(age_min: int) -> None:
    """Meta only accepts an age_min of 18-25 with Advantage+ audience on, and
    age_max can't be set at all (it is fixed at 65), so there's no age_max."""
    with pytest.raises(ValidationError):
        AudienceConstraints(age_min=age_min)


def test_audience_constraints_have_no_age_max_or_interests() -> None:
    assert "age_max" not in AudienceConstraints.model_fields
    assert "interests" not in AudienceConstraints.model_fields


def test_strategy_content_adapter_routes_by_plan_type() -> None:
    plan = CreativeTestPlanContent.model_validate(_plan_dict())

    round_tripped = StrategyContentAdapter.validate_json(
        plan.model_dump_json(by_alias=True)
    )

    assert isinstance(round_tripped, CreativeTestPlanContent)


def test_normalized_metrics_has_cost_per_add_to_cart_defaulting_to_none() -> None:
    assert NormalizedMetrics().cost_per_add_to_cart is None


def test_primary_audience_of_a_creative_plan_carries_the_persona_text() -> None:
    plan = CreativeTestPlanContent.model_validate(_plan_dict())

    audience = primary_audience(plan)

    assert audience.problem == "Hard to find a ring that feels personal"
    assert audience.desire == "Own something unique"
    assert audience.interests == []


def test_daily_budget_of_a_creative_plan_is_its_single_ad_set_budget() -> None:
    plan = CreativeTestPlanContent.model_validate(_plan_dict(daily_budget=40.0))

    assert daily_budget(plan) == 40.0


# ── Optimization event: decided at creation, never switched ──


def test_choose_optimization_event_uses_add_to_cart_at_or_above_the_threshold() -> None:
    assert strategist._choose_optimization_event(_product(price=500.0), 500.0) == (
        "ADD_TO_CART"
    )
    assert strategist._choose_optimization_event(_product(price=2000.0), 500.0) == (
        "ADD_TO_CART"
    )


def test_choose_optimization_event_uses_purchase_below_the_threshold() -> None:
    assert strategist._choose_optimization_event(_product(price=499.99), 500.0) == (
        "PURCHASE"
    )


def test_choose_optimization_event_uses_purchase_without_a_price() -> None:
    assert strategist._choose_optimization_event(None, 500.0) == "PURCHASE"
    assert strategist._choose_optimization_event(_product(price=None), 500.0) == (
        "PURCHASE"
    )


def test_high_ticket_threshold_is_configurable_with_a_500_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    get_settings.cache_clear()
    assert get_settings().high_ticket_price_threshold == 500.0

    monkeypatch.setenv("HIGH_TICKET_PRICE_THRESHOLD", "250")
    get_settings.cache_clear()
    assert get_settings().high_ticket_price_threshold == 250.0
    get_settings.cache_clear()


def test_target_cost_per_add_to_cart_scales_target_cac_by_the_cart_rate() -> None:
    economics = UnitEconomicsFields(
        gross_profit=400.0, breakeven_cac=400.0, target_cac=200.0, breakeven_roas=2.0
    )

    assert strategist._compute_target_cost_per_add_to_cart(
        economics, add_to_cart_to_purchase_rate=0.15
    ) == pytest.approx(30.0)


def test_target_cost_per_add_to_cart_falls_back_to_the_benchmark_cac() -> None:
    expected = JEWELRY_META_BENCHMARKS.cac.median * 0.15

    assert strategist._compute_target_cost_per_add_to_cart(
        None, add_to_cart_to_purchase_rate=0.15
    ) == pytest.approx(expected)


# ── generate_strategy ────────────────────────────────────────


def _mock_agent(monkeypatch: pytest.MonkeyPatch, raw: dict[str, Any]) -> AsyncMock:
    mock = AsyncMock(return_value=raw)
    monkeypatch.setattr(strategist, "_call_agent", mock)
    return mock


@pytest.mark.asyncio
async def test_generate_strategy_returns_a_creative_test_plan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert result.plan_type == "CREATIVE_TEST_PLAN"
    assert result.creative_angles[0] == "Product on skin"
    assert result.creative_persona.name == "Milestone gift buyers"
    assert result.audience_constraints == AudienceConstraints()
    assert result.baseline_metrics.cost_per_add_to_cart is None


@pytest.mark.asyncio
async def test_creative_test_plan_budget_is_one_ad_set_at_the_full_daily_rate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One ad set, so total budget = daily x days (not x 2 like TEST_PLAN)."""
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert result.daily_budget == 50.0
    assert result.duration_days == 10
    assert result.total_budget == 500.0


@pytest.mark.asyncio
async def test_creative_test_plan_budget_follows_target_cac_within_20_to_75(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(price=1000.0, margin=0.5),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert 20.0 <= result.daily_budget <= 75.0


@pytest.mark.asyncio
async def test_high_ticket_product_optimizes_for_add_to_cart_with_its_own_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(price=2000.0, margin=0.5),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert result.optimization_event == "ADD_TO_CART"
    assert result.target_cost_per_add_to_cart is not None
    assert result.unit_economics is not None
    assert result.target_cost_per_add_to_cart < result.unit_economics.target_cac


@pytest.mark.asyncio
async def test_low_ticket_product_optimizes_for_purchase_with_no_cart_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(price=80.0, margin=0.5),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert result.optimization_event == "PURCHASE"
    assert result.target_cost_per_add_to_cart is None


@pytest.mark.asyncio
async def test_the_hypothesis_is_about_the_creative_angle_not_the_audience(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    hypothesis = result.hypotheses[0]
    assert hypothesis.id == "creative_angle"
    assert hypothesis.primary_metric == "cost_per_add_to_cart"
    assert "cac" in hypothesis.secondary_metrics
    assert "conversion_rate" in hypothesis.secondary_metrics


@pytest.mark.asyncio
async def test_success_criteria_lead_with_cost_per_add_to_cart(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(price=2000.0, margin=0.5),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(result, CreativeTestPlanContent)
    leading = [c.metric for c in result.success_criteria.leading_indicators]
    economic = [c.metric for c in result.success_criteria.economic_indicators]
    assert leading[0] == "cost_per_add_to_cart"
    assert "cac" in economic
    target = result.success_criteria.leading_indicators[0].business_target
    assert target == result.target_cost_per_add_to_cart
    # Benchmarks and business targets stay separate (no blended number).
    assert result.success_criteria.leading_indicators[0].benchmark is None


@pytest.mark.asyncio
async def test_creative_test_plan_prompt_makes_creative_the_test_variable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock = _mock_agent(monkeypatch, _VALID_INPUT)

    await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    prompt = mock.call_args.kwargs["prompt"]
    assert "one ad set" in prompt
    assert "creative" in prompt
    assert "not used for targeting" in prompt
    assert "3 or 4" in prompt


@pytest.mark.asyncio
async def test_creative_test_plan_rejects_a_non_sales_objective(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    with pytest.raises(strategist.StrategistError):
        await strategist.generate_strategy(
            business=_business(),
            product=_product(),
            audience=None,
            objective="TRAFFIC",
            plan_type="CREATIVE_TEST_PLAN",
        )


@pytest.mark.asyncio
async def test_generate_strategy_returns_a_fake_creative_plan_in_fake_llm_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_LLM", "true")
    get_settings.cache_clear()
    try:
        result = await strategist.generate_strategy(
            business=_business(),
            product=_product(),
            audience=None,
            objective="SALES",
            plan_type="CREATIVE_TEST_PLAN",
        )
    finally:
        get_settings.cache_clear()

    assert isinstance(result, CreativeTestPlanContent)
    assert len(result.creative_angles) >= 3


# ── Per-business languages, the 0.10 rate, and the delivery check ──


def test_add_to_cart_to_purchase_rate_defaults_to_ten_percent() -> None:
    get_settings.cache_clear()

    assert get_settings().add_to_cart_to_purchase_rate == 0.10


def _brand_profile(ad_languages: str | None) -> Any:
    return SimpleNamespace(
        description="d",
        idealCustomer="i",
        voiceTraits='["WARM"]',
        brandPhrases=None,
        avoidPhrases=None,
        pricePositioning="PREMIUM",
        tagline=None,
        competitors=None,
        exampleCopy=None,
        proofPoints=None,
        offer=None,
        adLanguages=ad_languages,
    )


@pytest.mark.asyncio
async def test_constraints_use_the_brand_profiles_languages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    result = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        brand_profile=_brand_profile('["Spanish", "English"]'),
    )

    assert isinstance(result, CreativeTestPlanContent)
    assert result.audience_constraints.languages == ["Spanish", "English"]


@pytest.mark.asyncio
async def test_constraints_default_to_english_without_a_profile_or_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_agent(monkeypatch, _VALID_INPUT)

    no_profile = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )
    no_override = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        brand_profile=_brand_profile(None),
    )

    assert isinstance(no_profile, CreativeTestPlanContent)
    assert isinstance(no_override, CreativeTestPlanContent)
    assert no_profile.audience_constraints.languages == ["English"]
    assert no_override.audience_constraints.languages == ["English"]


def test_cost_cap_may_be_too_tight_when_spend_is_under_half_the_budget() -> None:
    # 3 days at $50/day = $150 expected; half is $75.
    assert optimizer.cost_cap_may_be_too_tight(spend=74.99, daily_budget=50.0) is True


def test_cost_cap_is_fine_at_or_above_half_the_expected_spend() -> None:
    assert optimizer.cost_cap_may_be_too_tight(spend=75.0, daily_budget=50.0) is False
    assert optimizer.cost_cap_may_be_too_tight(spend=140.0, daily_budget=50.0) is False


# ── V1 is single-image only: no carousel angles ──


@pytest.mark.asyncio
async def test_creative_test_plan_prompt_does_not_suggest_a_carousel_angle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every ad in the test is a single image, so the strategist must not be
    nudged toward a carousel angle (it once produced "collection carousel",
    and the Creative Agent then returned a mixed batch)."""
    mock = _mock_agent(monkeypatch, _VALID_INPUT)

    await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    prompt = mock.call_args.kwargs["prompt"]
    assert "a collection carousel" not in prompt
    assert "single static image" in prompt
    assert "don't propose carousels" in prompt


# ── Test format: Images or Videos, chosen up front ──


def test_a_creative_test_plan_defaults_to_single_image_ads() -> None:
    assert CreativeTestPlanContent(**_plan_dict()).creative_format == "SINGLE_IMAGE"


def test_a_creative_test_plan_can_be_a_video_test() -> None:
    plan = CreativeTestPlanContent(**_plan_dict(creative_format="SINGLE_VIDEO"))

    assert plan.creative_format == "SINGLE_VIDEO"


def test_a_creative_test_plan_cannot_be_a_carousel_test() -> None:
    with pytest.raises(ValidationError):
        CreativeTestPlanContent(**_plan_dict(creative_format="CAROUSEL"))


@pytest.mark.asyncio
async def test_a_video_test_plan_records_its_format_and_prompts_for_video(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock = _mock_agent(monkeypatch, _VALID_INPUT)

    plan = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
        creative_format="SINGLE_VIDEO",
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert plan.creative_format == "SINGLE_VIDEO"
    prompt = mock.call_args.kwargs["prompt"]
    assert "short video" in prompt
    assert "may reuse the same video" in prompt
    assert "single static image" not in prompt
    assert "don't propose carousels" in prompt  # still no mixing formats


@pytest.mark.asyncio
async def test_an_image_test_plan_is_unchanged_and_says_single_image(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    mock = _mock_agent(monkeypatch, _VALID_INPUT)

    plan = await strategist.generate_strategy(
        business=_business(),
        product=_product(),
        audience=None,
        objective="SALES",
        plan_type="CREATIVE_TEST_PLAN",
    )

    assert isinstance(plan, CreativeTestPlanContent)
    assert plan.creative_format == "SINGLE_IMAGE"
    assert "single static image" in mock.call_args.kwargs["prompt"]
