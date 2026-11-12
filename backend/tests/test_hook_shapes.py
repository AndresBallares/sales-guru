"""Hook shapes: the five forms an ad's opening line can take, assigned in code.

A shape is the grammatical form of the hook (the opening of the primary text), not what
the ad argues, so it does not overlap the pillar. The code, not the model, decides which
shape each variant gets: four different shapes per batch, a starting point derived from
the campaign (so the first-position angle is not always paired with the same shape) and
moved on by one for every round.
"""

import hashlib

import pytest
from app.services import hook_shapes

SLUGS = ["statement", "question", "contrast", "moment", "address"]


def _hash(campaign_id: str) -> int:
    return int(hashlib.sha256(campaign_id.encode()).hexdigest(), 16) % 5


def test_the_five_approved_shapes_in_order() -> None:
    assert [s.slug for s in hook_shapes.HOOK_SHAPES] == SLUGS
    assert list(hook_shapes.HOOK_TYPES) == SLUGS


def test_every_shape_has_a_rule_to_put_in_the_prompt() -> None:
    for shape in hook_shapes.HOOK_SHAPES:
        assert shape.rule.strip()
        assert shape.slug in shape.rule.split(":")[0].lower()


def test_a_batch_of_four_gets_four_different_shapes() -> None:
    for n in range(200):
        for round_number in (1, 2, 3, 4, 5, 6):
            shapes = hook_shapes.assign_shapes(f"campaign-{n}", round_number, 4)
            assert len(set(shapes)) == 4, (n, round_number, shapes)


def test_a_batch_of_three_or_five_also_has_no_repeats() -> None:
    assert len(set(hook_shapes.assign_shapes("c", 1, 3))) == 3
    assert len(set(hook_shapes.assign_shapes("c", 1, 5))) == 5


def test_more_variants_than_shapes_is_refused_rather_than_repeating() -> None:
    with pytest.raises(ValueError, match="at most 5"):
        hook_shapes.assign_shapes("c", 1, 6)


def test_the_start_is_a_stable_hash_of_the_campaign_plus_the_round() -> None:
    for campaign_id in ("a", "cmuwq4p1g0005wqovs9t0yfby", "campaign-7"):
        for round_number in (1, 2, 3, 4):
            start = (_hash(campaign_id) + round_number - 1) % 5
            expected = [SLUGS[(start + i) % 5] for i in range(4)]
            assert hook_shapes.assign_shapes(campaign_id, round_number, 4) == expected


def test_the_same_campaign_and_round_always_get_the_same_shapes() -> None:
    assert hook_shapes.assign_shapes("same", 2, 4) == hook_shapes.assign_shapes(
        "same", 2, 4
    )


def test_each_round_starts_one_shape_later() -> None:
    first = hook_shapes.assign_shapes("c1", 1, 5)
    second = hook_shapes.assign_shapes("c1", 2, 5)
    assert second == first[1:] + first[:1]


def test_campaigns_do_not_all_start_their_first_angle_on_the_same_shape() -> None:
    starts = {hook_shapes.assign_shapes(f"campaign-{n}", 1, 4)[0] for n in range(60)}
    assert starts == set(SLUGS)


def test_a_shape_is_only_known_by_its_slug() -> None:
    assert hook_shapes.is_hook_type("question")
    assert not hook_shapes.is_hook_type("curiosity")
    assert not hook_shapes.is_hook_type(None)


def test_the_system_lines_name_every_shape_and_are_the_same_every_time() -> None:
    lines = hook_shapes.system_lines()
    text = "\n".join(lines)
    for slug in SLUGS:
        assert slug in text
    assert lines == hook_shapes.system_lines()


# --- shapes the carried winners already use (ad-set rounds) -----------------------


def test_avoided_shapes_come_last_so_new_ads_open_differently_from_the_winners() -> (
    None
):
    avoid = hook_shapes.assign_shapes("c1", 2, 4)[:2]

    shapes = hook_shapes.assign_shapes("c1", 2, 4, avoid=avoid)

    assert len(set(shapes)) == 4  # still never repeats within a batch
    # Five shapes, two avoided: the three others come first, then one avoided.
    assert not any(s in avoid for s in shapes[:3])
    assert shapes[3] in avoid


def test_with_nothing_to_avoid_the_assignment_is_unchanged() -> None:
    assert hook_shapes.assign_shapes("c1", 3, 4, avoid=()) == hook_shapes.assign_shapes(
        "c1", 3, 4
    )


def test_when_everything_is_avoided_the_normal_order_is_kept() -> None:
    every = list(hook_shapes.HOOK_TYPES)

    assert hook_shapes.assign_shapes("c1", 2, 4, avoid=every) == (
        hook_shapes.assign_shapes("c1", 2, 4)
    )
