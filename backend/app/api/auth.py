"""Authentication endpoints."""

import logging
from typing import Literal

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from prisma.errors import UniqueViolationError
from prisma.models import User

from app.core import password_reset
from app.core.config import get_settings
from app.core.db import db
from app.core.security import hash_password, verify_password
from app.core.session import (
    SESSION_COOKIE_NAME,
    SESSION_TTL,
    create_session,
    delete_session,
    get_current_user,
)
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    MessageResponse,
    ResetPasswordRequest,
    SignupRequest,
    UserResponse,
)
from app.services.email import EmailDeliveryError, send_email

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

_EMAIL_ALREADY_REGISTERED = "Email already registered"
_INVALID_CREDENTIALS = "Invalid email or password"
_EMAIL_NOT_CONFIGURED = "Password reset email is not configured"
_RESET_REQUESTED = "If that email is registered, we've sent a password reset link."
_RESET_LINK_INVALID = "This reset link is invalid or has expired."
_RESET_SUCCESS = "Your password has been reset. You can now log in."


def _cookie_cross_site_attrs() -> tuple[bool, Literal["lax", "none"]]:
    """(secure, samesite) for the session cookie, environment-dependent.

    Dev: frontend and backend share localhost (different ports only), a
    same-site relationship — "lax" works and needs no HTTPS. Production:
    frontend and backend are separate Render services on different
    subdomains (PRD.md §6/§4's "known gap" note, resolved 2026-09-02) —
    a genuinely cross-site relationship, which browsers only send a
    cookie on if it's "SameSite=None; Secure" (the "Secure" attribute is
    mandatory whenever SameSite=None, not just recommended — browsers
    reject the cookie outright otherwise).

    Returns:
        (secure, samesite) to pass to both set_cookie and delete_cookie —
        deleting a cookie needs matching attributes to reliably clear it,
        not just a matching name.
    """
    if get_settings().environment == "production":
        return True, "none"
    return False, "lax"


def _set_session_cookie(response: Response, token: str) -> None:
    """Attach a session cookie to the response.

    Args:
        response: The response to attach the cookie to.
        token: The raw session token.
    """
    secure, samesite = _cookie_cross_site_attrs()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=secure,
        samesite=samesite,
        max_age=int(SESSION_TTL.total_seconds()),
    )


@router.post(
    "/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED
)
async def signup(payload: SignupRequest, response: Response) -> UserResponse:
    """Create a new user account with an auto-provisioned organization.

    The organization is invisible plumbing for MVP — every business the
    user creates hangs off of it (PRD.md §2, §7) — not something the user
    names or sees at signup. Signup logs the user in immediately.

    Args:
        payload: The signup request (email + password).
        response: The response to attach the new session cookie to.

    Returns:
        The newly created user's public representation.

    Raises:
        HTTPException: 409 if the email is already registered.
    """
    existing = await db.user.find_unique(where={"email": payload.email})
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_ALREADY_REGISTERED
        )

    org_name = f"{payload.email.split('@')[0]}'s Organization"

    try:
        user = await db.user.create(
            data={
                "email": payload.email,
                "hashedPassword": hash_password(payload.password),
                "organizations": {"create": [{"name": org_name}]},
            }
        )
    except UniqueViolationError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=_EMAIL_ALREADY_REGISTERED
        ) from exc

    token = await create_session(user.id)
    _set_session_cookie(response, token)
    return UserResponse(id=user.id, email=user.email)


@router.post("/login", response_model=UserResponse)
async def login(payload: LoginRequest, response: Response) -> UserResponse:
    """Log into an existing account.

    Args:
        payload: The login request (email + password).
        response: The response to attach the new session cookie to.

    Returns:
        The authenticated user's public representation.

    Raises:
        HTTPException: 401 if the email/password combination is invalid.
    """
    user = await db.user.find_unique(where={"email": payload.email})
    if user is None or not verify_password(payload.password, user.hashedPassword):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=_INVALID_CREDENTIALS
        )

    token = await create_session(user.id)
    _set_session_cookie(response, token)
    return UserResponse(id=user.id, email=user.email)


def _reset_email_html(reset_url: str) -> str:
    """The forgot-password email body."""
    return (
        "<p>Click the link below to reset your Sales Guru password. This "
        "link expires in 1 hour and can only be used once.</p>"
        f'<p><a href="{reset_url}">{reset_url}</a></p>'
        "<p>If you didn't request this, you can safely ignore this email.</p>"
    )


@router.post("/forgot-password", response_model=MessageResponse)
async def forgot_password(payload: ForgotPasswordRequest) -> MessageResponse:
    """Request a password reset link.

    Always returns the same generic message regardless of whether the
    email is registered, already rate-limited, or the send itself fails
    — an attacker probing which emails have accounts learns nothing from
    the response either way. RESEND_API_KEY missing is the one exception
    (a deployment misconfiguration, not a per-account signal — it fails
    identically for every request until fixed).

    Args:
        payload: The forgot-password request (email only).

    Returns:
        A generic confirmation message.

    Raises:
        HTTPException: 500 if RESEND_API_KEY isn't configured.
    """
    settings = get_settings()
    if settings.resend_api_key is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=_EMAIL_NOT_CONFIGURED,
        )

    user = await db.user.find_unique(where={"email": payload.email})
    if user is not None and not await password_reset.is_rate_limited(user.id):
        token = await password_reset.create_reset_token(user.id)
        reset_url = f"{settings.frontend_url}/reset-password?token={token}"
        try:
            await send_email(
                api_key=settings.resend_api_key,
                from_address=settings.email_from,
                to=user.email,
                subject="Reset your Sales Guru password",
                html=_reset_email_html(reset_url),
            )
        except EmailDeliveryError:
            logger.warning("Failed to send password reset email for user %s", user.id)

    return MessageResponse(message=_RESET_REQUESTED)


@router.post("/reset-password", response_model=MessageResponse)
async def reset_password(payload: ResetPasswordRequest) -> MessageResponse:
    """Reset a password using a valid, unexpired, unused reset token.

    Also invalidates every existing session for the account — if someone
    else had the account open, a reset kicks them out immediately, same
    as any compromised-password reset should.

    Args:
        payload: The reset request (raw token + new password).

    Returns:
        A confirmation message.

    Raises:
        HTTPException: 400 if the token is missing, already used, or expired.
    """
    record = await password_reset.find_valid_token(payload.token)
    if record is None or record.user is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=_RESET_LINK_INVALID
        )

    await db.user.update(
        where={"id": record.user.id},
        data={"hashedPassword": hash_password(payload.new_password)},
    )
    await password_reset.mark_token_used(record.id)
    await db.session.delete_many(where={"userId": record.user.id})

    return MessageResponse(message=_RESET_SUCCESS)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> None:
    """Log out of the current session, if any.

    Invalidates the session server-side (not just clearing the cookie) so
    the token can't be replayed even if it leaked before logout.

    Args:
        response: The response to clear the session cookie on.
        session: The raw session token from the request cookie.
    """
    if session is not None:
        await delete_session(session)
    secure, samesite = _cookie_cross_site_attrs()
    response.delete_cookie(SESSION_COOKIE_NAME, secure=secure, samesite=samesite)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user.

    Args:
        current_user: Resolved from the session cookie.

    Returns:
        The current user's public representation.
    """
    return UserResponse(id=current_user.id, email=current_user.email)
