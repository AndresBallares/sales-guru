"""Schemas for the Campaign Optimization Agent (PRD.md build step 10)."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.schemas.base import CamelCaseModel

ActionType = Literal["PAUSE_AD", "INCREASE_BUDGET", "DECREASE_BUDGET"]
RiskLevel = Literal["LOW", "MEDIUM", "HIGH"]
RecommendationStatus = Literal["PENDING", "APPLIED", "REJECTED", "SUPERSEDED"]


class GeneratedRecommendation(CamelCaseModel):
    """The one recommendation the LLM generates, as a forced tool call.

    confidence/risk are the model's own self-assessment. suggested_budget
    is only meaningful for INCREASE_BUDGET/DECREASE_BUDGET — left unset
    for PAUSE_AD, there's nothing to size. Whatever the model proposes
    here for suggested_budget is still subject to a guardrail cap applied
    afterward (app/services/optimizer.py) before it's ever stored or
    shown — this field is the model's raw, unbounded suggestion.
    """

    action_type: ActionType
    reasoning: str
    confidence: float = Field(ge=0, le=1)
    risk: RiskLevel
    suggested_budget: float | None = None


class RecommendationResponse(CamelCaseModel):
    """Public-facing representation of a stored OptimizationRecommendation.

    requires_approval is always true today — see the model's doc comment
    in schema.prisma for why it's still its own computed field rather
    than a hardcoded constant.
    """

    id: str
    campaign_id: str
    action_type: ActionType
    target_ad_id: str | None
    current_budget: float | None
    suggested_budget: float | None
    reasoning: str
    confidence: float
    risk: RiskLevel
    requires_approval: bool
    status: RecommendationStatus
    created_at: datetime
