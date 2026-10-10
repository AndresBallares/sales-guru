"""Tests for reading Meta's delivery state (app/services/campaign_status_sync.py)."""

import pytest
from app.services.campaign_status_sync import delivery_state
from app.services.meta import MetaDeliveryStatus


@pytest.mark.parametrize(
    ("campaign", "ad_sets", "expected"),
    [
        # Running: the campaign is on and at least one ad set is on.
        ("ACTIVE", ["ACTIVE"], "running"),
        ("ACTIVE", ["PAUSED", "ACTIVE"], "running"),
        ("ACTIVE", ["ACTIVE", "ACTIVE"], "running"),
        # Paused at the campaign level.
        ("PAUSED", ["CAMPAIGN_PAUSED"], "paused"),
        ("PAUSED", [], "paused"),
        ("CAMPAIGN_PAUSED", ["CAMPAIGN_PAUSED"], "paused"),
        ("ADSET_PAUSED", ["PAUSED"], "paused"),
        # Paused at the ad set level (what the app itself does).
        ("ACTIVE", ["PAUSED"], "paused"),
        ("ACTIVE", ["PAUSED", "ADSET_PAUSED"], "paused"),
        ("ACTIVE", ["PAUSED", "CAMPAIGN_PAUSED"], "paused"),
        # Not a clear signal: leave the app's status alone.
        ("ACTIVE", [], None),
        ("DELETED", ["DELETED"], None),
        ("ARCHIVED", ["ARCHIVED"], None),
        ("IN_PROCESS", ["ACTIVE"], None),
        ("WITH_ISSUES", ["ACTIVE"], None),
        ("", [], None),
        ("ACTIVE", ["WITH_ISSUES"], None),
        ("ACTIVE", ["PAUSED", "WITH_ISSUES"], None),
    ],
)
def test_delivery_state(
    campaign: str, ad_sets: list[str], expected: str | None
) -> None:
    assert delivery_state(MetaDeliveryStatus(campaign, ad_sets)) == expected
