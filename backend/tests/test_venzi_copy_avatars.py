"""The guarded copy of three dev avatars into VENZI's production library.

The scripts in ``scripts/venzi_copy_avatars`` are run by the owner, never by tests or
by Claude. These tests check the files themselves: the avatars fit the library's own
limits, the SQL is generated from them (no drift), every script carries its guards,
and the dry run cannot write.
"""

import importlib.util
import json
import re
import sqlite3
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest
from app.schemas.buyer_avatar import BuyerAvatarCreateRequest

_DIR = Path(__file__).resolve().parents[1] / "scripts" / "venzi_copy_avatars"
_EXPECTED = {
    "The Next-Chapter Right-Hand Buyer": "self",
    "The Plain-Gold Loyalist Who Wants Color": "self",
    "The Mother Passing It Forward": "gift",
}


def _build() -> ModuleType:
    spec = importlib.util.spec_from_file_location("venzi_copy_build", _DIR / "build.py")
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _avatars() -> list[dict[str, Any]]:
    loaded: list[dict[str, Any]] = json.loads((_DIR / "avatars.json").read_text())
    return loaded


def test_the_file_holds_exactly_the_three_avatars_with_their_purchase_for() -> None:
    avatars = _avatars()

    assert {a["name"]: a["purchaseFor"] for a in avatars} == _EXPECTED
    assert [a["sortOrder"] for a in avatars] == [5, 6, 7]
    assert len({a["id"] for a in avatars}) == 3


@pytest.mark.parametrize("index", [0, 1, 2])
def test_each_avatar_passes_the_librarys_own_limits(index: int) -> None:
    avatar = _avatars()[index]

    parsed = BuyerAvatarCreateRequest.model_validate(avatar)

    assert parsed.name == avatar["name"]
    assert 1 <= len(parsed.concepts) <= 5


def test_the_sql_files_are_generated_from_the_json() -> None:
    build = _build()
    avatars = _avatars()

    assert (_DIR / "apply.sql").read_text() == build.apply_sql(avatars)
    assert (_DIR / "rollback.sql").read_text() == build.rollback_sql(avatars)
    assert (_DIR / "dry_run.sql").read_text() == build.dry_run_sql(avatars)


def test_apply_inserts_the_rows_with_no_run_link_and_every_guard() -> None:
    sql = (_DIR / "apply.sql").read_text()

    for avatar in _avatars():
        assert avatar["id"] in sql
    assert sql.count("INSERT INTO") == 1
    assert "cmtlnp3t30005fb2hl90ac4tl" in sql
    assert "expected exactly 5 active avatars" in sql
    assert "already applied" in sql
    assert "already has an avatar named" in sql
    assert "12" in sql
    assert "expected to insert 3 rows" in sql
    assert '"sourceRunId"' not in sql
    assert '"sourceDraftIndex"' not in sql
    assert re.search(r"BEGIN;[\s\S]*COMMIT;", sql)


def test_rollback_refuses_edited_deleted_or_used_avatars() -> None:
    sql = (_DIR / "rollback.sql").read_text()

    assert 'FROM "Creative"' in sql
    assert 'FROM "Strategy"' in sql
    assert '"buyerAvatarId"' in sql
    assert "was edited after the copy" in sql
    assert "expected exactly 3 copied avatars" in sql
    assert sql.count("DELETE FROM") == 1


def test_the_dry_run_cannot_write() -> None:
    sql = (_DIR / "dry_run.sql").read_text()

    assert not re.search(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b", sql)
    assert "SELECT" in sql


def test_quotes_in_text_are_escaped_in_the_sql() -> None:
    build = _build()
    avatar = {**_avatars()[0], "name": "It's a test", "who": "O'Neil's friend"}

    sql = build.apply_sql([avatar])

    assert "'It''s a test'" in sql
    assert "'O''Neil''s friend'" in sql


def test_building_refuses_a_missing_or_over_long_avatar() -> None:
    build = _build()
    too_long = {**_avatars()[0], "name": "x" * 61}

    with pytest.raises(ValueError, match="name"):
        build.check([too_long])
    with pytest.raises(ValueError, match="at least one"):
        build.check([])


def test_reading_dev_is_read_only_and_keeps_the_stored_text(tmp_path: Path) -> None:
    build = _build()
    path = tmp_path / "dev.db"
    conn = sqlite3.connect(path)
    conn.execute(
        'CREATE TABLE "BuyerAvatar" (id TEXT, name TEXT, who TEXT, purchaseFor TEXT, '
        "primaryProblems TEXT, unknownProblems TEXT, mechanisms TEXT, "
        "alternatives TEXT, objections TEXT, hooks TEXT, creativeAngles TEXT, "
        "concepts TEXT)"
    )
    conn.execute(
        'INSERT INTO "BuyerAvatar" VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        (
            "a1",
            "N",
            "W",
            "gift",
            '["p"]',
            "[]",
            "[]",
            "[]",
            "[]",
            '["h"]',
            "[]",
            '[{"slug":"s","pillar":"offer","description":"d"}]',
        ),
    )
    conn.commit()
    conn.close()

    rows = build.load_from_dev(path, ["a1"])

    assert rows[0]["purchaseFor"] == "gift"
    assert rows[0]["primaryProblems"] == ["p"]
    assert rows[0]["concepts"][0]["slug"] == "s"
    with pytest.raises(ValueError, match="not found"):
        build.load_from_dev(path, ["a1", "missing"])
