"""Resolve language names to Meta locale ids (Targeting Search, type=adlocale).

A CREATIVE_TEST_PLAN's language is one of the ad set's hard constraints (a
business's ad languages, English by default). Meta's `locales` targeting field
takes numeric locale ids, so each language name is looked up live at publish
time via app/services/meta.py's search_ad_locales.

Confirmed against the real API 2026-10-06: a name returns several variants
("English" -> "English (US)" 6, "English (UK)" 24, "English (All)" 1001). The
"(All)" variant covers every regional variant of the language, so it's
preferred; otherwise an exact name match; otherwise Meta's first result.
Advantage+ audience keeps `locales` as a hard limit, so this does restrict
delivery to people who use these languages.
"""

from typing import Any

from app.services.meta import MetaConnectionError, search_ad_locales


class LocaleResolutionError(MetaConnectionError):
    """Raised when a language name matches no Meta locale.

    A MetaConnectionError subclass so the publish endpoint's existing
    handling (campaign -> FAILED, retryable) covers it, same as
    GeoResolutionError.
    """


def _pick(language: str, candidates: list[dict[str, Any]]) -> int | None:
    wanted = language.strip().lower()
    for suffix in (" (all)", ""):
        for candidate in candidates:
            if str(candidate.get("name", "")).strip().lower() == wanted + suffix:
                return int(candidate["key"])
    return int(candidates[0]["key"]) if candidates else None


async def resolve_languages(*, access_token: str, languages: list[str]) -> list[int]:
    """Resolve language names to Meta locale ids, deduplicated, order kept.

    Args:
        access_token: A Meta access token with ads permissions.
        languages: Language names, e.g. ["English", "Spanish"].

    Returns:
        One locale id per distinct language.

    Raises:
        LocaleResolutionError: If a language matches no Meta locale.
        MetaConnectionError: If a Targeting Search call fails.
    """
    ids: list[int] = []
    for language in languages:
        candidates = await search_ad_locales(
            access_token=access_token, query=language.strip()
        )
        locale_id = _pick(language, candidates)
        if locale_id is None:
            raise LocaleResolutionError(
                f"Meta has no language matching {language!r} — check this "
                "business's ad languages"
            )
        if locale_id not in ids:
            ids.append(locale_id)
    return ids
