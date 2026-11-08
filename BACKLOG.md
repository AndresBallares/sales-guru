# Backlog

Work that has been agreed to be worth doing but is deliberately not scheduled. Move an
item to the pull request that does it, and delete it here when that merges.

## Open

### Billing and plans for the Avatar Research Agent
Billing does not exist yet (PRD.md §3 and the post-MVP "Billing" step). When it is built, plans must hook
into the two per-business settings the research agent adds in 7b (`docs/phase-7.md`, "Plan change"): the
**model access** list (default `claude-opus-5-5` only; `claude-fable-5-1` is a premium extra) and the
**monthly run limit** (default 1). Until then both are admin-only and set by hand per business. The plan work
should also decide what a run costs a customer against the actual cost stored on each run, and what happens to
a run that reaches its dollar cap.

### Research runner follow-ups (found in 7b)
- **Newer web tool versions.** `web_search_20260318` / `web_fetch_20260318` accept `response_inclusion: "excluded"`, which
  drops the nested result blocks from the response and "reduces output token costs". 7b uses `_20260209`. Using the
  newer version also removes the fetched page text the runner compares quotes against, so quote verification would
  rely on its own fetch for everything. Decide with measured numbers from the paid run.
- **Pin the resolved address in the quote fetch.** `research_pages.fetch_page_text` checks that a host resolves to public
  addresses, then the HTTP client resolves it again (the same window `url_reachability` has). Connect to the checked
  address to close it.
- **Cache re-write at the brand-to-customer-voice boundary.** The tools array changes there (`max_uses`), so the prompt
  cache restarts. Measure the cost in the paid run; if it is large, hold the reserve another way (for example one
  phase with an in-prompt budget and a per-request check).
- **Competitor-term filtering (built in 7c, `Phase7c` branch; delete when it merges).** The terms kept out of hooks, angles and concepts (`research_filters`) are the competitor
  domains' names plus the model's `competitor_terms` list. The list is long (50 entries in the second paid run) and can
  hold single common English words ("Spur"), which would remove a legitimate hook. Ignore single common English words,
  and keep brand names and multi-word names (for example "Harwell Godfrey", "Bulgari Serpenti"). Also let the owner view
  and edit the list on the 7c review screen, so a wrong term can be removed and a missing one added.
- **Customer-voice classifier.** `research_evidence.classify_source` recognizes Reddit, a fixed list of review and Q&A
  hosts, and forum-looking hosts and paths. Review it against the sources a real run reaches.

### Research review follow-ups (found in 7c)
- **Keep review edits across a refresh.** Checkbox choices, avatar edits and the term list live in the browser only; the
  unsaved-edit warning is the only protection, and it cannot see the browser Back button. Store the draft per run (for
  example in `localStorage`) and offer to restore it.
- **Review the common-word list** (`backend/app/data/common_words.txt`) against the terms real runs produce; a brand name
  that is also a common word would be ignored.

### Object storage for product images (S3/R2)
Product photos and videos are stored as bytes in Postgres (`ProductImage.data`, "Option A", 2026-09-02). They survive
deploys (checked read-only 2026-11-04: VENZI has 43 media rows, about 23 MB, and every photo URL tested returned 200),
but each image request reads a whole database row and the database is small (1 GB disk). When media volume or customer
count grows, move the bytes to object storage (S3 or R2) and keep `/product-images/{id}` as the public URL (Meta fetches
it), either redirecting or proxying. It needs a new service and credentials, so confirm with the user before building,
and plan a backfill from the existing rows.

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

- `frontend/e2e/axe-ready.spec.ts:21` "analyzeWhenReady waits for the page to render before running axe". Failed once on the
  first attempt of a full `CI=true npm run test:e2e` run on the Products delete branch (2026-11-04) at line 23
  (`expect(locator).toBeVisible()`: element not found, the page had not rendered yet) and passed on Playwright's retry
  (104 passed, 1 flaky). The spec's own comment records an earlier failure under load (2026-10-31). Full output:
  `e2e-delete.log` in the session scratchpad. Fix: have the test wait for the element it checks with the same patience as
  the helper it tests, instead of a fixed first-load window.
- `frontend/e2e/split-card.spec.ts:6` "shows a two-column card on desktop with a gold Generate
  strategy button". Failed once on the first attempt of a full `CI=true npm run test:e2e` run
  (2026-11-02) at line 34: `top.y + top.height` was not `<= panel.y + 1`, a layout measurement taken
  before the card settled. It passed on Playwright's retry. Fix: wait for layout to settle
  (for example `expect.poll` the bounding boxes) before measuring.
- vitest: `src/components/CampaignsSection.test.tsx` > "CampaignsSection video ads and the creative test format" >
  "publishing a video ad" > "shows the processing step while the background publish runs, then finishes" failed once in
  CI (PR #149, 2026-11-04, `frontend-ci`) at the `findByText(/Processing video… 40%/)` line and passed on the rerun and in
  3 of 3 local runs. Cause: the test replaced the 2-second publish poll with a real 30 ms pause, so the in-between status was
  on screen for 30 ms and a loaded runner could miss it (with a 0 ms pause it fails 5 of 5). Fixed in the Products delete PR:
  the pause is a gate the test controls (`publishPolls.hold` / `release`), so the status stays up until the test has checked
  it; the file ran 20 times in a row with no failure. Full CI output: `ci149-frontend-fail.log` in the session scratchpad.
- vitest: `src/components/ResearchRunView.test.tsx` > "after the run" > "shows a reviewed run with the avatars it
  produced" failed once in the first full `npm run test:coverage` run (2026-11-04) and passed alone and on two reruns.
  Cause: it read the saved-avatars list right after the heading, but the names load a moment later. Fixed in 7c by
  waiting for the list (`findByRole`). Full output of the failing run: `frontend-vitest-run1-flake.log` in the session
  scratchpad.
- vitest: `src/components/ResearchRunView.test.tsx` > "progress" > "moves focus to the heading" failed once in the
  pre-commit run of the 7c commit (2026-11-04; the same file passed in the earlier full run) with `toHaveFocus()` receiving
  `<body>`. Cause: it read focus the moment the heading appeared, before the effect that focuses it ran. Fixed in 7c by
  waiting for focus (`waitFor`). Full output: `precommit-vitest-focus-flake.log` in the session scratchpad.
- vitest: one test failed on the first of three `npm run test:coverage` runs (2026-11-02) and the
  two reruns were clean. The failing test's name was not captured (the output was piped to `tail`),
  so it is unknown. Next time, save the whole output to a file, per "Keep the e2e logs" below.

### Sweep the other tests that can pass or fail on timing
Found while fixing the video-publish flake (a test-only PR after the Products delete PR). Same pattern: a state that is on
screen for a moment, or an effect that has not run when the assertion does. Fix each with a controlled gate (the
`publishPolls` approach in `CampaignsSection.test.tsx`) or `waitFor`, never a longer timeout, and run each changed file 20
times.
- **Real 30 ms poll pause:** `CampaignsSection.test.tsx` (the 70% progress test and any other test that reads an in-between
  publish status), `AdPreviewPage.test.tsx` (line 18 and the status chain near line 1126), `CreativeRoundsPanel.test.tsx`
  (the Processing/Uploading chain near line 197). Confirm `publishJob.test.ts` (instant sleep, asserts its own outputs).
- **Focus asserted right after an async render** (the two flakes already fixed had this shape): `ResearchStart.test.tsx:258`,
  `ResearchReview.test.tsx:247` and `:590`, `AvatarsSection.test.tsx:350` and `:402`, `DashboardPage.test.tsx:767`. The
  keyboard-driven focus checks (`BusinessTabs`, `CampaignCard`, `PhotoList`) run synchronously after user-event and are fine.
- **First-load timing in e2e:** `frontend/e2e/axe-ready.spec.ts:21` ("analyzeWhenReady waits for the page to render before
  running axe"; flaky once on the Products delete branch, listed under Known flaky tests).
- **Timers in source that tests may race:** `ResearchRunView` (3-second poll), `ResearchStart`, `CreativeRoundsPanel`,
  `PreviewDetailsPanel`, `PhotoList`, `lib/media.ts`.

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

### Phase 4 of creative learning: feed results back by hook shape
Once enough campaigns have run, aggregate results by `hookType` (with a minimum-data rule) and feed a short
"what has worked for this business" note into later rounds' Creative prompts, keeping one exploratory shape per
batch. (`Creative.hookType` is stored and returned since the `creative-hook` PR, and nothing reads it yet; see
`docs/creative-learning-review.md`.)

### Campaigns list heading overlaps on a phone
At 390px wide the "Campaigns" heading, its subtitle and the "Create campaign" button overlap in the Results and
campaigns tab (seen in the dark-mode phone screenshot of `e2e/performance-dashboard.spec.ts`, 2026-11-07). It predates
the Advertising Performance dashboard. Fix in a small PR: stack the heading row on narrow screens, and add a phone-width
e2e check (no overlap, button reachable) like `split-card.spec.ts` does for the strategy card.

### Flaky e2e: two "Import from document" buttons on the Avatars tab
`e2e/avatar-import.spec.ts` failed once in a full run (2026-11-08) with a strict-mode violation: for a moment the
Avatars tab shows both the header's "Import from document" button and the empty state's, and the test's locator
matches both. It passed on the retry. Fix the spec (scope the locator to the header, or wait for the list to
settle) rather than raising retries. The full log is kept at the run's `e2e-full-pixel2.log` in the scratchpad.

### Enforce the Pixel publish hold on the server
The hold for a Pixel that receives no website events (or that Meta marks unavailable) is only on
the page: the Approve & Publish buttons stay disabled until the owner ticks "Publish anyway"
(`pixel-guard`, 2026-11-08), but the API still publishes if called directly. Make the server refuse:
publish (and approve-and-publish) should look at `get_pixel_health` and answer 409 with the warning
unless the request carries an explicit confirmation (for example `confirmPixelWarning: true`), which the
page sends once the owner has ticked the box. Tests first: refused without it, accepted with it, never
refused for `no_purchase`, `unreadable` or `none_selected`, and a failed check never blocks. Update the
two publish screens to send the flag, and PRD.md and docs/phase-7.md.

## Done

- **Dashboard tests leaked a `scrollIntoView` stub.** Tests assigned a stub to
  `Element.prototype` that stayed for every later test, so one test passed in the full
  file and failed alone. Each test now gets its own stub (#128).
