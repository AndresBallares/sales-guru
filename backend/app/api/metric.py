"""Results dashboard endpoints (PRD.md build step 9)."""

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Campaign, Metric

from app.core.authz import get_owned_campaign
from app.core.db import db
from app.schemas.metric import MetricResponse
from app.services.meta import MetaConnectionError, fetch_campaign_insights

router = APIRouter(
    prefix="/businesses/{business_id}/campaigns/{campaign_id}/metrics",
    tags=["metrics"],
)

_NOT_LIVE_YET = "Publish this campaign before viewing results"
_META_NOT_CONNECTED = "Meta Ads isn't connected for this business"


def _to_response(metric: Metric) -> MetricResponse:
    """Map a Prisma Metric record to its public response shape.

    Args:
        metric: The Prisma Metric model instance.

    Returns:
        The public-facing representation.
    """
    return MetricResponse(
        id=metric.id,
        campaign_id=metric.campaignId,
        impressions=metric.impressions,
        clicks=metric.clicks,
        spend=metric.spend,
        conversions=metric.conversions,
        fetched_at=metric.fetchedAt,
    )


@router.post(
    "/refresh", response_model=MetricResponse, status_code=status.HTTP_201_CREATED
)
async def refresh_metrics(
    campaign: Campaign = Depends(get_owned_campaign),
) -> MetricResponse:
    """Pull fresh performance numbers from Meta and store them as a new snapshot.

    Each call adds a new Metric row rather than overwriting the last one,
    so the campaign builds up a real history of snapshots over time —
    same "append, don't overwrite" reasoning as Metric.fetchedAt existing
    at all.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The newly stored snapshot.

    Raises:
        HTTPException: 400 if the campaign hasn't been published yet or
            Meta isn't connected; 500 if the Graph API call fails.
    """
    if campaign.metaCampaignId is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_NOT_LIVE_YET
        )

    connection = await db.metaconnection.find_unique(
        where={"businessId": campaign.businessId}
    )
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_META_NOT_CONNECTED
        )

    try:
        insights = await fetch_campaign_insights(
            access_token=connection.accessToken,
            meta_campaign_id=campaign.metaCampaignId,
        )
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    metric = await db.metric.create(
        data={
            "campaignId": campaign.id,
            "impressions": insights.impressions,
            "clicks": insights.clicks,
            "spend": insights.spend,
            "conversions": insights.conversions,
        }
    )
    return _to_response(metric)


@router.get("", response_model=list[MetricResponse])
async def list_metrics(
    campaign: Campaign = Depends(get_owned_campaign),
) -> list[MetricResponse]:
    """List a campaign's stored performance snapshots, most recent first.

    Args:
        campaign: The campaign, resolved and ownership-checked by
            get_owned_campaign.

    Returns:
        The campaign's snapshots — an empty list if none have been
        fetched yet (not a 404; "no results yet" is a normal state, same
        as an empty creatives list before any have been generated).
    """
    metrics = await db.metric.find_many(
        where={"campaignId": campaign.id}, order={"fetchedAt": "desc"}
    )
    return [_to_response(m) for m in metrics]
