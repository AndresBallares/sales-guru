"""Tests for the shared tool-calling helper and its model capability table."""

import logging
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services.llm_call import (
    ContinuationLimitError,
    ToolSpec,
    UsageTotals,
    call_with_tool,
    capabilities_for,
    price_for,
)

_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {"name": {"type": "string", "maxLength": 60}},
    "required": ["name"],
}
_TOOL = ToolSpec(name="submit_x", description="Submit x.", input_schema=_SCHEMA)


def _usage(**overrides: object) -> SimpleNamespace:
    fields: dict[str, object] = {
        "input_tokens": 100,
        "output_tokens": 50,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens_details": SimpleNamespace(thinking_tokens=0),
        "server_tool_use": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _tool_use_block(name: str = "submit_x") -> SimpleNamespace:
    return SimpleNamespace(
        type="tool_use", id="toolu_1", name=name, input={"name": "a"}
    )


def _text_block() -> SimpleNamespace:
    return SimpleNamespace(type="text", text="Here is my answer.")


def _response(
    *blocks: SimpleNamespace, stop_reason: str = "tool_use", usage: Any = None
) -> SimpleNamespace:
    return SimpleNamespace(
        content=list(blocks), stop_reason=stop_reason, usage=usage or _usage()
    )


def _client(*responses: SimpleNamespace) -> Any:
    return SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(side_effect=list(responses)))
    )


def _sent(client: Any, call: int = 0) -> dict[str, Any]:
    kwargs: dict[str, Any] = client.messages.create.await_args_list[call].kwargs
    return kwargs


# --- capability table ---------------------------------------------------


@pytest.mark.parametrize(
    "model",
    [
        "claude-sonnet-5",
        "claude-opus-5",
        "claude-haiku-5-5",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-5-20261001",
    ],
)
def test_models_that_accept_a_forced_tool(model: str) -> None:
    assert capabilities_for(model).forced_tool_choice is True


@pytest.mark.parametrize(
    "model",
    ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-1", "claude-mythos-5-1"],
)
def test_models_that_reject_a_forced_tool(model: str) -> None:
    assert capabilities_for(model).forced_tool_choice is False


def test_a_longer_model_name_does_not_match_its_shorter_prefix() -> None:
    # claude-sonnet-5 accepts a forced tool; claude-sonnet-5-5 must not inherit that.
    assert capabilities_for("claude-sonnet-5-5").forced_tool_choice is False


def test_an_unknown_model_gets_the_safe_path() -> None:
    assert capabilities_for("claude-brand-new-9").forced_tool_choice is False


# --- pricing -------------------------------------------------------------


def test_price_for_known_and_unknown_models() -> None:
    fable = price_for("claude-fable-5-1")
    assert (fable.input, fable.output, fable.cache_read) == (10.0, 50.0, 0.25)
    with pytest.raises(ValueError, match="No price"):
        price_for("claude-brand-new-9")


def test_usage_totals_cost_covers_every_counter_and_search_fees() -> None:
    totals = UsageTotals()
    totals.add(
        _usage(
            input_tokens=1_000_000,
            output_tokens=100_000,
            cache_creation_input_tokens=200_000,
            cache_read_input_tokens=3_000_000,
            server_tool_use=SimpleNamespace(
                web_search_requests=7, web_fetch_requests=3
            ),
        ),
        "claude-opus-5-5",
    )
    # 1M*4 + 0.1M*20 + 0.2M*5 + 3M*0.20 + 7 searches*0.01
    assert totals.cost_usd == pytest.approx(4 + 2 + 1 + 0.6 + 0.07)
    assert (totals.searches, totals.fetches) == (7, 3)
    assert totals.cache_read_tokens == 3_000_000
    assert totals.cache_write_tokens == 200_000


def test_usage_totals_bills_one_hour_cache_writes_at_the_one_hour_rate() -> None:
    totals = UsageTotals()
    totals.add(
        _usage(
            input_tokens=0,
            output_tokens=0,
            cache_creation_input_tokens=1_000_000,
            cache_creation=SimpleNamespace(
                ephemeral_5m_input_tokens=0, ephemeral_1h_input_tokens=1_000_000
            ),
        ),
        "claude-opus-5-5",
    )
    assert totals.cost_usd == pytest.approx(8.0)


def test_haiku_55_bills_a_long_prompt_at_the_higher_rate() -> None:
    short, long_ = UsageTotals(), UsageTotals()
    short.add(_usage(input_tokens=100_000, output_tokens=0), "claude-haiku-5-5")
    long_.add(_usage(input_tokens=100_001, output_tokens=0), "claude-haiku-5-5")
    assert short.cost_usd == pytest.approx(0.01)
    assert long_.cost_usd == pytest.approx(0.0500005)


# --- the forced-tool path (unchanged behaviour) --------------------------


@pytest.mark.asyncio
async def test_forced_model_gets_a_forced_non_strict_tool() -> None:
    client = _client(_response(_tool_use_block()))

    response = await call_with_tool(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-sonnet-5",
        tool=_TOOL,
        max_tokens=10,
        system=[{"type": "text", "text": "S"}],
        messages=[{"role": "user", "content": "hi"}],
    )

    sent = _sent(client)
    assert sent["tool_choice"] == {"type": "tool", "name": "submit_x"}
    assert sent["tools"] == [
        {"name": "submit_x", "description": "Submit x.", "input_schema": _SCHEMA}
    ]
    assert sent["system"] == [{"type": "text", "text": "S"}]
    assert sent["max_tokens"] == 10
    assert response.stop_reason == "tool_use"


@pytest.mark.asyncio
async def test_forced_model_never_gets_a_nudge() -> None:
    client = _client(_response(_text_block(), stop_reason="end_turn"))

    response = await call_with_tool(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-sonnet-5",
        tool=_TOOL,
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert client.messages.create.await_count == 1
    assert response.stop_reason == "end_turn"


# --- the auto + strict path ----------------------------------------------


@pytest.mark.asyncio
async def test_non_forced_model_gets_auto_choice_and_a_strict_schema() -> None:
    client = _client(_response(_tool_use_block()))

    await call_with_tool(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-opus-5-5",
        tool=_TOOL,
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    sent = _sent(client)
    assert sent["tool_choice"] == {"type": "auto"}
    (tool,) = sent["tools"]
    assert tool["strict"] is True
    assert tool["input_schema"]["additionalProperties"] is False
    assert "maxLength" not in tool["input_schema"]["properties"]["name"]
    # The caller's schema is untouched.
    assert _SCHEMA["properties"]["name"]["maxLength"] == 60


@pytest.mark.asyncio
async def test_missing_tool_call_is_nudged_once_and_logged_as_a_retry(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = _client(
        _response(_text_block(), stop_reason="end_turn"),
        _response(_tool_use_block()),
    )
    messages = [{"role": "user", "content": "hi"}]

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        response = await call_with_tool(
            client,
            agent="creative",
            call_type="creative_batch",
            model="claude-fable-5-1",
            tool=_TOOL,
            max_tokens=10,
            messages=messages,
        )

    assert response.stop_reason == "tool_use"
    second = _sent(client, 1)["messages"]
    assert [m["role"] for m in second] == ["user", "assistant", "user"]
    assert "submit_x" in second[-1]["content"]
    # The caller's list is not mutated.
    assert len(messages) == 1
    assert "attempt=2 retry=true" in caplog.text


@pytest.mark.asyncio
async def test_second_missing_tool_call_is_returned_for_the_caller_to_reject() -> None:
    client = _client(
        _response(_text_block(), stop_reason="end_turn"),
        _response(_text_block(), stop_reason="end_turn"),
    )

    response = await call_with_tool(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-fable-5-1",
        tool=_TOOL,
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert client.messages.create.await_count == 2
    assert not any(b.type == "tool_use" for b in response.content)


@pytest.mark.asyncio
async def test_a_truncated_response_is_not_nudged() -> None:
    client = _client(_response(_text_block(), stop_reason="max_tokens"))

    response = await call_with_tool(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-fable-5-1",
        tool=_TOOL,
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert client.messages.create.await_count == 1
    assert response.stop_reason == "max_tokens"


# --- server tools and pause_turn -----------------------------------------


@pytest.mark.asyncio
async def test_server_tools_go_first_and_are_not_made_strict() -> None:
    search = {"type": "web_search_20250305", "name": "web_search", "max_uses": 3}
    client = _client(_response(_tool_use_block()))

    await call_with_tool(
        client,
        agent="research",
        call_type="research_smoke",
        model="claude-fable-5-1",
        tool=_TOOL,
        server_tools=[search],
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    tools = _sent(client)["tools"]
    assert tools[0] == search
    assert tools[1]["name"] == "submit_x"


@pytest.mark.asyncio
async def test_pause_turn_is_continued_with_the_assistant_content_unchanged() -> None:
    paused = _response(_text_block(), stop_reason="pause_turn")
    client = _client(paused, _response(_tool_use_block()))
    totals = UsageTotals()

    response = await call_with_tool(
        client,
        agent="research",
        call_type="research_smoke",
        model="claude-fable-5-1",
        tool=_TOOL,
        server_tools=[{"type": "web_search_20250305", "name": "web_search"}],
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
        totals=totals,
    )

    assert response.stop_reason == "tool_use"
    second = _sent(client, 1)["messages"]
    assert second[-1] == {"role": "assistant", "content": paused.content}
    # Both responses' usage is summed, and a continuation is not a retry.
    assert totals.input_tokens == 200
    assert totals.output_tokens == 100


@pytest.mark.asyncio
async def test_pause_turn_loop_is_capped() -> None:
    client = _client(*[_response(_text_block(), stop_reason="pause_turn")] * 4)

    with pytest.raises(ContinuationLimitError):
        await call_with_tool(
            client,
            agent="research",
            call_type="research_smoke",
            model="claude-fable-5-1",
            tool=_TOOL,
            server_tools=[{"type": "web_search_20250305", "name": "web_search"}],
            max_tokens=10,
            messages=[{"role": "user", "content": "hi"}],
            max_continuations=2,
        )

    assert client.messages.create.await_count == 3


@pytest.mark.asyncio
async def test_a_stop_on_the_submit_tool_ends_the_loop() -> None:
    client = _client(_response(_tool_use_block()))

    await call_with_tool(
        client,
        agent="research",
        call_type="research_smoke",
        model="claude-fable-5-1",
        tool=_TOOL,
        server_tools=[{"type": "web_search_20250305", "name": "web_search"}],
        max_tokens=10,
        messages=[{"role": "user", "content": "hi"}],
    )

    assert client.messages.create.await_count == 1
