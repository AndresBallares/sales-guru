"""Tests for scripts/compare_optimizer_models.py.

The script is inert without --run, and none of these tests makes a real API
call: the client is replaced everywhere it could be reached.
"""

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import anthropic
import httpx
import pytest
from app.core.config import get_settings
from app.services import optimizer
from app.services.optimizer import RecommendationResult


def _load_script() -> ModuleType:
    path = (
        Path(__file__).resolve().parent.parent
        / "scripts"
        / "compare_optimizer_models.py"
    )
    spec = importlib.util.spec_from_file_location("compare_optimizer_models", path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules["compare_optimizer_models"] = module
    spec.loader.exec_module(module)
    return module


cmp = _load_script()


def _outcome(**overrides: Any) -> Any:
    fields: dict[str, Any] = {
        "action_type": "INCREASE_BUDGET",
        "risk": "LOW",
        "confidence": 0.9,
        "suggested_budget": 60.0,
        "target_ad_id": None,
        "requires_approval": False,
    }
    fields.update(overrides)
    return cmp.Outcome(**fields)


def _result(**overrides: Any) -> RecommendationResult:
    rec: dict[str, Any] = {
        "action_type": "INCREASE_BUDGET",
        "reasoning": "r",
        "confidence": 0.9,
        "risk": "LOW",
        "suggested_budget": 60.0,
        "target_ad_id": None,
    }
    capped = overrides.pop("capped", False)
    rec.update(overrides)
    return RecommendationResult(
        recommendation=cast(Any, SimpleNamespace(**rec)),
        capped_by_guardrail=capped,
    )


# ---------- scenarios ----------


def test_there_are_ten_distinct_scenarios() -> None:
    names = [s.name for s in cmp.SCENARIOS]

    assert len(names) == 10
    assert len(set(names)) == 10


def test_every_scenario_builds_windows_the_agent_can_read() -> None:
    for scenario in cmp.SCENARIOS:
        windows = cmp.build_windows(scenario)

        assert windows
        assert windows[0].label == scenario.windows[0][0]
        assert windows[0].derived.ctr is not None


def test_only_the_creative_test_scenario_has_competing_ads() -> None:
    with_ads = [s for s in cmp.SCENARIOS if cmp.build_ads(s) is not None]

    assert [s.name for s in with_ads] == ["creative test: one ad clearly worst"]
    ads = cmp.build_ads(with_ads[0])
    assert len(ads) == 4
    assert ads[3].cost_per_add_to_cart == 86.0  # 86 spend / 1 add-to-cart


def test_an_ad_with_no_add_to_cart_has_no_cost_per_add_to_cart() -> None:
    scenario = cmp.Scenario("x", 10.0, (), ads=(("a", "A", 5.0, 3, 0),))

    assert cmp.build_ads(scenario)[0].cost_per_add_to_cart is None


# ---------- comparison ----------


def test_outcome_of_applies_the_apps_own_auto_apply_rule() -> None:
    auto = cmp.outcome_of(_result())
    capped = cmp.outcome_of(_result(capped=True))
    pause = cmp.outcome_of(_result(action_type="PAUSE_AD", suggested_budget=None))

    assert auto.requires_approval is False
    assert capped.requires_approval is True
    assert pause.requires_approval is True


def test_identical_outcomes_agree_on_everything() -> None:
    c = cmp.Comparison("s", _outcome(), _outcome())

    assert c.same_action and c.same_risk and c.same_auto_apply
    assert c.same_target_ad and c.budget_close
    assert c.confidence_delta == 0
    assert c.riskier_than_baseline is False


def test_budget_agreement_uses_a_five_percent_tolerance() -> None:
    near = cmp.Comparison("s", _outcome(), _outcome(suggested_budget=62.5))
    far = cmp.Comparison("s", _outcome(), _outcome(suggested_budget=70.0))

    assert near.budget_close is True
    assert far.budget_close is False


def test_budgets_agree_when_neither_suggests_one_but_not_when_only_one_does() -> None:
    none = _outcome(suggested_budget=None)

    assert cmp.Comparison("s", none, none).budget_close is True
    assert cmp.Comparison("s", none, _outcome()).budget_close is False
    assert cmp.Comparison("s", _outcome(), none).budget_close is False


def test_a_candidate_that_auto_applies_what_the_baseline_gated_is_riskier() -> None:
    baseline = _outcome(requires_approval=True)
    candidate = _outcome(requires_approval=False)

    assert cmp.Comparison("s", baseline, candidate).riskier_than_baseline is True
    # The reverse (candidate more cautious) is a difference, not a risk.
    assert cmp.Comparison("s", candidate, baseline).riskier_than_baseline is False


def test_confidence_delta_is_candidate_minus_baseline() -> None:
    c = cmp.Comparison("s", _outcome(confidence=0.9), _outcome(confidence=0.7))

    assert c.confidence_delta == pytest.approx(-0.2)


# ---------- summary and verdict ----------


def _run_of(agree: int, total: int = 10, **candidate: Any) -> list[Any]:
    return [
        cmp.Comparison(
            f"s{i}",
            _outcome(),
            _outcome(
                **({"action_type": "PAUSE_AD"} if i >= agree else {}), **candidate
            ),
        )
        for i in range(total)
    ]


def test_nine_of_ten_matching_actions_meets_the_suggested_bar() -> None:
    summary = cmp.summarize(_run_of(9))

    assert summary["same_action"] == 9
    assert summary["suggest_switch"] is True


def test_eight_of_ten_matching_actions_misses_the_bar() -> None:
    assert cmp.summarize(_run_of(8))["suggest_switch"] is False


def test_any_riskier_scenario_blocks_the_suggestion_even_at_ten_of_ten() -> None:
    comparisons = _run_of(10)
    comparisons[4] = cmp.Comparison(
        "risky", _outcome(requires_approval=True), _outcome(requires_approval=False)
    )

    summary = cmp.summarize(comparisons)

    assert summary["riskier"] == ["risky"]
    assert summary["suggest_switch"] is False


def test_an_empty_run_never_suggests_switching() -> None:
    summary = cmp.summarize([])

    assert summary["total"] == 0
    assert summary["mean_confidence_delta"] == 0.0
    assert summary["suggest_switch"] is False


def test_the_cost_estimate_is_far_lower_for_the_candidate() -> None:
    assert cmp.estimate_cost("claude-haiku-5-5", 10) < cmp.estimate_cost(
        "claude-sonnet-5", 10
    )
    assert cmp.estimate_cost("some-unknown-model", 1) == cmp.estimate_cost(
        "claude-sonnet-5", 1
    )


# ---------- inert by default ----------


def test_without_run_it_prints_a_plan_and_calls_nothing(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def _forbidden(**_kwargs: Any) -> None:
        raise AssertionError("a client was constructed without --run")

    monkeypatch.setattr(cmp, "AsyncAnthropic", _forbidden)
    monkeypatch.setattr(sys, "argv", ["compare_optimizer_models.py"])

    assert cmp.main() == 0

    out = capsys.readouterr().out
    assert "No API calls made" in out
    assert "20 evaluations + 1 forced-tool-use probe" in out
    assert "claude-sonnet-5" in out and "claude-haiku-5-5" in out


def test_the_models_are_overridable_from_the_command_line(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        sys, "argv", ["x", "--baseline", "model-a", "--candidate", "model-b"]
    )

    cmp.main()

    out = capsys.readouterr().out
    assert "Baseline : model-a" in out
    assert "Candidate: model-b" in out


# ---------- forced tool use probe ----------


def _client_with(create: AsyncMock) -> SimpleNamespace:
    return SimpleNamespace(messages=SimpleNamespace(create=create))


@pytest.mark.asyncio
async def test_the_probe_forces_a_tool_call_and_reports_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = AsyncMock(return_value=SimpleNamespace())
    monkeypatch.setattr(cmp, "AsyncAnthropic", lambda **_k: _client_with(create))

    assert await cmp.probe_forced_tool_use("candidate-model") is None

    assert create.await_args is not None
    kwargs = create.await_args.kwargs
    assert kwargs["model"] == "candidate-model"
    assert kwargs["tool_choice"] == {"type": "tool", "name": "ping"}


@pytest.mark.asyncio
async def test_the_probe_returns_the_apis_error_when_forced_tool_use_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    response = httpx.Response(
        400, request=httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    )
    error = anthropic.BadRequestError(
        'tool_choice: type "tool" and "any" are not supported for this model.',
        response=response,
        body=None,
    )
    create = AsyncMock(side_effect=error)
    monkeypatch.setattr(cmp, "AsyncAnthropic", lambda **_k: _client_with(create))

    problem = await cmp.probe_forced_tool_use("candidate-model")

    assert problem is not None
    assert problem.startswith("400:")
    assert "not supported for this model" in problem


# ---------- evaluate / run ----------


@pytest.mark.asyncio
async def test_evaluate_runs_the_apps_agent_on_the_requested_model_then_restores_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seen: list[str] = []

    async def _fake_generate(**kwargs: Any) -> RecommendationResult:
        seen.append(get_settings().optimizer_eval_model)
        assert kwargs["ad_set"].budget == cmp.SCENARIOS[0].budget
        return _result()

    monkeypatch.setattr(optimizer, "generate_recommendation", _fake_generate)
    monkeypatch.delenv("OPTIMIZER_EVAL_MODEL", raising=False)
    get_settings.cache_clear()

    outcome = await cmp.evaluate("candidate-model", cmp.SCENARIOS[0])

    assert seen == ["candidate-model"]
    assert "OPTIMIZER_EVAL_MODEL" not in os.environ
    assert get_settings().optimizer_eval_model == "claude-haiku-5-5"
    assert outcome.action_type == "INCREASE_BUDGET"


@pytest.mark.asyncio
async def test_evaluate_restores_a_preexisting_model_setting_even_when_the_call_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        optimizer, "generate_recommendation", AsyncMock(side_effect=RuntimeError("x"))
    )
    monkeypatch.setenv("OPTIMIZER_EVAL_MODEL", "pre-existing")
    get_settings.cache_clear()

    with pytest.raises(RuntimeError):
        await cmp.evaluate("candidate-model", cmp.SCENARIOS[0])

    assert os.environ["OPTIMIZER_EVAL_MODEL"] == "pre-existing"
    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_run_needs_an_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    get_settings.cache_clear()
    try:
        assert await cmp.run("a", "b", cap=0.5) == 2
    finally:
        get_settings.cache_clear()


@pytest.mark.asyncio
async def test_run_stops_before_any_evaluation_if_forced_tool_use_is_rejected(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    evaluate = AsyncMock()
    monkeypatch.setattr(cmp, "probe_forced_tool_use", AsyncMock(return_value="400: no"))
    monkeypatch.setattr(cmp, "evaluate", evaluate)
    try:
        assert await cmp.run("a", "b", cap=0.5) == 1
    finally:
        get_settings.cache_clear()

    evaluate.assert_not_awaited()
    assert "not a drop-in replacement" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_run_evaluates_every_scenario_on_both_models_and_reports(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    calls: list[str] = []

    async def _evaluate(model: str, scenario: Any, ledger: Any = None) -> Any:
        calls.append(model)
        # The candidate disagrees on one scenario, to exercise the report's
        # mismatch and "riskier" branches.
        if model == "cand" and scenario.name == cmp.SCENARIOS[2].name:
            return _outcome(action_type="PAUSE_AD", requires_approval=False)
        return _outcome(requires_approval=True)

    monkeypatch.setattr(cmp, "probe_forced_tool_use", AsyncMock(return_value=None))
    monkeypatch.setattr(cmp, "evaluate", _evaluate)
    try:
        assert await cmp.run("base", "cand", cap=0.5) == 0
    finally:
        get_settings.cache_clear()

    assert calls.count("base") == 10 and calls.count("cand") == 10
    out = capsys.readouterr().out
    assert "same action     : 9/10" in out
    assert "CANDIDATE AUTO-APPLIES WHAT THE BASELINE WOULD NOT" in out
    assert "does NOT meet it" in out


@pytest.mark.asyncio
async def test_run_reports_meeting_the_bar_when_everything_agrees(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(cmp, "probe_forced_tool_use", AsyncMock(return_value=None))
    monkeypatch.setattr(cmp, "evaluate", AsyncMock(return_value=_outcome()))
    try:
        await cmp.run("base", "cand", cap=0.5)
    finally:
        get_settings.cache_clear()

    out = capsys.readouterr().out
    assert "candidate meets it" in out
    assert "CANDIDATE AUTO-APPLIES" not in out


# ---------- confidence bands ----------


@pytest.mark.parametrize(
    ("confidence", "band"),
    [
        (0.0, "LOW"),
        (0.49, "LOW"),
        (0.5, "MEDIUM"),
        (0.74, "MEDIUM"),
        (0.75, "HIGH"),
        (0.89, "HIGH"),
        (0.9, "AUTO_APPLY"),
        (1.0, "AUTO_APPLY"),
    ],
)
def test_confidence_bands_end_at_the_apps_auto_apply_threshold(
    confidence: float, band: str
) -> None:
    assert cmp.confidence_band(confidence) == band


def test_confidence_agreement_is_about_the_band_not_the_exact_number() -> None:
    near = cmp.Comparison("s", _outcome(confidence=0.80), _outcome(confidence=0.88))
    crossing = cmp.Comparison("s", _outcome(confidence=0.88), _outcome(confidence=0.91))

    assert near.same_confidence_band is True
    assert crossing.same_confidence_band is False


def test_the_summary_counts_confidence_band_agreement() -> None:
    summary = cmp.summarize(_run_of(10))

    assert summary["same_confidence_band"] == 10


# ---------- cost and latency ----------


def _usage(**overrides: Any) -> Any:
    fields: dict[str, Any] = {
        "input_tokens": 1_000_000,
        "output_tokens": 1_000_000,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def test_call_cost_uses_each_models_own_per_million_prices() -> None:
    assert cmp.call_cost("claude-sonnet-5", _usage()) == pytest.approx(12.0)
    assert cmp.call_cost("claude-haiku-5-5", _usage()) == pytest.approx(0.60)


def test_call_cost_prices_cache_writes_and_reads_differently_from_plain_input() -> None:
    usage = _usage(
        input_tokens=0,
        output_tokens=0,
        cache_creation_input_tokens=1_000_000,
        cache_read_input_tokens=1_000_000,
    )

    assert cmp.call_cost("claude-sonnet-5", usage) == pytest.approx(
        2.0 * 1.25 + 2.0 * 0.1
    )


def test_call_cost_treats_missing_counters_as_zero() -> None:
    usage = SimpleNamespace(input_tokens=None, output_tokens=2_000_000)

    assert cmp.call_cost("claude-sonnet-5", usage) == pytest.approx(20.0)


def test_an_unpriced_model_is_costed_at_the_baseline_rate_never_as_free() -> None:
    assert cmp.call_cost("mystery-model", _usage()) == cmp.call_cost(
        "claude-sonnet-5", _usage()
    )


# ---------- the spend cap ----------


def test_the_ledger_adds_up_what_each_call_cost() -> None:
    ledger = cmp.SpendLedger(cap=1.0)

    ledger.record("claude-sonnet-5", _usage(input_tokens=500_000, output_tokens=0), 1.5)
    ledger.record("claude-sonnet-5", _usage(input_tokens=500_000, output_tokens=0), 2.5)

    assert ledger.spent == pytest.approx(2.0)
    assert [c.latency_s for c in ledger.calls] == [1.5, 2.5]


def test_the_ledger_refuses_a_call_that_could_cross_the_cap() -> None:
    ledger = cmp.SpendLedger(cap=0.10, per_call_max=0.03)
    ledger.record(
        "claude-sonnet-5", _usage(input_tokens=0, output_tokens=7_000), 1.0
    )  # $0.07

    ledger.check()  # 0.07 + 0.03 == 0.10, still allowed
    ledger.record(
        "claude-sonnet-5", _usage(input_tokens=0, output_tokens=100), 1.0
    )  # $0.001

    with pytest.raises(cmp.CapReachedError, match="cap"):
        ledger.check()


@pytest.mark.asyncio
async def test_a_patched_client_records_every_call_and_enforces_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from anthropic.resources.messages.messages import AsyncMessages

    response = SimpleNamespace(
        usage=_usage(input_tokens=1000, output_tokens=100), content=[]
    )
    fake = AsyncMock(return_value=response)
    monkeypatch.setattr(AsyncMessages, "create", fake)
    ledger = cmp.SpendLedger(cap=0.05, per_call_max=0.03)

    with ledger.patched():
        await cast(Any, AsyncMessages).create(object(), model="claude-sonnet-5")
        await cast(Any, AsyncMessages).create(object(), model="claude-sonnet-5")

    assert len(ledger.calls) == 2
    assert ledger.calls[0].input_tokens == 1000
    assert ledger.calls[0].output_tokens == 100
    assert ledger.spent == pytest.approx(2 * (1000 * 2 + 100 * 10) / 1e6)
    assert AsyncMessages.create is fake  # restored on exit


@pytest.mark.asyncio
async def test_the_patched_client_stops_before_the_call_that_would_cross_the_cap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from anthropic.resources.messages.messages import AsyncMessages

    fake = AsyncMock()
    monkeypatch.setattr(AsyncMessages, "create", fake)
    ledger = cmp.SpendLedger(cap=0.02, per_call_max=0.03)

    with ledger.patched(), pytest.raises(cmp.CapReachedError):
        await cast(Any, AsyncMessages).create(object(), model="claude-sonnet-5")

    fake.assert_not_awaited()


def test_run_requires_an_explicit_cap(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(sys, "argv", ["x", "--run"])

    assert cmp.main() == 2

    assert "--cap" in capsys.readouterr().err


@pytest.mark.asyncio
async def test_run_stops_and_reports_what_it_has_when_the_cap_is_reached(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    get_settings.cache_clear()
    monkeypatch.setattr(cmp, "probe_forced_tool_use", AsyncMock(return_value=None))
    calls = {"n": 0}

    async def _evaluate(model: str, scenario: Any, ledger: Any = None) -> Any:
        calls["n"] += 1
        if calls["n"] > 4:  # two scenarios done, the third refused
            raise cmp.CapReachedError("cap $0.50 reached")
        return _outcome()

    monkeypatch.setattr(cmp, "evaluate", _evaluate)
    try:
        assert await cmp.run("base", "cand", cap=0.5) == 3
    finally:
        get_settings.cache_clear()

    out = capsys.readouterr().out
    assert "STOPPED" in out
    assert "2 of 10" in out
    assert "same action     : 2/2" in out


def test_the_report_shows_cost_and_latency_per_model(
    capsys: pytest.CaptureFixture[str],
) -> None:
    def _o(cost: float, latency: float) -> Any:
        return _outcome(
            usage=cmp.CallUsage(
                model="m",
                input_tokens=1000,
                output_tokens=200,
                thinking_tokens=50,
                cost=cost,
                latency_s=latency,
            )
        )

    comparisons = [
        cmp.Comparison("s1", _o(0.010, 5.0), _o(0.001, 2.0)),
        cmp.Comparison("s2", _o(0.012, 6.0), _o(0.002, 3.0)),
    ]

    cmp.print_report(comparisons, "base", "cand")

    out = capsys.readouterr().out
    assert "total $0.0220 over 2 calls" in out
    assert "total $0.0030 over 2 calls" in out
    assert "mean latency 5.5s" in out and "mean latency 2.5s" in out
    assert "thinking tokens 100" in out
