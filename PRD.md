# Sales Guru — Product Requirements Document

## 1. Summary

Sales Guru is an AI-powered advertising platform for small-to-medium businesses: a user links their business, describes what they sell, and the platform generates ad strategy, ad copy, and ad creative using AI — then publishes real campaigns to Meta Ads and reports back on results.

Functional reference for scope/pricing: saleads.ai/es/subscribe. Sales Guru is an independent product — own name, brand, and copy, not a reskin.

## 2. MVP core loop

The MVP is this end-to-end flow, in order. Each step is a fully working component before moving to the next (see §5, Build order).

1. **Create account** — sign up / log in
2. **Create business** — business profile (see §7 for exact fields)
3. **Describe product & define audience** — what the business sells, and who buys it (see §7 for exact fields)
4. **Upload images** — product/brand image assets, used as ad creative input
5. **Select objective** — campaign goal (see §7 for the exact value set — maps to Meta Ads campaign objectives)
6. **Connect Meta Ads** — OAuth into the user's Meta Business account, select ad account + Page
7. **AI generates strategy** — targeting, budget, objective-specific recommendations grounded in the business profile + product description
8. **AI generates ads** — ad copy variants + ad creative (composed from uploaded images and/or AI-generated), grounded in the strategy
9. **User approves** — review the generated strategy + ads; a single explicit **"Approve & Publish"** action is the only thing that triggers step 10 — approving never silently publishes on its own (see the checkpoint note under §5 step 8)
10. **Campaign goes live** — publish via the Meta Marketing API (create campaign / ad set / ad)
11. **Dashboard shows results** — pull performance metrics back from the Meta Ads Insights API

**Assumption (flag if wrong):** billing/subscriptions and credit metering are *not* part of this MVP loop — the priority is proving the core value loop (account → live campaign → results) before monetization. Billing moves to post-MVP (§4). The plan/pricing table in §3 is the target monetization model once billing is built, not an MVP requirement.

## 3. Plans (post-MVP monetization target)

| Plan | Monthly | Annual | Credits | Campaigns/mo | Businesses | Notes |
|---|---|---|---|---|---|---|
| PRO | $59 | $49 | 400 (≈15 standard images) | 8+ | 1 | Strategy AI, ad-gen AI, auto-optimizer |
| BUSINESS | $119 | $99 | 3180 (≈30 ultra-HD or 138 basic images) | 30 | 3 | + priority AI speed, comparative data |
| AGENCY | — | — | — | — | — | Future — multi-client agency tier, not in MVP |

Credits are the unit that meters AI generation (strategy + copy + image) usage; consumed per generation call. Not implemented until billing (§5, post-MVP).

## 4. Out of scope for MVP (explicitly deferred)

- **Billing/subscriptions/credits** — no payment gate in MVP; all AI generation is unmetered until billing lands post-MVP
- **Google Ads / TikTok Ads publishing** — Meta Ads only for MVP; other platforms require separate API integrations, deferred
- **Agency tier / multi-client management**
- **Team seats / multi-user per business**

**Known external dependency / risk:** Meta Marketing API access requires Meta App Review and Business Verification before the app can create live campaigns on a user's behalf beyond a small set of test users. This is an external approval process outside our control — build the integration against Meta's sandbox/test mode first, and treat App Review as a launch blocker to track separately, not an engineering task we can shortcut.

**Known gap, not addressed yet:** the session cookie is currently `samesite=lax`, which works locally (frontend/backend share `localhost`) but frontend and backend will be separate Render services on different subdomains in production — a genuinely cross-site relationship. `samesite=lax` may not survive that; likely needs `samesite=none; secure` plus verifying the cookie's `domain` scoping at actual deploy time. Revisit when deploying to Render, not before.

**Known gap, not addressed yet:** `MetaConnection.accessToken` (build step 6) is stored in plaintext, not hashed or encrypted — unlike `User.hashedPassword`/`Session.tokenHash`, this token has to be usable later for real Marketing API calls, not just verified, so it can't be a one-way hash. Revisit encryption at rest before production, same bucket as the `samesite=lax` gap above.

## 5. Build order (one component at a time, each fully working before the next)

1. **Foundation** — React 19 + TS + Vite frontend, Python (uv) + FastAPI backend, Prisma schema (SQLite dev → Postgres prod) via `prisma-client-py`, test/lint/CI tooling. *(done)*
2. **Auth** — `POST /auth/signup` (auto-provisions Organization, auto-logs in), `/login`, `/logout`, `/me`; DB-backed sessions via httpOnly cookie, tokens hashed at rest. Frontend: `/login`, `/signup` pages, `AuthProvider`/`useAuth`, route guards. *(done)*
3. **Business + product + audience onboarding** — Business (dashboard: list + create form), Product, and Audience (both on a `/businesses/:id` detail page, via `ProductsSection`/`AudiencesSection`) all done, backend + frontend. `GET /businesses/{id}` added for the detail page. Only image upload remains pending from this step.
4. **Objective + Meta Ads connection** — objective selector done: `POST/GET /businesses/{id}/campaigns` (`CampaignsSection`), objective is one of the fixed PRD.md §7 values, campaign optionally references a product/audience from the same business (cross-business references 404, scoped lookup). *(done)*
5. **AI strategy generation** — LLM call grounded in business/product/objective, stored strategy record *(done)*
6. **AI ad generation** — ad copy + creative generation grounded in the strategy *(done)*. Also where the Meta Ads OAuth connection itself lives (`app/api/meta.py`, `MetaConnectionSection`): connect → pick ad account + Page → `MetaConnection` stored, scoped per business. Built as its own component ahead of schedule (originally deferred to step 8 per an earlier version of §6) — actual campaign publishing (create campaign/ad set/ad on Meta) is still step 8, separate from this connection step.
7. **Approval flow** — review/edit UI, explicit user approval gate before publish *(done)*
8. **Campaign publish** — Meta Marketing API integration to create live campaign/ad set/ad from approved content, using the ad account/Page selected in step 6. *(done)* `POST .../campaigns/{id}/publish` (`app/services/publish.py`) creates Campaign → AdSet → AdCreative → Ad on Meta in sequence, mirrors them locally (first-ever `AdSet`/`Ad` rows), and moves `Campaign.status` to `LIVE` (or `FAILED`, retryable). Frontend's single **"Approve & Publish"** button calls approve (if still `PENDING_APPROVAL`) then publish in one user-triggered flow, satisfying the checkpoint requirement below without ever auto-publishing on its own.
   **Checkpoint requirement (confirmed 2026-08-08):** AI creates campaign → user reviews → single explicit "Approve & Publish" action → Meta API call — done, see above. The `autoPublish`-style toggle proposed here to later disable the checkpoint was *not* built — no auto-publish code path exists yet for it to gate, so an unused flag would just be dead weight (YAGNI). Add it when auto-publish is actually being built, not before.
   **Known simplifications, not addressed yet:** targeting sent to Meta is age-range only (`geo_locations` hardcoded to `["US"]`, no interest resolution — PRD.md §7's "resolve free text at publish time" gap is still open); ad creatives publish without an image whenever `Creative.imageUrl` is unset (no image generation/upload exists yet, PRD.md §2 step 4); a failed publish never rolls back any Meta objects it already created (e.g. campaign created, ad set creation fails) — manual cleanup on Meta may be needed after a `FAILED` retry.
9. **Results dashboard** — Meta Insights API integration, campaign performance view. *(done)* `POST .../campaigns/{id}/metrics/refresh` (`app/services/meta.py`'s `fetch_campaign_insights`) pulls impressions/clicks/spend/conversions from a live campaign's Meta Insights and appends a new `Metric` snapshot (history kept, never overwritten); `GET .../metrics` lists them most-recent-first. Frontend shows a "Results" block with a "Refresh results" button on `LIVE` campaigns, latest snapshot plus history below.
   **Known simplification, not addressed yet:** `conversions` is the sum of every entry in Meta's own `actions` breakdown (all action types mixed together — clicks, purchases, leads, etc.), not resolved per `Campaign.objective` to the one or two action_types that actually count as "the" conversion for it.
10. **Campaign optimization agent** — AI recommends pausing an underperforming ad, increasing budget on a well-performing one, or decreasing budget on a struggling one, grounded in the campaign's `Metric` history; gated behind the same kind of explicit checkpoint as step 8, never auto-applied. Was out of scope for MVP (§4, old revision) until real performance data started flowing in step 9 — now buildable. *(backend done; frontend pending, see Known gap below)*

    **Architecture (confirmed 2026-08-09):** two APScheduler jobs, in-process, no new infrastructure (no Redis/Celery/external cron — same Prisma/SQLite-dev/Postgres-prod DB as everything else, not a separate store):
    - `collect_metrics_for_all_live_campaigns` (every 15 min) — pure metrics collection for every live, Meta-connected campaign, no decisions made. Same Insights pull as step 9's manual "Refresh results," just scheduled.
    - `evaluate_all_live_campaigns` (every 60 min) — gate-checks each live campaign against **Event + Time + Data Sufficiency** (`has_sufficient_data`: hours since last check ≥6h AND spend since last check ≥$20 AND clicks since last check ≥30, all three ANDed) before spending an LLM call, so a campaign isn't re-analyzed off a normal fluctuation or before it has enough signal. This collapses the originally-discussed separate "4-6h lightweight check" and "24h deep optimization" tiers into one job with an internal ~24h-per-campaign cadence (`MIN_HOURS_BETWEEN_RECOMMENDATIONS`), rather than building a second, under-specified lightweight-analysis pathway — a scoped simplification of the reference 3-tier design, not the full spec.

    Once the gate passes, the agent computes real trend windows (24h/3d/7d deltas, via `compute_trend_windows`/`nearest_metric_at_or_before` diffing the latest cumulative `Metric` snapshot against the closest prior one) rather than reasoning over Meta's raw lifetime-to-date numbers — comparing recent performance against a spread of history is what prevents "CTR dipped this morning → PAUSE" reactions to noise. The LLM (forced tool-use, same pattern as Strategist/Creative) returns a structured recommendation — `action_type`, `reasoning`, `confidence` (0-1, self-assessed), `risk` (LOW/MEDIUM/HIGH, self-assessed), `suggested_budget` (optional) — never a single accept/reject question. Any budget suggestion is capped by a backend guardrail (`apply_budget_guardrail`, max ±20% change) before it's ever stored, never trusted raw from the LLM. `requiresApproval` is likewise computed by the backend (`compute_requires_approval`), not taken from the model — currently always `true` (every recommendation requires the checkpoint below, regardless of computed risk) so a future LOW-risk auto-apply capability is a rule change in that one function, not a schema or trust-model change.

    `app/services/optimizer.py` is the pure agent (gate logic, trend computation, the LLM call, guardrail) with no DB access; `app/services/optimization_jobs.py` is the DB-touching orchestration layer the scheduler (`app/core/scheduler.py`) and the manual "generate now" endpoint both call — same pure-service-vs-orchestration split already used for publish (`app/services/meta.py` vs. `app/services/publish.py`).

    **Checkpoint requirement (confirmed 2026-08-09):** Optimization Agent generates one recommendation (`PAUSE_AD`, `INCREASE_BUDGET`, or `DECREASE_BUDGET`) with its reasoning, confidence, and risk → user reviews → a single explicit **Approve** (applies it to Meta immediately, same "approve = act" shape as "Approve & Publish") or **Reject** action. Never auto-applied on generation alone. "Initially" implies this checkpoint may become toggleable later (auto-apply approved-pattern recommendations without a click) — not built now, same YAGNI reasoning as the publish step's deferred `autoPublish` toggle: add it if/when auto-apply is actually being built.

    **Future direction, recorded but explicitly deferred:** once enough historical data accumulates, the system could learn when it's actually worth analyzing a campaign (adaptive timing) instead of the fixed 15-min/60-min schedule above — noted by the user as an interesting evolution, not something to build now.

    **Known gap, not addressed yet:** no frontend UI exists yet for viewing/approving/rejecting recommendations (no `Recommendation` type in `api.ts`, no display of confidence/risk) — backend (`app/api/optimization.py`: create/list/approve/reject) is fully built and tested, frontend is the next piece.
11. **(Post-MVP) Billing** — Stripe plans, checkout, credit balance sync per §3
12. **(Post-MVP) Google/TikTok Ads, agency tier, team seats**

## 6. Tech defaults (confirmed 2026-08-07)

- Frontend: React 19 + TypeScript + Vite (SPA), `react-router-dom` for routing, React Context for auth state (no Redux/Zustand — reconsider only if state needs grow past this), plain controlled forms (no form library yet), accessibility linting (oxlint jsx-a11y plugin) + Playwright e2e with axe-core. Playwright's e2e suite runs a real backend alongside the built frontend (see `frontend/playwright.config.ts`) — it's a genuine integration test, not mocked.
- Backend: Python, managed by `uv`, FastAPI; ruff + mypy (with the `pydantic.mypy` plugin) + ty for lint/type-check; pytest + pytest-cov (≥90% coverage gate, both frontend and backend). CORS via `CORSMiddleware`, origins configured through `CORS_ORIGINS` (comma-separated). API schemas inherit from `app/schemas/base.py`'s `CamelCaseModel` — Python stays snake_case, JSON in/out is camelCase (matches Prisma's own field names and TS convention, no per-endpoint casing decisions). Nested-resource ownership (e.g. a Product's parent Business) is checked via shared `app/core/authz.py` dependencies — 404 (not 403) whether a resource doesn't exist or belongs to someone else, so ownership can't be probed.
- Data layer: `schema.prisma` (SQLite dev → Postgres prod) with `prisma-client-py` generating the Python client
- LLM provider: Anthropic (Claude) for strategy + copy generation
- Image provider: TBD at step 6 (evaluate at implementation time)
- Ad platform: Meta Marketing API (step 8-9); Google/TikTok deferred
- CI/CD: GitHub Actions (path-scoped lint/type/test per package) via `ci-status` aggregate check; Render hosts frontend/backend as separate services, each with `autoDeployTrigger: checksPass` (native Render feature — waits for the GitHub check to pass, no custom deploy-hook plumbing) and a per-service `buildFilter`, so docs-only changes deploy nothing
- Repo: monorepo at `/Users/andres/Documents/AI-NATIVE/sales-guru` — `frontend/`, `backend/` (includes `backend/prisma/`), `docs/`, `.github/workflows/`
- Schema changes always go through `prisma migrate dev --name <desc>` (never `prisma db push`) so a real migration history exists for `prisma migrate deploy` to apply in CI/Render

## 7. Onboarding field specifications (confirmed 2026-08-08)

Elaborates MVP steps 2, 3, and 5. Schema lives in `backend/prisma/schema.prisma`;
this section is the product-facing rationale for those fields.

**Business** (step 2) — `name` required, rest optional (low signup friction; AI
strategy generation degrades gracefully with less context):

| Field | Notes |
|---|---|
| Nombre (name) | required |
| Website | |
| Industria (industry) | |
| Ubicación (location) | |
| Descripción (description) | |

**Product** (step 3) — no separate name field; `description` ("What do you
sell?") doubles as its identity, truncated for display in lists:

| Field | Notes |
|---|---|
| What do you sell? | → `description`, required |
| Price | |
| Margin | assumed profit margin %; revisit if meant differently |
| Features | freeform text for MVP, not a structured list — an LLM parses freeform bullets fine for ad generation |
| Benefits | freeform text, same reasoning |
| URL | product page link, distinct from Business.website; this is the actual destination URL Meta requires on traffic/conversion ads |

**Audience** ("who buys" — step 3) — same no-separate-name convention as
Product; `description` ("Who buys?") is the identity:

| Field | Notes |
|---|---|
| Who buys? | → `description`, required |
| Age | → `ageMin`/`ageMax` as two integers, not a freeform range string — matches Meta's `age_min`/`age_max` targeting fields directly, no parsing needed at publish time |
| Location | freeform text; Meta resolves free text to its own location IDs via a targeting-search call at publish time (step 8), not at data-entry time |
| Interests | freeform text; same reasoning — resolved against Meta's interest taxonomy at publish time |
| Problem | feeds strategy/copywriting AI (classic problem/desire direct-response framework) |
| Desire | feeds strategy/copywriting AI |

**Campaign objective** (step 5) — maps directly to Meta's own campaign
objectives:

| Field | `Campaign.objective` value |
|---|---|
| Ventas | `SALES` |
| Leads | `LEADS` |
| Tráfico | `TRAFFIC` |
| Mensajes | `MESSAGES` |
| Reconocimiento | `AWARENESS` |

**Known gap, not a blocker today:** `SALES` on Meta's side is normally
tracked via a Pixel or Conversions API integration on the business's own
site. Nothing models that yet — a Sales-objective campaign can still publish
and run without it, just with worse optimization/measurement. Revisit when
building step 8 (Campaign publish).
