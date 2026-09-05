"""Destination URL validation — the one place any ad destination URL gets checked.

CLAUDE.md: all URL validation goes through validate_destination_url; never
add an ad-hoc regex.

Product.url is the only field that flows through this today, but the same
function is called from every place a URL enters the system — product
creation, campaign creation with a product attached, and the
campaign-product binding endpoint (app/api/campaign.py's update_campaign)
— so the rules can never drift between call sites.
"""

import ipaddress
from urllib.parse import urlparse

_ALLOWED_SCHEMES = frozenset({"http", "https"})
_MAX_URL_LENGTH = 2048

_ERROR_MESSAGE = "Please enter a full web address, e.g. https://yourshop.com/ring"

# Objectives whose CTA button has to send someone somewhere real (confirmed
# 2026-09-05): SALES/TRAFFIC. The others (LEADS, MESSAGES, AWARENESS) don't
# strictly need a product-level destination — awareness in particular is
# often run with no click-through destination at all. This only decides
# whether *Product.url* is required at creation/binding time; publish.py's
# own destination-URL check is separate and always requires *some* link
# (product.url or business.website) regardless of objective, since Meta's
# ad creative needs one either way.
_OBJECTIVES_REQUIRING_URL = frozenset({"SALES", "TRAFFIC"})


def requires_destination_url(objective: str) -> bool:
    """Whether a campaign with this objective requires its product to have a URL.

    Args:
        objective: A Campaign.objective value.

    Returns:
        True for SALES/TRAFFIC — the CTA button needs somewhere to send
        people. False for the other objectives, where a destination is
        optional at the product level.
    """
    return objective in _OBJECTIVES_REQUIRING_URL


class DestinationUrlError(ValueError):
    """A destination URL failed validation.

    The message is written to be shown to the user as-is (a Pydantic
    field_validator raising this becomes a 422 with this text).
    """

    def __init__(self) -> None:
        """Build the error with the fixed, user-facing message."""
        super().__init__(_ERROR_MESSAGE)


def _is_ip_literal(hostname: str) -> bool:
    """True if hostname parses as an IP address at all (v4 or v6).

    A bare IP is rejected outright regardless of whether it's public or
    private — an ad destination should be a real domain, not an address.
    """
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return True


def validate_destination_url(raw: str) -> str:
    """Normalize and validate a URL meant as an ad's click-through destination.

    Rules (backend is authoritative; the frontend only mirrors these for
    inline feedback):
    - Trimmed of surrounding whitespace.
    - A missing scheme is treated as https:// (so "myshop.com/ring" becomes
      "https://myshop.com/ring").
    - Only http/https are allowed — no javascript:, ftp:, mailto:, data:.
    - No localhost, no bare IP literal (public or private — SSRF guard;
      Phase 2's reachability check re-guards this after DNS resolution,
      since a redirect can point anywhere), no reserved network host.
    - The hostname needs a dot (a TLD) — "http://intranet" doesn't qualify.
    - At most 2048 characters.

    Args:
        raw: The user-entered value, as typed.

    Returns:
        The normalized URL to store.

    Raises:
        DestinationUrlError: If the value can't be turned into a valid,
            public http(s) URL. The message is user-facing.
    """
    value = raw.strip()
    if not value or len(value) > _MAX_URL_LENGTH:
        raise DestinationUrlError

    # A value with no scheme at all (e.g. "myshop.com/ring") gets one
    # assumed; a value with any other scheme (mailto:, javascript:, ...)
    # is left alone here and rejected by the scheme check below — "no
    # scheme" is judged by urlparse itself, not by checking for "://",
    # since e.g. "mailto:a@b.com" has a real scheme without "//".
    if not urlparse(value).scheme:
        value = f"https://{value}"

    parsed = urlparse(value)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise DestinationUrlError

    hostname = parsed.hostname
    if not hostname:
        raise DestinationUrlError
    if hostname.lower() == "localhost":
        raise DestinationUrlError
    if _is_ip_literal(hostname):
        raise DestinationUrlError
    if "." not in hostname:
        raise DestinationUrlError

    return value
