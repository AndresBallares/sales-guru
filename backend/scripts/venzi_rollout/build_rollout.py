# ruff: noqa: E501, S608, S311
"""Build the VENZI production rollout: backup, restore, apply and rollback SQL.

Reads the production snapshot (rows fetched with SELECT only) and the dev
database, and writes everything into ``out/``. It never connects to production.
The apply script is run by the user; see docs/rollout-venzi.md.

Usage:
    .venv/bin/python scripts/venzi_rollout/build_rollout.py
"""

import json
import secrets
import sqlite3
import string
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).parent
OUT = HERE / "out"
SNAPSHOT = HERE / "snapshot" / "prod_rows_raw.json"
DEV_DB = HERE.parent.parent / "prisma" / "dev.db"

DEV_BUSINESS = "cmuwq4p1g0005wqovs9t0yfby"
PROD_BUSINESS = "cmtlnp3t30005fb2hl90ac4tl"
PROD_PROFILE = "cmtxdfune0001axnbveitikcj"
EXCLUDED_PRODUCT = "cmvoaodcd0022y2n12ehbth6y"  # keeps its own mechanism
SERPENT_IDS = ("cmvu30mpo000p7s862nurfyly", "cmvufkmwj001f7s86vplvj3w3")
SERPENT_URL = "https://venzijewelry.com/products/serpent-emerald-diamonds-ceramic"
SERPENT_PRICE = 13500
MECHANISM = "Where painted color chips and fades, our ceramic inlay holds its color."
BRAND_PHRASE_REMOVED = "Meticulously crafted with unparalleled craftsmanship"
OLD = "exceptional craftsmanship"
NEW = "pieces made in New York"
# The one benefits text whose sentence is a verb list ("offers X feels ..."):
# a plain swap reads badly, so the clause is rewritten as "is made in New York,
# and feels ...".
VARIANT_FIXES = {
    "cmtuv8ntr0003hh6bpbargjqf": (
        f"offers {OLD} feels exclusive",
        "is made in New York, and feels exclusive",
    ),
}
# Further one-row text fixes, applied after the swap; each must match or the build stops.
TEXT_FIXES = {
    "cmtuv8ntr0003hh6bpbargjqf": ("replace", "distintive", "distinctive"),
    "cmuxk3zvn00038feu6mkhwvom": ("prefix", "express their", "VENZI helps clients "),
    "cmuxnv4gi0003bm0dnnanlzaz": ("suffix", "experience", "."),
}
AVATAR_COLUMNS = (
    "name",
    "who",
    "primaryProblems",
    "unknownProblems",
    "mechanisms",
    "alternatives",
    "objections",
    "hooks",
    "creativeAngles",
    "purchaseFor",
)


def lit(value: object) -> str:
    """A SQL literal: NULL, a number, a boolean, or a dollar-quoted string."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    text = str(value)
    if "$v$" in text:
        sys.exit("a value contains the dollar-quote tag $v$")
    return f"$v${text}$v$"


def new_id() -> str:
    """A cuid-shaped id: 'c' plus 24 lowercase letters and digits."""
    alphabet = string.ascii_lowercase + string.digits
    return "c" + "".join(secrets.choice(alphabet) for _ in range(24))


def stable_ids(count: int) -> list[str]:
    """Ids for the new rows, generated once and kept so reruns match."""
    path = OUT / "new_ids.json"
    if path.exists():
        return [str(i) for i in json.loads(path.read_text())]
    ids = [new_id() for _ in range(count)]
    path.write_text(json.dumps(ids))
    return ids


def load_prod() -> dict[str, dict[str, dict[str, Any]]]:
    """Production rows to back up, by table then id (Business is not touched)."""
    rows: dict[str, dict[str, dict[str, Any]]] = {"BrandProfile": {}, "Product": {}}
    hashes: dict[str, dict[str, str]] = {"BrandProfile": {}, "Product": {}}
    for row in json.loads(SNAPSHOT.read_text()):
        if row["tbl"] not in rows:
            continue
        rows[row["tbl"]][row["id"]] = json.loads(row["j"])
        hashes[row["tbl"]][row["id"]] = row["h"]
    (OUT / "backup.json").write_text(
        json.dumps({"rows": rows, "md5": hashes}, indent=1, ensure_ascii=False)
    )
    return rows


def load_dev() -> dict[str, Any]:
    """Banned phrases, proof points and avatars as finished in dev."""
    con = sqlite3.connect(f"file:{DEV_DB}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    rules = con.execute(
        "select bannedPhrases from BrandRules where businessId=?", (DEV_BUSINESS,)
    ).fetchone()
    profile = con.execute(
        "select proofPoints, offer from BrandProfile where businessId=?",
        (DEV_BUSINESS,),
    ).fetchone()
    avatars = con.execute(
        f"select {', '.join(AVATAR_COLUMNS)}, sortOrder from BuyerAvatar "
        "where businessId=? and isActive=1 and deletedAt is null order by sortOrder",
        (DEV_BUSINESS,),
    ).fetchall()
    return {
        "banned": rules["bannedPhrases"],
        "proof": profile["proofPoints"],
        "dev_offer": profile["offer"],
        "avatars": [dict(a) for a in avatars],
    }


def plan_products(products: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """The benefits swap on every production product that has the old phrase."""
    plan = []
    for pid, row in products.items():
        before = row["benefits"]
        if OLD not in (before or ""):
            continue
        after = before
        if pid in VARIANT_FIXES:
            old, new = VARIANT_FIXES[pid]
            if old not in after:
                sys.exit(f"variant fix for {pid} no longer matches")
            after = after.replace(old, new)
        after = after.replace(OLD, NEW)
        if pid in TEXT_FIXES:
            kind, anchor, extra = TEXT_FIXES[pid]
            if kind == "replace" and anchor in after:
                after = after.replace(anchor, extra)
            elif kind == "prefix" and after.startswith(anchor):
                after = extra + after
            elif kind == "suffix" and after.endswith(anchor):
                after = after + extra
            else:
                sys.exit(f"text fix for {pid} no longer matches")
        plan.append({"id": pid, "before": before, "after": after})
    return plan


def main() -> None:
    """Write the SQL files and the human-readable dry run."""
    OUT.mkdir(exist_ok=True)
    prod = load_prod()
    dev = load_dev()
    profile = prod["BrandProfile"][PROD_PROFILE]
    products = prod["Product"]

    if json.loads(dev["banned"]).__len__() != 31:
        sys.exit("dev does not have 31 banned phrases")
    if len(dev["avatars"]) != 5:
        sys.exit("dev does not have 5 avatars")
    if len(json.loads(dev["proof"])) != 10:
        sys.exit("dev does not have 10 proof points")
    if dev["dev_offer"] is not None:
        sys.exit("dev offer is not null")
    if profile["proofPoints"] is not None or profile["offer"] is not None:
        sys.exit("production proofPoints/offer are no longer empty")

    # brandPhrases: drop exactly one comma-separated entry, keep the rest.
    entries = [e.strip() for e in profile["brandPhrases"].split(", ")]
    if entries.count(BRAND_PHRASE_REMOVED) != 1:
        sys.exit("brandPhrases entry to remove is not present exactly once")
    old_phrases = profile["brandPhrases"]
    new_phrases = ", ".join(e for e in entries if e != BRAND_PHRASE_REMOVED)

    benefit_plan = plan_products(products)
    if len(benefit_plan) != 9:
        sys.exit(f"expected 9 products with the old phrase, found {len(benefit_plan)}")
    for pid in SERPENT_IDS:
        row = products[pid]
        if row["mechanism"] is not None or row["price"] != SERPENT_PRICE:
            sys.exit(f"{pid} is not the expected serpent row")
        if row["url"] != SERPENT_URL:
            sys.exit(f"{pid} url differs")
    if EXCLUDED_PRODUCT in products:
        sys.exit("the excluded product is in the plan")

    (OUT / "new_banned.json").write_text(dev["banned"])
    ids = stable_ids(1 + len(dev["avatars"]))
    rules_id, avatar_ids = ids[0], ids[1:]

    sql = [
        "\\set ON_ERROR_STOP on",
        "BEGIN;",
        "DO $apply$",
        "DECLARE n integer;",
        "BEGIN",
    ]
    sql += [
        f'  IF (SELECT count(*) FROM "Business" WHERE id = {lit(PROD_BUSINESS)}) <> 1 '
        "THEN RAISE EXCEPTION 'business missing'; END IF;",
        f'  IF (SELECT count(*) FROM "BrandRules" WHERE "businessId" = {lit(PROD_BUSINESS)}) <> 0 '
        "THEN RAISE EXCEPTION 'brand rules already exist'; END IF;",
        f'  IF (SELECT count(*) FROM "BuyerAvatar" WHERE "businessId" = {lit(PROD_BUSINESS)}) <> 0 '
        "THEN RAISE EXCEPTION 'avatars already exist'; END IF;",
        '  INSERT INTO "BrandRules" (id, "businessId", "bannedPhrases", "requiredDisclosures", '
        '"createdAt", "updatedAt") VALUES '
        f"({lit(rules_id)}, {lit(PROD_BUSINESS)}, {lit(dev['banned'])}, '[]', "
        "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);",
    ]
    for aid, avatar in zip(avatar_ids, dev["avatars"], strict=True):
        cols = ", ".join(f'"{c}"' for c in AVATAR_COLUMNS)
        vals = ", ".join(lit(avatar[c]) for c in AVATAR_COLUMNS)
        sql.append(
            f'  INSERT INTO "BuyerAvatar" (id, "businessId", {cols}, "isActive", '
            '"sortOrder", "createdAt", "updatedAt") VALUES '
            f"({lit(aid)}, {lit(PROD_BUSINESS)}, {vals}, true, {avatar['sortOrder']}, "
            "CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);"
        )
    sql += [
        f'  UPDATE "BrandProfile" SET "proofPoints" = {lit(dev["proof"])}, '
        f'"brandPhrases" = {lit(new_phrases)}, "updatedAt" = CURRENT_TIMESTAMP '
        f'WHERE id = {lit(PROD_PROFILE)} AND "proofPoints" IS NULL AND offer IS NULL '
        f'AND "brandPhrases" = {lit(old_phrases)};',
        "  GET DIAGNOSTICS n = ROW_COUNT;",
        "  IF n <> 1 THEN RAISE EXCEPTION 'brand profile row did not match (%)', n; END IF;",
    ]
    for item in benefit_plan:
        sql += [
            f'  UPDATE "Product" SET benefits = {lit(item["after"])}, '
            f'"updatedAt" = CURRENT_TIMESTAMP WHERE id = {lit(item["id"])} '
            f'AND "businessId" = {lit(PROD_BUSINESS)} AND benefits = {lit(item["before"])};',
            "  GET DIAGNOSTICS n = ROW_COUNT;",
            f"  IF n <> 1 THEN RAISE EXCEPTION 'benefits row {item['id']} did not match (%)', n; END IF;",
        ]
    for pid in SERPENT_IDS:
        sql += [
            f'  UPDATE "Product" SET mechanism = {lit(MECHANISM)}, "updatedAt" = CURRENT_TIMESTAMP '
            f'WHERE id = {lit(pid)} AND "businessId" = {lit(PROD_BUSINESS)} '
            f"AND mechanism IS NULL AND url = {lit(SERPENT_URL)} AND price = {SERPENT_PRICE};",
            "  GET DIAGNOSTICS n = ROW_COUNT;",
            f"  IF n <> 1 THEN RAISE EXCEPTION 'mechanism row {pid} did not match (%)', n; END IF;",
        ]
    sql += [
        f'  IF (SELECT count(*) FROM "BuyerAvatar" WHERE "businessId" = {lit(PROD_BUSINESS)}) <> 5 '
        "THEN RAISE EXCEPTION 'expected 5 avatars'; END IF;",
        f'  IF (SELECT count(*) FROM "Product" WHERE "businessId" = {lit(PROD_BUSINESS)} '
        f"AND benefits ILIKE {lit('%' + OLD + '%')}) <> 0 "
        "THEN RAISE EXCEPTION 'old phrase still present'; END IF;",
        "END",
        "$apply$;",
        "COMMIT;",
        "",
    ]
    (OUT / "apply.sql").write_text("\n".join(sql))

    rb = ["\\set ON_ERROR_STOP on", "BEGIN;", "DO $rb$", "DECLARE n integer;", "BEGIN"]
    rb += [
        f'  DELETE FROM "BuyerAvatar" WHERE "businessId" = {lit(PROD_BUSINESS)} '
        f"AND id IN ({', '.join(lit(a) for a in avatar_ids)});",
        f'  DELETE FROM "BrandRules" WHERE id = {lit(rules_id)} AND "businessId" = {lit(PROD_BUSINESS)};',
        f'  UPDATE "BrandProfile" SET "proofPoints" = NULL, "brandPhrases" = {lit(old_phrases)}, '
        f'"updatedAt" = {lit(profile["updatedAt"])}::timestamp WHERE id = {lit(PROD_PROFILE)} '
        f'AND "brandPhrases" = {lit(new_phrases)};',
        "  GET DIAGNOSTICS n = ROW_COUNT;",
        "  IF n <> 1 THEN RAISE EXCEPTION 'profile rollback mismatch'; END IF;",
    ]
    for item in benefit_plan:
        orig = products[item["id"]]
        rb += [
            f'  UPDATE "Product" SET benefits = {lit(item["before"])}, mechanism = {lit(orig["mechanism"])}, '
            f'"updatedAt" = {lit(orig["updatedAt"])}::timestamp WHERE id = {lit(item["id"])} '
            f"AND benefits = {lit(item['after'])};",
            "  GET DIAGNOSTICS n = ROW_COUNT;",
            f"  IF n <> 1 THEN RAISE EXCEPTION 'product rollback {item['id']} mismatch'; END IF;",
        ]
    rb += ["END", "$rb$;", "COMMIT;", ""]
    (OUT / "rollback.sql").write_text("\n".join(rb))

    restore = ["SET session_replication_role = replica;"]
    for table in ("BrandProfile", "Product"):
        for row in prod[table].values():
            restore.append(
                f'INSERT INTO "{table}" SELECT * FROM json_populate_record('
                f'NULL::"{table}", {lit(json.dumps(row, ensure_ascii=False))}::json);'
            )
    (OUT / "restore.sql").write_text("\n".join(restore) + "\n")

    expected = {
        "BrandProfile": {
            PROD_PROFILE: {"proofPoints": dev["proof"], "brandPhrases": new_phrases}
        },
        "Product": {
            **{i["id"]: {"benefits": i["after"]} for i in benefit_plan},
            **{pid: {"mechanism": MECHANISM} for pid in SERPENT_IDS},
        },
    }
    # a serpent row also has a benefits change; merge both
    expected["Product"][SERPENT_IDS[0]] = {
        "benefits": next(i["after"] for i in benefit_plan if i["id"] == SERPENT_IDS[0]),
        "mechanism": MECHANISM,
    }
    expected["Product"][SERPENT_IDS[1]] = {
        "benefits": next(i["after"] for i in benefit_plan if i["id"] == SERPENT_IDS[1]),
        "mechanism": MECHANISM,
    }
    (OUT / "expected.json").write_text(
        json.dumps(expected, indent=1, ensure_ascii=False)
    )

    report = ["# VENZI rollout dry run", ""]
    report += [
        f"## INSERT BrandRules (id {rules_id}) for business {PROD_BUSINESS}",
        f"bannedPhrases ({len(json.loads(dev['banned']))}):",
    ]
    report += [f"  {i + 1:>2}. {p}" for i, p in enumerate(json.loads(dev["banned"]))]
    report += ["", "## INSERT BuyerAvatar x5"]
    for aid, a in zip(avatar_ids, dev["avatars"], strict=True):
        report.append(
            f"- {aid} | {a['name']} | purchaseFor={a['purchaseFor']} | sortOrder={a['sortOrder']}"
        )
        for col in AVATAR_COLUMNS:
            if col not in ("name", "purchaseFor"):
                report.append(f"    {col}: {a[col]}")
    report += ["", f"## UPDATE BrandProfile {PROD_PROFILE}"]
    report += [
        "proofPoints:",
        "  BEFORE: NULL",
        f"  AFTER : {dev['proof']}",
        "brandPhrases:",
        f"  BEFORE: {old_phrases}",
        f"  AFTER : {new_phrases}",
        f"  (removed exactly one entry: {BRAND_PHRASE_REMOVED!r})",
        "offer: NULL (unchanged)",
    ]
    report += ["", f"## UPDATE Product.benefits x{len(benefit_plan)}"]
    for item in benefit_plan:
        report += [
            f"- {item['id']}",
            f"    BEFORE: {item['before']!r}",
            f"    AFTER : {item['after']!r}",
        ]
    report += [
        "",
        "## UPDATE Product.mechanism x2 (guard: mechanism IS NULL, url, price 13500)",
    ]
    for pid in SERPENT_IDS:
        row = products[pid]
        report += [
            f"- {pid} | {row['url']} | price {row['price']}",
            f"    BEFORE: {row['mechanism']!r}",
            f"    AFTER : {MECHANISM!r}",
        ]
    report += ["", f"NOT touched: {EXCLUDED_PRODUCT} (keeps its existing mechanism)"]
    (OUT / "dry_run.txt").write_text("\n".join(report) + "\n")
    print("\n".join(report))


if __name__ == "__main__":
    main()
