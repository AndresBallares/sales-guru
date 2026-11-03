-- Undo apply.sql: put the name "Serpenti" (and its previous updatedAt) back.
-- Run by the user, never by Claude:   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f rollback.sql
-- Guards: exactly one product of the business is named 'Emerald Coil', none is
-- named 'Serpenti', and exactly one row is updated. updatedAt returns to the value read
-- from production on 2026-11-03 (row cmvzqszw20004kpk1mk5slpnn).
BEGIN;
DO $$
DECLARE
  biz CONSTANT text := 'cmtlnp3t30005fb2hl90ac4tl';
  n int;
  pid text;
BEGIN
  SELECT count(*) INTO n FROM "Product" WHERE "businessId" = biz AND name = 'Serpenti';
  IF n <> 0 THEN RAISE EXCEPTION 'nothing to roll back: a product is already named Serpenti (%)', n; END IF;

  SELECT count(*) INTO n FROM "Product" WHERE "businessId" = biz AND name = 'Emerald Coil';
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one product named Emerald Coil, found %', n; END IF;

  SELECT id INTO pid FROM "Product" WHERE "businessId" = biz AND name = 'Emerald Coil';
  IF pid <> 'cmvzqszw20004kpk1mk5slpnn' THEN
    RAISE EXCEPTION 'unexpected product id % (expected cmvzqszw20004kpk1mk5slpnn)', pid;
  END IF;

  UPDATE "Product"
     SET name = 'Serpenti', "updatedAt" = TIMESTAMP '2026-11-02 21:00:01.586'
   WHERE id = pid AND "businessId" = biz AND name = 'Emerald Coil';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected to update 1 row, updated %', n; END IF;
END $$;
COMMIT;
