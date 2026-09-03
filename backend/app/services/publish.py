"""Campaign publish orchestration (PRD.md build step 8).

Approved content + a complete Meta connection -> live objects on Meta
(Campaign -> AdSet -> AdCreative -> Ad), mirrored locally as AdSet/Ad rows
so the app has its own record of what's running, alongside Meta's ids —
same reasoning as every other build step: Meta is the source of truth for
delivery, we still need our own queryable copy.

Precondition checks (a complete Meta connection, a selected creative, a
resolvable destination URL, a configured Pixel when the objective needs
one — see requires_pixel) live in the API layer (app/api/campaign.py),
same pattern as the strategy-required check before creative generation —
this module assumes its caller already validated all of that and just
does the Meta calls + local writes.

**"Phase C" real two-variant TEST_PLAN publishing (confirmed 2026-09-02):**
a TEST_PLAN campaign now creates two real AdSets/Ads on Meta — one per
`audience_variants` entry — instead of only ever publishing the broad
baseline (the "Publish-time simplification" this superseded, previously
documented here and in PRD.md §5 step 5). Both variants share one Meta ad
creative object (created once, reused across two `create_meta_ad` calls)
but need two distinct local `Creative` rows, since `Creative.adId` is a
single nullable FK — the originally SELECTED row is linked to the
baseline's Ad, and a duplicate row (same content, same `metaCreativeId`)
is created and linked to the hypothesis variant's Ad. A
DATA_DRIVEN_STRATEGY campaign is unaffected — still exactly one AdSet/Ad,
same as before.
"""

from datetime import UTC, datetime, timedelta

from prisma.models import Campaign, Creative, MetaConnection
from prisma.types import CampaignUpdateInput

from app.core.db import db
from app.schemas.strategy import (
    AudienceVariant,
    StrategyContent,
    TargetAudience,
    daily_budget,
    primary_audience,
)
from app.services import geo, meta
from app.services.event_venues import EVENT_VENUES
from app.services.interests import INTERESTS
from app.services.meta import CustomLocation, ResolvedGeoLocation

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

# Optimization goals that need a Meta Pixel as their promoted_object (real
# API behavior confirmed 2026-08-29 — see create_meta_ad_set's docstring).
# Only OFFSITE_CONVERSIONS is confirmed; LEAD_GENERATION likely needs a
# Lead Form instead of a pixel, a different, unverified mechanism not
# handled here yet.
_GOALS_REQUIRING_PIXEL = frozenset({"OFFSITE_CONVERSIONS"})


def requires_pixel(objective: str) -> bool:
    """Whether publishing this objective needs a MetaConnection.pixelId set.

    Args:
        objective: A Campaign.objective value.

    Returns:
        True if the objective's mapped optimization_goal needs a Meta
        Pixel as its promoted_object.
    """
    return _OPTIMIZATION_GOAL_BY_OBJECTIVE[objective] in _GOALS_REQUIRING_PIXEL


def _resolve_custom_location(campaign: Campaign) -> CustomLocation | None:
    """The campaign's event-venue geo target, if any (PRD.md build step 11).

    Applies uniformly to every AdSet a campaign publishes (both TEST_PLAN
    variants included) — the geographic constraint is "people near this
    venue," a fact about the campaign, not about any one variant.
    """
    if campaign.eventVenueKey is None:
        return None
    venue = EVENT_VENUES.get(campaign.eventVenueKey)
    assert venue is not None  # validated at campaign creation, can't drift
    return CustomLocation(
        lat=venue.lat, lng=venue.lng, radius_miles=venue.recommended_radius_miles
    )


def _resolve_interests(audience: TargetAudience) -> list[dict[str, str]]:
    """Resolve curated interest keys into Meta's {id, name} targeting shape.

    A plain dict lookup — no fuzzy matching, no runtime API dependency —
    since every key is already guaranteed resolvable by the Strategist's
    forced-tool-use enum (app/schemas/strategy.py's InterestKey,
    app/services/interests.py's INTERESTS).
    """
    return [
        {"id": INTERESTS[key].meta_id, "name": INTERESTS[key].name}
        for key in audience.interests
    ]


async def _resolve_locations(
    *,
    access_token: str,
    audience: TargetAudience,
    custom_location: CustomLocation | None,
) -> list[ResolvedGeoLocation]:
    """Resolve an audience's structured locations into real Meta geo keys.

    Skipped entirely when custom_location is set — an event venue's
    radius is the geo target for the whole campaign (PRD.md build step
    11), overriding whatever locations the audience itself named, same
    "the event's geo constraint applies uniformly, not per-variant"
    reasoning as _resolve_custom_location.

    Args:
        access_token: The business's Meta access token.
        audience: The variant's (or DATA_DRIVEN_STRATEGY's) targeting.
        custom_location: The campaign's event-venue geo target, if any.

    Returns:
        One ResolvedGeoLocation per audience.location entry, or an empty
        list when there's nothing to resolve.

    Raises:
        geo.GeoResolutionError: If a location has no real US match at
            all — a subclass of MetaConnectionError, so this propagates
            through the same failure handling as any other Graph API
            call this function makes.
    """
    if custom_location is not None or not audience.location:
        return []
    return [
        await geo.resolve_target_location(
            access_token=access_token, city=loc.city, region=loc.region
        )
        for loc in audience.location
    ]


async def _publish_single_variant(
    *,
    campaign: Campaign,
    connection: MetaConnection,
    ad_account_id: str,
    creative: Creative,
    strategy: StrategyContent,
    meta_campaign_id: str,
    meta_creative_id: str,
    object_name: str,
    optimization_goal: str,
    pixel_id: str | None,
    custom_location: CustomLocation | None,
    end_time: datetime | None,
) -> None:
    """DATA_DRIVEN_STRATEGY (and pre-"Phase C" TEST_PLAN) path — one AdSet/Ad."""
    audience = primary_audience(strategy)
    daily_budget_cents = round(daily_budget(strategy) * 100)
    resolved_locations = await _resolve_locations(
        access_token=connection.accessToken,
        audience=audience,
        custom_location=custom_location,
    )

    meta_ad_set_id = await meta.create_meta_ad_set(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        name=object_name,
        meta_campaign_id=meta_campaign_id,
        daily_budget_cents=daily_budget_cents,
        optimization_goal=optimization_goal,
        age_min=audience.age_min or 18,
        age_max=audience.age_max or 65,
        pixel_id=pixel_id,
        custom_location=custom_location,
        resolved_locations=resolved_locations,
        interests=_resolve_interests(audience),
        end_time=end_time,
    )
    meta_ad_id = await meta.create_meta_ad(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        name=creative.headline,
        meta_ad_set_id=meta_ad_set_id,
        meta_creative_id=meta_creative_id,
    )

    ad_set = await db.adset.create(
        data={
            "campaignId": campaign.id,
            "name": object_name,
            "budget": daily_budget_cents / 100,
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


async def _publish_test_plan_variant(
    *,
    campaign: Campaign,
    connection: MetaConnection,
    ad_account_id: str,
    creative: Creative,
    variant: AudienceVariant,
    daily_budget_cents: int,
    meta_campaign_id: str,
    meta_creative_id: str,
    optimization_goal: str,
    pixel_id: str | None,
    custom_location: CustomLocation | None,
    end_time: datetime | None,
) -> None:
    """Publish one TEST_PLAN audience variant as its own real AdSet/Ad.

    daily_budget_cents is the PER-VARIANT rate (see
    app/schemas/strategy.py's TestPlanContent.daily_budget docstring) —
    each variant gets its own AdSet spending at this rate, not a split of
    one shared budget. advantage_audience is 1 for the broad/automated
    baseline (Meta-driven delivery, deliberately no interests) and 0 for
    the hypothesis-driven variant (explicit targeting, real resolved
    interests) — see AudienceVariant.is_baseline.
    """
    name = f"{campaign.name or campaign.id} — {variant.name}"
    resolved_locations = await _resolve_locations(
        access_token=connection.accessToken,
        audience=variant.targeting,
        custom_location=custom_location,
    )
    meta_ad_set_id = await meta.create_meta_ad_set(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        name=name,
        meta_campaign_id=meta_campaign_id,
        daily_budget_cents=daily_budget_cents,
        optimization_goal=optimization_goal,
        age_min=variant.targeting.age_min or 18,
        age_max=variant.targeting.age_max or 65,
        pixel_id=pixel_id,
        custom_location=custom_location,
        resolved_locations=resolved_locations,
        interests=_resolve_interests(variant.targeting),
        advantage_audience=1 if variant.is_baseline else 0,
        end_time=end_time,
    )
    meta_ad_id = await meta.create_meta_ad(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        name=creative.headline,
        meta_ad_set_id=meta_ad_set_id,
        meta_creative_id=meta_creative_id,
    )

    ad_set = await db.adset.create(
        data={
            "campaignId": campaign.id,
            "name": name,
            "budget": daily_budget_cents / 100,
            "optimizationGoal": optimization_goal,
            "status": "LIVE",
            "metaAdSetId": meta_ad_set_id,
            "variantId": variant.id,
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
    # The baseline variant reuses the originally SELECTED Creative row;
    # the hypothesis variant needs its own local row (Creative.adId is a
    # single nullable FK, one Creative -> at most one Ad) — same
    # underlying Meta creative object either way (metaCreativeId), so
    # Meta never sees this duplication, only the local data model does.
    if variant.is_baseline:
        await db.creative.update(
            where={"id": creative.id},
            data={"ad": {"connect": {"id": ad.id}}, "metaCreativeId": meta_creative_id},
        )
    else:
        await db.creative.create(
            data={
                "campaignId": campaign.id,
                "headline": creative.headline,
                "bodyText": creative.bodyText,
                "description": creative.description,
                "cta": creative.cta,
                "creativeAngle": creative.creativeAngle,
                "imagePrompt": creative.imagePrompt,
                "videoPrompt": creative.videoPrompt,
                "imageUrl": creative.imageUrl,
                "status": "SELECTED",
                "metaCreativeId": meta_creative_id,
                "adId": ad.id,
            }
        )


async def publish_campaign_to_meta(
    *,
    campaign: Campaign,
    connection: MetaConnection,
    creative: Creative,
    strategy: StrategyContent,
    destination_url: str,
) -> Campaign:
    """Create the campaign live on Meta, then mirror it locally.

    A TEST_PLAN campaign publishes both audience_variants as real,
    independent AdSets/Ads ("Phase C," confirmed 2026-09-02) — see the
    module docstring. Any other plan type publishes a single AdSet/Ad
    against primary_audience(strategy), unchanged from before Phase C.

    Args:
        campaign: The campaign being published (already confirmed
            APPROVED or FAILED-retry by the caller).
        connection: The business's Meta connection (already confirmed to
            have adAccountId/pageId set by the caller).
        creative: The campaign's SELECTED creative (already confirmed to
            exist by the caller).
        strategy: The campaign's parsed strategy — supplies the budget,
            targeting, and (for TEST_PLAN) both audience variants.
        destination_url: Where the ad's CTA button links to (already
            resolved by the caller: the product's URL or the business's
            website).

    Returns:
        The campaign, now LIVE with metaCampaignId set (and endDate, if
        one was computed and wasn't already set).

    Raises:
        MetaConnectionError: If any Graph API call fails. The campaign's
            status is left for the caller to move to FAILED — this
            function doesn't write that, so a caller can distinguish "we
            never even validated" (never called this) from "we tried and
            Meta rejected it" (caught here).
    """
    assert connection.adAccountId is not None
    assert connection.pageId is not None
    ad_account_id = connection.adAccountId

    optimization_goal = _OPTIMIZATION_GOAL_BY_OBJECTIVE[campaign.objective]
    object_name = campaign.name or f"Sales Guru campaign {campaign.id}"
    pixel_id = connection.pixelId if requires_pixel(campaign.objective) else None
    custom_location = _resolve_custom_location(campaign)

    # An event venue's window (campaign.endDate, PRD.md build step 11)
    # always wins when set, for either plan type. Otherwise a TEST_PLAN
    # gets one computed from its own duration_days, starting now (when
    # it's actually going live) — a DATA_DRIVEN_STRATEGY with no event
    # venue has no duration concept at all and keeps running
    # indefinitely, same as before this parameter existed.
    end_time = campaign.endDate
    if end_time is None and strategy.plan_type == "TEST_PLAN":
        end_time = datetime.now(UTC) + timedelta(days=strategy.duration_days)

    meta_campaign_id = await meta.create_meta_campaign(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        name=object_name,
        objective=campaign.objective,
    )
    meta_creative_id = await meta.create_meta_ad_creative(
        access_token=connection.accessToken,
        ad_account_id=ad_account_id,
        page_id=connection.pageId,
        name=creative.headline,
        headline=creative.headline,
        body_text=creative.bodyText,
        description=creative.description,
        cta=creative.cta,
        link=destination_url,
        image_url=creative.imageUrl,
    )

    if strategy.plan_type == "TEST_PLAN":
        daily_budget_cents = round(daily_budget(strategy) * 100)
        for variant in strategy.audience_variants:
            await _publish_test_plan_variant(
                campaign=campaign,
                connection=connection,
                ad_account_id=ad_account_id,
                creative=creative,
                variant=variant,
                daily_budget_cents=daily_budget_cents,
                meta_campaign_id=meta_campaign_id,
                meta_creative_id=meta_creative_id,
                optimization_goal=optimization_goal,
                pixel_id=pixel_id,
                custom_location=custom_location,
                end_time=end_time,
            )
    else:
        await _publish_single_variant(
            campaign=campaign,
            connection=connection,
            ad_account_id=ad_account_id,
            creative=creative,
            strategy=strategy,
            meta_campaign_id=meta_campaign_id,
            meta_creative_id=meta_creative_id,
            object_name=object_name,
            optimization_goal=optimization_goal,
            pixel_id=pixel_id,
            custom_location=custom_location,
            end_time=end_time,
        )

    update_data: CampaignUpdateInput = {
        "status": "LIVE",
        "metaCampaignId": meta_campaign_id,
    }
    if end_time is not None:
        update_data["endDate"] = end_time
    updated = await db.campaign.update(where={"id": campaign.id}, data=update_data)
    assert updated is not None  # just fetched by the caller, can't vanish mid-request
    return updated


async def pause_campaign(
    *, campaign: Campaign, connection: MetaConnection, reason: str
) -> Campaign:
    """Pause every live AdSet in a campaign — the campaign-wide "stop spending" action.

    Distinct from the Optimizer's PAUSE_AD recommendation
    (app/services/optimization_jobs.py's apply_recommendation), which
    pauses exactly one Ad and always requires a human's explicit
    approval first. This pauses at the AdSet level (stopping every Ad
    under it, TEST_PLAN's two variants included) and is never gated on
    LLM confidence — it's called directly by a human's manual pause
    click (app/api/campaign.py), the scheduled duration-elapsed job, and
    the deterministic total-spend circuit breaker (both in
    app/services/optimization_jobs.py).

    Args:
        campaign: The campaign to pause. Caller is responsible for
            confirming it's actually LIVE.
        connection: The business's Meta connection (already confirmed to
            have a usable accessToken by the caller).
        reason: Human-readable explanation stored on
            Campaign.pausedReason, so the UI can show *why* — e.g.
            "Manually paused", "Test window ended (10 days)", or
            "Total spend $1,042.10 exceeded the $1,000.00 planned
            budget".

    Returns:
        The campaign, now PAUSED.

    Raises:
        MetaConnectionError: If any Graph API call fails. Ad sets already
            paused before the failure stay paused — this doesn't roll
            back, same "no failed-publish rollback" known simplification
            as the rest of this module.
    """
    ad_sets = await db.adset.find_many(where={"campaignId": campaign.id})
    live_ad_set_ids: list[str] = []
    for ad_set in ad_sets:
        if ad_set.metaAdSetId is None:
            continue
        await meta.pause_meta_ad_set(
            access_token=connection.accessToken, meta_ad_set_id=ad_set.metaAdSetId
        )
        live_ad_set_ids.append(ad_set.id)

    if live_ad_set_ids:
        await db.adset.update_many(
            where={"id": {"in": live_ad_set_ids}}, data={"status": "PAUSED"}
        )
        await db.ad.update_many(
            where={"adSetId": {"in": live_ad_set_ids}}, data={"status": "PAUSED"}
        )

    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={"status": "PAUSED", "pausedReason": reason},
    )
    assert updated is not None  # just fetched by the caller, can't vanish mid-request
    return updated
