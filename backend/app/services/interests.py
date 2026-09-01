"""Curated Meta ad-interest lookup table for TEST_PLAN hypothesis targeting.

PRD.md build step 5 "Phase C" (real two-variant publishing), confirmed
2026-09-02. Resolved from Meta's real Targeting Search endpoint
(`GET /search?type=adinterest`, app/services/meta.py's
search_ad_interests) via scripts/resolve_interests.py's `discover` mode,
then hand-curated down to the ~30-50 actually relevant to the jewelry
vertical — same "backend decides structural facts, never LLM-sourced"
reasoning already used for benchmarks.py/event_venues.py.

Meta periodically deprecates detailed-targeting options, so the catalog
needs a freshness check over time: re-run scripts/resolve_interests.py's
`validate` mode (checks every entry against the live API, flags dead
ids, refreshes audience_size) periodically — same pattern as
benchmarks.py's BenchmarkRange.as_of, tracked per entry here as
resolved_at rather than one file-level timestamp.

Forced tool-use plus this table's keys as a Literal enum
(app/schemas/strategy.py's TargetAudience.interests) means the
Strategist LLM can only ever emit a key that's guaranteed to resolve to
a real, currently-valid Meta interest id — no fuzzy matching, no runtime
API dependency. Publish-time interest resolution
(app/services/publish.py) is then a plain dict lookup via INTERESTS.
"""

import json
from pathlib import Path
from typing import NamedTuple

DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "jewelry_interests.json"


class InterestEntry(NamedTuple):
    """One curated, currently-valid Meta ad interest."""

    key: str
    meta_id: str
    name: str
    audience_size: int
    resolved_at: str


def _load(path: Path) -> dict[str, InterestEntry]:
    """Load the curated interest table from its JSON data file.

    Args:
        path: Path to the JSON file (a list of {key, meta_id, name,
            audience_size, resolved_at} objects).

    Returns:
        The table, keyed by each entry's own `key`.
    """
    raw = json.loads(path.read_text())
    return {entry["key"]: InterestEntry(**entry) for entry in raw}


INTERESTS: dict[str, InterestEntry] = _load(DATA_PATH)
