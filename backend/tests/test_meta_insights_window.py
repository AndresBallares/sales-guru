"""Every Insights call carries an explicit window, so today's spend is never missed.

Meta's Insights edge, asked with no date parameters, answers for the last 30 days
*ending yesterday*. A campaign that first spent today therefore came back as an empty
``data`` list, which the parser turned into a silent all-zero reading (Snake-Ring,
2026-11-03: Meta billed about $16.60 while every stored snapshot read $0). These tests
use a fake Meta that behaves that way, so they fail on any call that leaves the window
to Meta's default.
"""

from typing import Any

import pytest
from app.services import meta

pytestmark = pytest.mark.meta_helpers_under_test

SPENT_TODAY = {
    "impressions": "1200",
    "reach": "1000",
    "frequency": "1.2",
    "spend": "16.60",
    "clicks": "40",
    "inline_link_clicks": "30",
    "actions": [{"action_type": "link_click", "value": "30"}],
}


class FakeMeta:
    """A Graph API whose Insights default window ends yesterday.

    The object spent only today. A request with no explicit window gets the default
    window (nothing, because yesterday and before were zero); a request with
    ``date_preset=maximum`` or a ``time_range`` gets today's row.
    """

    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []

    async def get_json(self, url: str, params: dict[str, str]) -> dict[str, Any]:
        self.calls.append((url, params))
        if not url.endswith("/insights"):
            return {"data": []}
        if params.get("date_preset") == "maximum":
            return {"data": [SPENT_TODAY]}
        if "time_range" in params:
            return {"data": [SPENT_TODAY]}
        return {"data": []}


@pytest.fixture
def fake_meta(monkeypatch: pytest.MonkeyPatch) -> FakeMeta:
    fake = FakeMeta()
    monkeypatch.setattr(meta, "_get_json", fake.get_json)
    return fake


@pytest.mark.asyncio
async def test_a_campaign_that_spent_today_is_stored_with_that_spend(
    fake_meta: FakeMeta,
) -> None:
    insights = await meta.fetch_campaign_insights(
        access_token="t", meta_campaign_id="camp_1"
    )

    assert insights.spend == 16.6
    assert insights.impressions == 1200
    assert insights.clicks == 40


@pytest.mark.asyncio
async def test_an_ad_set_that_spent_today_is_read_with_that_spend(
    fake_meta: FakeMeta,
) -> None:
    insights = await meta.fetch_ad_set_insights(
        access_token="t", meta_ad_set_id="adset_1"
    )

    assert insights.spend == 16.6


@pytest.mark.asyncio
async def test_an_ad_that_spent_today_is_read_with_that_spend(
    fake_meta: FakeMeta,
) -> None:
    insights = await meta.fetch_ad_insights(access_token="t", meta_ad_id="ad_1")

    assert insights.spend == 16.6


@pytest.mark.asyncio
async def test_the_three_lifetime_calls_ask_for_the_maximum_preset(
    fake_meta: FakeMeta,
) -> None:
    await meta.fetch_campaign_insights(access_token="t", meta_campaign_id="c")
    await meta.fetch_ad_set_insights(access_token="t", meta_ad_set_id="s")
    await meta.fetch_ad_insights(access_token="t", meta_ad_id="a")

    assert [p.get("date_preset") for _, p in fake_meta.calls] == ["maximum"] * 3


@pytest.mark.asyncio
async def test_no_insights_call_leaves_the_window_to_metas_default(
    fake_meta: FakeMeta,
) -> None:
    """The contract: any /insights request has a date_preset or a time_range."""
    from datetime import date

    await meta.fetch_campaign_insights(access_token="t", meta_campaign_id="c")
    await meta.fetch_ad_set_insights(access_token="t", meta_ad_set_id="s")
    await meta.fetch_ad_insights(access_token="t", meta_ad_id="a")
    await meta.fetch_campaign_window_insights(
        access_token="t",
        meta_campaign_id="c",
        since=date(2026, 11, 1),
        until=date(2026, 11, 7),
    )
    await meta.fetch_account_historical_performance(
        access_token="t", ad_account_id="act_1"
    )

    insight_calls = [
        (url, params) for url, params in fake_meta.calls if url.endswith("/insights")
    ]
    assert len(insight_calls) >= 5
    for url, params in insight_calls:
        assert "date_preset" in params or "time_range" in params, url


@pytest.mark.asyncio
async def test_a_genuinely_empty_reply_still_reads_as_no_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def empty(_url: str, _params: dict[str, str]) -> dict[str, Any]:
        return {"data": []}

    monkeypatch.setattr(meta, "_get_json", empty)

    insights = await meta.fetch_campaign_insights(
        access_token="t", meta_campaign_id="c"
    )

    assert insights.spend == 0.0
    assert insights.impressions == 0
