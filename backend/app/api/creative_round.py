"""Follow-up creative rounds on a creative test campaign.

Round 1 is the campaign's first batch (api/creative.py); a round is a further
batch of fresh ads the user picks from, 1 to 4 of them, to publish later. This
module only generates, lists, selects within and deletes rounds: selecting never
changes the campaign's status or touches a live ad, and nothing here publishes.
"""

import json
from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, Response, status
from prisma.models import Campaign, Creative, CreativeRound, MetaConnection
from prisma.types import CreativeUpdateInput, CreativeWhereInput

from app.api.campaign import (
    _COPY_NOT_PUBLISHABLE,
    _CREATIVE_STALE,
    _MEDIA_NOT_PUBLISHABLE,
    _META_NOT_CONNECTED,
    _NO_DESTINATION_URL,
    _NO_PIXEL_CONFIGURED,
)
from app.api.creative import (
    _current_business,
    _current_product,
    _saved_angles_for,
    _to_response,
    generate_batch,
)
from app.api.optimization import to_recommendation_response
from app.api.product_image import product_image_url
from app.core.authz import get_owned_campaign
from app.core.config import get_settings
from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.schemas.campaign import PublishCampaignRequest
from app.schemas.creative_round import (
    AdSetPlanResponse,
    ChooseWinnersRequest,
    CreativeRoundResponse,
    CreativeRoundStatus,
    EndRoundEarlyRequest,
    EndRoundEarlyResponse,
    PublishedRoundResponse,
    RoundAdResponse,
    RoundAdSetResponse,
    RoundLaunchSummary,
    RoundsOverviewResponse,
    WinnerCandidateResponse,
)
from app.schemas.optimization import RecommendationResponse
from app.schemas.strategy import (
    MAX_CREATIVE_ANGLES,
    CreativeAngle,
    CreativeTestPlanContent,
    DataDrivenStrategyContent,
    GeneratedCreativeAngle,
    StrategyContentAdapter,
    min_creative_test_daily_budget,
)
from app.services import meta, optimization_jobs, publish_jobs
from app.services.ad_set_rounds import (
    RoundPublishError,
    WinnerCandidate,
    chosen_winners,
    latest_round,
    next_round_problem,
    uses_ad_set_rounds,
    winner_candidates,
)
from app.services.brand_rules import banned_phrases_for
from app.services.buyer_avatars import assignable_avatars, avatar_refs
from app.services.creative import (
    copy_problems,
    is_creative_stale,
    media_problems,
    test_ads_required,
)
from app.services.meta import MetaConnectionError
from app.services.publish import publish_ad_set_round, requires_pixel
from app.services.round_results import load_round_results
from app.services.strategist import CarriedAd, StrategistError, generate_round_angles

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/rounds",
    tags=["creative-rounds"],
)

_NEEDS_CREATIVE_TEST = "Creative rounds are only available for a creative test"
_STANDARD_NO_ROUNDS = (
    "Standard campaigns can't run rounds: their budget sits on the ad set. "
    "Start a Creative Test or Data-Driven campaign to use rounds."
)
_NEEDS_FIRST_BATCH = "Generate the campaign's first ads before adding a round"
_ROUND_ALREADY_OPEN = (
    "This campaign already has an open round; finish or delete it before "
    "starting another"
)
_ROUND_NOT_FOUND = "Round not found"
_CREATIVE_NOT_FOUND = "Creative not found"
_ROUND_CLOSED = "This round is closed and can no longer be changed"
_ROUND_HAS_LIVE_ADS = "This round has ads on Meta and cannot be deleted"
_NO_PRODUCT_PHOTO = "Add a photo to the product before selecting an ad"
_CAMPAIGN_NOT_PUBLISHED = "Publish the campaign before publishing a round"
_SHARED_BUDGET_ROUNDS_RETIRED = (
    "This campaign uses a shared campaign budget, and new rounds can no longer be "
    "added to those: every round now runs on ad sets that each have their own "
    "budget. Start a new campaign to run more rounds."
)
_ROUND_NOT_OPEN = "This round is not open: it was already published"
_NOTHING_SELECTED = "Select at least one ad of this round to publish"
_ALREADY_PUBLISHING = "This campaign is already being published — wait for it to finish"
_ROUND_FORMAT = "Every ad of a round must be a {format} ad, like the rest of the test"
_ROUND_BUDGET_TOO_LOW = (
    "The campaign's daily budget must be at least ${minimum:,.0f} to run "
    "{count} ads ($10 each). Raise it in the test settings before adding this round."
)


async def _round_response(
    campaign: Campaign, round_: CreativeRound
) -> CreativeRoundResponse:
    """Map a round and its ads to the public response."""
    creatives = await db.creative.find_many(
        where={"campaignId": campaign.id, "roundId": round_.id},
        order={"createdAt": "asc"},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    product = await _current_product(campaign)
    business = await _current_business(campaign)
    avatars = await avatar_refs(business.id, [c.buyerAvatarId for c in creatives])
    saved_angles = await _saved_angles_for(campaign)
    return CreativeRoundResponse(
        id=round_.id,
        campaign_id=round_.campaignId,
        number=round_.number,
        status=cast(CreativeRoundStatus, round_.status),
        generated_count=round_.generatedCount,
        selected_count=round_.selectedCount,
        angles=[
            GeneratedCreativeAngle.model_validate(a) for a in json.loads(round_.angles)
        ],
        creatives=[
            _to_response(c, campaign, product, business, avatars, saved_angles)
            for c in creatives
        ],
        created_at=round_.createdAt,
    )


async def _owned_round(round_id: str, campaign: Campaign) -> CreativeRound:
    round_ = await db.creativeround.find_first(
        where={"id": round_id, "campaignId": campaign.id}
    )
    if round_ is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_ROUND_NOT_FOUND
        )
    return round_


async def _sync_selected_count(round_: CreativeRound) -> CreativeRound:
    """Store how many of the round's ads are selected on the round itself."""
    selected = await db.creative.count(
        where={"roundId": round_.id, "status": "SELECTED"}
    )
    updated = await db.creativeround.update(
        where={"id": round_.id}, data={"selectedCount": selected}
    )
    assert updated is not None  # just fetched, can't vanish mid-request
    return updated


async def _delete_round_rows(round_id: str) -> None:
    """Delete a round's ads, their cards and the round (no cascade in this schema)."""
    ids = [c.id for c in await db.creative.find_many(where={"roundId": round_id})]
    if ids:
        await db.creativecard.delete_many(where={"creativeId": {"in": ids}})
    await db.creative.delete_many(where={"roundId": round_id})
    await db.creativeround.delete(where={"id": round_id})


def _require_round_plan(plan: object) -> CreativeTestPlanContent:
    """The plan of a campaign that can take rounds, or a 400 saying why not.

    Creative Test and Data-Driven campaigns both store a creative-test plan, so
    one check serves both. A Standard campaign gets its own message.
    """
    if isinstance(plan, CreativeTestPlanContent):
        return plan
    detail = (
        _STANDARD_NO_ROUNDS
        if isinstance(plan, DataDrivenStrategyContent)
        else _NEEDS_CREATIVE_TEST
    )
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _require_ad_set_rounds(plan: CreativeTestPlanContent) -> None:
    """A 400 for a plan that keeps its budget on the campaign, not on each ad set.

    Rounds used to be added to such a campaign as "packs": ad sets with no budget of
    their own, drawing on the one campaign budget. That path was retired, so every
    round is an ad-set round; an older campaign can keep running but not take more.
    """
    if not uses_ad_set_rounds(plan):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_SHARED_BUDGET_ROUNDS_RETIRED,
        )


async def _ads_staying_live(campaign: Campaign) -> list[CarriedAd]:
    """The earlier ads still active, which a new round's ads should complement.

    Read from Meta (an ad's own status), so a loser the user paused is left out.
    When Meta can't be asked the new ads are made without this guidance rather
    than blocking the round.
    """
    connection = await get_meta_connection(campaign.businessId)
    if connection is None:
        return []
    try:
        found = await winner_candidates(campaign, access_token=connection.accessToken)
    except MetaConnectionError:
        return []
    return [
        CarriedAd(
            avatar=w.creative.avatar,
            concept=w.creative.concept,
            pillar=w.creative.pillar,
            hook_type=w.creative.hookType,
            headline=w.creative.headline,
        )
        for w in found
    ]


@router.post(
    "", response_model=CreativeRoundResponse, status_code=status.HTTP_201_CREATED
)
async def create_round(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeRoundResponse:
    """Generate a new round of ads on angles no earlier round used.

    Four ads, or three when the product lacks a fourth photo or video. The
    user selects 1 to 4 of them afterwards.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The new, open round with its ads.

    Raises:
        HTTPException: 400 if the campaign is not a creative test or has no
            first batch of ads yet; 409 if a round is already open; 500 if the
            Strategist or Creative Agent fails (nothing is kept).
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    plan = (
        StrategyContentAdapter.validate_json(strategy.content)
        if strategy is not None
        else None
    )
    plan = _require_round_plan(plan)
    _require_ad_set_rounds(plan)
    if await db.creative.count(where={"campaignId": campaign.id, "roundId": None}) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NEEDS_FIRST_BATCH
        )
    earlier = await db.creativeround.find_many(
        where={"campaignId": campaign.id}, order={"number": "asc"}
    )
    if any(r.status == "OPEN" for r in earlier):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_ALREADY_OPEN
        )

    problem = await next_round_problem(campaign.id)
    if problem is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=problem)
    carried = await _ads_staying_live(campaign)
    count = await test_ads_required(campaign, plan)
    excluded = list(plan.creative_angles)
    for r in earlier:
        excluded += [CreativeAngle.model_validate(a) for a in json.loads(r.angles)]

    business = await _current_business(campaign)
    product = await _current_product(campaign)
    audience = (
        await db.audience.find_unique(where={"id": campaign.audienceId})
        if campaign.audienceId
        else None
    )
    brand_profile = await db.brandprofile.find_unique(where={"businessId": business.id})
    try:
        angles = await generate_round_angles(
            business=business,
            product=product,
            audience=audience,
            plan=plan,
            excluded_angles=excluded,
            count=count,
            brand_profile=brand_profile,
            campaign_id=campaign.id,
            buyer_avatars=await assignable_avatars(business.id),
            previous_results=await load_round_results(campaign.id),
            carried=carried,
        )
    except StrategistError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    round_ = await db.creativeround.create(
        data={
            "campaignId": campaign.id,
            "number": max((r.number for r in earlier), default=1) + 1,
            "generatedCount": count,
            "angles": json.dumps([a.model_dump(mode="json") for a in angles]),
        }
    )
    round_plan = plan.model_copy(
        update={
            "creative_angles": [CreativeAngle(**a.model_dump()) for a in angles],
        }
    )
    try:
        await generate_batch(
            campaign,
            plan_override=round_plan,
            round_id=round_.id,
            batch_size=count,
            round_number=round_.number,
            avoid_hook_types=[c.hook_type for c in carried if c.hook_type],
        )
    except HTTPException:
        # generate_batch raised (including its own 500 for a Creative Agent
        # failure): keep no half-made round.
        await _delete_round_rows(round_.id)
        raise
    return await _round_response(campaign, round_)


@router.post("/pause-offer", response_model=list[RecommendationResponse])
async def offer_pauses_before_a_round(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[RecommendationResponse]:
    """Offer to pause the earlier rounds' losing ads before a new round launches.

    Nothing is paused here. Each loser becomes a pending proposal the user
    approves (or rejects) through the usual recommendation endpoints; asking
    again returns the same proposals.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The pending pause proposals; empty when no ad is a loser yet.

    Raises:
        HTTPException: 400 if the campaign is not published or cannot run rounds.
    """
    if campaign.metaCampaignId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CAMPAIGN_NOT_PUBLISHED
        )
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    _require_round_plan(
        StrategyContentAdapter.validate_json(strategy.content)
        if strategy is not None
        else None
    )
    offers = await optimization_jobs.offer_ad_pauses(campaign)
    return [to_recommendation_response(offer) for offer in offers]


async def _require_published_ad_set_plan(campaign: Campaign) -> CreativeTestPlanContent:
    """The campaign's plan, when it runs ad-set rounds and has been published."""
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    plan = _require_round_plan(
        StrategyContentAdapter.validate_json(strategy.content)
        if strategy is not None
        else None
    )
    if not uses_ad_set_rounds(plan):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_AD_SET_ROUNDS
        )
    if campaign.metaCampaignId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CAMPAIGN_NOT_PUBLISHED
        )
    return plan


@router.get("/overview", response_model=RoundsOverviewResponse)
async def rounds_overview(
    campaign: Campaign = Depends(get_owned_campaign),
) -> RoundsOverviewResponse:
    """Every published round with its ad sets, dates, budgets, ads and spend so far.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The rounds, oldest first, and why the next round can't start yet (if so).

    Raises:
        HTTPException: 400 if the campaign does not run ad-set rounds or is not
            published.
    """
    await _require_published_ad_set_plan(campaign)
    ad_sets = [
        a
        for a in await db.adset.find_many(
            where={"campaignId": campaign.id}, order={"createdAt": "asc"}
        )
        if a.packNumber is not None
    ]
    ads = await db.ad.find_many(
        where={"adSetId": {"in": [a.id for a in ad_sets]}},
        order={"createdAt": "asc"},
    )
    creatives = {
        c.adId: c
        for c in await db.creative.find_many(where={"campaignId": campaign.id})
        if c.adId is not None
    }
    spend: dict[str, float] = {}
    for metric in await db.metric.find_many(
        where={"campaignId": campaign.id}, order={"fetchedAt": "desc"}
    ):
        if metric.adId is not None and metric.adId not in spend:
            spend[metric.adId] = metric.spend
    rounds: dict[int, list[RoundAdSetResponse]] = {}
    for ad_set in ad_sets:
        ad_rows = [
            RoundAdResponse(
                ad_id=ad.id,
                name=ad.name,
                status=ad.status,
                creative_id=creatives[ad.id].id if ad.id in creatives else None,
                headline=creatives[ad.id].headline if ad.id in creatives else None,
                carried_from_round=(
                    creatives[ad.id].carriedFromRound if ad.id in creatives else None
                ),
                spend=spend.get(ad.id, 0.0),
            )
            for ad in ads
            if ad.adSetId == ad_set.id
        ]
        rounds.setdefault(ad_set.packNumber or 1, []).append(
            RoundAdSetResponse(
                id=ad_set.id,
                name=ad_set.name,
                is_winners=ad_set.isWinners,
                daily_budget=ad_set.budget,
                start_date=ad_set.startDate,
                end_date=ad_set.endDate,
                spend=sum(a.spend for a in ad_rows),
                ads=ad_rows,
            )
        )
    published = [
        PublishedRoundResponse(
            number=number,
            starts_at=min((a.start_date for a in sets if a.start_date), default=None),
            ends_at=max((a.end_date for a in sets if a.end_date), default=None),
            ad_sets=sets,
        )
        for number, sets in sorted(rounds.items())
    ]
    return RoundsOverviewResponse(
        max_rounds=get_settings().creative_test_max_rounds,
        next_round_problem=await next_round_problem(campaign.id),
        rounds=published,
    )


@router.post("/end-early", response_model=EndRoundEarlyResponse)
async def end_round_early(
    body: EndRoundEarlyRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> EndRoundEarlyResponse:
    """Stop the current round now, so the next one can start.

    Pauses every ad set on Meta and the campaign (reason "Round N ended early"), and
    moves the round's ad sets' end date to now. Needs the user's confirmation.

    Args:
        body: `confirmed` must be true.
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The round that was ended and when.

    Raises:
        HTTPException: 400 without confirmation or when Meta is not connected; 409
            when no round is running; 500 if pausing on Meta fails.
    """
    await _require_published_ad_set_plan(campaign)
    window = await latest_round(campaign.id)
    now = datetime.now(UTC)
    if window is None or window.ends_at <= now:
        number = window.number if window is not None else 1
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Round {number} has already finished.",
        )
    if not body.confirmed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CONFIRM_END_EARLY
        )
    connection = await get_meta_connection(campaign.businessId)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )
    reason = f"Round {window.number} ended early"
    try:
        if campaign.status == "LIVE":
            await optimization_jobs.pause_campaign_and_capture(
                campaign=campaign, connection=connection, reason=reason
            )
        else:
            for ad_set in window.ad_sets:
                if ad_set.metaAdSetId is not None:
                    await meta.pause_meta_ad_set(
                        access_token=connection.accessToken,
                        meta_ad_set_id=ad_set.metaAdSetId,
                    )
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    await db.adset.update_many(
        where={"id": {"in": [a.id for a in window.ad_sets]}}, data={"endDate": now}
    )
    return EndRoundEarlyResponse(round_number=window.number, ended_at=now)


async def _launch_summary(
    campaign: Campaign, round_: CreativeRound, plan: CreativeTestPlanContent
) -> RoundLaunchSummary:
    """What publishing this open round would do, for the user to confirm."""
    connection = await get_meta_connection(campaign.businessId)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )
    new_ads = await db.creative.count(
        where={"roundId": round_.id, "status": "SELECTED", "adId": None}
    )
    chosen_ids = (
        json.loads(round_.winnerCreativeIds) if round_.winnerCreativeIds else None
    )
    try:
        candidates = await winner_candidates(
            campaign, access_token=connection.accessToken
        )
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    needs_choice = chosen_ids is None and len(candidates) > plan.max_winners
    if needs_choice:
        carried: set[str] = set()
    elif chosen_ids is None:
        carried = {c.creative.id for c in candidates}
    else:
        carried = set(chosen_ids)
    winners_budget = plan.winners_daily_budget if carried else 0.0
    daily_total = plan.daily_budget + winners_budget
    return RoundLaunchSummary(
        restarts_campaign=campaign.status != "LIVE",
        new_ad_set=AdSetPlanResponse(daily_budget=plan.daily_budget, ad_count=new_ads),
        winners_ad_set=(
            AdSetPlanResponse(
                daily_budget=plan.winners_daily_budget, ad_count=len(carried)
            )
            if carried
            else None
        ),
        winner_candidates=[
            WinnerCandidateResponse(
                creative_id=c.creative.id,
                ad_name=c.ad.name,
                headline=c.creative.headline,
                avatar=c.creative.avatar,
                concept=c.creative.concept,
                first_round=c.first_round,
                chosen=c.creative.id in carried,
            )
            for c in candidates
        ],
        max_winners=plan.max_winners,
        needs_choice=needs_choice,
        daily_total=daily_total,
        planned_max=daily_total * plan.duration_days,
        duration_days=plan.duration_days,
    )


@router.get("/{round_id}/launch-summary", response_model=RoundLaunchSummary)
async def round_launch_summary(
    round_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> RoundLaunchSummary:
    """Both budgets, the winners and whether a restart is needed, before publishing.

    Args:
        round_id: The open round.
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The summary the user confirms.

    Raises:
        HTTPException: 400/404/409 as for publishing (not published, not this
            campaign's round, round already published).
    """
    plan = await _require_published_ad_set_plan(campaign)
    round_ = await _owned_round(round_id, campaign)
    if round_.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_NOT_OPEN
        )
    return await _launch_summary(campaign, round_, plan)


@router.put("/{round_id}/winners", response_model=RoundLaunchSummary)
async def choose_round_winners(
    round_id: str,
    body: ChooseWinnersRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> RoundLaunchSummary:
    """Pick which earlier ads this round carries into its winners ad set.

    Args:
        round_id: The open round.
        body: The Creative ids to carry (at most the plan's `max_winners`, each an
            ad that is still active).
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The updated launch summary.

    Raises:
        HTTPException: 400 for too many ads or one that is not active; 404/409 as
            for the summary.
    """
    plan = await _require_published_ad_set_plan(campaign)
    round_ = await _owned_round(round_id, campaign)
    if round_.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_NOT_OPEN
        )
    connection = await get_meta_connection(campaign.businessId)
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )
    try:
        candidates = await winner_candidates(
            campaign, access_token=connection.accessToken
        )
        chosen_winners(candidates, body.creative_ids, limit=plan.max_winners)
    except RoundPublishError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    updated = await db.creativeround.update(
        where={"id": round_.id},
        data={"winnerCreativeIds": json.dumps(body.creative_ids)},
    )
    return await _launch_summary(campaign, updated or round_, plan)


@router.get("", response_model=list[CreativeRoundResponse])
async def list_rounds(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[CreativeRoundResponse]:
    """List a campaign's follow-up rounds, oldest first, with their ads."""
    rounds = await db.creativeround.find_many(
        where={"campaignId": campaign.id}, order={"number": "asc"}
    )
    return [await _round_response(campaign, r) for r in rounds]


@router.get("/{round_id}", response_model=CreativeRoundResponse)
async def get_round(
    round_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Fetch one round with its ads (404 if it is not this campaign's)."""
    return await _round_response(campaign, await _owned_round(round_id, campaign))


@router.delete("/{round_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_round(
    round_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> Response:
    """Delete a round and its ads, freeing the campaign's single round slot.

    Raises:
        HTTPException: 404 if the round is not this campaign's; 409 if any of
            its ads is already on Meta.
    """
    round_ = await _owned_round(round_id, campaign)
    on_meta: CreativeWhereInput = {
        "roundId": round_.id,
        "OR": [{"NOT": [{"adId": None}]}, {"NOT": [{"metaCreativeId": None}]}],
    }
    live = await db.creative.count(where=on_meta)
    if live:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_HAS_LIVE_ADS
        )
    await _delete_round_rows(round_.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _change_selection(
    round_id: str, creative_id: str, campaign: Campaign, *, select: bool
) -> CreativeRoundResponse:
    """Select or deselect one of an open round's ads.

    Only the ad's own status and the round's selectedCount change: never the
    campaign's status, round 1, or any ad already on Meta.
    """
    round_ = await _owned_round(round_id, campaign)
    if round_.status != "OPEN":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_ROUND_CLOSED)
    creative = await db.creative.find_first(
        where={"id": creative_id, "campaignId": campaign.id, "roundId": round_.id}
    )
    if creative is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CREATIVE_NOT_FOUND
        )
    data: CreativeUpdateInput = {"status": "SELECTED" if select else "GENERATED"}
    if select and creative.format == "SINGLE_IMAGE" and creative.imageUrl is None:
        photo = (
            await db.productimage.find_first(
                where={"productId": campaign.productId, "mediaType": "IMAGE"},
                order={"position": "asc"},
            )
            if campaign.productId is not None
            else None
        )
        if campaign.productId is not None and photo is None:
            raise HTTPException(
                status_code=status.HTTP_428_PRECONDITION_REQUIRED,
                detail=_NO_PRODUCT_PHOTO,
            )
        if photo is not None:
            data["imageUrl"] = product_image_url(photo.id)
            data["productImageId"] = photo.id
    await db.creative.update(where={"id": creative.id}, data=data)
    return await _round_response(campaign, await _sync_selected_count(round_))


@router.post("/{round_id}/creatives/{creative_id}/select")
async def select_round_creative(
    round_id: str, creative_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Select one of an open round's ads (any number from 1 to all of them)."""
    return await _change_selection(round_id, creative_id, campaign, select=True)


@router.post("/{round_id}/creatives/{creative_id}/deselect")
async def deselect_round_creative(
    round_id: str, creative_id: str, campaign: Campaign = Depends(get_owned_campaign)
) -> CreativeRoundResponse:
    """Take one of an open round's ads out of the selection."""
    return await _change_selection(round_id, creative_id, campaign, select=False)


_NOT_AD_SET_ROUNDS = "This campaign's rounds don't run on separate ad-set budgets"
_CONFIRM_END_EARLY = "Ending a round early stops its ads now. Confirm to go ahead."
_ROUNDS_LIVE_ONLY = (
    "A round of this kind publishes live, because it replaces the round before it. "
    "Publish it without the paused option."
)
_RESTART = (
    "Publishing this round restarts the paused campaign: ${new:g}/day for the new "
    "ads{winners}. That is about ${total:g}/day, and up to ${cap:,.0f} over the "
    "{days} days. Confirm to go ahead."
)


async def _winners_for_publish(
    campaign: Campaign,
    connection: MetaConnection,
    round_: CreativeRound,
    plan: CreativeTestPlanContent,
    creatives: list[Creative],
    payload: PublishCampaignRequest | None,
) -> list[WinnerCandidate]:
    """The earlier ads this ad-set round carries, after the checks that precede it.

    Raises:
        HTTPException: 400 when the round is asked to publish paused, when more
            ads are active than a round may carry, or when the winners' budget is
            too low for them; 409 when the campaign is paused and the user has not
            confirmed the restart; 500 when Meta can't be asked about an ad.
    """
    if payload is not None and payload.paused:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_ROUNDS_LIVE_ONLY
        )
    chosen = json.loads(round_.winnerCreativeIds) if round_.winnerCreativeIds else None
    try:
        candidates = await winner_candidates(
            campaign, access_token=connection.accessToken
        )
        winners = chosen_winners(candidates, chosen, limit=plan.max_winners)
    except RoundPublishError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    if winners and plan.winners_daily_budget < min_creative_test_daily_budget(
        len(winners)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_ROUND_BUDGET_TOO_LOW.format(
                minimum=min_creative_test_daily_budget(len(winners)),
                count=len(winners),
            ),
        )
    if campaign.status != "LIVE" and not (payload and payload.confirm_restart):
        total = plan.daily_budget + (plan.winners_daily_budget if winners else 0)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_RESTART.format(
                new=plan.daily_budget,
                winners=(
                    f" and ${plan.winners_daily_budget:g}/day for the winners"
                    if winners
                    else ""
                ),
                total=total,
                cap=total * plan.duration_days,
                days=plan.duration_days,
            ),
        )
    return winners


@router.post("/{round_id}/publish", response_model=CreativeRoundResponse)
async def publish_round(
    round_id: str,
    response: Response,
    payload: PublishCampaignRequest | None = None,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CreativeRoundResponse:
    """Publish an open round's selected ads: a new ad set, plus a winners ad set.

    Both ad sets are created in the campaign already on Meta (no second campaign),
    each with its own daily budget and the same start and end. The round is CLOSED on
    success. A failure removes what the round made and leaves it open. A video round
    runs as the campaign's background publish (answers 202; poll
    GET .../publish/status), like a first video publish.

    Args:
        round_id: The round to publish.
        response: The response, for the 202 of a background (video) publish.
        payload: Optionally publishes everything PAUSED.
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The round (CLOSED once published).

    Raises:
        HTTPException: 400 if the campaign is not published, keeps one shared
            campaign budget (new rounds are no longer added to those), the round has no
            selected ad, an ad is stale, over-length or missing media, the
            destination URL or Pixel is missing, or Meta is not connected; 404
            if the round is not this campaign's; 409 if the round is not open or
            the campaign is already being published; 500 if a Meta call fails.
    """
    round_ = await _owned_round(round_id, campaign)
    if publish_jobs.is_running(campaign.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ALREADY_PUBLISHING
        )
    if campaign.metaCampaignId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CAMPAIGN_NOT_PUBLISHED
        )
    if round_.status != "OPEN":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_ROUND_NOT_OPEN
        )
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    plan = _require_round_plan(
        StrategyContentAdapter.validate_json(strategy.content)
        if strategy is not None
        else None
    )
    _require_ad_set_rounds(plan)
    creatives = await db.creative.find_many(
        where={"roundId": round_.id, "status": "SELECTED"},
        order={"createdAt": "asc"},
        include={"cards": {"order_by": {"position": "asc"}}},
    )
    if not 1 <= len(creatives) <= MAX_CREATIVE_ANGLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOTHING_SELECTED
        )

    connection = await get_meta_connection(campaign.businessId)
    if (
        connection is None
        or connection.adAccountId is None
        or connection.pageId is None
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )
    if requires_pixel(campaign.objective) and connection.pixelId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_PIXEL_CONFIGURED
        )

    business = await _current_business(campaign)
    product = await _current_product(campaign)
    if any(c.format != plan.creative_format for c in creatives):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_ROUND_FORMAT.format(format=plan.creative_format),
        )
    if any(is_creative_stale(c, campaign, product, business) for c in creatives):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_CREATIVE_STALE
        )
    banned_phrases = await banned_phrases_for(business.id)
    copy_failures = [
        f"Ad '{c.headline}' — {'; '.join(problems)}"
        for c in creatives
        if (problems := copy_problems(c, banned_phrases))
    ]
    media_failures = [
        f"Ad '{c.headline}' — {'; '.join(problems)}"
        for c in creatives
        if (problems := await media_problems(c))
    ]
    if media_failures:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_MEDIA_NOT_PUBLISHABLE.format(failures=" | ".join(media_failures)),
        )
    if copy_failures:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_COPY_NOT_PUBLISHABLE.format(failures=" | ".join(copy_failures)),
        )
    destination_url = (product.url if product else None) or business.website
    if not destination_url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_DESTINATION_URL
        )
    winners = await _winners_for_publish(
        campaign, connection, round_, plan, creatives, payload
    )
    # The round's new ad set carries only its own ads, each needing its own $10 a day.
    minimum = min_creative_test_daily_budget(len(creatives))
    if plan.daily_budget < minimum:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_ROUND_BUDGET_TOO_LOW.format(minimum=minimum, count=len(creatives)),
        )

    async def publish(report: Callable[[str, int | None], None] | None) -> None:
        await publish_ad_set_round(
            campaign=campaign,
            connection=connection,
            round_=round_,
            creatives=creatives,
            strategy=plan,
            destination_url=destination_url,
            winners=winners,
            report=report,
        )

    if any(c.format == "SINGLE_VIDEO" for c in creatives):
        # Uploading and processing a video takes minutes: run it as the
        # campaign's background publish, which the frontend already polls.
        async def mark_failed() -> None:
            # The campaign stays as it is: a failed round never fails the campaign.
            return None

        publish_jobs.start_job(campaign.id, publish, mark_failed)
        response.status_code = status.HTTP_202_ACCEPTED
    else:
        try:
            await publish(None)
        except RoundPublishError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
            ) from exc
        except MetaConnectionError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
            ) from exc
    refreshed = await _owned_round(round_.id, campaign)
    return await _round_response(campaign, refreshed)
