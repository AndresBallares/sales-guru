"""Tests for the health check endpoint."""

from fastapi.testclient import TestClient


def test_health_returns_ok(client: TestClient) -> None:
    """The /health endpoint reports the service as up."""
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
