# Sales Guru — instructions for Claude

Read [`PRD.md`](./PRD.md) for product scope and the build order before making
changes — this project is built one component at a time (PRD.md §5), fully
working before moving to the next. Don't jump ahead or batch components.

Architecture/stack decisions for this project are confirmed with the user
before being implemented, not decided autonomously — if a task implies a new
dependency, service, or structural change not already settled in PRD.md §6,
propose it and wait for a go-ahead rather than proceeding.

## Opening ceremony

Run this at the start of a session working in this repo, before making
changes. Report findings briefly; only elaborate on what's actually broken
or out of sync.

```bash
# 1. Toolchain present?
uv --version && node --version && npm --version && gh --version

# 2. GitHub CLI authenticated? (needed to sync with GitHub per README.md)
gh auth status

# 3. Env files present?
test -f backend/.env && echo "backend/.env OK" || echo "MISSING: cp backend/.env.example backend/.env"
test -f frontend/.env && echo "frontend/.env OK" || echo "MISSING: cp frontend/.env.example frontend/.env"

# 4. Backend deps in sync with the lockfile?
(cd backend && uv sync --locked) && echo "backend deps OK"

# 5. Migration history in sync with dev.db? (catches a dev.db that has a
#    full schema but no _prisma_migrations tracking table — step 6 would
#    otherwise fail with a cryptic P3005 instead of explaining what's wrong)
(cd backend && uv run python -c "
import pathlib, sqlite3, sys
p = pathlib.Path('prisma/dev.db')
if not p.exists() or p.stat().st_size == 0:
    sys.exit(0)  # fresh clone; step 6's migrate deploy handles this normally
tables = {r[0] for r in sqlite3.connect(p).execute(
    \"select name from sqlite_master where type='table'\")}
if tables and '_prisma_migrations' not in tables:
    print('BROKEN: backend/prisma/dev.db has tables but no _prisma_migrations')
    print('history table. Step 6 will fail with P3005. Do NOT run migrate')
    print('reset or db push to fix this -- see \"Baselining an untracked')
    print('dev.db\" below.')
    sys.exit(1)
") && echo "migration history OK"

# 6. Backend Prisma client generated + migrations applied?
(cd backend && uv run prisma migrate deploy && uv run prisma generate) && echo "backend DB OK"

# 7. Frontend deps installed?
test -d frontend/node_modules && echo "frontend/node_modules present" || echo "MISSING: (cd frontend && npm install)"

# 8. Playwright browsers installed? (only needed for e2e)
test -d ~/Library/Caches/ms-playwright 2>/dev/null || test -d ~/.cache/ms-playwright 2>/dev/null \
  && echo "Playwright browsers present" || echo "MISSING: (cd frontend && npx playwright install --with-deps chromium)"

# 9. Pre-commit hooks installed in this repo? (both stages — plain
#    `pre-commit install` covers both via default_install_hook_types)
test -f .git/hooks/pre-commit -a -f .git/hooks/commit-msg && echo "pre-commit hooks installed" || echo "MISSING: pre-commit install"
```

If step 1 fails for any tool, stop and point the user at README.md's
Prerequisites section (has install commands for uv, Node/npm, gh) rather than
trying to install them yourself. If step 2 shows not-authenticated, tell the
user to run `gh auth login` — don't attempt it on their behalf, it's
interactive. Steps 3–4 and 7–9 are safe to fix directly (they're the
commands shown in each MISSING message) since they're local, reversible, and
don't touch GitHub or Render. Step 5 failing is different: stop and follow
"Baselining an untracked dev.db" below rather than running anything
destructive against it.

### Baselining an untracked dev.db

If step 5 reports `BROKEN` (schema present, no `_prisma_migrations` table —
this happens when the file was created via `db push`, a restore, or a seed
script instead of `migrate dev`), don't reset it. Confirm first, then
baseline:

```bash
# 1. Confirm dev.db's actual schema matches what the migrations would
#    produce (read-only; --exit-code makes 0 = no diff, 2 = real diff)
(cd backend && uv run prisma migrate diff \
  --from-url "file:$(pwd)/prisma/dev.db" \
  --to-migrations ./prisma/migrations \
  --shadow-database-url "file:/tmp/sales-guru-shadow-diff.db" \
  --exit-code)

# 2. If step 1 printed "No difference detected" (exit 0): mark every
#    migration as applied, in order, without running any SQL
for m in $(ls backend/prisma/migrations | grep -v migration_lock.toml | sort); do
  (cd backend && uv run prisma migrate resolve --applied "$m") || break
done

# 3. Confirm it's clean
(cd backend && uv run prisma migrate deploy)  # should say "No pending migrations to apply"
```

If step 1 instead reports real differences (exit code 2), stop — do not
baseline over a schema that doesn't match. Show the user the diff, run
`make backup-dev`, and do a proper reset instead (this is the destructive
path the rule above requires explicit confirmation for).

## Working conventions

- **TDD**: write the failing test first, then implement. Both packages gate
  on ≥90% coverage (`pytest` / `vitest --coverage` enforce this directly —
  see README.md).
- **Backend**: PEP-8 via ruff, Google-style docstrings (ruff's `D` rules,
  convention set to `google` in `backend/pyproject.toml`), strict mypy + ty.
  Run `uv run ruff check . && uv run ruff format . && uv run mypy . && uv run ty check && uv run pytest`
  before considering backend work done.
- **Frontend**: oxlint (includes `jsx-a11y` — accessibility is enforced at
  lint time, not just tested after the fact). Run
  `npm run lint && npx tsc -b && npm run test:coverage` before considering
  frontend work done; run `npm run test:e2e` too for anything touching a
  user-facing flow.
- **Schema changes**: always `uv run prisma migrate dev --name <desc>`, never
  `prisma db push` — see README.md's Database schema changes section for why.
- **Destructive commands** (`prisma db push --force-reset`, `prisma migrate
  reset`, `DROP`, `rm -rf`, `git push --force`, `git reset --hard`, deleting
  branches): before running any of these, print the exact target (database
  URL, path, branch) and ask for explicit confirmation. Never run one
  against a target you have not printed. Treat any `DATABASE_URL` that
  does not contain `test.db` as protected — confirmed the hard way
  2026-09-12, when a bare `prisma db push --force-reset` run against the
  ambient shell's real `DATABASE_URL` wiped the local dev database (whose
  actual file is `backend/prisma/dev.db`, not `backend/dev.db` — a stale,
  empty, easy-to-confuse leftover) instead of the intended test one, with
  no way back. `backend/scripts/db-reset.sh` is now the only supported way
  to force-reset a database in this repo — it always targets
  `backend/.env.test`'s database and refuses to run if that value doesn't
  contain `test.db`; use it (or `make backup-dev` first) rather than
  calling `prisma` directly.
- **Products are reusable across campaigns.** If the item being sold is the
  same, edit the product (`PATCH .../products/{id}`, `app/api/product.py`).
  If it's a different item, swap the campaign's product instead
  (`PATCH .../campaigns/{id}` with `productId`, `app/api/campaign.py`).
  Never repurpose a product record by rewriting its URL/description to
  describe a different item — that silently invalidates ad creatives
  generated against the old one for every campaign that shares it, not
  just the one you're looking at. Both an edit and a swap make any
  already-generated creative read as stale (`is_creative_stale`,
  `app/services/creative.py`) until it's regenerated.
- **Destination URLs**: all URL validation goes through
  `validate_destination_url` (`backend/app/services/url_validation.py`) —
  never add an ad-hoc regex. It's the single source of truth for format
  rules (scheme, no localhost/bare IPs, TLD required, normalization) and
  is called from every place a URL enters the system. The frontend's
  `frontend/src/lib/urlValidation.ts` mirrors it for inline feedback only;
  the backend's 422 is always authoritative.
- **Line endings**: LF, enforced by `.gitattributes` — no action needed.
- **Commit messages must not attribute authorship to Claude or Anthropic** —
  no `Co-Authored-By: Claude ...` trailer. Enforced by a `commit-msg` hook
  (`scripts/check-no-ai-coauthor.sh`), so don't add that trailer even as the
  default Claude Code commit template suggests — the commit will be
  rejected.
- Full detail on all of the above: [`README.md`](./README.md).
