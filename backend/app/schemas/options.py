"""Schemas for GET /options — every fixed, backend-owned option list.

Consolidates what used to be either hand-copied constants on the frontend
(EVENT_VENUES, and the OBJECTIVE_LABELS/ACTION_LABELS/STATUS_LABELS/
CTA_LABELS maps in CampaignsSection.tsx) or a one-off per-resource endpoint
(GET /businesses/industries, added 2026-09-08, folded into this single
endpoint the same day once a second hand-copied list turned up) into one
pattern: the backend is the source of truth for every value+label pair a
dropdown or display label needs, and the frontend always fetches it.
"""

from app.schemas.base import CamelCaseModel


class Option(CamelCaseModel):
    """One (value, label) pair — a single dropdown/display option."""

    value: str
    label: str


class OptionsResponse(CamelCaseModel):
    """Every fixed option list the frontend needs, fetched in one call."""

    industries: list[Option]
    objectives: list[Option]
    campaign_statuses: list[Option]
    ctas: list[Option]
    action_types: list[Option]
    event_venues: list[Option]
    voice_traits: list[Option]
    price_positionings: list[Option]
