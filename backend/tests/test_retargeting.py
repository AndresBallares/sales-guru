"""Tests for the retargeting proposal and the Pixel health check (Stage 5).

Meta has no unique-visitor count for a Pixel, only hourly event counts, so the
signal is event counts over 30 days and is labelled "events, not people".
Nothing here creates an audience or a campaign: retargeting is a proposal the
user must approve, and its creation is a documented, unbuilt interface.
"""

import pytest
from app.core.config import get_settings
from app.services import meta
from app.services import retargeting as rt

from tests.test_meta_service import _FakeResponse, _mock_client_returning

# ── The visitor signal ───────────────────────────────────────


def test_the_thresholds_are_the_approved_ones() -> None:
    assert rt.MIN_PAGE_VIEWS_30D == 1000
    assert rt.MIN_VIEW_CONTENT_30D == 500
    assert rt.RETARGETING_BUDGET_FRACTION == 0.20
    assert rt.WINDOW_DAYS == 30


@pytest.mark.parametrize(
    "page_views,view_content,ready",
    [
        (1000, 500, True),
        (1923, 1486, True),
        (999, 500, False),
        (1000, 499, False),
        (0, 0, False),
    ],
)
def test_the_signal_needs_both_page_views_and_view_content(
    page_views: int, view_content: int, ready: bool
) -> None:
    counts = {"PageView": page_views, "ViewContent": view_content}

    assert rt.retargeting_ready(counts) is ready


def test_missing_events_count_as_zero() -> None:
    assert rt.retargeting_ready({}) is False
    assert rt.retargeting_ready({"PageView": 5000}) is False


def test_the_proposal_text_labels_events_not_people_and_states_the_numbers() -> None:
    text = rt.proposal_reasoning(
        {"PageView": 1923, "ViewContent": 1486, "Purchase": 0},
        daily_budget=75.0,
        purchase_event_firing=True,
    )

    assert "1,923 PageView" in text
    assert "1,486 ViewContent" in text
    assert "events, not people" in text
    assert "$15.00/day" in text  # 20% of $75
    assert "excluding purchasers" in text
    assert "Nothing is created until" in text


def test_the_proposal_warns_when_purchasers_cannot_be_excluded_reliably() -> None:
    text = rt.proposal_reasoning(
        {"PageView": 1923, "ViewContent": 1486},
        daily_budget=75.0,
        purchase_event_firing=False,
    )

    assert "Purchase event may not be firing" in text
    assert "purchasers" in text


def test_the_retargeting_budget_is_a_fifth_of_the_campaigns() -> None:
    assert rt.retargeting_daily_budget(75.0) == pytest.approx(15.0)
    assert rt.retargeting_daily_budget(50.0) == pytest.approx(10.0)


# ── The documented, unbuilt interface ────────────────────────


def test_the_spec_describes_who_to_target_and_who_to_exclude() -> None:
    spec = rt.RetargetingCampaignSpec(
        source_campaign_id="camp_1", daily_budget=15.0, pixel_id="px_1"
    )

    assert spec.lookback_days == 30
    assert "site visitors" in spec.include
    assert "add-to-carts" in spec.include
    assert spec.exclude == ["purchasers"]


@pytest.mark.asyncio
async def test_creating_the_retargeting_campaign_is_not_built_yet() -> None:
    spec = rt.RetargetingCampaignSpec(
        source_campaign_id="camp_1", daily_budget=15.0, pixel_id="px_1"
    )

    with pytest.raises(rt.RetargetingNotBuiltError, match="not built"):
        await rt.create_retargeting_campaign(spec, access_token="t", ad_account_id="a")


# ── Pixel health: Purchase event may not be firing ───────────


def test_warns_when_checkouts_fire_but_purchases_never_do() -> None:
    warning = rt.purchase_event_warning({"InitiateCheckout": 41, "Purchase": 0})

    assert warning is not None
    assert warning.startswith("Purchase event may not be firing")
    assert "0 Purchase events" in warning
    assert "41 InitiateCheckout" in warning


def test_warns_when_purchase_is_missing_from_the_counts_entirely() -> None:
    assert rt.purchase_event_warning({"InitiateCheckout": 3}) is not None


@pytest.mark.parametrize(
    "counts",
    [
        {"InitiateCheckout": 41, "Purchase": 2},  # purchases are firing
        {"InitiateCheckout": 0, "Purchase": 0},  # nobody reached checkout
        {},  # no data at all
    ],
)
def test_no_warning_when_the_pixel_looks_healthy_or_unused(
    counts: dict[str, int],
) -> None:
    assert rt.purchase_event_warning(counts) is None


# ── Pixel event counts from Meta ─────────────────────────────


@pytest.mark.asyncio
async def test_fetch_pixel_event_counts_sums_every_hourly_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = _mock_client_returning(
        monkeypatch,
        _FakeResponse(
            {
                "data": [
                    {
                        "start_time": "2026-09-09T02:00:00-0400",
                        "aggregation": "event",
                        "data": [
                            {"value": "PageView", "count": 3},
                            {"value": "ViewContent", "count": 2},
                        ],
                    },
                    {
                        "start_time": "2026-09-09T03:00:00-0400",
                        "aggregation": "event",
                        "data": [{"value": "PageView", "count": 4}],
                    },
                ]
            }
        ),
    )

    counts = await meta.fetch_pixel_event_counts(
        access_token="token", pixel_id="px_1", days=30
    )

    assert counts == {"PageView": 7, "ViewContent": 2}
    url, params = client.calls[0]
    assert url == "https://graph.facebook.com/v21.0/px_1/stats"
    assert params["aggregation"] == "event"
    assert int(params["end_time"]) - int(params["start_time"]) == 30 * 86400
    assert params["access_token"] == "token"


@pytest.mark.asyncio
async def test_fetch_pixel_event_counts_is_empty_with_no_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_client_returning(monkeypatch, _FakeResponse({"data": []}))

    assert await meta.fetch_pixel_event_counts(access_token="t", pixel_id="p") == {}


@pytest.mark.asyncio
async def test_fetch_pixel_event_counts_is_empty_in_fake_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FAKE_META", "true")
    get_settings.cache_clear()
    try:
        counts = await meta.fetch_pixel_event_counts(access_token="t", pixel_id="p")
    finally:
        get_settings.cache_clear()

    assert counts == {}
