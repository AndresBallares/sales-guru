"""Avatar Research endpoints (Phase 7a): estimate a run and read stored runs.

Behind AVATAR_RESEARCH_ENABLED (off by default; every route is a 404 while it is
off, and FAKE_LLM does not open it). Phase 7b adds ``POST`` (start a run in the
background, ``app/services/research_runner.py``) and ``POST .../{run_id}/cancel``.
"""

import json
from datetime import UTC, datetime
from typing import cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, ResearchRun
from prisma.types import ResearchRunUpdateInput

from app.core.authz import get_owned_business
from app.core.config import get_settings
from app.core.db import db
from app.schemas.research import (
    CostAssumption,
    CostEstimateRequest,
    CostEstimateResponse,
    Depth,
    ReadinessItemResponse,
    ResearchRunResponse,
    RunStatus,
    StartRunRequest,
)
from app.services import research_access, research_runner
from app.services.research_access import RunRefusedError
from app.services.research_cost import estimate_cost
from app.services.research_template import (
    load_template_inputs,
    readiness,
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
        stop_reason=run.stopReason,
        customer_voice_sources=run.customerVoiceSources,
        evidence_level=run.evidenceLevel,
        evidence_reason=run.evidenceReason,
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
        HTTPException: 404 if a chosen product is not in this business; 403 if
            the business may not use the model.
    """
    await research_runner.sweep_stale_runs()
    access = await research_access.access_for(business.id)
    try:
        research_access.require_model(access, payload.model)
    except RunRefusedError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
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
        allowed_models=access.models,
        runs_per_month=access.runs_per_month,
        runs_used=access.runs_used,
        runs_remaining=access.runs_remaining,
        readiness=[
            ReadinessItemResponse(field=i.field, label=i.label, empty=i.empty)
            for i in readiness(inputs)
        ],
    )


@router.post(
    "", response_model=ResearchRunResponse, status_code=status.HTTP_202_ACCEPTED
)
async def start_run(
    payload: StartRunRequest,
    business: Business = Depends(get_owned_business),
) -> ResearchRunResponse:
    """Start a research run in the background and return it (queued).

    Args:
        payload: Depth, model, optional products, extra competitor URLs and a
            dollar cap (the estimate's suggested cap if left out).
        business: The business, resolved and ownership-checked.

    Returns:
        The new run. Poll ``GET .../{runId}`` for its progress.

    Raises:
        HTTPException: 404 for an unknown product, 403 if the business may not
            use the model, 409 if a run is already in progress, 429 over the
            monthly limit, 503 if research is not configured.
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
    try:
        run = await research_runner.create_and_start(
            business,
            depth=payload.depth,
            model=payload.model,
            product_ids=payload.product_ids or [],
            extra_competitor_urls=payload.competitor_urls,
            max_cost_usd=payload.max_cost_usd or estimate.suggested_max_cost_usd,
            prompt_version=rendered.version,
            prompt_hash=rendered.content_hash,
        )
    except RunRefusedError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.message) from exc
    return _to_response(run)


@router.get("", response_model=list[ResearchRunResponse])
async def list_runs(
    business: Business = Depends(get_owned_business),
) -> list[ResearchRunResponse]:
    """List a business's research runs, newest first.

    Args:
        business: The business, resolved and ownership-checked.

    Returns:
        The runs.
    """
    await research_runner.sweep_stale_runs()
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
    await research_runner.sweep_stale_runs()
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return _to_response(run)


@router.post("/{run_id}/cancel", response_model=ResearchRunResponse)
async def cancel_run(
    run_id: str, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """Ask a run to stop. It stops before its next request and keeps its findings.

    A run that has not started yet is canceled at once.

    Args:
        run_id: The run's id.
        business: The business, resolved and ownership-checked.

    Returns:
        The run, with ``cancelRequested`` set (or already CANCELED).

    Raises:
        HTTPException: 404 if the run does not exist in this business; 409 if it
            has already finished.
    """
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if run.status not in ("QUEUED", "RUNNING"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="This run has already finished"
        )
    data: dict[str, object] = {"cancelRequested": True}
    if run.status == "QUEUED":
        data |= {
            "status": "CANCELED",
            "stopReason": "canceled",
            "finishedAt": datetime.now(UTC),
        }
    updated = await db.researchrun.update(
        where={"id": run.id}, data=cast("ResearchRunUpdateInput", data)
    )
    assert updated is not None
    return _to_response(updated)
