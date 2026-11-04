"""The background runner of an Avatar Research run (Phase 7b, docs/phase-7.md).

One run is one asyncio task in this process, like ``publish_jobs`` (single
instance, no new infrastructure). Its state lives on the ``ResearchRun`` row, so
the screen polls the row and a restart can see what was left half done:

- a heartbeat is written every few seconds; ``sweep_stale_runs`` marks a run
  whose heartbeat stopped FAILED, keeping the findings saved so far;
- cancel is a flag on the row, read before every request;
- before every request the runner also checks the time budget and the dollar cap.

The run has four steps: (a) brand and competitor pages, (b) customer voice, (c)
``submit_findings``, (d) ``submit_avatars``. The customer-voice step keeps a
reserved share of the search and fetch budget (``research_cost.brand_step_budget``)
so competitor pages cannot spend it. Cache breakpoints are explicit: the system
block, the filled template, and the latest message. The tools array changes only
between steps (a) and (b), because the prompt cache is ordered tools, system,
messages; steps (c) and (d) send step (b)'s tools unchanged.

Page text the model fetched is held in memory to check quotes and dropped when the
run ends; the row stores findings, quotes and source metadata only.
"""

import asyncio
import json
import logging
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import anthropic
from prisma.models import Business, ResearchRun
from prisma.types import ResearchRunUpdateInput

from app.core.config import get_settings
from app.core.db import db
from app.schemas.research import (
    SubmitAvatars,
    SubmitFindings,
    avatar_count_warnings,
    findings_count_warnings,
)
from app.services import research_access
from app.services.llm_call import SEARCH_FEE_USD, UsageTotals, price_for
from app.services.research_access import RunRefusedError
from app.services.research_client import (
    AnthropicResearchClient,
    Observation,
    Phase,
    ResearchClient,
    Turn,
)
from app.services.research_cost import DEPTH_CAPS, brand_step_budget
from app.services.research_evidence import assess_evidence
from app.services.research_fakes import FakeResearchClient, fake_fetch
from app.services.research_filters import (
    competitor_terms_from_urls,
    drop_violations,
    find_violations,
    split_ignored_terms,
)
from app.services.research_pages import fetch_page_text
from app.services.research_parse import salvage_avatars, salvage_findings
from app.services.research_phases import (
    AVATARS_MESSAGE,
    CONTINUE_AFTER_ERROR,
    FINDINGS_MESSAGE,
    PHASES_VERSION,
    SYSTEM_TEXT,
    brand_message,
    fix_message,
    nudge,
    voice_message,
)
from app.services.research_quotes import Fetcher, check_quotes
from app.services.research_template import (
    TemplateInputs,
    competitor_urls,
    load_template_inputs,
    render_template,
)
from app.services.research_text import norm_url
from app.services.tool_use import strict_input_schema, tool_input_schema

logger = logging.getLogger(__name__)

HEARTBEAT_SECONDS = 15.0
STALE_AFTER = timedelta(minutes=2)
MAX_TOKENS = 48_000
MIN_USEFUL_TOKENS = 3_000
# Wall-clock budget per depth, backoff sleeps included (a product choice).
TIME_BUDGET_SECONDS: dict[str, float] = {
    "light": 900.0,
    "standard": 1_800.0,
    "deep": 3_600.0,
}
# Waits before retry 1, 2, 3 after a rate limit or outage.
BACKOFF_SECONDS: tuple[float, ...] = (5.0, 15.0, 45.0)
RATE_LIMIT_ATTEMPTS = len(BACKOFF_SECONDS)
API_RETRY_ATTEMPTS = len(BACKOFF_SECONDS)
TRANSIENT_ERRORS = frozenset({"too_many_requests", "unavailable"})
FETCH_MAX_CONTENT_TOKENS = 30_000
# What the two submits are expected to cost, to keep room for them under the cap.
_FINDINGS_OUTPUT_ESTIMATE = 14_000
_AVATARS_OUTPUT_ESTIMATE = 9_000
_MAX_OBSERVED_CHARS = 2_000_000
_GENERIC_FAILURE = "Something went wrong while researching. Please try again."
_ACTIVE = ("QUEUED", "RUNNING")

# Replaced by tests, and under FAKE_LLM by canned fakes.
client_factory: Callable[[], ResearchClient] | None = None
page_fetcher: Fetcher | None = None

_tasks: set["asyncio.Task[None]"] = set()
_start_locks: dict[str, asyncio.Lock] = {}


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def _submit_tool(
    name: str, description: str, schema: dict[str, Any], *, strict: bool
) -> dict[str, Any]:
    tool: dict[str, Any] = {
        "name": name,
        "description": description,
        "input_schema": schema,
    }
    if strict:
        tool["strict"] = True
    return tool


_SUBMIT_TOOLS: list[dict[str, Any]] = [
    # Only one tool can be strict: two together exceed the API's grammar size
    # limit (smoke run 2), so the second is validated in code instead.
    _submit_tool(
        "submit_findings",
        "Submit the problems, solutions, gaps and competitor names, once.",
        strict_input_schema(SubmitFindings),
        strict=True,
    ),
    _submit_tool(
        "submit_avatars",
        "Submit the five avatars, the coverage note and the sources, once.",
        tool_input_schema(SubmitAvatars),
        strict=False,
    ),
]


class _Stop(Exception):  # noqa: N818 - control flow, not an error
    """The run ends early, gracefully; ``reason`` becomes ``stopReason``."""

    def __init__(self, reason: str, message: str) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message


def camel_keys(value: Any) -> Any:  # noqa: ANN401
    """Rename every dict key to camelCase, recursively (the stored findings' style)."""
    if isinstance(value, dict):
        return {
            re.sub(r"_([a-z])", lambda m: m.group(1).upper(), k): camel_keys(v)
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [camel_keys(v) for v in value]
    return value


def _now() -> datetime:
    return datetime.now(UTC)


def make_client() -> ResearchClient:
    """The model client for a run: a test's, the FAKE_LLM one, or the real one.

    Returns:
        The client.

    Raises:
        RunRefusedError: 503 if there is no API key and no fake is active.
    """
    if client_factory is not None:
        return client_factory()
    settings = get_settings()
    if settings.fake_llm_enabled:
        return FakeResearchClient()
    if not settings.anthropic_api_key:
        raise RunRefusedError(
            503, "Research is not configured: ANTHROPIC_API_KEY is not set."
        )
    return AnthropicResearchClient(settings.anthropic_api_key)


def make_fetcher() -> Fetcher:
    """The page fetch that verifies quotes: a test's, the canned one, or the real one.

    Returns:
        The fetcher.
    """
    if page_fetcher is not None:
        return page_fetcher
    return fake_fetch if get_settings().fake_llm_enabled else fetch_page_text


# --- starting, sweeping -----------------------------------------------------------


async def sweep_stale_runs(now: datetime | None = None) -> int:
    """Mark runs whose heartbeat stopped FAILED, keeping their findings.

    A run is stale when it is queued or running and its last heartbeat (its
    creation, if it never beat) is older than ``STALE_AFTER``: the process that
    ran it is gone. Called at startup and whenever runs are read or started, so a
    restart is noticed within about two minutes without ever touching a live run
    of another instance.

    Args:
        now: Taken as the current time (for tests).

    Returns:
        How many runs were marked failed.
    """
    moment = now or _now()
    cutoff = moment - STALE_AFTER
    swept = 0
    for run in await db.researchrun.find_many(where={"status": {"in": list(_ACTIVE)}}):
        if (run.heartbeatAt or run.createdAt) >= cutoff:
            continue
        await db.researchrun.update(
            where={"id": run.id},
            data={
                "status": "FAILED",
                "stopReason": "stale",
                "error": (
                    "The server restarted or lost this run before it finished. "
                    "Findings saved so far are kept."
                ),
                "finishedAt": moment,
                "phase": None,
            },
        )
        swept += 1
    return swept


async def create_and_start(
    business: Business,
    *,
    depth: str,
    model: str,
    product_ids: list[str],
    extra_competitor_urls: list[str],
    max_cost_usd: float,
    prompt_version: str,
    prompt_hash: str,
) -> ResearchRun:
    """Check every refusal, create the run row and start its background task.

    Args:
        business: The business (ownership already checked).
        depth: light, standard or deep.
        model: The model to run on.
        product_ids: The owner's product choice (may be empty).
        extra_competitor_urls: Competitor URLs added at run start.
        max_cost_usd: The dollar cap for the run.
        prompt_version: The template version that filled the prompt.
        prompt_hash: A hash of that template file.

    Returns:
        The new run (QUEUED).

    Raises:
        RunRefusedError: 503 not configured, 403 model not enabled, 409 a run is
            already in progress, 429 over the monthly limit.
    """
    make_client()  # raises RunRefusedError(503) when nothing could run
    lock = _start_locks.setdefault(business.id, asyncio.Lock())
    async with lock:
        await sweep_stale_runs()
        access = await research_access.access_for(business.id)
        research_access.require_model(access, model)
        if await db.researchrun.find_first(
            where={"businessId": business.id, "status": {"in": list(_ACTIVE)}}
        ):
            raise RunRefusedError(
                409, "A research run is already in progress for this business."
            )
        research_access.require_runs_left(access)
        caps = DEPTH_CAPS[depth]
        run = await db.researchrun.create(
            data={
                "businessId": business.id,
                "depth": depth,
                "model": model,
                "maxSearches": caps.max_searches,
                "maxFetches": caps.max_fetches,
                "maxCostUsd": max_cost_usd,
                "promptVersion": prompt_version,
                "promptHash": prompt_hash,
                "productIds": json.dumps(product_ids),
                "extraCompetitorUrls": json.dumps(extra_competitor_urls),
            }
        )
    task = asyncio.get_running_loop().create_task(execute_run(run.id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return run


# --- one run ------------------------------------------------------------------------


@dataclass
class _Run:
    """The in-memory state of one run (the row holds what must survive a restart)."""

    row: ResearchRun
    client: ResearchClient
    fetch: Fetcher
    inputs: TemplateInputs
    template_text: str
    totals: UsageTotals = field(default_factory=UsageTotals)
    messages: list[dict[str, Any]] = field(default_factory=list)
    pending_results: list[dict[str, Any]] = field(default_factory=list)
    last_tools: list[dict[str, Any]] = field(default_factory=list)
    observed: dict[str, str] = field(default_factory=dict)
    reached: set[str] = field(default_factory=set)
    warnings: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    findings: SubmitFindings | None = None
    avatars: SubmitAvatars | None = None
    findings_call_id: str | None = None
    competitor_terms: list[str] = field(default_factory=list)
    stop_reason: str | None = None
    step: int = 1
    context_tokens: int = 0
    deadline: float = 0.0
    loop_time: Callable[[], float] = field(
        default=lambda: asyncio.get_running_loop().time()
    )

    # -- guards ------------------------------------------------------------------

    def remaining_seconds(self) -> float:
        return self.deadline - self.loop_time()

    async def save(self, **data: Any) -> None:  # noqa: ANN401
        await db.researchrun.update(
            where={"id": self.row.id}, data=cast("ResearchRunUpdateInput", data)
        )

    async def gate(self) -> None:
        """Before every request: canceled? out of time?"""
        fresh = await db.researchrun.find_unique(where={"id": self.row.id})
        if fresh is not None and fresh.cancelRequested:
            raise _Stop("canceled", "The run was canceled.")
        if self.remaining_seconds() <= 0:
            raise _Stop("time", "The run reached its time budget.")

    def submit_reserve(self) -> float:
        price = price_for(self.row.model)
        output = (_FINDINGS_OUTPUT_ESTIMATE + _AVATARS_OUTPUT_ESTIMATE) * price.output
        context = 2 * self.context_tokens * price.cache_read
        return (output + context) / 1_000_000

    def has_room_to_research(self) -> bool:
        return self.totals.cost_usd + self.submit_reserve() < self.row.maxCostUsd

    def cap_message(self) -> str:
        return (
            f"Stopped at the cost cap (${self.totals.cost_usd:.2f} of "
            f"${self.row.maxCostUsd:.2f})."
        )

    def max_tokens_for(self, tools: list[dict[str, Any]]) -> int:
        """The output limit the cap can pay for, or stop at the cap."""
        price = price_for(self.row.model)
        searches = sum(t["max_uses"] for t in tools if t["name"] == "web_search")
        context = price.cache_write_5m * self.context_tokens / 1_000_000
        headroom = (
            self.row.maxCostUsd
            - self.totals.cost_usd
            - searches * SEARCH_FEE_USD
            - context
        )
        affordable = int(headroom * 1_000_000 / price.output) if headroom > 0 else 0
        if affordable < MIN_USEFUL_TOKENS:
            raise _Stop("cap", self.cap_message())
        return min(MAX_TOKENS, affordable)

    # -- messages -----------------------------------------------------------------

    def add_user(
        self,
        text: str | None = None,
        *,
        results: list[tuple[str, str, bool]] | None = None,
    ) -> None:
        blocks: list[dict[str, Any]] = list(self.pending_results)
        self.pending_results = []
        for tool_use_id, content, is_error in results or []:
            block: dict[str, Any] = {
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": content,
            }
            if is_error:
                block["is_error"] = True
            blocks.append(block)
        if text:
            blocks.append({"type": "text", "text": text})
        self.messages.append({"role": "user", "content": blocks})

    def add_assistant(self, turn: Turn) -> None:
        content = turn.content or [{"type": "text", "text": turn.text or "(no text)"}]
        self.messages.append({"role": "assistant", "content": content})
        # A submit call outside its step still needs an answer before the next message.
        for call_id in {c.id for c in turn.submits.values()}:
            self.pending_results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": call_id,
                    "content": "Not now: this step is not the submit step.",
                    "is_error": True,
                }
            )

    def request_messages(self) -> list[dict[str, Any]]:
        """The conversation, with cache breakpoints on copies of two messages."""
        messages = list(self.messages)

        def marked(message: dict[str, Any], index: int) -> dict[str, Any]:
            blocks = list(message["content"])
            block = blocks[index]
            if isinstance(block, dict) and block.get("type") in ("text", "tool_result"):
                blocks[index] = {**block, "cache_control": {"type": "ephemeral"}}
            return {**message, "content": blocks}

        messages[0] = marked(messages[0], 0)
        if len(messages) > 1 and messages[-1]["role"] == "user":
            messages[-1] = marked(messages[-1], len(messages[-1]["content"]) - 1)
        return messages

    def tools(self, searches: int, fetches: int) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        if searches > 0:
            tools.append(
                {
                    "type": "web_search_20260209",
                    "name": "web_search",
                    "max_uses": searches,
                }
            )
        if fetches > 0:
            tools.append(
                {
                    "type": "web_fetch_20260209",
                    "name": "web_fetch",
                    "max_uses": fetches,
                    "max_content_tokens": FETCH_MAX_CONTENT_TOKENS,
                }
            )
        return [*tools, *_SUBMIT_TOOLS]

    # -- one request ----------------------------------------------------------------

    async def backoff(self, attempt: int) -> None:
        wait = BACKOFF_SECONDS[min(attempt, len(BACKOFF_SECONDS) - 1)]
        if wait >= self.remaining_seconds():
            raise _Stop(
                "time", "The run reached its time budget while waiting to retry."
            )
        await _sleep(wait)

    async def request(self, phase: Phase, tools: list[dict[str, Any]]) -> Turn:
        """Run one request, retrying provider rate limits and outages with backoff."""
        for attempt in range(API_RETRY_ATTEMPTS + 1):
            await self.gate()
            max_tokens = self.max_tokens_for(tools)
            try:
                async with asyncio.timeout(self.remaining_seconds()):
                    turn = await self.client.turn(
                        model=self.row.model,
                        system=[
                            {
                                "type": "text",
                                "text": SYSTEM_TEXT,
                                "cache_control": {"type": "ephemeral"},
                            }
                        ],
                        messages=self.request_messages(),
                        tools=tools,
                        max_tokens=max_tokens,
                        phase=phase,
                        step=self.step,
                    )
            except TimeoutError as exc:
                raise _Stop("time", "The run reached its time budget.") from exc
            except (
                anthropic.RateLimitError,
                anthropic.APIConnectionError,
                anthropic.InternalServerError,
            ) as exc:
                if attempt >= API_RETRY_ATTEMPTS:
                    raise _Stop(
                        "provider",
                        "The model provider kept rate limiting or failing requests; "
                        "the run was stopped.",
                    ) from exc
                await self.backoff(attempt)
                continue
            self.step += 1
            await self.account(turn)
            return turn
        raise AssertionError("unreachable")  # pragma: no cover

    async def account(self, turn: Turn) -> None:
        self.totals.add(turn.usage, self.row.model)
        # The conversation grows by what each request wrote: fresh input, cache
        # writes and output. Cache *reads* are summed over every server-side
        # iteration (300k+ in the first paid run), so they say nothing about the
        # size of the conversation and must not be counted. The first request's
        # real numbers replace the size estimated from the template.
        usage = turn.usage
        added = sum(
            int(getattr(usage, name, 0) or 0)
            for name in (
                "input_tokens",
                "cache_creation_input_tokens",
                "output_tokens",
            )
        )
        self.context_tokens = (self.context_tokens if self.step > 2 else 0) + added
        for obs in turn.observations:
            self.observe(obs)
        await self.save(
            searchesUsed=self.totals.searches,
            fetchesUsed=self.totals.fetches,
            inputTokens=self.totals.input_tokens,
            cacheWriteTokens=self.totals.cache_write_tokens,
            cacheReadTokens=self.totals.cache_read_tokens,
            outputTokens=self.totals.output_tokens,
            costUsd=round(self.totals.cost_usd, 6),
            heartbeatAt=_now(),
        )

    def observe(self, obs: Observation) -> None:
        if obs.error_code is not None or not obs.url:
            return
        self.reached.add(obs.url)
        if obs.text:
            key = norm_url(obs.url)
            merged = f"{self.observed.get(key, '')}\n{obs.text}"
            if sum(map(len, self.observed.values())) < _MAX_OBSERVED_CHARS:
                self.observed[key] = merged

    # -- the four steps ---------------------------------------------------------------

    async def research(
        self,
        phase: Phase,
        searches: int,
        fetches: int,
        message: Callable[[int, int], str],
    ) -> None:
        """Steps (a) and (b): research with a budget, retrying transient tool errors."""
        if not self.has_room_to_research():
            self.notes.append(
                "Stopped researching early to keep enough of the cost cap to write up "
                "the findings."
            )
            self.stop_reason = self.stop_reason or "cap"
            return
        self.add_user(message(searches, fetches))
        start_searches, start_fetches = self.totals.searches, self.totals.fetches
        retries = 0
        while True:
            left_s = searches - (self.totals.searches - start_searches)
            left_f = fetches - (self.totals.fetches - start_fetches)
            tools = self.tools(left_s, left_f)
            self.last_tools = tools
            turn = await self.request(phase, tools)
            self.add_assistant(turn)
            if turn.stop_reason == "pause_turn":
                continue
            if not any(o.error_code in TRANSIENT_ERRORS for o in turn.observations):
                return
            budget_left = left_s > 0 or left_f > 0
            if (
                retries >= RATE_LIMIT_ATTEMPTS
                or not budget_left
                or not self.has_room_to_research()
            ):
                self.notes.append(
                    f"Search or page requests hit rate limits or outages during the "
                    f"{phase} step that did not clear after {retries} "
                    f"retr{'y' if retries == 1 else 'ies'}; some sources were not "
                    "reached."
                )
                return
            await self.backoff(retries)
            retries += 1
            self.add_user(CONTINUE_AFTER_ERROR)

    async def submit(
        self,
        phase: Phase,
        tool: str,
        problems_of: Callable[[Any], list[str]],
        salvage: Callable[[dict[str, Any]], tuple[Any, list[str]]],
    ) -> tuple[Any, str, bool]:
        """Steps (c) and (d): get one submit call, with one nudge and one correction."""
        nudged = retried = False
        while True:
            turn = await self.request(phase, self.last_tools or self.tools(0, 0))
            self.add_assistant(turn)
            self.pending_results = [
                r
                for r in self.pending_results
                if r["tool_use_id"] not in {c.id for c in turn.submits.values()}
            ]
            call = turn.submits.get(tool)
            if call is None:
                if turn.stop_reason == "end_turn" and not nudged:
                    nudged = True
                    self.add_user(nudge(tool))
                    continue
                raise _Stop("no_submit", f"The model did not call {tool}.")
            parsed, dropped = salvage(call.input)
            self.warnings += dropped
            if turn.stop_reason == "max_tokens":
                self.warnings.append(
                    f"The {tool} answer was cut off at max_tokens; only the complete "
                    "items were kept."
                )
                self.stop_reason = "max_tokens"
                return parsed, call.id, True
            problems = problems_of(parsed)
            if problems and not retried:
                retried = True
                self.add_user(results=[(call.id, fix_message(problems), True)])
                continue
            return parsed, call.id, False

    async def findings_step(self) -> bool:
        """Step (c). Returns False when the run cannot go on to avatars."""
        self.add_user(FINDINGS_MESSAGE)
        parsed, call_id, truncated = await self.submit(
            "findings", "submit_findings", findings_count_warnings, salvage_findings
        )
        self.findings = parsed
        self.findings_call_id = call_id
        self.warnings += findings_count_warnings(parsed)
        self.competitor_terms = _dedupe(
            [
                *competitor_terms_from_urls(self.competitor_url_list()),
                *parsed.competitor_terms,
            ]
        )
        await self.save(findings=json.dumps(self.snapshot(partial=True)))
        return not truncated

    def banned_and_competitor_terms(self) -> list[str]:
        # Single common English words are ignored (the stored list keeps them, so the
        # owner can see what was ignored on the review screen).
        competitors, _ = split_ignored_terms(self.competitor_terms)
        return _dedupe([*self.inputs.banned_phrases, *competitors])

    def competitor_url_list(self) -> list[str]:
        return competitor_urls(
            self.inputs.competitors_text, self.inputs.extra_competitor_urls
        )

    async def avatars_step(self) -> None:
        """Step (d)."""
        terms = self.banned_and_competitor_terms()

        def problems_of(result: SubmitAvatars) -> list[str]:
            found = [
                f'Avatar "{result.avatars[v.avatar].name}": remove "{v.term}" from '
                f"{v.field.replace('_', ' ')} {v.index + 1}"
                for v in find_violations(result.avatars, terms)
            ]
            return [*avatar_count_warnings(result), *found]

        results = (
            [(self.findings_call_id, "Received.", False)]
            if self.findings_call_id
            else []
        )
        self.add_user(AVATARS_MESSAGE, results=results)
        parsed, _, _ = await self.submit(
            "avatars", "submit_avatars", problems_of, salvage_avatars
        )
        kept, removed = drop_violations(parsed.avatars, terms)
        self.warnings += removed
        self.avatars = parsed.model_copy(update={"avatars": kept})
        self.warnings += avatar_count_warnings(self.avatars)

    # -- results ---------------------------------------------------------------

    def snapshot(
        self,
        *,
        partial: bool,
        problems: list[dict[str, Any]] | None = None,
        dropped: list[dict[str, Any]] | None = None,
        quotes: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        findings = self.findings
        if problems is None:
            problems = [
                {
                    **p.model_dump(),
                    "evidence": [
                        {
                            **e.model_dump(),
                            "status": "unverified" if e.kind == "quote" else None,
                        }
                        for e in p.evidence
                    ],
                }
                for p in (findings.problems if findings else [])
            ]
        avatars = self.avatars
        snapshot: dict[str, Any] = camel_keys(
            {
                "problems": problems,
                "solutions": [s.model_dump() for s in findings.solutions]
                if findings
                else [],
                "gaps": [g.model_dump() for g in findings.gaps] if findings else [],
                "avatars": [a.model_dump() for a in avatars.avatars] if avatars else [],
                "sources": [s.model_dump() for s in avatars.sources] if avatars else [],
                "competitor_terms": self.competitor_terms,
                "dropped_quotes": dropped or [],
                "warnings": self.warnings,
                "quotes": quotes or {"verified": 0, "unverified": 0, "dropped": 0},
                "partial": partial,
                "phases_version": PHASES_VERSION,
            }
        )
        return snapshot


def _dedupe(terms: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for term in terms:
        if term.casefold() not in seen:
            seen.add(term.casefold())
            out.append(term)
    return out


async def _heartbeat(state: _Run) -> None:
    # asyncio.sleep, not _sleep: tests make _sleep instant, which would spin here.
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await state.save(heartbeatAt=_now())
        except Exception:
            logger.exception("Could not write the heartbeat of run %s", state.row.id)


async def _verify(state: _Run, *, canceled: bool) -> dict[str, Any]:
    """Check every quote (unless canceled) and build the stored findings."""
    findings = state.findings
    if findings is None or canceled:
        if canceled and findings is not None:
            state.warnings.append("Quotes were not verified (the run was canceled).")
        return state.snapshot(partial=state.stop_reason is not None)
    report = await check_quotes(findings.problems, state.observed, state.fetch)
    if report.dropped:
        state.warnings.append(
            f"{report.dropped_count} quote(s) were not found on their page and "
            "were removed."
        )
    return state.snapshot(
        partial=state.stop_reason is not None,
        problems=report.problems,
        dropped=report.dropped,
        quotes={
            "verified": report.verified,
            "unverified": report.unverified,
            "dropped": report.dropped_count,
        },
    )


async def _finish(state: _Run, stop: _Stop | None, failed: bool) -> None:
    """Write the final row: findings, evidence, coverage note, status."""
    canceled = stop is not None and stop.reason == "canceled"
    if stop is not None:
        state.stop_reason = stop.reason
    if failed:
        # An unexpected error (a bug): the system's side, stored so it is clear
        # which kind of failure this was (it does not count against the limit).
        state.stop_reason = "system_error"
    reading = assess_evidence(state.row.depth, state.reached)
    if reading.level == "LOW" and reading.reason:
        state.warnings.append(reading.reason)
    try:
        findings = await _verify(state, canceled=canceled)
    except Exception:
        logger.exception("Quote verification failed for run %s", state.row.id)
        findings = state.snapshot(partial=True)
    has_results = bool(state.findings and state.findings.problems) or bool(
        state.avatars and state.avatars.avatars
    )
    notes = list(state.notes)
    if stop is not None and stop.reason == "cap":
        notes.append(state.cap_message() + " The results are partial.")
    elif stop is not None and stop.reason == "time":
        notes.append("The run reached its time budget; the results are partial.")
    elif stop is not None and stop.reason == "no_submit" and has_results:
        notes.append(stop.message)
    note = state.avatars.coverage_note if state.avatars else ""
    coverage = "\n\n".join(
        part
        for part in (note, "Runner notes: " + " ".join(notes) if notes else "")
        if part
    )
    if canceled:
        status, error = "CANCELED", None
    elif failed:
        status, error = "FAILED", _GENERIC_FAILURE
    elif stop is not None and not has_results:
        status, error = "FAILED", stop.message
    else:
        status, error = "NEEDS_REVIEW", None
    await state.save(
        status=status,
        error=error,
        stopReason=state.stop_reason,
        findings=json.dumps(findings),
        coverageNote=coverage or None,
        customerVoiceSources=reading.count,
        evidenceLevel=reading.level,
        evidenceReason=reading.reason,
        searchesUsed=state.totals.searches,
        fetchesUsed=state.totals.fetches,
        costUsd=round(state.totals.cost_usd, 6),
        finishedAt=_now(),
        phase=None,
    )


async def execute_run(run_id: str) -> None:
    """Run one research run to its end. Never raises: the outcome goes on the row.

    Args:
        run_id: The queued ``ResearchRun``.
    """
    row = await db.researchrun.find_unique(where={"id": run_id})
    if row is None or row.status != "QUEUED":
        return
    try:
        inputs = await load_template_inputs(
            row.businessId,
            json.loads(row.productIds) or None,
            json.loads(row.extraCompetitorUrls),
        )
        template = render_template(inputs)
        state = _Run(
            row=row,
            client=make_client(),
            fetch=make_fetcher(),
            inputs=inputs,
            template_text=template.text,
        )
    except Exception:
        logger.exception("Could not prepare research run %s", run_id)
        await db.researchrun.update(
            where={"id": run_id},
            data={
                "status": "FAILED",
                "stopReason": "system_error",
                "error": _GENERIC_FAILURE,
                "finishedAt": _now(),
            },
        )
        return

    state.context_tokens = len(state.template_text) // 4 + 3_000
    state.deadline = state.loop_time() + TIME_BUDGET_SECONDS[row.depth]
    state.messages.append(
        {"role": "user", "content": [{"type": "text", "text": state.template_text}]}
    )
    await state.save(status="RUNNING", startedAt=_now(), heartbeatAt=_now())
    beat = asyncio.get_running_loop().create_task(_heartbeat(state))
    stop: _Stop | None = None
    failed = False
    try:
        await _phases(state)
    except _Stop as exc:
        stop = exc
    except Exception:
        logger.exception("Research run %s failed", run_id)
        failed = True
    finally:
        beat.cancel()
    try:
        await _finish(state, stop, failed)
    except Exception:
        logger.exception("Could not write the final state of run %s", run_id)
        await db.researchrun.update(
            where={"id": run_id},
            data={
                "status": "FAILED",
                "stopReason": "system_error",
                "error": _GENERIC_FAILURE,
                "finishedAt": _now(),
            },
        )


async def _phases(state: _Run) -> None:
    depth = state.row.depth
    brand_searches, brand_fetches = brand_step_budget(depth)
    await state.save(phase="brand")
    await state.research("brand", brand_searches, brand_fetches, brand_message)
    left_s = state.row.maxSearches - state.totals.searches
    left_f = state.row.maxFetches - state.totals.fetches
    await state.save(phase="voice")
    if left_s > 0 or left_f > 0:
        await state.research("voice", left_s, left_f, voice_message)
    else:
        state.notes.append("No search budget was left for customer-voice research.")
    await state.save(phase="findings")
    if not await state.findings_step():
        return
    await state.save(phase="avatars")
    await state.avatars_step()


__all__ = [
    "BACKOFF_SECONDS",
    "RATE_LIMIT_ATTEMPTS",
    "API_RETRY_ATTEMPTS",
    "Awaitable",
]
