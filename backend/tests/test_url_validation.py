"""Tests for validate_destination_url — the single source of truth for
ad-destination URL rules (CLAUDE.md)."""

import pytest
from app.services.url_validation import DestinationUrlError, validate_destination_url


def test_accepts_a_valid_https_url() -> None:
    assert validate_destination_url("https://acme.example/ring") == (
        "https://acme.example/ring"
    )


def test_accepts_a_valid_http_url() -> None:
    assert validate_destination_url("http://acme.example/ring") == (
        "http://acme.example/ring"
    )


def test_normalizes_a_missing_scheme_to_https() -> None:
    assert validate_destination_url("acme.example/ring") == "https://acme.example/ring"


def test_normalizes_surrounding_whitespace() -> None:
    assert validate_destination_url("  https://acme.example  ") == (
        "https://acme.example"
    )


def test_normalizes_whitespace_around_a_schemeless_value() -> None:
    assert validate_destination_url("  acme.example  ") == "https://acme.example"


def test_rejects_a_javascript_scheme() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("javascript:alert(1)")


def test_rejects_an_ftp_scheme() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("ftp://acme.example/file")


def test_rejects_a_mailto_scheme() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("mailto:hello@acme.example")


def test_rejects_a_data_scheme() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("data:text/plain;base64,SGVsbG8=")


def test_rejects_localhost() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("http://localhost:8000")


def test_rejects_localhost_case_insensitively() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("http://LOCALHOST")


def test_rejects_a_public_bare_ip() -> None:
    """Ad destinations must be real domains, not addresses at all —
    public IPs are rejected too, not just private ones."""
    with pytest.raises(DestinationUrlError):
        validate_destination_url("http://8.8.8.8")


@pytest.mark.parametrize(
    "host",
    [
        "10.0.0.5",
        "172.16.0.1",
        "172.31.255.255",
        "192.168.1.1",
        "127.0.0.1",
        "169.254.1.1",
    ],
)
def test_rejects_private_ipv4_ranges(host: str) -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url(f"http://{host}")


def test_rejects_ipv6_loopback() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("http://[::1]")


def test_rejects_a_hostname_with_no_tld() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("http://intranet")


def test_rejects_an_overlength_url() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("https://acme.example/" + "a" * 2048)


def test_rejects_an_empty_string() -> None:
    with pytest.raises(DestinationUrlError):
        validate_destination_url("   ")


def test_error_message_is_human_readable() -> None:
    with pytest.raises(DestinationUrlError, match="full web address"):
        validate_destination_url("not a url")
