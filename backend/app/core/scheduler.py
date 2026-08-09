"""APScheduler wiring for the Optimization Agent's periodic jobs (PRD.md build step 10).

In-process, no new infrastructure — confirmed with the user 2026-08-09
(no Redis/broker/Celery anywhere in this project; APScheduler runs the
jobs on background threads within the same FastAPI process). Started
from app/main.py's lifespan, gated behind settings.enable_scheduler so
the test suite (tests/conftest.py) never has it running against a
database individual tests are actively resetting.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.services.optimization_jobs import (
    collect_metrics_for_all_live_campaigns,
    evaluate_all_live_campaigns,
)

scheduler = AsyncIOScheduler()


def start_scheduler() -> None:
    """Register and start the two periodic jobs.

    Safe to call multiple times — replace_existing means re-registering
    an already-scheduled job id just updates it instead of duplicating.
    """
    scheduler.add_job(
        collect_metrics_for_all_live_campaigns,
        "interval",
        minutes=15,
        id="collect_metrics",
        replace_existing=True,
    )
    scheduler.add_job(
        evaluate_all_live_campaigns,
        "interval",
        minutes=60,
        id="evaluate_campaigns",
        replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()


def stop_scheduler() -> None:
    """Stop the scheduler without waiting for any in-flight job to finish."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
