"""When the next ad-set round may start, and the round limit setting.

Rounds never overlap: round N+1 unlocks only after round N's ad sets have run their
10 days (or the user ended the round early), and only up to the round limit
(`creative_test_max_rounds`, default 3). Meta is always mocked.
"""

from unittest.mock import AsyncMock

import pytest
from app.core.config import get_settings
from fastapi.testclient import TestClient

from tests.test_ad_set_round_publish import (
    _finish_rounds,
    _published_round_one,
)
from tests.test_creative_rounds import (
    _base,
    _new_round,
    generate_mock,  # noqa: F401  (fixture, must be in this namespace)
)
from tests.test_creative_test_plan_publish import (
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_data_driven_rounds import (
    mock_round_angles,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_round_publish import (
    post_mocks,  # noqa: F401  (fixture, must be in this namespace)
)


@pytest.mark.asyncio
async def test_a_new_round_waits_for_the_current_round_to_finish(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "round 1" in detail.lower()
    assert "end round early" in detail.lower()


@pytest.mark.asyncio
async def test_a_new_round_unlocks_after_the_ten_days(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    await _finish_rounds(campaign_id)

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201, response.text
    assert response.json()["number"] == 2


def test_a_new_round_needs_the_first_round_to_be_published(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    from tests.test_ad_set_rounds import ad_set_plan
    from tests.test_creative_test_plan_publish import _creative_plan_campaign

    business_id, campaign_id, _ = _creative_plan_campaign(
        client, monkeypatch, plan=ad_set_plan(), select=4, photo_count=4
    )

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 409
    assert "publish round 1" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_the_round_limit_is_a_setting(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
) -> None:
    monkeypatch.setenv("CREATIVE_TEST_MAX_ROUNDS", "1")
    get_settings.cache_clear()
    try:
        business_id, campaign_id = _published_round_one(client, monkeypatch)
        await _finish_rounds(campaign_id)

        response = _new_round(client, business_id, campaign_id)
    finally:
        get_settings.cache_clear()

    assert response.status_code == 409
    assert "up to 1 round" in response.json()["detail"]
    assert _base(campaign_id, business_id)  # the campaign is unchanged


# --- the new ads complement the winners that stay live -----------------------------


@pytest.mark.asyncio
async def test_the_strategist_and_hook_shapes_are_told_about_the_winners(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
    generate_mock: AsyncMock,  # noqa: F811
    post_mocks: dict[str, AsyncMock],  # noqa: F811
    mock_round_angles: AsyncMock,  # noqa: F811
) -> None:
    business_id, campaign_id = _published_round_one(client, monkeypatch)
    await _finish_rounds(campaign_id)
    first_batch = generate_mock.await_args_list[0].kwargs["hook_shapes"]
    mock_services["object_status"].side_effect = lambda **kw: (
        "PAUSED" if kw["meta_object_id"] == "meta_ad_4" else "ACTIVE"
    )

    response = _new_round(client, business_id, campaign_id)

    assert response.status_code == 201, response.text
    assert mock_round_angles.await_args is not None
    carried = mock_round_angles.await_args.kwargs["carried"]
    assert len(carried) == 3  # the fourth ad was paused
    assert {c.hook_type for c in carried} <= set(first_batch)
    assert generate_mock.await_args is not None
    new_shapes = generate_mock.await_args.kwargs["hook_shapes"]
    carried_shapes = {c.hook_type for c in carried}
    fresh = [s for s in new_shapes if s not in carried_shapes]
    # Every shape the winners do not use is used before one they do.
    assert new_shapes[: len(fresh)] == fresh
