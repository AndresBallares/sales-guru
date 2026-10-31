"""An angle can carry the library avatar it was written for (buyer_avatar_id).

The id rides in the stored plan and lands on each Creative row, so a result can
later be traced back to its avatar. Plans stored before this existed have none.
"""

from unittest.mock import AsyncMock

import pytest
from app.schemas.strategy import CreativeAngle, GeneratedCreativeAngle
from app.services.creative_naming import angle_label
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_creative_rounds import (
    ROUND_ANGLES,
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
    _FAKE_VARIANTS,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)


def test_an_angle_without_a_library_avatar_has_none() -> None:
    angle = GeneratedCreativeAngle(
        avatar="self_purchaser", concept="x", pillar="offer", description="d"
    )

    assert angle.buyer_avatar_id is None


def test_a_stored_angle_keeps_its_buyer_avatar_id() -> None:
    angle = CreativeAngle(
        avatar="gift_buyer",
        concept="anniversary",
        pillar="emotion",
        description="d",
        buyer_avatar_id="cav1",
    )

    stored = angle.model_dump(mode="json", by_alias=True)

    assert stored["buyerAvatarId"] == "cav1"
    assert CreativeAngle.model_validate(stored).buyer_avatar_id == "cav1"


def test_an_angle_stored_before_library_avatars_still_loads() -> None:
    old = {
        "avatar": "self_purchaser",
        "concept": "everyday-wear",
        "pillar": "emotion",
        "description": "d",
    }

    assert CreativeAngle.model_validate(old).buyer_avatar_id is None


def test_the_model_is_not_offered_the_field_in_the_classic_tool_schema() -> None:
    """In the classic (no library) mode the model must not see, or fill, the id."""
    schema = GeneratedCreativeAngle.model_json_schema()

    assert "buyer_avatar_id" not in schema["properties"]
    assert "buyerAvatarId" not in schema["properties"]


@pytest.mark.asyncio
async def test_a_rounds_ads_store_the_avatar_of_their_angle(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
    mock_round_angles: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id, _ = _campaign(client, monkeypatch)
    ids = ["cav-a", "cav-b", None, "cav-a"]
    generate_mock.side_effect = lambda **kw: [
        variant.model_copy(
            update={"creative_angle": angle_label(a.avatar, a.concept, a.pillar)}
        )
        for variant, a in zip(_FAKE_VARIANTS, ROUND_ANGLES, strict=False)
    ]
    mock_round_angles.side_effect = lambda **kw: [
        a.model_copy(update={"buyer_avatar_id": ids[n]})
        for n, a in enumerate(ROUND_ANGLES[: kw["count"]])
    ]

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201
    db = Prisma()
    await db.connect()
    try:
        rows = await db.creative.find_many(
            where={"roundId": response.json()["id"]}, order={"createdAt": "asc"}
        )
    finally:
        await db.disconnect()
    by_concept = {r.concept: r.buyerAvatarId for r in rows}
    assert by_concept == {
        "daily-ritual": "cav-a",
        "made-to-last": "cav-b",
        "anniversary-surprise": None,
        "easy-returns": "cav-a",
    }
    assert [a.get("buyerAvatarId") for a in response.json()["angles"]] == ids
