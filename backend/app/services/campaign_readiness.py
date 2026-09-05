"""Auto-completing a campaign's product/audience once they exist.

The onboarding flow now asks for a campaign's objective before any product
or audience necessarily exists (objective-first, confirmed 2026-09-04 —
matches Meta Ads Manager's own "objective first" flow and needs no product
in view to be meaningful). A campaign created that way starts DRAFT with
productId/audienceId both null; this module is what closes that gap
without making the user hunt for an "attach" button:

- The common case (a business ends up with exactly one product, or one
  audience) auto-attaches it to every campaign still missing one, the
  moment that product/audience is created (see create_product/
  create_audience in app/api/product.py / app/api/audience.py).
- The ambiguous case (several products/audiences to choose from) is left
  alone here — app/api/campaign.py's update_campaign (PATCH) is the
  manual path the frontend falls back to when auto-attach can't decide.

Once both product and audience are set, the campaign's status flips DRAFT
-> READY (see advance_to_ready_if_complete) — a small, purely informational
flag for the UI's readiness checklist. The actual gates (app/api/
strategy.py's create_strategy, app/api/creative.py's select_creative,
app/api/campaign.py's publish_campaign) never trust that flag directly;
they check productId/audienceId themselves, so a status/data desync can
never open a gate it shouldn't.
"""

from prisma.models import Campaign

from app.core.db import db


def is_ready(campaign: Campaign) -> bool:
    """A campaign is ready once it has both a product and an audience."""
    return campaign.productId is not None and campaign.audienceId is not None


async def advance_to_ready_if_complete(campaign: Campaign) -> Campaign:
    """Flip a DRAFT campaign to READY once product and audience are both set.

    A no-op for a campaign that isn't DRAFT (already advanced further
    along the publish workflow, e.g. a legacy campaign created before this
    flow existed) or that still isn't ready — callers can pass any
    campaign unconditionally.

    Args:
        campaign: The campaign to check (and possibly advance).

    Returns:
        The updated campaign if it advanced, otherwise the one passed in.
    """
    if campaign.status == "DRAFT" and is_ready(campaign):
        updated = await db.campaign.update(
            where={"id": campaign.id}, data={"status": "READY"}
        )
        assert updated is not None  # just fetched above, can't vanish mid-request
        return updated
    return campaign


async def auto_attach_product(business_id: str, product_id: str) -> None:
    """Attach a product to every campaign still missing one, if unambiguous.

    Only acts when this business has exactly one product total — with two
    or more, which one a given campaign is "for" isn't this module's call
    to make (see the module docstring's manual-path note).

    Args:
        business_id: The business the product was just created under.
        product_id: The just-created product's id.
    """
    count = await db.product.count(where={"businessId": business_id})
    if count != 1:
        return
    campaigns = await db.campaign.find_many(
        where={"businessId": business_id, "productId": None}
    )
    for campaign in campaigns:
        updated = await db.campaign.update(
            where={"id": campaign.id}, data={"product": {"connect": {"id": product_id}}}
        )
        assert updated is not None  # just fetched above, can't vanish mid-request
        await advance_to_ready_if_complete(updated)


async def auto_attach_audience(business_id: str, audience_id: str) -> None:
    """Attach an audience to every campaign still missing one, if unambiguous.

    Mirrors auto_attach_product exactly, one audience instead of one
    product.

    Args:
        business_id: The business the audience was just created under.
        audience_id: The just-created audience's id.
    """
    count = await db.audience.count(where={"businessId": business_id})
    if count != 1:
        return
    campaigns = await db.campaign.find_many(
        where={"businessId": business_id, "audienceId": None}
    )
    for campaign in campaigns:
        updated = await db.campaign.update(
            where={"id": campaign.id},
            data={"audience": {"connect": {"id": audience_id}}},
        )
        assert updated is not None  # just fetched above, can't vanish mid-request
        await advance_to_ready_if_complete(updated)
