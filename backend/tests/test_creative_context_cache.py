"""The campaign-level request context is cached; only the per-call tail is billed.

Measured in production (2026-10-25) after the images were cached (#106): a
regenerate still sent about 4,000 uncached input tokens, almost all of it
campaign context (business, brand, offer, product, strategy) that is identical
for every regenerate of the campaign. Only the angle being rewritten, the
batch-or-single wording and the closing limits paragraph differ per call.

The user turn is now: images (last one marked) -> campaign context (marked) ->
per-call tail. That is 3 breakpoints with the system block, under the limit of
4, and each tier misses only when its own bytes change: a new photo rewrites the
image tier and everything after it, an edited brand profile or product rewrites
only the context.
"""

import contextlib
from typing import Any

import pytest
from app.schemas.creative import MAX_BODY_TEXT_LENGTH
from app.schemas.strategy import CreativeAngle
from app.services import creative
from app.services.creative_naming import angle_label
from prisma import Base64

from tests.test_creative_service import (
    _FAKE_STRATEGY,
    _VALID_TOOL_INPUT,
    _fake_brand_profile,
    _fake_business,
    _fake_product,
    _fake_product_image,
    _sequenced_client,
    _structured_plan,
    anthropic_api_key,  # noqa: F401 — pytest fixture re-exported for this module
)

_EPHEMERAL = {"type": "ephemeral"}
_ONE = {"variants": [_VALID_TOOL_INPUT["variants"][0]]}


def _plan() -> Any:
    """A creative test whose four angles differ in their descriptions."""
    return _structured_plan()


def _parts(**overrides: Any) -> tuple[str, str]:
    args: dict[str, Any] = {
        "business": _fake_business(industry="FASHION_JEWELRY", website="https://a.co"),
        "product": _fake_product(price=450.0, features="18k gold"),
        "strategy": _plan(),
        "brand_profile": _fake_brand_profile(offer="Free engraving"),
    }
    args.update(overrides)
    return creative._build_prompt_parts(
        args.pop("business"), args.pop("product"), args.pop("strategy"), **args
    )


def _single(index: int) -> creative.SingleVariantTarget:
    plan = _plan()
    angle = plan.creative_angles[index]
    return creative.SingleVariantTarget(
        angle_label(str(angle.avatar), angle.concept, angle.pillar), index
    )


def _png(label: bytes) -> Any:
    return _fake_product_image(contentType="image/png", data=Base64.encode(label))


# ---------- what is in which half ----------


def test_the_angle_is_in_the_tail_and_never_in_the_cached_context() -> None:
    context, tail = _parts(single_variant=_single(2))
    angle = _plan().creative_angles[2]

    assert angle.description in tail
    assert angle.description not in context


def test_every_angle_description_stays_out_of_the_context_in_a_batch_too() -> None:
    context, tail = _parts()

    for angle in _plan().creative_angles:
        assert angle.description not in context
        assert angle.description in tail


def test_the_campaign_facts_are_in_the_context() -> None:
    context, tail = _parts()

    for fact in (
        "Acme Jewelry",
        "FASHION_JEWELRY",
        "Free engraving",
        "18k gold",
        "Positioning:",
        "Copy strategy:",
        "Business website",
        "Reference angle structures",
        "Creative persona",
        "Campaign objective: SALES",
        "You must choose the CTA from exactly this set",
    ):
        assert fact in context, fact
        assert fact not in tail, fact


def test_the_limits_and_the_shared_cta_rule_still_close_the_request() -> None:
    """Hard limits stay the last thing the model reads (see #100: moving them
    away from the end made first attempts fail validation)."""
    _, tail = _parts()

    assert "must use that same CTA" in tail
    assert "the one shared CTA chosen above" in tail
    assert f"at most {MAX_BODY_TEXT_LENGTH} characters" in tail
    assert tail.rstrip().endswith("Submit them using the provided tool.")


def test_a_single_variant_tail_has_no_batch_wording() -> None:
    _, tail = _parts(single_variant=_single(1))

    assert "Generate exactly 1 variant" in tail
    assert "must use that same CTA" not in tail


def test_the_joined_prompt_is_the_context_then_the_tail() -> None:
    context, tail = _parts()
    business = _fake_business(industry="FASHION_JEWELRY", website="https://a.co")

    joined = creative._build_prompt(
        business,
        _fake_product(price=450.0, features="18k gold"),
        _plan(),
        brand_profile=_fake_brand_profile(offer="Free engraving"),
    )

    assert joined == f"{context}\n{tail}"


# ---------- the context is the same wherever it should be ----------


def test_the_context_is_identical_for_a_batch_and_a_single_variant() -> None:
    assert _parts()[0] == _parts(single_variant=_single(0))[0]


def test_the_context_is_identical_for_regenerates_of_different_creatives() -> None:
    """The point of the whole change: rewriting creative B right after creative
    A reads the campaign context from cache."""
    contexts = {_parts(single_variant=_single(i))[0] for i in range(4)}

    assert len(contexts) == 1


def test_the_context_is_identical_for_a_plan_without_avatars() -> None:
    plan = _plan().model_copy(
        update={"creative_angles": [CreativeAngle(concept="gifting", description="G")]}
    )
    target = creative.SingleVariantTarget("My own angle")

    assert _parts(strategy=plan)[0] == _parts(strategy=plan, single_variant=target)[0]


def test_building_the_context_twice_gives_the_same_bytes() -> None:
    assert _parts() == _parts()


# ---------- editing something invalidates exactly the context ----------


@pytest.mark.parametrize(
    "change",
    [
        {"brand_profile": _fake_brand_profile(offer="Free shipping")},
        {"brand_profile": _fake_brand_profile(avoidPhrases="cheap")},
        {"brand_profile": _fake_brand_profile(proofPoints='["4,000 reviews"]')},
        {"brand_profile": None},
        {"product": _fake_product(price=999.0, features="18k gold")},
        {"product": _fake_product(price=450.0, features="platinum")},
        {"product": _fake_product(description="A different ring")},
        {
            "business": _fake_business(
                industry="FASHION_JEWELRY", website="https://b.co"
            )
        },
        {"business": _fake_business(industry="FASHION_JEWELRY", description="New")},
    ],
    ids=[
        "offer",
        "avoid phrases",
        "proof points",
        "no brand profile",
        "price",
        "features",
        "product description",
        "website",
        "business description",
    ],
)
def test_editing_the_brand_product_or_business_changes_the_context_not_the_tail(
    change: dict[str, Any],
) -> None:
    base_context, base_tail = _parts()

    context, tail = _parts(**change)

    assert context != base_context
    assert tail == base_tail


def test_editing_the_strategy_changes_the_context() -> None:
    plan = _plan().model_copy(update={"positioning": "Entirely different"})

    assert _parts(strategy=plan)[0] != _parts()[0]


def test_the_context_changes_with_the_requested_format() -> None:
    assert _parts(format="CAROUSEL", card_count=3)[0] != _parts()[0]


# ---------- the request that goes to the API ----------


def _sent(create: Any, call: int = -1) -> list[dict[str, Any]]:
    content = create.call_args_list[call].kwargs["messages"][0]["content"]
    assert isinstance(content, list)
    return content


def _marked(blocks: list[dict[str, Any]]) -> list[int]:
    return [i for i, b in enumerate(blocks) if b.get("cache_control") == _EPHEMERAL]


def _breakpoints(create: Any, call: int = -1) -> int:
    kwargs = create.call_args_list[call].kwargs
    return sum(1 for b in kwargs["system"] if "cache_control" in b) + len(
        [b for b in _sent(create, call) if "cache_control" in b]
    )


async def _generate(**kwargs: Any) -> None:
    await creative.generate_creatives(
        business=kwargs.pop("business", _fake_business()),
        product=_fake_product(),
        strategy=kwargs.pop("strategy", _FAKE_STRATEGY),
        **kwargs,
    )


@pytest.mark.asyncio
async def test_the_user_turn_is_images_then_cached_context_then_the_tail(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _sequenced_client(monkeypatch, _VALID_TOOL_INPUT)

    await _generate(primary_image=_png(b"photo"))

    blocks = _sent(create)
    assert [b["type"] for b in blocks] == ["image", "text", "text"]
    assert _marked(blocks) == [0, 1]
    assert "cache_control" not in blocks[2]
    assert "Campaign objective" in blocks[1]["text"]
    assert "Submit them using the provided tool" in blocks[2]["text"]


@pytest.mark.asyncio
async def test_without_images_the_context_is_still_cached(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _sequenced_client(monkeypatch, _VALID_TOOL_INPUT)

    await _generate()

    blocks = _sent(create)
    assert [b["type"] for b in blocks] == ["text", "text"]
    assert _marked(blocks) == [0]


@pytest.mark.asyncio
async def test_the_worst_case_uses_three_breakpoints_of_the_four_allowed(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _sequenced_client(monkeypatch, _VALID_TOOL_INPUT, _VALID_TOOL_INPUT)
    cards = [_png(bytes([i])) for i in range(10)]
    business = _fake_business(
        logoData=Base64.encode(b"logo"), logoContentType="image/png"
    )

    # The canned reply has no cards, so generation itself fails; this test only
    # looks at the request that was sent.
    with contextlib.suppress(creative.CreativeAgentError):
        await _generate(business=business, format="CAROUSEL", card_images=cards)

    blocks = _sent(create)
    assert [b["type"] for b in blocks].count("image") == 11
    assert _breakpoints(create) == 3  # system + last image + context
    assert _breakpoints(create) <= 4


@pytest.mark.asyncio
async def test_two_regenerates_of_different_ads_send_the_same_cached_prefix(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _sequenced_client(monkeypatch, _ONE, _ONE)
    plan = _plan()

    await _generate(
        strategy=plan, primary_image=_png(b"photo"), single_variant=_single(0)
    )
    await _generate(
        strategy=plan, primary_image=_png(b"photo"), single_variant=_single(3)
    )

    first, second = _sent(create, 0), _sent(create, 1)
    assert first[:2] == second[:2]  # image + context: byte-identical, both marked
    assert first[2] != second[2]  # only the tail (the angle) differs


@pytest.mark.asyncio
async def test_a_changed_photo_changes_the_image_block_not_the_system_or_context_text(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _sequenced_client(monkeypatch, _VALID_TOOL_INPUT, _VALID_TOOL_INPUT)

    await _generate(primary_image=_png(b"first"))
    await _generate(primary_image=_png(b"second"))

    a, b = create.call_args_list[0].kwargs, create.call_args_list[1].kwargs
    assert a["system"] == b["system"]
    assert a["tools"] == b["tools"]
    assert _sent(create, 0)[0] != _sent(create, 1)[0]
    assert _sent(create, 0)[1] == _sent(create, 1)[1]


@pytest.mark.asyncio
async def test_a_retry_resends_the_identical_context_and_a_longer_tail(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = {
        "variants": [{**v, "headline": "H" * 60} for v in _VALID_TOOL_INPUT["variants"]]
    }
    create = _sequenced_client(monkeypatch, bad, _VALID_TOOL_INPUT)

    await _generate(primary_image=_png(b"photo"))

    first, second = _sent(create, 0), _sent(create, 1)
    assert first[:2] == second[:2]
    assert second[2]["text"].startswith(first[2]["text"])
    assert "previous submission was invalid" in second[2]["text"]
    assert _breakpoints(create, 1) == 3
