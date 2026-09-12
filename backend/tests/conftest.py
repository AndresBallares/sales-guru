"""Shared pytest fixtures.

Tests run against a dedicated `test.db`, never the local dev database —
loaded from `.env.test` (DATABASE_URL, ENABLE_SCHEDULER) here, before any
`app.*` import, since prisma-client-py resolves DATABASE_URL once at
`Prisma()` construction time (not at `connect()` time) and
Settings.get_settings() is @lru_cache'd, first evaluated at app.main's
module level. `.env.test` is the one and only place this repo's test
environment is defined — every smoke/throwaway script should load it the
same way, never hardcode these values separately (see CLAUDE.md's
destructive-command rule for why that duplication is worth avoiding).

FAKE_LLM is the one `.env.test` key deliberately *not* applied here (see
below) — everything else in this file comes straight from it.
"""

import os
import subprocess
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

# override=True: a developer's shell may already have DATABASE_URL set
# (e.g. from sourcing .env for a `uv run uvicorn` session in another tab)
# — .env.test must win regardless, never silently defer to it.
load_dotenv(dotenv_path=_BACKEND_ROOT / ".env.test", override=True)
# .env.test sets FAKE_LLM=1 as a safe default for smoke/throwaway scripts
# that don't otherwise care about it — but pytest's own tests already
# control this flag per-test (monkeypatch.setenv("FAKE_LLM", ...) +
# get_settings.cache_clear(), see test_creative_service.py/
# test_strategist_service.py), and most of them deliberately rely on it
# being unset by default so they can exercise the real (non-fake)
# generate_creatives/generate_strategy code paths against a mocked
# Anthropic client. Loading it globally here broke 33 of those tests
# outright (confirmed 2026-09-12) — both that, and test_config.py/
# test_auth.py's ENVIRONMENT="production" tests, which don't separately
# clear FAKE_LLM and so tripped Settings._forbid_in_production the moment
# it was set process-wide. So pytest specifically excludes this one key
# from what it takes from .env.test, unlike DATABASE_URL/ENABLE_SCHEDULER,
# which really are constant for the whole session.
os.environ.pop("FAKE_LLM", None)
# A fresh key each run — tests never need to decrypt across process
# restarts, and generating one avoids a fake-looking "real" secret sitting
# in the repo (see app/core/crypto.py for what this encrypts/decrypts).
# Not in .env.test itself since it must be different every run, not fixed.
os.environ["META_TOKEN_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import pytest
import pytest_asyncio
from app.main import app
from fastapi.testclient import TestClient
from prisma import Prisma

# Every Prisma model, lowercased (matches the generated client's action
# names). Deletion order doesn't matter — see _clean_database, which
# disables FK enforcement for the duration of the cleanup — so this list
# just needs a new entry whenever a model is added; no ordering to get
# wrong or forget to update.
_ALL_TABLES = (
    "passwordresettoken",
    "session",
    "metric",
    "optimizationrecommendation",
    "creative",
    "ad",
    "adset",
    "strategy",
    "campaign",
    "productimage",
    "product",
    "audience",
    "metaoauthstate",
    "metaconnection",
    "business",
    "subscription",
    "organization",
    "user",
)


@pytest.fixture(scope="session", autouse=True)
def _test_database() -> None:
    """Create a fresh, empty test database once per test session.

    Goes through scripts/db-reset.sh rather than calling `prisma db push
    --force-reset` directly — that script refuses to run against anything
    but a test.db-style target (see its own header comment for why this
    matters), so a future accidental DATABASE_URL misconfiguration fails
    loudly here instead of silently wiping the wrong database.
    """
    subprocess.run(
        [str(_BACKEND_ROOT / "scripts" / "db-reset.sh"), "--skip-generate"],
        check=True,
        cwd=_BACKEND_ROOT,
    )


@pytest_asyncio.fixture(autouse=True)
async def _clean_database() -> AsyncIterator[None]:
    """Empty every table before each test, for isolation between tests."""
    cleaner = Prisma()
    await cleaner.connect()
    await cleaner.execute_raw("PRAGMA foreign_keys = OFF")
    for table in _ALL_TABLES:
        await getattr(cleaner, table).delete_many()
    await cleaner.execute_raw("PRAGMA foreign_keys = ON")
    await cleaner.disconnect()
    yield


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Provide a FastAPI test client.

    Yields:
        A TestClient bound to the application instance.
    """
    with TestClient(app) as test_client:
        yield test_client
