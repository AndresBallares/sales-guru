"""POST .../strategy hands the Strategist the business's assignable avatars."""

from typing import Any
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from tests.test_buyer_avatars import _payload
from tests.test_buyer_avatars import _url as avatars_url
from tests.test_strategy import (
    _FAKE_CREATIVE_TEST_PLAN,
    _create_business,
    _create_campaign,
    _signed_up_client,
    mock_generate_strategy,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_meta_oauth,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def _sent(agent: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of the agent's latest call."""
    call = agent.await_args
    assert call is not None
    return dict(call.kwargs)


def _generate(client: TestClient, business_id: str, campaign_id: str) -> None:
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": False},
    )
    assert response.status_code == 201


def test_only_active_undeleted_avatars_reach_the_strategist(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_CREATIVE_TEST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    ids = {}
    for name, extra in (
        ("First", {}),
        ("Second", {"purchaseFor": "gift"}),
        ("Off", {"isActive": False}),
        ("Gone", {}),
    ):
        ids[name] = client.post(
            avatars_url(business_id), json=_payload(name=name, **extra)
        ).json()["id"]
    client.delete(avatars_url(business_id, f"/{ids['Gone']}"))
    campaign_id = _create_campaign(client, business_id)

    _generate(client, business_id, campaign_id)

    sent = _sent(mock_generate_strategy)["buyer_avatars"]
    assert [(a.id, a.purchaseFor) for a in sent] == [
        (ids["First"], "self"),
        (ids["Second"], "gift"),
    ]


def test_a_business_without_avatars_passes_an_empty_library(
    client: TestClient,
    mock_generate_strategy: AsyncMock,  # noqa: F811
) -> None:
    mock_generate_strategy.return_value = _FAKE_CREATIVE_TEST_PLAN
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    _generate(client, business_id, campaign_id)

    assert _sent(mock_generate_strategy)["buyer_avatars"] == []
