"""Tests for the Marketing Strategist Agent service.

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
from app.services import strategist
from prisma.models import Audience, Business, Product

_VALID_TOOL_INPUT: dict[str, Any] = {
    "targetAudience": {
        "ageMin": 30,
        "ageMax": 55,
        "location": ["New York", "New Jersey"],
        "interests": ["fine jewelry"],
        "problem": "Hard to find quality, unique pieces",
        "desire": "Own something with a story",
    },
    "offer": "Custom Colombian emerald rings",
    "positioning": "Premium and personal, not mass-market",
    "creativeAngles": ["Craftsmanship", "Luxury", "Personalization"],
    "copyStrategy": "Lead with the story and character of the stone",
    "budgetRecommendation": {"daily": 25, "rationale": "Small, testable initial spend"},
}


def _fake_business(**overrides: object) -> Business:
    defaults: dict[str, object] = {
        "name": "Acme Jewelry",
        "industry": None,
        "location": None,
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


def _fake_audience(**overrides: object) -> Audience:
    defaults: dict[str, object] = {
        "description": "Jewelry buyers",
        "ageMin": None,
        "ageMax": None,
        "location": None,
        "interests": None,
        "problem": None,
        "desire": None,
    }
    defaults.update(overrides)
    return cast(Audience, SimpleNamespace(**defaults))


def _mock_client_returning(
    monkeypatch: pytest.MonkeyPatch, content: list[SimpleNamespace]
) -> AsyncMock:
    """Patch AsyncAnthropic to return a canned response, return the create mock."""
    create = AsyncMock(return_value=SimpleNamespace(content=content))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(strategist, "AsyncAnthropic", lambda **_kwargs: fake_client)
    return create


@pytest.fixture
def anthropic_api_key(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Set a fake ANTHROPIC_API_KEY for the duration of a test."""
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-anthropic-key")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_build_prompt_includes_all_optional_fields_when_present() -> None:
    """Every optional business/product/audience field, when set, ends up in
    the prompt — this is the agent's only grounding, so a silently-dropped
    field would mean the model never sees data the user actually provided."""
    business = _fake_business(
        industry="Jewelry", location="Bogotá", description="Family-run since 1985"
    )
    product = _fake_product(
        price=450.0, features="Ethically sourced", benefits="Lifetime warranty"
    )
    audience = _fake_audience(
        ageMin=30,
        ageMax=55,
        location="New York",
        interests="fine jewelry",
        problem="Hard to find quality pieces",
        desire="Own something unique",
    )

    prompt = strategist._build_prompt(business, product, audience, "SALES")

    for expected in (
        "Acme Jewelry",
        "Jewelry",
        "Bogotá",
        "Family-run since 1985",
        "Custom emerald rings",
        "450.0",
        "Ethically sourced",
        "Lifetime warranty",
        "Jewelry buyers",
        "30-55",
        "New York",
        "fine jewelry",
        "Hard to find quality pieces",
        "Own something unique",
        "SALES",
    ):
        assert expected in prompt


def test_build_prompt_handles_no_product_or_audience() -> None:
    """With neither selected, the prompt still makes sense — tells the model
    to recommend from scratch rather than silently omitting the sections."""
    prompt = strategist._build_prompt(_fake_business(), None, None, "AWARENESS")

    assert "No specific product was selected" in prompt
    assert "No audience has been defined yet" in prompt


@pytest.mark.asyncio
async def test_generate_strategy_raises_without_an_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ANTHROPIC_API_KEY configured raises a clear error, not a crash."""
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    get_settings.cache_clear()

    with pytest.raises(strategist.StrategistError, match="not configured"):
        await strategist.generate_strategy(
            business=_fake_business(), product=None, audience=None, objective="SALES"
        )

    get_settings.cache_clear()


@pytest.mark.asyncio
async def test_generate_strategy_returns_structured_content(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid tool-use response is parsed into StrategyContent, with the
    given objective injected rather than taken from the model."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]
    )

    result = await strategist.generate_strategy(
        business=_fake_business(),
        product=_fake_product(),
        audience=_fake_audience(),
        objective="SALES",
    )

    assert result.objective == "SALES"
    assert result.target_audience.age_min == 30
    assert result.target_audience.age_max == 55
    assert result.target_audience.location == ["New York", "New Jersey"]
    assert result.creative_angles == ["Craftsmanship", "Luxury", "Personalization"]
    assert result.budget_recommendation.daily == 25


@pytest.mark.asyncio
async def test_generate_strategy_works_with_no_product_or_audience(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The agent can generate a strategy from scratch, product/audience optional."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="tool_use", input=_VALID_TOOL_INPUT)]
    )

    result = await strategist.generate_strategy(
        business=_fake_business(), product=None, audience=None, objective="AWARENESS"
    )

    assert result.objective == "AWARENESS"


@pytest.mark.asyncio
async def test_generate_strategy_raises_on_api_error(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """An Anthropic API failure surfaces as StrategistError, not a raw exception."""
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    create = AsyncMock(side_effect=anthropic.APIConnectionError(request=request))
    fake_client = SimpleNamespace(messages=SimpleNamespace(create=create))
    monkeypatch.setattr(strategist, "AsyncAnthropic", lambda **_kwargs: fake_client)

    with pytest.raises(strategist.StrategistError, match="Anthropic API call failed"):
        await strategist.generate_strategy(
            business=_fake_business(), product=None, audience=None, objective="SALES"
        )


@pytest.mark.asyncio
async def test_generate_strategy_raises_when_no_tool_call_returned(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """If the model responds with text instead of the forced tool call, that's
    a clear StrategistError, not a silent bad result."""
    _mock_client_returning(
        monkeypatch, [SimpleNamespace(type="text", text="I have thoughts...")]
    )

    with pytest.raises(strategist.StrategistError, match="did not return a tool call"):
        await strategist.generate_strategy(
            business=_fake_business(), product=None, audience=None, objective="SALES"
        )


@pytest.mark.asyncio
async def test_generate_strategy_raises_on_malformed_tool_input(
    anthropic_api_key: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A tool call with input that doesn't match the schema fails validation
    clearly rather than silently storing garbage."""
    _mock_client_returning(
        monkeypatch,
        [SimpleNamespace(type="tool_use", input={"offer": "missing everything else"})],
    )

    with pytest.raises(Exception, match="validation error"):
        await strategist.generate_strategy(
            business=_fake_business(), product=None, audience=None, objective="SALES"
        )
