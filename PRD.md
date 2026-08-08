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
9. **User approves** — review/edit the generated strategy + ads before anything goes live
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
- **Auto-optimizer** — AI adjusting live campaigns based on performance data; needs real ad-platform data flowing first (depends on step 11 being live)
- **Agency tier / multi-client management**
- **Team seats / multi-user per business**

**Known external dependency / risk:** Meta Marketing API access requires Meta App Review and Business Verification before the app can create live campaigns on a user's behalf beyond a small set of test users. This is an external approval process outside our control — build the integration against Meta's sandbox/test mode first, and treat App Review as a launch blocker to track separately, not an engineering task we can shortcut.

**Known gap, not addressed yet:** the session cookie is currently `samesite=lax`, which works locally (frontend/backend share `localhost`) but frontend and backend will be separate Render services on different subdomains in production — a genuinely cross-site relationship. `samesite=lax` may not survive that; likely needs `samesite=none; secure` plus verifying the cookie's `domain` scoping at actual deploy time. Revisit when deploying to Render, not before.

## 5. Build order (one component at a time, each fully working before the next)

1. **Foundation** — React 19 + TS + Vite frontend, Python (uv) + FastAPI backend, Prisma schema (SQLite dev → Postgres prod) via `prisma-client-py`, test/lint/CI tooling. *(done)*
2. **Auth** — `POST /auth/signup` (auto-provisions Organization, auto-logs in), `/login`, `/logout`, `/me`; DB-backed sessions via httpOnly cookie, tokens hashed at rest. Frontend: `/login`, `/signup` pages, `AuthProvider`/`useAuth`, route guards. *(done)*
3. **Business + product onboarding** — `POST /businesses` + `GET /businesses` and a dashboard page (business list + create form) done. Product/Audience/image upload — backend and frontend both still pending.
4. **Objective + Meta Ads connection** — objective selector, Meta OAuth, ad account/Page selection
5. **AI strategy generation** — LLM call grounded in business/product/objective, stored strategy record
6. **AI ad generation** — ad copy + creative generation grounded in the strategy
7. **Approval flow** — review/edit UI, explicit user approval gate before publish
8. **Campaign publish** — Meta Marketing API integration to create live campaign/ad set/ad from approved content
9. **Results dashboard** — Meta Insights API integration, campaign performance view
10. **(Post-MVP) Billing** — Stripe plans, checkout, credit balance sync per §3
11. **(Post-MVP) Google/TikTok Ads, auto-optimizer, agency tier, team seats**

## 6. Tech defaults (confirmed 2026-08-07)

- Frontend: React 19 + TypeScript + Vite (SPA), `react-router-dom` for routing, React Context for auth state (no Redux/Zustand — reconsider only if state needs grow past this), plain controlled forms (no form library yet), accessibility linting (oxlint jsx-a11y plugin) + Playwright e2e with axe-core. Playwright's e2e suite runs a real backend alongside the built frontend (see `frontend/playwright.config.ts`) — it's a genuine integration test, not mocked.
- Backend: Python, managed by `uv`, FastAPI; ruff + mypy (with the `pydantic.mypy` plugin) + ty for lint/type-check; pytest + pytest-cov (≥90% coverage gate, both frontend and backend). CORS via `CORSMiddleware`, origins configured through `CORS_ORIGINS` (comma-separated).
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
