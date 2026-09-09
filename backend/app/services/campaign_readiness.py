"""Auto-completing a campaign's product/audience once they exist.

The onboarding flow now asks for a campaign's objective before any product
or audience necessarily exists (objective-first, confirmed 2026-09-04 —
matches Meta Ads Manager's own "objective first" flow and needs no product
in view to be meaningful). A campaign created that way starts DRAFT with
productId/audienceId both null; this module is what closes that gap
without making the user hunt for an "attach" button:

- The caller (create_product/create_audience in app/api/product.py /
  app/api/audience.py) passes along the campaign_id of whichever campaign
  the product/audience was created *for* — the frontend always knows this,
  since a product/audience is only ever created from a flow that's already
  scoped to one campaign (the guided per-campaign flow, or an existing
  campaign's swap-to-new-product/audience control). Auto-attach fills in
  just that one campaign, and only if it's still missing one; it never
  reaches into other campaigns in the business.
- No campaign_id (a caller that isn't scoped to a specific campaign) means
  there's nothing to attach to, so this is a no-op — guessing across every
  empty draft in the business was the bug this module used to have.
- app/api/campaign.py's update_campaign (PATCH) remains the manual path for
  swapping a campaign onto a different, already-existing product/audience.

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


async def auto_attach_product(
    business_id: str, product_id: str, campaign_id: str | None
) -> None:
    """Attach a product to the campaign it was created for, if any.

    A no-op unless campaign_id names a campaign that belongs to this
    business and is still missing a product — in particular, it never
    touches any *other* campaign in the business.

    Args:
        business_id: The business the product was just created under.
        product_id: The just-created product's id.
        campaign_id: The campaign this product was created for, or None if
            the caller isn't scoped to one.
    """
    if campaign_id is None:
        return
    campaign = await db.campaign.find_first(
        where={"id": campaign_id, "businessId": business_id, "productId": None}
    )
    if campaign is None:
        return
    updated = await db.campaign.update(
        where={"id": campaign.id}, data={"product": {"connect": {"id": product_id}}}
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    await advance_to_ready_if_complete(updated)


async def auto_attach_audience(
    business_id: str, audience_id: str, campaign_id: str | None
) -> None:
    """Attach an audience to the campaign it was created for, if any.

    Mirrors auto_attach_product exactly, one audience instead of one
    product.

    Args:
        business_id: The business the audience was just created under.
        audience_id: The just-created audience's id.
        campaign_id: The campaign this audience was created for, or None if
            the caller isn't scoped to one.
    """
    if campaign_id is None:
        return
    campaign = await db.campaign.find_first(
        where={"id": campaign_id, "businessId": business_id, "audienceId": None}
    )
    if campaign is None:
        return
    updated = await db.campaign.update(
        where={"id": campaign.id},
        data={"audience": {"connect": {"id": audience_id}}},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    await advance_to_ready_if_complete(updated)
