"""The runner's own page fetch, used to verify quotes (Phase 7b)."""

import httpx
import pytest
from app.services import url_reachability
from app.services.research_pages import fetch_page_text

pytestmark = pytest.mark.asyncio

_PAGE = (
    "<html><head><title>T</title><style>.x{}</style><script>var secret=1;</script>"
    "</head><body><p>I can&#39;t find a ring that fits.</p><div>Second&nbsp;line</div>"
    "</body></html>"
)


@pytest.fixture
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        url_reachability, "_resolve_hostname_ips", lambda host: ["93.184.216.34"]
    )


def _serve(
    monkeypatch: pytest.MonkeyPatch, handler: httpx.MockTransport
) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    inner = handler.handler

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        result = inner(request)
        assert isinstance(result, httpx.Response)
        return result

    monkeypatch.setattr(
        url_reachability, "_transport_override", httpx.MockTransport(record)
    )
    return seen


async def test_html_becomes_plain_text(
    monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    _serve(
        monkeypatch,
        httpx.MockTransport(
            lambda r: httpx.Response(
                200, text=_PAGE, headers={"content-type": "text/html; charset=utf-8"}
            )
        ),
    )
    result = await fetch_page_text("https://forum.example.com/t/1")
    assert result.status == "ok"
    assert result.text is not None
    assert "I can't find a ring that fits." in result.text
    assert "Second line" in result.text
    assert "secret" not in result.text
    assert "<p>" not in result.text


@pytest.mark.parametrize(("code", "reason"), [(403, "http_403"), (404, "http_404")])
async def test_http_errors_are_unreachable(
    monkeypatch: pytest.MonkeyPatch, public_dns: None, code: int, reason: str
) -> None:
    _serve(monkeypatch, httpx.MockTransport(lambda r: httpx.Response(code)))
    result = await fetch_page_text("https://www.trustpilot.com/review/x")
    assert (result.status, result.reason, result.text) == ("unreachable", reason, None)


async def test_timeout_is_unreachable(
    monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    _serve(monkeypatch, httpx.MockTransport(boom))
    result = await fetch_page_text("https://slow.example.com/")
    assert (result.status, result.reason) == ("unreachable", "timeout")


async def test_private_address_is_refused_before_any_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        url_reachability, "_resolve_hostname_ips", lambda host: ["10.0.0.5"]
    )
    seen = _serve(monkeypatch, httpx.MockTransport(lambda r: httpx.Response(200)))
    result = await fetch_page_text("https://internal.example.com/")
    assert (result.status, result.reason) == ("unreachable", "private_address")
    assert seen == []


async def test_redirect_to_a_private_host_is_not_followed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def resolve(host: str) -> list[str]:
        return ["10.0.0.5"] if host == "evil.example.net" else ["93.184.216.34"]

    monkeypatch.setattr(url_reachability, "_resolve_hostname_ips", resolve)
    seen = _serve(
        monkeypatch,
        httpx.MockTransport(
            lambda r: httpx.Response(
                302, headers={"location": "https://evil.example.net/x"}
            )
        ),
    )
    result = await fetch_page_text("https://ok.example.com/")
    assert (result.status, result.reason) == ("unreachable", "private_address")
    assert len(seen) == 1


@pytest.mark.parametrize("url", ["http://localhost/x", "ftp://example.com/x", "nope"])
async def test_invalid_or_internal_urls_are_refused(url: str) -> None:
    result = await fetch_page_text(url)
    assert (result.status, result.reason) == ("unreachable", "invalid_url")


async def test_non_text_content_is_unreachable(
    monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    _serve(
        monkeypatch,
        httpx.MockTransport(
            lambda r: httpx.Response(
                200, content=b"%PDF", headers={"content-type": "application/pdf"}
            )
        ),
    )
    result = await fetch_page_text("https://example.com/a.pdf")
    assert (result.status, result.reason) == ("unreachable", "unsupported")


async def test_a_huge_page_is_cut_at_the_size_limit(
    monkeypatch: pytest.MonkeyPatch, public_dns: None
) -> None:
    _serve(
        monkeypatch,
        httpx.MockTransport(
            lambda r: httpx.Response(
                200, text="word " * 10_000, headers={"content-type": "text/plain"}
            )
        ),
    )
    result = await fetch_page_text("https://example.com/big", max_bytes=1_000)
    assert result.status == "ok"
    assert result.text is not None
    assert len(result.text) <= 1_000
