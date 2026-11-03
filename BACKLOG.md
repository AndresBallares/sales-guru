# Backlog

Work that has been agreed to be worth doing but is deliberately not scheduled. Move an
item to the pull request that does it, and delete it here when that merges.

## Open

### E2E seeding hook for per-ad metric history
The common-window comparison (`docs/common-window.md`) shows a period label, a "Not compared"
row and a window note on the dashboard, but the production build the e2e suite runs has no way
to create per-ad `Metric` history, so only vitest and the API tests cover them. Add a
test-only way to seed ad-level rows (for example an endpoint that exists only under
FAKE_META, like the sample data) and a Playwright spec with an axe check on a table that has
a window label, a leader and a not-compared ad.

### Per-day ad metrics from Meta (`time_increment=1`)
The common-window comparison (`docs/common-window.md`) works from differences of the
15-minute cumulative snapshots. Meta can return a real daily breakdown per ad, which would
avoid the difference arithmetic and show conversions on the day they were attributed. It
needs a schema change (both Prisma schemas, both migrations, a throwaway-Postgres check)
and a backfill, so it was left out on purpose.

### Known flaky tests

Record the exact test name here whenever a vitest or e2e test fails and then passes on a rerun.

- `frontend/e2e/split-card.spec.ts:6` "shows a two-column card on desktop with a gold Generate
  strategy button". Failed once on the first attempt of a full `CI=true npm run test:e2e` run
  (2026-11-02) at line 34: `top.y + top.height` was not `<= panel.y + 1`, a layout measurement taken
  before the card settled. It passed on Playwright's retry. Fix: wait for layout to settle
  (for example `expect.poll` the bounding boxes) before measuring.
- vitest: one test failed on the first of three `npm run test:coverage` runs (2026-11-02) and the
  two reruns were clean. The failing test's name was not captured (the output was piped to `tail`),
  so it is unknown. Next time, save the whole output to a file, per "Keep the e2e logs" below.

### Dashboard test: focus assertion is timing-sensitive
`DashboardPage.test.tsx` › "selects the new business in the Brand picker when others
already exist" failed once in CI on `expect(...).toHaveFocus()`: focus was on `<body>`
instead of the brand description field, because focus moves in an effect after an
asynchronous load. It passed on re-run. Wait for the field to be focused (`waitFor`)
rather than asserting immediately, or find why focus lands late.

### Commit hooks take about 16 minutes: use a faster pre-commit set
The pre-commit pytest hook runs every test file related to the staged files. A change to
the Creative Agent staged about 25 files and about 980 tests, which took about 16 minutes
at normal priority (and over an hour when the commit ran as a background job at low
priority, which looked like a hang but was not one). Proposal: keep ruff, format, mypy and
ty in pre-commit; run only the test files the commit itself added or changed, plus a
fixed 1 to 2 minute smoke subset; and move the full related set to `pre-push` (or leave it
to CI, which runs everything). Measure before and after, and keep the full-suite run that
CLAUDE.md asks for before opening a PR.

### Keep the e2e logs of every failed run
One full e2e run failed on many specs and could not be reproduced in five more runs. The
log had been piped through `grep | head`, so it was gone and the cause is unknown.
Whenever an e2e run is repeated or scripted, write the whole output to a file and keep
it (and `test-results/` for the failing specs) until the failure is explained.

## Done

- **Dashboard tests leaked a `scrollIntoView` stub.** Tests assigned a stub to
  `Element.prototype` that stayed for every later test, so one test passed in the full
  file and failed alone. Each test now gets its own stub (#128).
