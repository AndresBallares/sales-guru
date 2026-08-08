"""Authentication endpoints."""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from prisma.errors import UniqueViolationError
from prisma.models import User

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
from app.schemas.auth import LoginRequest, SignupRequest, UserResponse

router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_ALREADY_REGISTERED = "Email already registered"
_INVALID_CREDENTIALS = "Invalid email or password"


def _set_session_cookie(response: Response, token: str) -> None:
    """Attach a session cookie to the response.

    Args:
        response: The response to attach the cookie to.
        token: The raw session token.
    """
    settings = get_settings()
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
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
    response.delete_cookie(SESSION_COOKIE_NAME)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    """Return the currently authenticated user.

    Args:
        current_user: Resolved from the session cookie.

    Returns:
        The current user's public representation.
    """
    return UserResponse(id=current_user.id, email=current_user.email)
