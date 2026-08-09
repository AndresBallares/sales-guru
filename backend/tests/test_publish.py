"""Tests for the campaign publish endpoint (PRD.md build step 8).

Strategy/creative generation and the Meta OAuth connect flow are mocked
here (same conventions as their own test files) so a full "ready to
publish" campaign can be built through the real endpoints. Only the
individual Graph API object-creation calls (app/services/meta.py's
create_meta_*) are mocked for publish itself — the orchestration
(app/services/publish.py) and its DB writes run for real against the test
database, exercised through the real endpoint via TestClient.
"""

from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import meta as meta_api_module

# app.api.strategy/creative import generate_strategy/generate_creatives
# directly, so those API modules (not the underlying service modules) are
# what need patching — mirrors test_strategy.py / test_creative.py exactly.
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    StrategyContent,
    TargetAudience,
)
from app.services import meta as meta_service_module
from fastapi.testclient import TestClient
from prisma import Prisma

_FAKE_STRATEGY = StrategyContent(
    objective="SALES",
    target_audience=TargetAudience(age_min=30, age_max=55),
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


def _create_business(
    client: TestClient, name: str = "Acme Jewelry", website: str | None = None
) -> str:
    """Create a business on the given (already signed-in) client, return its id."""
    payload = {"name": name, **({"website": website} if website else {})}
    response = client.post("/businesses", json=payload)
    id_: str = response.json()["id"]
    return id_


def _create_product(client: TestClient, business_id: str, url: str) -> str:
    """Create a product with a destination URL, return its id."""
    response = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Custom emerald rings", "url": url},
    )
    id_: str = response.json()["id"]
    return id_


def _create_campaign(
    client: TestClient, business_id: str, product_id: str | None = None
) -> str:
    """Create a campaign under a business, return its id."""
    payload: dict[str, str] = {"objective": "SALES"}
    if product_id:
        payload["productId"] = product_id
    response = client.post(f"/businesses/{business_id}/campaigns", json=payload)
    id_: str = response.json()["id"]
    return id_


def _connect_meta(client: TestClient, business_id: str) -> None:
    """Drive a full connect -> callback -> finalize round-trip (mocked)."""
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )
    client.post(
        f"/businesses/{business_id}/meta/finalize",
        json={"adAccountId": "act_1", "pageId": "page_1"},
    )


def _ready_campaign(
    client: TestClient, *, with_destination_url: bool = True
) -> tuple[str, str]:
    """Build a campaign all the way to APPROVED, Meta connected, ready to publish.

    Returns:
        (business_id, campaign_id).
    """
    _signed_up_client(client)
    business_id = _create_business(
        client, website="https://acme.example" if with_destination_url else None
    )
    campaign_id = _create_campaign(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    _connect_meta(client, business_id)
    return business_id, campaign_id


@pytest.fixture(autouse=True)
def mock_services(monkeypatch: pytest.MonkeyPatch) -> dict[str, AsyncMock]:
    """Mock strategy/creative generation, Meta OAuth, and Meta object creation."""
    monkeypatch.setattr(
        strategy_module, "generate_strategy", AsyncMock(return_value=_FAKE_STRATEGY)
    )
    monkeypatch.setattr(
        creative_module, "generate_creatives", AsyncMock(return_value=_FAKE_VARIANTS)
    )
    monkeypatch.setattr(
        meta_api_module,
        "build_authorization_url",
        lambda state: f"https://meta.example/{state}",
    )
    monkeypatch.setattr(
        meta_api_module,
        "exchange_code_for_token",
        AsyncMock(return_value="short-token"),
    )
    monkeypatch.setattr(
        meta_api_module,
        "get_long_lived_token",
        AsyncMock(return_value=("long-token", datetime.now(UTC) + timedelta(days=60))),
    )
    monkeypatch.setattr(
        meta_api_module, "get_meta_user_id", AsyncMock(return_value="meta-user-1")
    )

    create_campaign = AsyncMock(return_value="meta_campaign_1")
    monkeypatch.setattr(meta_service_module, "create_meta_campaign", create_campaign)
    create_ad_set = AsyncMock(return_value="meta_adset_1")
    monkeypatch.setattr(meta_service_module, "create_meta_ad_set", create_ad_set)
    create_ad_creative = AsyncMock(return_value="meta_creative_1")
    monkeypatch.setattr(
        meta_service_module, "create_meta_ad_creative", create_ad_creative
    )
    create_ad = AsyncMock(return_value="meta_ad_1")
    monkeypatch.setattr(meta_service_module, "create_meta_ad", create_ad)

    return {
        "create_campaign": create_campaign,
        "create_ad_set": create_ad_set,
        "create_ad_creative": create_ad_creative,
        "create_ad": create_ad,
    }


def test_publish_requires_a_session(client: TestClient) -> None:
    """Publishing with no session cookie returns 401."""
    response = client.post("/businesses/some-id/campaigns/some-id/publish")

    assert response.status_code == 401


def test_publish_404s_for_a_nonexistent_campaign(client: TestClient) -> None:
    """Publishing a nonexistent campaign returns 404."""
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(
        f"/businesses/{business_id}/campaigns/does-not-exist/publish"
    )

    assert response.status_code == 404


def test_publish_404s_for_another_users_campaign(client: TestClient) -> None:
    """A user can't publish a campaign they don't own."""
    business_id, campaign_id = _ready_campaign(client)
    client.post("/auth/logout")

    _signed_up_client(client, email="mallory@example.com")
    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 404


def test_publish_400s_before_approval(client: TestClient) -> None:
    """A freshly created (DRAFT) campaign can't be published yet."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "approve" in response.json()["detail"].lower()


def test_publish_400s_without_meta_connected(client: TestClient) -> None:
    """An approved campaign with no Meta connection at all can't publish."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    campaign_id = _create_campaign(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "connect meta ads" in response.json()["detail"].lower()


def test_publish_400s_without_ad_account_and_page_selected(client: TestClient) -> None:
    """A Meta connection still pending (no ad account/Page chosen) can't publish."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    campaign_id = _create_campaign(client, business_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    connect_response = client.get(f"/businesses/{business_id}/meta/connect")
    state_id = connect_response.json()["authorizationUrl"].rsplit("/", 1)[-1]
    client.get(
        "/meta/callback",
        params={"code": "some-code", "state": state_id},
        follow_redirects=False,
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "connect meta ads" in response.json()["detail"].lower()


def test_publish_400s_without_a_destination_url(client: TestClient) -> None:
    """No product URL and no business website means nowhere for the ad to link."""
    business_id, campaign_id = _ready_campaign(client, with_destination_url=False)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "destination" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_publish_400s_without_a_selected_creative(client: TestClient) -> None:
    """Defense in depth: APPROVED with no SELECTED creative (shouldn't happen
    via normal flow — selecting is required to reach PENDING_APPROVAL, and
    regenerating creatives always resets status away from APPROVED) still
    fails closed rather than crashing.

    Uses a fresh Prisma() connection to desync the two tables directly,
    same reasoning as test_meta.py's no-organization test.
    """
    business_id, campaign_id = _ready_campaign(client)

    seeder = Prisma()
    await seeder.connect()
    await seeder.creative.update_many(
        where={"campaignId": campaign_id}, data={"status": "REJECTED"}
    )
    await seeder.disconnect()

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "select an ad creative" in response.json()["detail"].lower()


def test_publish_succeeds_and_marks_the_campaign_live(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A full success creates the campaign live on Meta and marks it LIVE."""
    business_id, campaign_id = _ready_campaign(client)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "LIVE"
    assert body["metaCampaignId"] == "meta_campaign_1"
    mock_services["create_campaign"].assert_awaited_once()
    mock_services["create_ad_set"].assert_awaited_once()
    mock_services["create_ad_creative"].assert_awaited_once()
    mock_services["create_ad"].assert_awaited_once()

    creatives = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    selected = next(c for c in creatives if c["status"] == "SELECTED")
    assert selected["adId"] is not None


def test_publish_uses_the_product_url_when_available(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign with a product uses the product's URL, not the business's."""
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id = _create_product(client, business_id, url="https://acme.example/rings")
    campaign_id = _create_campaign(client, business_id, product_id=product_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/strategy")
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creatives[0]['id']}/select"
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    _connect_meta(client, business_id)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    _args, kwargs = mock_services["create_ad_creative"].call_args
    assert kwargs["link"] == "https://acme.example/rings"


def test_publish_surfaces_meta_failures_as_500_and_marks_failed(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A Meta API failure becomes a clean 500 and moves the campaign to FAILED."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_campaign"].side_effect = MetaConnectionError(
        "Invalid OAuth access token"
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert "Invalid OAuth access token" in response.json()["detail"]

    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    assert campaigns[0]["status"] == "FAILED"


def test_publish_can_be_retried_after_a_failure(
    client: TestClient, mock_services: dict[str, AsyncMock]
) -> None:
    """A campaign that previously FAILED can be published again."""
    from app.services.meta import MetaConnectionError

    business_id, campaign_id = _ready_campaign(client)
    mock_services["create_campaign"].side_effect = MetaConnectionError("boom")
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")
    mock_services["create_campaign"].side_effect = None
    mock_services["create_campaign"].return_value = "meta_campaign_1"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"


def test_publish_400s_once_already_live(client: TestClient) -> None:
    """A campaign that's already LIVE can't be published again."""
    business_id, campaign_id = _ready_campaign(client)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
