"""Product.name is for the research template only (Phase 7a decision, 2026-11-02).

Sending it to the Strategist or Creative prompts would make a rename change
what those agents read, and so mark creatives stale. These tests keep it out.
"""

import re
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

from app.services import strategist

_APP = Path(__file__).resolve().parent.parent / "app" / "services"


def test_the_strategist_prompt_lines_do_not_contain_the_product_name() -> None:
    business = cast(
        Any,
        SimpleNamespace(name="Acme", industry=None, location=None, description=None),
    )
    product = cast(
        Any,
        SimpleNamespace(
            name="SECRETLABEL",
            description="A ring",
            price=100.0,
            url=None,
            features=None,
            benefits=None,
            mechanism=None,
            personalizable=False,
            personalizationOptions=None,
        ),
    )

    lines = strategist._business_product_audience_lines(business, product, None)

    assert "SECRETLABEL" not in "\n".join(lines)


def test_neither_agent_module_reads_the_product_name_field() -> None:
    for module in ("strategist.py", "creative.py"):
        source = (_APP / module).read_text("utf-8")
        assert not re.search(r"\bproduct\.name\b", source), module
