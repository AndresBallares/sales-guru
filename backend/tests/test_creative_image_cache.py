"""The product photo and logo are cached, not re-billed on every call.

Measured in production (2026-10-25): a single-slot regenerate sent about 6,860
uncached input tokens, roughly 4,700 of them the photo and logo, re-sent at full
price on every regenerate of the same campaign. The user turn already orders
images before the per-request text, so the fix is one breakpoint on the LAST
image block: tools + system + images become one cached prefix, and only the
per-request text is billed in full.

Invalidation: changing any image changes the bytes of that prefix, so the
messages-tier entry misses and is rewritten, while the tools+system entry (its
own breakpoint, earlier in the prompt) still hits.
"""

from types import SimpleNamespace
from typing import Any

import pytest
from app.services import creative
from prisma import Base64

from tests.test_creative_service import (
    _FAKE_STRATEGY,
    _VALID_TOOL_INPUT,
    _fake_business,
    _fake_product,
    _fake_product_image,
    _mock_client_returning,
    _sequenced_client,
    anthropic_api_key,  # noqa: F401 — pytest fixture re-exported for this module
)

_EPHEMERAL = {"type": "ephemeral"}


def _tool_use() -> list[SimpleNamespace]:
    return [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]


def _png(label: bytes) -> Any:
    return _fake_product_image(contentType="image/png", data=Base64.encode(label))


async def _generate(**kwargs: Any) -> None:
    await creative.generate_creatives(
        business=kwargs.pop("business", _fake_business()),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        **kwargs,
    )


def _content(create: Any, call: int = -1) -> list[dict[str, Any]]:
    content = create.call_args_list[call].kwargs["messages"][0]["content"]
    assert isinstance(content, list)
    return content


def _marked(blocks: list[dict[str, Any]]) -> list[int]:
    return [i for i, b in enumerate(blocks) if b.get("cache_control") == _EPHEMERAL]


def _breakpoints(create: Any, call: int = -1) -> int:
    kwargs = create.call_args_list[call].kwargs
    in_system = sum(1 for b in kwargs["system"] if "cache_control" in b)
    content = kwargs["messages"][0]["content"]
    in_messages = (
        sum(1 for b in content if "cache_control" in b)
        if isinstance(content, list)
        else 0
    )
    return in_system + in_messages


@pytest.mark.asyncio
async def test_a_single_product_photo_is_marked_as_the_end_of_the_cached_prefix(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_client_returning(monkeypatch, _tool_use())

    await _generate(primary_image=_png(b"photo"))

    image, text = _content(create)
    assert image["type"] == "image"
    assert image["cache_control"] == _EPHEMERAL
    assert text["type"] == "text"
    assert "cache_control" not in text


@pytest.mark.asyncio
async def test_with_a_logo_and_a_photo_only_the_last_image_is_marked(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One breakpoint covers every image before it; marking the logo too would
    spend a second breakpoint for nothing."""
    create = _mock_client_returning(monkeypatch, _tool_use())
    business = _fake_business(
        logoData=Base64.encode(b"logo"), logoContentType="image/png"
    )

    await _generate(business=business, primary_image=_png(b"photo"))

    blocks = _content(create)
    assert [b["type"] for b in blocks] == ["image", "image", "text"]
    assert _marked(blocks) == [1]


@pytest.mark.asyncio
async def test_a_carousel_marks_only_its_last_card_image(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_client_returning(monkeypatch, _tool_use())
    cards = [_png(b"card-1"), _png(b"card-2"), _png(b"card-3")]

    await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        format="CAROUSEL",
        card_images=cards,
    )

    blocks = _content(create)
    assert [b["type"] for b in blocks] == ["image", "image", "image", "text"]
    assert _marked(blocks) == [2]


@pytest.mark.asyncio
async def test_a_video_thumbnail_is_cached_like_a_photo(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_client_returning(monkeypatch, _tool_use())
    video = creative.VideoInput(
        thumbnail_data=str(Base64.encode(b"thumb")),
        thumbnail_content_type="image/jpeg",
        duration_seconds=12.0,
    )

    await _generate(format="SINGLE_VIDEO", video=video)

    blocks = _content(create)
    assert [b["type"] for b in blocks] == ["image", "text"]
    assert _marked(blocks) == [0]


@pytest.mark.asyncio
async def test_without_images_there_is_nothing_extra_to_cache(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_client_returning(monkeypatch, _tool_use())

    await _generate()

    assert isinstance(create.call_args.kwargs["messages"][0]["content"], str)
    assert _breakpoints(create) == 1  # the system block only


@pytest.mark.asyncio
async def test_the_system_breakpoint_stays_so_a_changed_photo_still_hits_it(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _mock_client_returning(monkeypatch, _tool_use())

    await _generate(primary_image=_png(b"photo"))

    kwargs = create.call_args.kwargs
    assert kwargs["system"][0]["cache_control"] == _EPHEMERAL
    assert _breakpoints(create) == 2  # system + last image, well under the limit of 4


@pytest.mark.asyncio
async def test_changing_the_photo_changes_only_the_image_tier_of_the_prefix(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The system block and tools are byte-identical across photos (so that
    cache entry keeps hitting), while the image block's bytes differ (so the
    image entry misses and is rewritten for the new photo)."""
    create = _mock_client_returning(monkeypatch, _tool_use())

    await _generate(primary_image=_png(b"first photo"))
    await _generate(primary_image=_png(b"second photo"))

    first, second = (c.kwargs for c in create.call_args_list)
    assert first["system"] == second["system"]
    assert first["tools"] == second["tools"]
    assert (
        first["messages"][0]["content"][0]["source"]
        != (second["messages"][0]["content"][0]["source"])
    )
    assert second["messages"][0]["content"][0]["cache_control"] == _EPHEMERAL


@pytest.mark.asyncio
async def test_the_same_photo_produces_an_identical_cached_prefix(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """What makes a repeat regenerate a cache hit: same bytes in, same prefix."""
    one = {"variants": [_VALID_TOOL_INPUT["variants"][0]]}
    create = _sequenced_client(monkeypatch, _VALID_TOOL_INPUT, one)

    await _generate(primary_image=_png(b"photo"))
    await _generate(
        primary_image=_png(b"photo"),
        single_variant=creative.SingleVariantTarget("Craftsmanship"),
    )

    first, second = (_content(create, i)[0] for i in (0, 1))
    assert first == second


@pytest.mark.asyncio
async def test_a_retry_carries_the_same_marked_image(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed first attempt that needs a paid retry must not re-bill the photo."""
    bad = {
        "variants": [{**v, "headline": "H" * 60} for v in _VALID_TOOL_INPUT["variants"]]
    }
    create = _sequenced_client(monkeypatch, bad, _VALID_TOOL_INPUT)

    await _generate(primary_image=_png(b"photo"))

    assert create.call_count == 2
    for call in (0, 1):
        assert _marked(_content(create, call)) == [0]
        assert _breakpoints(create, call) == 2
