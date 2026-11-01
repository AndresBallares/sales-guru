# Backlog

Work that has been agreed to be worth doing but is deliberately not scheduled. Move an
item to the pull request that does it, and delete it here when that merges.

## Open

### Compare ads over a common window, not lifetime totals
The dashboard's leader (`choose_leader` in `backend/app/services/dashboard.py`, fed by
`ad_totals`) ranks each ad on its lifetime numbers, so an ad that has been live longer
has had more time to collect add-to-carts and is favored. Compare ads over a date window
in which all of them were live instead.

The creative rounds use the same leader as their "winner"
(`backend/app/services/round_results.py`), so change the input in one place and the
dashboard and the Strategist stay identical.

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
