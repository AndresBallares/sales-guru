#!/bin/bash
# Rehearse the rollout on a LOCAL scratch Postgres. Never touches production.
#   1. build the schema from the Postgres migrations
#   2. restore the backed-up rows and compare their md5 with production's
#   3. run apply.sql and compare every changed column with the plan
#   4. run rollback.sql and compare the rows with the backup again
set -euo pipefail
cd "$(dirname "$0")"
DB=venzi_rollout_scratch
case "$DB" in *scratch) ;; *) echo "refusing: not a scratch db"; exit 1;; esac
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
PY=../../.venv/bin/python

dropdb --if-exists "$DB" && createdb "$DB"
for m in $(ls ../../prisma/postgres/migrations | grep -v migration_lock | sort); do
  $P -f "../../prisma/postgres/migrations/$m/migration.sql" >/dev/null
done
echo "scratch schema built from $(ls ../../prisma/postgres/migrations | grep -vc migration_lock) migrations"

$P -f out/restore.sql
# Stub parent row so apply.sql's business check has something to find.
$P -c "SET session_replication_role = replica; INSERT INTO \"Business\" (id, \"organizationId\", name, \"updatedAt\") VALUES ('cmtlnp3t30005fb2hl90ac4tl', 'scratch', 'VENZI JEWELRY (scratch stub)', CURRENT_TIMESTAMP)" 2>&1 | grep -v "^$" || true

hashes() {
  $P -Atc "select 'BrandProfile', id, md5(t::text) from \"BrandProfile\" t union all select 'Product', id, md5(t::text) from \"Product\" t" > out/restored_hashes.txt
  $PY -I - "$1" <<'PY'
import json, sys
label = sys.argv[1]
b = json.load(open("out/backup.json"))["md5"]
got = {}
for line in open("out/restored_hashes.txt"):
    t, i, h = line.strip().split("|")
    got.setdefault(t, {})[i] = h
bad = [(t, i) for t in b for i in b[t] if got.get(t, {}).get(i) != b[t][i]]
n = sum(len(v) for v in b.values())
print(f"{label}: {n - len(bad)}/{n} rows match production md5", "OK" if not bad else f"MISMATCH {bad}")
sys.exit(1 if bad else 0)
PY
}

hashes "RESTORE CHECK (backup -> scratch)"

echo "--- apply.sql on scratch"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f out/apply.sql
$P -Atc "select json_build_object('BrandProfile', (select json_object_agg(id, row_to_json(t)) from \"BrandProfile\" t), 'Product', (select json_object_agg(id, row_to_json(t)) from \"Product\" t), 'rules', (select count(*) from \"BrandRules\"), 'avatars', (select count(*) from \"BuyerAvatar\"))" > out/after_state.json
$PY -I - <<'PY'
import json
after = json.load(open("out/after_state.json"))
before = json.load(open("out/backup.json"))["rows"]
expected = json.load(open("out/expected.json"))
problems = []
for table in ("BrandProfile", "Product"):
    for rid, row in before[table].items():
        want = dict(row)
        want.update(expected[table].get(rid, {}))
        got = after[table][rid]
        for col in want:
            if col == "updatedAt":
                continue
            if got[col] != want[col]:
                problems.append((table, rid, col))
changed = sum(len(v) for v in expected.values())
print(f"APPLY CHECK: {changed} rows changed as planned, every other column unchanged;",
      f"BrandRules={after['rules']}, BuyerAvatar={after['avatars']}",
      "OK" if not problems and after["rules"] == 1 and after["avatars"] == 5 else f"MISMATCH {problems}")
PY
$P -Atc "select id from \"Product\" where id='cmvoaodcd0022y2n12ehbth6y'" | grep -q . && echo "unexpected: excluded product present" || echo "excluded product cmvoaodcd... is not in scratch, so it cannot have been touched"

echo "--- re-apply must fail (guards)"
if psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f out/apply.sql >/dev/null 2>out/reapply_err.txt; then echo "RE-APPLY: unexpectedly succeeded"; exit 1; else echo "RE-APPLY: refused as expected: $(grep -m1 -o 'ERROR:.*' out/reapply_err.txt)"; fi

echo "--- rollback.sql on scratch"
psql -X -q -v ON_ERROR_STOP=1 -d "$DB" -f out/rollback.sql
hashes "ROLLBACK CHECK (after rollback)"
$P -Atc "select (select count(*) from \"BrandRules\"), (select count(*) from \"BuyerAvatar\")" | sed 's/^/rules,avatars after rollback: /'
