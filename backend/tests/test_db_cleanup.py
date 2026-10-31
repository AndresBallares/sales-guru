"""Tests for tests/db_cleanup.py: emptying the test database between tests."""

import sqlite3
from pathlib import Path

import pytest

from tests.db_cleanup import clean_all_tables, database_path_for_tests


def _make_db(path: Path, extra_table: bool = False) -> None:
    con = sqlite3.connect(path)
    con.execute('CREATE TABLE "Business" (id TEXT PRIMARY KEY)')
    con.execute(
        'CREATE TABLE "Product" (id TEXT PRIMARY KEY, '
        'businessId TEXT REFERENCES "Business"(id))'
    )
    con.execute("CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY)")
    if extra_table:
        con.execute('CREATE TABLE "Newcomer" (id TEXT PRIMARY KEY)')
    con.execute("INSERT INTO _prisma_migrations VALUES ('m1')")
    con.execute("INSERT INTO Business VALUES ('b1')")
    con.execute("INSERT INTO Product VALUES ('p1', 'b1')")
    con.commit()
    con.close()


def _count(path: Path, table: str) -> int:
    con = sqlite3.connect(path)
    try:
        return int(con.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0])
    finally:
        con.close()


def test_every_listed_table_is_emptied_whatever_its_foreign_keys(
    tmp_path: Path,
) -> None:
    db = tmp_path / "t.db"
    _make_db(db)

    # Business before Product would fail with foreign keys on.
    clean_all_tables(db, ("business", "product"))

    assert _count(db, "Business") == 0
    assert _count(db, "Product") == 0


def test_the_migration_history_is_left_alone(tmp_path: Path) -> None:
    db = tmp_path / "t.db"
    _make_db(db)

    clean_all_tables(db, ("business", "product"))

    assert _count(db, "_prisma_migrations") == 1


def test_a_table_missing_from_the_list_is_an_error_not_a_silent_leak(
    tmp_path: Path,
) -> None:
    db = tmp_path / "t.db"
    _make_db(db, extra_table=True)

    with pytest.raises(RuntimeError, match="Newcomer"):
        clean_all_tables(db, ("business", "product"))

    assert _count(db, "Business") == 1  # nothing was deleted before the error


def test_the_database_path_is_the_prisma_folders_test_db() -> None:
    # DATABASE_URL="file:./test.db" is relative to backend/prisma/, where
    # prisma-client-py resolves it.
    path = database_path_for_tests()
    assert path.name == "test.db"
    assert path.parent.name == "prisma"
