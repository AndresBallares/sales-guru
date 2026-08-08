"""Shared pytest fixtures."""

from collections.abc import Iterator

import pytest
from app.main import app
from fastapi.testclient import TestClient


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Provide a FastAPI test client.

    Yields:
        A TestClient bound to the application instance.
    """
    with TestClient(app) as test_client:
        yield test_client
