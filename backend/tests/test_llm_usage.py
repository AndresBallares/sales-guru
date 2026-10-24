"""Tests for the shared Anthropic call wrapper that logs per-call token usage."""

import logging
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.services.llm_usage import create_logged


def _client(response: SimpleNamespace) -> Any:
    """A stand-in AsyncAnthropic whose messages.create returns ``response``."""
    return SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(return_value=response))
    )


def _usage(**overrides: object) -> SimpleNamespace:
    fields: dict[str, object] = {
        "input_tokens": 1200,
        "output_tokens": 900,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "output_tokens_details": SimpleNamespace(thinking_tokens=300),
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


@pytest.mark.asyncio
async def test_create_logged_returns_the_response_and_forwards_kwargs() -> None:
    response = SimpleNamespace(content=[], stop_reason="tool_use", usage=_usage())
    client = _client(response)

    result = await create_logged(
        client,
        agent="creative",
        call_type="creative_batch",
        model="claude-sonnet-5",
        max_tokens=10,
    )

    assert cast(Any, result) is response
    client.messages.create.assert_awaited_once_with(
        model="claude-sonnet-5", max_tokens=10
    )


@pytest.mark.asyncio
async def test_create_logged_logs_every_token_counter(
    caplog: pytest.LogCaptureFixture,
) -> None:
    usage = _usage(cache_creation_input_tokens=2000, cache_read_input_tokens=50)
    response = SimpleNamespace(content=[], stop_reason="tool_use", usage=usage)

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        await create_logged(
            _client(response),
            agent="strategist",
            call_type="strategy",
            campaign_id="camp_1",
            model="claude-sonnet-5",
        )

    line = caplog.text
    assert "agent=strategist" in line
    assert "call_type=strategy" in line
    assert "campaign_id=camp_1" in line
    assert "attempt=1" in line
    assert "model=claude-sonnet-5" in line
    assert "input_tokens=1200" in line
    assert "output_tokens=900" in line
    assert "thinking_tokens=300" in line
    assert "cache_creation_input_tokens=2000" in line
    assert "cache_read_input_tokens=50" in line
    assert "stop_reason=tool_use" in line
    assert "latency_ms=" in line


@pytest.mark.asyncio
async def test_create_logged_marks_a_retry_attempt(
    caplog: pytest.LogCaptureFixture,
) -> None:
    response = SimpleNamespace(content=[], stop_reason="tool_use", usage=_usage())

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        await create_logged(
            _client(response),
            agent="creative",
            call_type="creative_batch",
            attempt=2,
            model="claude-sonnet-5",
        )

    assert "attempt=2" in caplog.text
    assert "retry=true" in caplog.text


@pytest.mark.asyncio
async def test_create_logged_tolerates_a_response_without_usage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Unit-test mocks and older responses may carry no usage at all."""
    response = SimpleNamespace(content=[])

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        result = await create_logged(
            _client(response),
            agent="optimizer",
            call_type="optimizer_eval",
            model="claude-sonnet-5",
        )

    assert cast(Any, result) is response
    assert "input_tokens=0" in caplog.text
    assert "thinking_tokens=0" in caplog.text
    assert "campaign_id=none" in caplog.text


@pytest.mark.asyncio
async def test_create_logged_treats_missing_details_and_none_counters_as_zero(
    caplog: pytest.LogCaptureFixture,
) -> None:
    usage = SimpleNamespace(
        input_tokens=10,
        output_tokens=5,
        cache_creation_input_tokens=None,
        cache_read_input_tokens=None,
        output_tokens_details=None,
    )
    response = SimpleNamespace(content=[], stop_reason="end_turn", usage=usage)

    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        await create_logged(
            _client(response),
            agent="optimizer",
            call_type="test_eval",
            model="claude-sonnet-5",
        )

    assert "thinking_tokens=0" in caplog.text
    assert "cache_read_input_tokens=0" in caplog.text


@pytest.mark.asyncio
async def test_create_logged_propagates_api_errors_without_logging(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client: Any = SimpleNamespace(
        messages=SimpleNamespace(create=AsyncMock(side_effect=RuntimeError("boom")))
    )

    with (
        caplog.at_level(logging.INFO, logger="app.services.llm_usage"),
        pytest.raises(RuntimeError, match="boom"),
    ):
        await create_logged(
            client,
            agent="creative",
            call_type="creative_batch",
            model="claude-sonnet-5",
        )

    assert "llm_usage" not in caplog.text
