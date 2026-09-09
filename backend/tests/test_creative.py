"""Tests for the Creative Agent endpoints.

generate_creatives (the actual LLM call) is mocked here — its own behavior
is covered by test_creative_service.py. These tests cover auth, ownership
scoping, the strategy dependency, storage, selection, and response shape.
"""

import struct
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import strategy as strategy_module
from app.schemas.creative import GeneratedCreativeVariant
from app.schemas.strategy import (
    BudgetRecommendation,
    DataDrivenStrategyContent,
    TargetAudience,
)
from fastapi.testclient import TestClient
from prisma import Prisma

_FAKE_STRATEGY = DataDrivenStrategyContent(
    objective="SALES",
    target_audience=TargetAudience(),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
    key_learnings=["Craftsmanship angle performed best"],
    recommended_adjustments=["Drop the price angle"],
    scaling_trigger="Increase budget once CAC stays under target",
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
    response = client.post(
        "/businesses", json={"name": name, "industry": "FASHION_JEWELRY"}
    )
    id_: str = response.json()["id"]
    return id_


def _create_audience(client: TestClient, business_id: str) -> str:
    """Create an audience, return its id."""
    response = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Busy professionals, 30-55"},
    )
    id_: str = response.json()["id"]
    return id_


def _valid_jpeg(width: int = 800, height: int = 800) -> bytes:
    """A structurally-valid minimal JPEG — real header, fake scan data.

    Needs to actually pass app/services/image_dimensions.py's parser (a
    real width/height, at least the 600px minimum) now that
    upload_product_image validates that, not just be any old bytes —
    see test_product_image.py for the same helper.
    """
    return (
        b"\xff\xd8"
        + b"\xff\xc0"
        + struct.pack(">H", 11)
        + bytes([8])
        + struct.pack(">HH", height, width)
        + bytes([1])
        + bytes([1, 0x11, 0])
        + b"\xff\xd9"
    )


def _create_campaign(
    client: TestClient,
    business_id: str,
    product_id: str | None = None,
    audience_id: str | None = None,
) -> str:
    """Create a campaign under a business, return its id.

    Auto-creates a default product/audience when not given one — every
    campaign needs both to generate a strategy now (readiness gate,
    app/services/campaign_readiness.py). The auto-created product also
    gets one default photo — select_creative now 428s a product with
    none at all (confirmed 2026-09-09), and most tests using this
    convenience helper don't care about photos, just about getting
    through select_creative to whatever they're actually testing.
    """
    if product_id is None:
        product_id = client.post(
            f"/businesses/{business_id}/products",
            json={"description": "Ring", "url": "https://acme.example/ring"},
        ).json()["id"]
        client.post(
            f"/businesses/{business_id}/products/{product_id}/images",
            files={"file": ("ring.jpg", _valid_jpeg(), "image/jpeg")},
        )
    if audience_id is None:
        audience_id = _create_audience(client, business_id)
    response = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    )
    id_: str = response.json()["id"]
    return id_


def _generate_strategy(client: TestClient, business_id: str, campaign_id: str) -> None:
    """Generate a strategy on a campaign (mocked in the strategy fixture)."""
    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
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


def test_select_creative_attaches_the_products_first_photo(
    client: TestClient,
) -> None:
    """Selecting a creative auto-attaches the campaign's product's oldest
    uploaded photo as imageUrl (PRD.md §2 step 4) — the natural checkpoint
    before publish."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    image = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("ring.jpg", _valid_jpeg(), "image/jpeg")},
    ).json()
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{generated[0]['id']}/select"
    )

    assert response.status_code == 200
    assert response.json()["imageUrl"] == (
        f"http://localhost:8000/product-images/{image['id']}"
    )


def test_select_creative_428s_for_a_product_with_no_uploaded_photos(
    client: TestClient,
) -> None:
    """Selecting a creative for a product with zero photos is rejected
    outright (confirmed 2026-09-09) — publishing image-less is no longer
    tolerated; the old behavior was to select with a null imageUrl."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{generated[0]['id']}/select"
    )

    assert response.status_code == 428
    assert "photo" in response.json()["detail"].lower()

    # Neither this creative nor any sibling was mutated — the whole
    # selection attempt is refused before any of that happens.
    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert all(c["status"] == "GENERATED" for c in listed)


def test_select_creative_attaches_an_explicitly_chosen_photo(
    client: TestClient,
) -> None:
    """A product_image_id in the request body wins over the oldest-photo
    default — the user explicitly picked which photo the ad should use."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    older_image = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("older.jpg", _valid_jpeg(), "image/jpeg")},
    ).json()
    chosen_image = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("chosen.jpg", _valid_jpeg(), "image/jpeg")},
    ).json()
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{generated[0]['id']}/select",
        json={"productImageId": chosen_image["id"]},
    )

    assert response.status_code == 200
    assert response.json()["imageUrl"] == (
        f"http://localhost:8000/product-images/{chosen_image['id']}"
    )
    assert older_image["id"] != chosen_image["id"]


def test_select_creative_404s_for_a_product_image_from_another_product(
    client: TestClient,
) -> None:
    """A product_image_id that doesn't belong to the campaign's product is
    rejected, not silently attached."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    # The campaign's own product needs at least one photo of its own too
    # — otherwise the no-photo-at-all 428 would fire first, before this
    # test ever reaches the check it's actually exercising.
    client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("ring.jpg", _valid_jpeg(), "image/jpeg")},
    )
    other_product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Necklace", "url": "https://acme.example/necklace"},
    ).json()["id"]
    other_image = client.post(
        f"/businesses/{business_id}/products/{other_product_id}/images",
        files={"file": ("necklace.jpg", _valid_jpeg(), "image/jpeg")},
    ).json()
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{generated[0]['id']}/select",
        json={"productImageId": other_image["id"]},
    )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_select_creative_428s_for_image_attach_when_not_ready(
    client: TestClient,
) -> None:
    """Defense in depth: attaching a specific photo requires the campaign
    to have a product and audience (shouldn't happen via normal flow —
    generating a strategy already requires readiness, PRD.md §5 step 4).

    Uses a fresh Prisma() connection to desync the fields directly after
    the fact, same reasoning as test_publish.py's forced-state
    defense-in-depth tests.
    """
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    image = client.post(
        f"/businesses/{business_id}/products/{product_id}/images",
        files={"file": ("ring.jpg", _valid_jpeg(), "image/jpeg")},
    ).json()
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "SALES", "productId": product_id, "audienceId": audience_id},
    ).json()["id"]
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    seeder = Prisma()
    await seeder.connect()
    await seeder.campaign.update(
        where={"id": campaign_id},
        data={"product": {"disconnect": True}, "audience": {"disconnect": True}},
    )
    await seeder.disconnect()

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{generated[0]['id']}/select",
        json={"productImageId": image["id"]},
    )

    assert response.status_code == 428
    assert "product" in response.json()["detail"].lower()
    assert "audience" in response.json()["detail"].lower()


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


def test_generated_creatives_are_not_stale(client: TestClient) -> None:
    """A freshly generated batch, grounded in the current product, isn't stale."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)

    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    assert all(c["isStale"] is False for c in generated)


def test_editing_the_product_description_marks_creatives_stale(
    client: TestClient,
) -> None:
    """Part 1 x Part 3: editing a product's description (PATCH) is a
    generation-worthy change, so creatives already generated for it read
    as stale afterward, without any explicit "mark stale" write —
    is_creative_stale just compares against the product's current state."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    campaign_id = _create_campaign(client, business_id, product_id=product_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert all(c["isStale"] is False for c in generated)

    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"description": "Necklace"},
    )

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert all(c["isStale"] is True for c in listed)


def test_regenerating_after_a_product_edit_clears_staleness(
    client: TestClient,
) -> None:
    """Calling the existing generation endpoint again re-snapshots the
    product, so the new batch isn't stale — this is the "Regenerate"
    button's entire mechanism, no separate un-stale step needed."""
    _signed_up_client(client)
    business_id = _create_business(client)
    product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    campaign_id = _create_campaign(client, business_id, product_id=product_id)
    _generate_strategy(client, business_id, campaign_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")
    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"description": "Necklace"},
    )

    regenerated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()

    assert all(c["isStale"] is False for c in regenerated)


def test_swapping_the_campaign_product_marks_creatives_stale(
    client: TestClient,
) -> None:
    """Part 2 x Part 3: swapping to a different product entirely also
    makes existing creatives stale, same mechanism as editing one."""
    _signed_up_client(client)
    business_id = _create_business(client)
    original_product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Ring", "url": "https://acme.example/ring"},
    ).json()["id"]
    other_product_id = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Necklace", "url": "https://acme.example/necklace"},
    ).json()["id"]
    campaign_id = _create_campaign(client, business_id, product_id=original_product_id)
    _generate_strategy(client, business_id, campaign_id)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")

    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}",
        json={"productId": other_product_id},
    )
    assert response.status_code == 200

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert len(listed) == 4  # old creatives kept for history, never deleted
    assert all(c["isStale"] is True for c in listed)


@pytest.mark.asyncio
async def test_editing_the_business_description_marks_creatives_stale(
    client: TestClient,
) -> None:
    """A business's own description is a third staleness source (confirmed
    2026-09-08), independent of the product — there's no PATCH endpoint for
    Business yet, so this seeds the change directly via Prisma, same
    "forced-state defense in depth" reasoning as
    test_select_creative_428s_for_image_attach_when_not_ready above."""
    _signed_up_client(client)
    business_id = _create_business(client)
    seeder = Prisma()
    await seeder.connect()
    await seeder.business.update(
        where={"id": business_id}, data={"description": "Family-run since 1985"}
    )
    await seeder.disconnect()
    campaign_id = _create_campaign(client, business_id)
    _generate_strategy(client, business_id, campaign_id)
    generated = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert all(c["isStale"] is False for c in generated)

    seeder = Prisma()
    await seeder.connect()
    await seeder.business.update(
        where={"id": business_id}, data={"description": "Now under new ownership"}
    )
    await seeder.disconnect()

    listed = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    assert all(c["isStale"] is True for c in listed)


def test_swapping_to_a_urlless_product_warns_on_sales(client: TestClient) -> None:
    """Swapping a SALES campaign onto a product with no destination URL
    never blocks — it warns via needsDestinationUrl instead."""
    _signed_up_client(client)
    business_id = _create_business(client)
    campaign_id = _create_campaign(client, business_id)
    urlless_product_id = client.post(
        f"/businesses/{business_id}/products", json={"description": "Necklace"}
    ).json()["id"]

    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}",
        json={"productId": urlless_product_id},
    )

    assert response.status_code == 200
    assert response.json()["needsDestinationUrl"] is True


def test_swapping_to_a_urlless_product_on_awareness_has_no_warning(
    client: TestClient,
) -> None:
    """AWARENESS doesn't need a click-through destination, so no warning."""
    _signed_up_client(client)
    business_id = _create_business(client)
    audience_id = _create_audience(client, business_id)
    campaign_id = client.post(
        f"/businesses/{business_id}/campaigns",
        json={"objective": "AWARENESS", "audienceId": audience_id},
    ).json()["id"]
    urlless_product_id = client.post(
        f"/businesses/{business_id}/products", json={"description": "Necklace"}
    ).json()["id"]

    response = client.patch(
        f"/businesses/{business_id}/campaigns/{campaign_id}",
        json={"productId": urlless_product_id},
    )

    assert response.status_code == 200
    assert response.json()["needsDestinationUrl"] is False
