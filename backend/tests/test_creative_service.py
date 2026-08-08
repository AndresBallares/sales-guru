"""Tests for the Creative Agent service.

The Anthropic client is mocked throughout — no test here needs a real
ANTHROPIC_API_KEY or makes a network call.
"""

from collections.abc import Iterator
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock

import anthropic
import httpx
import pytest
from app.core.config import get_settings
from app.schemas.strategy import (
    BudgetRecommendation,
    StrategyContent,
    TargetAudience,
)
from app.services import creative
from prisma.models import Business, Product

_ONE_VARIANT: dict[str, Any] = {
    "headline": "Emeralds With a Story",
    "bodyText": "Custom Colombian emerald rings, handcrafted around you.",
    "description": "Ethically sourced. Made to order.",
    "cta": "SHOP_NOW",
    "creativeAngle": "Craftsmanship",
    "imagePrompt": "A close-up of a hand-set emerald ring on dark velvet",
    "videoPrompt": "A jeweler setting an emerald into a ring, slow motion",
}

_VALID_TOOL_INPUT: dict[str, Any] = {
    "variants": [
        {**_ONE_VARIANT, "creativeAngle": angle}
        for angle in ["Craftsmanship", "Luxury", "Personalization", "Heritage"]
    ]
}

_FAKE_STRATEGY = StrategyContent(
    objective="SALES",
    target_audience=TargetAudience(
        problem="Hard to find quality pieces", desire="Own something unique"
    ),
    offer="Custom emerald rings",
    positioning="Premium and personal",
    creative_angles=["Craftsmanship", "Luxury", "Personalization", "Heritage"],
    copy_strategy="Lead with the story behind each piece",
    budget_recommendation=BudgetRecommendation(daily=25, rationale="Small test spend"),
)


def _fake_business(**overrides: object) -> Business:
    defaults: dict[str, object] = {
        "name": "Acme Jewelry",
        "industry": None,
        "description": None,
    }
    defaults.update(overrides)
    return cast(Business, SimpleNamespace(**defaults))


def _fake_product(**overrides: object) -> Product:
    defaults: dict[str, object] = {
        "description": "Custom emerald rings",
        "price": None,
        "features": None,
        "benefits": None,
    }
    defaults.update(overrides)
    return cast(Product, SimpleNamespace(**defaults))


def _mock_client_returning(
    monkeypatch: pytest.MonkeyPatch, content: list[SimpleNamespace]
) -> AsyncMock:
    """Patch AsyncAnthropic to return a canned response, return the create mock."""
    create = AsyncMock(return_value=SimpleNamespace(content=content))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(creative, "AsyncAnthropic", lambda **_kwargs: fake_client)
    return create


@pytest.fixture
def anthropic_api_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Set a fake ANTHROPIC_API_KEY for the duration of a test."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_build_prompt_includes_strategy_and_optional_fields() -> None:
    """Every optional field, and the strategy's own content, ends up in the
    prompt — this is the agent's only grounding for the ad copy."""
    business = _fake_business(industry="Jewelry", description="Family-run since 1985")
    product = _fake_product(
        price=450.0, features="Ethically sourced", benefits="Lifetime warranty"
    )

    prompt = creative._build_prompt(business, product, _FAKE_STRATEGY)

    for expected in (
        "Acme Jewelry",
        "Jewelry",
        "Family-run since 1985",
        "Custom emerald rings",
        "450.0",
        "Ethically sourced",
        "Lifetime warranty",
        "Custom emerald rings",
        "Premium and personal",
        "Lead with the story behind each piece",
        "Craftsmanship, Luxury, Personalization, Heritage",
        "Hard to find quality pieces",
        "Own something unique",
        "SALES",
    ):
        assert expected in prompt


def test_build_prompt_handles_no_product() -> None:
    """With no product selected, the prompt still makes sense."""
    prompt = creative._build_prompt(_fake_business(), None, _FAKE_STRATEGY)

    assert "No specific product was selected" in prompt


def test_build_prompt_handles_no_problem_or_desire() -> None:
    """With neither hint set on the strategy's target audience, the prompt
    still makes sense — no dangling "Target audience problem: None" line."""
    strategy = _FAKE_STRATEGY.model_copy(update={"target_audience": TargetAudience()})

    prompt = creative._build_prompt(_fake_business(), None, strategy)

    assert "Target audience problem" not in prompt
    assert "Target audience desire" not in prompt


@pytest.mark.asyncio
async def test_generate_creatives_raises_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ANTHROPIC_API_KEY configured raises a clear error, not a crash.

    Set to "" rather than deleted — Settings reads .env directly (not just
    os.environ, see app/core/config.py), so delenv alone doesn't hide a
    real key that's actually present in .env; an explicit empty env var
    does, since it outranks the dotenv source.
    """
    monkeypatch.setenv("ANTHROPIC_API_KEY", "")
    get_settings.cache_clear()

    with pytest.raises(creative.CreativeAgentError, match="not configured"):
        await creative.generate_creatives(
            business=_fake_business(), product=None, strategy=_FAKE_STRATEGY
        )

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_generate_creatives_returns_four_variants(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid tool-use response is parsed into exactly four variants."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]
    )

    result = await creative.generate_creatives(
        business=_fake_business(), product=_fake_product(), strategy=_FAKE_STRATEGY
    )

    assert len(result) == 4
    assert [v.creative_angle for v in result] == [
        "Craftsmanship",
        "Luxury",
        "Personalization",
        "Heritage",
    ]
    assert result[0].headline == "Emeralds With a Story"
    assert result[0].cta == "SHOP_NOW"
    assert result[0].video_prompt


@pytest.mark.asyncio
async def test_generate_creatives_works_with_no_product(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The agent can generate creatives with no product selected."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]
    )

    result = await creative.generate_creatives(
        business=_fake_business(), product=None, strategy=_FAKE_STRATEGY
    )

    assert len(result) == 4


@pytest.mark.asyncio
async def test_generate_creatives_raises_on_api_error(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An Anthropic API failure surfaces as CreativeAgentError, not a raw exception."""
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    create = AsyncMock(side_effect=anthropic.APIConnectionError(request=request))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(creative, "AsyncAnthropic", lambda **_kwargs: fake_client)

    with pytest.raises(creative.CreativeAgentError, match="Anthropic API call failed"):
        await creative.generate_creatives(
            business=_fake_business(), product=None, strategy=_FAKE_STRATEGY
        )


@pytest.mark.asyncio
async def test_generate_creatives_raises_when_no_tool_call_returned(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the model responds with text instead of the forced tool call, that's
    a clear CreativeAgentError, not a silent bad result."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="text", text="I have thoughts...")]
    )

    with pytest.raises(creative.CreativeAgentError, match="did not return a tool call"):
        await creative.generate_creatives(
            business=_fake_business(), product=None, strategy=_FAKE_STRATEGY
        )


@pytest.mark.asyncio
async def test_generate_creatives_raises_on_malformed_tool_input(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A tool call with fewer than four variants fails validation clearly
    rather than silently storing an incomplete batch."""
    _mock_client_returning(
        monkeypatch,
        [SimpleNamespace(type="tool_use", input={"variants": [_ONE_VARIANT]})],
    )

    with pytest.raises(Exception, match="validation error"):
        await creative.generate_creatives(
            business=_fake_business(), product=None, strategy=_FAKE_STRATEGY
        )
