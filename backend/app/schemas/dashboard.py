"""Response shapes for the campaign dashboard (PRD.md, campaign dashboard).

Every figure is computed on the server so the page only renders. Percent
fields (link CTR, funnel rates, percent of plan) are percentages (1.5 means
1.5%). None always means unavailable, never zero.
"""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel

TargetSource = Literal["unit_economics", "industry_benchmark"]
LinkCtrBand = Literal["weak", "below_typical", "typical", "strong"]
FunnelKey = Literal["impressions", "link_clicks", "add_to_cart", "checkout", "purchase"]


class Confidence(CamelCaseModel):
    """How much data a number rests on, and whether it is enough to judge.

    label is only set when the basis is too thin, worded
    "Based on N <unit> — too early to judge" (or "Not available yet" when
    there is no basis at all).
    """

    sufficient: bool
    basis: int | None
    threshold: int
    unit: str
    label: str | None


class SpendCard(CamelCaseModel):
    """Total spend against the plan's budget."""

    value: float
    planned_total: float | None
    planned_daily: float | None
    percent_of_plan: float | None


class CountCard(CamelCaseModel):
    """A raw count (or amount) with its confidence flag."""

    value: float | None
    confidence: Confidence


class CostPerPurchaseCard(CamelCaseModel):
    """Cost per purchase beside the target, and which side of it it is on."""

    value: float | None
    target: float
    target_source: TargetSource
    breakeven: float | None
    position: Literal["below_target", "above_target"] | None
    confidence: Confidence


class RoasCard(CamelCaseModel):
    """Revenue / spend beside the break-even ROAS from the product's margin."""

    value: float | None
    breakeven: float | None
    position: Literal["above_breakeven", "below_breakeven"] | None
    confidence: Confidence


class Tier1(CamelCaseModel):
    """The verdict: did this make money."""

    spend: SpendCard
    purchases: CountCard
    revenue: CountCard
    cost_per_purchase: CostPerPurchaseCard
    roas: RoasCard


class LinkCtrCard(CamelCaseModel):
    """Link CTR with the jewelry guide bands."""

    value: float | None
    band: LinkCtrBand | None
    weak_below: float
    typical_low: float
    typical_high: float
    confidence: Confidence


class CpmCard(CamelCaseModel):
    """CPM with the jewelry benchmark range."""

    value: float | None
    benchmark_low: float
    benchmark_median: float
    benchmark_high: float
    zone: (
        Literal["needs_attention", "within_acceptable_range", "strong", "exceptional"]
        | None
    )
    confidence: Confidence


class AddToCartCard(CamelCaseModel):
    """Add-to-carts, the rate (per landing page view) and cost per add-to-cart."""

    count: int | None
    rate: float | None
    cost_per: float | None
    target_cost_per: float | None
    confidence: Confidence


class CheckoutCard(CamelCaseModel):
    """Checkout starts and the rate from add-to-cart."""

    count: int | None
    rate: float | None
    confidence: Confidence


class FunnelStep(CamelCaseModel):
    """One funnel step with its conversion from the previous step."""

    key: FunnelKey
    label: str
    count: int | None
    rate_from_previous: float | None
    drop_off_from_previous: float | None


class Tier2(CamelCaseModel):
    """Early signals: is the funnel working before sales accumulate."""

    link_ctr: LinkCtrCard
    cpm: CpmCard
    add_to_cart: AddToCartCard
    checkout: CheckoutCard
    funnel: list[FunnelStep]


AdStatus = Literal["live", "paused", "paused_by_optimizer", "proposed_pause"]


class AdRow(CamelCaseModel):
    """One ad of a creative test, from its own latest lifetime numbers."""

    ad_id: str
    name: str
    status: AdStatus
    spend: float | None
    link_ctr: float | None
    add_to_cart: int | None
    cost_per_add_to_cart: float | None
    purchases: int | None
    cac: float | None
    is_leader: bool


class Leader(CamelCaseModel):
    """The leading ad and the metric it leads on."""

    ad_id: str
    basis: Literal["cac", "cost_per_add_to_cart"]


class Tier3(CamelCaseModel):
    """The per-ad comparison a creative test exists to answer."""

    ads: list[AdRow]
    leader: Leader | None
    leader_message: str


class Proposal(CamelCaseModel):
    """A pending optimizer proposal waiting for the user's decision."""

    id: str
    action_type: str
    target_ad_id: str | None
    target_ad_name: str | None
    reasoning: str
    risk: str
    confidence: float
    current_budget: float | None
    suggested_budget: float | None
    suggested_bid: float | None
    created_at: datetime


class CampaignDashboardResponse(CamelCaseModel):
    """Everything the campaign dashboard shows for one campaign."""

    campaign_id: str
    campaign_name: str | None
    status: str
    has_data: bool
    as_of: datetime | None
    is_sample: bool
    pixel_warning: str | None
    proposals: list[Proposal]
    tier1: Tier1 | None
    tier2: Tier2 | None
    tier3: Tier3 | None


class CampaignSummary(CamelCaseModel):
    """One campaign's headline numbers in the business summary."""

    campaign_id: str
    name: str | None
    status: str
    spend: float
    purchases: int | None


class BusinessDashboardSummary(CamelCaseModel):
    """The stat strip across every published campaign of a business."""

    active_campaigns: int
    total_spend: float
    purchases: int | None
    revenue: float | None
    cost_per_purchase: float | None
    campaigns: list[CampaignSummary]
    is_sample: bool
