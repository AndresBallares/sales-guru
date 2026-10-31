"""Tests for BuyerAvatar.purchaseFor: who an avatar buys for (self or gift).

The Strategist derives an angle's fixed avatar literal (self_purchaser or
gift_buyer) from this field, so the model never fills in both.
"""

from typing import Any

import pytest
from app.schemas.avatar_import import AvatarDraft, GeneratedAvatarDrafts
from app.services import avatar_import
from app.services.avatar_import import generate_avatar_drafts
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tests.test_avatar_import_service import (
    _DOC,
    _avatar,
    _client,
    _response,
    _tool_use,
    fake_llm,  # noqa: F401  (a fixture, used by name)
    real_key,  # noqa: F401  (a fixture, used by name)
)
from tests.test_buyer_avatars import _create_business, _payload, _signed_up_client, _url


def _avatar_with(**overrides: Any) -> dict[str, Any]:  # noqa: ANN401
    return _avatar(**overrides)


# ---- the API --------------------------------------------------------------


def test_an_avatar_buys_for_themselves_unless_told_otherwise(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    created = client.post(_url(business_id), json=_payload())

    assert created.status_code == 201
    assert created.json()["purchaseFor"] == "self"


def test_an_avatar_can_be_created_as_a_gift_buyer(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    created = client.post(_url(business_id), json=_payload(purchaseFor="gift"))

    assert created.json()["purchaseFor"] == "gift"
    listed = client.get(_url(business_id)).json()
    assert [a["purchaseFor"] for a in listed] == ["gift"]


def test_purchase_for_only_accepts_self_or_gift(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    response = client.post(_url(business_id), json=_payload(purchaseFor="someone"))

    assert response.status_code == 422


def test_patch_changes_purchase_for_and_leaves_it_alone_when_omitted(
    client: TestClient,
) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)
    avatar_id = client.post(_url(business_id), json=_payload()).json()["id"]

    changed = client.patch(
        _url(business_id, f"/{avatar_id}"), json={"purchaseFor": "gift"}
    )
    untouched = client.patch(
        _url(business_id, f"/{avatar_id}"), json={"name": "Renamed"}
    )

    assert changed.json()["purchaseFor"] == "gift"
    assert untouched.json()["purchaseFor"] == "gift"
    assert (
        client.patch(
            _url(business_id, f"/{avatar_id}"), json={"purchaseFor": "nobody"}
        ).status_code
        == 422
    )


def test_bulk_save_keeps_each_drafts_purchase_for(client: TestClient) -> None:
    _signed_up_client(client)
    business_id = _create_business(client)

    saved = client.post(
        _url(business_id, "/bulk"),
        json={
            "avatars": [
                {"name": "A", "who": "x", "purchaseFor": "gift"},
                {"name": "B", "who": "y"},
            ]
        },
    )

    assert [a["purchaseFor"] for a in saved.json()] == ["gift", "self"]


# ---- the import -----------------------------------------------------------


def test_the_import_tool_requires_the_model_to_say_who_each_avatar_buys_for() -> None:
    body = {k: v for k, v in _avatar().items() if k != "purchase_for"}

    with pytest.raises(ValidationError, match="purchase_for"):
        AvatarDraft.model_validate(body)
    schema = GeneratedAvatarDrafts.model_json_schema()
    assert "purchase_for" in schema["$defs"]["AvatarDraft"]["required"]


@pytest.mark.asyncio
async def test_drafts_carry_the_models_purchase_for(
    real_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _client(
        monkeypatch,
        _response(
            _tool_use(
                [
                    _avatar_with(name="Gift one", purchase_for="gift"),
                    _avatar_with(name="Self one", purchase_for="self"),
                ]
            )
        ),
    )

    result = await generate_avatar_drafts(_DOC)

    assert [(d.name, d.purchase_for) for d in result.drafts] == [
        ("Gift one", "gift"),
        ("Self one", "self"),
    ]


@pytest.mark.asyncio
async def test_the_instructions_say_how_to_decide_self_or_gift(
    real_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _client(monkeypatch, _response(_tool_use([_avatar()])))

    await generate_avatar_drafts(_DOC)

    system = create.await_args_list[0].kwargs["system"][0]["text"]
    assert "purchase_for" in system
    assert "gift" in system


@pytest.mark.asyncio
async def test_the_fake_drafts_include_a_gift_buyer_and_a_self_buyer(
    fake_llm: None,  # noqa: F811
) -> None:
    result = await generate_avatar_drafts(_DOC)

    assert {d.purchase_for for d in result.drafts} == {"self", "gift"}


def test_a_coerced_answer_defaults_a_bad_purchase_for_to_self_and_says_so() -> None:
    raw: dict[str, object] = {
        "avatars": [
            _avatar_with(name="Odd", purchase_for="maybe"),
            _avatar_with(name="Fine", purchase_for="gift"),
        ]
    }

    result = avatar_import._coerce(raw)  # noqa: SLF001

    assert [(d.name, d.purchase_for) for d in result.drafts] == [
        ("Odd", "self"),
        ("Fine", "gift"),
    ]
    assert any("Odd" in w and "self" in w for w in result.warnings)
