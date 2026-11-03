"""Which ad is winning a creative test, and which angle it was written for.

The next round's Strategist is told. "Winning" is exactly the dashboard's leader
(``dashboard.choose_leader``, unchanged), so the angle the Strategist hears about
is the one the owner sees highlighted. This module only maps that ad back to its
angle and library avatar.

The numbers are for the window in which all of the ads were running
(``ad_window.compare_ads``), so an ad that went live earlier gets no credit for
its extra days. With too little shared time there is no winner, and the reason is
passed on.
"""

from collections.abc import Mapping
from typing import NamedTuple

from prisma import Prisma

from app.core.config import get_settings
from app.core.db import db
from app.services import dashboard as dash
from app.services.ad_window import compare_ads
from app.services.creative_naming import angle_label


class AdAngle(NamedTuple):
    """The angle (and library avatar) an ad was written for."""

    label: str
    buyer_avatar_id: str | None
    avatar: str | None
    concept: str | None
    pillar: str | None


class AdResult(NamedTuple):
    """One ad's standing on the basis the leader was chosen by."""

    ad_id: str
    angle: AdAngle
    spend: float
    results: int
    cost: float


class RoundResults(NamedTuple):
    """The comparison the next round hears about.

    ``leader`` and ``weakest`` are None, with ``basis`` None, when the data can't
    support a leader (fewer than two ads, too few add-to-carts, a tie).
    """

    basis: str | None
    leader: AdResult | None
    weakest: AdResult | None
    ads_compared: int
    # What the numbers cover ("Compared over the last 4 days, while all ads ran"),
    # and, when there is no leader because the ads have not run side by side long
    # enough, why.
    window_label: str | None = None
    no_leader_reason: str | None = None


def _result_of(totals: dash.Totals, basis: str) -> int:
    value = totals.purchases if basis == "cac" else totals.add_to_cart
    return value or 0


def build_round_results(
    per_ad: Mapping[str, dash.Totals],
    angles: Mapping[str, AdAngle],
    window_label: str | None = None,
) -> RoundResults | None:
    """Pick the leader among the ads' numbers and say which angle it was.

    Args:
        per_ad: Each ad's numbers in the shared window, keyed by ad id.
        angles: The angle each ad was written for, keyed by ad id; an ad missing
            here is labeled by its id.
        window_label: What the numbers cover, passed on to the Strategist.

    Returns:
        None when there are no numbers at all, else the comparison.
    """
    if not per_ad:
        return None
    leader = dash.choose_leader(list(per_ad.items()))
    if leader is None:
        return RoundResults(None, None, None, len(per_ad), window_label)

    def result(ad_id: str) -> AdResult:
        totals = per_ad[ad_id]
        results = _result_of(totals, leader.basis)
        return AdResult(
            ad_id=ad_id,
            angle=angles.get(ad_id, AdAngle(ad_id, None, None, None, None)),
            spend=totals.spend,
            results=results,
            cost=totals.spend / results,
        )

    ranked = [
        result(ad_id) for ad_id, t in per_ad.items() if _result_of(t, leader.basis)
    ]
    weakest = max(ranked, key=lambda r: r.cost)
    return RoundResults(
        basis=leader.basis,
        leader=result(leader.ad_id),
        weakest=None if weakest.ad_id == leader.ad_id else weakest,
        ads_compared=len(per_ad),
        window_label=window_label,
    )


async def load_round_results(
    campaign_id: str, *, client: Prisma = db
) -> RoundResults | None:
    """The campaign's current comparison, read from its ad-level metrics.

    Ads are compared over the window in which all of them were running, the same
    window the dashboard uses, so the winner is the ad the owner sees highlighted.

    Args:
        campaign_id: The creative test campaign.
        client: The database client; only tests pass their own.

    Returns:
        None until at least one ad has numbers.
    """
    metrics = await client.metric.find_many(
        where={"campaignId": campaign_id, "NOT": [{"adId": None}]}
    )
    snapshots = [dash.snapshot_from_metric(m) for m in metrics]
    lifetime = dash.ad_totals(snapshots)
    if not lifetime:
        return None
    window = compare_ads(snapshots, min_hours=get_settings().common_window_min_hours)
    if window.status != "ok":
        return RoundResults(
            None,
            None,
            None,
            len(lifetime),
            window.label,
            window.too_short_reason,
        )
    ad_ids = list(window.per_ad)
    names = {
        ad.id: ad.name for ad in await client.ad.find_many(where={"id": {"in": ad_ids}})
    }
    angles: dict[str, AdAngle] = {}
    for creative in await client.creative.find_many(where={"adId": {"in": ad_ids}}):
        if creative.adId is None:
            continue
        label = (
            angle_label(creative.avatar, creative.concept, creative.pillar)
            if creative.avatar and creative.concept
            else names.get(creative.adId, creative.adId)
        )
        angles[creative.adId] = AdAngle(
            label=label,
            buyer_avatar_id=creative.buyerAvatarId,
            avatar=creative.avatar,
            concept=creative.concept,
            pillar=creative.pillar,
        )
    for ad_id, name in names.items():
        angles.setdefault(ad_id, AdAngle(name, None, None, None, None))
    return build_round_results(window.per_ad, angles, window.label)
