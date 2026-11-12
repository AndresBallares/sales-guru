"""Schemas for follow-up creative rounds (see prisma CreativeRound)."""

from datetime import datetime
from typing import Literal

from app.schemas.base import CamelCaseModel
from app.schemas.creative import CreativeResponse
from app.schemas.strategy import GeneratedCreativeAngle

# OPEN: the user is still choosing which of its ads to publish. CLOSED: that
# choice is final (set when a round is published, which is a later step).
CreativeRoundStatus = Literal["OPEN", "CLOSED"]


class CreativeRoundResponse(CamelCaseModel):
    """A follow-up round with its angles and ads."""

    id: str
    campaign_id: str
    # Round 1 is the campaign's first batch and has no row; rounds start at 2.
    number: int
    status: CreativeRoundStatus
    generated_count: int
    selected_count: int
    angles: list[GeneratedCreativeAngle]
    creatives: list[CreativeResponse]
    created_at: datetime


# --- ad-set rounds: the round screen ----------------------------------------


class RoundAdResponse(CamelCaseModel):
    """One ad of a published round's ad set."""

    ad_id: str
    name: str
    status: str
    creative_id: str | None
    headline: str | None
    # Set on an ad carried into a winners ad set: the round it first ran in.
    carried_from_round: int | None
    spend: float


class RoundAdSetResponse(CamelCaseModel):
    """One ad set of a published round, with what it spends and runs."""

    id: str
    name: str
    is_winners: bool
    daily_budget: float
    start_date: datetime | None
    end_date: datetime | None
    spend: float
    ads: list[RoundAdResponse]


class PublishedRoundResponse(CamelCaseModel):
    """A published round: its dates and its one or two ad sets."""

    number: int
    starts_at: datetime | None
    ends_at: datetime | None
    ad_sets: list[RoundAdSetResponse]


class RoundsOverviewResponse(CamelCaseModel):
    """Every published round of an ad-set-budget creative test."""

    max_rounds: int
    # Why the next round can't start yet, or None when it can.
    next_round_problem: str | None
    rounds: list[PublishedRoundResponse]


class AdSetPlanResponse(CamelCaseModel):
    """What one ad set of a round about to publish will be."""

    daily_budget: float
    ad_count: int


class WinnerCandidateResponse(CamelCaseModel):
    """An earlier ad still active, which the round may carry as a winner."""

    creative_id: str
    ad_name: str
    headline: str
    avatar: str | None
    concept: str | None
    # The round the ad first ran in (shown as "carried from round N").
    first_round: int
    chosen: bool


class RoundLaunchSummary(CamelCaseModel):
    """Everything the user confirms before an ad-set round goes live."""

    restarts_campaign: bool
    new_ad_set: AdSetPlanResponse
    winners_ad_set: AdSetPlanResponse | None
    winner_candidates: list[WinnerCandidateResponse]
    max_winners: int
    # More ads are active than a round can carry and none has been chosen yet.
    needs_choice: bool
    daily_total: float
    planned_max: float
    duration_days: int


class ChooseWinnersRequest(CamelCaseModel):
    """The earlier ads the user picked to carry into a round."""

    creative_ids: list[str]


class EndRoundEarlyRequest(CamelCaseModel):
    """Confirmation that the current round should stop now."""

    confirmed: bool = False


class EndRoundEarlyResponse(CamelCaseModel):
    """The round that was ended."""

    round_number: int
    ended_at: datetime
