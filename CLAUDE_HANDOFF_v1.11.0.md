# CFB Survivor — Claude Handoff / Start Here

> **This snapshot is from v1.11.0 and is now out of date** — v1.11.1 (a bug fix) and v1.12.0
> (architecture cleanup: `js/app.js`/`css/survivor.css` split into modules) shipped after it.
> `HANDOFF.md` in the repo root is the actively-maintained, authoritative changelog and work
> queue; read that first. This file is kept as a historical snapshot of the product/architecture
> overview as of v1.11.0 — most of the product-summary and rules sections below are still
> accurate, but anything about file structure or specific line numbers predates the module split.

**Current version:** v1.11.0  
**Date:** August 26, 2026  
**Deployment today:** Standalone Vercel project  
**Likely long-term direction:** Merge Survivor into PickGauge

Read this document first, then `HANDOFF.md`, then `README.md`.

---

## 1. Product summary

CFB Survivor is a college-football survivor decision tool with two separate pools:

- SEC Survivor
- Big Ten Survivor

The two pools share the same app/data/scoring infrastructure, but picks and entries are isolated.

Core views:

- Season Board
- Week Rankings
- Season Plan
- My Picks

The tool is already functional and should be treated as a working product, not a greenfield rewrite.

---

## 2. Exact pool rules — do not regress

Both pools:

- One straight-up pick per week.
- A team may only be used once per entry.
- No double-pick weeks.
- Multiple entries per pool are supported.
- SEC and Big Ten are separate pools.
- Entries within the same pool are independent.

### Critical two-sided eligibility rule

If a game is included in the pool schedule, **either team may be selected**, including a non-conference opponent.

Examples:

```text
SEC pool
Alabama vs USF
✓ Alabama
✓ USF
```

```text
Big Ten pool
Michigan vs Fresno State
✓ Michigan
✓ Fresno State
```

A non-conference opponent becomes burned normally if selected.

---

## 3. Authoritative Splash schedules

Do NOT infer eligibility from “conference team involved.”

Both pools use hand-transcribed SplashSports schedules supplied by the user.

### SEC 2026
File:

`data/sec-pool-schedule-2026.js`

- 106 total games
- Weeks 1–13
- Weekly counts:
  `10, 13, 11, 9, 6, 7, 7, 6, 5, 8, 8, 6, 10`

### Big Ten 2026
File:

`data/bigten-pool-schedule-2026.js`

- 122 total games
- Weeks 1–13
- Weekly counts:
  `14, 15, 11, 9, 8, 8, 7, 6, 9, 8, 9, 9, 9`

Correct rule:

```text
Is this game on the Splash schedule for this pool?
YES → eligible
NO  → excluded
```

Some conference-vs-non-FBS games are intentionally excluded because Splash does not list them.

### Important open task

These 228 games were hand-transcribed from screenshots and have **not yet been fully verified against live CFBD records**.

Highest-value data task remaining:

```text
SEC     106/106 matched
Big Ten 122/122 matched
missing = 0
```

Do not silently “fix” the schedule by adding CFBD games that are not on Splash.

---

## 4. Current deployment / CFBD setup

Survivor is currently a **separate Vercel project from PickGauge**.

It uses the user's existing CollegeFootballData API account/key, but the Survivor Vercel project must have its own environment variable:

```text
CFBD_API_KEY=<same CFBD key already used by PickGauge>
```

The two Vercel projects do not share environment variables automatically.

No second CFBD account/key is required.

### Current standalone flow

```text
Browser
   ↓
/api/survivor-data
   ↓
CFBD_API_KEY
   ↓
CollegeFootballData API
```

The key stays server-side.

### Long-term PickGauge rule

If Survivor is merged into PickGauge, **reuse PickGauge's existing CFBD data layer**.

Do not create or maintain a second independent results/schedule/model pipeline after the merge.

Preferred future flow:

```text
                 CFBD
                  ↓
         PickGauge data layer
            ↙            ↘
      Edge Board       Survivor
                       Results
```

This applies specifically to automatic results and current-week logic too.

---

## 5. Repo structure

```text
/
├── api/
│   ├── _lib/
│   │   └── kv.js
│   ├── survivor-data.js
│   └── sync.js
├── css/
│   └── survivor.css
├── data/
│   ├── bigten-pool-schedule-2026.js
│   ├── pool-schedule-utils.js
│   ├── pool-teams.js
│   └── sec-pool-schedule-2026.js
├── js/
│   ├── app.js
│   ├── demo-data.js
│   ├── pools.js
│   ├── results.js
│   ├── storage.js
│   ├── survivor-score.js
│   └── sync.js
├── tests/
├── index.html
├── package.json
├── vercel.json
├── .env.example
├── README.md
├── HANDOFF.md
└── CLAUDE_HANDOFF_v1.11.0.md
```

---

## 6. Key files

### `api/survivor-data.js`

Main server-side CFBD adapter.

Responsibilities include:

- retrieving CFBD games;
- matching authoritative Splash schedules;
- Big Ten conference code `B1G`;
- direct pregame WP;
- SP+ fallback;
- spread fallback;
- two-sided selectable records;
- game completion/final scores;
- fresh-result cache bypass.

### `js/results.js`

Added in v1.11.0.

Responsibilities:

- determine lifecycle of each pool week;
- derive natural current pool week;
- parse saved-pick W/L/final score;
- evaluate entry status.

Do not duplicate this logic elsewhere unless deliberately refactoring.

### `js/survivor-score.js`

Contains:

- Survivor Score heuristic;
- beam-search Season Planner;
- strategic Best Play source;
- what-if comparisons;
- future-week scarcity.

### `js/app.js`

Large central renderer/coordinator.

Handles:

- pool/entry switching;
- Season Board;
- rankings;
- planner;
- My Picks;
- Why this pick?;
- results/status UI;
- current week;
- dialogs;
- sync;
- refresh behavior.

This file is now large enough that future major work should consider modularization rather than continuing to pile unrelated logic into it.

### `js/storage.js`

Local persistence + multi-entry state + sync profile construction/application.

Cloud sync intentionally contains durable survivor data, not device navigation state.

### `api/sync.js`

Cross-device sync API using short codes.

---

## 7. CFBD probability model

Current hierarchy:

```text
1. CFBD Pregame WP
2. SP+ derived
3. Spread derived
4. unavailable → —
```

### Direct WP

CFBD pregame win probability is preferred when present.

### SP+ fallback

Current assumptions:

- HFA = 2.5 points
- margin SD = 16.0 points
- normal-CDF conversion
- roughly 1%–99% caps

These are app assumptions and have **not yet been historically calibrated**.

### Spread fallback

Used when direct WP and complete SP+ inputs are unavailable.

### Source labels

UI distinguishes:

- `WP`
- `SP+`
- `Line`
- `—`

Do not present SP+/line-derived values as direct CFBD probabilities.

### Historical bug to avoid

Never do this accidentally:

```js
Number(null) // 0
```

Missing probability must remain missing, not become 0%.

---

## 8. Strategic recommendation source

As of v1.10.4 there is one strategic source of truth.

### Best Play

Best Play comes from the same Season Planner that powers Season Plan.

It is **not** simply the highest Survivor Score.

Conceptually:

```text
candidate pick this week
        ↓
lock candidate
        ↓
optimize remaining season
        ↓
compare resulting survivor path
```

The first pick in the strongest plan is the authoritative model recommendation.

### Survivor Score

Still useful, but secondary.

Week Rankings:

- planner recommendation pinned first;
- labeled `Best path`;
- other teams still use Survivor Score for quick comparison.

### Manual current-week pick

If the user already chose a current-week team:

- Best Play continues to show model advice.
- Season Plan honors the actual user pick and optimizes forward.

Future locked picks reserve those teams correctly.

---

## 9. “Why this pick?”

Built in v1.10.3 and aligned to the planner in v1.10.4.

Explanation uses real model signals:

- raw WP/safety rank;
- future opportunity cost;
- full-season path context;
- future-week scarcity;
- Survivor Score as secondary context.

Do not replace this with generic AI prose. It should remain grounded in model outputs.

---

## 10. Automatic results — v1.11.0

Saved picks now automatically receive W/L + score from the existing CFBD `/games` data.

Relevant normalized fields include:

- `completed`
- `teamPoints`
- `opponentPoints`
- `startDate`
- `gameId`

Example My Picks display:

```text
W1 Alabama   W 38–17
W2 Texas     W 31–20
W3 Georgia   Upcoming
```

### Entry status

`js/results.js` currently supports:

- `ALIVE`
- `ELIMINATED`
- `AWAITING RESULT`
- `MISSING PICK`
- `NOT STARTED`

An eliminated entry should not continue to display a meaningful future survival probability as if still alive.

The app currently changes Plan Survival to `0%` for an eliminated entry, while allowing remaining tools to stay visible for research.

---

## 11. Current pool week — v1.11.0

Current week is no longer “first game with completed=false.”

It uses:

- authoritative Splash week numbers;
- CFBD kickoff dates;
- completion state.

### Lifecycle model

A week can be:

- empty
- upcoming
- active
- complete
- stale-incomplete

### Stale postponed/canceled protection

An old unresolved game should not strand the app on an old week forever.

Current default grace:

```text
30 hours after the week's latest listed kickoff
```

After that, an incomplete week can be considered stale and the natural landing week advances.

If CFBD changes the postponed game's `startDate`, the grace window moves with the rescheduled date.

### Viewing vs actual pool week

Keep these concepts separate:

- actual/natural pool week
- week the user is browsing

Users can research future weeks without changing the actual pool-week status.

---

## 12. Result freshness / caching — v1.11.0

Results recheck automatically every ~5 minutes while the page is visible.

Normal survivor-data reads use short shared caching to avoid unnecessary CFBD traffic.

Manual Refresh requests:

```text
fresh=1
```

and the API responds without shared caching so final scores can be rechecked promptly.

Do not reintroduce a blanket Vercel cache header covering every API route.

`/api/sync` must stay private/no-store.

---

## 13. Cross-device sync

Cross-device sync is already built.

Model:

- no email/password;
- generated short code like `ABCD-2345`;
- same code links devices;
- Upstash/Vercel-KV-compatible REST storage;
- 180-day inactivity expiry;
- explicit delete-everywhere;
- KV-backed IP rate limiting;
- normal successful concurrent writes are still last-write-wins.

### Safety already implemented

- `/api/sync` is no-store/private;
- startup pulls block cloud pushes until hydration completes;
- offline local edits persist across reloads;
- reconnect conflict asks:
  - Keep this device
  - Use synced copy
- actual UTF-8 payload byte limit;
- malformed sync-create requests rejected.

### Sync profile intentionally excludes device UI state

Cloud:
- pool data
- season
- entries
- names
- picks

Device-local:
- active pool
- active entry
- focused week
- sort/navigation state
- current view

Do not start syncing navigation state again.

---

## 14. Multiple entries

Each pool supports multiple independent entries.

Each entry has:

- id
- name
- picks

Used teams are derived from picks.

Pool/entry isolation is trust-critical.

A pick from SEC Entry 1 must never affect:

- SEC Entry 2
- any Big Ten entry

Resetting an entry requires confirmation.

---

## 15. Season Board / UI behavior

Season Board is the primary product surface.

Important UX decisions already made:

- dense but readable;
- sticky conference-team column;
- readable grid fonts;
- horizontal week scrolling;
- no nested mobile vertical table scrollbar;
- clicking a week header sorts that week's rows by displayed win probability;
- clicking the same sorted week restores canonical order;
- clicking a week header does not navigate away;
- mobile uses purpose-built layouts rather than compressed desktop tables.

### Explicit user workflow preference

For **every meaningful code/UI update**, always provide:

1. a preview first;
2. optional screenshots when useful;
3. the ZIP only after the preview is available;
4. a clear list of changed files.

The user should not need to ask for the preview.

---

## 16. Tests

Run before changing anything:

```bash
npm run check
```

The current package includes checks for:

- JS syntax;
- data normalization;
- SEC schedule;
- Big Ten schedule;
- pool/team consistency;
- storage/multiple entries;
- mobile source regressions;
- grid sorting;
- season planning;
- KV client;
- sync API/client/safety;
- what-if + scarcity;
- demo realism;
- pick explanation;
- recommendation source;
- automatic results/current week;
- result API caching;
- results UI.

### Known test-quality gap

Some older mobile/grid tests are regex/source inspections rather than actual browser interaction tests.

Real Playwright coverage remains worthwhile.

---

## 17. Current Vercel setup

Because Survivor is currently a separate project, configure the Survivor Vercel project itself.

Required for live CFBD:

```text
CFBD_API_KEY=<user's existing CFBD key>
```

Optional for cross-device sync:

```text
KV_REST_API_URL=
KV_REST_API_TOKEN=
```

Do not assume PickGauge's Vercel environment variables are inherited.

They are separate projects today.

---

## 18. Highest-priority remaining work

### P1.5 — Verify all 228 Splash games against live CFBD
Highest data-trust task.

Need a diagnostic result such as:

```text
SEC     106 / 106 matched
Big Ten 122 / 122 matched
missing 0
```

Verify:

- team aliases;
- home/away;
- week mapping;
- game IDs;
- start dates.

Do not change the Splash schedule merely to make CFBD matching easier.

### P9 — Real browser/Playwright regression tests
Add true interaction tests for:

- week sort;
- matchup dialog;
- mobile layout;
- multiple entries;
- pool isolation;
- result states;
- sync conflict flows.

### P7 — Model calibration
Still not done.

Backtest historical seasons:

- SP+ → WP conversion;
- HFA;
- margin SD;
- Brier score;
- log loss;
- calibration buckets;
- planner vs greedy highest-WP strategy;
- Survivor Score behavior.

### P4 follow-up — scarcity in scoring
Scarcity is currently informative/displayed.

Do not feed it into strategic scoring until model calibration supports doing so.

### P1 — PickGauge integration plan
Now increasingly important.

Before merging:

- inspect PickGauge's current auth;
- inspect PickGauge CFBD/data layer;
- reuse its team aliases/game objects/odds/results;
- decide whether short-code sync survives as guest mode;
- decide how Survivor entries map to PickGauge users;
- avoid duplicate CFBD calls/pipelines.

### Architecture cleanup
`js/app.js` and `css/survivor.css` are getting large.

Before/while merging into PickGauge, consider splitting major views/components rather than repeating PickGauge's prior giant-file problem.

---

## 19. Things not finalized

Do not assume decisions on:

- final PickGauge merge timing;
- whether short-code sync remains after account integration;
- final Survivor Score weights;
- final SP+ calibration;
- scarcity weighting;
- monetization;
- automatic Splash schedule import;
- long-term concurrent-edit conflict strategy.

---

## 20. Startup procedure for Claude

1. Read this file.
2. Read `HANDOFF.md`.
3. Read `README.md`.
4. Run:

```bash
npm run check
```

5. Inspect first:
   - `api/survivor-data.js`
   - `js/results.js`
   - `js/survivor-score.js`
   - `js/storage.js`
   - `js/app.js`
   - both authoritative schedule files
6. Confirm Vercel env context:
   - Survivor is separate from PickGauge today.
   - `CFBD_API_KEY` must exist in Survivor's Vercel project.
7. Preserve:
   - 106-game SEC Splash schedule;
   - 122-game Big Ten Splash schedule;
   - two-sided pick eligibility;
   - multiple-entry isolation;
   - planner-driven Best Play;
   - CFBD-based automatic results/current week;
   - no-store sync;
   - preview-before-ZIP workflow.
8. Update handoff/changelog for any version change.

---

## 21. Current feature summary

v1.11.0 includes:

- SEC Survivor
- Big Ten Survivor
- authoritative schedules for both
- two-sided eligibility
- multiple entries
- manual picks
- used-team enforcement
- CFBD schedules
- direct pregame WP
- SP+ fallback
- line fallback
- Season Board
- week probability sorting
- Week Rankings
- strategic Best Play
- Season Planner
- future-week scarcity
- what-if comparison
- Why this pick?
- cross-device sync
- sync conflict protection
- automatic W/L/final scores
- ALIVE / ELIMINATED / AWAITING RESULT / MISSING PICK / NOT STARTED
- result/date-driven current pool week
- stale postponed-game protection
- automatic visible-tab result refresh
- manual fresh CFBD refresh
- desktop + mobile UX
- regression test suite

The biggest trust item still open is **live CFBD verification of all 228 authoritative Splash games**.
