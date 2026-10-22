"""Tests for selecting and publishing a CREATIVE_TEST_PLAN campaign.

A CREATIVE_TEST_PLAN publishes 3-4 selected creatives as separate ads inside
one ad set (broad Advantage+ audience, hard constraints only). The ad-set
payload shape is asserted here field by field — it's what gets reviewed
before a live paused test.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import strategy as strategy_module
from app.schemas.strategy import (
    AudienceConstraints,
    CreativePersona,
    CreativeTestPlanContent,
    NormalizedMetrics,
)
from app.services import locales as locales_module
from app.services import meta as meta_service_module
from app.services import strategist as strategist_module
from app.services.benchmarks import JEWELRY_META_BENCHMARKS
from app.services.meta import MetaConnectionError
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_publish import (
    _FAKE_VARIANTS,
    _connect_meta,
    _create_audience,
    _create_business,
    _create_product_with_photos,
    _signed_up_client,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def _kwargs(mock: AsyncMock) -> dict[str, Any]:
    """The keyword arguments of a mock's most recent awaited call."""
    assert mock.await_args is not None
    return dict(mock.await_args.kwargs)


def _creative_plan(**overrides: Any) -> CreativeTestPlanContent:
    benchmark_context = strategist_module._build_benchmark_context()
    fields: dict[str, Any] = {
        "objective": "SALES",
        "audience_constraints": AudienceConstraints(),
        "creative_persona": CreativePersona(name="Gift buyers", description="Women"),
        "hypotheses": [strategist_module._build_creative_hypothesis("A wins.")],
        "offer": "Offer",
        "positioning": "Positioning",
        "creative_angles": ["a", "b", "c", "d"],
        "copy_strategy": "Copy",
        "daily_budget": 50.0,
        "duration_days": 10,
        "total_budget": 500.0,
        "optimization_event": "PURCHASE",
        "success_criteria": strategist_module._build_creative_success_criteria(
            benchmark_context, None, None
        ),
        "baseline_metrics": NormalizedMetrics(),
        "benchmark_context": benchmark_context,
    }
    fields.update(overrides)
    return CreativeTestPlanContent(**fields)


@pytest.fixture(autouse=True)
def mock_locales(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    search = AsyncMock(return_value=[{"name": "English (All)", "key": 1001}])
    monkeypatch.setattr(locales_module, "search_ad_locales", search)
    return search


@pytest.fixture(autouse=True)
def mock_purchasers_audience(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    create = AsyncMock(return_value="aud_1")
    monkeypatch.setattr(meta_service_module, "create_purchasers_audience", create)
    return create


def _creative_plan_campaign(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    *,
    plan: CreativeTestPlanContent | None = None,
    select: int = 3,
    approve: bool = True,
    photo_count: int = 1,
) -> tuple[str, str, list[str]]:
    """A CREATIVE_TEST_PLAN campaign with `select` creatives selected.

    Returns:
        (business_id, campaign_id, selected_creative_ids).
    """
    monkeypatch.setattr(
        strategy_module,
        "generate_strategy",
        AsyncMock(return_value=plan or _creative_plan()),
    )
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id = _create_product_with_photos(
        client, business_id, url="https://acme.example/product", count=photo_count
    )
    audience_id = _create_audience(client, business_id)
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns",
        json={
            "objective": "SALES",
            "productId": product_id,
            "audienceId": audience_id,
        },
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": False},
    )
    creatives = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    ).json()
    selected = [c["id"] for c in creatives[:select]]
    for creative_id in selected:
        client.post(
            f"/businesses/{business_id}/campaigns/{campaign_id}"
            f"/creatives/{creative_id}/select"
        )
    if approve:
        client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")
    _connect_meta(client, business_id)
    return business_id, campaign_id, selected


def _campaign_status(client: TestClient, business_id: str, campaign_id: str) -> str:
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return str(next(c for c in campaigns if c["id"] == campaign_id)["status"])


def _creatives(client: TestClient, business_id: str, campaign_id: str) -> list[Any]:
    response = client.get(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
    )
    return list(response.json())


# ── Selecting (additive) ─────────────────────────────────────


def test_selecting_adds_to_the_test_without_rejecting_siblings(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=2, approve=False
    )

    statuses = [c["status"] for c in _creatives(client, business_id, campaign_id)]

    assert statuses.count("SELECTED") == 2
    assert statuses.count("REJECTED") == 0


def test_campaign_waits_for_three_selected_before_pending_approval(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=2, approve=False
    )
    assert _campaign_status(client, business_id, campaign_id) == "ADS_GENERATED"

    third = _creatives(client, business_id, campaign_id)[2]["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{third}/select"
    )

    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_cannot_approve_with_fewer_than_three_selected(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=2, approve=False
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 400


def test_deselecting_removes_an_ad_and_drops_back_below_the_minimum(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False
    )
    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{selected[0]}/deselect"
    )

    assert response.status_code == 200
    assert response.json()["status"] == "GENERATED"
    assert _campaign_status(client, business_id, campaign_id) == "ADS_GENERATED"


def test_deselecting_after_approval_requires_approving_again(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=4, approve=True
    )
    assert _campaign_status(client, business_id, campaign_id) == "APPROVED"

    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{selected[0]}/deselect"
    )

    # Still three ads selected, but the approved content changed.
    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_deselect_404s_for_an_unknown_creative(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/nope/deselect"
    )

    assert response.status_code == 404


def test_deselect_is_only_for_a_creative_test_plan(client: TestClient) -> None:
    """The original single-ad flow is unchanged: no deselect for it."""
    business_id, campaign_id, _ = _legacy_selected_campaign(client)
    creative_id = _creatives(client, business_id, campaign_id)[0]["id"]

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}"
        f"/creatives/{creative_id}/deselect"
    )

    assert response.status_code == 400


def _legacy_selected_campaign(client: TestClient) -> tuple[str, str, str]:
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id = _create_product_with_photos(
        client, business_id, url="https://acme.example/product", count=1
    )
    audience_id = _create_audience(client, business_id)
    campaign_id: str = client.post(
        f"/businesses/{business_id}/campaigns",
        json={
            "objective": "SALES",
            "productId": product_id,
            "audienceId": audience_id,
        },
    ).json()["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/creatives")
    first = _creatives(client, business_id, campaign_id)[0]["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{first}/select"
    )
    return business_id, campaign_id, first


def test_a_legacy_campaign_still_selects_exclusively(client: TestClient) -> None:
    business_id, campaign_id, first = _legacy_selected_campaign(client)
    second = _creatives(client, business_id, campaign_id)[1]["id"]

    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{second}/select"
    )

    by_id = {c["id"]: c["status"] for c in _creatives(client, business_id, campaign_id)}
    assert by_id[second] == "SELECTED"
    assert by_id[first] == "REJECTED"


def test_a_creative_test_plan_only_generates_single_image_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """V1 is SINGLE_IMAGE only: a carousel request is refused up front."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=0, approve=False, photo_count=3
    )

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives",
        json={"format": "CAROUSEL"},
    )

    assert response.status_code == 400
    assert "single-image" in response.json()["detail"].lower()


# ── Publishing: one ad set, 3-4 ads ──────────────────────────


def test_publish_creates_one_ad_set_with_one_ad_per_selected_creative(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"
    mock_services["create_campaign"].assert_awaited_once()
    mock_services["create_ad_set"].assert_awaited_once()
    assert mock_services["create_ad_creative"].await_count == 3
    assert mock_services["create_ad"].await_count == 3
    ad_set_ids = {
        call.kwargs["meta_ad_set_id"]
        for call in mock_services["create_ad"].await_args_list
    }
    assert ad_set_ids == {"meta_adset_1"}
    # Each selected creative is linked to its own ad.
    linked = [c for c in _creatives(client, business_id, campaign_id) if c["adId"]]
    assert sorted(c["id"] for c in linked) == sorted(selected)
    assert len({c["adId"] for c in linked}) == 3


def test_every_ad_of_a_creative_test_carries_the_linked_instagram_account(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    from app.api import meta as meta_api_module

    monkeypatch.setattr(
        meta_api_module,
        "fetch_page_instagram_account",
        AsyncMock(return_value="ig_venzi"),
    )
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch, select=3)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    creatives = mock_services["create_ad_creative"].await_args_list
    assert len(creatives) == 3
    assert {c.kwargs["instagram_user_id"] for c in creatives} == {"ig_venzi"}


def test_publish_sends_the_expected_ad_set_payload_for_a_purchase_plan(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["advantage_audience"] == 1
    assert kwargs["age_min"] == 18
    assert kwargs["age_max"] is None
    assert kwargs["locales"] == [1001]
    assert kwargs["interests"] is None
    assert kwargs["resolved_locations"] is None
    assert kwargs["custom_location"] is None
    assert kwargs["optimization_goal"] == "OFFSITE_CONVERSIONS"
    assert kwargs["custom_event_type"] == "PURCHASE"
    assert kwargs["pixel_id"] == "pixel_1"
    assert kwargs["daily_budget_cents"] == 5000
    # Cost cap = the target CAC (benchmark median when no unit economics).
    assert kwargs["target_cac_cents"] == round(JEWELRY_META_BENCHMARKS.cac.median * 100)
    assert kwargs["end_time"] is not None
    assert kwargs["status"] == "ACTIVE"


def test_publish_caps_an_add_to_cart_plan_at_its_cost_per_add_to_cart(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    plan = _creative_plan(
        optimization_event="ADD_TO_CART", target_cost_per_add_to_cart=12.34
    )
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=plan
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["custom_event_type"] == "ADD_TO_CART"
    assert kwargs["target_cac_cents"] == 1234


def test_publish_uses_the_plans_languages(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    mock_locales: AsyncMock,
) -> None:
    plan = _creative_plan(
        audience_constraints=AudienceConstraints(languages=["Spanish", "English"])
    )
    mock_locales.side_effect = [
        [{"name": "Spanish (All)", "key": 1002}],
        [{"name": "English (All)", "key": 1001}],
    ]
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=plan
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert _kwargs(mock_services["create_ad_set"])["locales"] == [1002, 1001]


def test_publish_paused_creates_everything_paused(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    response = client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/publish",
        json={"paused": True},
    )

    assert response.json()["status"] == "PAUSED"
    assert _kwargs(mock_services["create_campaign"])["status"] == "PAUSED"
    assert _kwargs(mock_services["create_ad_set"])["status"] == "PAUSED"
    for call in mock_services["create_ad"].await_args_list:
        assert call.kwargs["status"] == "PAUSED"


@pytest.mark.asyncio
async def test_publish_records_one_ad_set_and_the_ads_locally(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch, select=4)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    seeder = Prisma()
    await seeder.connect()
    try:
        ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
        ads = await seeder.ad.find_many(where={"adSetId": ad_sets[0].id})
    finally:
        await seeder.disconnect()

    assert len(ad_sets) == 1
    assert ad_sets[0].budget == 50.0
    assert ad_sets[0].variantId is None
    assert len(ads) == 4


def test_publish_fails_clearly_when_a_language_has_no_meta_locale(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    mock_locales: AsyncMock,
) -> None:
    mock_locales.return_value = []
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 500
    assert "English" in response.json()["detail"]
    assert _campaign_status(client, business_id, campaign_id) == "FAILED"
    mock_services["create_ad_set"].assert_not_awaited()


def test_publish_400s_when_a_selected_creative_is_stale(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    product_id = client.get(f"/businesses/{business_id}/campaigns").json()[0][
        "productId"
    ]
    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"description": "A completely different item"},
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400


# ── Pre-publish copy guard ───────────────────────────────────

_SHOP_THE_COPY = (
    "18K gold, natural gemstones, and ceramic — hand-shaped into bold form.\n"
    "Handcrafted in small batches in New York.\nShop the"
)


async def _set_body_text(creative_id: str, text: str) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.creative.update(where={"id": creative_id}, data={"bodyText": text})
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_publish_refuses_a_creative_whose_copy_is_cut_off(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """One cut-off ad among three blocks the whole publish, and the error
    names that ad so it can be fixed."""
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)
    await _set_body_text(selected[1], _SHOP_THE_COPY)
    bad = next(
        c
        for c in _creatives(client, business_id, campaign_id)
        if c["id"] == selected[1]
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert f"'{bad['headline']}'" in detail
    assert "must end with a complete sentence" in detail
    assert "'Shop the'" in detail
    mock_services["create_campaign"].assert_not_awaited()
    mock_services["create_ad_set"].assert_not_awaited()


@pytest.mark.asyncio
async def test_publish_refuses_primary_text_over_the_limit(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)
    await _set_body_text(selected[0], "a" * 130 + ".")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "max 125" in response.json()["detail"]
    mock_services["create_campaign"].assert_not_awaited()


# ── Four ads, three for a thin product ───────────────────────


def test_a_product_with_four_photos_needs_all_four_ads_before_approval(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False, photo_count=4
    )
    assert _campaign_status(client, business_id, campaign_id) == "ADS_GENERATED"

    fourth = _creatives(client, business_id, campaign_id)[3]["id"]
    client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{fourth}/select"
    )

    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_a_product_without_a_fourth_photo_is_ready_at_three_ads(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=False, photo_count=3
    )

    assert _campaign_status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_the_strategy_says_how_many_ads_the_test_needs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    thin, thin_campaign, _ = _creative_plan_campaign(
        client, monkeypatch, select=0, approve=False, photo_count=3
    )
    thin_needed = client.get(
        f"/businesses/{thin}/campaigns/{thin_campaign}/strategy"
    ).json()["requiredTestAds"]

    full, full_campaign, _ = _creative_plan_campaign(
        client, monkeypatch, select=0, approve=False, photo_count=4
    )
    full_needed = client.get(
        f"/businesses/{full}/campaigns/{full_campaign}/strategy"
    ).json()["requiredTestAds"]

    assert (thin_needed, full_needed) == (3, 4)


@pytest.mark.asyncio
async def test_publish_refuses_a_test_that_gained_a_photo_after_approval(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """Approved at three ads for a three-photo product, then a fourth photo is
    added: the test now needs four, and publish says so."""
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, photo_count=3
    )
    seeder = Prisma()
    await seeder.connect()
    try:
        campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
        assert campaign is not None and campaign.productId is not None
        photo = await seeder.productimage.find_first(
            where={"productId": campaign.productId}
        )
        assert photo is not None
        await seeder.productimage.create(
            data={
                "productId": campaign.productId,
                "data": photo.data,
                "contentType": photo.contentType,
                "position": 9,
                "mediaType": "IMAGE",
            }
        )
    finally:
        await seeder.disconnect()

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "needs 4 selected ads" in response.json()["detail"]
    mock_services["create_campaign"].assert_not_awaited()


# ── No cost cap on a first test ──────────────────────────────


def test_a_creative_test_asks_for_7_day_click_1_day_engaged_and_1_day_view(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    spec = _kwargs(mock_services["create_ad_set"])["attribution_spec"]
    assert [(w["event_type"], w["window_days"]) for w in spec] == [
        ("CLICK_THROUGH", 7),
        ("ENGAGED_VIDEO_VIEW", 1),
        ("VIEW_THROUGH", 1),
    ]


def test_a_first_test_bids_for_the_lowest_cost_with_no_cap(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    plan = _creative_plan(bid_strategy="LOWEST_COST")
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=plan
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert _kwargs(mock_services["create_ad_set"])["target_cac_cents"] is None


def test_a_first_add_to_cart_test_also_has_no_cap(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    plan = _creative_plan(
        bid_strategy="LOWEST_COST",
        optimization_event="ADD_TO_CART",
        target_cost_per_add_to_cart=12.34,
    )
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=plan
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    kwargs = _kwargs(mock_services["create_ad_set"])
    assert kwargs["custom_event_type"] == "ADD_TO_CART"
    assert kwargs["target_cac_cents"] is None


def test_a_plan_stored_before_the_change_keeps_its_cap(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert _kwargs(mock_services["create_ad_set"])["target_cac_cents"] is not None


# ── 180-day purchasers excluded ──────────────────────────────


@pytest.mark.asyncio
async def test_publish_excludes_the_pixels_recent_purchasers_and_remembers_them(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    mock_purchasers_audience: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert _kwargs(mock_services["create_ad_set"])["excluded_custom_audience_ids"] == [
        "aud_1"
    ]
    audience_kwargs = _kwargs(mock_purchasers_audience)
    assert audience_kwargs["pixel_id"] == "pixel_1"
    assert audience_kwargs["ad_account_id"] == "act_1"
    seeder = Prisma()
    await seeder.connect()
    try:
        connection = await seeder.metaconnection.find_first()
        assert connection is not None
        assert connection.purchasersAudienceId == "aud_1"
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_a_remembered_audience_is_reused_not_created_again(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    mock_purchasers_audience: AsyncMock,
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    seeder = Prisma()
    await seeder.connect()
    try:
        await seeder.metaconnection.update_many(
            where={}, data={"purchasersAudienceId": "aud_existing"}
        )
    finally:
        await seeder.disconnect()

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    mock_purchasers_audience.assert_not_awaited()
    assert _kwargs(mock_services["create_ad_set"])["excluded_custom_audience_ids"] == [
        "aud_existing"
    ]


def test_publish_goes_ahead_without_the_exclusion_when_meta_refuses_the_audience(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    mock_purchasers_audience: AsyncMock,
    caplog: pytest.LogCaptureFixture,
) -> None:
    mock_purchasers_audience.side_effect = MetaConnectionError(
        "Custom audience terms not accepted", code=2655
    )
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)

    with caplog.at_level("WARNING"):
        response = client.post(
            f"/businesses/{business_id}/campaigns/{campaign_id}/publish"
        )

    assert response.status_code == 200
    assert (
        _kwargs(mock_services["create_ad_set"])["excluded_custom_audience_ids"] is None
    )
    assert "without the purchasers exclusion" in caplog.text


@pytest.mark.asyncio
async def test_a_connection_with_no_pixel_has_no_purchasers_to_exclude() -> None:
    from types import SimpleNamespace
    from typing import cast

    from app.services import publish as publish_module
    from prisma.models import MetaConnection

    connection = cast(MetaConnection, SimpleNamespace(pixelId=None))

    assert await publish_module._purchasers_audience_id(connection) is None


# ── Ad names and UTM parameters from avatar x concept ────────


async def _set_angles(
    campaign_id: str, angles: list[tuple[str | None, str | None]]
) -> None:
    seeder = Prisma()
    await seeder.connect()
    try:
        creatives = await seeder.creative.find_many(
            where={"campaignId": campaign_id, "status": "SELECTED"},
            order={"createdAt": "asc"},
        )
        for creative, (avatar, concept) in zip(creatives, angles, strict=True):
            await seeder.creative.update(
                where={"id": creative.id}, data={"avatar": avatar, "concept": concept}
            )
    finally:
        await seeder.disconnect()


@pytest.mark.asyncio
async def test_each_ad_is_named_and_tagged_from_its_avatar_and_concept(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(client, monkeypatch)
    await _set_angles(
        campaign_id,
        [
            ("self_purchaser", "everyday-wear"),
            ("gift_buyer", "social-proof"),
            (None, None),
        ],
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    ad_names = [c.kwargs["name"] for c in mock_services["create_ad"].await_args_list]
    assert ad_names[0] == "Self-purchaser – Everyday wear"
    assert ad_names[1] == "Gift buyer – Social proof"
    assert ad_names[2] not in {ad_names[0], ad_names[1]}  # an older ad: its headline
    tags = [
        c.kwargs["url_tags"]
        for c in mock_services["create_ad_creative"].await_args_list
    ]
    assert "utm_source=paid_social" in tags[0]
    assert "utm_medium=self-purchaser-everyday-wear" in tags[0]
    assert "utm_medium=gift-buyer-social-proof" in tags[1]
    assert "utm_medium=paid&" in tags[2]
    assert "utm_content=Self-purchaser%20%E2%80%93%20Everyday%20wear" in tags[0]
    assert "utm_campaign=" in tags[0]
    # The same names are what the app records locally.
    seeder = Prisma()
    await seeder.connect()
    try:
        ads = await seeder.ad.find_many(order={"createdAt": "asc"})
    finally:
        await seeder.disconnect()
    assert [a.name for a in ads][:2] == ad_names[:2]


# ── Generating: each ad carries its avatar and concept ───────


@pytest.mark.asyncio
async def test_generating_stores_each_ads_avatar_and_concept(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    from app.api import creative as creative_module
    from app.schemas.strategy import CreativeAngle
    from app.services.creative import apply_plan_angles

    plan = _creative_plan(
        creative_angles=[
            CreativeAngle(
                avatar="self_purchaser", concept="everyday-wear", description="a"
            ),
            CreativeAngle(
                avatar="self_purchaser", concept="craftsmanship", description="b"
            ),
            CreativeAngle(
                avatar="gift_buyer", concept="the-perfect-gift", description="c"
            ),
            CreativeAngle(avatar="gift_buyer", concept="social-proof", description="d"),
        ]
    )
    variants = apply_plan_angles(list(_FAKE_VARIANTS), plan)
    monkeypatch.setattr(
        creative_module, "generate_creatives", AsyncMock(return_value=variants)
    )
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=plan, select=0, approve=False
    )

    seeder = Prisma()
    await seeder.connect()
    try:
        rows = await seeder.creative.find_many(
            where={"campaignId": campaign_id}, order={"createdAt": "asc"}
        )
    finally:
        await seeder.disconnect()

    assert [(r.avatar, r.concept) for r in rows] == [
        ("self_purchaser", "everyday-wear"),
        ("self_purchaser", "craftsmanship"),
        ("gift_buyer", "the-perfect-gift"),
        ("gift_buyer", "social-proof"),
    ]
    assert rows[0].creativeAngle == "Self-purchaser – Everyday wear"


@pytest.mark.asyncio
async def test_an_older_plan_leaves_avatar_and_concept_empty(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=0, approve=False
    )

    seeder = Prisma()
    await seeder.connect()
    try:
        rows = await seeder.creative.find_many(where={"campaignId": campaign_id})
    finally:
        await seeder.disconnect()

    assert rows and all(r.avatar is None and r.concept is None for r in rows)
