"""GET /options — every fixed option list the frontend needs (2026-09-08).

One endpoint, one response, for every (value, label) list a dropdown or
display label draws from — consolidating what used to be a mix of
hand-copied frontend constants (EVENT_VENUES; the OBJECTIVE_LABELS/
ACTION_LABELS/STATUS_LABELS/CTA_LABELS maps in CampaignsSection.tsx) and a
one-off per-resource endpoint (GET /businesses/industries) into a single
pattern. See app/schemas/options.py for the response shape and why each
list lives where it does.
"""

from collections.abc import Mapping

from fastapi import APIRouter, Depends
from prisma.models import User

from app.core.session import get_current_user
from app.schemas.business import INDUSTRY_LABELS
from app.schemas.campaign import CAMPAIGN_STATUS_LABELS, OBJECTIVE_LABELS
from app.schemas.creative import CTA_LABELS
from app.schemas.optimization import ACTION_TYPE_LABELS
from app.schemas.options import Option, OptionsResponse
from app.services.event_venues import EVENT_VENUES

router = APIRouter(prefix="/options", tags=["options"])


def _options[K: str](labels: Mapping[K, str]) -> list[Option]:
    """Build a list of Options from a {value: label} mapping, in order.

    Generic over the key type (bound to str), not just `Mapping[str,
    str]` — each *_LABELS source dict is keyed by its own Literal type
    (e.g. dict[Objective, str]), and Mapping's key type is invariant, so a
    bare `str` key type would reject those at the type-checker level even
    though they're safe to read from here; a bound TypeVar lets inference
    unify it with each call site's actual Literal instead.
    """
    return [Option(value=value, label=label) for value, label in labels.items()]


@router.get("", response_model=OptionsResponse)
async def get_options(
    current_user: User = Depends(get_current_user),
) -> OptionsResponse:
    """Every fixed option list the frontend needs, fetched in one call.

    Requires a session, same as every other endpoint in the app, even
    though nothing here is organization-scoped — get_current_user (rather
    than get_owned_organization_id) is used directly since no organization
    id is actually needed, just the auth check.

    Args:
        current_user: The authenticated user (unused beyond the auth check
            this dependency performs).

    Returns:
        Every fixed option list, each in the fixed order its source dict
        defines (app/schemas/business.py, campaign.py, creative.py,
        optimization.py, app/services/event_venues.py).
    """
    return OptionsResponse(
        industries=_options(INDUSTRY_LABELS),
        objectives=_options(OBJECTIVE_LABELS),
        campaign_statuses=_options(CAMPAIGN_STATUS_LABELS),
        ctas=_options(CTA_LABELS),
        action_types=_options(ACTION_TYPE_LABELS),
        event_venues=[
            Option(
                value=venue.key, label=f"{venue.name} — {venue.venue}, {venue.state}"
            )
            for venue in EVENT_VENUES.values()
        ],
    )
