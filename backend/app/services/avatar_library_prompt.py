"""Prompt text for the Strategist when a business has library buyer avatars.

Kept out of strategist.py: the avatar block, the instructions that tell the model
how many avatars to cover, and the fake-mode stand-in all depend only on the
library, and both the first batch and the follow-up rounds use them.
"""

import json
import logging
import math
from collections.abc import Mapping, Sequence

from prisma.models import BuyerAvatar

from app.services.prompt_safety import quarantine
from app.services.round_results import AdResult, RoundResults

logger = logging.getLogger(__name__)

# One avatar's lines stay short: the model picks an avatar and a problem or two,
# it does not need the whole research profile (the Creative Agent gets that later).
_WHO_CHARS = 200
_ITEM_CHARS = 160
_ITEMS_SHOWN = 2

_BUYS_FOR = {"self": "themselves", "gift": "someone else, as a gift"}


def library_by_id(avatars: Sequence[BuyerAvatar]) -> dict[str, str]:
    """Each avatar's id mapped to its purchase_for (self or gift)."""
    return {avatar.id: avatar.purchaseFor for avatar in avatars}


def _cut(text: str, limit: int) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _some(stored: str) -> str:
    """The first few entries of a stored JSON list, each cut short."""
    items = [str(item) for item in json.loads(stored) if str(item).strip()]
    return "; ".join(_cut(item, _ITEM_CHARS) for item in items[:_ITEMS_SHOWN])


def library_block(avatars: Sequence[BuyerAvatar]) -> str:
    """The avatar library as a quarantined block for the request details.

    The text comes from the owner's research document, so it is wrapped as data.
    """
    lines: list[str] = []
    for avatar in avatars:
        line = (
            f"- id {avatar.id} | {_cut(avatar.name, 60)} | buys for "
            f"{_BUYS_FOR.get(avatar.purchaseFor, 'themselves')} | "
            f"who: {_cut(avatar.who, _WHO_CHARS)}"
        )
        problems = _some(avatar.primaryProblems)
        hooks = _some(avatar.hooks)
        if problems:
            line += f" | problems: {problems}"
        if hooks:
            line += f" | hooks: {hooks}"
        lines.append(line)
    return quarantine("Buyer avatar library", "\n".join(lines))


def coverage_sentence(library: Mapping[str, str]) -> str:
    """How many avatars the four first-batch angles must cover, and which kinds."""
    count = len(library)
    if count >= 3:
        sentence = (
            "Across the four angles, cover at least 3 different avatars of the library."
        )
    elif count == 2:
        sentence = "Cover both avatars of the library across the four angles."
    else:
        sentence = "Every angle speaks to the library's one avatar."
    if set(library.values()) >= {"self", "gift"}:
        sentence += (
            " The library has avatars who buy for themselves and avatars who buy "
            "gifts; cover at least one of each."
        )
    return sentence


def log_relaxed_kind_rule(library: Mapping[str, str]) -> None:
    """Say so when the self-and-gift coverage rule cannot apply to this library."""
    kinds = set(library.values())
    if kinds >= {"self", "gift"}:
        return
    missing = "gift" if "gift" not in kinds else "self"
    logger.info(
        "Creative test plan: the library has no %s avatar, so the rule that the "
        "angles cover both self and gift buyers is relaxed",
        missing,
    )


def fake_library_angles(
    angles: Sequence[object],
    avatars: Sequence[BuyerAvatar],
    favored_id: str | None = None,
) -> list[dict[str, object]]:
    """Give canned angles library avatars that satisfy the coverage rules.

    Puts one self and one gift avatar first when the library has both, then
    cycles through the rest, so a library of three or more is covered by three or
    more different avatars.
    """
    selfs = [a for a in avatars if a.purchaseFor == "self"]
    gifts = [a for a in avatars if a.purchaseFor == "gift"]
    ordered: list[BuyerAvatar] = [*selfs[:1], *gifts[:1]]
    ordered += [a for a in avatars if a not in ordered]
    ids = [ordered[position % len(ordered)].id for position in range(len(angles))]
    if favored_id is not None:
        # A round after a winner: at least half on the winning avatar, the rest
        # spread over the others.
        others = [a.id for a in avatars if a.id != favored_id]
        on_winner = math.ceil(len(angles) / 2) if others else len(angles)
        ids = [favored_id] * on_winner + [
            others[n % len(others)] for n in range(len(angles) - on_winner)
        ]
    fitted: list[dict[str, object]] = []
    for angle, avatar_id in zip(angles, ids, strict=True):
        assert isinstance(angle, dict)
        fitted.append(
            {
                **{k: v for k, v in angle.items() if k != "avatar"},
                "buyer_avatar_id": avatar_id,
            }
        )
    return fitted


def winning_avatar_id(
    results: RoundResults | None, library: Mapping[str, str]
) -> str | None:
    """The library avatar of the winning ad, if it can still be assigned."""
    if results is None or results.leader is None:
        return None
    avatar_id = results.leader.angle.buyer_avatar_id
    return avatar_id if avatar_id in library else None


def steering_gap(
    avatar_ids: Sequence[str | None], winner_id: str, library: Mapping[str, str]
) -> str | None:
    """How a round's angles fall short of following the winner, or None if they don't.

    At least half of the angles should be written for the winning avatar, and at
    least one for another avatar (when the library has another) so the test keeps
    exploring. A soft rule: the caller retries once and then accepts.
    """
    on_winner = sum(1 for avatar_id in avatar_ids if avatar_id == winner_id)
    need = math.ceil(len(avatar_ids) / 2)
    if on_winner < need:
        return (
            f"at least {need} of the {len(avatar_ids)} angles must be written for "
            f"the winning avatar (id {winner_id}); only {on_winner} are"
        )
    if len(library) > 1 and on_winner == len(avatar_ids):
        return (
            "at least one angle must be written for a different avatar than the "
            "winning one, so the test keeps exploring"
        )
    return None


def _ad_line(role: str, ad: AdResult, unit: str) -> str:
    avatar = (
        f" [avatar id {ad.angle.buyer_avatar_id}]" if ad.angle.buyer_avatar_id else ""
    )
    return (
        f"- {role}: {ad.angle.label}{avatar} — ${ad.cost:,.2f} per {unit} "
        f"({ad.results} {unit}s from ${ad.spend:,.2f} spend)"
    )


def results_lines(
    results: RoundResults, *, steer_to: str | None, explore: bool = True
) -> list[str]:
    """The campaign's results so far, as lines for the round's request details.

    Args:
        results: The comparison (the dashboard's leader, unchanged).
        steer_to: The winning avatar's id when the angles should follow it, else
            None (no clear leader, or the winner has no assignable library avatar).
        explore: Whether to ask for an angle on a different avatar (the library
            has another one).
    """
    if results.leader is None:
        return [
            f"Results so far: {results.ads_compared} ad(s) have numbers, but no ad is "
            "clearly ahead yet, so do not assume a winner."
        ]
    unit = "purchase" if results.basis == "cac" else "add-to-cart"
    basis = "cost per purchase" if results.basis == "cac" else "cost per add-to-cart"
    lines = [
        f"Results so far (the winner is the ad the owner's dashboard highlights, "
        f"ranked on {basis}):",
        _ad_line("Winner", results.leader, unit),
    ]
    if results.weakest is not None:
        lines.append(_ad_line("Weakest", results.weakest, unit))
    if steer_to is not None:
        lines.append(
            "Build on what won: at least half of the new angles must be written "
            f"for the winning avatar (id {steer_to}), with new concepts"
            + (
                ", and at least one for a different avatar so the test keeps exploring."
                if explore
                else "."
            )
        )
    return lines
