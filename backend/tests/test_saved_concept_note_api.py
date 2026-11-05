"""The "From your avatar" note is recorded when an angle is created, not later.

The Strategist's validator stores ``fromSavedConcept`` on the angle in the plan JSON
(the strategy's angles, and each round's angles). Ad cards read it from their angle,
so editing or deleting a concept afterwards does not change history, a concept saved
afterwards with the same slug does not add the note, and a plan without the field
shows none.
"""

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.api import creative as creative_module
from app.api import creative_round as round_module
from app.schemas.strategy import CreativeAngle, GeneratedCreativeAngle, Pillar
from app.services.creative_naming import angle_label
from fastapi.testclient import TestClient
from prisma import Prisma

from tests.test_buyer_avatars import _payload
from tests.test_buyer_avatars import _url as avatars_url
from tests.test_creative_rounds import (
    _base,
    _new_round,
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    _creative_plan,
    _creative_plan_campaign,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    _FAKE_VARIANTS,
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

_SAVED = "nobody-chose-this-for"
_ANGLES: list[tuple[str, Pillar]] = [
    (_SAVED, "emotion"),
    ("your-year-designed", "offer"),
    ("sanitizer-test", "mechanism"),
    ("social-proof", "education"),
]


@pytest.fixture(autouse=True)
def matched_variants(
    monkeypatch: pytest.MonkeyPatch,
    mock_services: Any,  # noqa: ANN401, F811
) -> None:
    """The Creative Agent mock labels each ad with its plan angle, like the real one."""

    async def fake(**kwargs: Any) -> Any:  # noqa: ANN401
        angles = kwargs["strategy"].creative_angles
        return [
            variant.model_copy(
                update={
                    "creative_angle": angle_label(
                        str(angle.avatar), angle.concept, angle.pillar
                    )
                }
            )
            for variant, angle in zip(_FAKE_VARIANTS, angles, strict=False)
        ]

    monkeypatch.setattr(
        creative_module, "generate_creatives", AsyncMock(side_effect=fake)
    )


def _plan(*, saved: bool) -> Any:  # noqa: ANN401
    """A creative test plan whose first angle did (or did not) reuse a saved concept."""
    return _creative_plan(
        creative_angles=[
            CreativeAngle(
                avatar="self_purchaser",
                concept=concept,
                pillar=pillar,
                description=f"{concept} shows.",
                buyer_avatar_id="placeholder-avatar",
                from_saved_concept=saved and concept == _SAVED,
            )
            for concept, pillar in _ANGLES
        ]
    )


def _creatives(
    client: TestClient, business_id: str, campaign_id: str
) -> dict[str, Any]:
    body = client.get(f"{_base(campaign_id, business_id)}/creatives").json()
    return {c["concept"]: c for c in body}


def _notes(client: TestClient, business_id: str, campaign_id: str) -> dict[str, bool]:
    return {
        concept: c["fromSavedConcept"]
        for concept, c in _creatives(client, business_id, campaign_id).items()
    }


async def _link_avatar(campaign_id: str, avatar_id: str) -> None:
    """Point the plan's angles and the ads at a real avatar, not the placeholder."""
    db = Prisma()
    await db.connect()
    try:
        await db.creative.update_many(
            where={"campaignId": campaign_id},
            data={"buyerAvatarId": avatar_id},
        )
        strategy = await db.strategy.find_unique(where={"campaignId": campaign_id})
        assert strategy is not None
        content = json.loads(strategy.content)
        for angle in content["creativeAngles"]:
            angle["buyerAvatarId"] = avatar_id
        await db.strategy.update(
            where={"campaignId": campaign_id}, data={"content": json.dumps(content)}
        )
    finally:
        await db.disconnect()


async def _strip_flag(campaign_id: str) -> None:
    """Make the stored plan look like one from before the flag existed."""
    db = Prisma()
    await db.connect()
    try:
        strategy = await db.strategy.find_unique(where={"campaignId": campaign_id})
        assert strategy is not None
        content = json.loads(strategy.content)
        for angle in content["creativeAngles"]:
            angle.pop("fromSavedConcept", None)
        await db.strategy.update(
            where={"campaignId": campaign_id}, data={"content": json.dumps(content)}
        )
    finally:
        await db.disconnect()


def _make_avatar(client: TestClient, business_id: str, *slugs: str) -> str:
    concepts = [
        {"name": slug.replace("-", " "), "pillar": "emotion", "description": "d"}
        for slug in slugs
    ]
    created = client.post(
        avatars_url(business_id), json=_payload(name="Seeker", concepts=concepts)
    )
    assert created.status_code == 201, created.text
    return str(created.json()["id"])


def _campaign_with(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, *, saved: bool
) -> tuple[str, str, list[str]]:
    return _creative_plan_campaign(
        client,
        monkeypatch,
        plan=_plan(saved=saved),
        select=3,
        approve=False,
        photo_count=4,
    )


def test_an_ad_card_shows_the_note_when_its_angle_recorded_one(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=True)

    notes = _notes(client, business_id, campaign_id)

    assert notes == {
        _SAVED: True,
        "your-year-designed": False,
        "sanitizer-test": False,
        "social-proof": False,
    }


def test_the_strategy_screen_gets_the_flag_on_each_angle(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=True)

    strategy = client.get(f"{_base(campaign_id, business_id)}/strategy").json()

    flags = {
        a["concept"]: a["fromSavedConcept"]
        for a in strategy["content"]["creativeAngles"]
    }
    assert flags == {
        _SAVED: True,
        "your-year-designed": False,
        "sanitizer-test": False,
        "social-proof": False,
    }


def test_a_plan_from_before_the_flag_shows_no_note(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=True)
    asyncio.run(_strip_flag(campaign_id))

    assert not any(_notes(client, business_id, campaign_id).values())
    strategy = client.get(f"{_base(campaign_id, business_id)}/strategy").json()
    assert not any(a["fromSavedConcept"] for a in strategy["content"]["creativeAngles"])


@pytest.mark.asyncio
async def test_editing_or_deleting_the_concept_later_leaves_the_note(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=True)
    avatar_id = _make_avatar(client, business_id, _SAVED)
    await _link_avatar(campaign_id, avatar_id)
    assert _notes(client, business_id, campaign_id)[_SAVED] is True

    # Edit: the concept is renamed, so the avatar no longer has this slug.
    renamed = client.patch(
        avatars_url(business_id, f"/{avatar_id}"),
        json={
            "concepts": [
                {"name": "Something else", "pillar": "offer", "description": "d"}
            ]
        },
    )
    assert renamed.status_code == 200, renamed.text
    assert _notes(client, business_id, campaign_id)[_SAVED] is True

    # Delete: the avatar itself is gone.
    assert client.delete(avatars_url(business_id, f"/{avatar_id}")).status_code == 204
    assert _notes(client, business_id, campaign_id)[_SAVED] is True
    strategy = client.get(f"{_base(campaign_id, business_id)}/strategy").json()
    angle = next(
        a for a in strategy["content"]["creativeAngles"] if a["concept"] == _SAVED
    )
    assert angle["fromSavedConcept"] is True


@pytest.mark.asyncio
async def test_saving_a_same_slug_concept_later_does_not_add_the_note(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=False)
    avatar_id = _make_avatar(client, business_id, _SAVED)
    await _link_avatar(campaign_id, avatar_id)

    assert not any(_notes(client, business_id, campaign_id).values())


def test_a_rounds_angles_and_ads_carry_the_note(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    business_id, campaign_id, _ = _campaign_with(client, monkeypatch, saved=False)
    round_angles = [
        GeneratedCreativeAngle(
            avatar="self_purchaser",
            concept="daily-ritual",
            pillar="emotion",
            description="A quiet morning.",
            buyer_avatar_id="placeholder-avatar",
            from_saved_concept=True,
        ),
        GeneratedCreativeAngle(
            avatar="self_purchaser",
            concept="made-to-last",
            pillar="mechanism",
            description="The build.",
            buyer_avatar_id="placeholder-avatar",
        ),
        GeneratedCreativeAngle(
            avatar="gift_buyer",
            concept="anniversary-surprise",
            pillar="emotion",
            description="The reveal.",
            buyer_avatar_id="placeholder-avatar-2",
        ),
        GeneratedCreativeAngle(
            avatar="gift_buyer",
            concept="easy-returns",
            pillar="offer",
            description="Risk-free.",
            buyer_avatar_id="placeholder-avatar-2",
        ),
    ]
    monkeypatch.setattr(
        round_module, "generate_round_angles", AsyncMock(return_value=round_angles)
    )

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201, response.text
    body = response.json()
    assert {a["concept"]: a["fromSavedConcept"] for a in body["angles"]} == {
        "daily-ritual": True,
        "made-to-last": False,
        "anniversary-surprise": False,
        "easy-returns": False,
    }
    assert {c["concept"]: c["fromSavedConcept"] for c in body["creatives"]} == {
        "daily-ritual": True,
        "made-to-last": False,
        "anniversary-surprise": False,
        "easy-returns": False,
    }
