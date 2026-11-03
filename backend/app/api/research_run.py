"""Avatar Research endpoints (Phase 7a): estimate a run and read stored runs.

Behind AVATAR_RESEARCH_ENABLED (off by default; every route is a 404 while it is
off, and FAKE_LLM does not open it). Nothing here starts a run: that is 7b.
"""

import json
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, ResearchRun

from app.core.authz import get_owned_business
from app.core.config import get_settings
from app.core.db import db
from app.schemas.research import (
    CostAssumption,
    CostEstimateRequest,
    CostEstimateResponse,
    Depth,
    ResearchRunResponse,
    RunStatus,
)
from app.services.research_cost import estimate_cost
from app.services.research_template import (
    load_template_inputs,
    render_template,
)

# Not a dependency of the router itself, so a request without a session or for an
# unknown business still sees the flag first: a switched-off feature is a 404.


def _require_enabled() -> None:
    if not get_settings().avatar_research_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Avatar research is not enabled",
        )


router = APIRouter(
    prefix="/businesses/{business_id}/research-runs",
    tags=["research-runs"],
    dependencies=[Depends(_require_enabled)],
)

_NOT_FOUND = "Research run not found"
# Rough size of text: about four characters per token.
_CHARS_PER_TOKEN = 4


def _to_response(run: ResearchRun) -> ResearchRunResponse:
    """Map a stored run to its response, parsing the stored JSON columns."""
    return ResearchRunResponse(
        id=run.id,
        business_id=run.businessId,
        status=cast(RunStatus, run.status),
        phase=run.phase,
        depth=cast(Depth, run.depth),
        model=run.model,
        max_searches=run.maxSearches,
        max_fetches=run.maxFetches,
        max_cost_usd=run.maxCostUsd,
        searches_used=run.searchesUsed,
        fetches_used=run.fetchesUsed,
        input_tokens=run.inputTokens,
        cache_write_tokens=run.cacheWriteTokens,
        cache_read_tokens=run.cacheReadTokens,
        output_tokens=run.outputTokens,
        cost_usd=run.costUsd,
        prompt_version=run.promptVersion,
        prompt_hash=run.promptHash,
        product_ids=json.loads(run.productIds),
        extra_competitor_urls=json.loads(run.extraCompetitorUrls),
        findings=json.loads(run.findings),
        coverage_note=run.coverageNote,
        error=run.error,
        cancel_requested=run.cancelRequested,
        heartbeat_at=run.heartbeatAt,
        started_at=run.startedAt,
        finished_at=run.finishedAt,
        created_at=run.createdAt,
        updated_at=run.updatedAt,
    )


@router.post("/estimate", response_model=CostEstimateResponse)
async def estimate_run(
    payload: CostEstimateRequest,
    business: Business = Depends(get_owned_business),
) -> CostEstimateResponse:
    """Estimate a run's cost and preview the prompt it would send. Creates nothing.

    Args:
        payload: Depth, model, and optionally the products and extra competitor
            URLs (at most 3 and 5).
        business: The business, resolved and ownership-checked.

    Returns:
        The cost estimate (inputs flagged measured or estimated) and the
        rendered prompt with its template version and hash.

    Raises:
        HTTPException: 404 if a chosen product is not in this business.
    """
    try:
        inputs = await load_template_inputs(
            business.id, payload.product_ids, payload.competitor_urls
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    rendered = render_template(inputs)
    prompt_tokens = len(rendered.text) // _CHARS_PER_TOKEN
    estimate = estimate_cost(payload.depth, payload.model, prompt_tokens=prompt_tokens)
    return CostEstimateResponse(
        depth=payload.depth,
        model=payload.model,
        max_searches=estimate.max_searches,
        max_fetches=estimate.max_fetches,
        expected_usd=estimate.expected_usd,
        max_usd=estimate.max_usd,
        suggested_max_cost_usd=estimate.suggested_max_cost_usd,
        prompt_tokens=prompt_tokens,
        prompt_version=rendered.version,
        prompt_hash=rendered.content_hash,
        prompt_preview=rendered.text,
        assumptions=[
            CostAssumption(
                name=a.name,
                value=a.value,
                unit=a.unit,
                measured=a.measured,
                note=a.note,
            )
            for a in estimate.assumptions
        ],
    )


@router.get("", response_model=list[ResearchRunResponse])
async def list_runs(
    business: Business = Depends(get_owned_business),
) -> list[ResearchRunResponse]:
    """List a business's research runs, newest first.

    Args:
        business: The business, resolved and ownership-checked.

    Returns:
        The runs (none until runs can be started in 7b).
    """
    runs = await db.researchrun.find_many(
        where={"businessId": business.id}, order={"createdAt": "desc"}
    )
    return [_to_response(r) for r in runs]


@router.get("/{run_id}", response_model=ResearchRunResponse)
async def get_run(
    run_id: str, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """Fetch one research run.

    Args:
        run_id: The run's id.
        business: The business, resolved and ownership-checked.

    Returns:
        The run.

    Raises:
        HTTPException: 404 if the run does not exist in this business.
    """
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return _to_response(run)
