"""Meta ad-quality grounding for the Creative Agent, and the phrase guard.

Meta scores every ad per viewer on quality, engagement likelihood and
conversion likelihood. Two things follow from that for the copy we generate:
the Creative Agent's prompt carries a short rule block (rule_lines), and copy
containing engagement bait or withholding patterns is rejected
(banned_phrases_in), at generation time and again at the pre-publish copy
guard. Copy only: bidding, pacing and budget belong to the Strategist and the
Optimizer, never here. Imports nothing from the app, so the schemas can use it.

It also holds the "Ad structure" rules (offer or risk-reducer, mechanism tied
to the benefit, no generic praise, education as an angle) and the generic-
praise opener check.
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


def materials_note(industry: str | None) -> str:
    """The industry-specific extension of rule 4, without its leading space.

    Kept apart from rule_lines so the rules themselves are identical for
    every industry (and so cacheable as one block); the Creative Agent puts
    this note in the per-request half of the prompt instead.

    Args:
        industry: Business.industry.

    Returns:
        The note, or an empty string for an industry with none.
    """
    return _MATERIALS_RULE_BY_INDUSTRY.get(industry or "", "").strip()


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


def structure_lines() -> list[str]:
    """The "Ad structure" block of the Creative Agent's prompt: rules, not essay.

    Offer, mechanism, education and avatar are the four pillars an ad is built
    from; the strategy gives each variant its pillar and avatar, and these
    rules say how the copy delivers them.

    Returns:
        The prompt lines, starting with a blank separator line.
    """
    return [
        "",
        "Ad structure (apply to every variant):",
        "1. Offer: include at least one offer element or risk-reducer, the "
        "standing promotion if there is one, otherwise a listed proof point "
        "that lowers purchase risk (guarantee, free returns, free shipping). "
        "Never invent one.",
        "2. Mechanism: if the product has a mechanism, connect it to the "
        "benefit. It is why the promise is believable, not a spec to list "
        '("ceramic inlay means the color never fades", not "features '
        'ceramic").',
        '3. No generic praise: "beautiful", "stunning" or "amazing" only with '
        "a concrete specific. Prefer the material plus what it does for the "
        "wearer.",
        "4. Education is a valid angle: teach one thing the buyer doesn't "
        "know (why a material lasts, how to spot quality) and tie it to this "
        "product.",
        "5. Follow each variant's pillar (offer, mechanism, education or "
        "emotion) and its avatar as listed above.",
    ]


# Adjectives that are praise and nothing else. An opener that is only this
# says nothing the buyer can check, so it is blocked when no concrete detail
# comes with it in the same sentence.
GENERIC_PRAISE_WORDS: tuple[str, ...] = (
    "beautiful",
    "stunning",
    "amazing",
    "gorgeous",
    "lovely",
    "incredible",
)

# What makes an opening sentence concrete: a digit (18k, 2 carats, $450), a
# material, or a named craft detail. A jewelry-leaning list, extended per
# industry the same way the other tables are.
_CONCRETE_WORDS: tuple[str, ...] = (
    "gold",
    "silver",
    "platinum",
    "diamond",
    "gemstone",
    "sapphire",
    "emerald",
    "ruby",
    "pearl",
    "opal",
    "ceramic",
    "enamel",
    "titanium",
    "steel",
    "sterling",
    "leather",
    "silk",
    "cotton",
    "wool",
    "cashmere",
    "hand-set",
    "handmade",
    "handcrafted",
    "hand-applied",
    "inlay",
    "carat",
)
_CONCRETE = re.compile(
    r"\d|\b(?:" + "|".join(re.escape(w) for w in _CONCRETE_WORDS) + r")",
    re.IGNORECASE,
)
_PRAISE_OPENER = re.compile(
    r"^\W*(" + "|".join(GENERIC_PRAISE_WORDS) + r")\b", re.IGNORECASE
)
_FIRST_SENTENCE = re.compile(r"[^.!?\n]*")


def generic_praise_opener(text: str | None) -> str | None:
    """The praise word a primary text opens with, if the opener is only praise.

    Only the first sentence is looked at: it must start with a generic praise
    word and name nothing concrete (no digit, material or craft detail).
    "Stunning 18k gold, hand-set." passes, and so does praise anywhere after
    the opener; "Beautiful jewelry." and "Stunning pieces for her" do not.

    Args:
        text: A primary text.

    Returns:
        The opening praise word as written, or None when the opener is fine.
    """
    if not text:
        return None
    opener = _PRAISE_OPENER.match(text.strip())
    if opener is None:
        return None
    sentence = _FIRST_SENTENCE.match(text.strip())
    if sentence is not None and _CONCRETE.search(sentence.group(0)):
        return None
    return opener.group(1)


def praise_opener_problems(label: str, text: str | None) -> list[str]:
    """One problem if a primary text opens with generic praise and nothing concrete.

    Args:
        label: The field's name as the reader sees it ("primary text").
        text: The field's copy.

    Returns:
        Empty when the opener is fine.
    """
    word = generic_praise_opener(text)
    if word is None:
        return []
    return [
        f"{label} opens with generic praise ('{word}') and names no material or "
        "specific detail; lead with the material and what it does for the wearer"
    ]
