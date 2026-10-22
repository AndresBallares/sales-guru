"""Meta ad-quality grounding for the Creative Agent, and the phrase guard.

Meta scores every ad per viewer on quality, engagement likelihood and
conversion likelihood. Two things follow from that for the copy we generate:
the Creative Agent's prompt carries a short rule block (rule_lines), and copy
containing engagement bait or withholding patterns is rejected
(banned_phrases_in), at generation time and again at the pre-publish copy
guard. Copy only: bidding, pacing and budget belong to the Strategist and the
Optimizer, never here. Imports nothing from the app, so the schemas can use it.
"""

import re

# Engagement bait and withholding patterns Meta's ranking penalizes. Matched
# case-insensitively on whole words, so "tag a" catches "Tag a friend" but not
# "price tag accompanies". The three "tag ..." variants beyond the original
# "tag a" cover the common ways the same bait is worded.
BANNED_PHRASES: tuple[str, ...] = (
    "tag a",
    "tag an",
    "tag your",
    "tag someone",
    "comment below",
    "share this",
    "you won't believe",
    "wait until you see",
    "find out why",
)

# An apostrophe may arrive curly ("won’t"); the phrases are written with ' only.
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'", "`": "'"})

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (
        phrase,
        re.compile(
            r"\b" + r"\s+".join(re.escape(word) for word in phrase.split()) + r"\b",
            re.IGNORECASE,
        ),
    )
    for phrase in BANNED_PHRASES
)


def banned_phrases_in(text: str | None) -> list[str]:
    """The banned phrases a piece of copy contains, in list order.

    Args:
        text: One copy field (headline, primary text, description, a card's
            headline or description); None or empty has none.

    Returns:
        Each banned phrase found, once, as written in BANNED_PHRASES.
    """
    if not text:
        return []
    normalized = text.translate(_APOSTROPHES)
    return [phrase for phrase, pattern in _PATTERNS if pattern.search(normalized)]


# Extra wording for rule 4, per industry — same extension pattern as the
# creative module's other per-industry tables.
_MATERIALS_RULE_BY_INDUSTRY: dict[str, str] = {
    "FASHION_JEWELRY": (
        " For jewelry, state materials and craftsmanship plainly (18k gold, "
        "hand-set); that outperforms hype."
    ),
}


def rule_lines(industry: str | None) -> list[str]:
    """The "Meta ad quality rules" block of the Creative Agent's prompt.

    Rules only, no explanation, kept under about 200 words.

    Args:
        industry: Business.industry, for the industry-specific part of rule 4.

    Returns:
        The prompt lines, starting with a blank separator line.
    """
    materials = _MATERIALS_RULE_BY_INDUSTRY.get(industry or "", "")
    return [
        "",
        "Meta ad quality rules (apply to every variant):",
        "1. Meta ranks every ad on quality, engagement likelihood and "
        "conversion likelihood against ads competing for the same audience. "
        "Relevant, honest creative wins auctions over bigger budgets.",
        '2. No engagement bait: never "tag a friend", "comment below", '
        '"share if you agree", or ask for reactions.',
        "3. Never withhold information to force clicks: no \"you won't "
        'believe...", no hiding the product, no price teasing, no '
        "curiosity-gap hooks the landing page doesn't immediately pay off.",
        "4. No exaggerated or sensationalized claims; claims must match what "
        "the product page shows." + materials,
        "5. The first line of primary text and the visual's first seconds "
        "carry the ranking weight: lead with the product's strongest "
        "concrete hook (material, craftsmanship, the moment it is worn), "
        "never throat-clearing.",
        "6. Write native content for the person in the variant's avatar: the "
        "ad is scored per viewer, so angle and avatar alignment matter more "
        "than cleverness.",
        "7. Clickbait phrasing, ALL CAPS, excessive punctuation!!! and emoji "
        "walls reduce delivery and raise costs; clean, specific, confident "
        "copy is rewarded.",
    ]


def copy_field_problems(label: str, text: str | None) -> list[str]:
    """One problem per banned phrase in a copy field, worded for a person.

    Args:
        label: The field's name as the reader sees it ("primary text").
        text: The field's copy.

    Returns:
        Empty when the copy is clean.
    """
    return [
        f"{label} contains '{phrase}', engagement bait or withheld information "
        "that Meta's ad ranking penalizes"
        for phrase in banned_phrases_in(text)
    ]
