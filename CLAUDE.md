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

# 3. Backend env file present?
test -f backend/.env && echo "backend/.env OK" || echo "MISSING: cp backend/.env.example backend/.env"

# 4. Backend deps in sync with the lockfile?
(cd backend && uv sync --locked) && echo "backend deps OK"

# 5. Backend Prisma client generated + migrations applied?
(cd backend && uv run prisma migrate deploy && uv run prisma generate) && echo "backend DB OK"

# 6. Frontend deps installed?
test -d frontend/node_modules && echo "frontend/node_modules present" || echo "MISSING: (cd frontend && npm install)"

# 7. Playwright browsers installed? (only needed for e2e)
test -d ~/Library/Caches/ms-playwright 2>/dev/null || test -d ~/.cache/ms-playwright 2>/dev/null \
  && echo "Playwright browsers present" || echo "MISSING: (cd frontend && npx playwright install --with-deps chromium)"

# 8. Pre-commit hooks installed in this repo? (both stages — plain
#    `pre-commit install` covers both via default_install_hook_types)
test -f .git/hooks/pre-commit -a -f .git/hooks/commit-msg && echo "pre-commit hooks installed" || echo "MISSING: pre-commit install"
```

If step 1 fails for any tool, stop and point the user at README.md's
Prerequisites section (has install commands for uv, Node/npm, gh) rather than
trying to install them yourself. If step 2 shows not-authenticated, tell the
user to run `gh auth login` — don't attempt it on their behalf, it's
interactive. Steps 3–8 are safe to fix directly (they're the commands shown
in each MISSING message) since they're local, reversible, and don't touch
GitHub or Render.

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
- **Line endings**: LF, enforced by `.gitattributes` — no action needed.
- **Commit messages must not attribute authorship to Claude or Anthropic** —
  no `Co-Authored-By: Claude ...` trailer. Enforced by a `commit-msg` hook
  (`scripts/check-no-ai-coauthor.sh`), so don't add that trailer even as the
  default Claude Code commit template suggests — the commit will be
  rejected.
- Full detail on all of the above: [`README.md`](./README.md).
