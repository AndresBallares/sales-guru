"""Ad-set rounds: which round is running, and when the next may start.

A creative test's budget sits on its ad sets (`CreativeTestPlanContent.rounds_budget
== "AD_SET"`). Round 1 is one ad set; every later round is a new ad set plus a
"winners" ad set. Both ad sets of a round carry the round's number in
`AdSet.packNumber` and the same `endDate`, so a round's window is read straight off
its ad sets. Rounds never overlap: the next one unlocks once the latest round's
`endDate` has passed. Ending a round early moves its ad sets' `endDate` to now.
"""

from datetime import UTC, datetime
from typing import NamedTuple

from prisma.models import Ad, AdSet, Campaign, Creative

from app.core.config import get_settings
from app.core.db import db
from app.schemas.strategy import (
    CreativeTestPlanContent,
    StrategyContent,
    StrategyContentAdapter,
)
from app.services import meta


class RoundWindow(NamedTuple):
    """The latest published round of an ad-set-budget creative test."""

    number: int
    starts_at: datetime | None
    ends_at: datetime
    ad_sets: list[AdSet]


def uses_ad_set_rounds(plan: StrategyContent | None) -> bool:
    """Whether a stored plan runs its rounds on ad-set budgets.

    Args:
        plan: The campaign's strategy content, or None.

    Returns:
        True for a creative-test plan written since ad-set rounds.
    """
    return isinstance(plan, CreativeTestPlanContent) and plan.rounds_budget == "AD_SET"


async def latest_round(campaign_id: str) -> RoundWindow | None:
    """The newest published round of a campaign, with its ad sets.

    Args:
        campaign_id: The campaign.

    Returns:
        The round with the highest number, or None when no round is published.
    """
    ad_sets = [
        a
        for a in await db.adset.find_many(where={"campaignId": campaign_id})
        if a.packNumber is not None and a.endDate is not None
    ]
    if not ad_sets:
        return None
    number = max(a.packNumber for a in ad_sets if a.packNumber is not None)
    current = [a for a in ad_sets if a.packNumber == number]
    starts = [a.startDate for a in current if a.startDate is not None]
    return RoundWindow(
        number=number,
        starts_at=min(starts) if starts else None,
        ends_at=max(a.endDate for a in current if a.endDate is not None),
        ad_sets=current,
    )


async def next_round_problem(
    campaign_id: str, *, now: datetime | None = None
) -> str | None:
    """Why the next round cannot start yet, or None when it can.

    Args:
        campaign_id: The campaign.
        now: The current time (a test passes its own).

    Returns:
        A sentence for the user, or None when the latest round is over and the
        round limit has not been reached.
    """
    current_time = now or datetime.now(UTC)
    window = await latest_round(campaign_id)
    if window is None:
        return "Publish round 1 before adding another round."
    limit = get_settings().creative_test_max_rounds
    if window.number >= limit:
        plural = "" if limit == 1 else "s"
        return (
            f"A creative test runs up to {limit} round{plural}, "
            "and this one has done so."
        )
    if window.ends_at > current_time:
        return (
            f"Round {window.number} is still running until "
            f"{window.ends_at:%b %-d}. You can add round {window.number + 1} then, "
            "or use End round early."
        )
    return None


class RoundPublishError(Exception):
    """A round cannot be published as asked; the message is for the user."""


class WinnerCandidate(NamedTuple):
    """An earlier ad still active, which a later round may carry as a winner."""

    ad: Ad
    creative: Creative
    first_round: int


async def winner_candidates(
    campaign: Campaign, *, access_token: str
) -> list[WinnerCandidate]:
    """The earlier ads the user left active, oldest first.

    An ad is a candidate when Meta still has its own status as ACTIVE (the user
    pauses losers; the end-of-round campaign pause does not change an ad's own
    status), and no later copy of it exists (an ad already carried into a winners
    ad set is represented by that copy).

    Args:
        campaign: The campaign.
        access_token: The business's Meta token, to read each ad's status.

    Returns:
        The candidates, in the order the ads were created.

    Raises:
        MetaConnectionError: If Meta can't be asked about an ad's status.
    """
    ad_sets = [
        a
        for a in await db.adset.find_many(where={"campaignId": campaign.id})
        if a.metaAdSetId is not None
    ]
    if not ad_sets:
        return []
    ads = await db.ad.find_many(
        where={"adSetId": {"in": [a.id for a in ad_sets]}},
        order={"createdAt": "asc"},
    )
    creatives = await db.creative.find_many(
        where={"campaignId": campaign.id}, include={"round": True}
    )
    superseded = {c.carriedFromCreativeId for c in creatives if c.carriedFromCreativeId}
    by_ad = {c.adId: c for c in creatives if c.adId is not None}
    found: list[WinnerCandidate] = []
    for ad in ads:
        creative = by_ad.get(ad.id)
        if creative is None or ad.metaAdId is None or creative.id in superseded:
            continue
        status = await meta.fetch_meta_object_status(
            access_token=access_token, meta_object_id=ad.metaAdId
        )
        if status != "ACTIVE":
            continue
        first_round = creative.carriedFromRound or (
            creative.round.number if creative.round is not None else 1
        )
        found.append(WinnerCandidate(ad, creative, first_round))
    return found


def chosen_winners(
    candidates: list[WinnerCandidate], chosen_ids: list[str] | None, *, limit: int
) -> list[WinnerCandidate]:
    """The winners a round will carry: the user's pick, or every active ad.

    Args:
        candidates: The ads still active.
        chosen_ids: The Creative ids the user picked, or None for "all".
        limit: The most winners one round may carry.

    Returns:
        The winners.

    Raises:
        RoundPublishError: If the pick names an ad that is not a candidate, or
            there are more winners than the limit.
    """
    if chosen_ids is None:
        winners = candidates
    else:
        by_id = {c.creative.id: c for c in candidates}
        missing = [i for i in chosen_ids if i not in by_id]
        if missing:
            raise RoundPublishError(
                "One of the ads you picked is no longer active, so it can't be carried."
            )
        winners = [by_id[i] for i in chosen_ids]
    if len(winners) > limit:
        raise RoundPublishError(
            f"{len(winners)} ads are still active, but a round can carry at most "
            f"{limit} winners. Choose which {limit} to carry."
        )
    return winners


async def campaign_uses_ad_set_rounds(campaign_id: str) -> bool:
    """Whether a campaign's stored strategy runs its rounds on ad-set budgets.

    Args:
        campaign_id: The campaign.

    Returns:
        True for a creative test written since ad-set rounds.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign_id})
    if strategy is None:
        return False
    return uses_ad_set_rounds(StrategyContentAdapter.validate_json(strategy.content))


def planned_rounds_budget(plan: CreativeTestPlanContent, ad_sets: list[AdSet]) -> float:
    """The most an ad-set-round campaign should spend: every ad set's plan, summed.

    Each published ad set runs at its own daily budget for the plan's days, so a
    first round is $100 x 10 = $1,000 and a later round with a winners ad set is
    ($100 + $50) x 10 = $1,500. The limit is the sum over the published rounds.

    Args:
        plan: The campaign's CREATIVE_TEST_PLAN.
        ad_sets: The campaign's ad sets that exist on Meta.

    Returns:
        The planned total, in dollars.
    """
    return sum(a.budget for a in ad_sets) * plan.duration_days
