"""Tests for the research cost estimate (Phase 7a)."""

import pytest
from app.schemas.research import Depth
from app.services.llm_call import SEARCH_FEE_USD, ModelPrice, price_for
from app.services.research_cost import (
    DEPTH_CAPS,
    INPUTS,
    estimate_cost,
    price_tokens,
)

MODELS = ("claude-opus-5-5", "claude-fable-5-1")


def test_the_phase_1_5_smoke_test_is_reproduced_by_the_pricing_function() -> None:
    """Phase A of the measured smoke test cost $0.1859 on Fable 5.1 (one search)."""
    cost = price_tokens(
        "claude-fable-5-1",
        fresh=6,
        cache_write=12_080,
        cache_read=4_638,
        output=474,
        searches=1,
    )
    assert cost == pytest.approx(0.1859, abs=0.0005)
    phase_b = price_tokens(
        "claude-fable-5-1", fresh=4, cache_write=182, cache_read=4_520, output=219
    )
    assert phase_b == pytest.approx(0.0144, abs=0.0005)


def test_each_input_says_whether_it_was_measured_or_is_an_estimate() -> None:
    measured = {i.name for i in INPUTS if i.measured}
    estimated = {i.name for i in INPUTS if not i.measured}
    assert {"search_result_tokens", "search_fee_usd"} <= measured
    assert {
        "fetched_page_tokens",
        "iterations_per_tool_call",
        "thinking_tokens_per_phase",
        "submit_output_tokens",
    } <= estimated
    assert next(i for i in INPUTS if i.name == "search_result_tokens").value == 6_500
    assert next(i for i in INPUTS if i.name == "search_fee_usd").value == SEARCH_FEE_USD


@pytest.mark.parametrize("model", MODELS)
def test_deeper_runs_cost_more_and_have_larger_caps(model: str) -> None:
    light, standard, deep = (
        estimate_cost(d, model, prompt_tokens=4_000)
        for d in ("light", "standard", "deep")
    )
    assert light.expected_usd < standard.expected_usd < deep.expected_usd
    assert light.max_usd < standard.max_usd < deep.max_usd
    assert (
        DEPTH_CAPS["light"].max_searches
        < DEPTH_CAPS["standard"].max_searches
        < DEPTH_CAPS["deep"].max_searches
    )


@pytest.mark.parametrize("depth", ["light", "standard", "deep"])
def test_fable_costs_more_than_opus(depth: Depth) -> None:
    opus = estimate_cost(depth, "claude-opus-5-5", prompt_tokens=4_000)
    fable = estimate_cost(depth, "claude-fable-5-1", prompt_tokens=4_000)
    assert fable.expected_usd > opus.expected_usd


def test_expected_is_below_max_and_max_includes_the_full_search_fee() -> None:
    estimate = estimate_cost("standard", "claude-opus-5-5", prompt_tokens=4_000)
    assert 0 < estimate.expected_usd < estimate.max_usd
    assert estimate.max_usd >= DEPTH_CAPS["standard"].max_searches * SEARCH_FEE_USD
    assert estimate.max_searches == DEPTH_CAPS["standard"].max_searches
    assert estimate.max_fetches == DEPTH_CAPS["standard"].max_fetches
    assert estimate.suggested_max_cost_usd >= estimate.max_usd


def test_a_longer_prompt_costs_more() -> None:
    short = estimate_cost("light", "claude-opus-5-5", prompt_tokens=2_000)
    long = estimate_cost("light", "claude-opus-5-5", prompt_tokens=9_000)
    assert long.expected_usd > short.expected_usd


def test_the_estimate_lists_its_inputs_with_the_measured_flag() -> None:
    estimate = estimate_cost("light", "claude-opus-5-5", prompt_tokens=4_000)
    by_name = {a.name: a for a in estimate.assumptions}
    assert by_name["search_result_tokens"].measured is True
    assert by_name["fetched_page_tokens"].measured is False


def test_an_unpriced_model_is_refused_not_treated_as_free() -> None:
    with pytest.raises(ValueError, match="No price known"):
        estimate_cost("light", "claude-made-up", prompt_tokens=4_000)


def test_price_table_is_the_one_the_agents_use() -> None:
    assert isinstance(price_for("claude-opus-5-5"), ModelPrice)
