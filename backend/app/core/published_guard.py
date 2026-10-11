"""One rule for "this campaign is already on Meta, so its ads can't change".

A campaign is published once it has a Meta campaign id, whatever its status is
now (live, paused, archived, or a status an old bug reset it to). Its local
creative rows are the record of the ads that exist on Meta, so nothing may
delete or replace them, and nothing may move the campaign back to a pre-publish
status: that is blocked here, in one place, for every action that would.
"""

from fastapi import HTTPException, status
from prisma.models import Campaign

from app.core.db import db

ADS_LOCKED = (
    "This campaign is already published. Create a new campaign to change its ads."
)
ALREADY_PUBLISHED = "This campaign is already published."


def is_published(campaign: Campaign) -> bool:
    """Whether the campaign has a Meta campaign id (any status)."""
    return campaign.metaCampaignId is not None


async def ensure_not_published(campaign: Campaign, detail: str = ADS_LOCKED) -> None:
    """Refuse with a 400 if the campaign is published.

    Re-reads the campaign so a publish that finished after the request began is
    still seen.

    Args:
        campaign: The campaign the request is about.
        detail: The message to return (defaults to the "create a new campaign to
            change its ads" one).

    Raises:
        HTTPException: 400 if the campaign has a Meta campaign id.
    """
    current = await db.campaign.find_unique(where={"id": campaign.id})
    if is_published(campaign) or (current is not None and is_published(current)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)
