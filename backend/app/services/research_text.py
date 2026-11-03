"""Text rules for quotes in a research run (Phase 7b, docs/phase-7.md).

A quote is checked in code, never trusted: it must be short, carry no username,
and appear word for word on the page it names. Whitespace, curly quotes, dashes
and case are folded before comparing, so a page's typography never makes a true
quote look false.
"""

import re
from urllib.parse import urlsplit

from app.schemas.research import MAX_QUOTE_WORDS

_QUOTES = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‚": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "„": '"',
        "–": "-",
        "—": "-",
        "−": "-",
        " ": " ",
    }
)
_SPACES = re.compile(r"\s+")
# u/name, /u/name and @name (not an email: no word character right before it).
_USERNAME = re.compile(r"(?<![\w.])(?:/?u/|@)[A-Za-z0-9_\-]{2,}")


def normalize(text: str) -> str:
    """Fold typography, whitespace and case so two spellings of a text compare equal.

    Args:
        text: Any text.

    Returns:
        The folded text.
    """
    return _SPACES.sub(" ", text.translate(_QUOTES)).strip().casefold()


def quote_in_text(quote: str, text: str) -> bool:
    """Whether the quote appears word for word in the text (after folding).

    Args:
        quote: The quoted words.
        text: The page text.

    Returns:
        False for an empty quote or empty text.
    """
    wanted = normalize(quote)
    return bool(wanted) and wanted in normalize(text)


def quote_problem(text: str) -> str | None:
    """Why a quote may not be kept, or None when it passes the shape rules.

    Args:
        text: The quoted words.

    Returns:
        ``empty``, ``too_long`` (over the word limit) or ``username``.
    """
    if not text.strip():
        return "empty"
    if len(text.split()) > MAX_QUOTE_WORDS:
        return "too_long"
    if _USERNAME.search(text):
        return "username"
    return None


def norm_url(url: str) -> str:
    """A key that treats scheme, host case, fragment and a trailing slash as the same.

    Args:
        url: A URL.

    Returns:
        ``host/path?query`` in lower case host, without fragment or trailing slash.
    """
    parts = urlsplit(url.strip())
    path = parts.path.rstrip("/")
    query = f"?{parts.query}" if parts.query else ""
    return f"{parts.netloc.casefold()}{path}{query}"
