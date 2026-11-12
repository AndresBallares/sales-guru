"""Hook shapes: the five forms an ad's opening line can take, assigned in code.

The hook is the first sentence of an ad's primary text. Its *shape* is its grammatical
form (a plain statement, a question, a contrast, a moment, a direct address), not what
the ad argues, so any pillar (offer, mechanism, education, emotion) can use any shape.

The code, not the model, decides which shape each variant gets, so a batch always has
different shapes and the shape stored with the ad (``Creative.hookType``) is the one
that was asked for, never a label the model gave itself. The starting shape comes from a
stable hash of the campaign plus the round number, so the first-position angle is not
always paired with the same shape across campaigns, and each new round starts one shape
later.

The rules for the shapes are static, so they sit in the Creative Agent's cached system
prompt (``system_lines``); the shape a variant is assigned differs per request, so it
rides in the per-call tail (``tail_line``). Nothing reads ``hookType`` yet: it is
collected so results can later be compared by shape.
"""

import hashlib
from collections.abc import Sequence
from typing import Literal, NamedTuple, TypeGuard, get_args

HookType = Literal["statement", "question", "contrast", "moment", "address"]
HOOK_TYPES: tuple[HookType, ...] = get_args(HookType)


class HookShape(NamedTuple):
    """One shape and the rule the model is given for it.

    Attributes:
        slug: The stored name (``Creative.hookType``).
        rule: The prompt text, starting with the slug.
    """

    slug: HookType
    rule: str


HOOK_SHAPES: tuple[HookShape, ...] = (
    HookShape(
        "statement",
        "statement: one concrete fact from the product details, stated plainly.",
    ),
    HookShape(
        "question",
        "question: a question the buyer would really ask, answered in the same text; "
        "never a question that withholds the product, the price or the answer.",
    ),
    HookShape(
        "contrast",
        'contrast: "Not X. Z." or "X does this; this does that", where X is a generic '
        "thing (painted color, plated metal), never a named brand or competitor.",
    ),
    HookShape(
        "moment",
        "moment: drop the reader into one specific moment of wearing, giving or "
        "opening, in the present tense, and name the product before the text ends.",
    ),
    HookShape(
        "address",
        "address: speak to the buyer in their own words, taken from the avatar's "
        "problem and saved hooks, without saying anything about who they are.",
    ),
)
assert tuple(s.slug for s in HOOK_SHAPES) == HOOK_TYPES

_SHAPE_COUNT = len(HOOK_SHAPES)


def is_hook_type(value: object) -> TypeGuard[HookType]:
    """Whether a value is one of the five shape slugs.

    Args:
        value: Anything, such as a stored ``Creative.hookType``.

    Returns:
        True for a known slug; False for anything else, including None.
    """
    return isinstance(value, str) and value in HOOK_TYPES


def assign_shapes(
    campaign_id: str,
    round_number: int,
    count: int,
    avoid: Sequence[str] = (),
) -> list[HookType]:
    """The shape each variant of a batch gets, in order.

    The start is ``sha256(campaign_id) % 5`` moved on by one for every round after the
    first, and the variants take the next shapes in the list, so a batch never repeats a
    shape. Shapes in ``avoid`` (the ones ads staying live from earlier rounds already
    use) go last: every other shape is used before any of them, so the new ads open
    differently from the winners beside them when there are enough shapes to do so.

    Args:
        campaign_id: The campaign; its hash is the starting point.
        round_number: 1 for the campaign's first batch, then 2, 3 and so on.
        count: How many variants the batch has.
        avoid: Shapes to use only when the others run out.

    Returns:
        One shape per variant.

    Raises:
        ValueError: If the batch has more variants than there are shapes.
    """
    if count > _SHAPE_COUNT:
        raise ValueError(f"a batch has at most {_SHAPE_COUNT} variants, got {count}")
    start = int(hashlib.sha256(campaign_id.encode()).hexdigest(), 16) % _SHAPE_COUNT
    start = (start + round_number - 1) % _SHAPE_COUNT
    order = [HOOK_TYPES[(start + i) % _SHAPE_COUNT] for i in range(_SHAPE_COUNT)]
    fresh = [shape for shape in order if shape not in avoid]
    used = [shape for shape in order if shape in avoid]
    return (fresh + used)[:count]


def system_lines() -> list[str]:
    """The "Hook shapes" and "Hook rules" blocks of the Creative Agent's system prompt.

    Static: identical for every business, product and request, so the cached system
    block never varies. Which shape a variant gets is not here, see ``tail_line``.

    Returns:
        The prompt lines, starting with a blank separator line.
    """
    return [
        "",
        "Hook shapes (the first sentence of body_text is the hook and takes the shape "
        "the request assigns that variant; the headline supports the hook with a "
        "benefit or reason to act, it is not a second hook):",
        *(f"- {shape.rule}" for shape in HOOK_SHAPES),
        "Hook rules (every shape):",
        "- The hook is a complete sentence and, with the rest of the primary text, "
        "fits the length limit given at the end of the request.",
        "- Use only facts and proof points the request gives. Never invent "
        "testimonials, statistics, scarcity, certifications, product tests, "
        "guarantees or craft and process claims (hand-set, hand-finished and the "
        "like).",
        "- No shaming, guilt or fear, and never blame the buyer for a past purchase.",
        "- No attacks on competitors and no claim that others do something wrong.",
        '- Never withhold to force a click: no "you won\'t believe", "wait until you '
        'see" or "find out why", no teased price and no hidden product.',
        "- Never assert or imply a personal attribute of the viewer (address and "
        "moment most of all): relationship status, age, health, finances, religion, "
        "race, sexual orientation, gender identity, disability or similar. The "
        "avatar's profile is for you to understand the buyer, never to say about "
        'them. "Your right hand has been waiting." is fine; "Newly single?" is not.',
    ]


def tail_line(shapes: Sequence[str], *, single: bool, max_chars: int) -> str:
    """The per-call line naming the shape each variant was assigned.

    Args:
        shapes: One shape slug per variant, in the order the variants are listed.
        single: True for a one-variant regenerate.
        max_chars: The primary text's length limit, repeated here beside the shape: a
            smoke test (2026-11-06) showed an address hook running to 193 characters
            twice running when the limit was only in the closing paragraph.

    Returns:
        The line for the request's tail.

    Raises:
        ValueError: If a slug is not a known shape.
    """
    for slug in shapes:
        if not is_hook_type(slug):
            raise ValueError(f"unknown hook shape {slug!r}")
    if single:
        return (
            f"Hook shape for this variant: {shapes[0]}. Open the primary text with a "
            f'hook of that shape (see "Hook shapes"); the hook and the whole primary '
            f"text together stay within {max_chars} characters."
        )
    named = "; ".join(f"Variant {chr(ord('A') + i)}: {s}" for i, s in enumerate(shapes))
    return (
        f"Hook shape for each variant, in order: {named}. Open each primary text with "
        f'a hook of its shape (see "Hook shapes"); the hook and the whole primary '
        f"text together stay within {max_chars} characters."
    )
