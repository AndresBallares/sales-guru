"""Campaign dashboard endpoints: read-only, computed from stored Metric rows."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, Campaign

from app.core.authz import get_owned_business, get_owned_campaign
from app.core.config import get_settings
from app.core.db import db
from app.schemas.dashboard import BusinessDashboardSummary, CampaignDashboardResponse
from app.schemas.strategy import CAMPAIGN_BUDGET_LEVEL, StrategyContentAdapter
from app.services import dashboard as dash
from app.services.dashboard_sample import sample_business, sample_campaign

router = APIRouter(prefix="/businesses/{business_id}", tags=["dashboard"])

_SAMPLE_UNAVAILABLE = (
    "Sample data is only available in local development "
    "(start the backend with DASHBOARD_SAMPLE_DATA=1)"
)


def _require_sample_allowed() -> None:
    """404 unless a local sample/fake flag is on (never true in production)."""
    settings = get_settings()
    if not (settings.dashboard_sample_enabled or settings.fake_meta_enabled):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_SAMPLE_UNAVAILABLE
        )


async def _campaign_snapshots(campaign: Campaign) -> list[dash.Snapshot]:
    """The campaign's stored rows, as the dashboard reads them.

    Under a campaign budget (CBO) the campaign-level rows are the whole
    spend, so per-ad-set (pack) rows are dropped: summed with them the
    totals would count the same spend twice. Ad-level rows stay, as the
    per-ad numbers.
    """
    metrics = await db.metric.find_many(where={"campaignId": campaign.id})
    if campaign.budgetLevel == CAMPAIGN_BUDGET_LEVEL:
        metrics = [m for m in metrics if m.adSetId is None or m.adId is not None]
    return [dash.snapshot_from_metric(m) for m in metrics]


@router.get(
    "/campaigns/{campaign_id}/dashboard", response_model=CampaignDashboardResponse
)
async def campaign_dashboard(
    sample: bool = False,
    campaign: Campaign = Depends(get_owned_campaign),
) -> CampaignDashboardResponse:
    """One campaign's dashboard: verdict, early signals and the per-ad table.

    Every total is the latest lifetime snapshot per level, never a sum over
    time (see app/services/dashboard.py).

    Args:
        sample: Local development only: return in-memory sample numbers
            instead of stored ones (404 unless DASHBOARD_SAMPLE_DATA or
            FAKE_META is on).
        campaign: The campaign, resolved and ownership-checked.

    Returns:
        The dashboard; has_data is False (and the tiers null) until the first
        snapshot is collected.
    """
    strategy = await db.strategy.find_unique(where={"campaignId": campaign.id})
    content = (
        StrategyContentAdapter.validate_json(strategy.content) if strategy else None
    )
    ad_sets = await db.adset.find_many(where={"campaignId": campaign.id})
    # Ad sets under one campaign budget share it, so the plan's ceiling is not
    # multiplied by how many there are.
    targets = dash.plan_targets(
        content,
        1
        if campaign.budgetLevel == CAMPAIGN_BUDGET_LEVEL
        else sum(1 for a in ad_sets if a.metaAdSetId is not None),
    )

    if sample:
        _require_sample_allowed()
        data = sample_campaign()
        return dash.assemble_campaign(
            campaign_id=campaign.id,
            name=campaign.name,
            status=campaign.status,
            snapshots=data.snapshots,
            targets=targets,
            ads=data.ads,
            recommendations=data.recommendations,
            pixel_warning=data.pixel_warning,
            saturation_warning=data.saturation_warning,
            is_sample=True,
        )

    ads = await db.ad.find_many(where={"adSetId": {"in": [a.id for a in ad_sets]}})
    recommendations = await db.optimizationrecommendation.find_many(
        where={"campaignId": campaign.id}
    )
    return dash.assemble_campaign(
        campaign_id=campaign.id,
        name=campaign.name,
        status=campaign.status,
        snapshots=await _campaign_snapshots(campaign),
        targets=targets,
        ads=[dash.AdInfo(a.id, a.name, a.status) for a in ads],
        recommendations=[
            dash.RecommendationInfo(
                id=r.id,
                action_type=r.actionType,
                status=r.status,
                target_ad_id=r.targetAdId,
                reasoning=r.reasoning,
                risk=r.risk,
                confidence=r.confidence,
                current_budget=r.currentBudget,
                suggested_budget=r.suggestedBudget,
                suggested_bid=r.suggestedBid,
                created_at=r.createdAt,
            )
            for r in recommendations
        ],
        pixel_warning=campaign.pixelWarning,
        saturation_warning=campaign.saturationWarning,
        is_sample=False,
        paused_at=campaign.pausedAt,
        paused_reason=campaign.pausedReason,
    )


@router.get("/dashboard", response_model=BusinessDashboardSummary)
async def business_dashboard(
    sample: bool = False,
    business: Business = Depends(get_owned_business),
) -> BusinessDashboardSummary:
    """The stat strip across a business's published campaigns.

    Args:
        sample: Local development only (404 unless DASHBOARD_SAMPLE_DATA or
            FAKE_META is on).
        business: The business, resolved and ownership-checked.

    Returns:
        Active campaigns, total spend, purchases, revenue and cost per purchase,
        each campaign contributing its own latest lifetime totals.
    """
    if sample:
        _require_sample_allowed()
        return dash.summarize_business(sample_business(), is_sample=True)

    campaigns = await db.campaign.find_many(
        where={"businessId": business.id, "NOT": [{"metaCampaignId": None}]}
    )
    return dash.summarize_business(
        [(c.id, c.name, c.status, await _campaign_snapshots(c)) for c in campaigns],
        is_sample=False,
    )
