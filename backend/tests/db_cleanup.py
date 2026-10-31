"""Empty the test database between tests, without starting a query engine.

The cleanup used to build a Prisma client, connect (which spawns a query-engine
process) and disconnect for every test: about 0.25s each, roughly two thirds of
the suite's wall time. A plain sqlite3 connection does the same deletes in
milliseconds.
"""

import os
import sqlite3
from collections.abc import Iterable
from pathlib import Path

_PRISMA_DIR = Path(__file__).resolve().parent.parent / "prisma"
# Prisma's own bookkeeping; wiping it would make the database look unmigrated.
_KEEP = {"_prisma_migrations"}


def database_path_for_tests() -> Path:
    """Return the SQLite file DATABASE_URL names (relative paths are in prisma/)."""
    url = os.environ["DATABASE_URL"]
    path = Path(url.removeprefix("file:"))
    return path if path.is_absolute() else (_PRISMA_DIR / path).resolve()


def clean_all_tables(db_path: Path, known_tables: Iterable[str]) -> None:
    """Delete every row of every table, in any order.

    Args:
        db_path: The SQLite file to empty.
        known_tables: Lowercased model names the test suite knows about. A table
            that exists but is not listed raises, so a new model can't leave
            rows behind between tests unnoticed.

    Raises:
        RuntimeError: If the database holds a table that is not in the list.
    """
    known = {name.lower() for name in known_tables}
    con = sqlite3.connect(db_path, timeout=30)
    try:
        names = [
            row[0]
            for row in con.execute(
                "SELECT name FROM sqlite_master "
                "WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
            )
            if row[0] not in _KEEP
        ]
        unlisted = [name for name in names if name.lower() not in known]
        if unlisted:
            raise RuntimeError(
                f"tests/conftest.py's _ALL_TABLES is missing: {', '.join(unlisted)}"
            )
        # Foreign keys off, so deletion order doesn't matter (as before).
        con.execute("PRAGMA foreign_keys = OFF")
        for name in names:
            con.execute(f'DELETE FROM "{name}"')
        con.commit()
    finally:
        con.close()
