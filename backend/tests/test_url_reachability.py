"""Tests for check_url_reachable — Phase 2 scaffold (CLAUDE.md).

Every test mocks both the httpx transport (no real network) and DNS
resolution (no real lookups) — url_reachability's SSRF re-check runs a
real socket.getaddrinfo call per hop that these tests need full control
over, e.g. to simulate a redirect landing on a private IP.
"""

import socket
import ssl
from collections.abc import Callable

import httpx
import pytest
from app.services import url_reachability
from app.services.url_reachability import ReachabilityResult, check_url_reachable


@pytest.fixture(autouse=True)
def _no_real_dns(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, str]], None]:
    """Fake DNS: every hostname resolves to a public IP unless configured.

    Returns a setter tests can use to override specific hostnames (e.g.
    to point one at a private address).
    """
    hosts = {"acme.example": "93.184.216.34"}

    def _resolve(hostname: str) -> list[str]:
        return [hosts[hostname]]

    monkeypatch.setattr(url_reachability, "_resolve_hostname_ips", _resolve)

    def _set(overrides: dict[str, str]) -> None:
        hosts.update(overrides)

    return _set


@pytest.fixture(autouse=True)
def _no_real_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> Callable[[httpx.MockTransport], None]:
    """Install a mocked httpx transport in place of the real network."""

    def _set(transport: httpx.MockTransport) -> None:
        monkeypatch.setattr(url_reachability, "_transport_override", transport)

    return _set


@pytest.mark.asyncio
async def test_check_url_reachable_for_a_plain_200(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "HEAD"
        return httpx.Response(200)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/ring")

    assert result == ReachabilityResult(
        reachable=True,
        reason="ok",
        status_code=200,
        final_url="https://acme.example/ring",
    )


@pytest.mark.asyncio
async def test_check_url_reachable_follows_a_redirect_to_200(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/old":
            return httpx.Response(301, headers={"location": "https://acme.example/new"})
        return httpx.Response(200)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/old")

    assert result.reachable is True
    assert result.status_code == 200
    assert result.final_url == "https://acme.example/new"


@pytest.mark.asyncio
async def test_check_url_reachable_for_a_404(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/gone")

    assert result == ReachabilityResult(
        reachable=False,
        reason="http_error",
        status_code=404,
        final_url="https://acme.example/gone",
    )


@pytest.mark.asyncio
async def test_check_url_reachable_for_a_timeout(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/slow")

    assert result == ReachabilityResult(
        reachable=False,
        reason="timeout",
        status_code=None,
        final_url="https://acme.example/slow",
    )


@pytest.mark.asyncio
async def test_check_url_reachable_retries_a_405_with_get(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "HEAD":
            return httpx.Response(405)
        return httpx.Response(200)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/head-not-allowed")

    assert result.reachable is True
    assert result.status_code == 200


@pytest.mark.asyncio
async def test_check_url_reachable_rejects_a_redirect_to_a_private_ip(
    _no_real_dns: Callable[[dict[str, str]], None],
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    _no_real_dns({"internal.example": "10.0.0.5"})

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "acme.example":
            return httpx.Response(302, headers={"location": "http://internal.example/"})
        raise AssertionError("should never reach the private host")

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/redirect")

    assert result.reachable is False
    assert result.reason == "private_address"


@pytest.mark.asyncio
async def test_check_url_reachable_for_a_dns_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _raise(hostname: str) -> list[str]:
        raise socket.gaierror("Name or service not known")

    monkeypatch.setattr(url_reachability, "_resolve_hostname_ips", _raise)

    result = await check_url_reachable("https://does-not-resolve.example/ring")

    assert result == ReachabilityResult(
        reachable=False,
        reason="dns_failure",
        final_url="https://does-not-resolve.example/ring",
    )


@pytest.mark.asyncio
async def test_check_url_reachable_for_a_tls_error(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(
            "certificate verify failed", request=request
        ) from ssl.SSLCertVerificationError("certificate verify failed")

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/bad-cert")

    assert result.reachable is False
    assert result.reason == "tls_error"


@pytest.mark.asyncio
async def test_check_url_reachable_rejects_an_unsupported_scheme() -> None:
    result = await check_url_reachable("ftp://acme.example/file")

    assert result == ReachabilityResult(
        reachable=False, reason="invalid_url", final_url="ftp://acme.example/file"
    )


@pytest.mark.asyncio
async def test_check_url_reachable_treats_a_locationless_redirect_as_reachable(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(304)

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/cached")

    assert result == ReachabilityResult(
        reachable=True,
        reason="ok",
        status_code=304,
        final_url="https://acme.example/cached",
    )


@pytest.mark.asyncio
async def test_check_url_reachable_stops_after_the_redirect_limit(
    _no_real_transport: Callable[[httpx.MockTransport], None],
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        next_n = int(request.url.path.removeprefix("/r")) + 1
        return httpx.Response(
            302, headers={"location": f"https://acme.example/r{next_n}"}
        )

    _no_real_transport(httpx.MockTransport(handler))

    result = await check_url_reachable("https://acme.example/r0")

    assert result.reachable is True
    assert result.reason == "redirect_limit_reached"
