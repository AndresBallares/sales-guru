"""Shared pytest fixtures.

Tests run against a dedicated `test.db`, never the local dev database —
`DATABASE_URL` must be overridden here, before any `app.*` import, since
prisma-client-py resolves it once at `Prisma()` construction time, not at
`connect()` time.
"""

import os
import subprocess
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

os.environ["DATABASE_URL"] = "file:./test.db"

import pytest
import pytest_asyncio
from app.main import app
from fastapi.testclient import TestClient
from prisma import Prisma

_BACKEND_ROOT = Path(__file__).resolve().parent.parent

# Every Prisma model, lowercased (matches the generated client's action
# names). Deletion order doesn't matter — see _clean_database, which
# disables FK enforcement for the duration of the cleanup — so this list
# just needs a new entry whenever a model is added; no ordering to get
# wrong or forget to update.
_ALL_TABLES = (
    "session",
    "metric",
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
    """Create a fresh, empty test database once per test session."""
    subprocess.run(
        ["uv", "run", "prisma", "db", "push", "--force-reset", "--skip-generate"],
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
