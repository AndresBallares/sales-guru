"""Tests for the APScheduler wiring (PRD.md build step 10).

Registering a job doesn't run it (APScheduler's "interval" trigger just
schedules future execution), so these tests only exercise
start_scheduler/stop_scheduler's own behavior — never the job functions
themselves, which have their own tests in test_optimization_jobs.py.

AsyncIOScheduler.start() binds to asyncio.get_running_loop(), so these
must run inside an actual event loop (@pytest.mark.asyncio), not as plain
sync tests.
"""

import pytest
from app.core import scheduler as scheduler_module


@pytest.mark.asyncio
async def test_start_scheduler_registers_both_jobs() -> None:
    """Both periodic jobs are registered under their expected ids."""
    scheduler_module.start_scheduler()

    job_ids = {job.id for job in scheduler_module.scheduler.get_jobs()}
    assert job_ids == {"collect_metrics", "evaluate_campaigns"}
    assert scheduler_module.scheduler.running

    scheduler_module.stop_scheduler()


@pytest.mark.asyncio
async def test_start_scheduler_is_idempotent() -> None:
    """Calling start_scheduler twice replaces rather than duplicates jobs."""
    scheduler_module.start_scheduler()
    scheduler_module.start_scheduler()

    job_ids = [job.id for job in scheduler_module.scheduler.get_jobs()]
    assert sorted(job_ids) == ["collect_metrics", "evaluate_campaigns"]

    scheduler_module.stop_scheduler()


def test_stop_scheduler_is_safe_to_call_when_not_running() -> None:
    """Stopping an already-stopped scheduler doesn't raise."""
    assert not scheduler_module.scheduler.running

    scheduler_module.stop_scheduler()

    assert not scheduler_module.scheduler.running
