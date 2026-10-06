"""Tests for resolving language names to Meta locale ids (Targeting Search)."""

from typing import Any
from unittest.mock import AsyncMock

import pytest
from app.services import locales
from app.services.meta import MetaConnectionError

_ENGLISH = [
    {"name": "English (US)", "key": 6},
    {"name": "English (UK)", "key": 24},
    {"name": "English (All)", "key": 1001},
]
_SPANISH = [
    {"name": "Spanish (Spain)", "key": 7},
    {"name": "Spanish", "key": 23},
    {"name": "Spanish (All)", "key": 1002},
]


def _patch_search(
    monkeypatch: pytest.MonkeyPatch, by_query: dict[str, list[dict[str, Any]]]
) -> AsyncMock:
    async def fake(*, access_token: str, query: str) -> list[dict[str, Any]]:
        # Meta's search is case-insensitive.
        lowered = {key.lower(): value for key, value in by_query.items()}
        return lowered.get(query.lower(), [])

    mock = AsyncMock(side_effect=fake)
    monkeypatch.setattr(locales, "search_ad_locales", mock)
    return mock


@pytest.mark.asyncio
async def test_resolve_languages_prefers_the_all_variant(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """ "English" should match every English variant ("English (All)"), not
    just US English, so no English speaker in the target country is excluded."""
    _patch_search(monkeypatch, {"English": _ENGLISH, "Spanish": _SPANISH})

    ids = await locales.resolve_languages(
        access_token="token", languages=["English", "Spanish"]
    )

    assert ids == [1001, 1002]


@pytest.mark.asyncio
async def test_resolve_languages_falls_back_to_an_exact_name_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_search(
        monkeypatch,
        {
            "Spanish": [
                {"name": "Spanish (Spain)", "key": 7},
                {"name": "Spanish", "key": 23},
            ]
        },
    )

    ids = await locales.resolve_languages(access_token="token", languages=["spanish"])

    assert ids == [23]


@pytest.mark.asyncio
async def test_resolve_languages_falls_back_to_the_first_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_search(monkeypatch, {"Tagalog": [{"name": "Filipino", "key": 99}]})

    ids = await locales.resolve_languages(access_token="token", languages=["Tagalog"])

    assert ids == [99]


@pytest.mark.asyncio
async def test_resolve_languages_dedupes_and_keeps_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_search(monkeypatch, {"English": _ENGLISH})

    ids = await locales.resolve_languages(
        access_token="token", languages=["English", "english"]
    )

    assert ids == [1001]


@pytest.mark.asyncio
async def test_resolve_languages_raises_when_a_language_has_no_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_search(monkeypatch, {"English": _ENGLISH})

    with pytest.raises(locales.LocaleResolutionError, match="Klingon"):
        await locales.resolve_languages(
            access_token="token", languages=["English", "Klingon"]
        )


def test_locale_resolution_error_is_a_meta_connection_error() -> None:
    """So the publish endpoint's existing handling (campaign -> FAILED,
    retryable) covers it without a parallel error path."""
    assert issubclass(locales.LocaleResolutionError, MetaConnectionError)
