"""Cost estimate for an Avatar Research run (7a, recalibrated in 7b). No API call.

The model of a run: one request carries the filled template and the tool
definitions; every search or fetch adds a (dynamically filtered) result to the
context, and each server-side iteration re-reads the context so far from the
prompt cache and writes what it added. Output is a little code and notes per tool
call plus the two submits, ``submit_findings`` and ``submit_avatars``.

Prices come from ``app.services.llm_call`` (pricing page
platform.claude.com/docs/en/about-claude/pricing, read 2026-10-30; $10 per 1,000
billed web searches, fetches free, and code execution free when used with the
web tools, checked 2026-11-03 in docs/phase-7.md). The per-unit inputs are fitted
to **smoke run 2** (claude-opus-5-5, light caps all used, $1.0028: 52 fresh,
54,856 cache write, 684,355 cache read, 26,571 output tokens); only the totals of
a run were measured, so every per-unit split is labeled an estimate in the
endpoint's response, and a test holds the model to run 2's totals.
"""

import math
from dataclasses import dataclass

from app.schemas.research import Depth
from app.services.llm_call import SEARCH_FEE_USD, UsageTotals

_PER_MTOK = 1_000_000


@dataclass(frozen=True)
class DepthCaps:
    """How much a run of this depth may do."""

    max_searches: int
    max_fetches: int


# A product choice for the run, not a measurement: more depth, more sources.
DEPTH_CAPS: dict[str, DepthCaps] = {
    "light": DepthCaps(max_searches=6, max_fetches=8),
    "standard": DepthCaps(max_searches=15, max_fetches=20),
    "deep": DepthCaps(max_searches=30, max_fetches=40),
}


# How much of a depth's caps the customer-voice step keeps for itself, so the
# brand and competitor step cannot spend them (a product choice, docs/phase-7.md).
CUSTOMER_VOICE_SEARCH_SHARE = 0.6
CUSTOMER_VOICE_FETCH_SHARE = 0.5


def brand_step_budget(depth: str) -> tuple[int, int]:
    """Searches and fetches the brand and competitor step may use.

    Args:
        depth: light, standard or deep.

    Returns:
        (searches, fetches): the depth's caps minus the share reserved for the
        customer-voice step, which also gets whatever this step leaves unused.
    """
    caps = DEPTH_CAPS[depth]
    return (
        caps.max_searches - math.ceil(caps.max_searches * CUSTOMER_VOICE_SEARCH_SHARE),
        caps.max_fetches - math.ceil(caps.max_fetches * CUSTOMER_VOICE_FETCH_SHARE),
    )


@dataclass(frozen=True)
class Input:
    """One input of the estimate."""

    name: str
    value: float
    unit: str
    measured: bool
    note: str


INPUTS: tuple[Input, ...] = (
    Input(
        "search_fee_usd", SEARCH_FEE_USD, "usd", True, "$10 per 1,000 billed searches"
    ),
    Input(
        "search_result_tokens",
        2_000,
        "tokens",
        False,
        "Fitted to smoke run 2's cache-write total; dynamic filtering keeps only the "
        "relevant part of a result (run 1, unfiltered, was about 16k per search)",
    ),
    Input(
        "fetched_page_tokens",
        2_000,
        "tokens",
        False,
        "Fitted to smoke run 2's cache-write total (run 1, unfiltered: about 4k)",
    ),
    Input(
        "iterations_per_tool_call",
        1.8,
        "requests",
        False,
        "Fitted to smoke run 2's cache-read total: server-side iterations per search "
        "or fetch, code-execution steps included",
    ),
    Input(
        "output_tokens_per_tool_call",
        500,
        "tokens",
        False,
        "Fitted to smoke run 2's output total: the code and notes the model writes per "
        "search or fetch",
    ),
    Input(
        "findings_output_tokens",
        13_400,
        "tokens",
        False,
        "Fitted to smoke run 2: 20 problems, 20 solutions and gaps as JSON",
    ),
    Input(
        "avatars_output_tokens",
        6_200,
        "tokens",
        True,
        "Smoke run 2: the submit_avatars request wrote 6,195 output tokens",
    ),
    Input(
        "tool_definition_tokens",
        2_000,
        "tokens",
        False,
        "Estimate: system block, web tools and both submit schemas",
    ),
    Input(
        "typical_share_of_caps",
        0.6,
        "ratio",
        False,
        "Estimate: a typical run uses 60% of its search and fetch caps",
    ),
)
_BY_NAME = {i.name: i.value for i in INPUTS}

_MAX_COST_MARGIN = 1.25


@dataclass(frozen=True)
class CostEstimate:
    """The estimate for one depth and model."""

    depth: str
    model: str
    max_searches: int
    max_fetches: int
    expected_usd: float
    max_usd: float
    suggested_max_cost_usd: float
    prompt_tokens: int
    assumptions: tuple[Input, ...]


@dataclass(frozen=True)
class TokenMix:
    """Tokens of a run by billing type (the same split the API reports)."""

    fresh: int
    cache_write: int
    cache_read: int
    output: int


def price_tokens(
    model: str,
    *,
    fresh: int = 0,
    cache_write: int = 0,
    cache_read: int = 0,
    output: int = 0,
    searches: int = 0,
) -> float:
    """What these token counts cost on a model (the same accounting a real run uses).

    Args:
        model: A model id with a price in ``llm_call``.
        fresh: Uncached input tokens.
        cache_write: Tokens written to the 5-minute cache.
        cache_read: Tokens read from the cache.
        output: Output tokens, thinking included.
        searches: Web searches billed.

    Returns:
        Dollars.

    Raises:
        ValueError: If the model has no known price.
    """
    usage = _Usage(fresh, output, cache_write, cache_read, searches)
    totals = UsageTotals()
    totals.add(usage, model)
    return totals.cost_usd


class _Usage:
    """The few usage fields ``UsageTotals.add`` reads, from plain numbers."""

    def __init__(
        self, fresh: int, output: int, written: int, read: int, searches: int
    ) -> None:
        self.input_tokens = fresh
        self.output_tokens = output
        self.cache_creation_input_tokens = written
        self.cache_read_input_tokens = read
        self.server_tool_use = _Server(searches)
        self.cache_creation = None


class _Server:
    def __init__(self, searches: int) -> None:
        self.web_search_requests = searches
        self.web_fetch_requests = 0


def estimate_tokens(*, prompt_tokens: int, searches: int, fetches: int) -> TokenMix:
    """The token mix of a run that does this many searches and fetches, then submits.

    Args:
        prompt_tokens: Approximate size of the rendered template.
        searches: Searches the run makes.
        fetches: Page fetches the run makes.

    Returns:
        Fresh, cache-write, cache-read and output tokens.
    """
    base = prompt_tokens + _BY_NAME["tool_definition_tokens"]
    per_call_out = _BY_NAME["output_tokens_per_tool_call"]
    per_call = _BY_NAME["iterations_per_tool_call"]
    results = [_BY_NAME["search_result_tokens"]] * searches + [
        _BY_NAME["fetched_page_tokens"]
    ] * fetches
    # The first request writes the prompt to the cache; every server-side iteration
    # re-reads the context so far, and what the model and the tools add is written
    # to the cache for the next one.
    write = base
    read = 0.0
    output = 0.0
    context = base
    for tokens in results:
        read += context * per_call
        output += per_call_out
        write += tokens + per_call_out
        context += tokens + per_call_out
    # submit_findings reads the context and writes its output into it;
    # submit_avatars then reads that.
    findings = _BY_NAME["findings_output_tokens"]
    read += context
    output += findings
    write += findings
    context += findings
    read += context
    output += _BY_NAME["avatars_output_tokens"]
    requests = len(results) * per_call + 2
    return TokenMix(
        fresh=int(requests * 4),
        cache_write=int(write),
        cache_read=int(read),
        output=int(output),
    )


def _run_cost(model: str, prompt_tokens: int, searches: int, fetches: int) -> float:
    """Cost of a run that does this many searches and fetches, then submits."""
    mix = estimate_tokens(
        prompt_tokens=prompt_tokens, searches=searches, fetches=fetches
    )
    return price_tokens(
        model,
        fresh=mix.fresh,
        cache_write=mix.cache_write,
        cache_read=mix.cache_read,
        output=mix.output,
        searches=searches,
    )


def estimate_cost(depth: Depth, model: str, *, prompt_tokens: int) -> CostEstimate:
    """Estimate what a run of this depth costs on this model.

    Args:
        depth: light, standard or deep.
        model: A model id with a price table entry.
        prompt_tokens: Approximate size of the rendered template.

    Returns:
        The expected cost (a typical run), the maximum (every cap used) and a
        suggested dollar cap for the run (the maximum plus a margin).

    Raises:
        ValueError: If the model has no known price.
    """
    caps = DEPTH_CAPS[depth]
    share = _BY_NAME["typical_share_of_caps"]
    expected = _run_cost(
        model,
        prompt_tokens,
        round(caps.max_searches * share),
        round(caps.max_fetches * share),
    )
    maximum = _run_cost(model, prompt_tokens, caps.max_searches, caps.max_fetches)
    return CostEstimate(
        depth=depth,
        model=model,
        max_searches=caps.max_searches,
        max_fetches=caps.max_fetches,
        expected_usd=round(expected, 2),
        max_usd=round(maximum, 2),
        suggested_max_cost_usd=round(maximum * _MAX_COST_MARGIN + 0.005, 2),
        prompt_tokens=prompt_tokens,
        assumptions=INPUTS,
    )
