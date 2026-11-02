# Phase 6: make buyer avatars visible in the app

Branch: `avatar` (from `main` at `51318de`). Phases 1-4 are merged: the BuyerAvatar library, the
import, the Strategist assigning `buyerAvatarId` and a pillar, the Creative Agent writing per
avatar, and per-business banned phrases. Production holds the VENZI data (`docs/rollout-venzi.md`).

Last updated: 2026-11-02.

## Status

| Step | State |
| --- | --- |
| Read-only survey and this plan | Done |
| Decisions answered by the user | Done (2026-11-02) |
| Tests written red first | Done for backend and unit tests; the e2e specs were written after the UI (they need it) |
| Goal 1: avatar name on creative cards | Done (backend fields + card) |
| Goal 2: avatar on dashboard / results | Done (`AdRow` fields, "Leading buyer" line); `choose_leader` untouched |
| Goal 3: Avatars tab (list, edit, activate, reorder, delete, import moved) | Done, with `POST .../avatars/reorder` |
| Goal 4: avatar slug in new ad names / `utm_content` | Done (`ad_naming.plan_ad_names`); `utm_medium` unchanged |
| Backend full suite | Done: 2644 passed, 96.1% coverage; ruff, format, mypy, ty clean |
| Frontend: lint, tsc, vitest + coverage | Done: 1333 passed, 95.8% lines |
| E2E (FAKE_LLM): avatars-tab, avatar-labels, avatar-import | Done: 6 passed, axe clean |
| Full e2e suite (`CI=true npm run test:e2e`) | Done: 96 passed |
| Report to the user before opening the PR | Done; waiting for approval to commit / push / open the PR |

Rules for this phase: ask before any commit, push, merge or database write; no paid LLM or Meta
calls (FAKE_LLM only); frontend accessible (axe via `analyzeWhenReady`); `choose_leader` stays as
it is. The backend migration to Postgres is not needed (see "No schema change").

## What exists today (survey)

**Avatar API** (`backend/app/api/buyer_avatar.py`, under `/businesses/{id}/avatars`): create,
`/import`, `/bulk`, list (`?active=`, `?includeDeleted=`), get, PATCH (any field incl.
`purchaseFor`, `isActive`, `sortOrder`), DELETE (soft: sets `deletedAt`). Cap: 12 per business.
There is **no reorder endpoint**.

**Creatives.** `Creative` already stores `avatar` (self_purchaser | gift_buyer), `concept`,
`pillar` and `buyerAvatarId` (plain string, not a relation). But `CreativeResponse`
(`backend/app/schemas/creative.py`) returns none of them, only `creativeAngle`, and the frontend
`Creative` type (`frontend/src/lib/api.ts`) has the same gap. `CreativeCard.tsx` prints
`creative.creativeAngle`.

**`creativeAngle` is a join key, not just a label.** It is `angle_label(avatar, concept, pillar)`
("Self-purchaser – Ceramic inlay – Mechanism"). `api/creative.py` and `services/creative.py` match the
model's variants back to the plan's angles by that exact string. **Do not change `angle_label` or
the stored `creativeAngle`.** The avatar name is added as new fields instead.

**Dashboard.** `api/dashboard.py` builds `AdInfo(id, name, status)` from local `Ad` rows;
`dashboard.build_tier3` makes `AdRow(name, ...)` and `choose_leader` picks the leader.
`round_results.py` already maps leader -> angle -> `buyer_avatar_id` for the Strategist. `Ad` has
`creatives Creative[]`, so ad -> creative -> `buyerAvatarId` is one query.
Frontend: `Tier3Table.tsx` prints `ad.name` and a "Leading" tag; `leaderMessage` is
"Leading on cost per purchase / cost per add-to-cart".

**Ad names and UTMs.** Built in exactly one place at publish time:
`publish._publish_creative_ads` (shared by a creative test's first ad set and by round packs) calls
`creative_naming.ad_name(avatar, concept, headline, pillar)` and `creative_naming.url_tags(...)`.
- Name = `angle_label`, e.g. "Gift buyer – Not the same ring – Education"; falls back to the headline
  for an ad with no structured angle. Saved to `Ad.name` and sent to Meta.
- UTMs: `utm_source=paid_social`, `utm_medium=<self-purchaser|gift-buyer>-<concept>` (or `paid`),
  `utm_campaign=<campaign name>`, `utm_content=<ad name>`, `utm_term=<pillar>`.
- Uniqueness today comes from the plan validator: no two angles share (avatar, concept, pillar).
- Nothing renames an ad after publish (`db.ad.update` only changes `status`).

**Where names/UTMs are read back (the answer to "what parses them"): nothing parses them.** The app
only displays or quotes `Ad.name`: dashboard `AdRow.name`, pause-proposal `target_ad_name`,
`creative_test_rules` messages, the optimizer prompt. No code splits a name or reads UTMs back.
The only consumers that could parse them are outside the app (the store's analytics grouping by
`utm_medium` / `utm_content`, Ads Manager filters).

**Business page** (`BusinessDetailPage.tsx`) is one scrolling page of sections with onboarding gates;
it has **no tabs**. The only tab pattern in the app is `PreviewStage.tsx` (`role="tablist"`).
`AvatarImportSection` is rendered at the bottom once the brand exists.

## Design

### Goal 1: creative cards
- Backend: add to `CreativeResponse` `avatar`, `concept`, `pillar`, `buyerAvatarId` (existing
  columns) and a resolved `buyerAvatar: {id, name, state}` where state is `active`, `inactive` or
  `archived` (deleted). The lookup reads the business's avatars with deleted ones included, once
  per response, not per creative.
- Frontend: card line = `<avatar name> – <Concept> – <Pillar>`
  ("The Promotion Ring Buyer – Ceramic inlay – Mechanism"). No `buyerAvatarId` -> today's
  `creativeAngle` text unchanged. An inactive or deleted avatar still shows its name followed by an
  marker: "archived" for a deleted avatar, "inactive" for a deactivated one (text, not colour alone).
- `creativeAngle` is untouched, so matching and old data keep working.

### Goal 2: dashboard and results
- `AdInfo` gains the ad's avatar (name, state), concept and pillar, read through ad -> creative.
  `AdRow` gains `avatarName`, `avatarState`, `concept`, `pillar`. The frontend finds the leader's
  row and shows "Leading buyer: The Promotion Ring Buyer – Mechanism" under the existing verdict
  (no new backend field for it).
- `choose_leader`, `build_tier3`'s ranking and `leaderMessage` are unchanged; the new fields are
  added after the leader is chosen. Ads without an avatar show their current name.
- The Strategist's round-results text (`round_results.py`) is not changed.

### Goal 3: Avatars tab
- New `BusinessTabs` (tablist with roving focus, arrow keys, Home/End, `aria-controls`; the Results
  tab stays mounted, hidden, once shown, so a publish or edit in progress survives a look at the
  avatars; the selected tab is the URL hash): "Results and
  campaigns" (today's content, default) and "Avatars". Shown once the brand exists, like the import
  section is now.
- `AvatarsSection`: lists active and inactive avatars in order (deleted ones are not listed);
  each opens an edit form with every field (name, who, buys for, the seven lists, active toggle);
  activate/deactivate; reorder with Move up / Move down buttons (keyboard friendly, no drag); soft
  delete behind a confirmation dialog. `AvatarImportSection` moves into this tab.
- Backend: one new endpoint, `POST /businesses/{id}/avatars/reorder` with the ordered ids of the
  business's non-deleted avatars; it must list every one of them exactly once and renumbers
  `sortOrder` in one batch. Everything else already exists.
- Existing e2e `avatar-import.spec.ts` must open the tab first.

### Goal 4: ad names and UTMs for new campaigns
- No stored data changes: the slug is computed at publish time, only for a creative that has a
  `buyerAvatarId`. Every creative made before avatars existed has none, so its name and UTMs are
  built exactly as today. Already-published ads are never touched (nothing renames them).
- Slug: lowercase ASCII from the avatar's name, "the" dropped, words joined by hyphens, at most 24
  characters cut at a word boundary ("The Promotion Ring Buyer" -> `promotion-ring-buyer`).
- Uniqueness within a campaign: when two different avatars would get the same slug in one campaign
  (checked against ads already in the campaign and earlier ads in the same batch), the later one gets
  `-2`, `-3`.
- Limits: Meta's ad name limit is 400 characters and `url_tags` 2000; names stay well under, with a
  test at the maximum (60-character avatar name, long concept).
- **Shape (decided):** name `Self-purchaser (promotion-ring-buyer) – Ceramic inlay – Mechanism`; the
  old prefix is kept, so a filter on "Self-purchaser" or "Gift buyer" still matches. `utm_medium`
  is unchanged; `utm_content` carries the new name; `utm_term` stays the pillar.

### No schema change
Everything uses existing columns, so there is no Prisma or Postgres migration and nothing to run
against production. (A schema change would be needed only to freeze the slug at generation time; see
decision 2.)

## Risks for campaigns that already exist
- **Published ads:** untouched. `Ad.name` is never recomputed and no code renames an ad on Meta.
- **Production today (read-only SELECT, 2026-11-02):** two campaigns. "Landing Page" is PENDING_APPROVAL
  with 4 creatives and no avatar on any of them, so its names will not change when published.
  "Snake-Ring" is already published (PAUSED, on Meta) with 4 ads that all carry a `buyerAvatarId`
  (Deadline Gift-Giver, Promotion Ring Buyer, and Quiet-Luxury Collector twice) and old-style names
  such as "Self-purchaser – Ceramic inlay – Mechanism". Those names are final and are never
  recomputed; they stay as they are, and Goals 1 and 2 will show the avatar names on them
  (a real test case: two ads share one avatar). ("Pack1-testing" no longer exists.)
- **Pending (not yet published) campaigns in general:** names are built at publish, so any pending
  campaign whose creatives *have* a `buyerAvatarId` gets the new names when published. Today none do.
- **Matching key:** `creativeAngle` unchanged on purpose (see above).
- **Avatar edited later:** cards and the dashboard show the avatar's *current* name; a published ad
  keeps the slug it was published with. Renaming an avatar after publishing therefore makes the app
  and Ads Manager differ in wording only.
- **Deleted avatar:** old creatives and ads must still resolve it (lookup includes deleted), or the
  card/dashboard would crash; tested.
- **Reporting:** nothing in the app parses names or UTMs. External analytics keyed on `utm_medium` or
  `utm_content` will show new values for new campaigns only; old campaigns keep their old values.
  Optimizer and rule messages quote ad names, so they just get longer.
- `sortOrder` also orders the avatars shown to the Strategist, so reordering in the tab changes the
  order of that list on the next generation (no other effect).

## Decisions (answered 2026-11-02)
1. **Ad names and UTMs:** `utm_medium` stays exactly as today (`<self-purchaser|gift-buyer>-<concept>`).
   The avatar slug goes in the ad name and therefore in `utm_content` (which carries the name):
   `Self-purchaser (promotion-ring-buyer) – Ceramic inlay – Mechanism`. Names stay within Meta's
   limits and unique within a campaign.
2. **Slug timing:** computed at publish. No schema change.
3. **Markers:** "archived" for a deleted avatar, "inactive" for a deactivated one.
4. **Tabs:** approved. Accessible tabs (roles, arrow keys, focus handling); the selected tab lives in
   the URL hash (`#avatars`) so a refresh or a link opens the same tab.

## Test plan (red first)
- Backend: `CreativeResponse` fields and avatar resolution (active, inactive, deleted, none);
  dashboard `AdRow`/`leaderDetail` with and without avatars, and an unchanged `choose_leader`
  (existing tests stay green); reorder endpoint (valid, missing id, duplicate, foreign business, a
  deleted avatar); naming: slug rules, uniqueness, length limits, creatives with no avatar produce
  byte-identical names and UTMs to today.
- Frontend (vitest + testing-library): card line and archived marker, fallback; Tier3 table;
  tabs keyboard behaviour; Avatars section list/edit/toggle/reorder/delete confirmation.
- E2E with FAKE_LLM (no paid calls): avatars tab lifecycle, card label, dashboard label; axe with
  `analyzeWhenReady` on the new views.

## Log
- 2026-11-02: built. The e2e run found one real bug the unit tests missed (a later list change
  pulled focus back to the last Move button); fixed and covered by a unit test.
- 2026-11-02: survey done, plan written; production checked (Snake-Ring published with old names,
  Landing Page pending without avatars); decisions answered; build starts with failing tests.
