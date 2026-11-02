"""Names and UTM parameters for a creative test's ads.

A creative test ad carries a structured pair, an avatar (who it speaks to)
and a concept (the idea it tests). Both the ad's name on Meta and its UTM
parameters are derived from that pair, so the same ad reads the same in
Ads Manager, in this app's logs and in the store's analytics.
"""

import re
import unicodedata
from collections.abc import Callable
from urllib.parse import quote

# Meta's limit on an ad's name. A name here is far shorter (a buyer type, a 24
# character slug, a 30 character concept and a pillar), so this is a ceiling the
# tests check, not a truncation the code applies.
META_AD_NAME_LIMIT = 400
MAX_SLUG_LENGTH = 24

AVATAR_LABELS = {"self_purchaser": "Self-purchaser", "gift_buyer": "Gift buyer"}
PILLAR_LABELS = {
    "offer": "Offer",
    "mechanism": "Mechanism",
    "education": "Education",
    "emotion": "Emotion",
}


def concept_label(concept: str) -> str:
    """A concept slug as readable text: "everyday-wear" -> "Everyday wear"."""
    return concept.replace("-", " ").capitalize()


def _label(avatar: str, concept: str, pillar: str | None, slug: str | None) -> str:
    buyer = AVATAR_LABELS.get(avatar, avatar)
    if slug:
        buyer += f" ({slug})"
    label = f"{buyer} – {concept_label(concept)}"
    if pillar:
        label += f" – {PILLAR_LABELS.get(pillar, pillar)}"
    return label


def angle_label(avatar: str, concept: str, pillar: str | None = None) -> str:
    """The angle's label: "<Avatar> – <Concept>", or with " – <Pillar>" after it.

    En dashes. The pillar goes last, so an ad's name still starts with its
    avatar and concept, and an older ad without a pillar keeps its name. This
    string is also the key the Creative Agent's variants are matched back to the
    plan's angles by, so it never carries a library avatar's slug.
    """
    return _label(avatar, concept, pillar, None)


def avatar_slug(name: str) -> str:
    """A library avatar's name as a short slug for ad names.

    Lowercase ASCII words joined by hyphens, a leading "The" dropped, at most
    MAX_SLUG_LENGTH characters cut at a word boundary ("The Promotion Ring
    Buyer" -> "promotion-ring-buyer"). A name with nothing usable gives "avatar".
    """
    folded = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    words = re.findall(r"[a-z0-9]+", folded.lower())
    if len(words) > 1 and words[0] == "the":
        words = words[1:]
    slug = ""
    for word in words:
        candidate = f"{slug}-{word}" if slug else word
        if len(candidate) > MAX_SLUG_LENGTH:
            if not slug:
                slug = word[:MAX_SLUG_LENGTH]
            break
        slug = candidate
    return slug or "avatar"


def free_slug(slug: str, is_taken: Callable[[str], bool]) -> str:
    """The slug, or the first "<slug>-2", "<slug>-3"... that is not taken.

    Args:
        slug: The slug wanted.
        is_taken: Whether a candidate slug would clash with an existing name.
    """
    candidate = slug
    number = 2
    while is_taken(candidate):
        candidate = f"{slug}-{number}"
        number += 1
    return candidate


def ad_name(
    avatar: str | None,
    concept: str | None,
    fallback: str,
    pillar: str | None = None,
    slug: str | None = None,
) -> str:
    """The ad's name on Meta: its angle label, or the fallback for an older ad.

    With a slug (an ad written for a library avatar) the buyer type is followed by
    it in parentheses: "Self-purchaser (promotion-ring-buyer) – Ceramic inlay".
    """
    if avatar and concept:
        return _label(avatar, concept, pillar, slug)
    return fallback


def url_tags(
    *,
    campaign_name: str,
    avatar: str | None,
    concept: str | None,
    name: str,
    pillar: str | None = None,
) -> str:
    """The ad's UTM parameters, as Meta's `url_tags` string.

    utm_source is always paid_social. utm_medium is "<avatar>-<concept>"
    (for example "self-purchaser-everyday-wear"), or "paid" for an ad with no
    structured angle. utm_campaign and utm_content are the campaign and ad
    names, percent-encoded. An ad with a pillar adds utm_term=<pillar>, so
    utm_medium keeps meaning avatar and concept only.

    Args:
        campaign_name: The campaign's name.
        avatar: The ad's avatar, if it has one.
        concept: The ad's concept slug, if it has one.
        name: The ad's name on Meta.
        pillar: The ad's pillar, if it has one.

    Returns:
        The query string, without a leading "?".
    """
    medium = f"{avatar.replace('_', '-')}-{concept}" if avatar and concept else "paid"
    tags = (
        f"utm_source=paid_social&utm_medium={quote(medium, safe='')}"
        f"&utm_campaign={quote(campaign_name, safe='')}"
        f"&utm_content={quote(name, safe='')}"
    )
    return f"{tags}&utm_term={quote(pillar, safe='')}" if pillar else tags
