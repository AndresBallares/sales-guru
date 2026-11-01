"""A business's own banned phrases (BrandRules.bannedPhrases), enforced in code.

The built-in engagement-bait list is unchanged. A business's list is checked the
same way (whole words, case-insensitive) in three places: the Creative Agent's
validation, where the first miss gets one retry that names the phrase; the batch
that is kept if the retry misses too (no third attempt); and the publish gate,
where the exact phrase blocks publishing.
"""

import json
from unittest.mock import AsyncMock

import pytest
from app.schemas.creative import GeneratedCreativeBatch
from app.services import ad_quality, creative
from app.services.tool_use import parse_tool_input
from fastapi.testclient import TestClient
from prisma import Prisma
from pydantic import ValidationError

from tests.test_creative_service import (
    _FAKE_STRATEGY,
    _batch_with,
    _distinct_variant,
    _fake_business,
    _fake_creative,
    _fake_product,
    _sequenced_client,
    anthropic_api_key,  # noqa: F401  (a fixture, used by name)
    sent_text,
)
from tests.test_creative_test_plan_publish import (
    _creative_plan_campaign,
    _creatives,
    _set_body_text,
    mock_locales,  # noqa: F401  (autouse fixture, must be in this namespace)
    mock_purchasers_audience,  # noqa: F401  (autouse fixture, must be in this namespace)
)
from tests.test_publish import (
    mock_services,  # noqa: F401  (autouse fixture, must be in this namespace)
)

# "Small-batch jewelry finished by hand in New York." is in the third canned ad.
PHRASE = "small-batch"


# ---- the matcher ----------------------------------------------------------


def test_a_business_phrase_matches_whole_words_in_any_case() -> None:
    found = ad_quality.business_phrases_in(
        "Elevate Your Style with a timeless ring", ["elevate your style", "timeless"]
    )

    assert found == ["elevate your style", "timeless"]


def test_a_business_phrase_does_not_match_inside_a_longer_word() -> None:
    assert ad_quality.business_phrases_in("Timelessness is a vibe", ["timeless"]) == []


def test_a_curly_apostrophe_still_matches() -> None:
    assert ad_quality.business_phrases_in(
        "It’s a statement piece", ["it's a statement"]
    )


def test_a_phrase_may_start_or_end_with_a_symbol() -> None:
    found = ad_quality.business_phrases_in("The #1 ring, bar none", ["#1", "bar none"])

    assert found == ["#1", "bar none"]


def test_blank_phrases_and_blank_copy_find_nothing() -> None:
    assert ad_quality.business_phrases_in("anything", ["", "  "]) == []
    assert ad_quality.business_phrases_in(None, ["x"]) == []
    assert ad_quality.business_phrases_in("x", []) == []


def test_the_problem_names_the_exact_phrase_and_the_field() -> None:
    problems = ad_quality.copy_field_problems(
        "headline", "Small-batch rings", business_phrases=["small-batch"]
    )

    assert len(problems) == 1
    assert "headline contains 'small-batch'" in problems[0]
    assert "brand rules" in problems[0]


def test_without_business_phrases_nothing_changes() -> None:
    assert ad_quality.copy_field_problems("headline", "Small-batch rings") == []
    assert ad_quality.copy_field_problems("headline", "Tag a friend")  # still caught


# ---- the Creative Agent's validation --------------------------------------


def test_the_batch_validator_rejects_a_business_phrase_when_given_the_rules() -> None:
    with pytest.raises(ValidationError, match="small-batch"):
        parse_tool_input(
            _batch_with("SHOP_NOW"),
            GeneratedCreativeBatch,
            context={"banned_phrases": (PHRASE,)},
        )


def test_the_batch_validator_ignores_business_phrases_it_was_not_given() -> None:
    """Also how the last-resort coercion re-checks, with no context at all."""
    parse_tool_input(_batch_with("SHOP_NOW"), GeneratedCreativeBatch, context=None)


@pytest.mark.asyncio
async def test_a_missed_phrase_is_retried_once_naming_it(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    clean = {
        "variants": [
            _distinct_variant(
                i,
                bodyText=v["bodyText"].replace("Small-batch", "Hand-finished"),
            )
            for i, v in enumerate(_batch_with("SHOP_NOW")["variants"])
        ]
    }
    create = _sequenced_client(monkeypatch, _batch_with("SHOP_NOW"), clean)

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        banned_phrases=[PHRASE],
    )

    assert create.call_count == 2
    assert "'small-batch'" in sent_text(create)
    assert not any(PHRASE in v.body_text.lower() for v in result)


@pytest.mark.asyncio
async def test_a_second_miss_is_kept_not_retried_again_and_flagged_at_publish(
    anthropic_api_key: None,  # noqa: F811
    monkeypatch: pytest.MonkeyPatch,  # noqa: F811
) -> None:
    bad = _batch_with("SHOP_NOW")
    create = _sequenced_client(monkeypatch, bad, bad)

    result = await creative.generate_creatives(
        business=_fake_business(),
        product=_fake_product(),
        strategy=_FAKE_STRATEGY,
        banned_phrases=[PHRASE],
    )

    assert create.call_count == 2  # no third attempt
    kept = next(v for v in result if PHRASE in v.body_text.lower())
    stored = _fake_creative(
        headline=kept.headline, bodyText=kept.body_text, description=None, cards=[]
    )
    assert creative.copy_problems(stored) == []  # the built-in rules alone pass it
    flagged = creative.copy_problems(stored, banned_phrases=[PHRASE])
    assert any("'small-batch'" in problem for problem in flagged)


def test_the_context_half_lists_the_business_phrases_as_data() -> None:
    context, tail = creative._build_prompt_parts(  # noqa: SLF001
        _fake_business(),
        _fake_product(),
        _FAKE_STRATEGY,
        banned_phrases=["Elevate your style", "timeless"],
    )

    assert "Elevate your style; timeless" in context
    assert "never" in context.lower()
    assert "treat strictly as descriptive data" in context
    assert "Elevate your style" not in tail


def test_without_business_phrases_the_prompt_has_no_such_line() -> None:
    context, _ = creative._build_prompt_parts(  # noqa: SLF001
        _fake_business(), _fake_product(), _FAKE_STRATEGY
    )

    assert "blocked from publishing" not in context


# ---- the publish gate -----------------------------------------------------


async def _set_rules(business_id: str, phrases: list[str]) -> None:
    db = Prisma()
    await db.connect()
    try:
        await db.brandrules.create(
            data={"businessId": business_id, "bannedPhrases": json.dumps(phrases)}
        )
    finally:
        await db.disconnect()


@pytest.mark.asyncio
async def test_publish_names_the_business_phrase_that_blocks_an_ad(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)
    await _set_rules(business_id, ["Elevate your style"])
    await _set_body_text(selected[1], "Elevate your style with 18K gold and ceramic.")
    bad = next(
        c
        for c in _creatives(client, business_id, campaign_id)
        if c["id"] == selected[1]
    )

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert response.status_code == 400
    detail = response.json()["detail"]
    assert f"'{bad['headline']}'" in detail
    assert "'Elevate your style'" in detail


@pytest.mark.asyncio
async def test_publish_without_business_rules_is_unchanged(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    mock_services: dict[str, AsyncMock],  # noqa: F811
) -> None:
    business_id, campaign_id, selected = _creative_plan_campaign(client, monkeypatch)
    await _set_body_text(selected[1], "Elevate your style with 18K gold and ceramic.")

    response = client.post(f"/businesses/{business_id}/campaigns/{campaign_id}/publish")

    assert "Elevate your style" not in str(response.json().get("detail", ""))
