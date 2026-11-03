"""Quote verification for a research run (Phase 7b, docs/phase-7.md).

Every quote the model submits is checked in code:

- shape: at most 14 words, no username, not empty (otherwise dropped);
- found word for word in text the model fetched during the run: **verified**;
- otherwise the runner fetches the quoted URL itself (``research_pages``): found
  is **verified**, page read but quote absent is **dropped**, page unreadable
  (403, 404, timeout, blocked) is kept and labeled **unverified**.

A problem whose quotes are all dropped is marked ``inferred``. Page text is only
compared; the report holds quotes and URLs, never page text.
"""

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from app.schemas.research import ResearchProblem
from app.services.research_pages import PageFetch, fetch_page_text
from app.services.research_text import norm_url, quote_in_text, quote_problem

Fetcher = Callable[[str], Awaitable[PageFetch]]

# Bounds the extra network work of one run's verification.
MAX_VERIFY_FETCHES = 25
_CONCURRENCY = 5


@dataclass
class QuoteReport:
    """The problems with each quote's status, and what was removed."""

    problems: list[dict[str, Any]] = field(default_factory=list)
    dropped: list[dict[str, Any]] = field(default_factory=list)
    verified: int = 0
    unverified: int = 0

    @property
    def dropped_count(self) -> int:
        """How many quotes were removed."""
        return len(self.dropped)


async def _fetch_all(urls: list[str], fetcher: Fetcher) -> dict[str, PageFetch | None]:
    """Fetch each URL once (first MAX_VERIFY_FETCHES only); None means not tried."""
    results: dict[str, PageFetch | None] = dict.fromkeys(urls)
    semaphore = asyncio.Semaphore(_CONCURRENCY)

    async def one(url: str) -> None:
        async with semaphore:
            results[url] = await fetcher(url)

    await asyncio.gather(*(one(u) for u in urls[:MAX_VERIFY_FETCHES]))
    return results


async def check_quotes(
    problems: list[ResearchProblem],
    observed: dict[str, str],
    fetcher: Fetcher = fetch_page_text,
) -> QuoteReport:
    """Verify every quote in the problems' evidence.

    Args:
        problems: The submitted problems.
        observed: Text the model fetched during the run, keyed by ``norm_url``.
            Held in memory by the runner and never stored.
        fetcher: Fetches a page's text (the SSRF-guarded fetch by default).

    Returns:
        The problems as dicts (evidence carries ``status``), the dropped quotes,
        and the verified and unverified counts.
    """
    to_fetch: list[str] = []
    seen: set[str] = set()
    for problem in problems:
        for ev in problem.evidence:
            key = norm_url(ev.source_url)
            if (
                ev.kind == "quote"
                and quote_problem(ev.text) is None
                and key not in seen
                # The model's own copy of a page may be filtered or cut short, so
                # not finding the quote there proves nothing: only the runner's
                # fetch can show the quote is absent.
                and not quote_in_text(ev.text, observed.get(key, ""))
            ):
                seen.add(key)
                to_fetch.append(ev.source_url)
    pages = await _fetch_all(to_fetch, fetcher)
    by_key = {norm_url(u): page for u, page in pages.items()}

    report = QuoteReport()
    for problem in problems:
        kept: list[dict[str, Any]] = []
        for ev in problem.evidence:
            item = ev.model_dump()
            if ev.kind != "quote":
                kept.append({**item, "status": None})
                continue
            verdict = _verdict(ev.text, ev.source_url, observed, by_key)
            if verdict in ("verified", "unverified"):
                kept.append({**item, "status": verdict})
                if verdict == "verified":
                    report.verified += 1
                else:
                    report.unverified += 1
            else:
                report.dropped.append(
                    {
                        "problem": problem.number,
                        "text": ev.text,
                        "source_url": ev.source_url,
                        "reason": verdict,
                    }
                )
        has_quote = any(e["kind"] == "quote" for e in kept)
        dropped_any = len(kept) < len(problem.evidence)
        report.problems.append(
            {
                **problem.model_dump(),
                "evidence": kept,
                "inferred": problem.inferred or (dropped_any and not has_quote),
            }
        )
    return report


def _verdict(
    text: str,
    url: str,
    observed: dict[str, str],
    pages: dict[str, PageFetch | None],
) -> str:
    """verified, unverified, or why to drop it (empty/too_long/username/not_found)."""
    shape = quote_problem(text)
    if shape is not None:
        return shape
    key = norm_url(url)
    if quote_in_text(text, observed.get(key, "")):
        return "verified"
    page = pages.get(key)
    if page is None or page.status != "ok" or page.text is None:
        return "unverified"
    return "verified" if quote_in_text(text, page.text) else "not_found"
