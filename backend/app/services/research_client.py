"""The model client behind the research runner (Phase 7b).

The runner talks to a small ``ResearchClient`` protocol so tests and FAKE_LLM can
script a whole run without the network (``research_fakes``). The real
implementation streams one Messages request (``max_tokens`` is large, so the SDK
requires streaming), logs its usage, and boils the response down to a ``Turn``:
what the model said, which submit tools it called, what the server-side search
and fetch tools returned, and the usage to price.

The content of fetched pages is kept on the ``Turn`` only so the runner can check
quotes against it in memory; nothing here or in the runner stores it.
"""

import time
from dataclasses import dataclass, field
from typing import Any, Literal, Protocol, cast

from anthropic import AsyncAnthropic

from app.services.llm_usage import log_usage

SUBMIT_TOOLS = ("submit_findings", "submit_avatars")
Phase = Literal["brand", "voice", "findings", "avatars"]


@dataclass
class Observation:
    """One search result, fetched page or tool error the server-side tools returned."""

    kind: Literal["search", "fetch"]
    url: str | None = None
    title: str | None = None
    error_code: str | None = None
    # Fetched page text or a citation's cited_text. In memory only.
    text: str | None = None


@dataclass
class SubmitCall:
    """The model's call of one of the two submit tools."""

    id: str
    input: dict[str, Any]


@dataclass
class Turn:
    """One finished request."""

    stop_reason: str = "end_turn"
    # The assistant content to send back unchanged on the next request.
    content: list[Any] = field(default_factory=list)
    text: str = ""
    submits: dict[str, SubmitCall] = field(default_factory=dict)
    observations: list[Observation] = field(default_factory=list)
    usage: Any = None  # a ``usage`` object, priced by ``UsageTotals.add``


class ResearchClient(Protocol):
    """What the runner needs from a model client."""

    async def turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        phase: Phase,
        step: int,
    ) -> Turn:
        """Run one request to its stop and return what came back."""
        ...


def _result_observations(
    block: Any,  # noqa: ANN401
    kind: Literal["search", "fetch"],
) -> list[Observation]:
    content = block.content
    error = getattr(content, "error_code", None)
    if error is not None:
        return [Observation(kind, error_code=str(error))]
    if kind == "search":
        return [
            Observation("search", url=r.url, title=getattr(r, "title", None))
            for r in (content if isinstance(content, list) else [])
            if getattr(r, "url", None)
        ]
    source = getattr(getattr(content, "content", None), "source", None)
    text: str | None = None
    if source is not None and getattr(source, "type", None) == "text":
        text = str(source.data)
    return [Observation("fetch", url=getattr(content, "url", None), text=text)]


def turn_from_message(message: Any) -> Turn:  # noqa: ANN401
    """Boil a finished Messages response down to a ``Turn``.

    Args:
        message: The final message of a request (an SDK ``Message`` or a stand-in
            with the same attributes).

    Returns:
        The turn: text, submit calls, observations, stop reason and usage.
    """
    turn = Turn(
        stop_reason=str(message.stop_reason),
        content=list(message.content),
        usage=message.usage,
    )
    for block in message.content:
        kind = block.type
        if kind == "text":
            turn.text += block.text
            for citation in getattr(block, "citations", None) or []:
                cited = getattr(citation, "cited_text", None)
                url = getattr(citation, "url", None)
                if cited and url:
                    turn.observations.append(Observation("search", url=url, text=cited))
        elif kind == "tool_use" and block.name in SUBMIT_TOOLS:
            turn.submits[block.name] = SubmitCall(block.id, dict(block.input))
        elif kind == "web_search_tool_result":
            turn.observations += _result_observations(block, "search")
        elif kind == "web_fetch_tool_result":
            turn.observations += _result_observations(block, "fetch")
    return turn


class AnthropicResearchClient:
    """The real client: one streamed Messages request per ``turn``."""

    def __init__(self, api_key: str) -> None:
        """Create the client.

        Args:
            api_key: The Anthropic API key.
        """
        self._client = AsyncAnthropic(api_key=api_key)

    async def turn(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        max_tokens: int,
        phase: Phase,
        step: int,
    ) -> Turn:
        """Stream one request and return what came back.

        Args:
            model: The model id.
            system: The system blocks.
            messages: The conversation.
            tools: The tool definitions.
            max_tokens: Output limit for this request.
            phase: Which phase of the run is asking (unused by the real client).
            step: 1 for the first request of the run, counting up (usage log).

        Returns:
            The finished turn.
        """
        started = time.monotonic()
        async with self._client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=cast(Any, system),
            messages=cast(Any, messages),
            tools=cast(Any, tools),
        ) as stream:
            message = await stream.get_final_message()
        log_usage(
            message,
            agent="research",
            call_type="research",
            campaign_id=None,
            attempt=1,
            step=step,
            model=model,
            started=started,
        )
        return turn_from_message(message)
