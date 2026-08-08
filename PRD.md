# Sales Guru — Product Requirements Document

## 1. Summary

Sales Guru is an AI-powered advertising platform for small-to-medium businesses: a user links their business, describes what they sell, and the platform generates ad strategy, ad copy, and ad creative using AI — then publishes real campaigns to Meta Ads and reports back on results.

Functional reference for scope/pricing: saleads.ai/es/subscribe. Sales Guru is an independent product — own name, brand, and copy, not a reskin.

## 2. MVP core loop

The MVP is this end-to-end flow, in order. Each step is a fully working component before moving to the next (see §5, Build order).

1. **Create account** — sign up / log in
2. **Create business** — business profile (name, industry, target audience, tone/voice)
3. **Describe product** — what the business sells / is promoting
4. **Upload images** — product/brand image assets, used as ad creative input
5. **Select objective** — campaign goal (awareness / traffic / conversions — maps to Meta Ads campaign objectives)
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

## 5. Build order (one component at a time, each fully working before the next)

1. **Foundation** — React 19 + TS + Vite frontend, Python (uv) + FastAPI backend, Prisma schema (SQLite dev → Postgres prod) via `prisma-client-py`, test/lint/CI tooling. *(in progress)*
2. **Auth** — create account, log in
3. **Business + product onboarding** — create business, describe product, upload images
4. **Objective + Meta Ads connection** — objective selector, Meta OAuth, ad account/Page selection
5. **AI strategy generation** — LLM call grounded in business/product/objective, stored strategy record
6. **AI ad generation** — ad copy + creative generation grounded in the strategy
7. **Approval flow** — review/edit UI, explicit user approval gate before publish
8. **Campaign publish** — Meta Marketing API integration to create live campaign/ad set/ad from approved content
9. **Results dashboard** — Meta Insights API integration, campaign performance view
10. **(Post-MVP) Billing** — Stripe plans, checkout, credit balance sync per §3
11. **(Post-MVP) Google/TikTok Ads, auto-optimizer, agency tier, team seats**

## 6. Tech defaults (confirmed 2026-08-07)

- Frontend: React 19 + TypeScript + Vite (SPA), accessibility linting (oxlint jsx-a11y plugin) + Playwright e2e with axe-core
- Backend: Python, managed by `uv`, FastAPI; ruff + mypy + ty for lint/type-check; pytest + pytest-cov (≥90% coverage gate, both frontend and backend)
- Data layer: `schema.prisma` (SQLite dev → Postgres prod) with `prisma-client-py` generating the Python client
- LLM provider: Anthropic (Claude) for strategy + copy generation
- Image provider: TBD at step 6 (evaluate at implementation time)
- Ad platform: Meta Marketing API (step 8-9); Google/TikTok deferred
- CI/CD: GitHub Actions (path-scoped lint/type/test per package) must pass before deploy; Render hosts frontend/backend as separate services, deployed via deploy-hook triggered only after CI succeeds on the relevant path, docs-only changes deploy nothing
- Repo: monorepo at `/Users/andres/Documents/AI-NATIVE/sales-guru` — `frontend/`, `backend/`, `prisma/`, `docs/`, `.github/workflows/`
