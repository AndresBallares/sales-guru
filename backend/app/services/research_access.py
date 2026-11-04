"""Who may start a research run, on which model, and how often (Phase 7b).

Two per-business settings, both set by hand by the app owner and never by the
business user (docs/phase-7.md "Plan change"; billing will write the same columns
later, BACKLOG.md):

- ``Business.allowedResearchModels``: a JSON array of model ids, default only
  ``claude-opus-5-5``. ``claude-fable-5-1`` is a premium extra.
- ``Business.researchRunsPerMonth``: runs per calendar month (UTC), default 1.

There is no admin role in the app and no HTTP route writes these columns:
``backend/scripts/research_access.py`` calls ``set_access`` from a shell with
database access, which is admin-only by construction.
"""

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import cast, get_args

from prisma import Prisma
from prisma.types import BusinessUpdateInput

from app.core.db import db as default_db
from app.schemas.research import ResearchModel

DEFAULT_MODELS: tuple[str, ...] = ("claude-opus-5-5",)
KNOWN_MODELS: tuple[str, ...] = get_args(ResearchModel)


class RunRefusedError(Exception):
    """A run may not start; ``status`` is the HTTP status and ``message`` the reason."""

    def __init__(self, status: int, message: str) -> None:
        """Create the refusal.

        Args:
            status: The HTTP status to answer with.
            message: What to tell the caller.
        """
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass(frozen=True)
class Access:
    """A business's research settings and this month's use."""

    models: list[str]
    runs_per_month: int
    runs_used: int

    @property
    def runs_remaining(self) -> int:
        """Runs left this month (never negative)."""
        return max(self.runs_per_month - self.runs_used, 0)


def parse_models(stored: str | None) -> list[str]:
    """The allowed models from the stored JSON; a corrupt value means the default.

    Args:
        stored: ``Business.allowedResearchModels``.

    Returns:
        Known model ids only, in stored order.
    """
    try:
        value = json.loads(stored or "[]")
    except ValueError:
        value = []
    models = [m for m in value if isinstance(m, str) and m in KNOWN_MODELS]
    return models or list(DEFAULT_MODELS)


def month_start(now: datetime | None = None) -> datetime:
    """Midnight UTC on the first day of the month.

    Args:
        now: The moment to take the month of; the current time by default.

    Returns:
        A timezone-aware datetime.
    """
    moment = now or datetime.now(UTC)
    return moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


async def runs_used_this_month(
    business_id: str, *, now: datetime | None = None, client: Prisma | None = None
) -> int:
    """Runs this calendar month that count against the limit.

    What counts (decided 2026-11-03): a run in progress, a completed run
    (NEEDS_REVIEW, partial results included), and a run the owner canceled after
    it spent money. A FAILED run never counts, even if it spent money: it
    delivered nothing, and every way a run fails (a bug, a provider error, a
    restart, our own cap guard stopping early) is the system's side. Its kind is
    stored in ``ResearchRun.stopReason`` (``system_error``, ``provider``,
    ``stale``, ``cap``, ``time``, ``no_submit``). A run canceled before it spent
    anything does not count either.

    Args:
        business_id: The business.
        now: Taken as the current time (for tests).
        client: A connected Prisma client; the app's shared one by default.

    Returns:
        The number of runs.
    """
    prisma = client or default_db
    runs = await prisma.researchrun.find_many(
        where={"businessId": business_id, "createdAt": {"gte": month_start(now)}}
    )
    return sum(
        1
        for r in runs
        if r.status in ("QUEUED", "RUNNING", "NEEDS_REVIEW", "REVIEWED", "DISCARDED")
        or (r.status == "CANCELED" and r.costUsd > 0)
    )


async def access_for(business_id: str, *, client: Prisma | None = None) -> Access:
    """Read a business's settings and this month's use.

    Args:
        business_id: The business.
        client: A connected Prisma client; the app's shared one by default.

    Returns:
        The access summary.

    Raises:
        ValueError: If the business does not exist.
    """
    prisma = client or default_db
    business = await prisma.business.find_unique(where={"id": business_id})
    if business is None:
        raise ValueError("Business not found")
    return Access(
        models=parse_models(business.allowedResearchModels),
        runs_per_month=business.researchRunsPerMonth,
        runs_used=await runs_used_this_month(business_id, client=prisma),
    )


def require_model(access: Access, model: str) -> None:
    """Refuse a model the business may not use.

    Args:
        access: The business's settings.
        model: The model asked for.

    Raises:
        RunRefusedError: 403, naming the model and what is enabled.
    """
    if model not in access.models:
        raise RunRefusedError(
            403,
            f"{model} is not enabled for this business. "
            f"Enabled: {', '.join(access.models)}.",
        )


def require_runs_left(access: Access) -> None:
    """Refuse a run over the monthly limit.

    Args:
        access: The business's settings and use.

    Raises:
        RunRefusedError: 429, with the numbers and when the limit resets.
    """
    if access.runs_remaining <= 0:
        raise RunRefusedError(
            429,
            f"This business has used {access.runs_used} of "
            f"{access.runs_per_month} research runs this month (monthly limit). "
            "The limit resets on the 1st (UTC).",
        )


async def set_access(
    *,
    business_id: str,
    models: list[str] | None = None,
    runs_per_month: int | None = None,
    client: Prisma | None = None,
) -> None:
    """Change a business's research settings (the owner's tool; no HTTP route).

    Args:
        business_id: The business.
        models: The model ids to allow, or None to leave the list alone.
        runs_per_month: The monthly limit, or None to leave it alone.
        client: A connected Prisma client; the app's shared one by default.

    Raises:
        ValueError: For an unknown business, an unknown or empty model list, or
            a negative limit.
    """
    prisma = client or default_db
    data: dict[str, object] = {}
    if models is not None:
        unknown = [m for m in models if m not in KNOWN_MODELS]
        if unknown:
            raise ValueError(
                f"Unknown research model: {', '.join(unknown)} "
                f"(known: {', '.join(KNOWN_MODELS)})"
            )
        if not models:
            raise ValueError("Allow at least one model")
        data["allowedResearchModels"] = json.dumps(list(dict.fromkeys(models)))
    if runs_per_month is not None:
        if runs_per_month < 0:
            raise ValueError("Runs per month must be 0 or more")
        data["researchRunsPerMonth"] = runs_per_month
    if await prisma.business.find_unique(where={"id": business_id}) is None:
        raise ValueError("Business not found")
    if data:
        await prisma.business.update(
            where={"id": business_id}, data=cast("BusinessUpdateInput", data)
        )
