"""The runner's own fetch of a page, used only to check quotes (Phase 7b).

The model's web_fetch tool runs on Anthropic's side; to verify a quote the runner
must read the page itself. The URL comes from model output, which a fetched page
could have influenced, so this fetch is guarded like every other URL that enters
the system: ``validate_destination_url`` for the format, then the same post-DNS
public-address check as ``url_reachability`` on the first URL and on every
redirect hop (redirects are followed one hop at a time), a size limit and a time
limit. Page text is returned to the caller for a comparison and nowhere else; it
is never stored.

Known limit: the address is resolved for the check and again by the HTTP client,
the same window ``url_reachability`` has; pinning the resolved address is a
possible hardening (BACKLOG.md).
"""

import asyncio
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx

from app.services import url_reachability
from app.services.url_validation import DestinationUrlError, validate_destination_url

MAX_PAGE_BYTES = 1_000_000
_MAX_REDIRECTS = 5
_TOTAL_TIMEOUT = 20.0
_TIMEOUT = httpx.Timeout(connect=5.0, read=8.0, write=5.0, pool=5.0)
_USER_AGENT = "SalesGuruQuoteCheck/1.0 (+https://salesguru.example)"
_TEXT_TYPES = ("text/", "application/xhtml+xml", "application/xml")
_SKIPPED = {"script", "style", "noscript", "template", "head"}
_BLOCKS = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section"}
_SPACES = re.compile(r"[ \t\r\f\v\xa0]+")
_BLANKS = re.compile(r"\s*\n\s*")


@dataclass(frozen=True)
class PageFetch:
    """The outcome of fetching one page."""

    status: Literal["ok", "unreachable"]
    reason: str
    text: str | None


def _unreachable(reason: str) -> PageFetch:
    return PageFetch("unreachable", reason, None)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED:
            self._skip += 1
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIPPED and self._skip:
            self._skip -= 1
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self.parts.append(data)


def _to_text(body: str, content_type: str) -> str:
    if "html" not in content_type and "xml" not in content_type:
        return body
    parser = _TextExtractor()
    parser.feed(body)
    parser.close()
    text = _SPACES.sub(" ", "".join(parser.parts))
    return _BLANKS.sub("\n", text).strip()


async def _read_limited(response: httpx.Response, max_bytes: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= max_bytes:
            break
    return b"".join(chunks)[:max_bytes]


async def _fetch(url: str, max_bytes: int) -> PageFetch:
    current = url
    async with httpx.AsyncClient(
        timeout=_TIMEOUT,
        headers={"User-Agent": _USER_AGENT},
        transport=url_reachability._transport_override,  # noqa: SLF001
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            try:
                validate_destination_url(current)
            except DestinationUrlError:
                return _unreachable("invalid_url")
            host = urlparse(current).hostname or ""
            blocked = await url_reachability._check_host_is_public(host)  # noqa: SLF001
            if blocked is not None:
                return _unreachable(blocked)
            try:
                async with client.stream("GET", current) as response:
                    location = response.headers.get("location")
                    if 300 <= response.status_code < 400 and location:
                        current = urljoin(current, location)
                        continue
                    if response.status_code != 200:
                        return _unreachable(f"http_{response.status_code}")
                    content_type = response.headers.get("content-type", "").casefold()
                    if not content_type.startswith(_TEXT_TYPES):
                        return _unreachable("unsupported")
                    body = await _read_limited(response, max_bytes)
            except httpx.TimeoutException:
                return _unreachable("timeout")
            except httpx.HTTPError:
                return _unreachable("network_error")
            text = _to_text(body.decode("utf-8", errors="replace"), content_type)
            return PageFetch("ok", "ok", text[:max_bytes])
    return _unreachable("redirect_limit_reached")


async def fetch_page_text(url: str, *, max_bytes: int = MAX_PAGE_BYTES) -> PageFetch:
    """Fetch a page and return its readable text, or why it could not be read.

    Args:
        url: The page to read (model output: never trusted).
        max_bytes: Cut the page at this many bytes.

    Returns:
        ``ok`` with the text, or ``unreachable`` with a reason: ``invalid_url``,
        ``private_address``, ``dns_failure``, ``http_<status>``, ``timeout``,
        ``unsupported``, ``network_error`` or ``redirect_limit_reached``.
    """
    try:
        async with asyncio.timeout(_TOTAL_TIMEOUT):
            return await _fetch(url, max_bytes)
    except TimeoutError:
        return _unreachable("timeout")
