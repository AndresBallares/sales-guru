-- Rename VENZI's production product "Serpenti" to "Emerald Serpent Ring".
-- Run by the user, never by Claude:   psql "$PROD_URL" -v ON_ERROR_STOP=1 -f apply.sql
--
-- Guards (the whole script aborts and changes nothing if any fails):
--   * the business exists;
--   * exactly one product of that business is named exactly 'Serpenti';
--   * no product of that business is already named 'Emerald Serpent Ring';
--   * the UPDATE touches exactly one row.
-- Only "name" (and "updatedAt", as the app would) changes. The name is not part of
-- any Strategist or Creative prompt, so no creative becomes stale.
BEGIN;
DO $$
DECLARE
  biz CONSTANT text := 'cmtlnp3t30005fb2hl90ac4tl';
  n int;
  pid text;
BEGIN
  PERFORM 1 FROM "Business" WHERE id = biz;
  IF NOT FOUND THEN RAISE EXCEPTION 'business % not found', biz; END IF;

  SELECT count(*) INTO n FROM "Product" WHERE "businessId" = biz AND name = 'Emerald Serpent Ring';
  IF n <> 0 THEN RAISE EXCEPTION 'already applied: % product(s) already named Emerald Serpent Ring', n; END IF;

  SELECT count(*) INTO n FROM "Product" WHERE "businessId" = biz AND name = 'Serpenti';
  IF n <> 1 THEN RAISE EXCEPTION 'expected exactly one product named Serpenti, found %', n; END IF;

  SELECT id INTO pid FROM "Product" WHERE "businessId" = biz AND name = 'Serpenti';
  RAISE NOTICE 'renaming product % (Serpenti -> Emerald Serpent Ring)', pid;

  UPDATE "Product"
     SET name = 'Emerald Serpent Ring', "updatedAt" = CURRENT_TIMESTAMP
   WHERE id = pid AND "businessId" = biz AND name = 'Serpenti';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'expected to update 1 row, updated %', n; END IF;
END $$;
COMMIT;
