"""Pixel health endpoint: is the selected Pixel receiving this business's events?

Read-only. The look is taken on demand and kept briefly (app/services/pixel_health.py),
so loading the dashboard or the publish screen costs at most two free Meta reads every
ten minutes per business.
"""

from fastapi import APIRouter, Depends
from prisma.models import Business

from app.core.authz import get_owned_business
from app.services.pixel_health import PixelHealth, get_pixel_health

router = APIRouter(prefix="/businesses/{business_id}", tags=["pixel"])


@router.get("/pixel-health", response_model=PixelHealth)
async def pixel_health(
    refresh: bool = False,
    business: Business = Depends(get_owned_business),
) -> PixelHealth:
    """The selected Pixel's health, with when it was last checked.

    Args:
        refresh: Check again rather than reuse a recent look (still limited to once
            a minute).
        business: The business, resolved and ownership-checked.

    Returns:
        The health: "ok", "no_purchase", "no_events", "unavailable", "unreadable" or
        "none_selected", the warning to show (if any), when it was checked, and when
        the Pixel last received an event.
    """
    return await get_pixel_health(business.id, refresh=refresh)
