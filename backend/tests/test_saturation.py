"""Tests for the audience-saturation rule (pure maths, no database)."""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import pytest
from app.core.config import Settings, get_settings
from app.services import saturation

START = datetime(2026, 9, 1, tzinfo=UTC)
NOW = START + timedelta(days=30)


@dataclass
class Snap:
    fetchedAt: datetime  # noqa: N815
    spend: float
    impressions: int
    reach: int | None
    frequency7d: float | None = None


def day(n: float) -> datetime:
    return START + timedelta(days=n)


def saturated_history(
    *,
    reach_now: int | None = 16_500,
    impressions_now: int = 130_000,
    spend_now: float = 1500.0,
    frequency: float | None = 4.2,
    spend_week_ago: float = 1150.0,
    spend_two_weeks_ago: float = 800.0,
) -> list[Snap]:
    """30 days of delivery, $50/day, whose last week reached almost nobody new.

    First 14 days: $700 and 14,000 people (20 per dollar). Days 16-23: $350.
    Days 23-30: $350, 30,000 impressions, only 500 new people (1.4 per dollar,
    1.7% of impressions to first-timers), frequency 4.2.
    """
    return [
        Snap(day(0.1), 1.0, 100, 90),
        Snap(day(14), 700.0, 70_000, 14_000),
        Snap(day(16), spend_two_weeks_ago, 80_000, 14_500),
        Snap(day(23), spend_week_ago, 100_000, 16_000),
        Snap(day(30), spend_now, impressions_now, reach_now, frequency),
    ]


def evaluate(
    snaps: list[Snap], settings: Settings | None = None
) -> saturation.SaturationReading | None:
    return saturation.evaluate(snaps, settings or get_settings(), now=NOW)


def test_a_saturated_campaign_fires_with_the_numbers_behind_it() -> None:
    reading = evaluate(saturated_history())

    assert reading is not None and reading.fired
    assert reading.spend_7d == pytest.approx(350.0)
    assert reading.spend_prev_7d == pytest.approx(350.0)
    assert reading.new_reach_7d == 500
    assert reading.reach_per_dollar_7d == pytest.approx(500 / 350)
    assert reading.reach_per_dollar_baseline == pytest.approx(20.0)
    assert reading.first_time_ratio_7d == pytest.approx(500 / 30_000)
    assert reading.frequency_7d == 4.2


def test_a_healthy_campaign_that_keeps_reaching_new_people_does_not_fire() -> None:
    reading = evaluate(saturated_history(reach_now=22_000))  # 6,000 new people

    assert reading is not None and not reading.fired
    assert not reading.reach_ok


def test_a_campaign_that_stopped_spending_does_not_fire() -> None:
    """Flat reach with little spend is a paused budget, not saturation."""
    reading = evaluate(saturated_history(spend_now=1200.0))  # only $50 this week

    assert reading is not None and not reading.fired
    assert not reading.spend_ok


def test_falling_spend_does_not_fire() -> None:
    reading = evaluate(
        saturated_history(
            spend_two_weeks_ago=500.0, spend_week_ago=1150.0, spend_now=1500.0
        )
    )  # prior week $650, this week $350

    assert reading is not None and not reading.spend_ok and not reading.fired


def test_low_frequency_does_not_fire() -> None:
    reading = evaluate(saturated_history(frequency=2.0))

    assert reading is not None and not reading.frequency_ok and not reading.fired


def test_mostly_first_time_impressions_do_not_fire() -> None:
    """Few impressions but lots of new people: the audience is not saturated."""
    reading = evaluate(saturated_history(reach_now=26_500, impressions_now=112_000))

    assert reading is not None and not reading.first_time_ok and not reading.fired


def test_a_campaign_under_14_days_is_not_evaluated() -> None:
    young = [s for s in saturated_history() if s.fetchedAt <= day(13)]

    assert saturation.evaluate(young, get_settings(), now=day(13)) is None


def test_a_missing_windowed_frequency_means_not_evaluated() -> None:
    assert evaluate(saturated_history(frequency=None)) is None


def test_a_stale_windowed_frequency_means_not_evaluated() -> None:
    snaps = saturated_history()
    snaps[-1].fetchedAt = NOW - timedelta(hours=40)
    snaps[-1].reach = 16_500

    assert evaluate(snaps) is None


def test_missing_reach_means_not_evaluated() -> None:
    assert evaluate(saturated_history(reach_now=None)) is None


def test_nothing_delivered_yet_means_not_evaluated() -> None:
    assert evaluate([Snap(day(1), 0.0, 0, 0), Snap(day(30), 0.0, 0, 0)]) is None


def test_thresholds_are_configurable() -> None:
    strict = get_settings().model_copy(update={"saturation_min_frequency": 5.0})
    relaxed = get_settings().model_copy(update={"saturation_min_spend_7d": 9999.0})

    strict_reading = evaluate(saturated_history(), strict)
    relaxed_reading = evaluate(saturated_history(), relaxed)

    assert strict_reading is not None and not strict_reading.fired
    assert relaxed_reading is not None and not relaxed_reading.spend_ok


def test_the_warning_and_proposal_carry_the_numbers() -> None:
    reading = evaluate(saturated_history())
    assert reading is not None

    warning = saturation.warning_text(reading)
    proposal = saturation.proposal_reasoning(reading)

    for text in (warning, proposal):
        assert "$350" in text and "500 new people" in text
        assert "4.2" in text and "2%" in text
    assert proposal.startswith("Audience saturation detected")
    assert "adjacent-interest ad set" in proposal
    assert "Nothing changes until you approve" in proposal
