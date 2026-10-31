"""Schemas for a business's brand rules: banned phrases and required disclosures.

Banned phrases are the business's own additions to the global list in
``app.services.ad_quality`` (engagement bait and withheld information); they are
matched case-insensitively as whole phrases. Required disclosures are lines the
business must be able to state ("Made to order: ships in 2 weeks"); storing
them is all this step does.
"""

import re

from pydantic import Field, field_validator

from app.schemas.base import CamelCaseModel

MAX_BANNED_PHRASES = 50
MAX_BANNED_PHRASE_LENGTH = 80
MAX_DISCLOSURES = 10
MAX_DISCLOSURE_LENGTH = 200


def _clean_phrases(value: list[str]) -> list[str]:
    """Normalize banned phrases: trim, collapse spaces, drop blanks and repeats.

    Args:
        value: The phrases as sent.

    Returns:
        The phrases with single spaces, a repeat in another case dropped (the
        first spelling is kept).

    Raises:
        ValueError: If a phrase is too long or has no letter or digit, or there
            are too many.
    """
    seen: set[str] = set()
    cleaned: list[str] = []
    for item in value:
        phrase = " ".join(item.split())
        if not phrase:
            continue
        if len(phrase) > MAX_BANNED_PHRASE_LENGTH:
            raise ValueError(
                f"Each phrase must be at most {MAX_BANNED_PHRASE_LENGTH} "
                f"characters (got {len(phrase)}): {phrase[:40]!r}..."
            )
        if not re.search(r"\w", phrase):
            raise ValueError(f"A phrase needs a letter or digit: {phrase!r}")
        if phrase.casefold() in seen:
            continue
        seen.add(phrase.casefold())
        cleaned.append(phrase)
    if len(cleaned) > MAX_BANNED_PHRASES:
        raise ValueError(f"At most {MAX_BANNED_PHRASES} phrases (got {len(cleaned)})")
    return cleaned


def _clean_disclosures(value: list[str]) -> list[str]:
    """Trim required disclosures, drop blanks and enforce the caps."""
    cleaned = [item.strip() for item in value if item.strip()]
    for item in cleaned:
        if len(item) > MAX_DISCLOSURE_LENGTH:
            raise ValueError(
                f"Each disclosure must be at most {MAX_DISCLOSURE_LENGTH} "
                f"characters (got {len(item)}): {item[:40]!r}..."
            )
    if len(cleaned) > MAX_DISCLOSURES:
        raise ValueError(f"At most {MAX_DISCLOSURES} disclosures (got {len(cleaned)})")
    return cleaned


class BrandRulesRequest(CamelCaseModel):
    """Payload for PUT: the business's rules in full (a missing list becomes empty)."""

    banned_phrases: list[str] = Field(default_factory=list)
    required_disclosures: list[str] = Field(default_factory=list)

    @field_validator("banned_phrases")
    @classmethod
    def _validate_phrases(cls, value: list[str]) -> list[str]:
        return _clean_phrases(value)

    @field_validator("required_disclosures")
    @classmethod
    def _validate_disclosures(cls, value: list[str]) -> list[str]:
        return _clean_disclosures(value)


class BrandRulesResponse(CamelCaseModel):
    """A business's brand rules; both lists are empty before any are set."""

    business_id: str
    banned_phrases: list[str]
    required_disclosures: list[str]
