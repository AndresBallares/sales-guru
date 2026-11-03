"""The streaming Anthropic adapter behind the research runner (Phase 7b).

No API call is made: a stub stands in for ``AsyncAnthropic`` and returns messages
shaped like the real ones (docs: web search / web fetch response structure).
"""

import logging
from types import SimpleNamespace
from typing import Any

import pytest
from app.services.research_client import AnthropicResearchClient, turn_from_message

NS = SimpleNamespace


def _usage(**over: Any) -> NS:
    base: dict[str, Any] = {
        "input_tokens": 10,
        "output_tokens": 20,
        "cache_creation_input_tokens": 30,
        "cache_read_input_tokens": 40,
        "server_tool_use": NS(web_search_requests=2, web_fetch_requests=1),
        "cache_creation": None,
    }
    base.update(over)
    return NS(**base)


def _message(content: list[Any], stop_reason: str = "end_turn") -> NS:
    return NS(content=content, stop_reason=stop_reason, usage=_usage())


def test_search_results_fetch_text_and_errors_become_observations() -> None:
    message = _message(
        [
            NS(
                type="text",
                text="Looking. ",
                citations=[
                    NS(
                        type="web_search_result_location",
                        url="https://a.com/p",
                        cited_text="it peels fast",
                    )
                ],
            ),
            NS(
                type="server_tool_use", name="web_search", id="s1", input={"query": "q"}
            ),
            NS(
                type="web_search_tool_result",
                tool_use_id="s1",
                content=[
                    NS(
                        type="web_search_result",
                        url="https://www.reddit.com/r/x/1",
                        title="R",
                    ),
                    NS(type="web_search_result", url="https://b.com/", title="B"),
                ],
            ),
            NS(
                type="web_search_tool_result",
                tool_use_id="s2",
                content=NS(
                    type="web_search_tool_result_error", error_code="too_many_requests"
                ),
            ),
            NS(
                type="web_fetch_tool_result",
                tool_use_id="f1",
                content=NS(
                    type="web_fetch_result",
                    url="https://c.com/page",
                    content=NS(source=NS(type="text", data="page body text")),
                ),
            ),
            NS(
                type="web_fetch_tool_result",
                tool_use_id="f2",
                content=NS(
                    type="web_fetch_tool_result_error", error_code="url_not_accessible"
                ),
            ),
        ]
    )
    turn = turn_from_message(message)
    seen = [(o.kind, o.url, o.error_code) for o in turn.observations]
    assert ("search", "https://www.reddit.com/r/x/1", None) in seen
    assert ("search", "https://b.com/", None) in seen
    assert ("search", None, "too_many_requests") in seen
    assert ("fetch", "https://c.com/page", None) in seen
    assert ("fetch", None, "url_not_accessible") in seen
    texts = {o.url: o.text for o in turn.observations if o.text}
    assert texts["https://c.com/page"] == "page body text"
    assert texts["https://a.com/p"] == "it peels fast"  # a citation's cited_text
    assert turn.text == "Looking. "
    assert turn.stop_reason == "end_turn"
    assert turn.content == message.content


def test_submit_tool_calls_are_collected_by_name() -> None:
    message = _message(
        [
            NS(
                type="tool_use", name="submit_findings", id="t1", input={"problems": []}
            ),
            NS(type="tool_use", name="something_else", id="t2", input={}),
        ],
        stop_reason="tool_use",
    )
    turn = turn_from_message(message)
    assert set(turn.submits) == {"submit_findings"}
    assert turn.submits["submit_findings"].id == "t1"
    assert turn.submits["submit_findings"].input == {"problems": []}


def test_a_fetched_pdf_has_no_text() -> None:
    message = _message(
        [
            NS(
                type="web_fetch_tool_result",
                tool_use_id="f1",
                content=NS(
                    type="web_fetch_result",
                    url="https://c.com/a.pdf",
                    content=NS(source=NS(type="base64", data="JVBERi0=")),
                ),
            )
        ]
    )
    (obs,) = turn_from_message(message).observations
    assert (obs.kind, obs.url, obs.text) == ("fetch", "https://c.com/a.pdf", None)


class _Stream:
    def __init__(self, message: NS) -> None:
        self._message = message

    async def __aenter__(self) -> "_Stream":
        return self

    async def __aexit__(self, *exc: object) -> None:
        return None

    async def get_final_message(self) -> NS:
        return self._message


class _Client:
    def __init__(self, message: NS) -> None:
        self.messages = NS(stream=self._stream)
        self._message = message
        self.kwargs: dict[str, Any] = {}

    def _stream(self, **kwargs: Any) -> _Stream:
        self.kwargs = kwargs
        return _Stream(self._message)


@pytest.mark.asyncio
async def test_the_adapter_streams_with_the_given_request_and_logs_usage(
    caplog: pytest.LogCaptureFixture,
) -> None:
    stub = _Client(_message([NS(type="text", text="ok", citations=None)]))
    client = AnthropicResearchClient.__new__(AnthropicResearchClient)
    object.__setattr__(client, "_client", stub)
    tools = [{"type": "web_search_20260209", "name": "web_search", "max_uses": 2}]
    with caplog.at_level(logging.INFO, logger="app.services.llm_usage"):
        turn = await client.turn(
            model="claude-opus-5-5",
            system=[{"type": "text", "text": "s"}],
            messages=[{"role": "user", "content": "hi"}],
            tools=tools,
            max_tokens=48_000,
            phase="brand",
            step=3,
        )
    assert stub.kwargs["model"] == "claude-opus-5-5"
    assert stub.kwargs["max_tokens"] == 48_000
    assert stub.kwargs["tools"] == tools
    assert turn.text == "ok"
    assert turn.usage.output_tokens == 20
    line = next(r.getMessage() for r in caplog.records if "llm_usage" in r.getMessage())
    assert "agent=research" in line
    assert "call_type=research" in line
    assert "step=3" in line
