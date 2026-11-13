"""The test-suite guard that fails a test which tries to reach a real network host."""

import socket

import httpx
import pytest
from app.core.config import get_settings

from tests.network_guard import assert_no_attempts, take_attempts

GRAPH_BASE = "https://graph.facebook.com/" + get_settings().meta_graph_version


def test_a_connection_to_a_public_address_is_refused_and_recorded() -> None:
    with pytest.raises(ConnectionRefusedError, match="blocked in tests"):
        socket.create_connection(("93.184.216.34", 80), timeout=1)

    assert take_attempts() == ["connect to 93.184.216.34:80"]


def test_loopback_connections_still_work() -> None:
    # The Prisma query engine and the app's own test servers live on localhost.
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        port = server.getsockname()[1]
        with socket.create_connection(("127.0.0.1", port), timeout=2):
            pass

    assert take_attempts() == []


def test_a_dns_lookup_of_a_public_name_is_refused_and_recorded() -> None:
    with pytest.raises(socket.gaierror, match="blocked in tests"):
        socket.getaddrinfo("graph.facebook.com", 443)

    assert take_attempts() == ["DNS lookup of graph.facebook.com"]


def test_localhost_and_ip_literals_resolve_without_a_lookup() -> None:
    assert socket.getaddrinfo("localhost", 80)
    assert socket.getaddrinfo("127.0.0.1", 80)

    assert take_attempts() == []


def test_the_attempts_are_cleared_once_taken() -> None:
    with pytest.raises(socket.gaierror):
        socket.getaddrinfo("example.org", 80)

    assert len(take_attempts()) == 1
    assert take_attempts() == []


def test_assert_no_attempts_names_every_host_and_then_clears() -> None:
    with pytest.raises(socket.gaierror):
        socket.getaddrinfo("graph.facebook.com", 443)
    with pytest.raises(ConnectionRefusedError):
        socket.create_connection(("93.184.216.34", 80), timeout=1)

    with pytest.raises(AssertionError) as raised:
        assert_no_attempts()

    message = str(raised.value)
    assert "real network" in message
    assert "DNS lookup of graph.facebook.com" in message
    assert "connect to 93.184.216.34:80" in message
    assert_no_attempts()  # cleared: a second check passes


def test_assert_no_attempts_passes_when_there_were_none() -> None:
    assert_no_attempts()


@pytest.mark.asyncio
async def test_an_httpx_call_to_meta_is_caught_like_any_other() -> None:
    async with httpx.AsyncClient() as client:
        with pytest.raises(httpx.ConnectError):
            await client.get(f"{GRAPH_BASE}/me")

    assert any("graph.facebook.com" in a for a in take_attempts())
