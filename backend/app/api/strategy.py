"""Marketing Strategist Agent endpoints (PRD.md build step 5).

Two-mode agent (confirmed with the user 2026-08-31) — see app/services/
strategist.py's module docstring for the full reasoning. This module owns
plan_type resolution, since it's the only layer with DB/Meta-network
access: real Meta ad-account history always wins when available; otherwise
falls back to the business's one-time self-reported answer, asking for it
(428) if it's never been given and no real history exists either.
"""

from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, Strategy

from app.core.authz import get_owned_campaign
from app.core.config import get_settings
from app.core.db import db
from app.core.meta_connection import get_meta_connection
from app.core.published_guard import ALREADY_PUBLISHED, ensure_not_published
from app.schemas.strategy import (
    CAMPAIGN_BUDGET_LEVEL,
    CampaignTypeOption,
    CampaignTypeOptions,
    CreateStrategyRequest,
    CreativeTestFormat,
    CreativeTestPlanContent,
    StrategyContent,
    StrategyContentAdapter,
    StrategyResponse,
    TestSettingsResponse,
    UpdateTestSettingsRequest,
    min_creative_test_daily_budget,
)
from app.services.buyer_avatars import assignable_avatars
from app.services.campaign_readiness import is_ready
from app.services.campaign_type import (
    DESCRIPTIONS as CAMPAIGN_TYPE_DESCRIPTIONS,
)
from app.services.campaign_type import (
    GEO_COMING_SOON,
    NOT_SALES,
    STANDARD_WARNING,
    CampaignType,
    budget_level_for,
    plan_type_for,
    recommend_campaign_type,
    structure_summary,
)
from app.services.campaign_type import label as campaign_type_label
from app.services.creative import test_ads_required
from app.services.creative_test_settings import PIXEL_WINDOW_DAYS, event_advice
from app.services.meta import (
    AccountCampaignInsights,
    MetaConnectionError,
    fetch_account_historical_performance,
    fetch_pixel_event_counts,
    has_meaningful_history,
)
from app.services.strategist import (
    PlanType,
    StrategistError,
    apply_test_settings,
    generate_strategy,
)

# CreateStrategyRequest.test_format -> the plan's creative_format.
_TEST_FORMATS: dict[str, CreativeTestFormat] = {
    "IMAGE": "SINGLE_IMAGE",
    "VIDEO": "SINGLE_VIDEO",
    "CAROUSEL": "CAROUSEL",
}

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/strategy",
    tags=["strategy"],
)

_STRATEGY_NOT_FOUND = "Strategy not found"
_ALREADY_PUBLISHED = (
    "This campaign is already published, so its strategy can't be regenerated. "
    "Create a new campaign to try a different strategy."
)
_CAMPAIGN_NOT_READY = (
    "Add a product and an audience to this campaign before generating a strategy"
)


async def _to_response(strategy: Strategy, campaign: Campaign) -> StrategyResponse:
    """Map a Prisma Strategy record to its public response shape.

    Args:
        strategy: The Prisma Strategy model instance.
        campaign: The campaign it belongs to.

    Returns:
        The public-facing representation, with `content` parsed from its
        stored JSON string into the right plan-type model. For a creative
        test it also says how many ads the test needs selected.
    """
    content = StrategyContentAdapter.validate_json(strategy.content)
    required = (
        await test_ads_required(campaign, content)
        if content.plan_type == "CREATIVE_TEST_PLAN"
        else None
    )
    stored_type = campaign.campaignType
    summary = None
    if stored_type is not None:
        summary = structure_summary(
            cast(CampaignType, stored_type),
            ad_count=required or 1,
            daily_budget=getattr(content, "daily_budget", None) or 0,
        )
    return StrategyResponse(
        id=strategy.id,
        campaign_id=strategy.campaignId,
        content=content,
        created_at=strategy.createdAt,
        required_test_ads=required,
        campaign_type=stored_type,
        structure_summary=summary,
    )


async def _account_history(business_id: str) -> list[AccountCampaignInsights]:
    """The ad account's per-campaign history; empty without Meta or on a failure.

    Degrades to "no history" rather than blocking strategy generation on a Meta
    Insights outage.
    """
    meta_connection = await get_meta_connection(business_id)
    if meta_connection is None or meta_connection.adAccountId is None:
        return []
    try:
        return await fetch_account_historical_performance(
            access_token=meta_connection.accessToken,
            ad_account_id=meta_connection.adAccountId,
        )
    except MetaConnectionError:
        return []


def _budget_level(campaign_type: CampaignType, content: StrategyContent) -> str:
    """Where this plan's daily budget sits.

    The type decides, except that a creative-test plan still bidding with a cost
    cap (a plan stored before lowest-cost bidding) keeps its budget on the ad set,
    where its cap lives.
    """
    level = budget_level_for(campaign_type)
    if (
        level == CAMPAIGN_BUDGET_LEVEL
        and isinstance(content, CreativeTestPlanContent)
        and content.bid_strategy != "LOWEST_COST"
    ):
        return "AD_SET"
    return level


def _type_problem(campaign_type: CampaignType, objective: str) -> str | None:
    """Why a type can't be used for this campaign, or None when it can."""
    if campaign_type == "GEO":
        return GEO_COMING_SOON
    if objective != "SALES" and campaign_type != "LEGACY_AUDIENCE_TEST":
        return NOT_SALES
    if objective == "SALES" and campaign_type == "LEGACY_AUDIENCE_TEST":
        return "The audience test is only for objectives other than Sales."
    return None


types_router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/campaign-types",
    tags=["strategy"],
)


@types_router.get("", response_model=CampaignTypeOptions)
async def campaign_type_options(
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignTypeOptions:
    """The campaign-type dropdown for this campaign.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The recommended (preselected) type and every type with its description,
        whether it can be picked and why not. The user can always pick another
        available type; the recommendation never routes anything.
    """
    has_history = has_meaningful_history(await _account_history(campaign.businessId))
    options: list[CampaignTypeOption] = []
    for type_ in (
        "CREATIVE_TEST",
        "DATA_DRIVEN",
        "STANDARD",
        "GEO",
        "LEGACY_AUDIENCE_TEST",
    ):
        problem = _type_problem(type_, campaign.objective)
        if type_ == "LEGACY_AUDIENCE_TEST" and problem is not None:
            continue  # only shown to the objectives that use it
        options.append(
            CampaignTypeOption(
                type=type_,
                label=campaign_type_label(type_),
                description=CAMPAIGN_TYPE_DESCRIPTIONS[type_],
                available=problem is None,
                reason=problem,
                warning=STANDARD_WARNING if type_ == "STANDARD" else None,
            )
        )
    return CampaignTypeOptions(
        recommended=recommend_campaign_type(
            objective=campaign.objective, has_history=has_history
        ),
        options=options,
    )


@router.post("", response_model=StrategyResponse, status_code=status.HTTP_201_CREATED)
async def create_strategy(
    body: CreateStrategyRequest | None = None,
    campaign: Campaign = Depends(get_owned_campaign),
) -> StrategyResponse:
    """Generate a strategy for a campaign, replacing any existing one.

    Args:
        body: Optionally answers the one-time "has this business
            advertised before?" question — only consulted when needed
            (see module docstring). None (no body sent at all) is treated
            the same as an unanswered question.
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly generated strategy.

    Raises:
        HTTPException: 400 if the campaign is already published (its strategy is
            fixed; create a new campaign instead). 428 if the campaign has no
            product and audience
            attached yet (app/services/campaign_readiness.py), or if
            plan-type can't be determined yet (no real Meta history,
            business hasn't answered the one-time question, and this
            request didn't answer it either) — the frontend should prompt
            the user and resubmit with an answer. 500 if the Strategist
            Agent isn't configured or the LLM call fails.
    """
    # A published campaign's strategy is what its ads were built from; regenerating
    # it would also reset the campaign's status (to "Strategy generated") while it
    # is still on Meta.
    if campaign.metaCampaignId is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_ALREADY_PUBLISHED
        )

    if not is_ready(campaign):
        raise HTTPException(
            status_code=status.HTTP_428_PRECONDITION_REQUIRED,
            detail=_CAMPAIGN_NOT_READY,
        )

    business = await db.business.find_unique(where={"id": campaign.businessId})
    assert business is not None  # guaranteed by the FK, not user input

    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )
    audience = (
        await db.audience.find_unique(where={"id": campaign.audienceId})
        if campaign.audienceId
        else None
    )
    brand_profile = await db.brandprofile.find_unique(where={"businessId": business.id})

    account_history = await _account_history(business.id)
    has_history = has_meaningful_history(account_history)
    if (
        business.hasPriorAdvertisingExperience is None
        and body is not None
        and body.has_prior_advertising_experience is not None
    ):
        # Still recorded when a client sends it, but it no longer routes anything.
        await db.business.update(
            where={"id": business.id},
            data={
                "hasPriorAdvertisingExperience": body.has_prior_advertising_experience
            },
        )

    chosen: CampaignType | None = None
    if body is not None:
        chosen = body.campaign_type or (
            "STANDARD" if body.strategy_mode == "STANDARD" else None
        )
    campaign_type: CampaignType = chosen or recommend_campaign_type(
        objective=campaign.objective, has_history=has_history
    )
    problem = _type_problem(campaign_type, campaign.objective)
    if problem is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=problem)
    plan_type: PlanType = plan_type_for(campaign_type)

    try:
        content = await generate_strategy(
            business=business,
            product=product,
            audience=audience,
            objective=campaign.objective,
            plan_type=plan_type,
            account_history=account_history,
            brand_profile=brand_profile,
            creative_format=_TEST_FORMATS.get(
                body.test_format if body is not None and body.test_format else "IMAGE",
                "SINGLE_IMAGE",
            ),
            campaign_id=campaign.id,
            buyer_avatars=await assignable_avatars(business.id),
            campaign_type=campaign_type,
        )
    except StrategistError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    await db.strategy.delete_many(where={"campaignId": campaign.id})
    strategy = await db.strategy.create(
        data={
            "campaignId": campaign.id,
            "content": content.model_dump_json(by_alias=True),
        }
    )
    # The chosen type decides where the budget sits: the round-based types keep
    # one campaign budget the winning ads draw from; the rest keep it per ad set.
    # A creative test that still bids with a cost cap (an older plan) keeps the
    # budget on the ad set, so nothing already stored changes meaning.
    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={
            "status": "STRATEGY_GENERATED",
            "budgetLevel": _budget_level(campaign_type, content),
            "campaignType": campaign_type,
        },
    )
    if updated is not None:
        campaign = updated

    return await _to_response(strategy, campaign)


@router.get("", response_model=StrategyResponse)
async def get_strategy(
    campaign: Campaign = Depends(get_owned_campaign),
) -> StrategyResponse:
    """Fetch the strategy already generated for a campaign.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's strategy.

    Raises:
        HTTPException: 404 if no strategy has been generated yet.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_STRATEGY_NOT_FOUND
        )
    return await _to_response(strategy, campaign)


_NO_TEST_SETTINGS = (
    "This campaign's budget sits on its ad set, so it has no campaign-level "
    "test settings."
)


async def _creative_test_for_settings(
    campaign: Campaign,
) -> tuple[Strategy, CreativeTestPlanContent]:
    """The campaign's stored creative test plan, if it has per-campaign settings.

    Args:
        campaign: The campaign.

    Returns:
        The stored strategy row and its CREATIVE_TEST_PLAN content.

    Raises:
        HTTPException: 404 with no strategy; 400 when the plan isn't a
            creative test under a campaign budget (an older campaign).
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    if strategy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_STRATEGY_NOT_FOUND
        )
    content = StrategyContentAdapter.validate_json(strategy.content)
    if (
        content.plan_type != "CREATIVE_TEST_PLAN"
        or campaign.budgetLevel != CAMPAIGN_BUDGET_LEVEL
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NO_TEST_SETTINGS
        )
    return strategy, content


async def _pixel_purchase_count(business_id: str) -> int | None:
    """The Pixel's Purchase events over the last 30 days, or None if unreadable."""
    connection = await get_meta_connection(business_id)
    if connection is None or connection.pixelId is None:
        return None
    try:
        counts = await fetch_pixel_event_counts(
            access_token=connection.accessToken,
            pixel_id=connection.pixelId,
            days=PIXEL_WINDOW_DAYS,
        )
    except MetaConnectionError:
        return None
    return counts.get("Purchase", 0)


async def _test_settings_response(
    campaign: Campaign, plan: CreativeTestPlanContent
) -> TestSettingsResponse:
    """A plan's settings, with the minimum budget and the event advice."""
    product = (
        await db.product.find_unique(where={"id": campaign.productId})
        if campaign.productId
        else None
    )
    ad_count = await test_ads_required(campaign, plan)
    return TestSettingsResponse(
        daily_budget=plan.daily_budget,
        min_daily_budget=min_creative_test_daily_budget(ad_count),
        duration_days=plan.duration_days,
        total_budget=plan.total_budget,
        optimization_event=plan.optimization_event,
        ad_count=ad_count,
        advice=event_advice(
            price=product.price if product is not None else None,
            high_ticket_threshold=get_settings().high_ticket_price_threshold,
            purchase_count=await _pixel_purchase_count(campaign.businessId),
        ),
    )


@router.get("/test-settings", response_model=TestSettingsResponse)
async def get_test_settings(
    campaign: Campaign = Depends(get_owned_campaign),
) -> TestSettingsResponse:
    """A creative test's budget and conversion event, and advice on the event.

    The advice is a recommendation only: it says when Add to Cart is worth
    considering (a high price, or no Purchase events on the Pixel in 30 days)
    and never changes the plan.

    Args:
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The settings, the minimum budget and the advice.

    Raises:
        HTTPException: 404 with no strategy; 400 when the campaign has no
            campaign-level settings (not a creative test, or an older
            campaign whose budget sits on its ad set).
    """
    _, plan = await _creative_test_for_settings(campaign)
    return await _test_settings_response(campaign, plan)


@router.patch("/test-settings", response_model=TestSettingsResponse)
async def update_test_settings(
    body: UpdateTestSettingsRequest,
    campaign: Campaign = Depends(get_owned_campaign),
) -> TestSettingsResponse:
    """Set a creative test's daily budget and/or conversion event before publishing.

    The total follows the budget (budget x the test's days). The event is only
    ever changed here, by the user's choice. An approved campaign goes back to
    pending approval, since the approved content just changed.

    Args:
        body: The new budget and/or event.
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The updated settings.

    Raises:
        HTTPException: 400 if the campaign is published or has no
            campaign-level settings; 404 with no strategy; 422 with nothing to
            change or a budget under the minimum ($10 for each ad in the test).
    """
    await ensure_not_published(campaign, ALREADY_PUBLISHED)
    strategy, plan = await _creative_test_for_settings(campaign)
    if body.daily_budget is None and body.optimization_event is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Send a dailyBudget and/or an optimizationEvent to change.",
        )
    minimum = min_creative_test_daily_budget(await test_ads_required(campaign, plan))
    budget = body.daily_budget if body.daily_budget is not None else plan.daily_budget
    if budget < minimum:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"The daily budget must be at least ${minimum:,.0f} for this "
                "test's ads ($10 each), so every ad can spend enough to learn."
            ),
        )
    updated = apply_test_settings(
        plan,
        daily_budget=budget,
        optimization_event=body.optimization_event or plan.optimization_event,
        add_to_cart_to_purchase_rate=get_settings().add_to_cart_to_purchase_rate,
    )
    await db.strategy.update(
        where={"id": strategy.id},
        data={"content": updated.model_dump_json(by_alias=True)},
    )
    if campaign.status == "APPROVED":
        await db.campaign.update(
            where={"id": campaign.id}, data={"status": "PENDING_APPROVAL"}
        )
    return await _test_settings_response(campaign, updated)
