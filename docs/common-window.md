# Compare ads over a common window

Status: **decisions settled 2026-11-02; building on branch `common-window`.** No schema change,
no database writes beyond test databases, no paid calls.

Source: the first item in `BACKLOG.md`.

## The problem

Every place that ranks ads uses each ad's **lifetime** totals. An ad that went live earlier has had
more time to collect add-to-carts and sales, so it looks better than a later ad even at an equal
or worse cost. This only matters when ads do not start together (an ad added or replaced later in
a campaign); four ads published in one go already share a start.

## How per-ad totals are produced today

| Consumer | Where | Per-ad input | Uses it for |
| --- | --- | --- | --- |
| Dashboard table, leader, "Leading buyer" | `app/api/dashboard.py` `_campaign_snapshots` -> `dashboard.assemble_campaign` -> `build_tier3(ads, ad_totals(snapshots), ...)` | `ad_totals`: each ad's **latest** Metric row | `choose_leader`, the per-ad cost columns |
| Next-round results | `round_results.load_round_results` | The same `dash.ad_totals(...)` over the campaign's ad-level Metric rows | `build_round_results` calls `choose_leader`, then picks the "weakest" by cost; fed to the Strategist and `avatar_library_prompt` |
| Optimizer pause rules | `optimization_jobs._creative_test_ads` | Latest Metric row per ad (a separate query per ad) -> `creative_test_rules.AdSnapshot` | `evaluate_creative_test`: rule 1 (spent 2x target, no result), rule 2 (cost per add-to-cart >= 2x the best ad's), rule 3 (CAC >= 2x target); also `carousel_winner` (**most add-to-carts**, a raw count, so the most age-sensitive of all) |
| Optimizer LLM prompt | `optimization_jobs` ~L1495 -> `optimizer.AdPerformance` | Latest Metric row per ad | Lists each ad's spend, add-to-carts, cost per add-to-cart, CAC so the model can name one ad to pause |

Two consumers (dashboard and round results) already share `choose_leader`; the optimizer does
**not** use `choose_leader` and has its own copy of the "best ad" comparison (rule 2) and its own
query. `choose_leader` takes `(ad_id, Totals)` pairs and never looks at time.

## How metrics are stored per day

They are not. `Metric` holds **cumulative lifetime-to-date** figures as Meta reports them, one row
per ad per collection (`fetchedAt`), written by `_collect_ad_level_metrics` roughly **every 15
minutes** while the campaign is live (`collect_metrics_for_all_live_campaigns`). There is no daily
breakdown column, and no time-range query to Meta for ads (`fetch_ad_insights` is lifetime;
`time_range` is used only for the 7-day reach/frequency on the campaign row).

Consequences:

- A window total is a **difference of two cumulative snapshots**: `total(t_end) - total(t_start)`,
  where `total(t)` is the latest row with `fetchedAt <= t`. The optimizer already does exactly this
  for campaign-level trend windows (`compute_trend_windows`, `nearest_metric_at_or_before`).
- Rows are kept indefinitely (only deleted with the whole campaign, `campaign_lifecycle.py`), so
  history is available back to the first ad-level collection. Campaigns that ran before ad-level
  collection existed have no per-ad history and keep today's behaviour (see "Too little data").
- Counts are monotone in principle, but Meta revises recent attribution (late add-to-carts,
  purchases). A difference can come out slightly negative or odd; clamp each difference at 0.
- A nullable field (`addToCart`, `purchases`) is null when unavailable. Meta sends **no**
  add-to-cart or purchase figure until the ad has had its first one (`add_to_cart if actions else
  None` in `meta.py`), so a null on an *earlier* row means zero at that time. A null at the
  window's **end** stays null ("unavailable", never a silent zero).
- "When an ad went live" has no column. The honest proxy is the **first ad-level snapshot with
  impressions > 0** (precision is the 15-minute cadence). `Ad.createdAt` is the publish record, but
  an ad can be created paused or delayed, so delivery is the better evidence.

## Design

One new pure function in `app/services/ad_window.py`, used by every consumer (`Snapshot` and
`Totals` moved to `app/services/metric_rows.py` so it does not import the dashboard, which
imports it; `dashboard.Snapshot`/`dashboard.Totals` still work):

```
compare_ads(snapshots, *, min_hours) -> CommonWindow
CommonWindow(start, end, hours, per_ad: dict[ad_id, Totals], excluded: tuple[ad_id, ...],
             status: "ok" | "too_short" | "too_few_ads", min_hours)   # + .label, .too_short_reason
```

1. **Each ad's start** = the last snapshot *before* its first one with impressions > 0 (or, when
   its first stored row already shows delivery, just before that row; everything earlier counts as
   zero). **Each ad's last active time** = the last snapshot at which its impressions still
   increased (for a live ad, the newest snapshot). No ad status is needed: an ad that stopped
   delivering before the window began is simply one with no delivery in it.
2. **Window** = from the **latest start** among compared ads to the **newest snapshot**. The age
   bias comes from different start times, so a shared start is what removes it; a shared end for
   live ads is simply "now".
3. **Per-ad window totals** = cumulative at the window end minus cumulative at the window start,
   for every field `Totals` carries (impressions, spend, link clicks, landing page views,
   add-to-carts, checkouts, purchases, purchase value). The result is a `Totals`, so
   `choose_leader`, `build_round_results` and the table math work **unchanged**. Only the input
   changes ("change the input in one place", as the backlog says).
4. **Alignment.** Ad-level rows for one campaign are written in the same collection pass, within
   seconds of each other. Use the single window start/end timestamp for every ad ("latest row at
   or before t"), not per-ad day boundaries. Show the window to people as dates; compute it in
   timestamps. A calendar-day window would drop partial days and throw away data for no gain.
5. **Compared set.** An ad with no delivery in the window (paused before it began) is not ranked
   and is listed as excluded. Paused ads that were live inside the window stay in, measured over
   the part of the window they ran; their ratios stay valid, their counts are just smaller.
6. **Existing thresholds apply to window counts.** `choose_leader` still needs 10+ purchases per
   ad, else 5+ add-to-carts per ad, now counted inside the window. That is correct: those gates
   protect against noise, and the window numbers are the ones being judged.

### Where it plugs in

| Consumer | Change |
| --- | --- |
| Dashboard (`assemble_campaign`) | Call `common_window_totals` instead of `ad_totals` for the **ranking**; `build_tier3` gets the window and puts it on `Tier3` (`window_start`, `window_end`, `window_note`). |
| `round_results.load_round_results` | Same call. `RoundResults` gains the window so the Strategist text says the comparison covers e.g. "Oct 28 to Nov 2, when all four ads were live". `AdResult.spend/results/cost` become window values. |
| Optimizer rules and prompt | `_creative_test_ads` and the LLM-prompt query both switch to the same helper (one query for the campaign's ad-level rows instead of one per ad). Rule 2 and `carousel_winner` then rank on window values. Rule 1 (no result after 2x target spend) and rule 3 (CAC vs target) are **absolute** tests of one ad, not comparisons, so they keep **lifetime** numbers. |
| `Tier3Table` | Leader line shows the window ("Compared over Oct 28 - Nov 2"); see "Leading buyer". |

`choose_leader` itself is not changed. Keeping the optimizer and dashboard on the same helper
also removes the duplicate "best ad" logic's chance to disagree with the dashboard.

## Too little overlap

The minimum is `COMMON_WINDOW_MIN_HOURS` (setting, default **72**). When the window is shorter than that, or there are fewer than two ads with delivery in
it:

- **No leader**, and the message says why: "Not enough shared time yet: these ads have only run
  side by side for 14 hours" (today only "No clear leader yet", which would hide the cause).
- **No fallback to lifetime totals.** That would reintroduce the exact bias being removed.
- The optimizer's comparison rules (rule 2, `carousel_winner`) do not fire either, same as
  before the window is long enough. Absolute rules 1 and 3 still can.
- Campaigns with no ad-level history before the window (older data): window start is the first
  snapshot, which is also that ad's start, so they behave as one expects.
- A later-added ad **resets** the comparison for 72 hours: the leader can disappear until the
  new ad has run long enough. That is the honest outcome, but it is a visible change; worth
  telling the owner in the message ("a new ad was added on Nov 1").

## The "Leading buyer" line

`Tier3Table` finds the leader's ad and prints `Leading buyer: <avatar line>` from `adAvatarLine`.
The avatar mapping (ad -> creative -> buyerAvatarId, archived/inactive markers) is untouched, so
the line keeps working. What changes:

- The leader can be a **different ad** than today, so the buyer named can change. That is the
  point; in Snake-Ring-style data (an older ad vs. newer ones) the older ad's avatar may stop
  winning.
- The line should carry the window, otherwise it states a conclusion without its basis:
  `Leading buyer: ... (compared Oct 28 - Nov 2)`.
- When there is no leader, the line stays hidden (unchanged), and the leader line explains why.
- The Strategist prompt about the winning avatar uses the same `RoundResults`, so it stays equal
  to what the owner sees.

## Decisions (settled 2026-11-02)

1. **Table.** The cost columns (added to cart, cost per add to cart, sales, cost per sale) show
   **window** values. "Spent so far" and "Clicked the ad" stay lifetime. The window is labeled in
   the UI ("Compared over the last N days, while all ads ran") and in the "Leading buyer" line.
2. **Paused ads.** An ad with no delivery inside the window (paused before it began) is left out
   of the ranking and listed as not compared. An ad paused inside the window is compared over the
   part it ran.
3. **Minimum window: 72 hours**, a setting (`COMMON_WINDOW_MIN_HOURS`, default 72).
4. **Optimizer included.** Rule 2, `carousel_winner` and the LLM prompt use the window. Rules 1
   and 3 stay lifetime.
5. **Daily breakdown from Meta:** not now; added to `BACKLOG.md`.

## Meta's reporting lag and revised counts

Meta attributes a conversion to the ad **after** the click, sometimes a day or more later (and
for a longer click window), and it can revise recent numbers. Every `Metric` row is Meta's
cumulative figure *as reported at fetch time*, so late attributions simply show up in a later
snapshot. How the snapshot-difference approach behaves:

- **Revisions do not accumulate.** A window total is `cumulative(end) - cumulative(start)`: only
  two endpoints, never a sum of 15-minute increments. A revision made between the endpoints is
  already inside the later figure; a figure that is revised down cannot compound. Each fetch
  re-reads Meta's current cumulative number, so the next snapshot after a revision is correct.
- **A difference can still come out below zero** (a count revised down between the endpoints).
  It is clamped to 0 rather than shown as negative.
- **End edge:** the last day or so of conversions is under-reported for *every* ad. All ads share
  the same end, so each is affected the same way; the effect is a smaller share of a longer
  window, which is one more reason for the 72-hour minimum.
- **Start edge (residual bias):** a conversion from a click *before* the window start that Meta
  reports *after* it lands inside the window. An ad that ran before the shared start can have
  such spill-over; an ad that began exactly at the start has none. So the window removes most of
  the age advantage but not the last bit (about a day of lag at most). It is not corrected,
  because doing so would mean discarding a day of data from every comparison; it is documented
  here and the 72-hour minimum keeps it a minor share.
- The window is measured in our own snapshot times, not Meta's reporting days, so account time
  zones and Meta's "day" boundaries do not matter.

## Test plan

Backend, red first: window totals from two snapshots; ads that start at different times
(older ad's extra days excluded, **the headline test**: an older ad that leads on lifetime but
loses on the shared window); null fields stay null; negative differences clamp to 0; paused-before
and paused-inside cases; window shorter than the minimum gives no leader with the reason; fewer
than two ads; campaign with only campaign-level rows; dashboard and `load_round_results` return
the same leader for the same rows (the "stay identical" guarantee); optimizer rule 2 and
`carousel_winner` use the window; rules 1 and 3 unchanged; Snake-Ring-style data. Frontend:
`Tier3Table` window note, "Leading buyer" window text, no-leader reason, axe via
`analyzeWhenReady`. e2e with FAKE_META and seeded Metric rows; no paid calls. No schema change.

## Risks

- Delivery start inferred from snapshots can be off by up to one collection interval (15 min);
  immaterial against a 72-hour window.
- Smaller counts in the window mean fewer ads qualify for a leader sooner than lifetime would
  have named one. Honest, but the owner may notice "No clear leader" appearing more often.
- Meta attribution revisions can nudge window differences; clamping and the count gates absorb it.

## What was built

- `app/services/ad_window.py` (`compare_ads`, `CommonWindow`), `app/services/metric_rows.py`.
- Dashboard: `build_tier3(ads, lifetime, window, recs)`; `Tier3` gains `window_status`,
  `window_label`, `window_start`, `window_end`; `AdRow` gains `compared`. Setting
  `COMMON_WINDOW_MIN_HOURS` (default 72) in `app/core/config.py`.
- Next round: `round_results.load_round_results` uses the same window; `RoundResults` gains
  `window_label` and `no_leader_reason`, both passed to the Strategist in `results_lines`.
- Optimizer: `AdSnapshot` gains `window_*` fields; rule 2 and `carousel_winner` read them (rules 1
  and 3 still read lifetime); `AdPerformance.period` labels the pause prompt, which falls back to
  labeled lifetime numbers with a warning while the ads cannot yet be compared.
- Sample dashboard data now has 4 days of ad-level history so the dev preview ranks.
- Frontend: `Tier3Table` shows the label, explains which columns are lifetime, marks an ad "Not
  compared", and adds the period to the "Leading buyer" line.

Behaviour changes worth knowing: an ad paused before the shared window starts no longer blocks a
leader (it used to, with its lifetime numbers); a new ad added to a running test removes the
leader for up to 72 hours; the dashboard message for a window that is too short names the hours.
