#!/bin/bash
# Rehearse apply.sql and rollback.sql on a LOCAL scratch Postgres. Never touches production.
set -uo pipefail
cd "$(dirname "$0")"
DB=venzi_rename_scratch
case "$DB" in *scratch) ;; *) echo "refusing: not a scratch db"; exit 1;; esac
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
fail=0
check() { if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1 (got '$2', want '$3')"; fail=1; fi; }
expect_refused() { # description, command...
  desc="$1"; shift
  if out=$("$@" 2>&1); then echo "FAIL $desc: was NOT refused"; fail=1; else echo "OK   $desc: refused ($(echo "$out" | grep -o 'ERROR:.*' | head -1))"; fi
}
row() { $P -Atc "select name || '|' || \"updatedAt\"::text from \"Product\" where id='cmvzqszw20004kpk1mk5slpnn'"; }

dropdb --if-exists "$DB" && createdb "$DB"
for m in $(ls ../../prisma/postgres/migrations | grep -v migration_lock | sort); do
  $P -f "../../prisma/postgres/migrations/$m/migration.sql" >/dev/null
done
echo "scratch schema built from $(ls ../../prisma/postgres/migrations | grep -vc migration_lock) migrations"
$P -c "SET session_replication_role = replica;
INSERT INTO \"Business\" (id, \"organizationId\", name, \"updatedAt\") VALUES ('cmtlnp3t30005fb2hl90ac4tl','scratch','VENZI (scratch stub)',CURRENT_TIMESTAMP);
INSERT INTO \"Product\" (id, \"businessId\", name, description, \"updatedAt\") VALUES ('cmvzqszw20004kpk1mk5slpnn','cmtlnp3t30005fb2hl90ac4tl','Serpenti','scratch','2026-11-02 21:00:01.586');
INSERT INTO \"Product\" (id, \"businessId\", name, description, \"updatedAt\") VALUES ('other','cmtlnp3t30005fb2hl90ac4tl',NULL,'unnamed','2026-11-02 17:20:25.544');"

check "before apply" "$(row)" "Serpenti|2026-11-02 21:00:01.586"
expect_refused "rollback before apply" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f rollback.sql
$P -f apply.sql 2>&1 | grep -i notice
n=$(row); check "after apply name" "${n%%|*}" "Emerald Coil"
check "other product untouched" "$($P -Atc "select coalesce(name,'NULL')||'|'||\"updatedAt\"::text from \"Product\" where id='other'")" "NULL|2026-11-02 17:20:25.544"
expect_refused "re-apply" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f apply.sql
$P -f rollback.sql
check "after rollback (name and updatedAt restored)" "$(row)" "Serpenti|2026-11-02 21:00:01.586"
expect_refused "re-rollback" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f rollback.sql
$P -c "SET session_replication_role = replica; INSERT INTO \"Product\" (id, \"businessId\", name, description, \"updatedAt\") VALUES ('dup','cmtlnp3t30005fb2hl90ac4tl','Serpenti','dup',CURRENT_TIMESTAMP)"
expect_refused "apply with two products named Serpenti" psql -X -q -v ON_ERROR_STOP=1 -d $DB -f apply.sql
check "nothing changed after refused apply" "$(row)" "Serpenti|2026-11-02 21:00:01.586"
[ $fail = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
