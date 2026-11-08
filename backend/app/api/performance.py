"""Advertising Performance endpoint: one period's Meta numbers for a business.

Read-only and computed from the stored Metric rows (app/services/performance.py).
It never calls Meta and never starts a sync, so opening or refreshing the page
cannot cost anything or disturb the 15-minute collection.
"""

from datetime import UTC, datetime
from enum import IntEnum

from fastapi import APIRouter, Depends, Query
from prisma.models import Business

from app.api.dashboard import campaign_snapshots
from app.core.authz import get_owned_business
from app.core.db import db
from app.schemas.performance import PerformanceResponse
from app.services import performance as perf

router = APIRouter(prefix="/businesses/{business_id}", tags=["performance"])


class Days(IntEnum):
    """The windows the dashboard offers; ALL_TIME is 0."""

    ALL_TIME = 0
    WEEK = 7
    FORTNIGHT = 14
    MONTH = 30
    QUARTER = 90


@router.get("/performance", response_model=PerformanceResponse)
async def business_performance(
    days: Days = Query(default=Days.WEEK),
    business: Business = Depends(get_owned_business),
) -> PerformanceResponse:
    """The Advertising Performance dashboard for the last N days (0 = all time).

    Args:
        days: Window length: 7, 14, 30, 90, or 0 for all time.
        business: The business, resolved and ownership-checked.

    Returns:
        The period's totals, the previous period for comparison (only when stored
        history covers it), the click-to-customer funnel, a daily series, one row
        per published campaign, and when Meta's numbers were last stored.
    """
    campaigns = await db.campaign.find_many(
        where={"businessId": business.id, "NOT": [{"metaCampaignId": None}]}
    )
    connection = await db.metaconnection.find_unique(where={"businessId": business.id})
    failure = None
    if (
        connection is not None
        and connection.syncFailedAt is not None
        and connection.syncFailureSource in ("collection", "reconcile")
    ):
        failure = perf.FailureRecord(
            source="collection"
            if connection.syncFailureSource == "collection"
            else "reconcile",
            failed_at=connection.syncFailedAt,
            code=connection.syncFailureCode,
            reason=connection.syncFailureReason or "Unknown error",
        )
    return perf.build_performance(
        [(c.id, c.name, c.status, await campaign_snapshots(c)) for c in campaigns],
        days=int(days) or None,
        now=datetime.now(UTC),
        meta_connected=connection is not None,
        failure=failure,
    )
