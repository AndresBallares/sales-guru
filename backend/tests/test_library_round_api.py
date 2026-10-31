"""POST .../rounds hands the Strategist the library and the results so far."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative_round as round_module
from app.services.round_results import AdAngle, AdResult, RoundResults
from fastapi.testclient import TestClient

from tests.test_buyer_avatars import _payload
from tests.test_buyer_avatars import _url as avatars_url
from tests.test_creative_rounds import (
    _campaign,
    _new_round,
    generate_mock,  # noqa: F401  (a fixture, used by name)
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

_RESULTS = RoundResults(
    "cost_per_add_to_cart",
    AdResult("ad1", AdAngle("Label", "cav-a", None, None, None), 100.0, 10, 10.0),
    None,
    2,
)


@pytest.fixture
def load_results(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    loader = AsyncMock(return_value=_RESULTS)
    monkeypatch.setattr(round_module, "load_round_results", loader)
    return loader


def _sent(agent: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of the agent's latest call."""
    call = agent.await_args
    assert call is not None
    return dict(call.kwargs)


def test_the_round_is_given_the_assignable_avatars_and_the_results(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
    mock_round_angles: AsyncMock,  # noqa: F811
    load_results: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    first = client.post(avatars_url(business_id), json=_payload(name="First")).json()
    client.post(avatars_url(business_id), json=_payload(name="Off", isActive=False))

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201
    kwargs = _sent(mock_round_angles)
    assert [a.id for a in kwargs["buyer_avatars"]] == [first["id"]]
    assert kwargs["previous_results"] is _RESULTS
    load_results.assert_awaited_once_with(campaign_id)


def test_with_no_numbers_yet_the_round_gets_no_results(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
    mock_round_angles: AsyncMock,  # noqa: F811
    load_results: AsyncMock,
) -> None:
    load_results.return_value = None
    business_id, campaign_id, _ = _campaign(client, monkeypatch)

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201
    kwargs = _sent(mock_round_angles)
    assert kwargs["buyer_avatars"] == []
    assert kwargs["previous_results"] is None
