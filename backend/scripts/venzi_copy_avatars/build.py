# ruff: noqa: E501  (the SQL templates below keep one statement per line)
"""Build the guarded SQL that copies three dev avatars into VENZI's production library.

Run by the owner, from ``backend``, to (re)generate the files from the dev library::

    uv run python scripts/venzi_copy_avatars/build.py

It reads ``prisma/dev.db`` read-only, writes ``avatars.json`` (the exact text that
will be inserted, for the owner to read) and generates ``dry_run.sql``, ``apply.sql``
and ``rollback.sql`` from it. Nothing here connects to production.
"""

import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
BUSINESS_ID = "cmtlnp3t30005fb2hl90ac4tl"  # VENZI JEWELRY, production
DEV_IDS = (
    "c2a9aecc452be888f57689022",  # The Next-Chapter Right-Hand Buyer
    "cc8a0771551c3cafbb3a7ed46",  # The Plain-Gold Loyalist Who Wants Color
    "c86030f2bc0426dbff623d9ff",  # The Mother Passing It Forward
)
ACTIVE_BEFORE = 5  # production VENZI's avatars when this was written (2026-11-04)
FIRST_SORT_ORDER = 5
LIBRARY_LIMIT = 12
LIST_FIELDS = (
    "primaryProblems",
    "unknownProblems",
    "mechanisms",
    "alternatives",
    "objections",
    "hooks",
    "creativeAngles",
    "concepts",
)
COLUMNS = (
    "id",
    "businessId",
    "name",
    "who",
    "purchaseFor",
    "primaryProblems",
    "unknownProblems",
    "mechanisms",
    "alternatives",
    "objections",
    "hooks",
    "creativeAngles",
    "concepts",
    "isActive",
    "sortOrder",
    "createdAt",
    "updatedAt",
)


def load_from_dev(
    db_path: Path, ids: list[str] | tuple[str, ...]
) -> list[dict[str, Any]]:
    """Read the avatars from the dev database, read-only, in the order of ``ids``.

    Args:
        db_path: The SQLite file.
        ids: Avatar ids to copy.

    Returns:
        One dict per avatar with the list columns parsed and ``sortOrder`` set.

    Raises:
        ValueError: If an id is not in the database.
    """
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        found: dict[str, sqlite3.Row] = {}
        for avatar_id in ids:
            row = conn.execute(
                'SELECT * FROM "BuyerAvatar" WHERE id = ?', (avatar_id,)
            ).fetchone()
            if row is None:
                raise ValueError(f"avatar {avatar_id} not found in {db_path}")
            found[avatar_id] = row
    finally:
        conn.close()
    avatars: list[dict[str, Any]] = []
    for position, avatar_id in enumerate(ids):
        row = found[avatar_id]
        avatar: dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "who": row["who"],
            "purchaseFor": row["purchaseFor"],
        }
        for field in LIST_FIELDS:
            avatar[field] = json.loads(row[field])
        avatar["sortOrder"] = FIRST_SORT_ORDER + position
        avatars.append(avatar)
    return avatars


def check(avatars: list[dict[str, Any]]) -> None:
    """Refuse avatars the library itself would refuse.

    Args:
        avatars: The avatars to copy.

    Raises:
        ValueError: If there are none, or one is outside the library's limits.
    """
    from app.schemas.buyer_avatar import BuyerAvatarCreateRequest

    if not avatars:
        raise ValueError("need at least one avatar")
    for avatar in avatars:
        try:
            BuyerAvatarCreateRequest.model_validate(avatar)
        except ValueError as exc:
            raise ValueError(f"{avatar.get('name')!r}: {exc}") from exc


def lit(value: object) -> str:
    """Return a SQL literal for a string, bool, int or list (as JSON text)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = (
        json.dumps(value, ensure_ascii=False) if isinstance(value, list) else str(value)
    )
    return "'" + text.replace("'", "''") + "'"


def _ids(avatars: list[dict[str, Any]]) -> str:
    return ", ".join(lit(a["id"]) for a in avatars)


def _names(avatars: list[dict[str, Any]]) -> str:
    return ", ".join(lit(a["name"]) for a in avatars)


def _values(avatars: list[dict[str, Any]]) -> str:
    rows = []
    for avatar in avatars:
        cells = []
        for column in COLUMNS:
            if column == "businessId":
                cells.append("biz")
            elif column == "isActive":
                cells.append("true")
            elif column in ("createdAt", "updatedAt"):
                cells.append("ts")
            else:
                cells.append(lit(avatar[column]))
        rows.append("    (" + ", ".join(cells) + ")")
    return ",\n".join(rows)


def apply_sql(avatars: list[dict[str, Any]]) -> str:
    """Return apply.sql: guarded insert of the avatars in one transaction."""
    n = len(avatars)
    columns = ", ".join(f'"{c}"' for c in COLUMNS)
    return f"""-- Copy {n} dev avatars into VENZI's production avatar library.
-- GENERATED by build.py from avatars.json: do not edit by hand.
-- Run by the user, never by Claude:   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f apply.sql
-- Read dry_run.sql first. Undo with rollback.sql.
--
-- Guards (the whole script aborts and changes nothing if any fails):
--   * the business exists;
--   * none of the {n} ids exists yet (so a second run is refused);
--   * the business has exactly {ACTIVE_BEFORE} active avatars and none at sort order {FIRST_SORT_ORDER} or above;
--   * no active avatar already has one of these names (case ignored);
--   * the library stays within {LIBRARY_LIMIT};
--   * exactly {n} rows are inserted.
-- sourceRunId and sourceDraftIndex are left empty: the research run is not in production.
BEGIN;
DO $$
DECLARE
  biz CONSTANT text := {lit(BUSINESS_ID)};
  ts timestamp := (now() AT TIME ZONE 'UTC');
  n int;
  clash text;
BEGIN
  PERFORM 1 FROM "Business" WHERE id = biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'business % not found', biz; END IF;

  SELECT count(*) INTO n FROM "BuyerAvatar" WHERE id IN ({_ids(avatars)});
  IF n <> 0 THEN RAISE EXCEPTION 'already applied: % of these avatar ids already exist', n; END IF;

  SELECT count(*) INTO n FROM "BuyerAvatar" WHERE "businessId" = biz AND "deletedAt" IS NULL;
  IF n <> {ACTIVE_BEFORE} THEN RAISE EXCEPTION 'expected exactly {ACTIVE_BEFORE} active avatars, found %', n; END IF;
  IF n + {n} > {LIBRARY_LIMIT} THEN RAISE EXCEPTION 'the library would pass {LIBRARY_LIMIT} avatars'; END IF;

  SELECT count(*) INTO n FROM "BuyerAvatar"
   WHERE "businessId" = biz AND "deletedAt" IS NULL AND "sortOrder" >= {FIRST_SORT_ORDER};
  IF n <> 0 THEN RAISE EXCEPTION 'sort order {FIRST_SORT_ORDER} or above is already used by % avatar(s)', n; END IF;

  SELECT name INTO clash FROM "BuyerAvatar"
   WHERE "businessId" = biz AND "deletedAt" IS NULL
     AND lower(name) IN (SELECT lower(x) FROM unnest(ARRAY[{_names(avatars)}]) AS x)
   LIMIT 1;
  IF clash IS NOT NULL THEN RAISE EXCEPTION 'business already has an avatar named %', clash; END IF;

  INSERT INTO "BuyerAvatar" ({columns})
  VALUES
{_values(avatars)};
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> {n} THEN RAISE EXCEPTION 'expected to insert {n} rows, inserted %', n; END IF;
END $$;
COMMIT;
"""


def rollback_sql(avatars: list[dict[str, Any]]) -> str:
    """Return rollback.sql: guarded delete of exactly the copied avatars."""
    n = len(avatars)
    return f"""-- Undo apply.sql: delete exactly the {n} copied avatars.
-- GENERATED by build.py from avatars.json: do not edit by hand.
-- Run by the user, never by Claude:   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f rollback.sql
--
-- Guards (aborts and changes nothing if any fails):
--   * exactly {n} of the copied ids exist, all in VENZI and none soft-deleted;
--   * none was edited after the copy (updatedAt still equals createdAt);
--   * no ad (Creative) and no strategy mentions any of them, so nothing is left dangling;
--   * exactly {n} rows are deleted.
BEGIN;
DO $$
DECLARE
  biz CONSTANT text := {lit(BUSINESS_ID)};
  ids CONSTANT text[] := ARRAY[{_ids(avatars)}];
  n int;
BEGIN
  SELECT count(*) INTO n FROM "BuyerAvatar"
   WHERE id = ANY(ids) AND "businessId" = biz AND "deletedAt" IS NULL;
  IF n <> {n} THEN RAISE EXCEPTION 'expected exactly {n} copied avatars in VENZI, found %', n; END IF;

  SELECT count(*) INTO n FROM "BuyerAvatar" WHERE id = ANY(ids) AND "updatedAt" <> "createdAt";
  IF n <> 0 THEN
    RAISE EXCEPTION '% copied avatar(s) was edited after the copy; remove by hand if you still want them gone', n;
  END IF;

  SELECT count(*) INTO n FROM "Creative" WHERE "buyerAvatarId" = ANY(ids);
  IF n <> 0 THEN RAISE EXCEPTION '% ad(s) already use these avatars', n; END IF;

  SELECT count(*) INTO n FROM "Strategy" s
   WHERE EXISTS (SELECT 1 FROM unnest(ids) AS i WHERE s.content LIKE '%' || i || '%');
  IF n <> 0 THEN RAISE EXCEPTION '% strategy(ies) mention these avatars', n; END IF;

  DELETE FROM "BuyerAvatar" WHERE id = ANY(ids) AND "businessId" = biz;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> {n} THEN RAISE EXCEPTION 'expected to delete {n} rows, deleted %', n; END IF;
END $$;
COMMIT;
"""


def dry_run_sql(avatars: list[dict[str, Any]]) -> str:
    """Return dry_run.sql: SELECT-only checks of what apply.sql would see."""
    n = len(avatars)
    return f"""-- Dry run for apply.sql. SELECT only: it cannot change anything.
-- GENERATED by build.py from avatars.json: do not edit by hand.
-- Run by the user:   psql "$PROD_URL" -f dry_run.sql
-- Every "ok" column should read true before you run apply.sql.
SELECT 'business exists' AS check, count(*) = 1 AS ok, count(*) AS found
  FROM "Business" WHERE id = {lit(BUSINESS_ID)};
SELECT 'copied ids are free' AS check, count(*) = 0 AS ok, count(*) AS found
  FROM "BuyerAvatar" WHERE id IN ({_ids(avatars)});
SELECT 'exactly {ACTIVE_BEFORE} active avatars' AS check, count(*) = {ACTIVE_BEFORE} AS ok, count(*) AS found
  FROM "BuyerAvatar" WHERE "businessId" = {lit(BUSINESS_ID)} AND "deletedAt" IS NULL;
SELECT 'sort order {FIRST_SORT_ORDER}+ is free' AS check, count(*) = 0 AS ok, count(*) AS found
  FROM "BuyerAvatar"
 WHERE "businessId" = {lit(BUSINESS_ID)} AND "deletedAt" IS NULL AND "sortOrder" >= {FIRST_SORT_ORDER};
SELECT 'no name clash' AS check, count(*) = 0 AS ok, count(*) AS found
  FROM "BuyerAvatar"
 WHERE "businessId" = {lit(BUSINESS_ID)} AND "deletedAt" IS NULL
   AND lower(name) IN (SELECT lower(x) FROM unnest(ARRAY[{_names(avatars)}]) AS x);
SELECT 'library after = ' || (count(*) + {n}) || ' of {LIBRARY_LIMIT}' AS check,
       count(*) + {n} <= {LIBRARY_LIMIT} AS ok, count(*) AS found
  FROM "BuyerAvatar" WHERE "businessId" = {lit(BUSINESS_ID)} AND "deletedAt" IS NULL;
-- The avatars that exist today, for comparison:
SELECT "sortOrder", name, "purchaseFor", "isActive"
  FROM "BuyerAvatar" WHERE "businessId" = {lit(BUSINESS_ID)} AND "deletedAt" IS NULL
 ORDER BY "sortOrder";
"""


def main() -> int:
    """Regenerate avatars.json and the three SQL files from the dev library."""
    backend = HERE.parents[1]
    sys.path.insert(0, str(backend))
    avatars = load_from_dev(backend / "prisma" / "dev.db", DEV_IDS)
    check(avatars)
    (HERE / "avatars.json").write_text(
        json.dumps(avatars, indent=2, ensure_ascii=False) + "\n"
    )
    (HERE / "apply.sql").write_text(apply_sql(avatars))
    (HERE / "rollback.sql").write_text(rollback_sql(avatars))
    (HERE / "dry_run.sql").write_text(dry_run_sql(avatars))
    print(f"Wrote {len(avatars)} avatars and 3 SQL files to {HERE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
