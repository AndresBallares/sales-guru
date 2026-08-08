"""Schemas for the Meta Ads connection (PRD.md build step 6)."""

from datetime import datetime

from app.schemas.base import CamelCaseModel


class MetaConnectResponse(CamelCaseModel):
    """Where to send the browser to start the Meta OAuth dialog."""

    authorization_url: str


class MetaAdAccount(CamelCaseModel):
    """One of the Meta user's ad accounts, as offered for selection."""

    id: str
    name: str


class MetaPage(CamelCaseModel):
    """One of the Meta user's Pages, as offered for selection."""

    id: str
    name: str


class MetaFinalizeRequest(CamelCaseModel):
    """The user's chosen ad account + Page, completing the connection."""

    ad_account_id: str
    page_id: str


class MetaConnectionResponse(CamelCaseModel):
    """Public-facing representation of a MetaConnection.

    Deliberately excludes accessToken — that never leaves the backend.
    """

    id: str
    business_id: str
    meta_user_id: str
    ad_account_id: str | None
    page_id: str | None
    token_expires_at: datetime
    created_at: datetime
