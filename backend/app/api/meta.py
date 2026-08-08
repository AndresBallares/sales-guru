"""Meta Ads connection endpoints (PRD.md build step 6).

Two routers live here: `router` is business-scoped (connect/status/pick
ad-account+Page/disconnect, all behind get_owned_business), and
`callback_router` holds the single OAuth callback Meta itself redirects
the browser to — that path can't be business-scoped, since Meta doesn't
know our URL conventions, only the exact redirect_uri registered on the
app. The callback always ends in a browser redirect back to the frontend,
never a JSON response, since it's a top-level navigation, not an API call.
"""

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Cookie, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from prisma.models import Business, MetaConnection

from app.core.authz import get_owned_business
from app.core.config import get_settings
from app.core.db import db
from app.core.session import SESSION_COOKIE_NAME, get_current_user
from app.schemas.meta import (
    MetaAdAccount,
    MetaConnectionResponse,
    MetaConnectResponse,
    MetaFinalizeRequest,
    MetaPage,
)
from app.services.meta import (
    MetaConnectionError,
    build_authorization_url,
    exchange_code_for_token,
    get_long_lived_token,
    get_meta_user_id,
    list_ad_accounts,
    list_pages,
)

router = APIRouter(prefix="/businesses/{business_id}/meta", tags=["meta"])
callback_router = APIRouter(tags=["meta"])

_CONNECTION_NOT_FOUND = "Meta connection not found"
_STATE_TTL = timedelta(minutes=10)


def _to_response(connection: MetaConnection) -> MetaConnectionResponse:
    """Map a Prisma MetaConnection record to its public response shape.

    Args:
        connection: The Prisma MetaConnection model instance.

    Returns:
        The public-facing representation (never includes accessToken).
    """
    return MetaConnectionResponse(
        id=connection.id,
        business_id=connection.businessId,
        meta_user_id=connection.metaUserId,
        ad_account_id=connection.adAccountId,
        page_id=connection.pageId,
        token_expires_at=connection.tokenExpiresAt,
        created_at=connection.createdAt,
    )


async def _require_connection(business_id: str) -> MetaConnection:
    """Fetch a business's MetaConnection, or 404 if none exists yet.

    Args:
        business_id: The business to look up.

    Returns:
        The MetaConnection.

    Raises:
        HTTPException: 404 if the business hasn't started (or finished)
            connecting Meta yet.
    """
    connection = await db.metaconnection.find_unique(where={"businessId": business_id})
    if connection is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=_CONNECTION_NOT_FOUND
        )
    return connection


@router.get("/connect", response_model=MetaConnectResponse)
async def connect(
    business: Business = Depends(get_owned_business),
) -> MetaConnectResponse:
    """Start a Meta OAuth connection, returning the dialog URL to navigate to.

    Args:
        business: The business to connect, resolved and ownership-checked
            by get_owned_business.

    Returns:
        The authorization URL — the frontend does a full-page navigation
        to it (window.location), not a fetch.

    Raises:
        HTTPException: 500 if the Meta app isn't configured.
    """
    oauth_state = await db.metaoauthstate.create(data={"businessId": business.id})
    try:
        url = build_authorization_url(oauth_state.id)
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc
    return MetaConnectResponse(authorization_url=url)


@router.get("", response_model=MetaConnectionResponse)
async def get_connection(
    business: Business = Depends(get_owned_business),
) -> MetaConnectionResponse:
    """Fetch the current Meta connection status for a business.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The connection — adAccountId/pageId are null until finalize is
        called, which is how the frontend knows to show the picker.

    Raises:
        HTTPException: 404 if no connection has been started yet.
    """
    connection = await _require_connection(business.id)
    return _to_response(connection)


@router.get("/ad-accounts", response_model=list[MetaAdAccount])
async def get_ad_accounts(
    business: Business = Depends(get_owned_business),
) -> list[MetaAdAccount]:
    """List the ad accounts available to pick from, for a pending connection.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The connected Meta user's ad accounts.

    Raises:
        HTTPException: 404 if no connection exists yet; 500 if the Graph
            API call fails.
    """
    connection = await _require_connection(business.id)
    try:
        return await list_ad_accounts(connection.accessToken)
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.get("/pages", response_model=list[MetaPage])
async def get_pages(business: Business = Depends(get_owned_business)) -> list[MetaPage]:
    """List the Pages available to pick from, for a pending connection.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The connected Meta user's Pages.

    Raises:
        HTTPException: 404 if no connection exists yet; 500 if the Graph
            API call fails.
    """
    connection = await _require_connection(business.id)
    try:
        return await list_pages(connection.accessToken)
    except MetaConnectionError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc


@router.post("/finalize", response_model=MetaConnectionResponse)
async def finalize(
    payload: MetaFinalizeRequest,
    business: Business = Depends(get_owned_business),
) -> MetaConnectionResponse:
    """Complete the connection by recording the chosen ad account + Page.

    Args:
        payload: The chosen adAccountId and pageId.
        business: The business, resolved and ownership-checked by
            get_owned_business.

    Returns:
        The now-complete connection.

    Raises:
        HTTPException: 404 if no connection exists yet.
    """
    connection = await _require_connection(business.id)
    updated = await db.metaconnection.update(
        where={"id": connection.id},
        data={"adAccountId": payload.ad_account_id, "pageId": payload.page_id},
    )
    assert updated is not None  # just fetched above, can't vanish mid-request
    return _to_response(updated)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect(business: Business = Depends(get_owned_business)) -> None:
    """Remove a business's Meta connection, if one exists.

    Args:
        business: The business, resolved and ownership-checked by
            get_owned_business.
    """
    await db.metaconnection.delete_many(where={"businessId": business.id})


async def _user_owns_business(user_id: str, business_id: str) -> bool:
    """Check whether a user's organization owns a given business.

    Standalone check (not the usual authz.py dependency chain) because the
    OAuth callback below doesn't have business_id in its path — only in
    the MetaOAuthState row recovered from the `state` param.

    Args:
        user_id: The candidate owner.
        business_id: The business to check.

    Returns:
        True if the business exists and belongs to the user's organization.
    """
    organization = await db.organization.find_first(where={"ownerId": user_id})
    if organization is None:
        return False
    business = await db.business.find_unique(where={"id": business_id})
    return business is not None and business.organizationId == organization.id


@callback_router.get("/meta/callback", include_in_schema=False)
async def meta_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    session: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> RedirectResponse:
    """Handle Meta's OAuth redirect, then send the browser back to the SPA.

    Args:
        code: The authorization code, present on a successful consent.
        state: The MetaOAuthState id passed to build_authorization_url.
        error: Present instead of code if the user denied consent.
        session: The session cookie — still sent, since this is a
            same-site top-level navigation back to our own domain.

    Returns:
        A redirect to the frontend, to `/businesses/{id}?meta=connected`
        on success or `?meta=error` (or `/?meta=error` if the business
        can't even be identified) otherwise. Never a raw JSON error — this
        endpoint is only ever hit via full-page browser navigation.
    """
    frontend_url = get_settings().frontend_url

    def _redirect(business_id: str | None, outcome: str) -> RedirectResponse:
        path = f"/businesses/{business_id}" if business_id else "/"
        return RedirectResponse(f"{frontend_url}{path}?meta={outcome}")

    if error or not code or not state:
        return _redirect(None, "error")

    oauth_state = await db.metaoauthstate.find_unique(where={"id": state})
    if oauth_state is not None:
        await db.metaoauthstate.delete(where={"id": state})
    if oauth_state is None or datetime.now(UTC) - oauth_state.createdAt > _STATE_TTL:
        return _redirect(None, "error")

    business_id = oauth_state.businessId

    if session is None:
        return _redirect(business_id, "error")
    try:
        current_user = await get_current_user(session)
    except HTTPException:
        return _redirect(business_id, "error")

    if not await _user_owns_business(current_user.id, business_id):
        return _redirect(business_id, "error")

    try:
        short_lived_token = await exchange_code_for_token(code)
        access_token, expires_at = await get_long_lived_token(short_lived_token)
        meta_user_id = await get_meta_user_id(access_token)
    except MetaConnectionError:
        return _redirect(business_id, "error")

    await db.metaconnection.upsert(
        where={"businessId": business_id},
        data={
            "create": {
                "businessId": business_id,
                "metaUserId": meta_user_id,
                "accessToken": access_token,
                "tokenExpiresAt": expires_at,
            },
            "update": {
                "metaUserId": meta_user_id,
                "accessToken": access_token,
                "tokenExpiresAt": expires_at,
                "adAccountId": None,
                "pageId": None,
            },
        },
    )

    return _redirect(business_id, "connected")
