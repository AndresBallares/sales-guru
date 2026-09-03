"""Transactional email via Resend's HTTP API.

Raw httpx, not the `resend` package — same "call the vendor's REST API
directly" convention as app/services/meta.py, one fewer dependency for
what's a single simple POST.
"""

import contextlib
from typing import Any

import httpx

_RESEND_API_URL = "https://api.resend.com/emails"


class EmailDeliveryError(Exception):
    """Raised when Resend rejects or fails to deliver an email."""


async def send_email(
    *, api_key: str, from_address: str, to: str, subject: str, html: str
) -> None:
    """Send one transactional email via Resend.

    Args:
        api_key: Resend API key (app.core.config.Settings.resend_api_key).
        from_address: The "From" address (Settings.email_from).
        to: The recipient's email address.
        subject: The email subject line.
        html: The email body, as HTML.

    Raises:
        EmailDeliveryError: On a network failure or a non-2xx response.
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                _RESEND_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from": from_address,
                    "to": [to],
                    "subject": subject,
                    "html": html,
                },
            )
    except httpx.HTTPError as exc:
        raise EmailDeliveryError(f"Resend call failed: {exc}") from exc

    if response.is_error:
        body: dict[str, Any] = {}
        with contextlib.suppress(ValueError):
            body = response.json()
        message = body.get("message", response.text)
        raise EmailDeliveryError(f"Resend call failed: {message}")
