"""One place every agent's Anthropic call goes through, so token spend is logged.

Cost review (2026-10): nothing recorded ``response.usage``, so there was no
real number behind "how much does a creative batch cost". This wrapper
logs one greppable ``llm_usage`` line per call — agent, call type, campaign,
every token counter the API reports (including the thinking tokens it
splits out of ``output_tokens``) and latency — and changes nothing else:
the response is returned untouched and API errors propagate untouched.

Log-only on purpose: a per-campaign total is a log query
(``campaign_id=<id>``, summing the counters), not a table. Persisting it
would be a schema change, deferred until someone wants it in the UI.

The agents keep their own ``except anthropic.AnthropicError`` handling —
this wrapper deliberately does not translate errors, since each agent
raises its own error type.
"""

import logging
import time
from typing import Any, Literal, cast

from anthropic import AsyncAnthropic
from anthropic.types import Message

logger = logging.getLogger(__name__)

Agent = Literal["strategist", "creative", "optimizer"]
CallType = Literal[
    "strategy",
    "creative_batch",
    "slot_regenerate",
    "optimizer_eval",
    "test_eval",
]


def _count(value: object) -> int:
    """Coerce an optional usage counter to an int (missing/None means 0)."""
    return value if isinstance(value, int) else 0


async def create_logged(
    client: AsyncAnthropic,
    *,
    agent: Agent,
    call_type: CallType,
    campaign_id: str | None = None,
    attempt: int = 1,
    **create_kwargs: Any,  # noqa: ANN401 — forwarded verbatim to messages.create
) -> Message:
    """Call ``client.messages.create`` and log the token usage of the response.

    Args:
        client: The Anthropic client to call.
        agent: Which agent is calling.
        call_type: What kind of call this is, so averages can be grouped
            (a batch, a single-slot regenerate and an optimizer evaluation
            have very different shapes).
        campaign_id: The campaign the call is for, when there is one — the
            key for a per-campaign total.
        attempt: 1 for the first try, 2+ for a retry after a failed or
            truncated first response. Retries are logged with
            ``retry=true`` so they can be summed separately.
        **create_kwargs: Forwarded verbatim to ``client.messages.create``.

    Returns:
        The API response, unmodified.
    """
    started = time.monotonic()
    response = cast(Message, await client.messages.create(**create_kwargs))
    latency_ms = int((time.monotonic() - started) * 1000)

    usage = getattr(response, "usage", None)
    details = getattr(usage, "output_tokens_details", None)
    logger.info(
        "llm_usage agent=%s call_type=%s campaign_id=%s attempt=%d retry=%s "
        "model=%s input_tokens=%d output_tokens=%d thinking_tokens=%d "
        "cache_creation_input_tokens=%d cache_read_input_tokens=%d "
        "stop_reason=%s latency_ms=%d",
        agent,
        call_type,
        campaign_id or "none",
        attempt,
        str(attempt > 1).lower(),
        create_kwargs.get("model", "unknown"),
        _count(getattr(usage, "input_tokens", 0)),
        _count(getattr(usage, "output_tokens", 0)),
        _count(getattr(details, "thinking_tokens", 0)),
        _count(getattr(usage, "cache_creation_input_tokens", 0)),
        _count(getattr(usage, "cache_read_input_tokens", 0)),
        getattr(response, "stop_reason", None),
        latency_ms,
    )
    return response
