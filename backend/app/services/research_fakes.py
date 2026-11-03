"""Canned research runs for tests and FAKE_LLM (Phase 7b). Costs nothing, no network.

Everything here is built from the real Pydantic models (``SubmitFindings``,
``SubmitAvatars``), so a change to the schemas breaks the fakes loudly instead of
letting a canned run drift from the real contract. ``FakeResearchClient`` plays a
whole run by phase; ``CANNED_PAGES`` is what its quoted URLs "contain", used by
``fake_fetch`` in place of the guarded network fetch.
"""

from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from app.schemas.research import (
    AVATAR_COUNT,
    PROBLEM_COUNT,
    SOLUTION_COUNT,
    Evidence,
    ResearchAvatar,
    ResearchConcept,
    ResearchGap,
    ResearchProblem,
    ResearchSolution,
    ResearchSource,
    SubmitAvatars,
    SubmitFindings,
)
from app.services.research_client import Observation, Phase, SubmitCall, Turn
from app.services.research_pages import PageFetch
from app.services.research_text import norm_url

BRAND_PAGE = "https://brand.example.com/"
COMPETITOR_PAGE = "https://www.rivalring.com/rings"
VOICE_URLS = [
    "https://www.reddit.com/r/jewelry/comments/1abc/green_finger/",
    "https://www.reddit.com/r/rings/comments/2def/sizing/",
    "https://www.trustpilot.com/review/rivalring.com",
    "https://www.quora.com/Does-gold-vermeil-tarnish",
]
_QUOTES = [
    "it turns my finger green after a week",
    "I never know what size to order online",
    "the plating wore off in a month",
    "nobody tells you what it is actually made of",
]
CANNED_PAGES: dict[str, str] = {
    norm_url(url): f"Thread. {quote}. More replies follow."
    for url, quote in zip(VOICE_URLS, _QUOTES, strict=True)
}
COMPETITOR_TERMS = ["Rivalring", "Rival Serpent Line"]


def fake_usage(
    *,
    fresh: int = 10,
    output: int = 100,
    cache_write: int = 1_000,
    cache_read: int = 0,
    searches: int = 0,
    fetches: int = 0,
) -> Any:  # noqa: ANN401
    """A ``usage`` object shaped like the API's, for ``UsageTotals.add``."""
    return SimpleNamespace(
        input_tokens=fresh,
        output_tokens=output,
        cache_creation_input_tokens=cache_write,
        cache_read_input_tokens=cache_read,
        cache_creation=None,
        server_tool_use=SimpleNamespace(
            web_search_requests=searches, web_fetch_requests=fetches
        ),
    )


def canned_findings() -> SubmitFindings:
    """20 problems (the first four quoted from ``VOICE_URLS``), 20 solutions, 1 gap."""
    problems = []
    for n in range(1, PROBLEM_COUNT + 1):
        if n <= len(VOICE_URLS):
            evidence = [
                Evidence(
                    kind="quote", text=_QUOTES[n - 1], source_url=VOICE_URLS[n - 1]
                )
            ]
        else:
            evidence = [
                Evidence(
                    kind="inference", text="Likely, from category pages", source_url=""
                )
            ]
        problems.append(
            ResearchProblem(
                number=n,
                problem=f"Problem {n} customers in this category have",
                evidence=evidence,
                inferred=n > len(VOICE_URLS),
            )
        )
    solutions = [
        ResearchSolution(
            number=n,
            solution=f"Solution {n}",
            problem_numbers=[n],
            mechanism="Hand-finished solid gold",
            inferred=False,
        )
        for n in range(1, SOLUTION_COUNT + 1)
    ]
    return SubmitFindings(
        problems=problems,
        solutions=solutions,
        gaps=[ResearchGap(need="Free resizing for life", problem_numbers=[2])],
        competitor_terms=list(COMPETITOR_TERMS),
    )


def canned_avatars() -> SubmitAvatars:
    """Five avatars with 5 hooks, 3 angles and 2 concepts each; no banned terms."""
    avatars = [
        ResearchAvatar(
            name=f"Avatar {n}",
            who=f"Who avatar {n} is",
            purchase_for="self" if n % 2 else "gift",
            primary_problems=[n],
            unknown_problems=["What plating really is"],
            primary_solutions=[n],
            alternatives=["Department store rings"],
            objections=["Is it worth the price?"],
            hooks=[f"Avatar {n} hook {h}" for h in range(1, 6)],
            creative_angles=[f"Avatar {n} angle {a}" for a in range(1, 4)],
            concepts=[
                ResearchConcept(
                    name=f"Concept {n}a", pillar="offer", description="One line"
                ),
                ResearchConcept(
                    name=f"Concept {n}b", pillar="education", description="One line"
                ),
            ],
            inferred=n > 2,
        )
        for n in range(1, AVATAR_COUNT + 1)
    ]
    return SubmitAvatars(
        avatars=avatars,
        coverage_note="Reached the brand page, one competitor and four customer pages.",
        sources=[
            ResearchSource(url=u, title=f"Source {i}", reached=True)
            for i, u in enumerate([BRAND_PAGE, COMPETITOR_PAGE, *VOICE_URLS], start=1)
        ],
    )


def fetch_observation(url: str, text: str = "") -> Observation:
    """A successful fetch result."""
    return Observation("fetch", url=url, text=text or None)


def search_observation(url: str) -> Observation:
    """A search result."""
    return Observation("search", url=url, title="result")


def submit_turn(name: str, payload: dict[str, Any], *, usage: Any = None) -> Turn:  # noqa: ANN401
    """A turn that ends by calling a submit tool."""
    return Turn(
        stop_reason="tool_use",
        content=[
            SimpleNamespace(type="tool_use", name=name, id=f"tu_{name}", input=payload)
        ],
        submits={name: SubmitCall(f"tu_{name}", payload)},
        usage=usage or fake_usage(output=5_000, cache_read=20_000),
    )


async def fake_fetch(url: str) -> PageFetch:
    """The FAKE_LLM stand-in for the guarded network fetch: canned pages only."""
    text = CANNED_PAGES.get(norm_url(url))
    if text is None:
        return PageFetch("unreachable", "http_404", None)
    return PageFetch("ok", "ok", text)


@dataclass
class FakeResearchClient:
    """Plays a complete, healthy run by phase (FAKE_LLM)."""

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
        """Answer the phase with canned content.

        Args:
            model: Ignored.
            system: Ignored.
            messages: Ignored.
            tools: Ignored.
            max_tokens: Ignored.
            phase: Which phase is asking.
            step: Ignored.

        Returns:
            A canned turn for the phase.
        """
        if phase == "brand":
            return Turn(
                observations=[
                    fetch_observation(BRAND_PAGE),
                    fetch_observation(COMPETITOR_PAGE),
                ],
                usage=fake_usage(searches=0, fetches=2, cache_read=2_000),
            )
        if phase == "voice":
            return Turn(
                observations=[search_observation(u) for u in VOICE_URLS],
                usage=fake_usage(searches=4, fetches=0, cache_read=8_000),
            )
        if phase == "findings":
            return submit_turn("submit_findings", canned_findings().model_dump())
        return submit_turn("submit_avatars", canned_avatars().model_dump())
