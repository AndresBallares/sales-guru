"""Banned phrases and competitor names in hooks, angles and concepts (Phase 7b).

The owner's banned phrases and any competitor brand or product-line name must not
appear in the copy an avatar proposes. The runner asks the model to fix an
offending submission once; whatever still offends is dropped here, with a
warning, so it never reaches the review screen.
"""

import re
from dataclasses import dataclass
from urllib.parse import urlsplit

from app.schemas.research import ResearchAvatar, ResearchConcept
from app.services.research_text import normalize

_MIN_DOMAIN_TERM = 4
# Second-level registries where the brand is the label before them (shop.x.co.uk).
_REGISTRY_SECOND_LEVELS = {"co", "com", "org", "net", "gov", "ac"}


@dataclass(frozen=True)
class Violation:
    """One offending item: which avatar, which list, which position, which term."""

    avatar: int
    field: str
    index: int
    term: str


def competitor_terms_from_urls(urls: list[str]) -> list[str]:
    """Brand names read from competitor URLs' domains (bulgari.com -> bulgari).

    Args:
        urls: Competitor URLs. Anything that is not a URL is skipped.

    Returns:
        Lower-case brand words of at least four letters, without duplicates.
    """
    terms: list[str] = []
    for url in urls:
        host = (urlsplit(url.strip()).hostname or "").casefold()
        labels = [part for part in host.split(".") if part and part != "www"]
        if len(labels) < 2:
            continue
        index = -2
        if len(labels) >= 3 and labels[-2] in _REGISTRY_SECOND_LEVELS:
            index = -3
        brand = labels[index]
        if len(brand) >= _MIN_DOMAIN_TERM and brand not in terms:
            terms.append(brand)
    return terms


def terms_in(text: str, terms: list[str]) -> list[str]:
    """Which terms appear in the text as whole words or phrases (case, quotes folded).

    Args:
        text: Copy to check.
        terms: Banned phrases and competitor names.

    Returns:
        The terms found, in the order given.
    """
    haystack = normalize(text)
    found: list[str] = []
    for term in terms:
        wanted = normalize(term)
        if wanted and re.search(rf"(?<!\w){re.escape(wanted)}(?!\w)", haystack):
            found.append(term)
    return found


def _concept_text(concept: ResearchConcept) -> str:
    return f"{concept.name} {concept.description}"


def find_violations(avatars: list[ResearchAvatar], terms: list[str]) -> list[Violation]:
    """Every hook, angle or concept that contains a banned or competitor term.

    Args:
        avatars: The submitted avatars.
        terms: Banned phrases and competitor names.

    Returns:
        One entry per (item, term).
    """
    found: list[Violation] = []
    for a, avatar in enumerate(avatars):
        for field in ("hooks", "creative_angles"):
            for i, text in enumerate(getattr(avatar, field)):
                found += [Violation(a, field, i, t) for t in terms_in(text, terms)]
        for i, concept in enumerate(avatar.concepts):
            found += [
                Violation(a, "concepts", i, t)
                for t in terms_in(_concept_text(concept), terms)
            ]
    return found


def drop_violations(
    avatars: list[ResearchAvatar], terms: list[str]
) -> tuple[list[ResearchAvatar], list[str]]:
    """Remove every offending hook, angle and concept, and say what was removed.

    Args:
        avatars: The submitted avatars (not changed).
        terms: Banned phrases and competitor names.

    Returns:
        Copies of the avatars without the offending items, and one warning per
        removed item.
    """
    bad: dict[tuple[int, str], set[int]] = {}
    warnings: list[str] = []
    for v in find_violations(avatars, terms):
        key = (v.avatar, v.field)
        if v.index not in bad.setdefault(key, set()):
            label = v.field.replace("_", " ").rstrip("s")
            warnings.append(
                f'Avatar "{avatars[v.avatar].name}": removed a {label} that used '
                f'"{v.term}"'
            )
        bad[key].add(v.index)
    kept: list[ResearchAvatar] = []
    for a, avatar in enumerate(avatars):
        update = {
            field: [x for i, x in enumerate(getattr(avatar, field)) if i not in drop]
            for (idx, field), drop in bad.items()
            if idx == a
        }
        kept.append(avatar.model_copy(update=update))
    return kept, warnings
