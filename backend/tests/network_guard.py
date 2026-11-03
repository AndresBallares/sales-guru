"""Fail a test that tries to reach a real network host.

A test that quietly calls a real service (Meta's Graph API, Anthropic, any website)
passes or fails depending on what that service answers that day: on 2026-11-03 a
publish test got an HTML "4xx Client Error" page from Meta on CI and failed, though
nothing in its pull request had changed. This guard makes every such call fail the
test that made it, naming the host, on every run.

It patches ``socket`` once, when tests/conftest.py imports it:

- a connection to anything but this machine is refused (``ConnectionRefusedError``)
  and recorded, so code that handles an unreachable host still behaves like it;
- a DNS lookup of a name that is not this machine is refused and recorded;
- loopback (127.0.0.0/8, ::1, localhost) and Unix sockets stay open: the Prisma query
  engine and the test servers live there.

Because code under test may catch the refusal, the record is the proof:
``assert_no_attempts`` (run after every test by an autouse fixture in conftest)
fails the test if anything was recorded.
"""

import ipaddress
import socket
from typing import Any

_attempts: list[str] = []
_LOCAL_NAMES = frozenset({"localhost", "ip6-localhost", "0.0.0.0", "::", ""})  # noqa: S104
_installed = False


def _is_local(host: object) -> bool:
    if host is None:
        return True
    name = host.decode() if isinstance(host, bytes) else str(host)
    if name.lower() in _LOCAL_NAMES:
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def _is_ip_literal(host: object) -> bool:
    name = host.decode() if isinstance(host, bytes) else str(host)
    try:
        ipaddress.ip_address(name)
    except ValueError:
        return False
    return True


def take_attempts() -> list[str]:
    """Return what was blocked since the last call, and forget it.

    Returns:
        One line per blocked connection or lookup, in order.
    """
    taken = list(_attempts)
    _attempts.clear()
    return taken


def assert_no_attempts() -> None:
    """Fail if a real network call was attempted since the last check.

    Raises:
        AssertionError: Naming every host that was tried. The record is cleared
            first, so one offending test does not fail the tests after it.
    """
    attempts = take_attempts()
    if attempts:
        listed = "\n".join(f"  - {attempt}" for attempt in attempts)
        raise AssertionError(
            "A test tried to reach the real network "
            f"(blocked by tests/network_guard.py):\n{listed}\n"
            "Mock the call (or the fixture that mocks it); do not use the real service."
        )


def install() -> None:
    """Patch ``socket`` so non-local connections and lookups are refused and recorded.

    Safe to call more than once.
    """
    global _installed  # noqa: PLW0603
    if _installed:
        return
    _installed = True
    real_connect = socket.socket.connect
    real_connect_ex = socket.socket.connect_ex
    real_getaddrinfo = socket.getaddrinfo

    def _refuse_connect(address: object) -> str | None:
        if isinstance(address, tuple) and address and not _is_local(address[0]):
            port = address[1] if len(address) > 1 else "?"
            return f"connect to {address[0]}:{port}"
        return None

    def connect(self: socket.socket, address: Any) -> None:  # noqa: ANN401
        blocked = _refuse_connect(address)
        if blocked:
            _attempts.append(blocked)
            raise ConnectionRefusedError(
                f"real network call blocked in tests: {blocked}"
            )
        real_connect(self, address)

    def connect_ex(self: socket.socket, address: Any) -> int:  # noqa: ANN401
        blocked = _refuse_connect(address)
        if blocked:
            _attempts.append(blocked)
            return 111  # ECONNREFUSED
        return real_connect_ex(self, address)

    def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:  # noqa: ANN401
        if not _is_local(host) and not _is_ip_literal(host):
            name = host.decode() if isinstance(host, bytes) else str(host)
            _attempts.append(f"DNS lookup of {name}")
            raise socket.gaierror(
                socket.EAI_NONAME, f"real DNS lookup blocked in tests: {name}"
            )
        return real_getaddrinfo(host, *args, **kwargs)

    socket.socket.connect = connect  # type: ignore[method-assign,assignment]  # ty: ignore[invalid-assignment]
    socket.socket.connect_ex = connect_ex  # type: ignore[method-assign,assignment]  # ty: ignore[invalid-assignment]
    socket.getaddrinfo = getaddrinfo  # ty: ignore[invalid-assignment]
