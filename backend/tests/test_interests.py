"""Tests for the curated Meta ad-interest lookup table (PRD.md "Phase C")."""

from app.services.interests import INTERESTS


def test_loads_a_substantial_curated_set() -> None:
    """The curated table lands within the ~30-50 range the spec asked for."""
    assert 30 <= len(INTERESTS) <= 50


def test_every_entry_key_matches_its_own_dict_key() -> None:
    """Each entry's own .key field matches the dict key it's stored under."""
    for key, entry in INTERESTS.items():
        assert entry.key == key


def test_every_entry_has_a_real_looking_meta_id_and_positive_audience() -> None:
    """Sanity bounds — every curated entry has a numeric Meta id and a
    positive audience size (never zero/negative, which would be a dead
    or malformed entry)."""
    for entry in INTERESTS.values():
        assert entry.meta_id.isdigit()
        assert entry.audience_size > 0


def test_every_entry_has_a_resolved_at_stamp() -> None:
    """Every entry carries provenance for when it was last validated —
    same freshness pattern as BenchmarkRange.as_of."""
    for entry in INTERESTS.values():
        assert entry.resolved_at
