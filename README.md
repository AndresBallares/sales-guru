# Sales Guru

AI-powered advertising platform: a business describes what it sells, AI generates
strategy + ad creative, and campaigns publish to Meta Ads with results reported
back on a dashboard.

Product scope and build order live in [`PRD.md`](./PRD.md) — read that first for
*what* this does. This file covers *how to run it*.

## Repo layout

```
sales-guru/
├── frontend/    React 19 + TypeScript + Vite (SPA)
├── backend/     Python (uv) + FastAPI, Prisma schema + prisma-client-py
├── docs/        Supplementary docs
├── .github/workflows/  CI (ci.yml)
├── render.yaml  Render deploy config (CI-gated, path-split — see file for details)
├── .pre-commit-config.yaml
└── PRD.md
```

## Prerequisites

You need three tools installed before anything else works: **uv** (Python),
**Node.js/npm** (frontend), and **gh** (GitHub CLI, used to sync with GitHub).

### uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Verify: `uv --version` (this repo was built against `uv 0.11.x`). Full docs:
https://docs.astral.sh/uv/getting-started/installation/

uv also manages the Python interpreter itself — you do not need to separately
install Python. The backend pins Python 3.12 (see `backend/.python-version`);
`uv sync` downloads it automatically if it's not already present.

### Node.js + npm

Install Node 22 or later (this repo's CI runs Node 22). Easiest via
[nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 22
nvm use 22
```

npm ships with Node, so no separate install step. Verify: `node --version && npm --version`.

### gh (GitHub CLI)

```bash
brew install gh       # macOS
```

See https://github.com/cli/cli#installation for other platforms. After installing:

```bash
gh auth login
```

## First-time setup

```bash
# Backend
cd backend
cp .env.example .env
uv sync --locked
uv run prisma generate
uv run prisma migrate deploy   # applies committed migrations to local SQLite

# Frontend
cd ../frontend
npm install
npx playwright install --with-deps chromium   # only needed for e2e tests

# Pre-commit hooks (run from repo root)
cd ..
uv tool install pre-commit      # if you don't already have pre-commit
pre-commit install
```

## Running the app

```bash
# Backend — http://localhost:8000
cd backend && uv run uvicorn app.main:app --reload

# Frontend — http://localhost:5173
cd frontend && npm run dev
```

## Testing, linting, coverage

Both packages enforce **≥90% test coverage**; the coverage gate is part of
the normal test command, not a separate step.

```bash
# Backend (from backend/)
uv run ruff check .          # lint (PEP-8, Google-style docstrings via pydocstyle)
uv run ruff format .         # format
uv run mypy .                # type check
uv run ty check              # type check (Astral's ty — fast, still pre-1.0)
uv run pytest                # tests + coverage gate (fails under 90%)

# Frontend (from frontend/)
npm run lint                 # oxlint, incl. jsx-a11y accessibility rules
npm run test:coverage        # vitest + coverage gate (fails under 90%)
npm run test:e2e             # Playwright e2e, incl. axe-core a11y scan
npm run build                # production build (also type-checks via tsc -b)
```

Working TDD-style: write the failing test first (`pytest` / `vitest --watch`),
then implement until it passes. This is the expected workflow for this repo,
not just a suggestion — coverage thresholds enforce it indirectly.

## Database schema changes

Schema lives at `backend/prisma/schema.prisma`. To change it:

```bash
cd backend
# edit schema.prisma, then:
uv run prisma migrate dev --name <short_description>
```

This generates a migration file under `backend/prisma/migrations/` (commit
it) and regenerates the client. Never use `prisma db push` outside of quick
local experimentation — it doesn't produce a migration file, so `migrate
deploy` (what CI and Render run) won't see the change.

## CI / CD

- **CI** (`.github/workflows/ci.yml`): path-scoped — backend changes run the
  backend job, frontend changes run the frontend job, docs-only changes run
  neither. A final `ci-status` job aggregates the result and is the check
  that should be set as required in GitHub branch protection.
- **Deploy** (`render.yaml`): Render's `autoDeployTrigger: checksPass`
  natively waits for the GitHub Actions check on a commit to pass before
  building — no deploy is attempted if CI hasn't run or hasn't passed. Each
  service's `buildFilter` scopes it to its own directory, so frontend/backend
  deploy independently and docs-only commits deploy nothing. See the
  comments in `render.yaml` for the one-time manual setup (Render dashboard).

## Line endings

Enforced as LF via `.gitattributes` — this is automatic on `git add`/`git
commit`, no action needed on your part beyond a normal git workflow.
