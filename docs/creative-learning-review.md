# Creative hooks and learning from results: review (2026-11-06)

Read-only review of your draft prompt and the other reviewer's take, against the code. No code changed; this file is the
only thing written. Branch `creative-hook`. I did not run any model call, so nothing here is a measured cost or quality
number. Estimates are marked.

**Verdict in one line.** The draft is a good *offline hook workshop* and a poor *production prompt*. Its category rules
and its "don't invent anything" constraints are worth keeping. Its output (10 hooks, six fields each, ranking, a
recommendation, an alternative, a script, a visual direction) does not fit what the Creative Agent returns or what the app
can use, and its categories are not a safe base for learning.

## 1. Where I agree and disagree

**With the other reviewer: agree on most points**
- A prompt alone does not make the app learn. The Creative Agent has no results input today. `round_results.py` is read
  in one place, `creative_round.py:225`, and goes to the Strategist only.
- Length limits, the shared CTA, the strict schema and single-image versus video are all real conflicts (section 2).
- Learning needs a stored category, a per-business aggregate, a minimum-data rule and an exploration slot.

**Where I would correct or sharpen it**
- *"Existing no-curiosity-gaps rule."* Slightly overstated. Rule 3 bans curiosity-gap hooks "the landing page doesn't
  immediately pay off" (`ad_quality.py:149`), and your draft says a curiosity hook must lead to a clear payoff, so the two
  agree in spirit. The hard conflict is the code: `BANNED_PHRASES` rejects "you won't believe", "wait until you see" and
  "find out why" (`ad_quality.py:24-34`), the natural openers for curiosity, and a hit fails the whole batch.
- *"Research excerpts aren't available."* Raw excerpts: correct, no `BuyerAvatar` field holds quotes. But each variant's
  avatar block already carries the research-derived problem, mechanism, what they don't know, objection and up to 3 of the
  avatar's saved hooks (`avatar_copy_prompt.py:117`). `{{customer_motivation}}` is therefore mostly available;
  `{{customer_language}}` is not. The draft's inputs map like this:

| Draft input | In the code today |
|---|---|
| objective, CTA | Yes, with the exact allowed CTA set (`creative.py`, `_build_prompt_parts`) |
| product and verified facts | Yes (product, features, benefits) |
| approved claims and evidence | Partly: `BrandProfile.proofPoints` and standing offer; no per-claim "approved" status |
| avatar, motivation or objection | Yes, trimmed to the pillar's fields (`avatar_copy_prompt.assigned_block`) |
| research excerpts | **No** (quotes live in research findings, not on the avatar) |
| concept, angle, pillar | Yes, from the plan, one per variant |
| brand voice and examples | Yes (`brand_voice_lines`, `exampleCopy`) |
| placement | **No** (only format: image, video, carousel) |
| available assets | Partly: one primary photo (or a video thumbnail) as vision input |

- *The draft's category set is the biggest problem for learning, not for writing.* "Specificity" and "subtle authority"
  describe how well a line is grounded, not a hook shape, and "emotional tension" overlaps the `emotion` pillar while
  "authority" overlaps `mechanism` and proof. A category that overlaps the Strategist's pillar cannot be learned
  separately from it (section 4).
- *Generate-then-choose is the best idea in the draft.* But generating 10 candidates and ranking them is only useful if
  the ranking changes what ships. In production it must happen inside one forced tool call (`llm_call.py:260-271`, no
  free reasoning step), so it costs output tokens.

## 2. What would break or fight existing rules

| Draft part | Conflicts with | Where |
|---|---|---|
| Free-form output: 10 hooks, rationale, ranking, primary plus alternative | The agent must return one `submit_creatives` call: exactly the requested number of variants, each `headline`, `body_text`, optional `description`, `cta`, `creative_angle`. Anything else fails or is ignored | `schemas/creative.py:149`; `creative.py:141` |
| "Primary plus a materially different alternative" for one angle | Variants must have distinct angles, so two variants on one angle fail; the alternative has no slot and nothing stores it | `schemas/creative.py:431` |
| ONE angle at a time | A first batch is four angles in plan order; a single-angle call is the regenerate path (`single_variant`), one variant, not a ten-hook workshop | `creative.py:1371`, `_build_prompt_parts` |
| "Opening spoken line", "first-frame direction", "visual feasibility", "short script" | No slot, and no control: `image_prompt` and `video_prompt` were removed, ads use the owner's photos or one shared video, and a test holds the visual constant. The ranking criterion "visual feasibility" cannot be acted on | `creative.py:183-189`; PRD.md line 227 |
| Body copy of any length | Primary text is at most 125 characters, must end on `.` `!` or `?`; headline 40; description 30. A 10-hook output followed by a script is far outside this | `schemas/creative.py:93-95,188`; `creative.py:369` (publish gate) |
| "Call to action" as something the model writes | One shared CTA per batch, from the objective's allowed set; the draft's own `{{cta}}` input is right, the output line is not | `schemas/creative.py:431` |
| 2 curiosity hooks | The banned phrases above; and curiosity must not withhold the product or price (rule 3) | `ad_quality.py:24-34,149` |
| "Evidence or production checks required before publication" | Nothing consumes this; the real gate is the code's `copy_problems` and banned phrases, which the model cannot see in the draft | `creative.py:369` |
| 10 hooks x 6 fields before the answer | Output size. The tool call already hit `_MAX_TOKENS = 8192` once (`creative.py:140`) | `creative.py:140` |

Parts of the draft that **fit well and are already enforced or stated**: no invented testimonials, statistics, scarcity or
guarantees (quality rule 3 and `OFFER_RULE`), no clickbait or unsupported superiority (rules 4 and 7), preserving the
assigned avatar, concept, angle and pillar (the per-variant tail), and "flag rather than force". The ones worth adding are
the per-category credibility rules (contrarian without a false consensus, tension without shaming, authority only from
approved evidence).

A policy note outside the code: emotional-tension hooks that imply the viewer's personal situation ("tired of...",
"still single?") can fall under Meta's personal-attributes rules. Review that wording before shipping that category.

## 3. Cheapest measurable improvement, and the smallest learning loop

**Cheapest: lift the good parts into the existing prompt, drop the workshop.** No schema change, no new call, no
Strategist change.
1. Add the five category rules as five hook *shapes* in the cached system prompt (`creative.py:619`), replacing the loose
   list in quality rule 1 (`creative.py:199`). Fit them to the real limits: each shape complete in about 100 characters,
   and curiosity worded as a *concrete payoff stated in the line* (no banned openers), which keeps it inside rule 3.
2. Tell the model that the variants in a batch must use different shapes, so the batch itself is "generate then choose".
   The existing distinct-text check covers rewordings.
3. Reword `GUIDANCE` (`avatar_copy_prompt.py:126`) so the avatar's saved hooks are source material for the line (their
   problem, their words), still never copied.
4. Keep the draft's REVIEW step as one sentence ("drop any line that needs a claim you were not given") instead of a
   ranking; nothing can use a ranking.

**How to know it helped without waiting for ad results.** (a) Retry rate: `llm_usage` already logs `attempt`, and a rise
means a rule is fighting a validator. (b) The existing opener checks (`ad_quality.py`). (c) A blind owner read of old
versus new prompt on the same angles. **The draft is well suited to this last step:** run it *as is*, offline, on about 5
real angles, and have the owner pick the winners; that shows which categories produce lines worth porting. Real calls
cost money, and CLAUDE.md requires an explicit approved cap in the message authorizing them; I have run none.

**Smallest learning loop worth building** (needs approval; it is a schema change):
1. A nullable `Creative.hookType` from a closed list of 4 or 5 shapes that do **not** overlap the pillars. Assigned **in
   code** per variant position, like the angle (`apply_plan_angles`), not self-labeled by the model.
2. A per-business read, by `hookType`, over ads that ran in a common window (`ad_window.compare_ads`), with ad counts and
   result counts beside each.
3. One short block in the **per-call tail** of the next round, only for categories with enough data, worded as a lean.
4. One exploration slot per batch: the least-tested category, assigned in code.

## 4. Risks

- **Cost per batch (estimates).** The draft as written, run on four angles, is on the order of 40 candidates with six
  fields each plus rankings and two finished creatives per angle: several thousand output tokens, which approaches the
  8,192 cap. Run as four per-angle calls it is four calls, though the system, image and context tiers read from cache.
  The cheap version in section 3 adds a few hundred cached input tokens and almost no output. A retry roughly doubles a
  call's tail and output.
- **Noise and overfitting, the main risk.** A leader needs only 5 add-to-carts per ad (or 10 purchases) over a 72-hour
  window (`creative_test_rules.py:33-35`, `config.py:190`). With 5 events a count's own spread is about 45% of itself
  (1/sqrt 5); with 10, about 32%. Differences between hook shapes are usually smaller. A round has 3 to 4 ads, so a shape
  may have only 1 or 2 ads per business.
- **Confounding.** Avatar, concept and pillar already vary across ads, and the image is shared. A result by hook shape
  mostly measures which avatars and pillars were in play. Use shapes that do not overlap pillars, keep the lean weak, and
  do not pool across businesses (tenant boundary).
- **Prompt cache.** Static shapes in the system prompt: one rewrite of every tier on deploy, then free. A schema field:
  the same one-time rewrite (the tool schema is first in the prefix). A results block in the cached campaign context would
  rewrite that tier after every round, so it must go in the tail (`creative.py:1584-1620`).
- **Published ads.** All copy still passes `GeneratedCreativeBatch` validation and the `copy_problems` publish gate, so
  nothing new reaches Meta unchecked. The indirect risks are more retries and coerced batches (`_coerce_batch` fixes CTAs
  and lengths, not bait), a learned lean that narrows variety, and, for emotional-tension lines, Meta policy (section 2).
  ALL CAPS and `!!!` remain prompt-only (PRD.md line 230).

## 5. Recommended phasing

1. **Phase 0: use the draft offline, as is (no code).** Approve a spend cap, run it on about 5 real angles, owner picks
   winners, and look at existing creatives against results for any signal at today's volume. If there is none, say so
   before building storage.
2. **Phase 1: port the good parts into the production prompt** (section 3, cheapest). Tests like those in
   `tests/test_creative_service.py`, the retry-rate check, and a blind owner read. PRD.md and `docs/phase-7.md` in the same
   PR.
3. **Phase 2: record, don't use.** `hookType` assigned in code and stored; shown with results. One migration (both Prisma
   schemas, verified on throwaway Postgres). No prompt change.
4. **Phase 3: use it, once Phase 2 has data.** The tail block with minimum-data rules and one exploration slot, behind a
   setting. If a business never reaches the thresholds, the block never appears, which is correct.

Open decisions for you: the closed list of shapes (and whether it is jewelry-specific), whether the headline counts as a
second hook slot, the spend cap for Phase 0, and approval for the `hookType` schema change.

## Appendix: decisions and the offline run (2026-11-06)

**Decisions from the owner.** (1) The headline is not a second hook slot: one hook per ad, the primary text's opening; the
headline supports it with a benefit or reason to act. (2) Offline run approved at a $1.00 cap. (3) `hookType` column on
`Creative` approved, set in code per variant, shapes that do not overlap the pillars; the shape list needs approval before
building.

**Offline run (claude-sonnet-5, VENZI dev data, read-only, no Meta).** Five angles from the library's saved concepts, the
draft as is against the current Creative Agent's single-variant path. Raw output: scratchpad
`hooks-run/side-by-side.md` and `results.json`. Spent $0.7314 of $1.00: current agent $0.0569 (5 calls), draft $0.2364
(5 calls), plus $0.438 for a first draft run that was discarded (all five calls stopped at the 8,000-token cap with
mostly missing text, likely thinking tokens; rerun with thinking disabled, as a forced tool call is in production).

Findings: the draft's 10 opening lines were all within 125 characters and none contained a banned phrase, but its finished
primary text was 379 to 493 characters (3 to 4 times the 125-character cap), one headline was 41 characters (cap 40), and
it asked for 6 to 8 verification items per angle that nothing consumes. The current agent's five outputs all fit the limits.
Opening shapes in the current outputs: 2 contrast, 2 plain statement, 1 question; no moment or direct-address shapes.

**Built (2026-11-06).** Phases 2 and 3 went into one PR: the five approved shapes (statement, question, contrast, moment,
address) in the cached system prompt, the assigned shape in the tail, `Creative.hookType` stored and returned and not yet
read. Two additions from the owner: address and moment never assert or imply a personal attribute, and the starting shape
comes from a hash of the campaign id plus the round number. See PRD.md and `docs/phase-7.md`. Phase 4 waits for data.

## Proposal: two explicit creative test modes (2026-11-08, not built)

The confounding noted above has a simple cause: the four ads share one image by accident. `create_creatives` preselects one
Feed and Story pair and gives it to every variant, and `select_creative` attaches the product's first photo to any ad that has
none, so a test labelled "creative test" varies avatar, concept, pillar and hook shape under one image, and a result by hook
shape cannot be separated from the others. The proposal is to make the tested variable explicit and single:

- **Copy test (`COPY`):** one chosen image for all four ads, only the copy varies. Four ads whatever the photo count.
  This is today's behavior, labelled, and the only kind of test whose hook-shape results are clean enough for Phase 4.
- **Visual test (`VISUAL`):** one copy set held constant, three or four distinct photos (or videos) of the product, enforced
  distinct on the server; one Creative Agent call instead of four.
- The "angle = image" test (each angle with its own visual) stays a later, deliberate third mode.

Slots in the table above this changes: the "available assets" row (the vision input stays the primary photo; the visual test does
not need the agent to see each image because the copy does not change with it) and the per-ad fields (a visual test fans one copy
set out to several `Creative` rows, each with its own `productImageId`). Full plan, order of work, tests and open questions:
`BACKLOG.md`, "Creative test modes".
