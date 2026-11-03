"""Readable industry label and readiness data for the research template (Phase 7b)."""

from dataclasses import replace
from typing import Any

from app.services.research_template import (
    ProductInput,
    TemplateInputs,
    readiness,
    render_template,
)


def _inputs(**over: Any) -> TemplateInputs:  # noqa: ANN401
    base = TemplateInputs(
        brand_name="VENZI",
        industry="FASHION_JEWELRY",
        website="https://venzi.example.com",
        products=[ProductInput(name="Emerald Serpent Ring", description="A ring")],
        key_messages=["Solid gold"],
        customer_problems=["Plating wears off"],
        competitors_text="https://www.bulgari.com/en-us/rings",
    )
    return replace(base, **over)


def test_the_prompt_shows_a_readable_industry_not_the_enum() -> None:
    text = render_template(_inputs()).text
    assert "Fashion / Jewelry" in text
    assert "FASHION_JEWELRY" not in text


def test_a_legacy_freeform_industry_is_shown_as_stored() -> None:
    text = render_template(_inputs(industry="Handmade candles")).text
    assert "Handmade candles" in text


def test_readiness_is_all_filled_for_a_complete_business() -> None:
    items = readiness(_inputs())
    assert [i.field for i in items] == [
        "key_messages",
        "customer_problems",
        "competitors",
        "product_names",
        "product_descriptions",
    ]
    assert not any(i.empty for i in items)
    assert all(i.label for i in items)


def test_readiness_flags_each_empty_input() -> None:
    items = readiness(
        _inputs(
            key_messages=[],
            customer_problems=[],
            competitors_text=None,
            products=[ProductInput(name=None, description=None)],
        )
    )
    assert {i.field for i in items if i.empty} == {
        "key_messages",
        "customer_problems",
        "competitors",
        "product_names",
        "product_descriptions",
    }


def test_run_start_competitor_urls_count_as_competitors() -> None:
    items = readiness(
        _inputs(competitors_text=None, extra_competitor_urls=["https://x-rival.com"])
    )
    assert not next(i for i in items if i.field == "competitors").empty


def test_no_products_at_all_flags_both_product_checks() -> None:
    items = readiness(_inputs(products=[]))
    assert {i.field for i in items if i.empty} == {
        "product_names",
        "product_descriptions",
    }
