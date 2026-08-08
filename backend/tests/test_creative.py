"""Tests for the Creative Agent endpoints.

generate_creatives (the actual LLM call) is mocked here — its own behavior
is covered by test_creative_service.py. These tests cover auth, ownership
scoping, the strategy dependency, storage, selection, and response shape.
"""

from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    StrategyContent,
    TargetAudience,
)
from fastapi.testclient import TestClient

_FAKE_STRATEGY = StrategyContent(
    objective="SALES",
    target_audience=TargetAudience(),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
)

_FAKE_VARIANTS = [
    GeneratedCreativeVariant(
        headline=f"Headline {letter}",
        body_text=f"Primary text {letter}",
        description=f"Description {letter}",
        cta="SHOP_NOW",
        creative_angle=f"Angle {letter}",
        image_prompt=f"Image prompt {letter}",
        video_prompt=f"Video prompt {letter}",
    )
    for letter in "ABCD"
]


def _signed_up_client(
    client: TestClient, email: str = "owner@example.com"
) -> TestClient:
    """Sign a fresh user up (and thus in) on the given client."""
    client.post("/auth/signup", json={"email": email, "password": "supersecret123"})
    return client


def _create_business(client: TestClient, name: str = "Acme Widgets") -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    response = client.post("/businesses", json={"name": name})
    id_: str = response.json()["id"]
    return id_


def _create_campaign(client: TestClient, business_id: str) -> str:
    """Create a campaign under a business, return its id."""
    response = client.post(
        f"/businesses/{business_id}/campaigns", json={"objective": "SALES"}
    )
    id_: str = response.json()["id"]
    return id_


def _generate_strategy(client: TestClient, business_id: str, campaign_id: str) -> None:
    """Generate a strategy on a campaign (mocked in the strategy fixture)."""
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy"
    )
    assert response.status_code == 201


@pytest.fixture(autouse=True)
def mock_generate_creatives(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """By default, generating creatives succeeds with four canned variants."""
    mock = AsyncMock(return_value=_FAKE_VARIANTS)
    monkeypatch.setattr(creative_module, "generate_creatives", mock)
    return mock


@pytest.fixture(autouse=True)
def mock_generate_strategy(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """_generate_strategy (test helper) needs the strategy endpoint to
    succeed without a real ANTHROPIC_API_KEY — same approach as
    test_strategy.py's own fixture."""
    mock = AsyncMock(return_value=_FAKE_STRATEGY)
    monkeypatch.setattr(strategy_module, "generate_strategy", mock)
    return mock


def test_create_creatives_requires_a_session(client: TestClient) -> None:
    """Generating creatives with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/creatives")

    assert response.status_code == 401


def test_create_creatives_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Generating creatives for a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/creatives"
    )

    assert response.status_code == 404


def test_create_creatives_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't generate creatives for a campaign they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 404


def test_create_creatives_400s_without_a_strategy(client: TestClient) -> None:
    """Generating creatives before a strategy exists is a clean 400, not a crash."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 400
    assert "strategy" in response.json()["detail"].lower()


def test_create_creatives_stores_and_returns_four_variants(
    client: TestClient, mock_generate_creatives: AsyncMock
) -> None:
    """A generated batch is stored and returned as four ordered variants."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 201
    body = response.json()
    assert len(body) == 4
    assert [c["headline"] for c in body] == [
        "Headline A",
        "Headline B",
        "Headline C",
        "Headline D",
    ]
    assert body[0]["campaignId"] == campaign_id
    assert body[0]["adId"] is None
    assert body[0]["status"] == "GENERATED"
    assert body[0]["cta"] == "SHOP_NOW"
    mock_generate_creatives.assert_awaited_once()


def test_create_creatives_marks_the_campaign_as_ads_generated(
    client: TestClient,
) -> None:
    """Generating creatives advances Campaign.status."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "ADS_GENERATED"


def test_create_creatives_replaces_an_existing_batch(client: TestClient) -> None:
    """Calling create again regenerates rather than appending to the old batch."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")
    second = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")

    assert len(second.json()) == 4
    listed = client.get(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")
    assert len(listed.json()) == 4


def test_create_creatives_surfaces_agent_failures_as_500(
    client: TestClient, mock_generate_creatives: AsyncMock
) -> None:
    """A CreativeAgentError becomes a clean 500."""
    from app.services.creative import CreativeAgentError

    mock_generate_creatives.side_effect = CreativeAgentError(
        "ANTHROPIC_API_KEY is not configured"
    )

    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 500
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


def test_list_creatives_requires_a_session(client: TestClient) -> None:
    """Listing creatives with no session cookie returns 401."""
    response = client.get("/businesses/some-id/campaigns/some-id/creatives")

    assert response.status_code == 401


def test_list_creatives_returns_an_empty_list_before_any_are_generated(
    client: TestClient,
) -> None:
    """Listing before generation returns an empty list, not a 404."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 200
    assert response.json() == []


def test_list_creatives_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't list creatives for a campaign they don't own."""
    _signed_up_client(client, email="alice@example.com")
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    client.post("/auth/logout")

    _signed_up_client(client, email="bob@example.com")
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )

    assert response.status_code == 404


def test_select_creative_requires_a_session(client: TestClient) -> None:
    """Selecting a creative with no session cookie returns 401."""
    response = client.post(
        "/businesses/some-id/campaigns/some-id/creatives/some-id/select"
    )

    assert response.status_code == 401


def test_select_creative_404s_for_an_unknown_creative(client: TestClient) -> None:
    """Selecting a creative id that doesn't belong to the campaign 404s."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/does-not-exist/select"
    )

    assert response.status_code == 404


def test_select_creative_marks_it_selected_and_siblings_rejected(
    client: TestClient,
) -> None:
    """Selecting one variant flips it to SELECTED and the rest to REJECTED."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    chosen_id = generated[1]["id"]

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{chosen_id}/select"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "SELECTED"

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    statuses = {c["id"]: c["status"] for c in listed}
    assert statuses[chosen_id] == "SELECTED"
    assert all(
        status == "REJECTED" for id_, status in statuses.items() if id_ != chosen_id
    )


def test_select_creative_advances_the_campaign_to_pending_approval(
    client: TestClient,
) -> None:
    """Selecting an ad is what makes a campaign ready for approval (PRD.md
    build step 7) — status should move forward from ADS_GENERATED."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{generated[0]['id']}/select"
    )

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "PENDING_APPROVAL"


def test_full_flow_can_be_approved_after_selecting_an_ad(client: TestClient) -> None:
    """End to end: strategy -> creatives -> select -> approve."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{generated[0]['id']}/select"
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_approving_an_already_approved_campaign_is_idempotent(
    client: TestClient,
) -> None:
    """Calling approve again on an already-APPROVED campaign just succeeds."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{generated[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 200
    assert response.json()["status"] == "APPROVED"


def test_regenerating_creatives_after_approval_reverts_the_status(
    client: TestClient,
) -> None:
    """Regenerating ads after an approval invalidates it — the approved
    content no longer exists, so the campaign must go through selection and
    approval again before it's ready."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{generated[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "ADS_GENERATED"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    assert response.status_code == 400
