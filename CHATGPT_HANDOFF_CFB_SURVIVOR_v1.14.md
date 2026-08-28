# CFB Survivor — ChatGPT Handoff / Start Here (v1.14.0)

**Current version:** v1.14.0
**Date:** August 28, 2026
**Prior context:** Originally started with ChatGPT. Developed further across many sessions with
Claude (Anthropic) through v1.10.1, then ChatGPT contributed a substantial round (v1.10.2 through
v1.11.0), then Claude again through v1.14.0. This document replaces the earlier
`CHATGPT_HANDOFF_CFB_SURVIVOR_v1.10.md` — read this one, not that one. There is also a
`CLAUDE_HANDOFF_v1.11.0.md` in the repo root (ChatGPT's own snapshot from its round of work); it's
now out of date and just points back to `HANDOFF.md`.

**Status:** Functional standalone prototype with SEC + Big Ten survivor pools, multiple entries,
authoritative full-season Splash schedules for both conferences, CFBD/SP+-derived probabilities,
a season planner, cross-device sync (no login — a short code), a what-if pick comparison tool, a
future-week scarcity indicator, a "Why this pick?" explanation panel, automatic result tracking
(win/loss, elimination, current-week detection from real game data), a real browser-driven test
suite (Playwright) alongside the original fast unit tests, and dedicated mobile UX with a recent
audit-and-fix pass.

## Product summary

A college-football survivor-pool decision tool with two separate pools in one application:

- SEC Survivor
- Big Ten Survivor

The pools share UI/data/model infrastructure, but entries and picks are isolated per pool and
per entry within a pool.

**Likely long-term direction:** merge Survivor into a larger product called PickGauge rather than
maintain this as a separate app. That merge has **not** happened and has not been planned in
detail — see "Not finalized" below. Cross-device sync was built standalone, explicitly ahead of
that integration decision, per an earlier explicit instruction not to wait on it. Every version
since has added more standalone infrastructure (results tracking, current-week detection, a real
test suite) that a future merge will need to reconcile or discard — this is a known, growing
tradeoff, not an oversight. **P1 (plan the PickGauge integration) is the single most overdue item
in the work queue** — it's been flagged as "increasingly overdue" for several versions running.

## Exact survivor rules

Both pools:
- One straight-up pick per week.
- A team may only be used once per entry, ever, for that pool.
- No double-pick weeks.
- Multiple entries per pool are allowed; each entry is independent (own name, own picks, own
  used-team list).
- SEC and Big Ten are entirely separate contests — nothing crosses between them.

### Critical eligibility rule

If a game is eligible for the selected pool, **either team may be selected** — not just the
conference member. A non-conference/"opponent" team becomes burned normally if selected.

### Authoritative Splash schedule (both conferences, full season)

Neither pool uses "every game involving a conference team." Both use an authoritative,
hand-transcribed schedule matching what SplashSports actually lists for that pool.

Source of truth:
- `data/sec-pool-schedule-2026.js` — **106 games**, all 13 weeks.
- `data/bigten-pool-schedule-2026.js` — **122 games**, all 13 weeks.

Both were transcribed from user-supplied screenshots **without a live CFBD API key** to verify
exact team-name spellings against CFBD's actual data. The matching logic
(`data/pool-schedule-utils.js`) degrades gracefully — an unmatched slot surfaces as a warning
rather than silently breaking other games — but **this has still never been re-verified against a
live CFBD key**. This remains the single highest-value data-accuracy task before trusting either
board for real picks (work queue P1.5, unchanged for many versions now).

## Repo structure

```text
/
├── api/
│   ├── _lib/
│   │   └── kv.js                       Upstash-REST-compatible KV client (hand-written)
│   ├── survivor-data.js                CFBD adapter, main data API
│   └── sync.js                         Cross-device sync API
├── css/                                 Split from one monolithic survivor.css (v1.12.0) —
│   ├── base.css                         order matters, index.html links all 6 in the exact
│   ├── board-rankings.css               sequence they appeared in the original file, so the
│   ├── planner-dialogs.css              cascade is unchanged. Verified byte-for-byte identical
│   ├── desktop-density.css              to the original when reconstructed before the split
│   ├── responsive-tablet.css            shipped.
│   └── responsive-mobile.css
├── data/
│   ├── bigten-pool-schedule-2026.js    Authoritative Big Ten Splash schedule (122 games)
│   ├── pool-schedule-utils.js          Shared schedule-matching engine (both conferences use it)
│   ├── pool-teams.js                   Single source of truth for SEC/Big Ten rosters
│   └── sec-pool-schedule-2026.js       Authoritative SEC Splash schedule (106 games)
├── js/
│   ├── app.js                          Coordinator: 4 view renderers, dialogs, boot, data loading
│   ├── state.js                        Shared state/els + core model accessors (v1.12.0 split)
│   ├── render-utils.js                 Pure formatting helpers, no state dependency (v1.12.0)
│   ├── sync-ui.js                      Entire cross-device sync subsystem (v1.12.0 split)
│   ├── results.js                      Win/loss/elimination + current-week detection (v1.11.0)
│   ├── survivor-score.js               Scoring, planner, what-if comparison, scarcity
│   ├── demo-data.js                    Synthetic preview data (?demo=1) + hasAuthoritativeSchedule()
│   ├── pools.js                        Re-exports data/pool-teams.js + TEAM_META (colors/abbrevs)
│   ├── storage.js                      localStorage persistence + sync-profile snapshot helpers
│   └── sync.js                         Frontend network client for /api/sync
├── tests/                              27 files: 26 test files + the shared browser-test harness.
│                                        Two kinds — see "Validation" below.
├── index.html
├── package.json                        devDependencies: playwright only. dependencies: none.
├── package-lock.json
├── vercel.json
├── .env.example
├── README.md                           User/developer-facing docs
├── HANDOFF.md                          Full version-by-version changelog + work queue (long,
│                                        authoritative — read this for anything this doc summarizes)
└── CLAUDE_HANDOFF_v1.11.0.md           Stale, points back to HANDOFF.md — ignore otherwise
```

`js/app.js` is still the largest file (~1000 lines, down from 1535 before the v1.12.0 split) and
holds the four view renderers (Season Board, Week Rankings, Season Plan, My Picks) plus the
matchup/entry dialogs. **Splitting those out is tracked as "architecture cleanup phase 2" and is
not started** — phase 1 (extracting `state.js`/`render-utils.js`/`sync-ui.js`) is done.

## Key file responsibilities

### `api/survivor-data.js`
Vercel serverless CFBD adapter. Applies whichever pool's authoritative schedule exists via a
`POOL_SCHEDULE_APPLIERS` lookup (SEC and Big Ten share one code path), direct CFBD pregame win
probability → SP+ fallback → spread fallback → `—`, two-sided selectable records, and
diagnostics/warnings including a generic "this pool's schedule is missing an entire week"
detector. `Cache-Control` is set per-request: `public, s-maxage=120` normally, `no-store` when the
client requests `?fresh=1` (manual refresh).

### `api/sync.js` + `api/_lib/kv.js`
Cross-device sync backend. No email/password — a random code (`ABCD-2345` format) is the entire
access model, deliberately, for a casual tool used by people who already trust each other.
`POST` creates a code seeded with the calling device's state; `GET ?code=` pulls; `PUT`
pushes/overwrites; `DELETE ?code=` permanently removes a code's data. Codes auto-expire after 180
days of no writes. All requests rate-limited per IP using the KV store itself as an atomic
counter (deliberately not in-memory — that silently wouldn't work across serverless instances).
`/api/sync` is never CDN/browser cached (`vercel.json` scopes the no-store rule specifically to
this route). Conflict handling is **last-write-wins with an explicit user choice on conflict** —
not a silent merge. If a device has unsynced local edits (a `dirty` flag) when it pulls and finds
the remote data has *also* changed, the sync dialog shows a real choice: "Keep this device"
(pushes local, discarding remote) or "Use synced copy" (applies remote, discarding local). There
is no field-level merge beyond that. `api/_lib/kv.js` is a small hand-written fetch client for
Upstash Redis's REST API (same protocol Vercel KV exposes), written by hand instead of adding an
SDK, to match this project's zero-npm-runtime-dependency style and stay testable by mocking
`global.fetch`.

### `js/sync-ui.js` (extracted from `app.js` in v1.12.0)
The entire sync subsystem: debounced push (900ms after any local change), pull-on-boot with
**hydration gating** (cloud pushes are blocked until the initial pull either succeeds or the user
resolves a conflict — this closes a real data-loss window that existed before v1.10.2), conflict
detection/resolution UI, the sync dialog's rendering and event handlers
(`bindSyncEvents()` — **must be called from `app.js`'s `bindEvents()`**, or every sync button
silently does nothing; this exact bug happened once during the v1.12.0 split and was only caught
by loading the page in a real browser), and the periodic automatic-results-refresh timer
(`startAutomaticResultRefresh()`, 5 minutes, paused when the tab isn't visible or in demo mode —
made defensively idempotent after a duplicate-call bug leaked a second polling interval in
v1.11.0/fixed in v1.11.1). Has a deliberate circular import with `app.js` (this module imports
`renderAll`/`renderEntryControls`/`loadData` back from it) — verified safe with native ES modules
since all circular usage happens inside function bodies, never at module top-level.

### `js/results.js` (added v1.11.0)
Pure logic, no DOM: `deriveCurrentPoolWeek()` (picks the "current" week from real game start
times/completion status, with a grace period before a stalled/postponed week is skipped rather
than blocking the whole season), `evaluateEntryStatus()` (ALIVE / NOT STARTED / MISSING PICK /
ELIMINATED, from actual picks + actual results), `pickResultFor()` (win/loss/tie/awaiting/upcoming
for a single pick, from `completed`/`teamPoints`/`opponentPoints`/`startDate` fields on a
matchup). **Important**: `js/demo-data.js` (`?demo=1`) never generates a `completed: true` game —
this means the entire results-tracking feature area (win/loss badges, elimination, "missing pick"
warnings) **cannot be seen through the normal demo preview at all**. It was invisible to normal
QA until a session specifically mocked `/api/survivor-data` directly to construct completed/scored
games and check it (see `tests/browser-results-status.test.js`) — it turned out to already work
correctly, both logically and on mobile, but be aware demo mode gives false reassurance here.

### `js/survivor-score.js`
Scoring, the season planner (`buildSeasonPlan()` — beam search maximizing remaining survival
probability, one-team-once enforced), what-if comparison (`compareWhatIf()` — reuses
`buildSeasonPlan()` by locking a candidate in for the current week), and future-week scarcity
(`seasonScarcity()` — counts teams ≥90% win probability per week; **display-only, not yet fed
into the actual scoring formula** — tracked separately as "P4-follow-up" since wiring it into
recommendations is a bigger, riskier change than the display feature). Also
`buildStrategicRecommendation()` and `buildPickExplanation()` (added v1.10.2–v1.11.0): "Best Play"
is the first pick of the planner's optimal remaining path, not just the highest raw win
probability for the current week, and it keeps recommending real model advice even for a week the
user already manually picked (locked picks are excluded from what Best Play itself considers).
`buildSeasonPlan()`'s beam search compares candidate paths **lexicographically**: fewer missing
(un-modeled) weeks always wins first, then more modeled weeks, then higher log-probability — a
real bug fix from v1.11.0, since a naive log-probability-only comparison let a beam path that
*skipped* a hard week (contributing exactly 0, same as a mathematically guaranteed win) outrank a
complete path with a real, lower-but-genuine probability for every week. `survivalProbability` is
`null` unless every future week has a real modeled pick; a separate `modeledSurvivalProbability`
covers partial coverage. This was independently reproduced and confirmed as a genuine
previously-real bug (not just accepted on faith) before being trusted.

### `js/state.js` / `js/render-utils.js` (both extracted from `app.js` in v1.12.0)
`state.js`: the shared mutable `state`/`els` objects plus core model accessors (`activePool`,
`activeEntry`, `syncActiveEntryState`/`syncStateToActiveEntry` — note these are two *different*
functions with opposite directions; a mix-up between them was a real bug caught once during the
split — `getDataWeeks`, `usedTeamsSet`, etc). `render-utils.js`: pure formatting helpers with no
state dependency (`escapeHtml`, `fmtPct`, `teamAvatar`, `matchupLabel`, `probabilityClass`, etc).

### `data/pool-teams.js`
Single source of truth for SEC (16 teams) and Big Ten (18 teams) membership, conference display
name, and CFBD conference abbreviation (`SEC`, `B1G`). Imported by both `js/pools.js` (browser)
and `api/survivor-data.js` (server) — used to be duplicated and could drift; fixed in v1.8.2.
**Edit team membership only here.**

## CFBD data architecture

Frontend endpoint: `/api/survivor-data?year=2026&pool=sec|bigten`. Env var: `CFBD_API_KEY`,
never exposed client-side. Conference filter: SEC → `SEC`, Big Ten → `B1G`.

### Win probability hierarchy
1. CFBD Pregame WP (direct)
2. SP+ derived (HFA = 2.5 points, margin SD = 16.0, normal-CDF transform, capped ~1%-99%) — an
   app-owned approximation, **never calibrated against real historical accuracy** (work queue P7,
   unchanged for many versions).
3. Spread derived
4. Unavailable → `—` (never coerce missing data to `0%`)

### Two-sided normalization
Every eligible game creates two independently selectable survivor sides. Season Board stays
anchored to conference-team rows; Week Rankings, Best Play, Season Plan, and the what-if
comparison tool can surface either side.

## Current views

- **Season Board** — full-season grid. Week headers click-to-sort by that week's probability
  (click again to restore canonical order — has real browser test coverage, not just regex).
- **Week Rankings** — ranks both sides of every eligible game for the focused week. "+ Compare"
  toggle per row (up to 4 at once) opens a what-if panel: full remaining-season survival
  probability if that pick is locked in now, sorted with deltas from the best option.
- **Season Plan** — the planner's recommended remaining path, plus a "Future-week difficulty"
  strip (Easy/Medium/Hard/Very Hard per week, display-only per the P4-follow-up note above).
- **My Picks** — manual pick tracker, entry rename/delete, used-team history, **and now
  per-pick win/loss/tie result badges** once games complete (v1.11.0).
- **Entry status bar** (new chrome element, v1.11.0) — ALIVE / NOT STARTED / MISSING PICK /
  ELIMINATED, shown at the top of every view.
- **"Why this pick?"** (v1.10.2, toggle on the Best Play card) — four factors: Safety (rank +
  margin vs. next-safest option), Future Cost (what you'd give up saving this team), Season Path
  (how this pick fits the planner's best complete path), Future Scarcity (how hard the hardest
  remaining week gets after using this team here).

## Cross-device sync

Sync button (⇄) in the header. No accounts — a short code generated on one device, entered on
others. Debounced push after any local change; pull on boot and when linking a new device. Codes
auto-expire after 180 days of no writes; "Delete synced data everywhere" removes a code's data
immediately (distinct from "Stop syncing this device," which only forgets the code locally).
**Conflict resolution is real and tested**: if a device has local edits and the pull finds
different remote data, the user gets an explicit "Keep this device" / "Use synced copy" choice —
verified end-to-end with a real browser test (`tests/browser-sync-conflict.test.js`) including the
specific failure mode of "Keep this device" accidentally pushing the *rejected remote* profile
instead of the local one. Requires `KV_REST_API_URL`/`KV_REST_API_TOKEN` (add "Vercel KV" in the
Vercel dashboard's Storage tab); without them, sync fails clean with a 503, rest of the app
unaffected.

## Validation

Two tiers, both under `npm`:

```bash
npm run check          # fast — syntax checks + ~27 test files, no browser, sub-second-ish per file
npm run check:browser  # ~48s — 6 files, 16 real Playwright-driven test scenarios (see below)
npm run check:all      # both, in sequence — run this before shipping any UI-facing change
```

**Why both exist**: `npm run check` passing does **not** prove the app actually works — several of
its test files (`mobile-ux.test.js`, `grid-sort.test.js`, `p1-p2-ui.test.js`, `results-ui.test.js`,
`sync-safety.test.js`) verify behavior by regex-matching source/CSS text, which can only prove
certain strings exist in a file, not that the app runs correctly. This is a known, explicitly
accepted limitation for the properties they still cover — but for the highest-risk areas, real
browser tests now exist instead:

- `tests/browser-harness.js` — shared harness (`withBrowserPage()`, `assertNoErrors()`): spins up
  a plain Node `http` server for the project's static files (ES modules need a real `http://`
  origin — `file://` breaks module imports under CORS) and a Playwright Chromium page per test.
- `tests/browser-sync-conflict.test.js` — the full conflict-resolution flow, both resolution paths,
  plus a false-positive guard.
- `tests/browser-grid-sort.test.js` — real DOM order verification (not just "did it change").
- `tests/browser-mobile-ux.test.js` — real rendered measurements at 390px: horizontal-scroll
  containment, real touch-target sizes, and a regression guard for the `skeleton-block` layout bug
  below.
- `tests/browser-why-pick.test.js` — the explanation panel actually opens/closes with real content.
- `tests/browser-results-status.test.js` — win/loss/eliminated/missing-pick states, via directly
  mocking `/api/survivor-data` (necessary since demo mode can't produce these — see `results.js`
  above).
- `tests/browser-dialogs.test.js` — the reset-entry confirmation guard (Cancel truly leaves picks
  untouched, Confirm truly clears them) and collapsible sections.

**Every one of these was verified against a real injected bug** (temporarily break the thing it
tests, confirm the test fails, revert, confirm it passes) before being trusted — this caught a
flawed assertion in one of the tests itself once (see HANDOFF.md's v1.14.0 entry). If you add more
browser tests, follow the same discipline; a test that's never seen the failure it's supposed to
catch hasn't been proven to catch anything.

`playwright` is a **devDependency only** (confirmed `dependencies` is empty in `package.json`) —
zero effect on what ships to Vercel or to the browser running the app. On a fresh clone, Chromium
may need `npx playwright install chromium` once after `npm install`.

## A real mobile bug worth knowing about (fixed in v1.14.0, but the pattern could recur)

The Best Play card (`#heroRecommendation`) had a stale `skeleton-block` CSS class baked into the
static `index.html` from first paint, never removed once real content replaced the loading text
(`app.js`'s own render calls only replace `.innerHTML`, never touch `.className`). `.skeleton-block`
sets `display: flex`, which silently forced the card into a broken side-by-side layout — squeezing
team names/badges to near-zero width, worst on mobile but present at every breakpoint. If you ever
see cramped/overlapping text in a card that has both a "loading" and a "loaded" state, check
whether a loading-only class survived into the loaded state — `getComputedStyle(el).display` in
the browser console is the fast way to check, not guessing from a screenshot.

## Recommended work queue

Full detail and rationale for everything below is in `HANDOFF.md`, organized by version — read it
before starting work, not just this summary.

### Already done (do not redo without a specific reason)
- P0 — Cross-device sync (v1.9.0), hardened (v1.10.1), reliability fixes (v1.10.2)
- P2 — "Why this pick?" (v1.10.2)
- P3 — What-if comparison (v1.10.0)
- P4 — Future-week scarcity, display-only (v1.10.0)
- P5 — Automatic result tracking + current-week detection (v1.11.0)
- P8 — Sync hardening: TTL, delete endpoint, rate limiting (v1.10.1)
- P9 — Real browser-driven test coverage for the highest-risk areas (v1.13.0, v1.14.0)
- Architecture cleanup phase 1 — `state.js`/`render-utils.js`/`sync-ui.js` extracted (v1.12.0),
  `survivor.css` split into 6 files (v1.12.0)
- A real mobile layout bug (stale `skeleton-block` class) found and fixed (v1.14.0)

### P1 — Plan the PickGauge integration
**Most overdue item.** Every version since v1.9.0 has built more standalone infrastructure (sync,
results tracking, current-week detection, a whole second test suite) that a future merge needs to
reconcile or discard. No plan exists yet for what happens to any of it.

### P1.5 — Verify both schedules against live CFBD
Still unverified against a real key. Unchanged for many versions.

### Architecture cleanup phase 2 — Split the four views + dialogs out of app.js
Not started. Same approach as phase 1 should work (the foundation — `state.js`/`render-utils.js`
— already exists). **Use `npm run check:browser` during this work**, not just manual clicking —
phase 1 caught 3 real integration bugs purely through live-browser verification that
`npm run check` alone did not catch, including one with zero console output at all.

### P4-follow-up — Feed future-week scarcity into actual scoring
`seasonScarcity()` is currently display-only. Wiring it into `futureProfile()`/`survivorScore()`'s
weighting changes what the app actually *recommends* — deliberately kept as its own item rather
than bundled into the display feature.

### P6 — Entry/pool status summary
Not started, not yet scoped beyond the original placeholder.

### P7 — Model calibration
HFA, margin SD, SP+→WP mapping, Survivor Score weights — all still starting points, never
validated against real historical accuracy (e.g. a Brier-score backtest against a past season).

### P9 remainder — Replace the rest of the regex-based test assertions
Not fully done by design (highest-risk gaps were prioritized). `mobile-ux.test.js`,
`grid-sort.test.js`, `p1-p2-ui.test.js`, `results-ui.test.js` still have some text-matching checks
for lower-risk properties.

## Not finalized — do not assume any of these are decided

- Auth provider or DB provider beyond what's already built (sync-code + KV)
- Exact PickGauge merge timing or plan
- Final Survivor Score weights
- Final SP+ calibration
- Whether future-week scarcity gets wired into scoring (display-only for now, deliberately)
- Monetization
- Automatic Splash import (schedules are hand-transcribed, not fetched)
- Whether last-write-wins-with-a-conflict-choice stays acceptable at higher usage (the current
  design; a genuine field-level merge was explicitly considered and deferred as out of scope, not
  rejected forever)

## Startup procedure for whoever picks this up next

1. Read this document fully, then `HANDOFF.md` for full version-by-version detail on anything
   summarized above, then `README.md` for user-facing feature descriptions and setup.
2. Check the "already done" list above before proposing a feature — confirm it isn't already
   built before building it again.
3. Run `npm run check:all` and confirm everything passes before making changes, so you know your
   starting point is clean. (`npm run check` alone is not sufficient — see "Validation" above for
   why.)
4. For any UI-facing change, run `npm run check:browser` and/or add to it, and also actually look
   at the rendered result in a browser at both desktop and mobile widths — not just trust that
   tests passing means it works. This project's own history has repeatedly found real bugs (a dead
   sync dialog, a broken circular import, a mixed-up function name, a stale CSS class squeezing
   mobile text to nothing) that only live verification caught, several of them with zero console
   output to hint anything was wrong.
5. If you add a new test — especially a browser test — verify it actually catches a regression by
   temporarily breaking the thing it tests and confirming the test fails, then revert. A test
   that's only ever been run against correct code hasn't been proven to catch anything.
6. Preserve: the 106-game SEC schedule, the 122-game Big Ten schedule, two-sided eligibility,
   entry/pool isolation, the shared team-roster/schedule-matching infrastructure, the sync-code
   security model's scope boundaries (don't quietly expand it into real auth without discussing
   it), and the "Not finalized" list above (carry it forward verbatim in any doc update, don't let
   it quietly drop).
7. Update `HANDOFF.md` with a new version entry for whatever you change, following the existing
   format (what changed, why, what was tested — including whether you verified live and whether
   new tests were checked against an injected bug — and what's still open). This document and that
   one are how the next session picks up context without re-deriving it from scratch.
