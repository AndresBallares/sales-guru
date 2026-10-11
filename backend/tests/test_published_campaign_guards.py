"""A published campaign's ads and status can't be changed (app/core/published_guard.py).

Published means it has a Meta campaign id, in any status. Every action that would
delete or replace the local creative rows behind ads on Meta, or move the campaign
back to a pre-publish status, is refused with a clear message, and nothing changes.
"""

from dataclasses import dataclass
from typing import Any, cast
from unittest.mock import AsyncMock

import pytest
from app.core.published_guard import (
    ADS_LOCKED,
    ALREADY_PUBLISHED,
    ensure_not_published,
    is_published,
)
from fastapi import HTTPException
from fastapi.testclient import TestClient
from prisma import Prisma
from prisma.models import Campaign

from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    _ready_campaign,
    _ready_carousel_campaign,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

PUBLISHED_STATUSES = ["LIVE", "PAUSED", "ARCHIVED"]
# What an old bug could leave a published campaign in.
RESET_STATUSES = [
    "STRATEGY_GENERATED",
    "ADS_GENERATED",
    "PENDING_APPROVAL",
    "APPROVED",
    "FAILED",
]


@dataclass
class Published:
    business_id: str
    campaign_id: str
    campaign_url: str


async def _publish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
    status: str,
) -> Published:
    """A published campaign of `kind` (standard, test, carousel) now in `status`."""
    if kind == "test":
        business_id, campaign_id, _ = _creative_plan_campaign(
            client, monkeypatch, select=3
        )
    elif kind == "carousel":
        business_id, campaign_id = _ready_carousel_campaign(client, monkeypatch)
    else:
        business_id, campaign_id = _ready_campaign(client)
    url = f"/businesses/{business_id}/campaigns/{campaign_id}"
    response = client.post(f"{url}/publish", json={"paused": status == "PAUSED"})
    assert response.status_code == 200, response.text
    if status not in ("LIVE", "PAUSED"):
        seeder = Prisma()
        await seeder.connect()
        await seeder.campaign.update(where={"id": campaign_id}, data={"status": status})
        await seeder.disconnect()
    return Published(business_id, campaign_id, url)


async def _snapshot(campaign_id: str) -> dict[str, Any]:
    """Everything an action must leave alone: the campaign's status and links, its
    creative rows (and their cards), and the ads they sit behind."""
    seeder = Prisma()
    await seeder.connect()
    try:
        campaign = await seeder.campaign.find_unique(where={"id": campaign_id})
        assert campaign is not None
        creatives = await seeder.creative.find_many(
            where={"campaignId": campaign_id},
            order={"id": "asc"},
            include={"cards": {"order_by": {"position": "asc"}}},
        )
        ad_sets = await seeder.adset.find_many(where={"campaignId": campaign_id})
        ads = await seeder.ad.find_many(
            where={"adSetId": {"in": [a.id for a in ad_sets]}}, order={"id": "asc"}
        )
        return {
            "campaign": (
                campaign.status,
                campaign.metaCampaignId,
                campaign.productId,
                campaign.audienceId,
            ),
            "creatives": [
                (
                    c.id,
                    c.status,
                    c.headline,
                    c.bodyText,
                    c.description,
                    c.imageUrl,
                    c.productImageId,
                    c.storyProductImageId,
                    c.squareProductImageId,
                    c.adId,
                    c.format,
                    [(card.id, card.position, card.imageUrl) for card in c.cards or []],
                )
                for c in creatives
            ],
            "ads": [(a.id, a.status, a.metaAdId) for a in ads],
        }
    finally:
        await seeder.disconnect()


async def _creative_ids(campaign_id: str) -> dict[str, Any]:
    """One selected creative, one not selected, and a carousel card, if any."""
    seeder = Prisma()
    await seeder.connect()
    try:
        creatives = await seeder.creative.find_many(
            where={"campaignId": campaign_id},
            order={"id": "asc"},
            include={"cards": {"order_by": {"position": "asc"}}},
        )
        selected = next(c for c in creatives if c.status == "SELECTED")
        other = next((c for c in creatives if c.status != "SELECTED"), selected)
        cards = list(selected.cards or [])
        return {
            "selected": selected.id,
            "other": other.id,
            "card": cards[0].id if cards else "none",
            "card_ids": [c.id for c in cards],
        }
    finally:
        await seeder.disconnect()


@dataclass
class Case:
    name: str
    kind: str  # standard | test | carousel
    method: str
    path: str  # may use {selected} {other} {card}
    body: Any = None
    message: str = ADS_LOCKED
    needs_second_product: bool = False
    needs_second_audience: bool = False


CASES = [
    Case("regenerate ads", "standard", "POST", "/creatives"),
    Case(
        "regenerate with brand voice, as a carousel",
        "standard",
        "POST",
        "/creatives",
        {"format": "CAROUSEL"},
    ),
    Case("choose a different ad", "standard", "POST", "/creatives/{other}/select"),
    Case("select an ad in a test", "test", "POST", "/creatives/{other}/select"),
    Case("remove an ad from a test", "test", "POST", "/creatives/{selected}/deselect"),
    Case("deselect (not a test)", "standard", "POST", "/creatives/{selected}/deselect"),
    Case(
        "change the image",
        "standard",
        "PUT",
        "/creatives/{selected}/image",
        {"productImageId": "any"},
    ),
    Case(
        "change the Stories asset",
        "standard",
        "PUT",
        "/creatives/{selected}/story-asset",
        {"productImageId": None},
    ),
    Case(
        "change the Square asset",
        "standard",
        "PUT",
        "/creatives/{selected}/square-asset",
        {"productImageId": None},
    ),
    Case(
        "regenerate one ad's copy",
        "standard",
        "POST",
        "/creatives/{selected}/regenerate",
        {"fields": ["headline"]},
    ),
    Case(
        "reorder carousel cards",
        "carousel",
        "PUT",
        "/creatives/{selected}/cards/order",
        {"cardIds": "REVERSED"},
    ),
    Case(
        "remove a carousel card",
        "carousel",
        "DELETE",
        "/creatives/{selected}/cards/{card}",
    ),
    Case("change the product", "standard", "PATCH", "", {"productId": "SECOND"}),
    Case("change the audience", "standard", "PATCH", "", {"audienceId": "SECOND"}),
    Case(
        "approve",
        "standard",
        "POST",
        "/approve",
        message=ALREADY_PUBLISHED,
    ),
    Case(
        "publish again",
        "standard",
        "POST",
        "/publish",
        {"paused": True},
        message=ALREADY_PUBLISHED,
    ),
]
CASE_IDS = [c.name for c in CASES]


async def _second_product_and_audience(
    client: TestClient, business_id: str
) -> dict[str, str]:
    product = client.post(
        f"/businesses/{business_id}/products",
        json={"description": "Another ring", "url": "https://acme.example/other"},
    )
    audience = client.post(
        f"/businesses/{business_id}/audiences",
        json={"description": "Gift buyers, 25-40"},
    )
    return {"product": product.json()["id"], "audience": audience.json()["id"]}


async def _attempt(
    client: TestClient,
    published: Published,
    case: Case,
    ids: dict[str, Any],
    second: dict[str, str],
) -> Any:
    path = case.path.format(
        selected=ids["selected"], other=ids["other"], card=ids["card"]
    )
    body = case.body
    if isinstance(body, dict):
        body = {
            k: (
                list(reversed(ids["card_ids"]))
                if v == "REVERSED"
                else second["product"]
                if v == "SECOND" and k == "productId"
                else second["audience"]
                if v == "SECOND"
                else v
            )
            for k, v in body.items()
        }
    return client.request(case.method, published.campaign_url + path, json=body)


def _creative_generator_calls() -> int:
    from app.api import creative as creative_module

    generate = getattr(creative_module, "generate_creatives", None)
    return generate.await_count if isinstance(generate, AsyncMock) else 0


@pytest.mark.asyncio
@pytest.mark.parametrize("status", PUBLISHED_STATUSES)
@pytest.mark.parametrize("case", CASES, ids=CASE_IDS)
async def test_a_published_campaign_refuses_the_action_and_nothing_changes(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    case: Case,
    status: str,
) -> None:
    published = await _publish(client, monkeypatch, case.kind, status)
    ids = await _creative_ids(published.campaign_id)
    second = await _second_product_and_audience(client, published.business_id)
    before = await _snapshot(published.campaign_id)
    created_on_meta = (
        mock_services["create_campaign"].await_count,
        mock_services["create_ad_set"].await_count,
        mock_services["create_ad"].await_count,
    )
    generated = _creative_generator_calls()

    response = await _attempt(client, published, case, ids, second)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == case.message
    # The local rows behind the ads on Meta and the campaign's status are untouched.
    assert await _snapshot(published.campaign_id) == before
    # Nothing was created on Meta, and no new ad copy was generated.
    assert (
        mock_services["create_campaign"].await_count,
        mock_services["create_ad_set"].await_count,
        mock_services["create_ad"].await_count,
    ) == created_on_meta
    assert _creative_generator_calls() == generated


# What an old bug could leave a published campaign in: not LIVE/PAUSED/ARCHIVED but
# a pre-publish status, with the Meta id still set. It is published all the same.
RESET_CASES = [
    c
    for c in CASES
    if c.name
    in {
        "regenerate ads",
        "choose a different ad",
        "select an ad in a test",
        "approve",
        "publish again",
        "change the product",
    }
]


@pytest.mark.asyncio
@pytest.mark.parametrize("status", RESET_STATUSES)
@pytest.mark.parametrize("case", RESET_CASES, ids=[c.name for c in RESET_CASES])
async def test_a_campaign_with_a_meta_id_is_published_whatever_its_status_says(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    case: Case,
    status: str,
) -> None:
    published = await _publish(client, monkeypatch, case.kind, status)
    ids = await _creative_ids(published.campaign_id)
    second = await _second_product_and_audience(client, published.business_id)
    before = await _snapshot(published.campaign_id)

    response = await _attempt(client, published, case, ids, second)

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == case.message
    assert await _snapshot(published.campaign_id) == before
    assert mock_services["create_campaign"].await_count == 1  # published once only


@pytest.mark.asyncio
@pytest.mark.parametrize("status", PUBLISHED_STATUSES)
async def test_regenerating_the_strategy_is_refused_for_a_published_campaign(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    status: str,
) -> None:
    published = await _publish(client, monkeypatch, "standard", status)
    before = await _snapshot(published.campaign_id)

    response = client.post(
        f"{published.campaign_url}/strategy",
        json={"hasPriorAdvertisingExperience": True},
    )

    assert response.status_code == 400
    assert "already published" in response.json()["detail"]
    assert await _snapshot(published.campaign_id) == before


# ── What a published campaign still allows ───────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("status", PUBLISHED_STATUSES)
async def test_editing_the_product_record_itself_is_still_allowed(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    status: str,
) -> None:
    """Editing the product (not swapping it onto the campaign) touches no campaign
    row and nothing on Meta; at most the ads read as stale."""
    published = await _publish(client, monkeypatch, "standard", status)
    seeder = Prisma()
    await seeder.connect()
    campaign = await seeder.campaign.find_unique(where={"id": published.campaign_id})
    await seeder.disconnect()
    assert campaign is not None and campaign.productId is not None
    before = await _snapshot(published.campaign_id)

    response = client.patch(
        f"/businesses/{published.business_id}/products/{campaign.productId}",
        json={"description": "A slightly better description"},
    )

    assert response.status_code == 200
    assert await _snapshot(published.campaign_id) == before


@pytest.mark.asyncio
async def test_a_campaign_that_is_not_published_can_still_change_its_ads(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """The guard is for published campaigns only."""
    business_id, campaign_id = _ready_campaign(client)
    url = f"/businesses/{business_id}/campaigns/{campaign_id}"

    assert client.post(f"{url}/creatives").status_code == 201
    other = next(
        c for c in client.get(f"{url}/creatives").json() if c["status"] != "SELECTED"
    )
    assert client.post(f"{url}/creatives/{other['id']}/select").status_code == 200


# ── The guard itself ─────────────────────────────────────────


class _Campaign:
    def __init__(self, meta_id: str | None) -> None:
        self.id = "c1"
        self.metaCampaignId = meta_id


def test_is_published_means_a_meta_campaign_id() -> None:
    assert is_published(cast(Campaign, _Campaign("123"))) is True
    assert is_published(cast(Campaign, _Campaign(None))) is False


@pytest.mark.asyncio
async def test_the_guard_sees_a_publish_that_finished_after_the_request_began(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    """The guard re-reads the campaign, so a request holding a stale copy (no Meta
    id yet) is still refused once the publish has completed."""
    business_id, campaign_id = _ready_campaign(client)
    seeder = Prisma()
    await seeder.connect()
    stale = await seeder.campaign.find_unique(where={"id": campaign_id})
    await seeder.campaign.update(
        where={"id": campaign_id}, data={"metaCampaignId": "meta_1"}
    )
    await seeder.disconnect()
    assert stale is not None and stale.metaCampaignId is None
    assert client.portal is not None

    async def check() -> None:
        await ensure_not_published(stale)

    with pytest.raises(HTTPException) as refused:
        client.portal.call(check)

    assert refused.value.status_code == 400
    assert refused.value.detail == ADS_LOCKED
