"""Campaign type: the structure the user chooses for a campaign.

Nothing here routes a campaign behind the user's back. The recommendation only
preselects the dropdown; an explicit choice always wins. The type decides:

- the plan shape (`plan_type_for`),
- where the daily budget sits (`budget_level_for`), and
- whether the campaign can take follow-up rounds (`supports_rounds`).

Data-Driven reuses the creative-test plan shape (CREATIVE_TEST_PLAN) plus an
`audience_source` block, so the round, optimizer and pause code that already
serve a creative test serve it too. Only its targeting differs: it comes from
the ad account's history instead of a broad Advantage+ audience.
"""

from typing import Literal, get_args

from app.core.config import get_settings
from app.services.strategist import PlanType

CampaignType = Literal[
    "CREATIVE_TEST", "DATA_DRIVEN", "STANDARD", "GEO", "LEGACY_AUDIENCE_TEST"
]
CAMPAIGN_TYPES: tuple[str, ...] = get_args(CampaignType)

# Types a SALES campaign can choose. GEO is listed but not available yet.
SALES_CHOICES: tuple[CampaignType, ...] = ("CREATIVE_TEST", "DATA_DRIVEN", "STANDARD")
GEO_COMING_SOON = "Geo Targeting is coming soon."
NOT_SALES = "This campaign type is only available for the Sales objective."

_LABELS: dict[CampaignType, str] = {
    "CREATIVE_TEST": "Creative Test",
    "DATA_DRIVEN": "Data-Driven",
    "STANDARD": "Standard",
    "GEO": "Geo Targeting",
    "LEGACY_AUDIENCE_TEST": "Audience test",
}
_STATIC_DESCRIPTIONS: dict[CampaignType, str] = {
    "STANDARD": "One ad set with its own budget. Allows 1 to 4 ads and no rounds.",
    "GEO": "Reach people at one venue or event with a small radius.",
    "LEGACY_AUDIENCE_TEST": "Compares a broad audience with an interest audience.",
}
STANDARD_WARNING = (
    "A standard campaign keeps its budget on the ad set and cannot run rounds."
)


def label(campaign_type: CampaignType) -> str:
    """The user-facing name of a campaign type.

    Args:
        campaign_type: The type.

    Returns:
        Its label, such as "Creative Test".
    """
    return _LABELS[campaign_type]


def recommend_campaign_type(*, objective: str, has_history: bool) -> CampaignType:
    """The type to preselect for a campaign.

    Args:
        objective: The campaign's objective.
        has_history: Whether the ad account meets the history threshold
            (`has_meaningful_history`).

    Returns:
        Data-Driven for a SALES campaign on an account with real history,
        Creative Test for any other SALES campaign, and the older audience test
        for every other objective.
    """
    if objective != "SALES":
        return "LEGACY_AUDIENCE_TEST"
    return "DATA_DRIVEN" if has_history else "CREATIVE_TEST"


def plan_type_for(campaign_type: CampaignType) -> PlanType:
    """The strategy plan shape a campaign type is generated as.

    Args:
        campaign_type: The type.

    Returns:
        CREATIVE_TEST_PLAN for both round-based types, DATA_DRIVEN_STRATEGY for
        Standard and TEST_PLAN for the older audience test.

    Raises:
        ValueError: For GEO, which has its own structure (PR 2).
    """
    if campaign_type in ("CREATIVE_TEST", "DATA_DRIVEN"):
        return "CREATIVE_TEST_PLAN"
    if campaign_type == "STANDARD":
        return "DATA_DRIVEN_STRATEGY"
    if campaign_type == "LEGACY_AUDIENCE_TEST":
        return "TEST_PLAN"
    raise ValueError(f"{campaign_type} has no plan shape yet")


def budget_level_for(campaign_type: CampaignType) -> str:
    """Where a campaign type keeps its daily budget.

    Args:
        campaign_type: The type.

    Returns:
        "CAMPAIGN" for the round-based types (one budget the winners draw
        from), else "AD_SET".
    """
    return "CAMPAIGN" if campaign_type in ("CREATIVE_TEST", "DATA_DRIVEN") else "AD_SET"


def supports_rounds(campaign_type: str | None) -> bool:
    """Whether a campaign of this type can take follow-up rounds.

    Args:
        campaign_type: The stored type, or None.

    Returns:
        True for Creative Test and Data-Driven.
    """
    return campaign_type in ("CREATIVE_TEST", "DATA_DRIVEN")


def structure_summary(
    campaign_type: CampaignType,
    *,
    ad_count: int,
    daily_budget: float,
    budget_level: str = "CAMPAIGN",
    duration_days: int = 10,
) -> str:
    """One line saying exactly what will be published.

    Args:
        campaign_type: The type.
        ad_count: How many ads the first round publishes.
        daily_budget: The daily budget, in dollars.
        budget_level: Where the round budget sits: "AD_SET" for plans written
            since ad-set rounds, "CAMPAIGN" for older ones.
        duration_days: How long a round's ad set runs (ad-set budgets only).

    Returns:
        For example "Creative Test: round 1 of 3, 4 ads, $100/day for 10 days on
        its own ad set", or "Standard: budget on the ad set, no rounds".
    """
    if campaign_type in ("CREATIVE_TEST", "DATA_DRIVEN"):
        ads = f"{ad_count} ad{'' if ad_count == 1 else 's'}"
        rounds = get_settings().creative_test_max_rounds
        where = (
            f"for {duration_days} days on its own ad set"
            if budget_level == "AD_SET"
            else "on the campaign"
        )
        return (
            f"{label(campaign_type)}: round 1 of {rounds}, {ads}, "
            f"${daily_budget:g}/day {where}"
        )
    if campaign_type == "STANDARD":
        return "Standard: budget on the ad set, no rounds"
    return f"{label(campaign_type)}: budget on the ad set, no rounds"


def backfill_campaign_type(
    plan_type: str | None, budget_level: str
) -> CampaignType | None:
    """The type of a campaign created before types existed.

    Mirrors the migration's SQL, so the rule can be tested in Python.

    Args:
        plan_type: The stored strategy's plan type, None without a strategy.
        budget_level: The campaign's budget level.

    Returns:
        The type, or None for a campaign with no strategy.
    """
    if plan_type is None:
        return None
    if plan_type == "CREATIVE_TEST_PLAN":
        return "CREATIVE_TEST"
    if plan_type == "DATA_DRIVEN_STRATEGY":
        return "DATA_DRIVEN" if budget_level == "CAMPAIGN" else "STANDARD"
    return "LEGACY_AUDIENCE_TEST"


def describe(campaign_type: CampaignType) -> str:
    """The one-line description shown under the Campaign type dropdown.

    Args:
        campaign_type: The type.

    Returns:
        What the type does. The round types name the round limit setting.
    """
    rounds = get_settings().creative_test_max_rounds
    plural = "" if rounds == 1 else "s"
    if campaign_type == "CREATIVE_TEST":
        return (
            f"4 new ads per round at $100/day for 10 days, up to {rounds} round"
            f"{plural}. The ads you keep active carry on in a $50/day winners ad set."
        )
    if campaign_type == "DATA_DRIVEN":
        return (
            "Uses your account history to choose audiences. "
            f"4 new ads per round at $100/day for 10 days, up to {rounds} round"
            f"{plural}. The ads you keep active carry on in a $50/day winners ad set."
        )
    return _STATIC_DESCRIPTIONS[campaign_type]
