"""Deleting and archiving campaigns.

A campaign that never delivered (no snapshot with spend, no purchases, and
nothing on Meta's own insights) has no results to lose, so it can be deleted:
first on Meta, then locally. One that has delivered is archived instead: paused
on Meta if it is live, hidden from the list, and kept whole (metrics,
recommendations, evaluations) so the Optimizer and the dashboard history are
unaffected.
"""

import logging

from prisma.models import Campaign, MetaConnection

from app.core.db import db
from app.services import meta
from app.services.optimization_jobs import pause_campaign_and_capture

logger = logging.getLogger(__name__)

ARCHIVED_REASON = "Archived"
RESTORED_REASON = "Restored from archive"


class CampaignHasDeliveredError(Exception):
    """The campaign has results, so it cannot be deleted (archive it instead)."""


class CampaignNeverDeliveredError(Exception):
    """The campaign never ran, so there is nothing to keep (delete it instead)."""


class CampaignNotPublishedError(Exception):
    """The campaign was never published, so there is nothing to archive."""


class CampaignNotArchivedError(Exception):
    """Only an archived campaign can be restored."""


class MetaConnectionMissingError(Exception):
    """Meta objects exist but the business has no usable Meta connection."""


async def has_delivered(campaign_id: str) -> bool:
    """Whether the campaign has ever delivered, by its stored snapshots.

    Any snapshot with spend or purchases counts; all-zero snapshots do not.

    Args:
        campaign_id: The campaign to check.

    Returns:
        True if a snapshot shows spend or a purchase.
    """
    count = await db.metric.count(
        where={
            "campaignId": campaign_id,
            "OR": [{"spend": {"gt": 0}}, {"purchases": {"gt": 0}}],
        }
    )
    return count > 0


async def _meta_ids(campaign: Campaign) -> tuple[list[str], list[str], list[str]]:
    """The campaign's Meta ids: (ads, ad sets, creatives), those that exist."""
    ad_sets = await db.adset.find_many(where={"campaignId": campaign.id})
    ad_set_ids = [a.id for a in ad_sets]
    ads = (
        await db.ad.find_many(where={"adSetId": {"in": ad_set_ids}})
        if ad_set_ids
        else []
    )
    creatives = await db.creative.find_many(where={"campaignId": campaign.id})
    return (
        [a.metaAdId for a in ads if a.metaAdId],
        [a.metaAdSetId for a in ad_sets if a.metaAdSetId],
        sorted({c.metaCreativeId for c in creatives if c.metaCreativeId}),
    )


async def _check_meta_has_no_results(
    campaign: Campaign, connection: MetaConnection
) -> None:
    """Refuse if Meta itself reports spend or purchases.

    Snapshots are only taken every 15 minutes while live, so a campaign that
    just started spending can still look "never delivered" locally.

    Raises:
        CampaignHasDeliveredError: Meta shows spend or purchases.
        meta.MetaConnectionError: The insights call failed for a reason other
            than the campaign being absent on Meta.
    """
    assert campaign.metaCampaignId is not None
    try:
        insights = await meta.fetch_campaign_insights(
            access_token=connection.accessToken,
            meta_campaign_id=campaign.metaCampaignId,
        )
    except meta.MetaConnectionError as exc:
        if exc.error_subcode == meta.OBJECT_NOT_FOUND_SUBCODE:
            # Absent on Meta (an earlier attempt got that far): nothing to read.
            return
        raise
    if insights.spend > 0 or (insights.purchases or 0) > 0:
        raise CampaignHasDeliveredError


async def delete_campaign(
    campaign: Campaign, connection: MetaConnection | None
) -> None:
    """Delete a never-delivered campaign: on Meta first, then locally.

    Meta objects go ads, ad sets, campaign, then creatives; each deletion is
    safe to repeat, so a failure partway (nothing local has been touched yet)
    can simply be retried. The local rows are removed in one transaction, only
    after every Meta deletion succeeded, so there is never a half-deleted local
    state.

    Args:
        campaign: The campaign to delete.
        connection: The business's Meta connection, if any (only needed when the
            campaign has objects on Meta).

    Raises:
        CampaignHasDeliveredError: It has results (snapshots or Meta insights).
        MetaConnectionMissingError: It has Meta objects but no usable connection.
        meta.MetaConnectionError: A Meta call failed; nothing local was deleted.
    """
    if await has_delivered(campaign.id):
        raise CampaignHasDeliveredError

    ad_ids, ad_set_ids, creative_ids = await _meta_ids(campaign)
    on_meta = bool(campaign.metaCampaignId or ad_ids or ad_set_ids or creative_ids)
    if on_meta:
        if connection is None or connection.adAccountId is None:
            raise MetaConnectionMissingError
        if campaign.metaCampaignId:
            await _check_meta_has_no_results(campaign, connection)
        targets = [
            *ad_ids,
            *ad_set_ids,
            *([campaign.metaCampaignId] if campaign.metaCampaignId else []),
            *creative_ids,
        ]
        for meta_object_id in targets:
            await meta.delete_meta_object(
                access_token=connection.accessToken,
                ad_account_id=connection.adAccountId,
                meta_object_id=meta_object_id,
            )

    await _delete_local_rows(campaign.id)


async def _delete_local_rows(campaign_id: str) -> None:
    """Remove the campaign and everything that points at it, atomically."""
    async with db.tx() as tx:
        await tx.creativecard.delete_many(
            where={"creative": {"is": {"campaignId": campaign_id}}}
        )
        await tx.creative.delete_many(where={"campaignId": campaign_id})
        await tx.metric.delete_many(where={"campaignId": campaign_id})
        ad_set_ids = [
            a.id for a in await tx.adset.find_many(where={"campaignId": campaign_id})
        ]
        if ad_set_ids:
            await tx.ad.delete_many(where={"adSetId": {"in": ad_set_ids}})
        await tx.adset.delete_many(where={"campaignId": campaign_id})
        await tx.optimizationrecommendation.delete_many(
            where={"campaignId": campaign_id}
        )
        await tx.testevaluation.delete_many(where={"campaignId": campaign_id})
        await tx.strategy.delete_many(where={"campaignId": campaign_id})
        await tx.campaign.delete(where={"id": campaign_id})


async def archive_campaign(
    campaign: Campaign, connection: MetaConnection | None
) -> Campaign:
    """Archive a campaign that has delivered: pause it if live, hide it, keep it.

    A live campaign is paused on Meta first (with its final snapshot); if that
    fails nothing changes locally. Everything else is kept as is.

    Args:
        campaign: The campaign to archive.
        connection: The business's Meta connection (needed to pause a live one).

    Returns:
        The campaign, now ARCHIVED (the same one back if it already was).

    Raises:
        CampaignNotPublishedError: It was never published.
        CampaignNeverDeliveredError: It never ran, so delete it instead.
        MetaConnectionMissingError: It is live but there is no Meta connection.
        meta.MetaConnectionError: Pausing on Meta failed; the campaign is unchanged.
    """
    if campaign.status == "ARCHIVED":
        return campaign
    if campaign.metaCampaignId is None:
        raise CampaignNotPublishedError
    if not await has_delivered(campaign.id):
        raise CampaignNeverDeliveredError

    reason = campaign.pausedReason or ARCHIVED_REASON
    if campaign.status == "LIVE":
        if connection is None:
            raise MetaConnectionMissingError
        campaign = await pause_campaign_and_capture(
            campaign=campaign, connection=connection, reason=ARCHIVED_REASON
        )
        reason = ARCHIVED_REASON
    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={"status": "ARCHIVED", "pausedReason": reason},
    )
    assert updated is not None  # just read, can't vanish mid-request
    return updated


async def restore_campaign(campaign: Campaign) -> Campaign:
    """Bring an archived campaign back as PAUSED, locally only.

    Nothing is sent to Meta: archiving left the campaign paused there, so it is
    still paused. As PAUSED it is back in the campaign list and in the Meta
    status sync, which reads Meta each cycle and flips it to LIVE if it is in fact
    running there (and collection of its results then resumes). Its metrics,
    recommendations and evaluations were never touched. The pause details are kept,
    except the plain "Archived" reason, which no longer applies.

    Args:
        campaign: The campaign to restore.

    Returns:
        The campaign, now PAUSED.

    Raises:
        CampaignNotArchivedError: It is not archived.
    """
    if campaign.status != "ARCHIVED":
        raise CampaignNotArchivedError
    reason = campaign.pausedReason
    if reason in (None, ARCHIVED_REASON):
        reason = RESTORED_REASON
    updated = await db.campaign.update(
        where={"id": campaign.id}, data={"status": "PAUSED", "pausedReason": reason}
    )
    assert updated is not None  # just read, can't vanish mid-request
    return updated
