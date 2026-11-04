"""Meta is unreachable by default in tests, so none of them calls the real Graph API.

Before this, hundreds of tests reached ``graph.facebook.com`` with fake tokens
(pausing a campaign takes a final metrics snapshot, the status sync reads Meta each
cycle, ...). The app swallows those failures, so nobody noticed, but what Meta
answered decided whether a test passed: on 2026-11-03 an HTML "4xx Client Error"
page failed a publish test on CI. The conftest fixture ``_meta_offline`` makes the
Meta HTTP helpers fail as "unreachable" unless a test mocks them, which is what
those tests experienced anyway, without the network.
"""

from collections.abc import Awaitable, Callable
from unittest.mock import AsyncMock

import pytest
from app.services import meta

from tests.network_guard import take_attempts
from tests.test_meta_service import _NON_JSON_CALLS

_CALLS: list[tuple[str, Callable[[], Awaitable[object]]]] = _NON_JSON_CALLS


@pytest.mark.asyncio
@pytest.mark.parametrize(("label", "call"), _CALLS, ids=[c[0] for c in _CALLS])
async def test_an_unmocked_meta_call_fails_as_unreachable_without_the_network(
    label: str, call: Callable[[], Awaitable[object]]
) -> None:
    with pytest.raises(meta.MetaConnectionError, match="offline in tests"):
        await call()

    assert take_attempts() == []  # no connection, no DNS lookup


@pytest.mark.asyncio
async def test_a_test_that_mocks_a_helper_still_gets_its_own_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(meta, "_get_json", AsyncMock(return_value={"data": []}))

    assert await meta.list_pages("token") == []


@pytest.mark.meta_helpers_under_test
def test_the_marker_leaves_the_real_helpers_in_place() -> None:
    assert meta._get_json.__name__ == "_get_json"
    assert meta._post_json.__name__ == "_post_json"
    assert meta._delete_json.__name__ == "_delete_json"
    assert meta.upload_meta_ad_image.__name__ == "upload_meta_ad_image"
    assert meta.upload_meta_video.__name__ == "upload_meta_video"
