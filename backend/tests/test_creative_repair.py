"""Local repair of a Creative Agent response before a paid retry.

Measured against the real API (2026-10), roughly 4 in 6 first attempts failed
validation on two fixable things: variants with mixed CTAs, and primary text a
few characters over 125. Both are repaired deterministically, with no model
call; anything else still takes the single retry.
"""

import logging
from typing import Any

import pytest
from app.schemas.creative import (
    MAX_BODY_TEXT_LENGTH,
    GeneratedCreativeBatch,
    GeneratedCreativeVariant,
    offer_mentioned,
)
from app.services import creative

from tests.test_creative_cost import _batch_of, _client_returning
from tests.test_creative_service import (
    _FAKE_STRATEGY,
    _fake_brand_profile,
    _fake_business,
    _fake_product,
    anthropic_api_key,  # noqa: F401 — pytest fixture re-exported for this module
)

_LONG_SENTENCES = (
    "Hand-finished in Bogota with an 18k gold band. "
    "The ceramic inlay is fused at high heat, so the color stays."
)  # 105 chars; plus the tail below pushes it past 125
_OVER = _LONG_SENTENCES + " Shop the collection today and see it for yourself."
assert len(_OVER) > MAX_BODY_TEXT_LENGTH
assert len(_LONG_SENTENCES) >= 60


# Unlike endings, so the ads still read as different ads.
_ENDINGS = [
    "Heirloom pieces shaped slowly around your own hands.",
    "Quiet confident styles chosen because they suit your taste.",
    "Small batches finished carefully by artisans across Manhattan.",
    "Milestone presents wrapped beautifully and delivered early.",
]


def _with(batch: dict[str, Any], index: int, **fields: Any) -> dict[str, Any]:
    batch["variants"][index].update(fields)
    return batch


async def _generate(
    brand_profile: Any = None, **kwargs: Any
) -> list[GeneratedCreativeVariant]:
    return await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        brand_profile=brand_profile,
        **kwargs,
    )


# ---------- offer_mentioned (shared with the GET_OFFER validator) ----------


def test_offer_mentioned_matches_any_significant_word_case_insensitively() -> None:
    assert offer_mentioned("20% off with WELCOME20", "Use welcome20 at checkout")
    assert offer_mentioned("Free engraving", "Engraving is on us")
    assert not offer_mentioned("Free engraving", "Hand-finished in Bogota")


def test_an_offer_with_no_significant_words_is_always_mentioned() -> None:
    assert offer_mentioned("$5", "anything at all")


# ---------- mixed CTAs ----------


@pytest.mark.asyncio
async def test_mixed_ctas_are_set_to_the_objectives_default_with_no_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _with(_batch_of(4), 1, cta="LEARN_MORE")
    create = _client_returning(monkeypatch, batch)

    result = await _generate()

    assert create.call_count == 1
    assert {v.cta for v in result} == {"SHOP_NOW"}


@pytest.mark.asyncio
async def test_mixed_ctas_become_get_offer_when_every_body_mentions_the_offer(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _batch_of(4)
    for i in range(4):
        _with(
            batch,
            i,
            bodyText=f"Free engraving on every ring. {_ENDINGS[i]}",
            cta="GET_OFFER" if i == 0 else "SHOP_NOW",
        )
    create = _client_returning(monkeypatch, batch)

    result = await _generate(brand_profile=_fake_brand_profile(offer="Free engraving"))

    assert create.call_count == 1
    assert {v.cta for v in result} == {"GET_OFFER"}


@pytest.mark.asyncio
async def test_mixed_ctas_fall_back_to_shop_now_if_one_body_skips_the_offer(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _batch_of(4)
    for i in range(4):
        _with(
            batch,
            i,
            bodyText=f"Free engraving on every ring. {_ENDINGS[i]}"
            if i
            else "Hand-finished in Bogota.",
            cta="GET_OFFER" if i == 1 else "SHOP_NOW",
        )
    create = _client_returning(monkeypatch, batch)

    result = await _generate(brand_profile=_fake_brand_profile(offer="Free engraving"))

    assert create.call_count == 1
    assert {v.cta for v in result} == {"SHOP_NOW"}


@pytest.mark.asyncio
async def test_get_offer_with_no_standing_offer_is_repaired_to_the_default(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _batch_of(4)
    for i in range(4):
        _with(batch, i, cta="GET_OFFER")
    create = _client_returning(monkeypatch, batch)

    result = await _generate()

    assert create.call_count == 1
    assert {v.cta for v in result} == {"SHOP_NOW"}


@pytest.mark.asyncio
async def test_a_cta_the_objective_forbids_is_repaired(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _batch_of(4)
    for i in range(4):
        _with(batch, i, cta="LEARN_MORE")
    create = _client_returning(monkeypatch, batch)

    result = await _generate()

    assert create.call_count == 1
    assert {v.cta for v in result} == {"SHOP_NOW"}


# ---------- over-length primary text ----------


@pytest.mark.asyncio
async def test_over_length_text_is_trimmed_to_the_last_complete_sentence(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _with(_batch_of(4), 2, bodyText=_OVER)
    create = _client_returning(monkeypatch, batch)

    result = await _generate()

    assert create.call_count == 1
    assert result[2].body_text == _LONG_SENTENCES
    assert len(result[2].body_text) <= MAX_BODY_TEXT_LENGTH


@pytest.mark.asyncio
async def test_text_that_cannot_keep_sixty_characters_goes_to_the_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The first sentence is short, so trimming would leave under 60 characters."""
    short_then_long = "Wear it daily. " + "x" * 120
    bad = _with(_batch_of(4), 0, bodyText=short_then_long)
    create = _client_returning(monkeypatch, bad, _batch_of(4))

    result = await _generate()

    assert create.call_count == 2
    assert len(result) == 4


@pytest.mark.asyncio
async def test_an_over_length_headline_is_not_repaired_it_is_retried(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bad = _with(_batch_of(4), 0, headline="H" * 60)
    create = _client_returning(monkeypatch, bad, _batch_of(4))

    await _generate()

    assert create.call_count == 2


@pytest.mark.asyncio
async def test_both_repairs_apply_in_the_same_pass(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _with(_batch_of(4), 0, bodyText=_OVER)
    _with(batch, 3, cta="LEARN_MORE")
    create = _client_returning(monkeypatch, batch)

    result = await _generate()

    assert create.call_count == 1
    assert result[0].body_text == _LONG_SENTENCES
    assert {v.cta for v in result} == {"SHOP_NOW"}


@pytest.mark.asyncio
async def test_a_repair_that_still_leaves_the_batch_invalid_takes_the_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A fixable CTA problem next to an unfixable one (engagement bait)."""
    batch = _with(_batch_of(4), 1, cta="LEARN_MORE")
    _with(batch, 2, bodyText="Tag a friend who loves gold.")
    create = _client_returning(monkeypatch, batch, _batch_of(4))

    result = await _generate()

    assert create.call_count == 2
    assert len(result) == 4


@pytest.mark.asyncio
async def test_a_valid_first_response_is_left_alone(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    create = _client_returning(monkeypatch, _batch_of(4))

    with caplog.at_level(logging.INFO, logger="app.services.creative"):
        await _generate()

    assert create.call_count == 1
    assert "llm_repair" not in caplog.text


@pytest.mark.asyncio
async def test_a_response_with_no_variants_list_goes_straight_to_the_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _client_returning(monkeypatch, {"something": "else"}, _batch_of(4))

    result = await _generate()

    assert create.call_count == 2
    assert len(result) == 4


@pytest.mark.asyncio
async def test_a_single_variant_call_is_repaired_the_same_way(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    batch = _with(_batch_of(1), 0, bodyText=_OVER, cta="LEARN_MORE")
    create = _client_returning(monkeypatch, batch)

    result = await _generate(
        single_variant=creative.SingleVariantTarget("Craftsmanship")
    )

    assert create.call_count == 1
    assert result[0].body_text == _LONG_SENTENCES
    assert result[0].cta == "SHOP_NOW"


# ---------- the model's wrapper-key quirk must not hide a fixable batch ----------
#
# Real runs (2026-10-24) showed the first attempt often came back wrapped under
# a stray key, {"creatives": {"variants": [...]}}. parse_tool_input unwraps it,
# but when the unwrapped batch then fails (mixed CTAs, long text) it reports the
# ORIGINAL error ("variants: Field required"), so the repair looked at the
# wrapper, found no variants list, and never fired. It must repair what is inside.


@pytest.mark.asyncio
async def test_a_wrapped_batch_with_mixed_ctas_is_repaired_without_a_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    wrapped = {"creatives": _with(_batch_of(4), 1, cta="LEARN_MORE")}
    create = _client_returning(monkeypatch, wrapped)

    result = await _generate()

    assert create.call_count == 1
    assert {v.cta for v in result} == {"SHOP_NOW"}


@pytest.mark.asyncio
async def test_a_batch_wrapped_around_a_bare_list_is_repaired_too(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    variants = _with(_batch_of(4), 2, bodyText=_OVER)["variants"]
    create = _client_returning(monkeypatch, {"creatives": variants})

    result = await _generate()

    assert create.call_count == 1
    assert result[2].body_text == _LONG_SENTENCES


@pytest.mark.asyncio
async def test_a_wrapper_around_an_empty_batch_still_takes_the_retry(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The degenerate {'creativeBatch': {'variants': []}} seen live: nothing to
    repair, so it is retried like any other invalid response."""
    create = _client_returning(
        monkeypatch, {"creativeBatch": {"variants": []}}, _batch_of(4)
    )

    result = await _generate()

    assert create.call_count == 2
    assert len(result) == 4


def test_candidate_payloads_lists_the_raw_input_first_then_its_reshapings() -> None:
    from app.services.tool_use import candidate_payloads

    inner = {"variants": [1]}

    assert candidate_payloads({"variants": [1]}, GeneratedCreativeBatch) == [
        {"variants": [1]}
    ]
    assert candidate_payloads({"x": inner}, GeneratedCreativeBatch) == [
        {"x": inner},
        inner,
    ]


# ---------- every repair is logged ----------


@pytest.mark.asyncio
async def test_each_repair_is_logged_with_its_field_and_before_after(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    batch = _with(_batch_of(4), 2, bodyText=_OVER)
    _with(batch, 1, cta="LEARN_MORE")
    _client_returning(monkeypatch, batch)

    with caplog.at_level(logging.INFO, logger="app.services.creative"):
        await creative.generate_creatives(
            business=_fake_business(),
            product=_fake_product(),
            strategy=_FAKE_STRATEGY,
            campaign_id="camp_5",
        )

    lines = [r.getMessage() for r in caplog.records if "llm_repair" in r.getMessage()]
    assert len(lines) == 2
    body = next(x for x in lines if "field=body_text" in x)
    assert "agent=creative call_type=creative_batch campaign_id=camp_5" in body
    assert "variant=3" in body
    assert f"before_len={len(_OVER)} after_len={len(_LONG_SENTENCES)}" in body
    cta = next(x for x in lines if "field=cta" in x)
    assert (
        "before='LEARN_MORE|SHOP_NOW'" in cta or "before='SHOP_NOW|LEARN_MORE'" in cta
    )
    assert "after='SHOP_NOW'" in cta
