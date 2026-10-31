"""Which ad is winning a creative test, and which angle it was written for.

The next round's Strategist is told. "Winning" is exactly the dashboard's leader
(``dashboard.choose_leader``, unchanged), so the angle the Strategist hears about
is the one the owner sees highlighted. This module only maps that ad back to its
angle and library avatar.

Known limit: the numbers are lifetime totals, so an older ad has had longer to
collect results than a newer one. Comparing ads over a common window in which all
of them were live is on the backlog.
"""

from collections.abc import Mapping
from typing import NamedTuple

from prisma import Prisma

from app.core.db import db
from app.services import dashboard as dash
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


def _result_of(totals: dash.Totals, basis: str) -> int:
    value = totals.purchases if basis == "cac" else totals.add_to_cart
    return value or 0


def build_round_results(
    per_ad: Mapping[str, dash.Totals], angles: Mapping[str, AdAngle]
) -> RoundResults | None:
    """Pick the leader among the ads' numbers and say which angle it was.

    Args:
        per_ad: Each ad's lifetime numbers, keyed by ad id.
        angles: The angle each ad was written for, keyed by ad id; an ad missing
            here is labeled by its id.

    Returns:
        None when there are no numbers at all, else the comparison.
    """
    if not per_ad:
        return None
    leader = dash.choose_leader(list(per_ad.items()))
    if leader is None:
        return RoundResults(None, None, None, len(per_ad))

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
    )


async def load_round_results(
    campaign_id: str, *, client: Prisma = db
) -> RoundResults | None:
    """The campaign's current comparison, read from its ad-level metrics.

    Args:
        campaign_id: The creative test campaign.
        client: The database client; only tests pass their own.

    Returns:
        None until at least one ad has numbers.
    """
    metrics = await client.metric.find_many(
        where={"campaignId": campaign_id, "NOT": [{"adId": None}]}
    )
    per_ad = dash.ad_totals(dash.snapshot_from_metric(m) for m in metrics)
    if not per_ad:
        return None
    ad_ids = list(per_ad)
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
    return build_round_results(per_ad, angles)
