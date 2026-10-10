"""Keep the app's campaign status in step with what Meta is actually doing.

A campaign paused or switched back on directly in Meta Ads Manager used to stay
as it was in the app (a paused campaign kept showing LIVE, a reactivated one
kept showing PAUSED). Each collection cycle now reads every published
campaign's effective status from Meta and updates the app's status and pausedAt
to match.

**Read-only toward Meta:** this module only ever GETs (see
meta.fetch_meta_delivery_status); it changes the app's own rows, never Meta's.
It only acts on a clear signal and leaves a campaign alone when Meta's answer is
missing, unreadable or transitional (in review, with issues, deleted, ...).
"""

import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Literal

from prisma.models import Campaign

from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.services import meta
from app.services.meta import MetaConnectionError, MetaDeliveryStatus

logger = logging.getLogger(__name__)

PAUSED_IN_ADS_MANAGER = "Paused in Meta Ads Manager"

_PAUSED = frozenset({"PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED"})


def delivery_state(status: MetaDeliveryStatus) -> Literal["running", "paused"] | None:
    """Whether Meta is running or has paused a campaign; None when unclear.

    Paused: the campaign itself is paused, or it is on but every ad set is
    paused. Running: the campaign is on and at least one ad set is on. Anything
    else (deleted or archived, in process or with issues, no ad sets, mixed
    transitional states) is not a clear signal.

    Args:
        status: What Meta reports for the campaign and its ad sets.
    """
    if status.campaign_status in _PAUSED:
        return "paused"
    if status.campaign_status != "ACTIVE":
        return None
    ad_sets = status.ad_set_statuses
    if not ad_sets:
        return None
    if any(s == "ACTIVE" for s in ad_sets):
        return "running"
    if all(s in _PAUSED for s in ad_sets):
        return "paused"
    return None


async def sync_campaign_statuses(
    *, on_paused: Callable[[Campaign, str], Awaitable[None]]
) -> None:
    """Align each published campaign's local status with Meta's.

    A LIVE campaign Meta has paused becomes PAUSED (pausedAt now, reason
    "Paused in Meta Ads Manager") and ``on_paused`` is called so a final
    snapshot is collected; a PAUSED campaign Meta is running again becomes
    LIVE with its pause details cleared. Only the campaign and its ad sets are
    updated here; ad rows keep their own status (an ad the optimizer paused is
    still paused when the campaign comes back).

    One campaign failing to read never blocks the rest.

    Args:
        on_paused: Called with (the now-paused campaign, the business's access
            token) after a pause is detected.
    """
    campaigns = await db.campaign.find_many(
        where={
            "status": {"in": ["LIVE", "PAUSED"]},
            "NOT": [{"metaCampaignId": None}],
            "business": {"is": {"deletedAt": None}},
        }
    )
    for campaign in campaigns:
        assert campaign.metaCampaignId is not None  # filtered above
        connection = await get_meta_connection(campaign.businessId)
        if connection is None:
            continue
        try:
            status = await meta.fetch_meta_delivery_status(
                access_token=connection.accessToken,
                meta_campaign_id=campaign.metaCampaignId,
            )
        except MetaConnectionError:
            logger.warning("Status sync could not read campaign %s", campaign.id)
            continue
        if status is None:
            continue
        state = delivery_state(status)
        if state == "paused" and campaign.status == "LIVE":
            updated = await _mark_paused(campaign)
            logger.info("Campaign %s was paused in Meta; marked PAUSED", campaign.id)
            await on_paused(updated, connection.accessToken)
        elif state == "running" and campaign.status == "PAUSED":
            await _mark_running(campaign)
            logger.info("Campaign %s is running in Meta; marked LIVE", campaign.id)


async def _mark_paused(campaign: Campaign) -> Campaign:
    await db.adset.update_many(
        where={"campaignId": campaign.id, "NOT": [{"metaAdSetId": None}]},
        data={"status": "PAUSED"},
    )
    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={
            "status": "PAUSED",
            "pausedReason": PAUSED_IN_ADS_MANAGER,
            "pausedAt": datetime.now(UTC),
        },
    )
    assert updated is not None  # just read it
    return updated


async def _mark_running(campaign: Campaign) -> None:
    await db.adset.update_many(
        where={"campaignId": campaign.id, "NOT": [{"metaAdSetId": None}]},
        data={"status": "LIVE"},
    )
    await db.campaign.update(
        where={"id": campaign.id},
        data={"status": "LIVE", "pausedReason": None, "pausedAt": None},
    )
