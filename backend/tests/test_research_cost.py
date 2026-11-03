"""Tests for the research cost estimate (Phase 7a)."""

import pytest
from app.schemas.research import Depth
from app.services.llm_call import SEARCH_FEE_USD, ModelPrice, price_for
from app.services.research_cost import (
    DEPTH_CAPS,
    INPUTS,
    estimate_cost,
    estimate_tokens,
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


# Smoke run 2 (docs/phase-7.md): claude-opus-5-5, light caps all used (6 searches,
# 8 fetches), two requests, template v2, VENZI dev data. A prompt of about 4,500
# tokens is assumed (the run's exact size was not recorded).
RUN2 = {"fresh": 52, "write": 54_856, "read": 684_355, "output": 26_571}
RUN2_COST = 1.0028
RUN2_PROMPT_TOKENS = 4_500


def test_smoke_run_2_is_reproduced_by_the_pricing_function() -> None:
    cost = price_tokens(
        "claude-opus-5-5",
        fresh=RUN2["fresh"],
        cache_write=RUN2["write"],
        cache_read=RUN2["read"],
        output=RUN2["output"],
        searches=6,
    )
    assert cost == pytest.approx(RUN2_COST, abs=0.0005)


def test_a_full_light_run_is_estimated_within_15_percent_of_smoke_run_2() -> None:
    estimate = estimate_cost(
        "light", "claude-opus-5-5", prompt_tokens=RUN2_PROMPT_TOKENS
    )
    assert estimate.max_usd == pytest.approx(RUN2_COST, rel=0.15)
    mix = estimate_tokens(
        prompt_tokens=RUN2_PROMPT_TOKENS,
        searches=DEPTH_CAPS["light"].max_searches,
        fetches=DEPTH_CAPS["light"].max_fetches,
    )
    assert mix.cache_write == pytest.approx(RUN2["write"], rel=0.15)
    assert mix.cache_read == pytest.approx(RUN2["read"], rel=0.15)
    assert mix.output == pytest.approx(RUN2["output"], rel=0.15)


def test_each_input_says_whether_it_was_measured_or_is_an_estimate() -> None:
    by_name = {i.name: i for i in INPUTS}
    assert by_name["search_fee_usd"].measured is True
    assert by_name["search_fee_usd"].value == SEARCH_FEE_USD
    assert by_name["avatars_output_tokens"].measured is True
    for name in (
        "search_result_tokens",
        "fetched_page_tokens",
        "iterations_per_tool_call",
        "output_tokens_per_tool_call",
        "findings_output_tokens",
    ):
        assert by_name[name].measured is False
        assert "run 2" in by_name[name].note.lower()


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
    assert by_name["search_fee_usd"].measured is True
    assert by_name["fetched_page_tokens"].measured is False


def test_an_unpriced_model_is_refused_not_treated_as_free() -> None:
    with pytest.raises(ValueError, match="No price known"):
        estimate_cost("light", "claude-made-up", prompt_tokens=4_000)


def test_price_table_is_the_one_the_agents_use() -> None:
    assert isinstance(price_for("claude-opus-5-5"), ModelPrice)
