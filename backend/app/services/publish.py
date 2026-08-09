"""Campaign publish orchestration (PRD.md build step 8).

Approved content + a complete Meta connection -> live objects on Meta
(Campaign -> AdSet -> AdCreative -> Ad), mirrored locally as AdSet/Ad rows
so the app has its own record of what's running, alongside Meta's ids —
same reasoning as every other build step: Meta is the source of truth for
delivery, we still need our own queryable copy.

Precondition checks (a complete Meta connection, a selected creative, a
resolvable destination URL) live in the API layer (app/api/campaign.py),
same pattern as the strategy-required check before creative generation —
this module assumes its caller already validated all of that and just
does the Meta calls + local writes.
"""

from prisma.models import Campaign, Creative, MetaConnection

from app.core.db import db
from app.schemas.strategy import StrategyContent
from app.services import meta

# No user input collects this yet, so each objective gets a reasonable
# Meta optimization_goal default rather than leaving it unset (the AdSet
# model has no default for it — see schema.prisma).
_OPTIMIZATION_GOAL_BY_OBJECTIVE = {
    "SALES": "OFFSITE_CONVERSIONS",
    "LEADS": "LEAD_GENERATION",
    "TRAFFIC": "LINK_CLICKS",
    "MESSAGES": "LINK_CLICKS",
    "AWARENESS": "REACH",
}


async def publish_campaign_to_meta(
    *,
    campaign: Campaign,
    connection: MetaConnection,
    creative: Creative,
    strategy: StrategyContent,
    destination_url: str,
) -> Campaign:
    """Create the campaign live on Meta, then mirror it locally.

    Args:
        campaign: The campaign being published (already confirmed
            APPROVED or FAILED-retry by the caller).
        connection: The business's Meta connection (already confirmed to
            have adAccountId/pageId set by the caller).
        creative: The campaign's SELECTED creative (already confirmed to
            exist by the caller).
        strategy: The campaign's parsed strategy — supplies the budget
            and target age range.
        destination_url: Where the ad's CTA button links to (already
            resolved by the caller: the product's URL or the business's
            website).

    Returns:
        The campaign, now LIVE with metaCampaignId set.

    Raises:
        MetaConnectionError: If any Graph API call fails. The campaign's
            status is left for the caller to move to FAILED — this
            function doesn't write that, so a caller can distinguish "we
            never even validated" (never called this) from "we tried and
            Meta rejected it" (caught here).
    """
    assert connection.adAccountId is not None
    assert connection.pageId is not None

    daily_budget_cents = round(strategy.budget_recommendation.daily * 100)
    age_min = strategy.target_audience.age_min or 18
    age_max = strategy.target_audience.age_max or 65
    optimization_goal = _OPTIMIZATION_GOAL_BY_OBJECTIVE[campaign.objective]
    object_name = campaign.name or f"Sales Guru campaign {campaign.id}"

    meta_campaign_id = await meta.create_meta_campaign(
        access_token=connection.accessToken,
        ad_account_id=connection.adAccountId,
        name=object_name,
        objective=campaign.objective,
    )
    meta_ad_set_id = await meta.create_meta_ad_set(
        access_token=connection.accessToken,
        ad_account_id=connection.adAccountId,
        name=object_name,
        meta_campaign_id=meta_campaign_id,
        daily_budget_cents=daily_budget_cents,
        optimization_goal=optimization_goal,
        age_min=age_min,
        age_max=age_max,
    )
    meta_creative_id = await meta.create_meta_ad_creative(
        access_token=connection.accessToken,
        ad_account_id=connection.adAccountId,
        page_id=connection.pageId,
        name=creative.headline,
        headline=creative.headline,
        body_text=creative.bodyText,
        description=creative.description,
        cta=creative.cta,
        link=destination_url,
        image_url=creative.imageUrl,
    )
    meta_ad_id = await meta.create_meta_ad(
        access_token=connection.accessToken,
        ad_account_id=connection.adAccountId,
        name=creative.headline,
        meta_ad_set_id=meta_ad_set_id,
        meta_creative_id=meta_creative_id,
    )

    ad_set = await db.adset.create(
        data={
            "campaignId": campaign.id,
            "name": object_name,
            "budget": strategy.budget_recommendation.daily,
            "optimizationGoal": optimization_goal,
            "status": "LIVE",
            "metaAdSetId": meta_ad_set_id,
        }
    )
    ad = await db.ad.create(
        data={
            "adSetId": ad_set.id,
            "name": creative.headline,
            "status": "LIVE",
            "metaAdId": meta_ad_id,
        }
    )
    await db.creative.update(
        where={"id": creative.id},
        data={"ad": {"connect": {"id": ad.id}}, "metaCreativeId": meta_creative_id},
    )
    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={"status": "LIVE", "metaCampaignId": meta_campaign_id},
    )
    assert updated is not None  # just fetched by the caller, can't vanish mid-request
    return updated
