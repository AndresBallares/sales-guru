"""Avatar Research endpoints (Phase 7a): estimate a run and read stored runs.

Behind AVATAR_RESEARCH_ENABLED (off by default; every route is a 404 while it is
off, and FAKE_LLM does not open it). Phase 7b adds ``POST`` (start a run in the
background, ``app/services/research_runner.py``) and ``POST .../{run_id}/cancel``.
"""

import json
from datetime import UTC, datetime
from typing import Any, Literal, cast

from fastapi import APIRouter, Depends, HTTPException, status
from prisma.models import Business, BuyerAvatar, ResearchRun
from prisma.types import ResearchRunUpdateInput

from app.core.authz import get_owned_business
from app.core.config import get_settings
from app.core.db import db
from app.schemas.base import CamelCaseModel
from app.schemas.research import (
    CostAssumption,
    CostEstimateRequest,
    CostEstimateResponse,
    Depth,
    ReadinessItemResponse,
    ResearchRunResponse,
    RunStatus,
    SavedDraft,
    StartRunRequest,
)
from app.services import research_access, research_runner
from app.services.research_access import RunRefusedError
from app.services.research_cost import estimate_cost
from app.services.research_evidence import MIN_CUSTOMER_VOICE
from app.services.research_fakes import (
    COMPETITOR_TERMS,
    canned_avatars,
    canned_findings,
)
from app.services.research_filters import split_ignored_terms
from app.services.research_phases import PHASES_VERSION
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


def _stored_terms(findings: dict[str, Any]) -> list[str]:
    raw = findings.get("competitorTerms")
    return [t for t in raw if isinstance(t, str)] if isinstance(raw, list) else []


def _to_response(
    run: ResearchRun, saved_avatars: list[BuyerAvatar] | None = None
) -> ResearchRunResponse:
    """Map a stored run to its response, parsing the stored JSON columns."""
    findings = json.loads(run.findings)
    active_terms, ignored_terms = split_ignored_terms(_stored_terms(findings))
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
        findings=findings,
        coverage_note=run.coverageNote,
        error=run.error,
        stop_reason=run.stopReason,
        customer_voice_sources=run.customerVoiceSources,
        customer_voice_minimum=MIN_CUSTOMER_VOICE.get(run.depth, 0),
        competitor_terms=active_terms,
        ignored_competitor_terms=ignored_terms,
        saved_avatar_ids=[a.id for a in saved_avatars or []],
        saved_drafts=[
            SavedDraft(draft_index=a.sourceDraftIndex, avatar_id=a.id)
            for a in saved_avatars or []
            if a.sourceDraftIndex is not None
        ],
        reviewed_at=run.reviewedAt,
        evidence_level=run.evidenceLevel,
        evidence_reason=run.evidenceReason,
        cancel_requested=run.cancelRequested,
        heartbeat_at=run.heartbeatAt,
        started_at=run.startedAt,
        finished_at=run.finishedAt,
        created_at=run.createdAt,
        updated_at=run.updatedAt,
    )


async def _saved_avatars(run_ids: list[str]) -> dict[str, list[BuyerAvatar]]:
    """Avatars saved from each run (BuyerAvatar.sourceRunId), oldest first."""
    if not run_ids:
        return {}
    avatars = await db.buyeravatar.find_many(
        where={"sourceRunId": {"in": run_ids}, "deletedAt": None},
        order={"createdAt": "asc"},
    )
    saved: dict[str, list[BuyerAvatar]] = {}
    for avatar in avatars:
        if avatar.sourceRunId is not None:
            saved.setdefault(avatar.sourceRunId, []).append(avatar)
    return saved


async def _response_for(run: ResearchRun) -> ResearchRunResponse:
    return _to_response(run, (await _saved_avatars([run.id])).get(run.id))


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
    return await _response_for(run)


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
    saved = await _saved_avatars([r.id for r in runs])
    return [_to_response(r, saved.get(r.id)) for r in runs]


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
    return await _response_for(run)


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


@router.post("/{run_id}/discard", response_model=ResearchRunResponse)
async def discard_run(
    run_id: str, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """End a review without saving anything. The findings are kept.

    Args:
        run_id: The run's id.
        business: The business, resolved and ownership-checked.

    Returns:
        The run, now DISCARDED.

    Raises:
        HTTPException: 404 if the run does not exist in this business; 409 if it
            is not waiting for review.
    """
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if run.status != "NEEDS_REVIEW":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a run waiting for review can be discarded",
        )
    if (await _saved_avatars([run.id])).get(run.id):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Avatars were already saved from this research, so it cannot be "
                "discarded. Mark it as done instead."
            ),
        )
    updated = await db.researchrun.update(
        where={"id": run.id},
        data={"status": "DISCARDED", "reviewedAt": datetime.now(UTC)},
    )
    assert updated is not None
    return _to_response(updated)


@router.post("/{run_id}/done", response_model=ResearchRunResponse)
async def mark_run_done(
    run_id: str, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """Finish a review the owner has saved avatars from. The saved avatars are kept.

    Args:
        run_id: The run's id.
        business: The business, resolved and ownership-checked.

    Returns:
        The run, now REVIEWED, with the avatars saved from it.

    Raises:
        HTTPException: 404 if the run does not exist in this business; 409 if it
            is not waiting for review, or nothing was saved from it (discard it).
    """
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if run.status != "NEEDS_REVIEW":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a run waiting for review can be marked as done",
        )
    saved = (await _saved_avatars([run.id])).get(run.id)
    if not saved:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Nothing was saved from this research. Discard it instead.",
        )
    updated = await db.researchrun.update(
        where={"id": run.id},
        data={"status": "REVIEWED", "reviewedAt": datetime.now(UTC)},
    )
    assert updated is not None
    return _to_response(updated, saved)


@router.post("/{run_id}/reopen", response_model=ResearchRunResponse)
async def reopen_run(
    run_id: str, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """Reopen a review marked as done, so more avatars can be saved from it.

    Args:
        run_id: The run's id.
        business: The business, resolved and ownership-checked.

    Returns:
        The run, back in NEEDS_REVIEW, with the avatars already saved from it.

    Raises:
        HTTPException: 404 if the run does not exist in this business; 409 if it
            was not marked as done.
    """
    run = await db.researchrun.find_first(
        where={"id": run_id, "businessId": business.id}
    )
    if run is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    if run.status != "REVIEWED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only a review marked as done can be reopened",
        )
    updated = await db.researchrun.update(
        where={"id": run.id}, data={"status": "NEEDS_REVIEW", "reviewedAt": None}
    )
    assert updated is not None
    return await _response_for(updated)


class SeedRequest(CamelCaseModel):
    """Test-only: what kind of finished run to create."""

    evidence: Literal["ok", "low"] = "ok"
    # "running" makes a run that is part-way through instead of a finished one.
    status: Literal["needs_review", "running"] = "needs_review"


def _seed_findings() -> dict[str, Any]:
    """A finished run's findings built from the canned fakes, in the stored shape."""
    findings = canned_findings()
    avatars = canned_avatars()
    statuses = ["verified", "verified", "unverified", "verified"]
    problems = []
    quote_index = 0
    for problem in findings.problems:
        evidence = []
        for item in problem.evidence:
            is_quote = item.kind == "quote"
            evidence.append(
                {
                    **item.model_dump(),
                    "status": statuses[quote_index % len(statuses)]
                    if is_quote
                    else None,
                }
            )
            quote_index += int(is_quote)
        problems.append({**problem.model_dump(), "evidence": evidence})
    seeded_avatars = [a.model_dump() for a in avatars.avatars]
    seeded_avatars[0]["hooks"][0] = "Better than a Cartier ring"
    return cast(
        "dict[str, Any]",
        research_runner.camel_keys(
            {
                "problems": problems,
                "solutions": [s.model_dump() for s in findings.solutions],
                "gaps": [g.model_dump() for g in findings.gaps],
                "avatars": seeded_avatars,
                "sources": [s.model_dump() for s in avatars.sources],
                "competitor_terms": [*COMPETITOR_TERMS, "Spur", "Cartier"],
                "dropped_quotes": [],
                "warnings": [],
                "quotes": {"verified": 3, "unverified": 1, "dropped": 0},
                "partial": False,
                "phases_version": PHASES_VERSION,
            }
        ),
    )


@router.post(
    "/fake-seed",
    response_model=ResearchRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def seed_run(
    payload: SeedRequest, business: Business = Depends(get_owned_business)
) -> ResearchRunResponse:
    """Test-only: create a finished run waiting for review. Costs nothing.

    Exists only under FAKE_LLM (a 404 otherwise), so the review screens can be tested
    in states a canned run does not reach.

    Args:
        payload: Whether the run has enough customer-voice evidence.
        business: The business, resolved and ownership-checked.

    Returns:
        The run, NEEDS_REVIEW.

    Raises:
        HTTPException: 404 unless FAKE_LLM is on.
    """
    if not get_settings().fake_llm_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    low = payload.evidence == "low"
    minimum = MIN_CUSTOMER_VOICE["standard"]
    now = datetime.now(UTC)
    if payload.status == "running":
        run = await db.researchrun.create(
            data={
                "businessId": business.id,
                "status": "RUNNING",
                "phase": "voice",
                "depth": "standard",
                "model": "claude-opus-5-5",
                "maxSearches": 15,
                "maxFetches": 20,
                "maxCostUsd": 3.0,
                "searchesUsed": 4,
                "fetchesUsed": 6,
                "costUsd": 0.42,
                "promptVersion": "avatar_research_v3",
                "promptHash": "f" * 64,
                "startedAt": now,
                "heartbeatAt": now,
            }
        )
        return _to_response(run)
    run = await db.researchrun.create(
        data={
            "businessId": business.id,
            "status": "NEEDS_REVIEW",
            "depth": "standard",
            "model": "claude-opus-5-5",
            "maxSearches": 15,
            "maxFetches": 20,
            "maxCostUsd": 3.0,
            "searchesUsed": 12,
            "fetchesUsed": 14,
            "costUsd": 1.25,
            "promptVersion": "avatar_research_v3",
            "promptHash": "f" * 64,
            "findings": json.dumps(_seed_findings()),
            "coverageNote": "Reached 12 of 14 linked pages; two were blocked.",
            "customerVoiceSources": 2 if low else minimum + 3,
            "evidenceLevel": "LOW" if low else "OK",
            "evidenceReason": (
                f"Reached 2 customer-voice sources; a standard run needs at least "
                f"{minimum}. Treat the problems as mostly inferred."
                if low
                else None
            ),
            "startedAt": now,
            "finishedAt": now,
        }
    )
    return _to_response(run)
