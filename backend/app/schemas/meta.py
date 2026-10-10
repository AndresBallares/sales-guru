"""Schemas for the Meta Ads connection (PRD.md build step 6)."""

import re
from datetime import datetime

from pydantic import field_validator

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


class MetaInstagramAccountRequest(CamelCaseModel):
    """A hand-entered Instagram account id.

    Null (or empty) goes back to the one found on the Page.
    """

    instagram_user_id: str | None = None

    @field_validator("instagram_user_id")
    @classmethod
    def _numeric_or_empty(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None
        if not re.fullmatch(r"\d{5,30}", value):
            raise ValueError(
                "An Instagram account ID is a number, such as 17841400000000000"
            )
        return value


class MetaConnectionResponse(CamelCaseModel):
    """Public-facing representation of a MetaConnection.

    Deliberately excludes accessToken — that never leaves the backend.
    """

    id: str
    business_id: str
    meta_user_id: str
    ad_account_id: str | None
    page_id: str | None
    # The Instagram account ads are published as: the hand-entered one if set,
    # else the one found on the Page. None means none, so ads run on Facebook
    # placements only.
    instagram_user_id: str | None
    instagram_user_id_discovered: str | None
    instagram_user_id_manual: str | None
    pixel_id: str | None
    # True once the user explicitly dismissed the Pixel step for this
    # connection ("Skip for now") rather than never having gotten to it
    # yet — see MetaConnection.pixelSkipped's own docstring for why this
    # lives on the connection, not the business.
    pixel_skipped: bool
    token_expires_at: datetime
    created_at: datetime
