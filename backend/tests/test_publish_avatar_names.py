"""Publishing a creative test names its ads with the avatar slug (Phase 6).

Driven through the real publish endpoint with the Meta calls mocked, as in
test_creative_test_plan_publish.py. Only creatives that carry a buyerAvatarId get
a slug; everything else is named exactly as before.
"""

from typing import Any
from unittest.mock import AsyncMock
from urllib.parse import parse_qs

import pytest
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

_ANGLES = [
    ("self_purchaser", "ceramic-inlay", "mechanism", "The Promotion Ring Buyer"),
    ("gift_buyer", "founder-led-gift", "emotion", "The Deadline Gift-Giver"),
    ("self_purchaser", "logo-tax", "education", "The Quiet-Luxury Collector"),
]


async def _give_avatars(
    client: TestClient, business_id: str, creative_ids: list[str], *, link: bool
) -> list[str]:
    """Stamp structured angles (and, when `link`, library avatars) on the creatives."""
    ids: list[str] = []
    db = Prisma()
    await db.connect()
    try:
        for creative_id, (avatar, concept, pillar, name) in zip(
            creative_ids, _ANGLES, strict=True
        ):
            avatar_id = client.post(
                f"/businesses/{business_id}/avatars",
                json={"name": name, "who": "A buyer."},
            ).json()["id"]
            ids.append(avatar_id)
            data: Any = {"avatar": avatar, "concept": concept, "pillar": pillar}
            if link:
                data["buyerAvatarId"] = avatar_id
            await db.creative.update(where={"id": creative_id}, data=data)
    finally:
        await db.disconnect()
    return ids


def _ad_names(mock_services: dict[str, AsyncMock]) -> list[str]:  # noqa: F811
    return [c.kwargs["name"] for c in mock_services["create_ad"].await_args_list]


@pytest.mark.asyncio
async def test_publish_puts_the_avatar_slug_in_the_ad_name_and_utm_content(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3
    )
    await _give_avatars(client, business_id, selected, link=True)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200, response.text
    expected = [
        "Self-purchaser (promotion-ring-buyer) – Ceramic inlay – Mechanism",
        "Gift buyer (deadline-gift-giver) – Founder led gift – Emotion",
        "Self-purchaser (quiet-luxury-collector) – Logo tax – Education",
    ]
    assert sorted(_ad_names(mock_services)) == sorted(expected)
    for call in mock_services["create_ad_creative"].await_args_list:
        tags = {k: v[0] for k, v in parse_qs(call.kwargs["url_tags"]).items()}
        assert tags["utm_content"] in expected
        # utm_medium keeps exactly today's meaning: buyer type and concept only.
        assert tags["utm_medium"] in {
            "self-purchaser-ceramic-inlay",
            "gift-buyer-founder-led-gift",
            "self-purchaser-logo-tax",
        }
        assert "(" not in tags["utm_medium"]
    # The local Ad rows carry the same names that went to Meta.
    db = Prisma()
    await db.connect()
    try:
        ad_set = await db.adset.find_first(where={"campaignId": campaign_id})
        assert ad_set is not None
        ads = await db.ad.find_many(where={"adSetId": ad_set.id})
    finally:
        await db.disconnect()
    assert sorted(a.name for a in ads) == sorted(expected)


@pytest.mark.asyncio
async def test_creatives_without_a_library_avatar_are_named_as_before(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(
        client, monkeypatch, select=3
    )
    await _give_avatars(client, business_id, selected, link=False)

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 200, response.text
    assert sorted(_ad_names(mock_services)) == [
        "Gift buyer – Founder led gift – Emotion",
        "Self-purchaser – Ceramic inlay – Mechanism",
        "Self-purchaser – Logo tax – Education",
    ]
