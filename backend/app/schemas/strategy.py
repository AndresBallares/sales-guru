"""Schemas for the Marketing Strategist Agent (PRD.md build step 5)."""

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelCaseModel
from app.schemas.campaign import Objective


class TargetAudience(CamelCaseModel):
    """Agent-recommended (or refined) audience targeting.

    Mirrors the real Audience model's field shapes, not ad hoc ones —
    ageMin/ageMax as separate ints matches Meta's age_min/age_max targeting
    fields directly, same reasoning already used for the Audience table.
    """

    age_min: int | None = None
    age_max: int | None = None
    location: list[str] = Field(default_factory=list)
    interests: list[str] = Field(default_factory=list)
    problem: str | None = None
    desire: str | None = None


class BudgetRecommendation(CamelCaseModel):
    """Agent-recommended daily budget, with the reasoning behind it."""

    daily: float
    rationale: str


class GeneratedStrategyFields(CamelCaseModel):
    """The fields the LLM actually generates.

    Deliberately excludes `objective` — that's fixed input (Campaign.objective,
    chosen by the user at campaign-creation time), not something the agent
    should invent or risk contradicting. The full StrategyContent below
    injects it separately after generation.
    """

    target_audience: TargetAudience
    offer: str
    positioning: str
    creative_angles: list[str]
    copy_strategy: str
    budget_recommendation: BudgetRecommendation


class StrategyContent(GeneratedStrategyFields):
    """The full structured strategy — what gets stored and returned."""

    objective: Objective


class StrategyResponse(CamelCaseModel):
    """Public-facing representation of a Strategy."""

    id: str
    campaign_id: str
    content: StrategyContent
    created_at: datetime
