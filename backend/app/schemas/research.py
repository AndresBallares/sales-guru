"""Schemas for the Avatar Research Agent (Phase 7, docs/phase-7.md).

Two groups:

- ``SubmitResearch`` and its parts: the input of the ``submit_research`` tool the
  model will call at the end of a run (7b). Defined and checked now, called
  nowhere yet. Every field is required (empty lists are allowed) because strict
  tool mode allows at most 24 optional properties, and a schema this size would
  go over; ``tests/test_research_schema.py`` checks zero optional properties.
  Counts the model should hit (20 problems, 20 solutions, 5 avatars, 5 hooks,
  3 angles, 2-3 concepts) are *not* validation errors: ``count_warnings`` reports
  them so the runner can retry once and then accept with a warning.
  Quotes longer than 14 words are rejected here; that a quote is verbatim is
  checked in code against the fetched text (7d), not by this schema.
- The request and response models of the 7a endpoints.
"""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.schemas.base import CamelCaseModel
from app.schemas.buyer_avatar import ConceptPillar, PurchaseFor

PROBLEM_COUNT = 20
SOLUTION_COUNT = 20
AVATAR_COUNT = 5
HOOKS_PER_AVATAR = 5
ANGLES_PER_AVATAR = 3
CONCEPTS_PER_AVATAR = (2, 3)
MAX_QUOTE_WORDS = 14
MAX_EXTRA_COMPETITOR_URLS = 5
MAX_PRODUCT_CHOICES = 3

Depth = Literal["light", "standard", "deep"]
RunStatus = Literal["QUEUED", "RUNNING", "NEEDS_REVIEW", "FAILED", "CANCELED"]
ResearchModel = Literal["claude-opus-5-5", "claude-fable-5-1"]


class Evidence(BaseModel):
    """What a problem rests on: a short verbatim quote with its URL, or an inference."""

    kind: Literal["quote", "inference"]
    # A quote: the exact words (14 or fewer, no username). An inference: one line.
    text: str
    # A quote: the page it was read on (required). An inference: "".
    source_url: str

    @model_validator(mode="after")
    def _check(self) -> "Evidence":
        if not self.text.strip():
            raise ValueError("Evidence text may not be blank")
        if self.kind == "quote":
            if len(self.text.split()) > MAX_QUOTE_WORDS:
                raise ValueError(f"A quote may be at most {MAX_QUOTE_WORDS} words")
            if not self.source_url.strip():
                raise ValueError("A quote needs its source URL")
        return self


class ResearchProblem(BaseModel):
    """One problem customers in the category have, tied to evidence."""

    number: int
    problem: str
    evidence: list[Evidence]
    # True when no quote backs it and it is the model's inference.
    inferred: bool


class ResearchSolution(BaseModel):
    """A solution angle the brand can deliver with its real mechanisms."""

    number: int
    solution: str
    problem_numbers: list[int]
    mechanism: str
    inferred: bool


class ResearchGap(BaseModel):
    """A strong solution that needs something the brand does not offer."""

    need: str
    problem_numbers: list[int]


class ResearchConcept(BaseModel):
    """An ad-set concept: a short name, a pillar and a one-line description."""

    name: str
    pillar: ConceptPillar
    description: str


class ResearchAvatar(BaseModel):
    """One researched buyer avatar, ready to review and save to the library."""

    name: str
    who: str
    purchase_for: PurchaseFor
    primary_problems: list[int]
    unknown_problems: list[str]
    primary_solutions: list[int]
    alternatives: list[str]
    objections: list[str]
    hooks: list[str]
    creative_angles: list[str]
    concepts: list[ResearchConcept]
    inferred: bool


class ResearchSource(BaseModel):
    """A source the run tried, and whether it was reached."""

    url: str
    title: str
    reached: bool


class SubmitResearch(BaseModel):
    """The input of the ``submit_research`` tool: the whole result, submitted once."""

    problems: list[ResearchProblem]
    solutions: list[ResearchSolution]
    gaps: list[ResearchGap]
    avatars: list[ResearchAvatar]
    # Which sources were reached and which were not (the fetch cap wins).
    coverage_note: str
    sources: list[ResearchSource]


def count_warnings(result: SubmitResearch) -> list[str]:
    """Where the result misses the fixed counts. Empty when it hits them all.

    Args:
        result: A parsed submission.

    Returns:
        One readable line per miss, e.g. "Expected 20 problems, got 18".
    """
    warnings: list[str] = []
    for label, wanted, got in (
        ("problems", PROBLEM_COUNT, len(result.problems)),
        ("solutions", SOLUTION_COUNT, len(result.solutions)),
        ("avatars", AVATAR_COUNT, len(result.avatars)),
    ):
        if got != wanted:
            warnings.append(f"Expected {wanted} {label}, got {got}")
    low, high = CONCEPTS_PER_AVATAR
    for avatar in result.avatars:
        for label, wanted, got in (
            ("hooks", HOOKS_PER_AVATAR, len(avatar.hooks)),
            ("creative angles", ANGLES_PER_AVATAR, len(avatar.creative_angles)),
        ):
            if got != wanted:
                warnings.append(
                    f'Avatar "{avatar.name}": expected {wanted} {label}, got {got}'
                )
        if not low <= len(avatar.concepts) <= high:
            warnings.append(
                f'Avatar "{avatar.name}": expected {low}-{high} concepts, '
                f"got {len(avatar.concepts)}"
            )
    return warnings


class CostEstimateRequest(CamelCaseModel):
    """POST .../estimate: what to estimate and preview. Creates nothing."""

    depth: Depth
    model: ResearchModel
    product_ids: list[str] | None = Field(default=None, max_length=MAX_PRODUCT_CHOICES)
    competitor_urls: list[str] = Field(
        default_factory=list, max_length=MAX_EXTRA_COMPETITOR_URLS
    )

    @field_validator("product_ids")
    @classmethod
    def _no_duplicate_products(cls, value: list[str] | None) -> list[str] | None:
        if value is not None and len(set(value)) != len(value):
            raise ValueError("Each product may be listed only once")
        return value


class CostAssumption(CamelCaseModel):
    """One input of the estimate, flagged as measured or as an estimate."""

    name: str
    value: float
    unit: str
    measured: bool
    note: str


class CostEstimateResponse(CamelCaseModel):
    """The estimate plus the rendered prompt it was based on."""

    depth: Depth
    model: ResearchModel
    max_searches: int
    max_fetches: int
    expected_usd: float
    max_usd: float
    suggested_max_cost_usd: float
    prompt_tokens: int
    prompt_version: str
    prompt_hash: str
    prompt_preview: str
    assumptions: list[CostAssumption]


class ResearchRunResponse(CamelCaseModel):
    """A stored research run."""

    id: str
    business_id: str
    status: RunStatus
    phase: str | None
    depth: Depth
    model: str
    max_searches: int
    max_fetches: int
    max_cost_usd: float
    searches_used: int
    fetches_used: int
    input_tokens: int
    cache_write_tokens: int
    cache_read_tokens: int
    output_tokens: int
    cost_usd: float
    prompt_version: str
    prompt_hash: str
    product_ids: list[str]
    extra_competitor_urls: list[str]
    findings: dict[str, Any]
    coverage_note: str | None
    error: str | None
    cancel_requested: bool
    heartbeat_at: datetime | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime
