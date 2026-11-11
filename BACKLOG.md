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

### Shopify integration: product import and order reconciliation (planned feature)
**Status:** planned, nothing built. **Sequence: after billing and plans** (see "Billing and plans for the Avatar
Research Agent" and PRD.md §3), because the plan decides who gets this and how it is priced. Written 2026-11-08 with
enough detail to plan from this entry alone.

**Why.** Sales Guru only sees what Meta reports, and products are typed in by hand (VENZI's names and descriptions had
to be fixed twice). Most small online stores run on Shopify, so a direct connection saves setup time and catches
tracking problems (Meta counting about double, or far fewer, than the store's real orders).

**Context already true today (so the plan does not re-derive it).**
- VENZI's Pixel `2024258651467538` receives Shopify partner-integration events with event IDs (deduplication is set
  up); a test order on Nov 6-7 confirmed Purchase reaches Meta. This feature is the standing check that it keeps working.
- `Product` (schema.prisma): `name?`, `description` (required), `price?`, `margin?`, `features?`, `benefits?`,
  `mechanism?`, `personalizable`, `personalizationOptions?`, `url?`; `ProductImage` stores the file bytes in the
  database (`data Bytes`, `position`, media metadata and thumbnail) through the existing media intake. A Shopify image
  import must go through the same intake and limits; it interacts with the open "Object storage for product images
  (S3/R2)" item.
- A creative is stale when the product's description or URL (or the business description) changed since it was written
  (`is_creative_stale`, `app/services/creative.py`, from the `source*` snapshot stamped at generation). Editing a
  product already asks first when it would make ads out of date (Products tab, `PATCH .../products/{id}`); a product
  swap on a campaign is a different path (`PATCH .../campaigns/{id}` with `productId`). Never repurpose a product record
  to describe a different item (CLAUDE.md).
- Meta tokens are stored encrypted (`app/core/crypto.py`, read only through `get_meta_connection`); the connection
  model, expiry warning (14 days), recorded failed syncs (`sync_health`) and the Pixel health check
  (`pixel_health`, on demand and rate limited) are the patterns to copy.
- The performance dashboard's days are UTC days derived from lifetime snapshots; Meta counts days in the **ad
  account's** time zone. The open "Per-day ad metrics from Meta (`time_increment=1`)" item matters for Part 2.

**Part 1: product import and sync.**
- Connect a business's Shopify store with a read-only app (`read_products`; to confirm the exact scopes, and whether
  a public app (install flow, Shopify app review, mandatory privacy webhooks) or a custom app (one store, created by
  the owner in their admin) is needed; a custom app is quicker for the first stores, a public app is needed to scale).
  One store per business; store the shop domain (`*.myshopify.com`) and the token encrypted like the Meta token.
- Import: title -> `name`, description (Shopify sends HTML; convert to plain text, keep it non-empty because
  `Product.description` is required) -> `description`, the product page -> `url` (through `validate_destination_url`,
  never an ad-hoc regex; a store may use a custom domain), price (choose a rule for variants, for example the lowest
  or default variant, and say which), photos -> `ProductImage` (respect the photo limits and ordering; do not remove
  photos the owner added).
- The owner chooses which products to import (a list with search and paging; a store can have thousands; cap one
  import at a sensible number). Match existing products by normalized URL or handle (host, trailing slash, query
  string) so nothing is duplicated; show "already in Sales Guru (matched)" versus "new". Store the Shopify product id,
  handle and last-seen `updatedAt` on the product (a schema change: both Prisma schemas, both migrations, a
  throwaway Postgres check).
- Sales Guru owns `benefits`, `mechanism`, `features`, `margin`, `personalizable` and `personalizationOptions`: never
  overwrite them from Shopify. (Later option: prefill `margin` from Shopify's item cost, which needs another scope.)
- Sync later (product webhooks and/or a periodic refresh). A Shopify change to name, description, URL or photos must
  never silently apply to a product a live or publishable campaign uses, and so must never silently mark its creatives
  stale: record it as a pending change, show the owner what changed (old and new), and let them accept or dismiss it
  per field. Accepting goes through the normal product edit, so the existing "ads will be out of date, continue?"
  question and the stale-creative handling still happen. Track the value last imported so an owner edit and a Shopify
  edit can be told apart (a three-way comparison). A product deleted or archived in Shopify is flagged, not removed.

**Part 2: order reconciliation.**
- Read orders (`read_orders`; Shopify limits the default history to about the last 60 days unless the app is granted
  all-orders access, and order data may count as "protected customer data" for a public app: to confirm). Keep
  **daily counts and revenue only**: aggregate while reading and store aggregates, never customer personal data. Count
  paid orders only; exclude test, cancelled and draft orders, and decide how refunds count (say it on the page).
  Store, per business and day: orders, gross revenue, currency, the day's time zone, when it was read. Compare revenue
  only when the currencies match.
- What to compare, and why. Meta's attributed purchases are only the orders it credits to ads, so they should be below
  the store's total; comparing them with total orders would warn about a normal gap. For the tracking question
  ("does the Purchase event reach Meta, and is it counted once?") compare Shopify's orders with the **Pixel's Purchase
  event count** for the same days (all Purchase events, not ad-attributed; `fetch_pixel_event_counts` gives hourly
  buckets), and show Meta's ad-attributed purchases beside them as a third line.
- Same days on both sides: bucket Shopify orders in the **ad account's** time zone (the store's can differ; Shopify's
  shop time zone and Meta's ad-account time zone are both readable), or compare whole rolling windows (7, 14, 30 days)
  to cut boundary noise. Do not compare against the dashboard's UTC-day series until per-day Meta data exists.
- Warn when they diverge significantly and there is enough data (a minimum number of orders in the window, the same
  idea as the "too early to judge" flags): the Pixel counting about double the real orders (deduplication broken), or
  far fewer (the Purchase event is not reaching Meta). Starting thresholds to calibrate with real stores: ratio above
  about 1.5 or below about 0.5 over at least 10 orders. Plain-English wording and an "i" tooltip per metric, like the
  rest of the dashboard.
- Show it on the performance dashboard: an "Orders check" section with the three lines, the verdict, and when each
  side was last read (a stale or failed Shopify read is recorded and shown with its reason, as for Meta).

**Cross-cutting.**
- Tokens: encrypted at rest, read through one decrypting helper; scrub tokens from logs and stored reasons.
- Disconnect and deletion: disconnect removes the token and the stored link ids (imported products stay, now plain);
  deleting a business deletes the connection and the order aggregates; handle the app-uninstalled webhook; if a public
  app, the mandatory data-request and erasure webhooks. Update the privacy policy, terms and data-deletion pages.
- Jobs: a daily order read plus an on-demand, rate-limited refresh (as the Pixel check does); respect Shopify's rate
  limits; failures recorded with their reason. Whether Shopify's offline tokens expire (and need a refresh) is to
  confirm.
- Billing and plans: decide whether import and reconciliation are plan features (for example per store or per plan);
  also any Shopify app listing requirements and fees.

**Suggested slices (one PR each, tests first, docs shipped with each).** (1) Connection: OAuth or custom-app token,
encrypted storage, disconnect, deletion, scopes. (2) Product import: list, match, select, images. (3) Sync and the
change-review screen. (4) Order aggregates, the reconciliation rules and the dashboard section.

**Open questions for planning.** Public or custom app first; exact scopes and the app-review path; order history
depth; variant and price rule; how refunds and multi-currency are shown; thresholds; who sees what on each plan; whether
one business can ever have two stores.

### Creative test modes: a copy test (one shared image) and a visual test (one copy, different images)
**Status:** planned, nothing built (proposed 2026-11-08; the owner decides before any code). Replaces the unchosen options
A to D in the PRD entry "Why each ad in the first test needs its own image" if accepted.

**Current behavior (read from the code, 2026-11-08).** In a creative test all four ads **share one photo** by default.
`create_creatives` (`app/api/creative.py`) picks the product's feed, story and square assets once with `_pick_assets`
(first 4:5 photo for Feed, first 9:16 for Story, first exact 1:1 for Square, by `position`) and, when the product has both a
Feed and a Story photo, gives that same pair to every variant. Otherwise nothing is attached at generation, and
`select_creative` attaches the product's first photo (position 0) to each ad as it is selected. A different photo for
one ad only happens when the owner changes it by hand (`product_image_id` on select; "Change image" in Edit creative or the
library picker on the ad preview page). Nothing assigns distinct photos, nothing checks that they differ (`publish.py`
notes it does not check whether a photo is in use), and the Creative Agent's vision input is the primary photo only. The rule
"four ads, or three without a fourth photo" (`required_test_ads`, `app/schemas/strategy.py`) assumes distinct photos, but
only the ad count follows from it; carousels are exempt. So today's test is really four captions under one image
(confounded: avatar, concept, pillar and hook shape vary while the image is held constant by accident).

**Proposal: make the variable explicit, one per test (`test_variable`: `COPY` or `VISUAL`).**
1. **Copy test: "same image, different copy".** The owner picks one test image (default: the feed photo that is
   preselected today; Feed, Story and Square versions travel together as now). All four ads use it. What varies is the copy:
   avatar, concept, pillar, hook shape (already varied). Always four ads, whatever the photo count (like a carousel); the
   per-ad "Change image" is hidden or locked with a plain explanation. Result wording: "the winning copy angle was X".
   This is today's behavior made honest and labelled, so it is the cheap one: mostly labels, one stored field, a test-image
   picker and the ad-count rule.
2. **Visual test: "same message, different image".** One copy set (headline, text, description, CTA, hook shape) is held
   constant and the four ads differ only in the image (or video): four distinct photos of the same product (three when that
   is all the product has, the existing `required_test_ads` rule, which then belongs to this mode only). Needs at least
   three distinct photos or videos, so the choice is disabled with an "add photos" hint below that. The owner chooses which
   copy angle to hold constant, and which photos (default by position, with a suggested shot per slot: close-up, on a
   hand, the gift moment). The server rejects duplicate images at select or approve in this mode. Feed-shaped photos
   only at first; Story and Square versions per ad can follow. The Creative Agent writes one copy set (one call, not four),
   so it is cheaper than today; it does not need to see each image because the copy does not change with it.
3. **Not now:** the confounded "angle = image" test (each angle gets its own visual), the owner's reasoning in the PRD. Do not
   build it until 1 and 2 exist; then it is a third mode ("angle test") the owner can choose on purpose.

**Order and stacking.** Offer the mode when the test starts. Suggested guidance, not a rule: with four good photos start
with the visual test (the image does most of the work on Meta), otherwise the copy test, and for a product with one photo
only the copy test, saying plainly that the lesson will be to get more visuals before test two. A second round
("Add new round", creative rounds) stacks the winner: winning image with new copy angles, or winning copy with new images.

**What changes, by area (for planning).**
- **Plan:** `CreativeTestPlanContent.test_variable` (plans are stored as JSON in `Strategy.content`, so likely no Prisma
  column and no migration; older plans read as `COPY`); the Strategist prompt and validators; `required_test_ads(mode,
  media_count)`.
- **Generation:** copy test, the chosen image to all four; visual test, one copy set fanned out to three or four `Creative`
  rows, each with its own `productImageId` (rows and the publish path already support a photo per ad).
- **Guards:** visual test, distinct images enforced on the server; copy test, a warning (the existing option D) if an ad's
  image is changed ("this is no longer a copy test"); both, a clear message when the product cannot support the mode.
- **UI:** a two-card mode choice with plain English (what stays the same, what you will learn, what you need); a test-image
  picker for the copy test; a photo-to-slot step for the visual test; the results table says what was tested.
- **Results and learning:** the leader message names the variable. The Phase 4 hook-shape learning should read only copy
  tests (image constant), which removes the confounding noted in `docs/creative-learning-review.md`; visual tests later feed a
  "which image style wins" view.
- **Rounds:** copy round = new copy with the same image; visual round = the next photos.
- **Cost:** copy test unchanged (four cached agent calls); visual test one call. Budget and bidding unchanged (four ads in one
  ad set, lowest cost, no cap on the first test).

**Tests to write first (when built).** Required ads per mode and photo count; the visual test refused below three distinct
photos; duplicates rejected on select and approve; the copy test locks to one image; older plans behave as `COPY`; the
mode choice and disabled states; the leader message; a round per mode; e2e at 390px and in dark mode.

**Open questions for the owner.** The default mode; whether the visual test may use the winning copy from an earlier test;
videos in a visual test; Story and Square versions per ad; whether to allow the "angle test" later; naming ("Visual – <photo
label>" next to "<Avatar> – <Concept>").

### Security: restrict the production database's IP allowlist (currently open to everyone)
**Found 2026-11-08** (read through Render's API, nothing changed). The production Postgres "Sales-Guru"
(`dpg-dabnq367bikc73dn9t00-a`, Ohio) accepts outside connections from **any address**: its inbound rule is
`0.0.0.0/0` ("everywhere"). Anyone on the internet can try to connect; they still need the user, password and host
(and the connection is TLS), so this is exposure, not a breach, but one leaked database URL becomes a working
way in from anywhere. The web service `sales-guru-backend` (Oregon) shows `0.0.0.0/0` on its own list too:
that one is for its public traffic and **must stay open**.

**Why the database is reachable from outside at all.** The backend runs in **Oregon** and the database in
**Ohio**. Render's private (internal) database address only works inside one region, so the backend very likely connects
through the **external** address, which is the one the allowlist guards. (To confirm without reading secrets: in the Render
dashboard the backend's `DATABASE_URL` host is either `dpg-...-a` with no domain, an internal address, or
`dpg-...-a.ohio-postgres.render.com`, an external one.) That is why "just close it" would take the app down.

**Plan, staged so nothing is cut off before it is proven.**
1. Collect what needs access: (a) the backend service's **outbound IP addresses** (dashboard, `sales-guru-backend`,
   Connect, Outbound; Render lists a small set of ranges per region, to confirm the exact labels); (b) your own public IP
   for running scripts (`curl -s https://ifconfig.me`), as `x.x.x.x/32`.
2. Dashboard, Databases, Sales-Guru, Access Control (inbound IP rules): **add** the outbound ranges and your `/32` with
   descriptions, keeping `0.0.0.0/0` for now. Save.
3. Prove them: the app answers (`GET /health`, a login, the Results tab), `research_access.py --show` works from your
   machine, and a deploy to production succeeds (the build command runs `prisma migrate deploy`; to confirm whether the
   build machines use the same outbound IPs as the running service, because if not the deploy's migrate step will be refused
   and those addresses must be added too).
4. At a quiet moment, **remove `0.0.0.0/0`**. Watch the backend logs and `GET /health` for ten minutes.
5. Rollback is one step: re-add `0.0.0.0/0` (and say so here).

**What could break.** The backend losing the database (everything down: login, results, the 15-minute jobs) if an outbound
range is missing or Render changes them; production deploys failing at the migrate step (above); your scripts from a new
address (home IP changes, travel, a different network: add the new `/32` first, or use a VPN with a fixed address); any
tool that connects from elsewhere (Render's own MCP query tool and dashboard SQL viewer connect from Render's side and should
be unaffected, to confirm by trying them after step 3). CI does not use the production database. **Do not edit the web service's
list.**

**Longer term (better than an allowlist).** Move the database to Oregon, next to the backend, switch the backend to the
internal address and leave the external allowlist empty, so the database has no public door at all. It means a new database
and a migration (a dump and restore with a short maintenance window), so it is its own project. Also consider rotating the
database password once the allowlist is tightened, since the URL has been handled in terminals.

### Recognize Anthropic billing and auth errors: tell the user plainly, alert the admin with the cause
**Found 2026-11-08.** VENZI's first premium research run (Claude Fable 5.1, standard depth) failed after 3.5 minutes and
$1.62 with Anthropic's own error "Your credit balance is too low to access the Anthropic API" (an
`invalid_request_error` carried by `anthropic.APIStatusError`). The business user saw only "Something went wrong while
researching. Please try again." (`_GENERIC_FAILURE`, `research_runner.py`), and the cause could only be found by reading
Render's logs. Whether the account really was out of credit or the production key belongs to another organization was not
visible from the app at all.

**Widened 2026-11-10: dropped connections too.** The second paid run (deep, Fable 5.1, $4.28) did not hit a billing error: its connection
to Anthropic was cut in the middle of a streamed answer (`httpx.RemoteProtocolError`, "incomplete chunked read") and the user saw the
same generic message. The research runner now retries those (branch `fix-avatar-research`), but the classifier below should treat
"network" as a first-class kind for **every** Anthropic call site, not only research. The other four callers use non-streaming `messages.create`, where the SDK wraps transport errors as `APIConnectionError` (an
`AnthropicError`, already caught), so only streaming code can leak a raw `httpx.TransportError`, as research did. The admin alert should also count dropped connections (a few are normal; a
burst means a network or provider problem) and say so in plain words.

**What happens today.** Five callers each catch `anthropic.AnthropicError` themselves and re-raise their own error with the
provider's raw text in it (`AvatarImportError`, `CreativeAgentError`, `OptimizerError`, `StrategistError` as
"Anthropic API call failed: <text>"); the research runner retries only rate limits, connection errors and 5xx
(`RateLimitError`, `APIConnectionError`, `InternalServerError`) and turns anything else into the generic failure with
`stopReason = system_error`. So: nothing separates "the account is out of credit" or "the key is invalid" (which only the
owner can fix, and which stops *every* AI feature at once) from a one-off bug; the owner is told nothing; and, to verify, the
raw provider text may reach the page in the endpoints that surface those errors.

**Proposal.**
1. **One classifier**, used by every Anthropic call site (the shared entry point is `app/services/llm_call.py`, with usage
   logging in `llm_usage.py`): `classify_provider_error(exc)` returns a kind, whether it is retryable, the message for the
   business user and the cause for the admin. Kinds to cover: **billing** (400 `invalid_request_error` whose message says the
   credit balance is too low; also a spend or usage limit), **auth** (401 invalid key, 403 permission or an organization
   disabled), **model** (404 or "model not found / not available to this key"), **rate limit** (429, retry), **overloaded or
   server** (529 and 5xx, retry), **network** (retry), and everything else unchanged. Match on the structured error type, status
   and code first and the message text only as a fallback, and keep a test per kind with the real shape of Anthropic's error
   body (the credit one is captured above).
2. **The business user** sees one calm line for billing, auth and model problems: "AI features are temporarily unavailable. We
   have been told and are fixing it; nothing you entered is lost." (never the provider's text, never a key or an account id), and
   the existing retry wording for the retryable kinds. A failed run still must not use a monthly run (`system_error`, as now).
3. **The admin is alerted with the cause, without reading logs.** There is no admin role in the app (`research_access.py` is
   shell-only), so the channel is a decision: (a) a stored provider-incident record (kind, first and last seen, count, the
   request id, the model, which feature) plus an owner-only read, for example `scripts/provider_status.py` and/or a status
   endpoint behind a secret; (b) a push to a webhook the owner chooses (Slack, Discord, ntfy), one URL in the environment;
   (c) email once a sending domain exists (blocked today: `RESEND_API_KEY` is unset in production, see the forgot-password
   email gap). Alerts are **deduplicated** (one per kind per few hours, with a count) and the incident **closes itself** when a
   later call succeeds. Suggested start: (a) plus (b).
4. **Say which key and account without exposing it.** The incident record carries the key's last 4 characters (from the
   configured key, never the key) and the model, so "the production key ending 1234 has no credit" can be compared with the
   Console in seconds. Never log or store the key, the request body or the user's data.
5. **Cheap detection before spending.** Consider a once-a-day, near-free probe (Anthropic's token-counting endpoint, or one
   tiny call) so a dead key or an empty balance is found before a customer's long run starts, and a start-of-run guard that
   refuses to begin a premium run when the last probe failed, with the same plain message.
6. **Cost note.** A run that spent money and then failed (this one: $1.62) is already recorded with its cost; the incident
   should link to it, and the admin message should say what was spent.

**Tests first (when built).** One per error kind with the real body shape; the user message never contains provider text;
the research run still counts as failed, not as a used run; the incident is created once, counted, deduplicated, and closed by a
later success; no key material in any message, log line or stored field; the five callers all route through the classifier;
the webhook sender is mocked (no network in tests).

**Open questions for the owner.** The alert channel (webhook now, email later?); who sees the status (only the owner); whether to
add the daily probe and the start-of-run guard; the wording of the user message; whether a billing incident should also pause
the 15-minute optimizer's Anthropic calls to avoid a flood of identical failures.

### Resume a failed research run from its last completed phase
**Found 2026-11-10.** A run that fails late (the dropped-connection failure: 30 searches, 37 pages, $4.28, lost in the findings step)
has to be started again from nothing. See "Dropped connections during streaming" in `docs/phase-7.md` for the full plan: store the
conversation, observed page text and counters after each phase (new column, both schemas, both migrations, throwaway Postgres check),
`POST .../research-runs/{id}/resume` for `FAILED` runs with `stopReason` `provider`, `system_error` or `stale`, a Resume button; no extra
monthly run (same row, a `FAILED` run never counts); about $3 instead of $4.90 for a deep Fable run that failed at findings. **Decided 2026-11-10:
not now.** Build it if research failures continue after the retry fix. Agreed terms: the conversation column; fetched page text kept
for 7 days after the run ends and deleted on review or discard (the runner stores none today); no extra monthly run; about $3 for a
deep Fable run that failed at findings against about $4.90 to start over. Today's failed run cannot be resumed: nothing from its
research was saved.

## Done

- **Dashboard tests leaked a `scrollIntoView` stub.** Tests assigned a stub to
  `Element.prototype` that stayed for every later test, so one test passed in the full
  file and failed alone. Each test now gets its own stub (#128).
- **Flaky vitest: a mock asserted right after waiting for something else (2026-11-10).** `BusinessDetailPage.test.tsx`
  "opens the avatars tab straight from #avatars" failed on `main` after the #172 merge (0 calls to `listAvatars`; it passed
  on the PR run and the run before): the test waited for the static "Buyer avatars" heading, then asserted at once that
  the list had been requested, but the request is made by an effect that can run after the heading is on screen. Reproduced
  deterministically by delaying that effect, then fixed with `waitFor`. A scan of every frontend test for the same shape
  (awaiting an element, then asserting a mock call with no user action in between) found two more where the awaited
  element does not depend on the mock's answer, both fixed: `MetaConnectionSection` "reports setup as incomplete" and
  `CampaignsSection` "loads and shows previously fetched results for a live campaign". The other positive assertions wait
  for an element that only appears once the mock has answered, so they cannot race. **Left as is:** about ten
  `not.toHaveBeenCalled()` checks right after a `findBy` can only pass early, never fail, so they are not flaky, but they
  prove less than they look (they could pass before a wrongly-made call happens).
