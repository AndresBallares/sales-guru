"""Destination URL reachability check — Phase 2 scaffold (CLAUDE.md).

validate_destination_url (app/services/url_validation.py) only checks
*format* — this checks whether the URL actually resolves to something
live, for a business that wants to confirm its destination before
committing to it. Not wired into product create/update or campaign-product
binding, and not called from publish — it's exposed standalone at
POST .../products/{id}/check-url, gated behind
Settings.url_reachability_check_enabled (off by default). Wiring it into
the pre-publish step for SALES/TRAFFIC campaigns is future work.

Redirects are followed one hop at a time rather than letting httpx
auto-follow them, because each hop's resolved IP has to be re-checked
against the private/reserved ranges validate_destination_url already
guards against at the syntax level — a redirect can point anywhere
regardless of what the original hostname resolved to (SSRF).
"""

import asyncio
import socket
import ssl
from dataclasses import dataclass
from ipaddress import ip_address
from typing import Literal
from urllib.parse import urljoin, urlparse

import httpx

_MAX_REDIRECTS = 5
_CONNECT_TIMEOUT = 5.0
_READ_TIMEOUT = 5.0
_ALLOWED_SCHEMES = frozenset({"http", "https"})
_RETRY_ON_STATUS = frozenset({405, 501})
_USER_AGENT = "SalesGuruURLChecker/1.0 (+https://salesguru.example)"

# None in production (httpx dials the real network). Tests monkeypatch this
# to an httpx.MockTransport so check_url_reachable's signature doesn't need
# a test-only transport parameter.
_transport_override: httpx.AsyncBaseTransport | None = None

ReachabilityReason = Literal[
    "ok",
    "redirect_limit_reached",
    "http_error",
    "timeout",
    "dns_failure",
    "tls_error",
    "private_address",
    "invalid_url",
]


@dataclass(frozen=True)
class ReachabilityResult:
    """The outcome of a single check_url_reachable call.

    Attributes:
        reachable: True for a final 2xx, or a 3xx reached only because the
            redirect limit ran out (still a live, responding server).
        reason: A machine-readable code — "ok" when reachable, otherwise
            one of the distinct failure reasons below.
        status_code: The last HTTP status seen, if a request completed at
            all (None for timeout/dns_failure/tls_error/invalid_url).
        final_url: The URL the check stopped at — the original one unless
            a redirect moved it.
    """

    reachable: bool
    reason: ReachabilityReason
    status_code: int | None = None
    final_url: str | None = None


def _resolve_hostname_ips(hostname: str) -> list[str]:
    """Resolve a hostname to its IP addresses (blocking; run off-thread).

    Split out as its own function so tests can monkeypatch DNS resolution
    without touching the network.

    Args:
        hostname: The hostname to resolve.

    Returns:
        The resolved IP addresses, as strings.

    Raises:
        socket.gaierror: If resolution fails.
    """
    infos = socket.getaddrinfo(hostname, None)
    return [str(info[4][0]) for info in infos]


async def _check_host_is_public(hostname: str) -> ReachabilityReason | None:
    """Resolve hostname and confirm every address is a public one.

    The same SSRF guard as validate_destination_url's _is_ip_literal, but
    applied post-DNS — a hostname that passed the syntactic check can
    still resolve to a private/reserved address, and a redirect can send
    this function a hostname the original URL never mentioned at all.

    Args:
        hostname: The hostname to resolve and check.

    Returns:
        None if every resolved address is public. Otherwise the reason
        the host is rejected ("dns_failure" or "private_address").
    """
    try:
        ips = await asyncio.to_thread(_resolve_hostname_ips, hostname)
    except socket.gaierror:
        return "dns_failure"
    for raw_ip in ips:
        addr = ip_address(raw_ip)
        if (
            addr.is_private
            or addr.is_loopback
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_multicast
        ):
            return "private_address"
    return None


async def _probe_once(client: httpx.AsyncClient, url: str) -> tuple[int, str | None]:
    """Send one HEAD request, falling back to a bodyless GET on 405/501.

    Args:
        client: The client to send the request with.
        url: The URL to probe.

    Returns:
        (status_code, the Location header if present).
    """
    response = await client.head(url)
    if response.status_code not in _RETRY_ON_STATUS:
        return response.status_code, response.headers.get("location")

    async with client.stream("GET", url) as streamed:
        return streamed.status_code, streamed.headers.get("location")


async def check_url_reachable(url: str) -> ReachabilityResult:
    """Check whether a destination URL actually resolves to something live.

    Args:
        url: The URL to check (already format-validated by
            validate_destination_url — this only adds a live reachability
            check on top).

    Returns:
        The outcome — see ReachabilityResult.
    """
    current_url = url
    timeout = httpx.Timeout(
        connect=_CONNECT_TIMEOUT,
        read=_READ_TIMEOUT,
        write=_READ_TIMEOUT,
        pool=_READ_TIMEOUT,
    )
    async with httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": _USER_AGENT},
        transport=_transport_override,
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            parsed = urlparse(current_url)
            if parsed.scheme not in _ALLOWED_SCHEMES or not parsed.hostname:
                return ReachabilityResult(
                    reachable=False, reason="invalid_url", final_url=current_url
                )

            host_reason = await _check_host_is_public(parsed.hostname)
            if host_reason is not None:
                return ReachabilityResult(
                    reachable=False, reason=host_reason, final_url=current_url
                )

            try:
                status_code, location = await _probe_once(client, current_url)
            except httpx.TimeoutException:
                return ReachabilityResult(
                    reachable=False, reason="timeout", final_url=current_url
                )
            except httpx.ConnectError as exc:
                reason: ReachabilityReason = (
                    "tls_error"
                    if isinstance(exc.__cause__, ssl.SSLError)
                    else "dns_failure"
                )
                return ReachabilityResult(
                    reachable=False, reason=reason, final_url=current_url
                )

            if 200 <= status_code < 300:
                return ReachabilityResult(
                    reachable=True,
                    reason="ok",
                    status_code=status_code,
                    final_url=current_url,
                )
            if 300 <= status_code < 400 and location:
                current_url = urljoin(current_url, location)
                continue
            if 300 <= status_code < 400:
                return ReachabilityResult(
                    reachable=True,
                    reason="ok",
                    status_code=status_code,
                    final_url=current_url,
                )
            return ReachabilityResult(
                reachable=False,
                reason="http_error",
                status_code=status_code,
                final_url=current_url,
            )

        return ReachabilityResult(
            reachable=True, reason="redirect_limit_reached", final_url=current_url
        )
