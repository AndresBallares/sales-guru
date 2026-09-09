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


class MetaPixel(CamelCaseModel):
    """One of the ad account's Meta Pixels, as offered for selection."""

    id: str
    name: str


class MetaFinalizeRequest(CamelCaseModel):
    """The user's chosen ad account + Page, completing the connection."""

    ad_account_id: str
    page_id: str


class MetaPixelRequest(CamelCaseModel):
    """The user's chosen Pixel — a separate, optional follow-up step.

    Only conversion-tracking optimization goals need one (currently just
    SALES -> OFFSITE_CONVERSIONS, see app/services/publish.py), so it's
    not bundled into MetaFinalizeRequest — a business advertising for
    TRAFFIC/AWARENESS/MESSAGES never needs to see this step at all.
    """

    pixel_id: str


class MetaConnectionResponse(CamelCaseModel):
    """Public-facing representation of a MetaConnection.

    Deliberately excludes accessToken — that never leaves the backend.
    """

    id: str
    business_id: str
    meta_user_id: str
    ad_account_id: str | None
    page_id: str | None
    pixel_id: str | None
    # True once the user explicitly dismissed the Pixel step for this
    # connection ("Skip for now") rather than never having gotten to it
    # yet — see MetaConnection.pixelSkipped's own docstring for why this
    # lives on the connection, not the business.
    pixel_skipped: bool
    token_expires_at: datetime
    created_at: datetime
