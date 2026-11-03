"""Cost estimate for an Avatar Research run (Phase 7a). Makes no API call.

The model of a run: one request carries the filled template and the tool
definitions; every search or fetch adds a result to the context, and each later
request in the server-side loop re-reads the context so far from the prompt
cache. Output is some thinking per tool call plus one large ``submit_research``.

Prices come from ``app.services.llm_call`` (pricing page
platform.claude.com/docs/en/about-claude/pricing, read 2026-10-30; $10 per 1,000
web searches, fetches free). Inputs marked ``measured`` come from the Phase 1.5
smoke test on claude-fable-5-1 (docs/phase-7.md); every other input is an
estimate and is labeled so in the endpoint's response.
"""

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
        "search_result_tokens",
        6_500,
        "tokens",
        True,
        "Phase 1.5 smoke test: one search result added about 6-7k tokens of context",
    ),
    Input("search_fee_usd", SEARCH_FEE_USD, "usd", True, "$10 per 1,000 searches"),
    Input(
        "fetched_page_tokens",
        8_000,
        "tokens",
        False,
        "Estimate: the smoke test fetched a ~200-token page; real pages are larger",
    ),
    Input(
        "iterations_per_tool_call",
        1.0,
        "requests",
        False,
        "Estimate: one more request in the server-side loop per search or fetch",
    ),
    Input(
        "thinking_tokens_per_phase",
        1_500,
        "tokens",
        False,
        "Estimate: thinking plus text per request (smoke test: 219-474, tiny task)",
    ),
    Input(
        "submit_output_tokens",
        14_000,
        "tokens",
        False,
        "Estimate: 20 problems, 20 solutions and 5 full avatars as JSON",
    ),
    Input(
        "tool_definition_tokens",
        1_500,
        "tokens",
        False,
        "Estimate: system block, web tools and the submit_research schema",
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


def _run_cost(model: str, prompt_tokens: int, searches: int, fetches: int) -> float:
    """Cost of a run that does this many searches and fetches, then submits."""
    base = prompt_tokens + int(_BY_NAME["tool_definition_tokens"])
    thinking = int(_BY_NAME["thinking_tokens_per_phase"])
    per_call = _BY_NAME["iterations_per_tool_call"]
    results = [int(_BY_NAME["search_result_tokens"])] * searches + [
        int(_BY_NAME["fetched_page_tokens"])
    ] * fetches
    # The first request writes the prompt to the cache; each later request reads
    # everything before it and writes the result it just received.
    write = base
    read = 0
    output = 0
    context = base
    requests = 0.0
    for tokens in results:
        requests += per_call
        for _ in range(int(per_call)):
            read += context
            output += thinking
        write += tokens
        context += tokens
    read += context  # the final request, which submits
    output += thinking + int(_BY_NAME["submit_output_tokens"])
    return price_tokens(
        model,
        fresh=int(requests) * 8,
        cache_write=write,
        cache_read=read,
        output=output,
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
