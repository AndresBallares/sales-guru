"""Retargeting proposal and Pixel health (creative-first Stage 5).

**What this does:** when a business's Pixel shows enough site activity over the
last 30 days, the Optimizer proposes a retargeting campaign for the user to
approve. It also warns when a Purchase-optimized campaign's Pixel looks like
its Purchase event isn't firing. Both are signals and proposals only.

**What it does not do:** no audience is created and no campaign is published.
Creating the retargeting campaign is a documented but unbuilt interface
(`RetargetingCampaignSpec`, `create_retargeting_campaign`).

**About the signal.** Meta's Marketing API has no unique-visitor count for a
Pixel. The closest thing is the Pixel's hourly event counts
(`/{pixel_id}/stats?aggregation=event`, see meta.fetch_pixel_event_counts),
which count *events*, not *people*: one visitor can fire several PageViews, so
PageView is an upper bound on visitors. The proposal therefore says "events,
not people" everywhere. A true people count would need a website custom
audience with 30-day retention, whose size Meta reports as an approximate
range; that is what creating the audience (the unbuilt part) would unlock.
"""

from typing import NamedTuple

# Over the last WINDOW_DAYS days, propose retargeting once both are reached.
WINDOW_DAYS = 30
MIN_PAGE_VIEWS_30D = 1000
MIN_VIEW_CONTENT_30D = 500
# The retargeting campaign gets about this share of the source campaign's budget.
RETARGETING_BUDGET_FRACTION = 0.20


class RetargetingNotBuiltError(NotImplementedError):
    """Raised by create_retargeting_campaign: creating it isn't built yet."""


class RetargetingCampaignSpec(NamedTuple):
    """What a retargeting campaign would be, once creating one is built.

    The contract the future implementation fulfils. The user's approval of the
    proposal is a decision to build this, not a command to run it today.

    include / exclude are descriptions of the audiences to build (see
    create_retargeting_campaign for the Marketing API calls they map to).
    """

    source_campaign_id: str
    daily_budget: float
    pixel_id: str
    lookback_days: int = WINDOW_DAYS
    include: list[str] = ["site visitors", "add-to-carts"]  # noqa: RUF012
    exclude: list[str] = ["purchasers"]  # noqa: RUF012


async def create_retargeting_campaign(
    spec: RetargetingCampaignSpec, *, access_token: str, ad_account_id: str
) -> str:
    """Create and publish the retargeting campaign described by `spec`.

    NOT BUILT. TODO for whoever builds it; the pieces, all Marketing API calls
    (permissions: ads_management; website custom audiences also need the ad
    account's Business Tools Terms accepted, which meta.is_business_tools_terms_error
    already detects):

    1. Create two website custom audiences on spec.pixel_id with 30-day
       retention (POST /act_<id>/customaudiences, subtype WEBSITE, a `rule`
       on the Pixel's PageView/ViewContent and AddToCart events for the
       "include" audience, and on Purchase for the "exclude" one).
    2. Create the campaign (reuse meta.create_meta_campaign, SALES) and one ad
       set with `targeting.custom_audiences` set to the include audience and
       `targeting.excluded_custom_audiences` to the purchasers audience, at
       spec.daily_budget, optimizing for Purchase.
    3. Reuse the source campaign's winning ad creative(s) as ads in it.
    4. Create it PAUSED and require the same "Publish paused" confirmation as
       any other campaign.

    Args:
        spec: What to create.
        access_token: The business's Meta access token.
        ad_account_id: The connected ad account.

    Returns:
        The new Meta campaign id (once built).

    Raises:
        RetargetingNotBuiltError: Always, today.
    """
    raise RetargetingNotBuiltError(
        "Creating a retargeting campaign is not built yet — your approval is "
        "recorded as interest only; nothing was created on Meta."
    )


def retargeting_ready(counts: dict[str, int]) -> bool:
    """Whether 30 days of Pixel events justify proposing retargeting.

    Args:
        counts: Event name -> count over the last WINDOW_DAYS days.

    Returns:
        True when PageView and ViewContent each reach their threshold. These
        are event counts, not people (see the module docstring).
    """
    return (
        counts.get("PageView", 0) >= MIN_PAGE_VIEWS_30D
        and counts.get("ViewContent", 0) >= MIN_VIEW_CONTENT_30D
    )


def retargeting_daily_budget(source_daily_budget: float) -> float:
    """The proposed retargeting daily budget: about a fifth of the source's."""
    return source_daily_budget * RETARGETING_BUDGET_FRACTION


def purchase_event_warning(counts: dict[str, int]) -> str | None:
    """A warning when the Purchase event looks like it isn't firing, else None.

    A Pixel that records people starting checkout but never a purchase over 30
    days usually has a broken or missing Purchase event, which silently starves
    a Purchase-optimized campaign (and any "exclude purchasers" audience).

    Args:
        counts: Event name -> count over the last WINDOW_DAYS days.

    Returns:
        The warning text, or None when Purchase events exist or nobody
        reached checkout.
    """
    checkouts = counts.get("InitiateCheckout", 0)
    if counts.get("Purchase", 0) == 0 and checkouts > 0:
        return (
            "Purchase event may not be firing: this Pixel recorded 0 Purchase "
            f"events but {checkouts:,} InitiateCheckout events in the last "
            f"{WINDOW_DAYS} days. A Purchase-optimized campaign can't learn "
            "without it — check the Pixel setup on the store."
        )
    return None


def proposal_reasoning(
    counts: dict[str, int], *, daily_budget: float, purchase_event_firing: bool
) -> str:
    """The proposal's explanation: the numbers, the ask, and what it does not do.

    Args:
        counts: Event name -> count over the last WINDOW_DAYS days.
        daily_budget: The source campaign's total daily budget.
        purchase_event_firing: False when the Pixel-health check says the
            Purchase event may not be firing (then purchasers can't be
            excluded reliably, and the text says so).
    """
    text = (
        f"This business's Pixel recorded {counts.get('PageView', 0):,} PageView "
        f"and {counts.get('ViewContent', 0):,} ViewContent events in the last "
        f"{WINDOW_DAYS} days (events, not people: one visitor can fire several). "
        f"Proposed: a second campaign at {RETARGETING_BUDGET_FRACTION:.0%} of the "
        f"budget (${retargeting_daily_budget(daily_budget):,.2f}/day of "
        f"${daily_budget:,.2f}) retargeting site visitors and add-to-carts from "
        f"the last {WINDOW_DAYS} days, excluding purchasers. Nothing is created "
        "until retargeting is built and you approve it again; today this only "
        "records your interest."
    )
    if not purchase_event_firing:
        text += (
            " Warning: the Purchase event may not be firing on this Pixel, so "
            "purchasers could not be excluded reliably."
        )
    return text
