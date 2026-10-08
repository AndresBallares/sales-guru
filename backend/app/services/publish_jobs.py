"""Background publish jobs, for publishes that take minutes (video).

Uploading a video to Meta and waiting for it to process can take far longer
than an HTTP request should stay open, so a publish containing a video runs as
a background task and the frontend polls its status (confirmed 2026-10-07). An
image-only publish stays a single synchronous request.

State is held in memory, one job per campaign: the backend is a single instance
and a job's useful life is a few minutes. Nothing is created on Meta until the
video has been processed (see app/services/publish.py), so a restart mid-job
leaves no half-published campaign — only a video in the ad account's library.
The campaign stays APPROVED and can simply be published again.
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Literal

from app.services.meta import MetaConnectionError

logger = logging.getLogger(__name__)

JobState = Literal["PROCESSING", "DONE", "FAILED"]
_GENERIC_FAILURE = "Something went wrong while publishing — please try again."


@dataclass
class PublishJob:
    """One campaign's most recent background publish."""

    state: JobState = "PROCESSING"
    step: str | None = "Starting"
    progress: int | None = None
    error: str | None = None
    started_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None

    @property
    def elapsed_seconds(self) -> float:
        """Seconds since it started (frozen once it finishes)."""
        return (self.finished_at or time.monotonic()) - self.started_at


_jobs: dict[str, PublishJob] = {}
# Strong references: asyncio only keeps weak ones to running tasks.
_tasks: set["asyncio.Task[None]"] = set()


def get_job(campaign_id: str) -> PublishJob | None:
    """The campaign's latest job, or None if it never ran one."""
    return _jobs.get(campaign_id)


def is_running(campaign_id: str) -> bool:
    """Whether a publish for this campaign is currently in flight."""
    job = _jobs.get(campaign_id)
    return job is not None and job.state == "PROCESSING"


def start_job(
    campaign_id: str,
    work: Callable[[Callable[[str, int | None], None]], Awaitable[None]],
    on_failure: Callable[[], Awaitable[None]],
) -> PublishJob:
    """Run `work` in the background and track it.

    Args:
        campaign_id: The campaign being published.
        work: The publish, given a reporter it calls with (step, percent).
        on_failure: Awaited when the job fails, e.g. to mark the campaign FAILED.

    Returns:
        The new job (state PROCESSING).
    """
    job = PublishJob()
    _jobs[campaign_id] = job

    def report(step: str, percent: int | None) -> None:
        job.step, job.progress = step, percent

    async def run() -> None:
        try:
            await work(report)
        except MetaConnectionError as exc:
            job.error = str(exc)
        except Exception:
            logger.exception("Background publish failed for campaign %s", campaign_id)
            job.error = _GENERIC_FAILURE
        if job.error is not None:
            job.state = "FAILED"
            try:
                await on_failure()
            except Exception:
                logger.exception("Could not mark campaign %s FAILED", campaign_id)
        else:
            job.state = "DONE"
        job.step, job.progress = None, None
        job.finished_at = time.monotonic()

    task = asyncio.get_running_loop().create_task(run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return job
