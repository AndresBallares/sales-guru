"""One helper for every "call the model, get a structured tool call back" request.

Why it exists (confirmed against the Anthropic docs, 2026-10-30): the agents
used ``tool_choice={"type": "tool", ...}`` to force their submit tool, but that
returns a 400 on Claude Opus 5.5, Sonnet 5.5, Fable 5.1 and Mythos 5.1. Moving
any agent to one of those models would have broken it. This module holds the
table of what each model accepts and builds the request accordingly:

- Models that accept a forced tool get exactly the request they always did.
- Every other model (and any model the table does not know) gets
  ``tool_choice: auto`` with the tool marked ``strict`` — the API then
  guarantees the input matches the schema — plus one nudge if the model answers
  in text instead of calling the tool.

It also carries what multi-request runs need: server tools (web search and
fetch) placed ahead of the submit tool, ``pause_turn`` continuation with a cap,
and running token and dollar totals, so a caller can stop at a spending cap.

Every request still goes through ``create_logged``, so each one writes its
``llm_usage`` line.
"""

import copy
import re
from dataclasses import dataclass, field
from typing import Any

from anthropic import AsyncAnthropic
from anthropic.types import Message

from app.services.llm_usage import Agent, CallType, create_logged
from app.services.tool_use import strict_schema

_PER_MTOK = 1_000_000
SEARCH_FEE_USD = 0.01  # $10 per 1,000 web searches; fetches carry no fee
_DEFAULT_MAX_CONTINUATIONS = 8
_DATED_SUFFIX = r"(?:-\d{8})?"


@dataclass(frozen=True)
class ModelCapabilities:
    """What a model family accepts that changes how a request is built."""

    forced_tool_choice: bool


@dataclass(frozen=True)
class ModelPrice:
    """USD per million tokens. ``long_*`` applies above ``long_threshold``."""

    input: float
    output: float
    cache_write_5m: float
    cache_write_1h: float
    cache_read: float
    long_threshold: int | None = None
    long_input: float = 0.0
    long_output: float = 0.0
    long_cache_write_5m: float = 0.0
    long_cache_write_1h: float = 0.0
    long_cache_read: float = 0.0


@dataclass(frozen=True)
class _Model:
    capabilities: ModelCapabilities
    price: ModelPrice


_FORCED = ModelCapabilities(forced_tool_choice=True)
_AUTO_ONLY = ModelCapabilities(forced_tool_choice=False)

# Prices: platform.claude.com/docs/en/about-claude/pricing, read 2026-10-30.
# Forced-tool support: .../agents-and-tools/tool-use/define-tools, same date.
# Keys match the model id exactly or with a ``-YYYYMMDD`` snapshot suffix.
_MODELS: dict[str, _Model] = {
    "claude-fable-5-1": _Model(_AUTO_ONLY, ModelPrice(10, 50, 12.5, 20, 0.25)),
    "claude-mythos-5-1": _Model(_AUTO_ONLY, ModelPrice(10, 50, 12.5, 20, 0.25)),
    "claude-opus-5-5": _Model(_AUTO_ONLY, ModelPrice(4, 20, 5, 8, 0.20)),
    "claude-sonnet-5-5": _Model(_AUTO_ONLY, ModelPrice(2, 10, 2.5, 4, 0.10)),
    "claude-opus-5": _Model(_FORCED, ModelPrice(5, 25, 6.25, 10, 0.50)),
    "claude-sonnet-5": _Model(_FORCED, ModelPrice(2, 10, 2.5, 4, 0.20)),
    "claude-haiku-5-5": _Model(
        _FORCED,
        ModelPrice(
            0.10, 0.50, 0.125, 0.20, 0.01, 100_000, 0.50, 2.50, 0.625, 1.0, 0.05
        ),
    ),
    "claude-haiku-4-5": _Model(_FORCED, ModelPrice(1, 5, 1.25, 2, 0.10)),
    "claude-opus-4-8": _Model(_FORCED, ModelPrice(5, 25, 6.25, 10, 0.50)),
    "claude-opus-4-7": _Model(_FORCED, ModelPrice(5, 25, 6.25, 10, 0.50)),
    "claude-opus-4-6": _Model(_FORCED, ModelPrice(5, 25, 6.25, 10, 0.50)),
    "claude-opus-4-5": _Model(_FORCED, ModelPrice(5, 25, 6.25, 10, 0.50)),
    "claude-sonnet-4-6": _Model(_FORCED, ModelPrice(3, 15, 3.75, 6, 0.30)),
    "claude-sonnet-4-5": _Model(_FORCED, ModelPrice(3, 15, 3.75, 6, 0.30)),
}


def _lookup(model: str) -> _Model | None:
    for key, entry in _MODELS.items():
        if re.fullmatch(re.escape(key) + _DATED_SUFFIX, model):
            return entry
    return None


def capabilities_for(model: str) -> ModelCapabilities:
    """What the model accepts. An unknown model gets the path that works anywhere.

    Args:
        model: A model id, optionally with a ``-YYYYMMDD`` snapshot suffix.

    Returns:
        Its capabilities; ``auto`` + strict for a model not in the table.
    """
    entry = _lookup(model)
    return entry.capabilities if entry is not None else _AUTO_ONLY


def price_for(model: str) -> ModelPrice:
    """The model's token prices.

    Args:
        model: A model id, optionally with a ``-YYYYMMDD`` snapshot suffix.

    Returns:
        Its prices.

    Raises:
        ValueError: If the model is not in the table. A cost cap must never
            silently treat an unpriced model as free.
    """
    entry = _lookup(model)
    if entry is None:
        raise ValueError(f"No price known for model {model!r}")
    return entry.price


def _int(value: object) -> int:
    return value if isinstance(value, int) else 0


@dataclass
class UsageTotals:
    """Running token, tool and dollar totals across the requests of one run."""

    input_tokens: int = 0
    output_tokens: int = 0
    cache_write_tokens: int = 0
    cache_read_tokens: int = 0
    searches: int = 0
    fetches: int = 0
    cost_usd: float = field(default=0.0)

    def add(self, usage: object, model: str) -> None:
        """Fold one response's usage into the totals.

        Args:
            usage: The response's ``usage`` object.
            model: The model that served it, for pricing.

        Raises:
            ValueError: If the model has no known price.
        """
        price = price_for(model)
        fresh = _int(getattr(usage, "input_tokens", 0))
        output = _int(getattr(usage, "output_tokens", 0))
        written = _int(getattr(usage, "cache_creation_input_tokens", 0))
        read = _int(getattr(usage, "cache_read_input_tokens", 0))
        breakdown = getattr(usage, "cache_creation", None)
        written_1h = _int(getattr(breakdown, "ephemeral_1h_input_tokens", 0))
        written_5m = written - written_1h
        server = getattr(usage, "server_tool_use", None)
        searches = _int(getattr(server, "web_search_requests", 0))

        # A prompt's length counts every input token, cached or not.
        long = price.long_threshold is not None and (
            fresh + written + read > price.long_threshold
        )
        rate_in = price.long_input if long else price.input
        rate_out = price.long_output if long else price.output
        rate_5m = price.long_cache_write_5m if long else price.cache_write_5m
        rate_1h = price.long_cache_write_1h if long else price.cache_write_1h
        rate_read = price.long_cache_read if long else price.cache_read

        self.input_tokens += fresh
        self.output_tokens += output
        self.cache_write_tokens += written
        self.cache_read_tokens += read
        self.searches += searches
        self.fetches += _int(getattr(server, "web_fetch_requests", 0))
        self.cost_usd += (
            fresh * rate_in
            + output * rate_out
            + written_5m * rate_5m
            + written_1h * rate_1h
            + read * rate_read
        ) / _PER_MTOK + searches * SEARCH_FEE_USD


@dataclass(frozen=True)
class ToolSpec:
    """The one client tool the model must answer through."""

    name: str
    description: str
    input_schema: dict[str, Any]


class ContinuationLimitError(RuntimeError):
    """The model kept pausing (``pause_turn``) past the allowed continuations."""


def _called(response: Message, name: str) -> bool:
    return any(
        block.type == "tool_use" and block.name == name for block in response.content
    )


async def call_with_tool(
    client: AsyncAnthropic,
    *,
    agent: Agent,
    call_type: CallType,
    model: str,
    tool: ToolSpec,
    messages: list[Any],
    campaign_id: str | None = None,
    attempt: int = 1,
    server_tools: list[dict[str, Any]] | None = None,
    totals: UsageTotals | None = None,
    max_continuations: int = _DEFAULT_MAX_CONTINUATIONS,
    **create_kwargs: Any,  # noqa: ANN401 — forwarded verbatim to messages.create
) -> Message:
    """Call the model and get an answer through ``tool``, whatever the model.

    Args:
        client: The Anthropic client.
        agent: Which agent is calling (for the usage log).
        call_type: What kind of call this is (for the usage log).
        model: The model id; decides forced vs. ``auto`` + strict.
        tool: The submit tool.
        messages: The conversation. Not modified.
        campaign_id: The campaign the call is for, when there is one.
        attempt: 1 for a first try, 2+ for a caller's own retry.
        server_tools: Anthropic-run tools (web search, web fetch) to offer
            alongside ``tool``. Sent as given, never made strict.
        totals: If given, every response's usage is added to it, so the caller
            can read the spend so far.
        max_continuations: How many ``pause_turn`` resumes to allow.
        **create_kwargs: ``max_tokens``, ``system`` and the like, forwarded
            verbatim to ``messages.create``.

    Returns:
        The last response. For a model on ``auto`` that answered in text twice,
        this has no tool call, and the caller rejects it as it always has.

    Raises:
        ContinuationLimitError: If the model paused more than allowed.
    """
    forced = capabilities_for(model).forced_tool_choice
    submit: dict[str, Any] = {
        "name": tool.name,
        "description": tool.description,
        "input_schema": tool.input_schema
        if forced
        else strict_schema(tool.input_schema),
    }
    if not forced:
        submit["strict"] = True
    tools = [*(server_tools or []), submit]
    tool_choice = {"type": "tool", "name": tool.name} if forced else {"type": "auto"}

    conversation = copy.copy(messages)
    step = 1
    nudged = False
    while True:
        response = await create_logged(
            client,
            agent=agent,
            call_type=call_type,
            campaign_id=campaign_id,
            attempt=attempt + (1 if nudged else 0),
            step=step,
            model=model,
            tools=tools,
            tool_choice=tool_choice,
            messages=conversation,
            **create_kwargs,
        )
        if totals is not None:
            totals.add(response.usage, model)

        stop_reason = getattr(response, "stop_reason", None)
        if stop_reason == "pause_turn":
            if step > max_continuations:
                raise ContinuationLimitError(
                    f"Model still paused after {max_continuations} continuations"
                )
            conversation.append({"role": "assistant", "content": response.content})
            step += 1
            continue
        if (
            not forced
            and not nudged
            and stop_reason == "end_turn"
            and not _called(response, tool.name)
        ):
            nudged = True
            conversation.append({"role": "assistant", "content": response.content})
            conversation.append(
                {
                    "role": "user",
                    "content": f"Submit your answer now by calling the "
                    f"{tool.name} tool.",
                }
            )
            continue
        return response
