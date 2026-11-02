# VENZI production rollout (Render)

Data-only rollout: copy the VENZI brand configuration finished in dev into production.
All migrations are already deployed. **Applied to production on 2026-11-02 and verified.**

Last updated: 2026-11-02.

## Status

| Step | State |
| --- | --- |
| Dev data (`backend/prisma/dev.db`) | Done |
| This document | Done (corrected 2026-11-01: serpent rows, "ads", excluded product) |
| Read-only production snapshot | Done (SELECT only, via Render's query tool) |
| Row-level backup + restore check (scratch Postgres) | Done: 10/10 rows match production md5 |
| Dry run (every before/after value) | Done: `out/dry_run.txt` |
| Rehearsal on scratch: apply, re-apply refused, rollback | Done: all checks OK |
| Creatives checked against banned phrases | Done: 0 hits (report only) |
| Apply to production (run by the user, never by Claude) | **Done 2026-11-02 17:20 UTC**: output `BEGIN`, `DO`, `COMMIT` |
| Verify after apply (read-only SELECTs) | **Done, all checks pass** (see below) |

## Verification (2026-11-02, read-only SELECTs)

- BrandRules: 1 row, 31 phrases (includes "blue box" and "enamel").
- BuyerAvatar: 5 rows, all active, sortOrder 0-4; "The Deadline Gift-Giver" has `purchaseFor` = gift,
  the other four are self.
- BrandProfile: 10 proof points; the "Meticulously crafted with unparalleled craftsmanship" entry is
  gone from brandPhrases; offer is still NULL.
- Product benefits: 0 rows still contain "exceptional craftsmanship"; the 9 target rows hold the new
  text, including the final AFTER text of `cmtuv8ntr...`, `cmuxk3zvn...` and `cmuxnv4gi...`.
- Mechanism: the two serpent rows (`cmvu30mpo...`, `cmvufkmwj...`) hold the new text.
  `cmvoaodcd0022y2n12ehbth6y` is unchanged (same mechanism, `updatedAt` still 2026-10-25), and so
  is `cmvnfjqr2001cy2n1ad4wkpuy`. Exactly 3 products have a mechanism.
- Scope: 9 of 24 products have `updatedAt` on 2026-11-02, and 0 of the 8 creatives were touched.

## IDs

| Thing | Dev | Production |
| --- | --- | --- |
| Business | `cmuwq4p1g0005wqovs9t0yfby` | `cmtlnp3t30005fb2hl90ac4tl` (VENZI JEWELRY) |
| Brand profile | (in dev.db) | `cmtxdfune0001axnbveitikcj` |
| Render workspace / Postgres | | The Sales-Guru workspace and its only Postgres instance |

## State

**Dev (done):** 31 banned phrases (the original 30 plus "blue box"); 5 buyer avatars
("Deadline Gift-Giver" has `purchaseFor` = gift, its "blue box" hook removed); 10 proof points;
offer null; brandPhrases entry "Meticulously crafted with unparalleled craftsmanship" removed;
product text edits applied.

**Production (before):** no BrandRules, no avatars, proofPoints null, offer null, the brandPhrases
entry still present. 24 products, 2 campaigns ("Landing Page", "Pack1-testing"), 8 Creative rows.

## Decisions

1. Insert the 31 banned phrases (one BrandRules row).
2. Insert the 5 avatars from dev (new ids; all other columns copied verbatim).
3. Set the 10 proof points from dev.
4. Remove only the one brandPhrases entry. Production's list is longer than dev's, so dev's list
   is not copied over it.
5. Leave the offer empty.
6. Benefits swap "exceptional craftsmanship" -> "pieces made in New York" on the **9 production
   products whose `benefits` contain it** (the other 15 products do not). Each UPDATE matches the
   whole current `benefits` value, so a row that changed since the snapshot aborts the run.
   Grammar fix: `cmtuv8ntr0003hh6bpbargjqf` is a verb list ("...offers exceptional craftsmanship
   feels exclusive and distintive."), so a plain swap reads badly. It becomes "...combines luxury
   with modern design, is made in New York, and feels exclusive and distinctive." (typo fixed).
   Two more one-row text fixes: `cmuxk3zvn00038feu6mkhwvom` now starts "VENZI helps clients express
   their individuality..." and `cmuxnv4gi0003bm0dnnanlzaz` gets its final period. The other rows
   need only the swap.
7. Mechanism "Where painted color chips and fades, our ceramic inlay holds its color." on the two
   **serpent rows**, identified by url `https://venzijewelry.com/products/serpent-emerald-diamonds-ceramic`
   and price 13500: `cmvu30mpo000p7s862nurfyly` and `cmvufkmwj001f7s86vplvj3w3`. Guard:
   `mechanism IS NULL`, that url and that price.
8. **Excluded:** `cmvoaodcd0022y2n12ehbth6y` (deep-sea-solitaire, $10,500) keeps its existing
   mechanism. Its id appears in none of the generated SQL files. Also not touched:
   `cmvnfjqr2001cy2n1ad4wkpuy` (serpent-ring-1, $6,000), which has a different url and price.
9. "Ads" means the 8 **Creative** rows (production has no `Ad` rows): 4 on Landing Page (SELECTED)
   and 4 on Pack1-testing (3 REJECTED, 1 SELECTED). They are checked against the 31 phrases and the
   built-in list (`BANNED_PHRASES` in `app/services/ad_quality.py`), using the app's own matchers.
   Result: **0 hits** in headline, bodyText and description (none have cards). Not changed.
10. No ring description cleanup is needed in production.

Side effect checked: `is_creative_stale` compares only a product's description, url and
personalization, so changing `benefits` and `mechanism` does not make any creative stale.

## Method

- Reads go through Render's read-only query tool (SELECT only). Claude never gets the production
  connection string.
- Backup = the 10 rows that change (1 BrandProfile + 9 Product) as full row JSON plus the md5 of
  each row as production computes it (`out/backup.json`). The restore check loads them into a local
  scratch Postgres built from the 40 Postgres migrations and compares md5 per row.
- `apply.sql`: one transaction (`BEGIN`/`COMMIT`, `ON_ERROR_STOP`), every UPDATE row-counted and
  matched on the exact current value; it raises and rolls back on any difference. It ends with
  assertions (5 avatars, old phrase gone).
- `rollback.sql`: deletes the inserted rows and restores the changed columns, guarded the same way.

## Files (`backend/scripts/venzi_rollout/`, untracked)

| File | Purpose |
| --- | --- |
| `build_rollout.py` | Builds everything in `out/` from the snapshot and dev.db. No network. |
| `rehearse.sh` | Rebuilds scratch DB `venzi_rollout_scratch`, restores, applies, re-applies, rolls back. |
| `check_creatives.py` | Banned-phrase check of the 8 creatives. Reports only. |
| `snapshot/` | `prod_rows_raw.json` (also holds the Business row with its logo; do not commit), `creatives.json` |
| `out/dry_run.txt` | Every before/after value. |
| `out/apply.sql`, `out/rollback.sql`, `out/restore.sql`, `out/backup.json` | The artifacts. |

## Remaining steps

None for the rollout. `out/rollback.sql` is still available if a problem shows up later; it only
restores rows that still hold the new text. The backup in `out/backup.json` and the scratch
database `venzi_rollout_scratch` can be deleted once you no longer need them.

## Rules for whoever resumes this

- Do not apply anything to production. Do not commit, push or open PRs without asking.
- Do not ask for or print the production connection string.
