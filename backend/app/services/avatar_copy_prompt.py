"""What the Creative Agent is told about a creative test's buyer avatars.

Two pieces, kept apart because they are cached differently (see creative.py):

* the **library summary**, one line per avatar, goes in the campaign context, which
  is byte-identical for a batch and for a regenerate of any ad;
* an **assigned block**, one per variant, goes in the per-call tail: the full
  profile of the avatar that variant is written to, trimmed to the fields its pillar
  uses, so a prompt carries a handful of entries rather than a whole research
  document.

The text comes from the owner's research, so every block is quarantined as data.
"""

import json
from collections.abc import Sequence

from prisma.models import BuyerAvatar

from app.services.prompt_safety import quarantine

_WHO_IN_SUMMARY = 60
_WHO_IN_BLOCK = 200
_ENTRY_CHARS = 160
_HOOKS_SHOWN = 3

_BUYS_FOR = {
    "self": "buys for themselves",
    "gift": "buys as a gift for someone else",
}

OFFER_RULE = (
    "Answer this objection only with the standing promotion or the proof points "
    "listed above; never invent an offer, guarantee, discount or perk."
)


def _cut(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _entries(stored: str) -> list[str]:
    return [str(item) for item in json.loads(stored) if str(item).strip()]


def _rotate(items: list[str], start: int, count: int = 1) -> list[str]:
    """Take ``count`` entries from ``start`` on, wrapping around.

    Variants that share an avatar start at different entries, so they do not all
    lean on the same one.
    """
    if not items:
        return []
    return [items[(start + n) % len(items)] for n in range(min(count, len(items)))]


def _buys(avatar: BuyerAvatar) -> str:
    return _BUYS_FOR.get(avatar.purchaseFor, _BUYS_FOR["self"])


def library_summary(avatars: Sequence[BuyerAvatar]) -> str:
    """The library as a quarantined block for the campaign context.

    Args:
        avatars: The business's assignable avatars.

    Returns:
        One line per avatar, or an empty string when there are none.
    """
    if not avatars:
        return ""
    lines = [
        f"- {_cut(a.name, 60)} ({_buys(a)}): {_cut(a.who, _WHO_IN_SUMMARY)}"
        for a in avatars
    ]
    return quarantine("Avatar library", "\n".join(lines))


def assigned_block(
    avatar: BuyerAvatar, heading: str, pillar: str | None, occurrence: int
) -> str:
    """The full profile of the avatar one variant is written to, as quarantined data.

    Args:
        avatar: The avatar the variant's angle was assigned (deleted or inactive
            ones too, so an ad keeps being written to the buyer it was planned for).
        heading: What the block is for, e.g. "variant B".
        pillar: The angle's pillar; it decides which field joins the problem:
            mechanism -> a mechanism, education -> something the buyer does not
            know yet, offer -> an objection to answer, emotion -> nothing more.
        occurrence: How many earlier variants share this avatar, so entries rotate.

    Returns:
        The quarantined block.
    """
    lines = [f"{_cut(avatar.name, 60)} — {_buys(avatar)}"]
    lines.append(f"Who: {_cut(avatar.who, _WHO_IN_BLOCK)}")
    for problem in _rotate(_entries(avatar.primaryProblems), occurrence):
        lines.append(f"Problem to speak to: {_cut(problem, _ENTRY_CHARS)}")
    if pillar == "mechanism":
        for mechanism in _rotate(_entries(avatar.mechanisms), occurrence):
            lines.append(f"Mechanism to show: {_cut(mechanism, _ENTRY_CHARS)}")
    elif pillar == "education":
        for unknown in _rotate(_entries(avatar.unknownProblems), occurrence):
            lines.append(
                "They do not know this yet; teach it: " + _cut(unknown, _ENTRY_CHARS)
            )
    elif pillar == "offer":
        for objection in _rotate(_entries(avatar.objections), occurrence):
            lines.append(f"Objection to answer: {_cut(objection, _ENTRY_CHARS)}")
            lines.append(OFFER_RULE)
    hooks = _rotate(_entries(avatar.hooks), occurrence, _HOOKS_SHOWN)
    if hooks:
        lines.append(
            "Hooks (inspiration for tone only, never copy one word for word): "
            + " | ".join(_cut(hook, _ENTRY_CHARS) for hook in hooks)
        )
    return quarantine(f"Avatar for {heading}", "\n".join(lines))


GUIDANCE = (
    "Each avatar block above is the customer that variant is written to: speak to "
    "their problem in their own terms and build the angle on the field its block "
    "names. Hooks are inspiration for tone only; never copy one, and never say "
    "anything about the product that the business details above do not support."
)
