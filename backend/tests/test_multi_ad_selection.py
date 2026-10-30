"""Selecting and publishing several ads (1-4) on a standard campaign.

A DATA_DRIVEN_STRATEGY campaign used to run exactly one ad: selecting one
rejected its siblings. Like a creative test, it now takes 1-4 selected ads:
selecting adds, deselecting removes, one ad is enough to approve, and publish
puts every selected ad into the campaign's one ad set. A TEST_PLAN (audience
test) keeps single-ad selection, and both its audience ad sets carry that ad.
"""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_test_plan_publish import _creative_plan_campaign
from tests.test_publish import (
    _connect_meta,
    _create_audience,
    _create_business,
    _create_product,
    _ready_campaign,
    _signed_up_client,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def _standard_campaign(
    client: TestClient, *, select: int, approve: bool = False
) -> tuple[str, str, list[str]]:
    """A DATA_DRIVEN_STRATEGY campaign with `select` ads selected.

    Returns:
        (business_id, campaign_id, selected_creative_ids).
    """
    _signed_up_client(client)
    business_id = _create_business(client, website="https://acme.example")
    product_id = _create_product(
        client, business_id, url="https://acme.example/product"
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


def _creatives(client: TestClient, business_id: str, campaign_id: str) -> list[Any]:
    return list(
        client.get(
            f"/businesses/{business_id}/campaigns/{campaign_id}/creatives"
        ).json()
    )


def _status(client: TestClient, business_id: str, campaign_id: str) -> str:
    campaigns = client.get(f"/businesses/{business_id}/campaigns").json()
    return str(next(c for c in campaigns if c["id"] == campaign_id)["status"])


def _select(client: TestClient, business_id: str, campaign_id: str, id_: str) -> Any:
    return client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{id_}/select"
    )


def _deselect(client: TestClient, business_id: str, campaign_id: str, id_: str) -> Any:
    return client.post(
        f"/businesses/{business_id}/campaigns/{campaign_id}/creatives/{id_}/deselect"
    )


# ── Selecting (additive) ─────────────────────────────────────


def test_selecting_a_second_ad_keeps_the_first_selected(client: TestClient) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=2)

    statuses = [c["status"] for c in _creatives(client, business_id, campaign_id)]

    assert statuses.count("SELECTED") == 2
    assert statuses.count("REJECTED") == 0


def test_all_four_ads_can_be_selected(client: TestClient) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=4)

    statuses = [c["status"] for c in _creatives(client, business_id, campaign_id)]

    assert statuses == ["SELECTED"] * 4


def test_one_selected_ad_is_enough_for_approval(client: TestClient) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=1)
    assert _status(client, business_id, campaign_id) == "PENDING_APPROVAL"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 200
    assert _status(client, business_id, campaign_id) == "APPROVED"


def test_a_fifth_ad_is_refused(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(creative_module, "MAX_CREATIVE_ANGLES", 2)
    business_id, campaign_id, _ = _standard_campaign(client, select=2)
    third = _creatives(client, business_id, campaign_id)[2]["id"]

    response = _select(client, business_id, campaign_id, third)

    assert response.status_code == 400
    assert "at most 2 ads" in response.json()["detail"]


def test_selecting_an_already_selected_ad_again_is_allowed_at_the_cap(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(creative_module, "MAX_CREATIVE_ANGLES", 2)
    business_id, campaign_id, selected = _standard_campaign(client, select=2)

    response = _select(client, business_id, campaign_id, selected[0])

    assert response.status_code == 200


# ── Deselecting ──────────────────────────────────────────────


def test_deselecting_one_of_two_keeps_the_campaign_ready(client: TestClient) -> None:
    business_id, campaign_id, selected = _standard_campaign(client, select=2)

    response = _deselect(client, business_id, campaign_id, selected[0])

    assert response.status_code == 200
    assert response.json()["status"] == "GENERATED"
    assert _status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_deselecting_the_last_ad_sends_the_campaign_back_to_choosing(
    client: TestClient,
) -> None:
    business_id, campaign_id, selected = _standard_campaign(client, select=1)

    _deselect(client, business_id, campaign_id, selected[0])

    assert _status(client, business_id, campaign_id) == "ADS_GENERATED"


def test_changing_the_ads_after_approval_requires_approving_again(
    client: TestClient,
) -> None:
    business_id, campaign_id, selected = _standard_campaign(
        client, select=2, approve=True
    )
    assert _status(client, business_id, campaign_id) == "APPROVED"

    _deselect(client, business_id, campaign_id, selected[1])

    assert _status(client, business_id, campaign_id) == "PENDING_APPROVAL"


def test_deselect_is_refused_for_an_audience_test(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )
    first = _creatives(client, business_id, campaign_id)[0]["id"]

    response = _deselect(client, business_id, campaign_id, first)

    assert response.status_code == 400


# ── The audience test keeps its single-ad rule ───────────────


def test_an_audience_test_still_selects_exclusively(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )
    first, second = [c["id"] for c in _creatives(client, business_id, campaign_id)[:2]]

    _select(client, business_id, campaign_id, second)

    by_id = {c["id"]: c["status"] for c in _creatives(client, business_id, campaign_id)}
    assert by_id[second] == "SELECTED"
    assert by_id[first] == "REJECTED"


# ── A creative test keeps its full set of ads ───────────────


def test_a_creative_test_with_one_ad_selected_is_not_ready_to_approve(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=1, approve=False
    )
    assert _status(client, business_id, campaign_id) == "ADS_GENERATED"

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/approve")

    assert response.status_code == 400


def test_a_creative_test_publish_still_needs_its_full_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, select=3, approve=True
    )
    assert _status(client, business_id, campaign_id) == "APPROVED"

    async def _drop_one() -> None:
        seeder = Prisma()
        await seeder.connect()
        try:
            one = await seeder.creative.find_first(
                where={"campaignId": campaign_id, "status": "SELECTED"}
            )
            assert one is not None
            await seeder.creative.update(
                where={"id": one.id}, data={"status": "GENERATED"}
            )
        finally:
            await seeder.disconnect()

    import asyncio

    asyncio.run(_drop_one())

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "needs" in response.json()["detail"]


# ── Publishing ───────────────────────────────────────────────


def test_publish_puts_every_selected_ad_in_the_one_ad_set(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _standard_campaign(
        client, select=3, approve=True
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    assert response.json()["status"] == "LIVE"
    mock_services["create_campaign"].assert_awaited_once()
    mock_services["create_ad_set"].assert_awaited_once()
    assert mock_services["create_ad_creative"].await_count == 3
    assert mock_services["create_ad"].await_count == 3
    assert {
        call.kwargs["meta_ad_set_id"]
        for call in mock_services["create_ad"].await_args_list
    } == {"meta_adset_1"}
    linked = [c for c in _creatives(client, business_id, campaign_id) if c["adId"]]
    assert sorted(c["id"] for c in linked) == sorted(selected)
    assert len({c["adId"] for c in linked}) == 3


@pytest.mark.asyncio
async def test_publish_records_one_ad_set_with_one_ad_per_selected_creative(
    client: TestClient,
) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=3, approve=True)
    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    reader = Prisma()
    await reader.connect()
    try:
        ad_sets = await reader.adset.find_many(
            where={"campaignId": campaign_id}, include={"ads": True}
        )
    finally:
        await reader.disconnect()

    assert len(ad_sets) == 1
    assert len(ad_sets[0].ads or []) == 3


def test_publish_with_one_ad_is_unchanged(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=1, approve=True)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200
    mock_services["create_ad_set"].assert_awaited_once()
    mock_services["create_ad_creative"].assert_awaited_once()
    mock_services["create_ad"].assert_awaited_once()


def test_publish_names_each_ad_after_its_own_headline(
    client: TestClient,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=2, approve=True)

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    names = {c.kwargs["name"] for c in mock_services["create_ad"].await_args_list}
    assert names == {"Headline A", "Headline B"}


def test_publish_refuses_ads_of_mixed_formats(client: TestClient) -> None:
    business_id, campaign_id, selected = _standard_campaign(
        client, select=2, approve=True
    )

    async def _mix() -> None:
        seeder = Prisma()
        await seeder.connect()
        try:
            await seeder.creative.update(
                where={"id": selected[1]}, data={"format": "SINGLE_VIDEO"}
            )
        finally:
            await seeder.disconnect()

    import asyncio

    asyncio.run(_mix())

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "same format" in response.json()["detail"]


def test_publish_refuses_when_one_selected_ad_is_stale(client: TestClient) -> None:
    business_id, campaign_id, _ = _standard_campaign(client, select=2, approve=True)
    product_id = client.get(f"/businesses/{business_id}/campaigns").json()[0][
        "productId"
    ]
    client.patch(
        f"/businesses/{business_id}/products/{product_id}",
        json={"description": "A completely different item"},
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    assert "regenerate" in response.json()["detail"].lower()


# ── An audience test carries the same ad in both ad sets ─────


def test_an_audience_test_publishes_the_same_ad_in_both_ad_sets(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    mock_services["create_ad_set"].side_effect = ["meta_adset_a", "meta_adset_b"]
    mock_services["create_ad"].side_effect = ["meta_ad_a", "meta_ad_b"]
    business_id, campaign_id = _ready_campaign(
        client, monkeypatch=monkeypatch, test_plan=True
    )

    client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert mock_services["create_ad_creative"].await_count == 1
    creative_ids = {
        call.kwargs["meta_creative_id"]
        for call in mock_services["create_ad"].await_args_list
    }
    assert creative_ids == {"meta_creative_1"}
    assert mock_services["create_ad"].await_count == 2
