#!/bin/bash
# Rehearse dry_run.sql, apply.sql and rollback.sql on a LOCAL scratch Postgres.
# Never touches production. Run from anywhere:   bash rehearse.sh
set -uo pipefail
cd "$(dirname "$0")"
DB=venzi_copy_scratch
case "$DB" in *scratch) ;; *) echo "refusing: not a scratch db"; exit 1;; esac
BIZ=cmtlnp3t30005fb2hl90ac4tl
P="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
fail=0
check() { if [ "$2" = "$3" ]; then echo "OK   $1"; else echo "FAIL $1 (got '$2', want '$3')"; fail=1; fi; }
expect_refused() { # description, expected message fragment, file
  if out=$($P -f "$3" 2>&1); then echo "FAIL $1: was NOT refused"; fail=1
  elif echo "$out" | grep -q "$2"; then echo "OK   $1: refused ($(echo "$out" | grep -o 'ERROR:.*' | head -1))"
  else echo "FAIL $1: refused for another reason: $(echo "$out" | head -2)"; fail=1; fi
}
count() { $P -Atc "select count(*) from \"BuyerAvatar\" where \"businessId\"='$BIZ' and \"deletedAt\" is null"; }
dry_ok() { $P -At -f dry_run.sql | grep -c '|f|'; }

dropdb --if-exists "$DB" 2>/dev/null; createdb "$DB"
for m in $(ls ../../prisma/postgres/migrations | grep -v migration_lock | sort); do
  $P -f "../../prisma/postgres/migrations/$m/migration.sql" >/dev/null
done
echo "scratch schema built from $(ls ../../prisma/postgres/migrations | grep -vc migration_lock) migrations"
$P -c "SET session_replication_role = replica;
INSERT INTO \"Business\" (id, \"organizationId\", name, \"updatedAt\") VALUES ('$BIZ','scratch','VENZI (scratch stub)',CURRENT_TIMESTAMP);
INSERT INTO \"BuyerAvatar\" (id,\"businessId\",name,who,\"sortOrder\",\"updatedAt\") VALUES
 ('s0','$BIZ','The Promotion Ring Buyer','w',0,CURRENT_TIMESTAMP),
 ('s1','$BIZ','The Plated-Burned Upgrader','w',1,CURRENT_TIMESTAMP),
 ('s2','$BIZ','The Deadline Gift-Giver','w',2,CURRENT_TIMESTAMP),
 ('s3','$BIZ','The Heirloom Commissioner','w',3,CURRENT_TIMESTAMP),
 ('s4','$BIZ','The Quiet-Luxury Collector','w',4,CURRENT_TIMESTAMP);"

check "before: 5 active avatars" "$(count)" "5"
check "dry run: every check true" "$(dry_ok)" "0"
expect_refused "rollback before apply" "expected exactly 3 copied" rollback.sql
$P -f apply.sql 2>&1 | grep -i notice
check "after apply: 8 active avatars" "$(count)" "8"
check "sort orders 0..7" "$($P -Atc "select string_agg(\"sortOrder\"::text, ',' order by \"sortOrder\") from \"BuyerAvatar\" where \"businessId\"='$BIZ'")" "0,1,2,3,4,5,6,7"
check "purchaseFor of the copies" "$($P -Atc "select string_agg(\"purchaseFor\", ',' order by \"sortOrder\") from \"BuyerAvatar\" where \"sortOrder\">=5")" "self,self,gift"
check "no run link, active, not deleted" "$($P -Atc "select count(*) from \"BuyerAvatar\" where \"sortOrder\">=5 and \"sourceRunId\" is null and \"sourceDraftIndex\" is null and \"isActive\" and \"deletedAt\" is null")" "3"
check "createdAt = updatedAt" "$($P -Atc "select count(*) from \"BuyerAvatar\" where \"sortOrder\">=5 and \"createdAt\"=\"updatedAt\"")" "3"
check "existing five untouched" "$($P -Atc "select count(*) from \"BuyerAvatar\" where id like 's%' and who='w' and \"sortOrder\"<5")" "5"
# every stored text equals the JSON file's, character for character
python3 - <<PY || fail=1
import json, subprocess
rows = json.load(open("avatars.json"))
bad = 0
for r in rows:
    for col in ("name","who","purchaseFor"):
        got = subprocess.run(["psql","-X","-At","-d","$DB","-c",f'select "{col}" from "BuyerAvatar" where id=\'{r["id"]}\''],capture_output=True,text=True).stdout.rstrip("\n")
        if got != r[col]: bad += 1; print("MISMATCH", r["id"], col)
    for col in ("primaryProblems","unknownProblems","mechanisms","alternatives","objections","hooks","creativeAngles","concepts"):
        got = subprocess.run(["psql","-X","-At","-d","$DB","-c",f'select "{col}" from "BuyerAvatar" where id=\'{r["id"]}\''],capture_output=True,text=True).stdout.rstrip("\n")
        if json.loads(got) != r[col]: bad += 1; print("MISMATCH", r["id"], col)
print("OK   stored text equals avatars.json" if not bad else "FAIL stored text differs")
raise SystemExit(1 if bad else 0)
PY
expect_refused "re-apply" "already applied" apply.sql
check "dry run after apply flags the ids" "$($P -At -f dry_run.sql | grep -c 'copied ids are free|f|')" "1"

# rollback guards
$P -c "UPDATE \"BuyerAvatar\" SET \"updatedAt\" = \"updatedAt\" + interval '1 minute' WHERE id = '$(python3 -c 'import json;print(json.load(open("avatars.json"))[0]["id"])')'"
expect_refused "rollback of an edited avatar" "edited after the copy" rollback.sql
$P -c "UPDATE \"BuyerAvatar\" SET \"updatedAt\" = \"createdAt\""
ID1=$(python3 -c 'import json;print(json.load(open("avatars.json"))[1]["id"])')
$P -c "SET session_replication_role = replica; INSERT INTO \"Strategy\" (id,\"campaignId\",content) VALUES ('st1','c1','{\"angles\":[{\"buyer_avatar_id\":\"$ID1\"}]}')"
expect_refused "rollback while a strategy mentions an avatar" "strategy" rollback.sql
$P -c "DELETE FROM \"Strategy\""
$P -f rollback.sql
check "after rollback: 5 avatars" "$(count)" "5"
check "after rollback: only the original ids" "$($P -Atc "select string_agg(id, ',' order by id) from \"BuyerAvatar\"")" "s0,s1,s2,s3,s4"
expect_refused "re-rollback" "expected exactly 3 copied" rollback.sql
check "re-apply after rollback works" "$($P -f apply.sql >/dev/null 2>&1; count)" "8"
$P -f rollback.sql

# apply guards
$P -c "UPDATE \"BuyerAvatar\" SET name = 'THE MOTHER PASSING IT FORWARD' WHERE id = 's4'"
expect_refused "apply with a clashing name (any case)" "already has an avatar named" apply.sql
$P -c "UPDATE \"BuyerAvatar\" SET name = 'The Quiet-Luxury Collector' WHERE id = 's4'"
$P -c "SET session_replication_role = replica; INSERT INTO \"BuyerAvatar\" (id,\"businessId\",name,who,\"sortOrder\",\"updatedAt\") VALUES ('s5','$BIZ','Extra','w',5,CURRENT_TIMESTAMP)"
expect_refused "apply with 6 active avatars" "expected exactly 5 active" apply.sql
check "nothing changed after refused applies" "$(count)" "6"
$P -c "DELETE FROM \"BuyerAvatar\" WHERE id='s5'"
$P -c "UPDATE \"BuyerAvatar\" SET \"deletedAt\" = CURRENT_TIMESTAMP WHERE id = 's4'"
expect_refused "apply with 4 active (a deleted one)" "expected exactly 5 active" apply.sql
$P -c "UPDATE \"BuyerAvatar\" SET \"deletedAt\" = NULL WHERE id = 's4'"
$P -c "UPDATE \"BuyerAvatar\" SET \"sortOrder\" = 5 WHERE id = 's4'"
expect_refused "apply when sort order 5 is taken" "sort order 5 or above" apply.sql
dropdb "$DB"
[ $fail = 0 ] && echo "ALL CHECKS PASSED" || { echo "SOME CHECKS FAILED"; exit 1; }
