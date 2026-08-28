# CFB Survivor — SEC + Big Ten

## v1.20.0 — Data-issue protection + authoritative-season guard

- Added a first-class **DATA ISSUE** entry/result state. If a saved pick cannot be matched to the loaded authoritative game data, the entry is no longer allowed to appear `ALIVE`; the status identifies the affected week/team, My Picks shows a data-issue badge, and Plan Survival is withheld until the mapping issue is resolved. A known loss still remains authoritative and keeps the entry `ELIMINATED`.
- Removed the unsupported **2025** mode. The UI now exposes only 2026, the API rejects unsupported seasons with HTTP 400 before calling CFBD, demo mode refuses unsupported years, and old local/cloud snapshots that still contain `season: 2025` are automatically normalized to 2026.
- Added `data/survivor-config.js` as the single supported-season source of truth plus regression coverage for old-state migration and fail-closed API behavior.

## v1.19.0 — Safer sync linking + compact entry summary

- Linking an existing sync code no longer immediately overwrites a device that already has saved picks. The app first fetches the synced copy, shows local-vs-cloud pick/entry counts, and requires an explicit **Use synced copy & link** confirmation. **Cancel** leaves local data untouched. Empty devices keep the fast one-step link path.
- Initial linking deliberately never offers to overwrite the existing cloud copy with local picks; to preserve local picks, cancel and create a new sync code from that device instead.
- Expanded the always-visible entry status bar into a compact pool/entry summary: record, actual pool week, current pool-week pick, teams used through the current pool week, sync state, plus a separate Viewing W# chip when researching another week.
- Added fast regression tests plus Playwright scenarios for both initial-link safety and the mobile entry summary.

## v1.18.0 — Architecture cleanup phase 2

- Extracted the four main view renderers from `js/app.js` into `js/views/season-board.js`, `week-rankings.js`, `season-plan.js`, and `my-picks.js`.
- Extracted matchup-dialog rendering into `js/dialogs/matchup-dialog.js` and shared entry-control rendering into `js/entry-controls.js`.
- Removed the old `app.js ↔ sync-ui.js` circular ES-module dependency. `sync-ui.js` now receives `renderAll`/`loadData` callbacks once through `configureSyncUI()` at boot.
- `js/app.js` is now ~700 lines and acts primarily as the coordinator for data loading, top-level status/recommendation chrome, event wiring, and boot.
- No survivor rules, scoring weights, planner algorithm, data model, or user-facing behavior changed in this release.
- Added an architecture regression test and expanded existing source-bundle tests so moved logic stays covered.


## v1.17.0 — CI + Data Health

- Added GitHub Actions CI with separate fast-test and Playwright browser-test jobs on pushes and pull requests.
- Added a compact expandable **Data Health** strip showing Splash schedule match coverage, selectable-side probability coverage, results source state, and latest generation time.
- Expanded Data Health details show WP/SP+/Line/Missing counts, unmatched Splash games, and current backend warnings.
- Demo mode now exposes production-shaped coverage metadata so the health UI can be reviewed without a live CFBD key.

## v1.16.0 — Exact season path + clearer entry states

- Season Plan / Best Play now use an **exact assignment optimizer** rather than an 800-state beam
  approximation. It finds the globally best modeled remaining path while enforcing one team per
  week and one use per team. The planner still prioritizes complete model coverage before raw
  probability.
- The Season Plan coverage line now identifies the **Exact optimizer**.
- Entry status now shows **PICK NEEDED** whenever the active pool week needs a selection.
- A fully completed undefeated entry now shows **SURVIVED** with Plan Survival = 100% and a final
  season-success card instead of another pick recommendation.
- Missing the final completed pool week is now detected correctly.

## v1.15.0 — Season Board now reflects either-side survivor eligibility

- Every populated Season Board cell now shows **both selectable teams**, each side's spread and
  win probability. `★` marks the best currently selectable modeled side in that game.
- Clicking a Week header now sorts by the **best selectable side in each game**, not merely the
  conference team's probability. If the conference team is a 20% underdog but its opponent is an
  eligible 80% favorite, that row sorts as an 80% survivor opportunity.
- Previously burned teams are excluded from the sort opportunity and visually dimmed in the cell.
- The grid remains anchored to conference-team rows so the full conference schedule is still easy
  to scan.

## v1.14.0 — P9 completion + a real mobile UX fix

- Found and fixed a real mobile layout bug while doing a full visual audit at 375px: the "Best
  Play this week" card had a stale `skeleton-block` CSS class left over from its loading state,
  never removed once real content rendered. That class set `display: flex` on the whole card,
  silently squeezing team names and badges to near-zero width — worst on mobile, but present at
  every screen size once you knew to look for it. Fixed with a one-line HTML change; verified
  clean at 375px, 620px, and 1280px.
- Finished the P9 test-suite work: 3 more real browser test files — "Why this pick?" (previously
  untested), entry status + win/loss result tracking (previously *impossible* to visually check
  at all, since demo mode never generates a completed game), and the reset-confirmation/
  collapsible-section interactions. 6 files, 16 test scenarios total under `npm run check:browser`.
- Every new test verified against a real injected bug, including a case where that process caught
  a flawed assertion in a brand-new test itself before it shipped — see `HANDOFF.md`'s v1.14.0
  entry for the specifics.

## v1.13.0 — Real browser-driven interaction tests (P9)

- Added a real Playwright test harness (`tests/browser-harness.js`) and 3 new test files (8
  tests) that actually drive the app in a browser, instead of only checking that certain text
  patterns exist in the source — the previous `mobile-ux.test.js`/`grid-sort.test.js` approach.
- Coverage priority: the cross-device sync conflict-resolution flow (previously the
  weakest-covered, highest-stakes feature — verified only by hand across many earlier sessions),
  Season Board week-sort (confirms actual DOM reordering, not just "something changed"), and
  mobile touch-target/layout measurements at a real 390px viewport.
- Every new test was checked against an intentionally-injected bug to confirm it actually fails
  when it should, not just passes trivially — see `HANDOFF.md`'s v1.13.0 entry for specifics,
  including a case where writing the real test caught a wrong assumption in the test itself.
- New `npm run check:browser` (~26s) and `npm run check:all` (fast suite + browser suite).
  `npm run check` is unchanged and still fast for quick iteration. `playwright` is a
  **devDependency only** — zero effect on what ships to Vercel or to the browser running the app.
  Old regex-based tests were kept, not deleted, as a fast first-line smoke check.

## v1.12.0 — Architecture cleanup (phase 1): split app.js and survivor.css

- `js/app.js` (was 1535 lines) split into `js/state.js` (shared state + model accessors),
  `js/render-utils.js` (pure formatting helpers), and `js/sync-ui.js` (the entire cross-device
  sync subsystem). `app.js` is now ~1000 lines and holds the four view renderers, dialogs, and
  boot sequence — that phase-2 extraction was completed in v1.18.0.
- `css/survivor.css` (was 1656 lines) split into 6 ordered files (`base.css`,
  `board-rankings.css`, `planner-dialogs.css`, `desktop-density.css`, `responsive-tablet.css`,
  `responsive-mobile.css`). Verified byte-for-byte identical to the original before ever touching
  rendering, so this carries zero visual risk.
- No behavior change intended anywhere in this pass — see `HANDOFF.md`'s v1.12.0 entry for three
  real integration bugs the *process* of splitting caught (all only visible via live-browser
  testing, not the automated test suite), and how they were found and fixed before shipping.

## v1.11.1 — Bug fix from a review pass on v1.11.0

Fixed a leaked polling interval: the sync dialog's "Retry" button accidentally started a second
automatic-results-refresh timer on top of the one already running from page load, and since
neither was ever tracked or cleared, every retry click stacked another one — multiplying CFBD
polling and re-renders the longer a session ran. See `HANDOFF.md`'s v1.11.1 entry for the full
review (a diff against v1.10.1, plus live-browser verification of the sync conflict flow and
"Why this pick?" — both confirmed working correctly, not just present in the test suite).

## v1.11.0 — Automatic results + current pool week

- Saved survivor picks now receive automatic **W/L + final score** from the existing CFBD `/games` data already used by the app.
- Each entry now shows **PICK NEEDED, ALIVE, ELIMINATED, AWAITING RESULT, MISSING PICK, or SURVIVED**, plus its tracked record.
- The natural landing week is derived from kickoff dates + completion state, so a stale postponed/canceled game cannot hold the app on an old week forever.
- Results refresh automatically every five minutes while the page is visible. The Refresh button bypasses shared caching for an immediate CFBD re-check.
- This deliberately reuses the CFBD result fields so a future PickGauge integration can share PickGauge's CFBD data layer rather than introduce a second score provider.


## v1.10.4 — One strategic recommendation source

- **Best Play now comes from the Season Planner**, not the standalone Survivor Score heuristic.
- The planner’s first current-week pick is the authoritative recommendation; the same path logic powers the Season Plan view.
- If you already made a current-week pick, Best Play still shows the model recommendation while Season Plan honors your actual locked pick.
- Week Rankings pin the planner recommendation first with a **Best path** badge; remaining options stay ordered by Survivor Score.
- Survivor Score remains visible as a secondary heuristic for quick comparison.
- **Why this pick?** now explains the planner-driven recommendation instead of warning that Best Play and the planner may disagree.
- Fixed a one-use edge case where a team locked for a future week was not reserved against earlier planner weeks.

## v1.10.3 — Safety fixes + Why this pick?

- **Reset confirmation:** clearing an entry's picks now requires an explicit confirmation.
- **Safer reconnects:** unsynced local changes persist across reloads. If cloud and local both may
  have changes, the sync dialog asks **Keep this device** or **Use synced copy** instead of
  silently overwriting either side.
- **Byte-accurate sync limits:** the 200 KB profile limit now uses real UTF-8 bytes; malformed
  sync-create payloads are rejected.
- **Why this pick?:** the Best Play card explains safety rank, future opportunity cost,
  season-path context, and future-week scarcity. As of v1.10.4, Best Play itself is driven by
  the same season planner rather than the Survivor Score heuristic.

## v1.10.2 — Reliability / sync safety

- Sync data is now explicitly `private, no-store`; CFBD survivor data keeps its separate shared cache.
- A linked device cannot push cloud data until its initial cloud pull succeeds, closing a stale-local-state startup race. Failed hydration stays write-blocked and can be retried from the sync dialog.
- Cross-device sync now sends only durable survivor data (entries, names, picks, season). Active pool/entry/focused week stay local to each device, so browsing doesn't create remote overwrites.
- Season Plan now tracks model coverage. Missing weeks are never treated like 100% wins: incomplete paths show **Modeled path survival** plus `X/Y weeks modeled`, while the full-path survival metric remains blank until coverage is complete.

## v1.10.1 — Sync hardening

- Abandoned sync codes now auto-expire after 180 days of no changes (refreshed on every sync, so
  active codes never come close).
- New "Delete synced data everywhere" action in the sync dialog — permanently removes a code's
  data immediately, with an explicit confirmation naming the code. Distinct from "Stop syncing
  this device," which only forgets the code locally.
- All sync requests are now rate-limited per IP (backed by the KV store itself, so it actually
  works across serverless instances — not an in-memory counter that would silently do nothing in
  production).
- Last-write-wins conflict handling is unchanged — see `HANDOFF.md`'s v1.10.1 entry for why real
  conflict resolution stayed out of scope for this pass.

## v1.10.0 — What-if comparison + future-week scarcity

- **What-if comparison (P3)**: select 2-4 teams on Week Rankings ("+ Compare") to see each
  one's full remaining-season survival probability if picked now, sorted best-to-worst with the
  gap from the top option — not just this week's win probability, but "this pick, then optimal
  play after."
- **Future-week scarcity (P4)**: Season Plan now shows a "Future-week difficulty" strip — how
  many teams are 90%+ favorites each remaining week (Easy/Medium/Hard/Very Hard), so it's clear
  which weeks are worth saving a strong team for.
- Fixed the demo data's win-probability model along the way — it previously couldn't produce
  realistic blowouts, which made the new scarcity strip look uninformative in demo mode
  specifically (no effect on real CFBD-backed data). See `HANDOFF.md`'s v1.10.0 entry for detail.

## v1.9.0 — Cross-device sync

- The same entries and picks now show up on your phone, laptop, or any other device.
- No email/password: sync uses a short code (like `ABCD-2345`) — generate one on a device, enter
  it on your other devices to link them. Anyone with the code can view and edit, so treat it like
  a shared document link, not a password.
- New header button (⇄) opens the sync dialog: enable sync, link with an existing code, copy the
  code, or stop syncing this one device (without affecting other linked devices or deleting the
  synced data).
- Requires "Vercel KV" (or any Upstash-compatible Redis) added to the project — see Vercel setup
  below. Without it, sync is simply unavailable and the rest of the app works exactly as before.
- Conflict handling is last-write-wins, not merged — see HANDOFF.md for the full design
  rationale, including why this was built as a standalone sync code rather than real accounts.

## v1.8.3 — Authoritative 2026 Big Ten Splash schedule

- The Big Ten Survivor board now uses the exact 122-game, all-13-weeks schedule supplied from
  the Splash pool, the same way SEC has since v1.7 — only listed games are eligible, not every
  game involving a Big Ten team.
- Weekly game counts: `14, 15, 11, 9, 8, 8, 7, 6, 9, 8, 9, 9, 9`.
- The header chrome ("Splash schedule" badge) now correctly reflects Big Ten too — it was
  previously hardcoded to only show for SEC.
- If a pool's authoritative schedule is ever missing an entire week, the app now warns about it
  instead of silently rendering an empty week (this fired for Big Ten's Week 11 until it was
  supplied; the check is generic and applies to any future pool/year).

## v1.8.2 — Shared team roster source of truth

- SEC and Big Ten team rosters now live in one file, `data/pool-teams.js`, imported by both
  the frontend and the API. Previously each maintained its own hardcoded copy of the same team
  lists, which could silently drift out of sync on a realignment change or typo fix.
- Added `tests/pool-teams.test.js` to guard against that drift returning.

## v1.8.1 — Season Plan locked-pick fix

- Fixed a bug where a locked pick (an already-made pick for an upcoming week) with no modeled
  win probability yet was dropped from the Season Plan as "skipped" and left out of the
  planner's used-team tracking, which could cause the planner to suggest that same team again
  later. Locked picks are now always honored and always mark their team as used.
- Renamed `storage.js`'s pool-wiping reset helper to `resetAllEntriesForPool` to make clear it
  clears every entry in a pool, not just the active one; the "Reset this entry's picks" button
  was unaffected (it already only touched the active entry).
- Added `tests/season-plan.test.js` regression coverage.

## v1.8 — Readable grid + click-to-sort weeks

- Increased Season Board typography on desktop and mobile without returning to the old oversized 72px rows.
- Desktop team names, matchup names, win probabilities, spread/source text, and week headers are all larger.
- Mobile grid text is also slightly larger while preserving the compact horizontal board.
- Clicking any **Week** header now sorts conference-team rows from highest to lowest win probability for that week.
- Missing probabilities sort to the bottom.
- Clicking the currently sorted Week header again restores the canonical conference-team order.
- The sorted header displays a downward arrow and accessible `aria-sort="descending"` state.
- Week-header sorting stays in the Season Board instead of unexpectedly navigating to Week Rankings.

## v1.7 — Authoritative 2026 SEC Splash schedule

- The 2026 SEC Survivor board now uses the exact 106-game schedule supplied from the SplashSports pool.
- Weekly game counts are: `10, 13, 11, 9, 6, 7, 7, 6, 5, 8, 8, 6, 10`.
- Games omitted by the Splash pool are excluded even when an SEC team participates (including omitted non-FBS matchups).
- Either side of every listed game remains selectable.
- CFBD is still used to attach game IDs, true home/away, kickoff, spreads, direct pregame WP, SP+ fallback, and line fallback to the listed pool games.
- If the conference-filtered CFBD schedule misses a listed game, the API supplements from the full regular-season schedule and then re-applies the authoritative Splash filter.
- Big Ten behavior is unchanged in v1.7.

A responsive college-football survivor-pool decision board with **two separate pools inside one app**:

- SEC Survivor
- Big Ten Survivor

Each conference pool supports **multiple independent entries**.

## Roadmap

Full prioritized work queue lives in `HANDOFF.md` (kept there, not duplicated here, so there's
one source of truth). Current top of the list: revisit the PickGauge integration plan now that
standalone sync exists (P1), and re-verify both conference schedules against a live CFBD key
before trusting them for real picks (P1.5).

## Pool rules

Both pools currently use the same rule format:

- Pick one team each week from a game involving the selected conference.
- Pick the team to win straight up.
- Each team can be used only once **within that entry**.
- If a game involves an SEC team (SEC pool) or Big Ten team (Big Ten pool), **either team in that game may be selected**.
- Non-conference and FCS opponents are valid picks when they are playing a member of the pool conference.
- No double-pick weeks.

SEC and Big Ten are isolated from one another. Inside each pool, every entry has its own picks and burned-team list. Switching entries immediately recalculates rankings, recommendations, and the season plan for that entry.

## Multiple entries

The header contains an **Entry** selector next to the Pool selector.

- Click `+` to create another entry in the active conference pool.
- Switch entries from the header without reloading data.
- Rename the active entry from **My Picks**.
- Delete an entry from **My Picks**; at least one entry must remain in each pool.
- `Reset this entry's picks` clears only the active entry.
- Existing v1.3.x single-entry browser state migrates automatically into the first v1.4+ entry.
- If browser persistent storage is unavailable, the app falls back to in-memory session storage rather than failing to load.

Example state:

```text
SEC Survivor
├── Entry 1
│   ├── W1 Georgia
│   └── W2 Texas
└── Office Entry
    ├── W1 Alabama
    └── W2 Tennessee

Big Ten Survivor
├── Entry 1
└── Second Entry
```

## Main views

- **Season Board:** conference-member schedule by week with opponent, spread, model win probability, probability source, and entry state. Each cell opens a two-sided matchup chooser; both teams also appear independently in Week Rankings.
- **Week Rankings:** ranks **both sides of every eligible game**, including non-conference opponents. The planner’s **Best path** pick is pinned first; remaining options are ordered by Survivor Score while raw win probability, model source, and future value stay visible. Select 2-4 teams via "+ Compare" for full-path what-if analysis.
- **Season Plan:** searches across both sides of eligible games for a high-probability remaining path while enforcing one use per team for the active entry. Shows a future-week difficulty strip (Easy/Medium/Hard/Very Hard by how many 90%+ favorites remain each week) above the plan.
- **My Picks:** manual pick tracker, entry rename/delete controls, and used-team history.

## Cross-device sync

Local data (localStorage) is the source of truth for a single device. The sync button (⇄) in the
header links a device to a short code — enable sync on one device, enter the same code under
"Already have a code?" on another, and both devices show the same entries and picks going
forward. Pulls happen on load and when linking; pushes are debounced ~900ms after any change.

This is intentionally *not* a real account system — the code alone grants read/write access,
there's no email or password, and syncing is last-write-wins with no merge of concurrent edits
(see `HANDOFF.md`'s v1.10.1 entry for why real conflict resolution stayed out of scope). Codes
left untouched for 180 days expire automatically; "Delete synced data everywhere" in the sync
dialog removes a code's data immediately instead of waiting on that. All sync requests are
rate-limited per IP.

Requires `KV_REST_API_URL` / `KV_REST_API_TOKEN` (see Vercel setup below); without them, the
sync button still appears but any sync action fails with a clear "not configured" message rather
than breaking the rest of the app.

## Data and model hierarchy

The browser calls one Vercel endpoint:

`/api/survivor-data?year=2026&pool=sec`

or

`/api/survivor-data?year=2026&pool=bigten`

The server uses the `CFBD_API_KEY` environment variable. The API key is never placed in frontend code.

Schedule/line requests use CFBD conference abbreviations:

- SEC: `SEC`
- Big Ten: `B1G`

If a conference-filtered schedule unexpectedly returns no games, the API automatically falls back to the full regular-season schedule and filters it to games involving the canonical pool team list. This keeps non-FBS opponents eligible too.

Win probabilities use this hierarchy:

1. **CFBD Pregame WP** — `/metrics/wp/pregame`, when CFBD has a direct probability for the game.
2. **SP+ Derived** — when direct WP is missing and both teams have `/ratings/sp` ratings. The tool uses SP+ rating differential, adds 2.5 points for a non-neutral home team, then converts projected margin to win probability using a 16.0-point college-football margin standard deviation.
3. **Spread Derived** — when direct WP and complete SP+ ratings are unavailable but a consensus betting spread exists.
4. **Unavailable** — shown as `—`. Missing API data is never converted to `0%`.

The API response includes a `coverage` object showing eligible games, selectable sides, and how many side-probabilities came from direct WP, SP+, spread fallback, or remain unavailable.

## Local preview

Open with `?demo=1` to use synthetic data. Example:

`http://localhost:3000/?demo=1`

Demo data is not the real schedule or real model output.

## Vercel setup

1. Push the repository to GitHub.
2. Import it into Vercel.
3. Add environment variable `CFBD_API_KEY`.
4. (Optional, for cross-device sync) In the project's Storage tab, add "Vercel KV." This
   automatically injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` — no manual entry needed.
   Any other Upstash-compatible Redis REST endpoint works too if you set those two vars yourself.
5. Redeploy.

No explicit `functions` declaration is required in `vercel.json`; Vercel automatically detects
`api/survivor-data.js` and `api/sync.js`. `api/_lib/kv.js` is a shared helper, not an endpoint —
the underscore-prefixed folder is Vercel's documented convention for excluding shared code from
automatic function routing.

## Validation

Run:

```bash
npm run check
```

This performs JavaScript syntax checks plus model/API and storage tests, including:

- null probabilities do not become 0%;
- SP+ projected-margin conversion;
- direct CFBD WP takes priority over fallbacks;
- spread fallback behavior;
- two-sided game eligibility, including non-conference opponents;
- Big Ten schedule normalization;
- Big Ten API requests use the `B1G` CFBD abbreviation;
- v1.3 single-entry state migrates into v1.4;
- multiple entries persist independently;
- SEC and Big Ten entry storage remains isolated.

`npm run check` is fast (text/syntax checks, no browser). Before shipping any UI-facing change,
also run:

```bash
npm run check:browser   # ~48s — 16 real Playwright test scenarios: sync conflict flow, grid sort,
                         # mobile UX, Why This Pick, results/win-loss tracking, dialogs
npm run check:all       # both, in sequence
```

`check:browser` actually drives the app in a real Chromium page (a local static server + a
Playwright browser per test) rather than checking source text for expected patterns — see
`HANDOFF.md`'s v1.13.0 entry for why that distinction matters (three real bugs in the v1.12.0
module split were only catchable this way, one of which produced zero console output at all).
`playwright` is a devDependency only; it doesn't ship with the app. On a fresh clone, run
`npx playwright install chromium` once after `npm install` if the browser binary isn't already
present.

## Repo structure

```text
/
├── api/
│   ├── _lib/
│   │   └── kv.js
│   ├── survivor-data.js
│   └── sync.js
├── css/
│   ├── base.css
│   ├── board-rankings.css
│   ├── desktop-density.css
│   ├── planner-dialogs.css
│   ├── responsive-mobile.css
│   └── responsive-tablet.css
├── data/
│   ├── bigten-pool-schedule-2026.js
│   ├── pool-schedule-utils.js
│   ├── pool-teams.js
│   └── sec-pool-schedule-2026.js
├── js/
│   ├── app.js                          Coordinator / boot / top-level chrome
│   ├── demo-data.js
│   ├── pools.js
│   ├── render-utils.js
│   ├── results.js
│   ├── state.js
│   ├── storage.js
│   ├── survivor-score.js
│   ├── sync-ui.js                      Cross-device sync orchestration
│   ├── entry-controls.js                Shared entry selector/name/delete rendering
│   ├── views/
│   │   ├── season-board.js
│   │   ├── week-rankings.js
│   │   ├── season-plan.js
│   │   └── my-picks.js
│   ├── dialogs/
│   │   └── matchup-dialog.js
│   └── sync.js
├── tests/
│   ├── bigten-schedule.test.js
│   ├── browser-dialogs.test.js
│   ├── browser-grid-sort.test.js
│   ├── browser-harness.js
│   ├── browser-mobile-ux.test.js
│   ├── browser-results-status.test.js
│   ├── browser-sync-conflict.test.js
│   ├── browser-why-pick.test.js
│   ├── data-model.test.js
│   ├── demo-realism.test.js
│   ├── grid-sort.test.js
│   ├── kv-client.test.js
│   ├── mobile-ux.test.js
│   ├── p1-p2-ui.test.js
│   ├── pick-explanation.test.js
│   ├── pool-teams.test.js
│   ├── recommendation-source.test.js
│   ├── results-api-cache.test.js
│   ├── results-current-week.test.js
│   ├── results-ui.test.js
│   ├── season-plan.test.js
│   ├── sec-schedule.test.js
│   ├── storage.test.js
│   ├── sync-api.test.js
│   ├── sync-client.test.js
│   ├── sync-safety.test.js
│   └── whatif-scarcity.test.js
├── index.html
├── package.json
├── vercel.json
├── README.md
└── HANDOFF.md
```


## v1.6 mobile UX

The mobile experience has a dedicated layout rather than compressing the desktop dashboard. Key changes:

- Two-row labeled mobile header for Pool, Entry, Season, add-entry, and refresh controls.
- Compact Best Play card with a stable team/probability row and a separate facts/action row.
- `Available this week` replaces the less actionable season-wide `Eligible left` metric.
- Compact expandable data warning instead of a large permanent banner.
- Season Board help text moved into a collapsible disclosure.
- Mobile Season Board has no nested vertical scroll; only horizontal table scrolling remains.
- Mobile grid rows reduced to 54px, conference column to 106px, week columns to 98px.
- Week Rankings use dedicated stacked mobile cards with score/future/model summary and full-width actions.
- Matchup dialog is pick-first on mobile: each eligible side has its own 44px pick action before model/future details.
- Readability floor increased for secondary mobile text and important controls are approximately 44px touch targets.
- Additional narrow-width refinements are included at 390px and below.

Use the bundled standalone preview to inspect the mobile layout before deployment.

### Data Health

The app shows a compact Data Health strip with authoritative schedule match coverage, selectable-side probability coverage, results source status and the latest generated timestamp. Expand it to see WP/SP+/Line source counts, unmatched Splash games and current data warnings.

### Continuous integration

`.github/workflows/ci.yml` runs both `npm run check` and the Playwright browser suite for pushes and pull requests. The browser job installs Chromium in GitHub Actions before running `npm run check:browser`.


### CFBD refresh cadence (v1.21.0)

Live result polling no longer reloads every model input. While the page is visible, the browser requests a lightweight `mode=results` payload every 5 minutes; that server path calls only CFBD `/games` and patches kickoff times, completion state, and scores into the existing board. Full model/line data refreshes every 30 minutes in the background; a failed background model refresh preserves the already-loaded board instead of blanking it. Normal full loads remain eligible for the API’s shared edge cache, while the header Refresh button forces a no-cache **results-only** refresh. This reduces normal automatic CFBD traffic from roughly 4 endpoint calls every 5 minutes to 1 game call every 5 minutes plus a full refresh every 30 minutes.
