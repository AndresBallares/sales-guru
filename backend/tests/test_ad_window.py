"""Comparing ads over the window in which all of them were running.

Stored ad-level rows are cumulative lifetime figures (one per ad per collection),
so an ad's numbers in a window are the difference of two snapshots. The window
starts when the last compared ad started delivering and ends at the newest
snapshot, so an ad that started earlier gets no credit for its extra days.
"""

from datetime import UTC, datetime, timedelta

from app.services import dashboard as d
from app.services.ad_window import compare_ads

T0 = datetime(2026, 11, 1, tzinfo=UTC)
MIN_HOURS = 72.0


def row(
    ad: str | None,
    hour: float,
    *,
    impressions: int = 0,
    spend: float = 0.0,
    atc: int | None = 0,
    purchases: int | None = 0,
) -> d.Snapshot:
    """A cumulative ad-level snapshot `hour` hours after T0."""
    return d.Snapshot(
        ad_set_id="set1",
        ad_id=ad,
        impressions=impressions,
        spend=spend,
        link_clicks=None,
        landing_page_views=None,
        add_to_cart=atc,
        initiated_checkout=None,
        purchases=purchases,
        purchase_value=None,
        fetched_at=T0 + timedelta(hours=hour),
    )


def steady(
    ad: str,
    *,
    start: float,
    end: float,
    atc_per_hour: int = 1,
    spend_per_hour: float = 2.0,
) -> list[d.Snapshot]:
    """Hourly cumulative rows: a zero row at `start`, then steady delivery to `end`."""
    rows = [row(ad, start)]
    for h in range(1, int(end - start) + 1):
        rows.append(
            row(
                ad,
                start + h,
                impressions=100 * h,
                spend=spend_per_hour * h,
                atc=atc_per_hour * h,
                purchases=0,
            )
        )
    return rows


def phased(
    ad: str, *, start: float, phases: list[tuple[int, int, float]]
) -> list[d.Snapshot]:
    """Hourly cumulative rows; phases are (hours, add-to-carts/hour, spend/hour)."""
    rows = [row(ad, start)]
    hour, impressions, spend, atc = start, 0, 0.0, 0
    for hours, atc_per_hour, spend_per_hour in phases:
        for _ in range(hours):
            hour += 1
            impressions += 100
            spend += spend_per_hour
            atc += atc_per_hour
            rows.append(
                row(
                    ad, hour, impressions=impressions, spend=spend, atc=atc, purchases=0
                )
            )
    return rows


def fading_old_ad() -> list[d.Snapshot]:
    """Started at hour 0: $0.50 per add-to-cart for 100 hours, then $2.00 for 100."""
    return phased("a", start=0, phases=[(100, 2, 1.0), (100, 1, 2.0)])


def steady_new_ad() -> list[d.Snapshot]:
    """Started at hour 100: $1.33 per add-to-cart throughout."""
    return phased("b", start=100, phases=[(100, 3, 4.0)])


def test_ads_that_started_together_are_compared_over_their_whole_run() -> None:
    rows = steady("a", start=0, end=100) + steady("b", start=0, end=100)

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.status == "ok"
    assert window.start == T0
    assert window.end == T0 + timedelta(hours=100)
    assert window.hours == 100
    assert window.per_ad["a"].add_to_cart == 100
    assert window.per_ad["a"].spend == 200.0
    assert window.excluded == ()
    assert window.min_hours == MIN_HOURS


def test_an_older_ads_extra_days_do_not_count_toward_the_window() -> None:
    # a started at hour 0, b at hour 50; both run to hour 150.
    old = steady("a", start=0, end=150, atc_per_hour=2, spend_per_hour=4.0)
    new = steady("b", start=50, end=150, atc_per_hour=3, spend_per_hour=4.0)

    window = compare_ads(old + new, min_hours=MIN_HOURS)

    assert window.status == "ok"
    assert window.start == T0 + timedelta(hours=50)
    assert window.hours == 100
    # a: 100 hours at 2 add-to-carts/hour, not its lifetime 300.
    assert window.per_ad["a"].add_to_cart == 200
    assert window.per_ad["a"].spend == 400.0
    assert window.per_ad["b"].add_to_cart == 300


def test_lifetime_picks_the_older_ad_but_the_window_picks_the_cheaper_one() -> None:
    rows = fading_old_ad() + steady_new_ad()

    lifetime = d.choose_leader(list(d.ad_totals(rows).items()))  # a: $1.00 vs b: $1.33
    window = compare_ads(rows, min_hours=MIN_HOURS)
    in_window = d.choose_leader(list(window.per_ad.items()))  # a: $2.00 vs b: $1.33

    assert lifetime is not None and lifetime.ad_id == "a"
    assert in_window is not None and in_window.ad_id == "b"


def test_campaign_level_rows_are_ignored() -> None:
    rows = steady("a", start=0, end=80) + steady("b", start=0, end=80)
    rows.append(row(None, 80, impressions=1, spend=1.0))

    assert set(compare_ads(rows, min_hours=MIN_HOURS).per_ad) == {"a", "b"}


def test_an_ad_whose_first_row_already_has_delivery_counts_from_zero() -> None:
    # Collection began late for b: its first row already shows delivery.
    rows = steady("a", start=0, end=100)
    rows += [
        row("b", 10, impressions=500, spend=5.0, atc=5),
        row("b", 100, impressions=9000, spend=95.0, atc=95),
    ]

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.start is not None and window.start < T0 + timedelta(hours=10)
    assert window.per_ad["b"].add_to_cart == 95  # its whole life
    assert window.per_ad["a"].add_to_cart == 91  # a, from the row at hour 9


def test_an_ad_paused_before_the_window_is_excluded_and_listed() -> None:
    paused = steady("p", start=0, end=30)
    paused += [
        row("p", float(h), impressions=3000, spend=60.0, atc=30) for h in (60, 100)
    ]
    a = steady("a", start=0, end=100)
    late = steady("late", start=50, end=100)

    window = compare_ads(paused + a + late, min_hours=MIN_HOURS)

    assert window.excluded == ("p",)
    assert set(window.per_ad) == {"a", "late"}
    assert window.start == T0 + timedelta(hours=50)


def test_an_ad_paused_inside_the_window_is_compared_over_the_part_it_ran() -> None:
    paused = steady("p", start=0, end=60)  # stops delivering at hour 60
    paused += [row("p", 100, impressions=6000, spend=120.0, atc=60)]
    a = steady("a", start=0, end=100)
    late = steady("late", start=40, end=100)

    window = compare_ads(paused + a + late, min_hours=MIN_HOURS)

    assert window.excluded == ()
    assert window.start == T0 + timedelta(hours=40)
    assert window.per_ad["p"].add_to_cart == 60 - 40  # hours 40-60 only
    assert window.per_ad["a"].add_to_cart == 60


def test_a_window_shorter_than_the_minimum_is_too_short_but_still_has_numbers() -> None:
    rows = steady("a", start=0, end=100) + steady("b", start=70, end=100)

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.status == "too_short"
    assert window.hours == 30
    assert window.per_ad["a"].add_to_cart == 30
    assert window.label == "Compared over the last 30 hours, while all ads ran"


def test_the_minimum_is_a_parameter() -> None:
    rows = steady("a", start=0, end=100) + steady("b", start=70, end=100)

    assert compare_ads(rows, min_hours=24.0).status == "ok"
    assert compare_ads(rows, min_hours=31.0).status == "too_short"


def test_one_ad_with_delivery_is_not_a_comparison() -> None:
    rows = steady("a", start=0, end=100)
    rows += [row("idle", 0), row("idle", 100)]  # no delivery at all

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.status == "too_few_ads"
    assert window.label is None
    assert set(window.per_ad) == {"a"}
    assert window.excluded == ("idle",)


def test_no_ad_rows_at_all() -> None:
    window = compare_ads([row(None, 1, impressions=5, spend=1.0)], min_hours=MIN_HOURS)

    assert window.status == "too_few_ads"
    assert window.per_ad == {}
    assert window.start is None and window.end is None


def test_a_field_that_is_unavailable_stays_unavailable() -> None:
    rows = [
        row("a", 0, atc=None, purchases=None),
        row("a", 100, impressions=900, spend=90.0, atc=None, purchases=None),
        row("b", 0),
        row("b", 100, impressions=900, spend=90.0, atc=9, purchases=0),
    ]

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.per_ad["a"].add_to_cart is None
    assert window.per_ad["a"].purchases is None
    assert window.per_ad["b"].add_to_cart == 9


def test_a_revision_inside_the_window_does_not_change_the_endpoint_difference() -> None:
    rows = steady("a", start=0, end=100)
    rows += [
        row("b", 0, atc=0),
        row("b", 50, impressions=4000, spend=50.0, atc=40),
        row("b", 51, impressions=4100, spend=52.0, atc=38),  # revised down
        row("b", 100, impressions=9000, spend=90.0, atc=70),
    ]

    assert compare_ads(rows, min_hours=MIN_HOURS).per_ad["b"].add_to_cart == 70


def test_a_missing_figure_before_the_ad_delivered_counts_as_zero() -> None:
    # Meta sends no add-to-cart figure for an ad that has delivered nothing yet.
    rows = steady("a", start=0, end=100)
    rows += [
        row("b", 0, atc=None, purchases=None),
        row("b", 100, impressions=900, spend=90.0, atc=9, purchases=2),
    ]

    window = compare_ads(rows, min_hours=MIN_HOURS)

    assert window.per_ad["b"].add_to_cart == 9
    assert window.per_ad["b"].purchases == 2


def test_a_missing_figure_on_an_earlier_row_counts_as_zero_even_after_delivery() -> (
    None
):
    # Meta sends no add-to-cart figure until the first add-to-cart, so an ad can
    # have impressions and still report none.
    rows = steady("a", start=0, end=100)
    rows += [
        row("b", 0),
        row("b", 50, impressions=500, spend=10.0, atc=None, purchases=None),
        row("b", 100, impressions=900, spend=90.0, atc=9, purchases=2),
    ]
    late = steady("c", start=50, end=100)

    window = compare_ads(rows + late, min_hours=MIN_HOURS)

    assert window.per_ad["b"].add_to_cart == 9


def test_a_count_that_ends_below_where_it_started_is_clamped_to_zero() -> None:
    rows = steady("a", start=0, end=100)
    rows += [
        row("b", 0, atc=0),
        row("b", 1, impressions=100, spend=2.0, atc=9),
        row("b", 100, impressions=9000, spend=90.0, atc=9),
    ]
    # b started at hour 0 with the others, so the baseline is the zero row: 9.
    assert compare_ads(rows, min_hours=MIN_HOURS).per_ad["b"].add_to_cart == 9

    late = [
        row("c", 50, atc=12),
        row("c", 51, impressions=100, spend=2.0, atc=12),
        row("c", 100, impressions=9000, spend=90.0, atc=7),  # revised below baseline
    ]
    window = compare_ads(rows + late, min_hours=MIN_HOURS)
    assert window.per_ad["c"].add_to_cart == 0


def test_the_label_names_days_once_the_window_is_two_days_or_more() -> None:
    rows = steady("a", start=0, end=120) + steady("b", start=0, end=120)

    assert (
        compare_ads(rows, min_hours=MIN_HOURS).label
        == "Compared over the last 5 days, while all ads ran"
    )
