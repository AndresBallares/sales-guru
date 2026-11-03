"""Customer-voice evidence for a research run (Phase 7b, docs/phase-7.md).

The point of the run is what real customers say, so the runner counts the
forum, Reddit, review and Q&A pages it actually reached, from the search and
fetch results it saw itself (never from what the model claims). Below a minimum
per depth the run still completes, marked "low evidence" with the reason, so the
review screen (7c) can show it prominently.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from app.schemas.research import Depth
from app.services.research_text import norm_url

SourceKind = Literal["reddit", "forum", "review", "qa"]

# A product choice, not a measurement: roughly half of the depth's search cap.
MIN_CUSTOMER_VOICE: dict[str, int] = {"light": 3, "standard": 6, "deep": 10}

_REVIEW_HOSTS = (
    "trustpilot.com",
    "sitejabber.com",
    "yelp.com",
    "reviews.io",
    "bbb.org",
    "consumeraffairs.com",
    "productreview.com",
    "reviewcentre.com",
)
_QA_HOSTS = ("quora.com", "stackexchange.com", "stackoverflow.com", "answers.com")


def classify_source(url: str) -> SourceKind | None:
    """What kind of customer-voice page a URL looks like, or None for anything else.

    Args:
        url: A page URL.

    Returns:
        ``reddit``, ``review``, ``qa``, ``forum``, or None.
    """
    parts = urlsplit(url.strip())
    host = (parts.hostname or "").casefold()
    path = parts.path.casefold()
    if not host or "." not in host:
        return None
    if host == "reddit.com" or host.endswith(".reddit.com"):
        return "reddit"
    if any(host == h or host.endswith("." + h) for h in _REVIEW_HOSTS):
        return "review"
    if any(host == h or host.endswith("." + h) for h in _QA_HOSTS):
        return "qa"
    if "/product-reviews/" in path or host.startswith(("reviews.", "review.")):
        return "review"
    if host.startswith(("forum.", "forums.", "community.", "discuss.")) or any(
        marker in path for marker in ("/forum/", "/forums/", "/threads/")
    ):
        return "forum"
    return None


@dataclass(frozen=True)
class EvidenceReading:
    """How many customer-voice sources a run reached, and whether that is enough."""

    count: int
    level: Literal["OK", "LOW"]
    reason: str | None


def assess_evidence(depth: Depth | str, reached_urls: Iterable[str]) -> EvidenceReading:
    """Count distinct customer-voice pages reached and compare with the depth's minimum.

    Args:
        depth: The run's depth.
        reached_urls: Every URL the run got content for (search results and
            successful fetches). Errors are not passed in.

    Returns:
        The count, ``OK`` or ``LOW``, and for ``LOW`` a plain-language reason.
    """
    distinct = {norm_url(u) for u in reached_urls if classify_source(u) is not None}
    minimum = MIN_CUSTOMER_VOICE[depth]
    if len(distinct) >= minimum:
        return EvidenceReading(len(distinct), "OK", None)
    return EvidenceReading(
        len(distinct),
        "LOW",
        f"Reached {len(distinct)} customer-voice sources (forums, Reddit, reviews, "
        f"Q&A); a {depth} run needs at least {minimum}. Treat the problems as "
        "mostly inferred.",
    )
