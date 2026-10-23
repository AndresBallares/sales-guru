"""Names and UTM parameters for a creative test's ads.

A creative test ad carries a structured pair, an avatar (who it speaks to)
and a concept (the idea it tests). Both the ad's name on Meta and its UTM
parameters are derived from that pair, so the same ad reads the same in
Ads Manager, in this app's logs and in the store's analytics.
"""

from urllib.parse import quote

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


def angle_label(avatar: str, concept: str, pillar: str | None = None) -> str:
    """The ad's name: "<Avatar> – <Concept>", or "<Avatar> – <Concept> – <Pillar>".

    En dashes. The pillar goes last, so an ad's name still starts with its
    avatar and concept, and an older ad without a pillar keeps its name.
    """
    label = f"{AVATAR_LABELS.get(avatar, avatar)} – {concept_label(concept)}"
    if pillar:
        label += f" – {PILLAR_LABELS.get(pillar, pillar)}"
    return label


def ad_name(
    avatar: str | None,
    concept: str | None,
    fallback: str,
    pillar: str | None = None,
) -> str:
    """The ad's name on Meta: its angle label, or the fallback for an older ad."""
    if avatar and concept:
        return angle_label(avatar, concept, pillar)
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
