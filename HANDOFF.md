
## v1.21.0 — CFBD polling efficiency

- Added a lightweight `mode=results` path to `api/survivor-data.js`. It calls only CFBD `/games` and returns score/completion/kickoff patches; it never fetches `/lines`, `/metrics/wp/pregame`, or `/ratings/sp`.
- Automatic visible-tab refresh remains every 5 minutes but now uses that results-only path. Full model/line refreshes happen every 30 minutes instead of every 5 minutes. Those background refreshes are silent and non-destructive: if CFBD model data fails temporarily, the currently loaded board stays in place.
- Normal full-data requests no longer force browser `no-store`, so Vercel can use the handler’s shared cache. The header Refresh button now means **Refresh live results** and forces only the results path with `fresh=1`/`no-store`.
- Added `js/result-refresh.js` to merge result patches without touching probabilities, spreads, or planner inputs.
- Added separate model/result timestamps (`modelGeneratedAt`, `results.lastCheckedAt`) so a score refresh does not imply the probability model itself was recomputed.
- Added `tests/results-polling.test.js`, which asserts results mode makes exactly one CFBD call (`/games`) and preserves model/line fields when merged.
- Fast suite: `npm run check` passes.

# CFB Survivor — Current State (v1.20.0)

## v1.20.0 — DATA ISSUE state + remove unsupported 2025 mode

### Saved picks that cannot be mapped now fail visibly

`pickResultFor()` now returns `data-issue` when a saved pick has no matching selectable-side record for that pool week. `evaluateEntryStatus()` promotes that to a first-class **DATA ISSUE** state instead of falling through to `ALIVE`.

Behavior:
- a known prior loss still wins precedence and keeps the entry `ELIMINATED`;
- otherwise any unmapped saved pick makes the entry `DATA ISSUE`;
- the status detail identifies the first affected week/team and reports additional affected picks;
- My Picks shows `Data issue · matchup unavailable`;
- Plan Survival is withheld (`—`) until the mapping is resolved;
- Best Play can remain visible for research but is explicitly labeled `Research only · entry status unresolved`.

This closes the trust gap where an alias/schedule-data mismatch could make an entry look alive even though the tool could not actually evaluate one of its saved picks.

### 2025 generic-conference mode removed

The app only has authoritative SplashSports survivor eligibility for 2026. The old season selector exposed 2025, where the backend silently fell back to generic "any game involving a conference member" eligibility — a different contest rule.

v1.20.0 removes that path end-to-end:
- `index.html` exposes only 2026 and the single-season control is disabled;
- new `data/survivor-config.js` is the supported-season source of truth;
- `/api/survivor-data` rejects any unsupported season with HTTP 400 and `Cache-Control: no-store` **before** making a CFBD request;
- demo mode refuses unsupported seasons instead of fabricating a generic conference schedule;
- old localStorage and synced snapshots containing `season: 2025` normalize to 2026;
- new saved/synced state always writes the supported season.

### Validation

- Updated result/current-week tests for DATA ISSUE and known-loss precedence.
- Updated result UI assertions for the new status/result styling and research-only recommendation label.
- Extended the existing real-browser results-status suite with a DATA ISSUE scenario (source updated; Playwright execution depends on the local/CI Chromium environment).
- Reworked the API model fixture so 2025 now proves fail-closed behavior with zero CFBD fetches.
- Added `tests/season-support.test.js` for the single-season UI/config/demo guard.
- Extended storage tests to verify old local/cloud `season: 2025` state migrates to 2026.
- `npm run check` is the required fast regression gate.

## v1.19.0 — P2 completion: safe initial sync linking + expanded entry summary

### Initial sync-code linking now protects existing local picks

Previously, entering an existing sync code immediately fetched and applied the remote profile, replacing this device's local entries/picks without an explicit final confirmation. v1.19.0 adds a separate `syncPendingLink` state for the not-yet-linked flow. If the current device has any saved picks across SEC or Big Ten, the fetched remote profile is held in memory and the dialog shows a side-by-side summary of **This device** vs **Synced copy** before anything is written.

The user can:
- **Cancel** — preserve local data and remain unlinked.
- **Use synced copy & link** — explicitly replace local durable Survivor data with the fetched profile, then save the sync code.

An empty device still links immediately. Initial linking intentionally does **not** expose a button that pushes local picks over the existing cloud copy, because that could destroy picks already being used by other devices. If local data is the copy to preserve, the safe route is Cancel → Enable sync to create a new code seeded from this device. The existing already-linked dirty/conflict flow remains unchanged.

### Entry/pool status is now an at-a-glance summary

The existing entry status bar remains the single compact shared-chrome surface, but now includes:
- active pool + active entry identity;
- record;
- actual pool week;
- the pick saved for the actual pool week;
- unique teams used through the current pool week by this entry;
- live sync status (`Off`, `Syncing…`, `Synced`, `Sync error`, or `Sync choice needed`);
- a separate `Viewing W#` chip when the user is researching a week other than the actual pool week.

The current-pick field deliberately uses `scheduleCurrentWeek`, not the week being browsed. Mobile renders the summary as a two-column chip grid to avoid horizontal overflow. Sync UI now receives `renderEntryStatus` as a registered callback so its status chip updates when sync state changes without reintroducing the old `app.js ↔ sync-ui.js` circular import.

### Validation

- `npm run check` passes.
- Added `tests/sync-link-safety.test.js` and `tests/entry-summary.test.js`.
- Added `tests/browser-sync-link-safety.test.js`: guards review-before-overwrite, Cancel preservation, explicit remote confirmation, and the empty-device fast path.
- Added `tests/browser-entry-summary.test.js`: verifies the five core summary fields and guards 390px page overflow.
- The Playwright browser package is not installed in the ChatGPT sandbox, so those browser tests could not be executed locally here; the existing GitHub Actions browser job will execute them on push/PR.

### P2 status

The P2 UX/architecture set from the v1.14 review is now complete: Data Health, architecture cleanup phase 2, initial sync-link overwrite protection, and the expanded entry/pool summary are all implemented. The next work should move back to data trust / CFBD efficiency / PickGauge integration rather than adding more standalone chrome.


## v1.16.0 — Exact season optimizer + PICK NEEDED / SURVIVED states

Addresses P1 #5 and #6 from the v1.14 review.

### Season Planner is now exact, not beam-search approximate

`buildSeasonPlan()` no longer truncates the search to an 800-state beam. The remaining-season
problem is modeled as an exact rectangular assignment: pool weeks are rows, unique selectable
teams are columns, each team can be assigned at most once, and each week also has a private
missing-data dummy. A Hungarian assignment solver finds the global optimum in polynomial time.
Coverage remains lexicographically dominant over probability by giving every modeled assignment
a bonus larger than the full possible log-probability swing; among equally complete paths, the
solver maximizes `sum(log(p))`, which is exactly equivalent to maximizing multiplicative season
survival probability.

Future manually locked picks are reserved before the assignment is solved, preserving the prior
one-use fix. Locked picks with no model probability remain real picks but make coverage
incomplete rather than pretending the week is a 100% win. The plan now returns
`optimizer: "exact-assignment"` / `optimality: "exact"`, and the Season Plan coverage note shows
`Exact optimizer`. On the full demo schedules, repeated exact solves are sub-millisecond on this
development machine (~0.2–0.7 ms per solve), so the change removes approximation without a
meaningful UI performance cost.

Added `tests/exact-planner.test.js`, which compares production output to an independently brute-
forced optimum on a small multi-week fixture, plus future-lock and coverage-priority regressions.

### Entry state is more actionable

`evaluateEntryStatus()` now adds:

- **PICK NEEDED** — the current listed pool week is upcoming/active and this entry has no pick.
  This replaces the less-actionable `NOT STARTED` behavior before Week 1 and also applies later
  in the season when the next selection has not been entered yet.
- **SURVIVED** — every listed pool week is final, every week has a saved pick, there are no
  losses, and every saved pick is an outright win. Ties are deliberately not silently counted as
  survival because Splash tie handling is not encoded in the app's rule model.

A missing selection in the final completed week is now caught correctly; the old `< currentWeek`
check could miss that exact end-of-season case because the natural current week remains the last
listed week after the season ends. The header shows Plan Survival = 100% / `season survived` for
a SURVIVED entry and replaces Best Play with a final season-success card instead of trying to
recommend another team.

### Testing

- Added `tests/exact-planner.test.js`.
- Expanded `tests/results-current-week.test.js` for PICK NEEDED, SURVIVED, final-week missing pick,
  and an ALIVE entry with the current pick already set.
- Updated `tests/browser-results-status.test.js` for SURVIVED and PICK NEEDED browser states.
- Updated `tests/results-ui.test.js` for the new visual classes.
- `npm run check` passes.

Files changed: `js/survivor-score.js`, `js/results.js`, `js/app.js`,
`css/planner-dialogs.css`, `tests/exact-planner.test.js`,
`tests/results-current-week.test.js`, `tests/browser-results-status.test.js`,
`tests/results-ui.test.js`, `package.json`, `package-lock.json`, `README.md`, `HANDOFF.md`.


## v1.15.0 — Season Board: best-selectable sorting + two-sided cells

Addresses the two Season Board UX issues identified in the v1.14 review.

### Week sorting now follows the actual survivor rule

The board remains anchored to conference-team rows, but clicking a week header no longer sorts
by only the conference member's win probability. Because either side of an eligible game can be
selected, each row is now ranked by the **best currently selectable modeled side in that game**.
Used teams are excluded from that calculation, while a pick already made in the sorted week is
still treated as that week's selectable side. This fixes cases such as Auburn being a 20%
underdog to an 80% eligible opponent: that game now sorts as an 80% survivor opportunity instead
of being buried as a 20% Auburn option.

### Each cell now shows both selectable teams directly

Populated Season Board cells render two compact side rows with team abbreviation, spread and win
probability for both teams. A `★` marks the best currently selectable modeled side. Selected
sides receive a distinct selected treatment; teams already burned in another week are dimmed and
struck through. The cell's probability color now follows the best selectable side, not only the
conference-row team. A small H/A/N marker preserves location context and the probability-source
label remains visible.

The grid help copy was updated to explain the star and the new sort semantics.

### Testing

- Updated `tests/grid-sort.test.js` with true two-sided fixtures and a used-opponent regression.
- Updated `tests/browser-grid-sort.test.js` to verify both sides render, an opponent can be marked
  `★`, and actual DOM row order follows `data-best-selectable-prob`.
- `npm run check` passes. The browser test was updated for the new behavior; this sandbox's
  Chromium policy blocked local navigation during the final independent browser run, so the
  standalone preview is included for visual inspection before upload.

Files changed: `js/survivor-score.js`, `js/app.js`, `css/board-rankings.css`,
`css/desktop-density.css`, `css/responsive-mobile.css`, `index.html`, `tests/grid-sort.test.js`,
`tests/browser-grid-sort.test.js`, `package.json`, `package-lock.json`, `README.md`, `HANDOFF.md`.


## v1.14.0 — P9 completion + a real mobile UX bug found and fixed

Finishes the P9 work started in v1.13.0 (real browser-driven tests for the highest-risk gaps:
sync conflict, grid sort, mobile touch targets) by extending coverage to the remaining features
that v1.13.0 explicitly flagged as not yet covered — and, while doing the mobile audit this
prompted, found and fixed a real, previously-unnoticed layout bug.

### Real mobile UX bug: stale `skeleton-block` class forced the Best Play card into a broken flex row

While visually auditing every view at 375px width (not just running tests — actually looking),
found that `#heroRecommendation` (the "Best Play this week" card) rendered with team names and
badges squeezed to near-zero width. Root cause: the static `index.html` markup carried
`class="hero-recommendation skeleton-block"` from the very first page paint, and **nothing ever
removed `skeleton-block` once real content replaced the loading text** — `app.js`'s own loading
state correctly creates its own scoped nested skeleton div, making the class on the outer element
pure leftover. `.skeleton-block` sets `display: flex`, which silently forced the card's two
sections (team identity, and the stats/actions row) into a side-by-side flex row instead of
stacking as normal blocks. This wasn't mobile-only — confirmed via direct computed-style
inspection that desktop and tablet were also unintentionally flex, just with enough width to mask
it. Fixed by removing the stray class from `index.html` (one-line fix) plus a mobile-specific
stacking refinement in `responsive-mobile.css` for extra breathing room at the narrowest widths.
Verified clean at 375px, 620px, and 1280px, both pools, zero console errors. Added a regression
test that checks computed `display` on the loaded page (not source text — a regex check for
"skeleton-block" would have passed even with the bug present, since that string legitimately
appears elsewhere for the real loading div).

### P9: remaining real browser test coverage

Three new test files, extending the harness/pattern from v1.13.0:

- **`tests/browser-why-pick.test.js`** — the "Why this pick?" panel (P2) had zero real interaction
  test coverage before this. Verifies the toggle actually opens/closes (not just that the right
  CSS classes exist), all four decision factors (Safety/Future cost/Season path/Future scarcity)
  render with real computed content (not empty placeholders), the panel's team matches the Best
  Play card's team, and the 4-column factor grid collapses to usable column widths at mobile
  viewport rather than staying stuck at 4 columns and getting crushed.
- **`tests/browser-results-status.test.js`** — entry status (ALIVE/ELIMINATED/MISSING PICK) and
  per-pick win/loss badges, mocking `/api/survivor-data` directly to construct completed, scored
  games. This was necessary because **demo mode structurally cannot produce this feature area at
  all** — `js/demo-data.js` hardcodes `completed: false` on every generated game, so nothing about
  results tracking, elimination, or win/loss badges had ever been visually verified through this
  project's normal `?demo=1` preview path before this pass. All three states verified clean at a
  390px mobile viewport as well, doubling as the first-ever visual check of this feature area on
  a phone screen.
- **`tests/browser-dialogs.test.js`** — the entry-reset confirmation guard (verifies Cancel truly
  leaves picks untouched and Confirm truly clears them — not just that a dialog element exists)
  and the board-note/status-banner collapsible sections at mobile width.

### Every new test verified against a real injected bug — including catching a flaw in a test itself

Same discipline as v1.11.1/v1.13.0: injected a realistic bug into each covered area and confirmed
the corresponding test fails, then reverted and confirmed it passes again.

One of these injection checks caught a **real weakness in a brand-new test, before it shipped**:
the reset-confirmation test's original "picks were cleared" assertion checked for the presence of
the text "No pick yet" — which is true both before *and* after a real reset, since 12 of the
entry's 13 weeks are always empty regardless of whether the one actual pick got cleared. Removing
the real reset logic (`state.picks = {}`) from `app.js` did not fail the test, revealing the
assertion was checking the wrong thing. Fixed to assert the specific picked team's name is absent
after reset, re-verified the injection now correctly fails it, then confirmed it passes against
the real code. Worth calling out explicitly since it's a concrete example of why "the test passed"
isn't sufficient on its own — the injected-bug check is what actually validates a test is testing
what it claims to.

### Wiring

`npm run check:browser` now runs 6 files / 16 real browser test scenarios (~48s total for `check:all`,
still separate from the fast `npm run check` for iteration).

Files changed: `index.html`, `css/responsive-mobile.css`, `tests/browser-mobile-ux.test.js`,
`tests/browser-why-pick.test.js` (new), `tests/browser-results-status.test.js` (new),
`tests/browser-dialogs.test.js` (new), `package.json`.

## v1.13.0 — P9: real browser-driven interaction tests

Addresses the P9 work-queue item head-on: `mobile-ux.test.js` and `grid-sort.test.js` (and
several others added since) verify behavior by regex-matching source/CSS text, which cannot
prove the app actually *works* — it can only prove certain strings exist somewhere in a file.
This got measurably harder to reason about after v1.12.0's module split, since several of those
tests now concatenate 3-4 files just to keep old assertions findable. That was flagged explicitly
as a growing sign the tool was wrong for the job, not just a style nitpick.

### New: a real browser test harness

`tests/browser-harness.js` — spins up a plain Node `http` server for the project's static files
(ES modules need a real `http://` origin; `file://` breaks module imports under CORS) and a
Playwright Chromium page per test, tearing both down cleanly even on failure. Exports
`withBrowserPage()` and `assertNoErrors()`.

**New devDependency**: `playwright` (`^1.56.0`), in `devDependencies` only — confirmed the
`dependencies` field is still empty, so this has zero effect on what ships to Vercel or what the
browser downloads to run the app itself. The zero-runtime-dependency philosophy this project has
followed throughout (hand-written CFBD/KV REST clients instead of SDKs) is about what *ships*;
a devDependency used only for local `npm run check:browser` is a different category and doesn't
compromise that. Chromium's browser binary was already available in this environment (reused, not
re-downloaded) — a fresh clone will need `npx playwright install chromium` once after `npm install`.

### Three new real test files (8 tests total)

- **`tests/browser-sync-conflict.test.js`** — the priority target: the sync conflict-resolution
  flow, previously verified only by hand (repeatedly, across several earlier sessions) and by
  `sync-safety.test.js`'s source-text checks. Four tests, each mocking `/api/sync` and driving the
  real UI: (1) a conflicted device actually shows the conflict UI with both resolution buttons
  enabled; (2) "Use synced copy" actually applies the remote entry/picks and clears the local-dirty
  flag; (3) "Keep this device" actually `PUT`s the *local* profile (not the rejected remote one)
  and clears the dirty flag; (4) a device with no local edits does NOT get shown a false-positive
  conflict. Test 3 is deliberately shaped to catch the bug class most likely to slip through
  local-state-only checks — it watches the network call, not just what changed on screen.
- **`tests/browser-grid-sort.test.js`** — replaces the reasoning gap in the regex version: clicks
  a real week header, reads the real rendered row order, verifies it's genuinely sorted by that
  week's probability (not just "changed"), verifies teams with no game that week sort to the
  bottom rather than being interleaved, verifies the sorted-header visual indicator appears,
  clicks again to confirm canonical order restores, then clicks a *different* week to confirm it
  re-sorts rather than just toggling back.
- **`tests/browser-mobile-ux.test.js`** — real rendered measurements at a 390px viewport: the
  board is horizontally scrollable within its own container (not the whole page); tapping a cell
  opens the matchup dialog; **the actual mobile pick buttons** (`[data-dialog-pick-team]` inside
  each side-option card — not the desktop-only `#useTeamBtn`/`#useOpponentBtn` pair, which are
  hidden below 620px) meet a real minimum touch-target height; the Week Rankings mobile action
  row renders all 3 buttons (Details/Compare/Use) with real, non-squeezed width.

  Writing this test surfaced a wrong assumption in the first draft — it initially targeted
  `#useTeamBtn`/`#useOpponentBtn` (the desktop selectors) and failed immediately, which is exactly
  the kind of thing a regex test could never have caught: the desktop button pair really does
  exist in the DOM at mobile width, just hidden via CSS, so a source-text check for "does 44px
  appear somewhere" would have passed without ever confirming the *actually visible* mobile
  buttons meet that size. Fixed by finding and asserting on the real per-team buttons the
  screenshot showed were the true mobile interaction.

### Every new test verified to actually catch regressions, not just pass

For each of the three files, injected a realistic bug and confirmed the test fails, then reverted
and confirmed it passes again — the same discipline used for the v1.11.1 interval-leak regression
test:
- Sync: made "Keep this device" push the rejected remote profile instead of the local one →
  caught immediately.
- Grid sort: flipped the sort comparator to ascending → caught immediately (wrong order detected
  precisely, not just "something changed").
- Mobile: shrank the mobile pick-button `min-height` from 44px to 20px → caught immediately.

### Wiring

`npm run check` (fast, ~unchanged) still runs the full existing suite for quick iteration.
New `npm run check:browser` runs just the 3 new files (~26s — real browser launches per test
aren't free, hence kept separate rather than folded into the fast loop). New `npm run check:all`
runs both. Recommend `check:all` before shipping any UI-facing change, matching the manual
practice already used throughout this project's history — this makes that practice permanent and
repeatable instead of relying on whoever's doing the work to remember to do it by hand each time.

The existing regex-based tests (`mobile-ux.test.js`, `grid-sort.test.js`, `sync-safety.test.js`,
etc.) were **not deleted** — they're still useful as a near-instant smoke check that catches gross
regressions (a renamed function, a deleted selector) without spinning up a browser. The new tests
are the authoritative behavioral verification; the old ones are a fast first line of defense.

Files changed: `tests/browser-harness.js` (new), `tests/browser-sync-conflict.test.js` (new),
`tests/browser-grid-sort.test.js` (new), `tests/browser-mobile-ux.test.js` (new), `package.json`.

## v1.12.0 — Architecture cleanup: JS module split (phase 1) + CSS split

Addresses the work-queue item flagged in the v1.11.1 review pass: `js/app.js` (1535 lines) and
`css/survivor.css` (1656 lines) had grown large enough to be worth splitting before piling more
onto them, especially ahead of a possible PickGauge integration.

### JS: extracted state.js, render-utils.js, sync-ui.js from app.js

- **`js/state.js`** — the shared `state`/`els` objects plus the core model accessors
  (`activePool`, `activeEntry`, `syncActiveEntryState`/`syncStateToActiveEntry`, `getDataWeeks`,
  `usedTeamsSet`, etc.). Every other module reads/mutates the same `state`/`els` object
  references — no new state-management behavior was introduced, this only centralizes what was
  already there.
- **`js/render-utils.js`** — pure formatting helpers with no state dependency (`escapeHtml`,
  `fmtPct`, `teamAvatar`, `matchupLabel`, `probabilityClass`, etc.).
- **`js/sync-ui.js`** — the entire cross-device sync subsystem: debounced push, pull-on-boot with
  hydration gating, conflict detection/resolution, the sync dialog's rendering and event
  handlers, and the periodic automatic-results-refresh timer. This was the single largest and
  most self-contained subsystem in `app.js`, and the most recently added, making it the
  highest-value first extraction.
- **`js/app.js`** — now ~1000 lines (was 1535). Still holds the four view renderers, the matchup
  and entry dialogs, and boot/data-loading — a deliberate phase-1 scope decision, not an
  oversight; see the phase-2 work-queue item above.

**Circular import, deliberately**: `sync-ui.js` imports `renderAll`/`renderEntryControls`/
`loadData` back from `app.js` (which imports several functions from `sync-ui.js`). Verified this
is safe with native ES modules *before* committing to the architecture, via a minimal reproduction
in this environment — circular imports work correctly as long as the circularly-imported bindings
are only used inside function bodies that run after both modules finish their initial evaluation,
never at module top-level. Every usage here is inside an event handler or async function.

### Two real integration bugs, both caught only by live-browser testing

`npm run check` passed after the initial mechanical extraction — and the app was still
completely broken. Neither automated test executes `app.js` as a live module in a browser (they
either text-scan source or import pure-logic modules directly), so neither could have caught
either of these:

1. `bindSyncEvents()` was imported into `app.js` but never actually called from `bindEvents()` —
   every button in the sync dialog would have been dead. Loading the page showed no console
   error at all; it just silently did nothing when the sync dialog's buttons were clicked, since
   nothing had registered a listener on them.
2. The circular import needed `renderAll`/`renderEntryControls`/`loadData` exported from
   `app.js`, which had never needed an `export` statement before (it was always the sole entry
   point). Missing it produced a real, loud module-resolution error on page load — caught
   immediately, but only because the page was actually opened in a browser.
3. (Found via a second full click-through after fixing the above two): `sync-ui.js`'s `saveLocal`
   calls `syncStateToActiveEntry()`, but the import list only pulled in the similarly-named
   `syncActiveEntryState` — a different function with the opposite direction (entry→state vs
   state→entry). This one didn't throw an uncaught page error either; it was caught internally
   and surfaced only as an error message inside the status banner ("syncStateToActiveEntry is not
   defined"), which a naive "check for zero console errors" pass would have missed entirely — it
   was only caught by actually reading the rendered page content, not just listening for thrown
   errors.

After all three fixes, did a full click-through of every view (Season Board → matchup dialog →
Week Rankings → Why This Pick → compare bar → Season Plan → My Picks → sync dialog → pool switch
to Big Ten), re-verified the sync conflict-resolution flow specifically (the highest-stakes
feature, now living entirely in the new `sync-ui.js`) with the same mocked-network approach used
in the v1.11.1 review, and checked mobile at 390px and 375px. Zero console errors, zero banner
error text, matching output at every step to the pre-refactor screenshots.

### Tests updated for the new file layout

Four tests (`mobile-ux.test.js`, `p1-p2-ui.test.js`, `results-ui.test.js`, `sync-safety.test.js`)
did text-matching against `js/app.js`/`css/survivor.css` by hardcoded path. Updated all four to
concatenate the split files instead, preserving every existing assertion's intent without having
to track exactly which new file each pattern now lives in. This also keeps the v1.11.1 interval-
leak regression test meaningful now that its definition and call site live in different files
(`sync-ui.js` and `app.js` respectively) — the check spans the concatenated text of both.

### CSS: split into 6 ordered files, verified byte-for-byte

`css/survivor.css` → `base.css`, `board-rankings.css`, `planner-dialogs.css`,
`desktop-density.css`, `responsive-tablet.css`, `responsive-mobile.css`, split at contiguous
line ranges (never mid-rule — found programmatically, only at points where brace depth returns
to zero). This is a pure file-boundary change, not a reorganization: no rule was reordered,
renamed, or altered. Before deleting the original file, reconstructed it by concatenating the 6
new files (minus the header comments each one got) and confirmed the result is **byte-for-byte
identical** to the original — so the cascade computes identically regardless of which file a
given rule now lives in. `index.html` links all 6 in the same sequence they appeared in the
original file. Verified in a browser: pixel-matching output at desktop, 390px, and 375px widths,
all 6 stylesheets loading with 200s.

### Tests

`npm run check` passes (33 suites — same count as before this pass; no new test files, four
updated for the new paths). Live-verified in a browser (Playwright): full click-through of every
view and dialog with zero console errors and zero banner error text; the sync conflict-resolution
flow specifically re-verified end to end; CSS split confirmed byte-identical before rendering
verification; mobile checked at two widths.

Files changed: `js/app.js`, `js/state.js` (new), `js/render-utils.js` (new), `js/sync-ui.js`
(new), `css/base.css` (new), `css/board-rankings.css` (new), `css/planner-dialogs.css` (new),
`css/desktop-density.css` (new), `css/responsive-tablet.css` (new), `css/responsive-mobile.css`
(new), `css/survivor.css` (removed), `index.html`, `tests/mobile-ux.test.js`,
`tests/p1-p2-ui.test.js`, `tests/results-ui.test.js`, `tests/sync-safety.test.js`, `package.json`.

## v1.11.1 — Fix: leaked result-refresh interval on sync retry (Claude review pass)

A review of ChatGPT's v1.11.0 handoff (full diff against v1.10.1, live-browser verification of
the safety-critical flows, not just a test-suite pass) found one real bug and confirmed the rest
of the release as genuinely solid, well-tested work — including a real latent bug fix in the
planner (see below) that predates this review.

### Bug found and fixed: `startAutomaticResultRefresh()` called twice

`js/app.js`'s sync dialog's "Retry" button handler called `startAutomaticResultRefresh()` a
second time, in addition to the one legitimate call at module boot. Since the function's return
value (the `setInterval` id) was never captured or cleared anywhere, every click of "Retry"
stacked an additional, never-ending 5-minute polling interval on top of the others — a genuine
interval leak that would multiply `/api/survivor-data` calls and re-renders the longer a session
ran and the more times a user hit Retry (e.g. after a flaky connection). Confirmed by
temporarily reintroducing the exact line and watching a new regression test fail, then
confirming it passes with the fix. Fixed by removing the stray call and making
`startAutomaticResultRefresh()` clear any existing timer of its own before starting a new one,
so a future accidental duplicate call is a no-op instead of a leak. Regression test added to
`tests/results-ui.test.js`.

### What was verified live (not just via the test suite)

`npm run check` passing does not, by itself, prove the safety-critical sync-conflict flow or
"Why this pick?" actually work at runtime — the new tests covering those
(`sync-safety.test.js`, `p1-p2-ui.test.js`, `results-ui.test.js`) are regex matches against raw
source text, the same pattern this project's own `mobile-ux.test.js` is already flagged as a
known weakness for (see P9). So before accepting the v1.11.0 handoff's claims, this pass drove
the actual app in a browser (Playwright) with mocked network:

- **Sync conflict resolution**: simulated a device with unsynced local edits pulling a
  *different* remote profile on boot. Confirmed the conflict UI appears, and both resolution
  paths work correctly at runtime — "Use synced copy" applies the remote profile and clears the
  local-dirty flag (verified the entry name/picks actually changed to match the mocked remote
  data); "Keep this device" pushes the local profile via a real `PUT` call and also clears the
  dirty flag. Zero console errors in either path.
- **"Why this pick?"**: confirmed it renders real, internally-consistent computed content
  (safety rank, future cost, season path, future scarcity) matching the Best Play card above it,
  not placeholder text.
- Also independently confirmed (via a from-scratch fixture, not by trusting the new test) that
  the planner's coverage-vs-log-probability bug fix — see below — is a genuine, previously-real
  bug: reproduced the old buggy behavior directly against the actual v1.10.1 code before
  confirming v1.11.0 fixes it.

### Bug fix from v1.11.0 itself worth calling out explicitly (not this review's work, but verified real)

`buildSeasonPlan()`'s beam search previously compared candidate paths purely by log-probability.
A *skipped* week (no modeled candidate available) contributed exactly 0 to that sum — the same
contribution as a mathematically guaranteed win (`log(1.0) = 0`). That meant an incomplete plan
that gave up on a hard week could out-rank a complete plan that had a real, lower-but-genuine
probability for every week, and the reported "survival probability" would then be a fake number
computed only from the weeks the plan bothered to cover. Reproduced this directly: locking
`{team: 'A', week: 1, p: 0.99}` with no other week-2 option for A produced a reported "99%
survival" plan that had silently skipped week 2 entirely, under the pre-v1.11.0 code. v1.11.0's
fix (lexicographic comparison: fewer missing weeks always wins first, then more modeled weeks,
then higher log-probability; `survivalProbability` is now `null` unless every future week has a
real modeled pick, with a separate `modeledSurvivalProbability` for partial coverage) is correct,
well-tested (`tests/season-plan.test.js`'s `coverageFirstPlan` case directly demonstrates the
fix), and confirmed wired all the way through to the UI (My Picks correctly shows "—" plus "12/13
weeks modeled" instead of a fake percentage when coverage is incomplete).

### Also confirmed correct in this pass (verified via diff + targeted checks, not just read)

- `vercel.json`'s CDN cache rule previously applied a shared cache to **every** `/api/*` route,
  including `/api/sync` — meaning private synced data could have been cached at the edge. Now
  scoped specifically to `/api/sync` with `no-store`; `api/survivor-data.js` sets its own
  `Cache-Control` per-request instead (120s shared cache normally, `no-store` when `?fresh=1`).
- The sync payload size cap was checking `JSON.stringify(profile).length` (JS string length,
  which undercounts multi-byte UTF-8 characters) rather than actual bytes. Now uses
  `Buffer.byteLength(..., 'utf8')`, with a test fixture specifically constructed to be under the
  old character-count limit but over the new byte limit.
- `js/storage.js`'s synced profile no longer includes device navigation state (active pool,
  active entry, current week) — previously, merely *browsing* on one device could silently
  change another device's active pool/view on its next pull. Now cloud-synced data is durable
  survivor state only (season, entries, names, picks); navigation state stays local per device.
- Pool/entry isolation re-checked: `evaluateEntryStatus()` is recomputed from `state.picks` (the
  active entry's picks only) on every `renderAll()`, so switching entries or pools correctly
  recomputes status rather than showing stale data from a previously-active entry.

Files changed in this pass: `js/app.js`, `tests/results-ui.test.js`, `package.json`.

## Work queue

Updated after v1.14.0 (P9 completion + a real mobile UX bug fix). Ordered by what seems
highest-value next, not by difficulty — re-prioritize freely.

### P9 — ~~Test suite quality~~ ✅ Done (v1.13.0 + v1.14.0)
v1.13.0 covered the highest-risk gaps (sync conflict, grid sort, mobile touch targets). v1.14.0
extended coverage to Why This Pick, entry status/results tracking (win/loss/eliminated/missing-
pick — previously impossible to even visually check, since demo mode can't produce completed
games), and the reset-confirmation/collapsible-section interactions. 6 browser test files, 20
tests total, every one verified against a real injected bug — including one case where the
injection check caught a flawed assertion in a brand-new test before it shipped (see the v1.14.0
entry). Doing the mobile audit this prompted also surfaced a real, previously-unnoticed layout
bug (stale `skeleton-block` class), now fixed with a regression test. Not "every regex assertion
replaced" — `mobile-ux.test.js`, `grid-sort.test.js`, `p1-p2-ui.test.js`, `results-ui.test.js`
still have some text-matching checks for lower-risk properties; the browser tests are the
authoritative behavioral verification for the areas that matter most.

### Architecture cleanup — ~~Split js/app.js and css/survivor.css~~ ✅ Done, phase 1 of 2 (v1.12.0)
`js/app.js` (1535 lines) split into `js/state.js` (shared state/els + model accessors),
`js/render-utils.js` (pure formatting helpers), and `js/sync-ui.js` (the entire sync subsystem —
the largest and most self-contained piece). `app.js` is now ~1000 lines and holds the four view
renderers, dialogs, and boot/data-loading. `css/survivor.css` (1656 lines) split into 6 files by
contiguous original line range (base tokens/shell, board+rankings, planner+dialogs,
desktop-density overrides, tablet responsive, mobile responsive) — verified byte-for-byte
identical to the original file when reconstructed, so this was a pure file-boundary change with
zero cascade/rendering risk. **Phase 2 (not done)**: the four view renderers
(Season Board/Week Rankings/Season Plan/My Picks) and the matchup/entry dialogs are still in
`app.js`. See the v1.12.0 entry below for the full risk-management approach and the bugs this
process itself caught — now that real browser tests exist (v1.13.0), phase 2 should lean on
`npm run check:browser` in addition to manual click-through.

### P0 reliability — ~~Sync/cache/profile/plan safety~~ ✅ Done (v1.10.2)
Four trust-critical fixes: `/api/sync` is never CDN/browser cached; cloud pushes stay blocked until
initial cloud hydration succeeds; only durable survivor data (entries/names/picks/season) syncs
while active pool/entry/week remains device-local; and incomplete Season Plans no longer treat a
missing model week as a 100% win or label the resulting product as full-path survival.

### P0 — ~~Cross-device account + cloud sync~~ ✅ Done (v1.9.0)
### P8 — ~~Sync hardening~~ ✅ Done (v1.10.1)
TTL-based cleanup for abandoned codes, a real delete endpoint, and KV-backed rate limiting — see
the v1.10.1 entry below. Normal concurrent writes still use last-write-wins, but v1.10.3 adds an explicit choice when a device reconnects with unsynced local edits.
### P3 — ~~What-if comparison~~ ✅ Done (v1.10.0)
### P4 — ~~Future-week scarcity~~ ✅ Done (v1.10.0, computed and surfaced; not yet fed into
scoring — see the v1.10.0 entry below)

### P1.3 — ~~Small safety fixes~~ ✅ Done (v1.10.3)
Entry reset now requires confirmation; unsynced local edits persist across reloads and trigger an
explicit cloud/local conflict choice instead of silent overwrite; sync payloads are limited by
actual UTF-8 bytes; malformed sync-create payloads are rejected.

### P2 — ~~"Why this pick?"~~ ✅ Done (v1.10.3; aligned to planner in v1.10.4)
Best Play has an on-demand explanation using raw safety rank, future opportunity cost,
season-path context, and future-week scarcity. As of v1.10.4 the explanation describes the same
planner-driven Best Play recommendation; Survivor Score rank remains secondary context.

### P1 — Inspect / plan PickGauge integration
Unchanged from the original handoff, and arguably more relevant now, not less: v1.9.0 was built
standalone specifically per your instruction to not wait on this. Worth revisiting soon so any
future PickGauge merge has a clear plan for what happens to the sync-code layer (replaced by
PickGauge's real auth, or kept as a no-login fallback).

### P1.5 — Re-verify both schedules against live CFBD (new, from the v1.7/v1.8.3 work)
Both the SEC (106 games) and Big Ten (122 games) Splash schedules were hand-transcribed from
screenshots without a live CFBD key to confirm exact team-name matches. The matching logic
degrades gracefully (unmatched games surface in `missing`/warnings rather than silently
breaking), but a few Big Ten opponent names were genuine guesses with defensive aliases
(Cal/California, UConn/Connecticut, Louisiana) — worth a real pass once a CFBD key is live,
before trusting either board for actual picks.

### P1.2 — ~~Recommendation consistency~~ ✅ Done (v1.10.4)
Best Play now comes from the same season-planning engine as Season Plan. The planner’s first
current-week pick is authoritative; Survivor Score remains a secondary heuristic. Week Rankings
pin the planner pick first and label it **Best path**. A manually selected current-week pick does
not redefine model advice, while future locked picks are still honored. v1.10.4 also fixed a
one-use bug where a team locked for a future week could previously be selected by the planner in
an earlier week and then reused in the locked week.

### P4-follow-up — Feed scarcity into scoring
`seasonScarcity()` is currently display-only (Season Plan's difficulty strip). The original
roadmap's own phrasing was "eventually feed this into scoring," treated here as a deliberate
follow-up rather than bundled into the same change — wiring it into `futureProfile()`/
`survivorScore()`'s weighting changes what the app actually recommends, which deserves its own
focused pass (and re-validation) rather than shipping alongside the display feature.

### P5 — ~~Automatic result tracking~~ ✅ Done (v1.11.0)
Saved picks now read final W/L scores directly from the existing CFBD `/games` payload. The active
entry is classified as ALIVE, ELIMINATED, AWAITING RESULT, MISSING PICK, or NOT STARTED; My Picks
shows the final score/result beside every saved pick. An eliminated entry reports 0% plan survival.

### P5 — ~~Date/result-driven current-week detection~~ ✅ Done (v1.11.0)
The landing week is derived from CFBD kickoff dates plus completion state rather than "first incomplete".
Completed weeks advance immediately, and a stale postponed/canceled game older than the normal week
window cannot trap the app on an old week. The browser checks results automatically every five minutes
while visible; manual Refresh sends `fresh=1` and bypasses the shared result cache.

### P6 — Entry/pool status summary
Unchanged from the original handoff.

### P7 — Model calibration
Unchanged from the original handoff (HFA, margin SD, SP+→WP mapping, Survivor Score weights,
planner quality) — still a starting point, not validated against real historical accuracy.

### Architecture cleanup phase 2 — Split the four views + dialogs out of app.js
Phase 1 (v1.12.0) extracted state/utils/sync. Still in `app.js`: Season Board, Week Rankings,
Season Plan, My Picks, the matchup dialog, and the entry reset/delete dialogs (~1000 lines).
Same approach should work (state.js/render-utils.js are already the shared foundation), but
budget real time for it — phase 1 caught two real integration bugs (a missing `bindSyncEvents()`
call and a missing export) purely through live-browser verification, neither of which any
automated test caught on its own. Don't skip that step for phase 2.

### P9 — Test suite quality
`tests/mobile-ux.test.js` and `tests/grid-sort.test.js` check *source code/CSS text* via regex,
not actual rendered/interactive behavior — brittle, and gives weaker confidence than it looks
like. Worth a real browser-based test (Playwright) for at least the sort-click and
mobile-dialog-open interactions. The v1.12.0 module split makes this more pressing, not less:
several of these regex tests now concatenate multiple files to keep working, which is a correct
fix but a growing sign that text-matching against source is the wrong tool for verifying behavior.

### Not finalized (carried over from the original handoff, still true)
Do not assume: final Survivor Score weights, final SP+ calibration, monetization, automatic
Splash import, exact PickGauge merge timing.


## v1.11.0 — Automatic results + current-week tracking

### Results reuse the existing CFBD data path
No second score provider was added. `api/survivor-data.js` already consumes CFBD `/games`; v1.11.0
uses the existing `completed`, `homePoints`, `awayPoints`, and `startDate` fields for survivor results.
This is deliberate so a future PickGauge merge can reuse PickGauge's CFBD data layer instead of
maintaining a parallel Survivor score feed.

### Entry status is now automatic
`js/results.js` centralizes result/current-week logic. Saved picks are classified as win, loss, upcoming,
or awaiting final. The active entry receives ALIVE / ELIMINATED / AWAITING RESULT / MISSING PICK /
NOT STARTED status, including tracked W-L record and elimination week. My Picks displays each saved
pick's final score/result. Eliminated entries show 0% Plan Survival; recommendations remain visible as
research context and are labeled accordingly.

### Current week is date + result driven
The app no longer relies on the first incomplete CFBD game. A fully completed week advances
immediately. If an old game stays incomplete past the week's normal kickoff window, the scheduler
advances anyway so a postponed/canceled stale record cannot strand the app. If CFBD changes the
postponed game's `startDate`, the active window moves with it automatically. A persisted focused week
that is behind the newly derived pool week is advanced on load, while deliberate future-week browsing
remains possible.

### Results freshness
Normal survivor-data responses use a 120-second shared cache. The browser refreshes automatically every
five minutes while visible. Manual Refresh adds `fresh=1` and the API returns `private, no-store`, so the
user can explicitly bypass shared caching when checking a final. `vercel.json` no longer hardcodes the
survivor-data cache because the handler now owns normal-vs-forced freshness behavior.

### Validation
Added `tests/results-current-week.test.js` and `tests/results-api-cache.test.js` covering completed-week
advancement, stale-incomplete protection, active-week behavior, W/L result parsing, eliminated/alive/
awaiting/missing-pick entry states, CFBD score fields, normal caching, and manual no-store refresh.

## v1.10.4 — P1.2 recommendation consistency

### Best Play and Season Plan now use one source of truth

Best Play no longer chooses the top `survivorScore()` row independently from the season planner.
`buildStrategicRecommendation()` now returns the current-week first pick from `buildSeasonPlan()`,
and `js/app.js` uses that plan for the headline recommendation. Before a current-week pick is
made, the Best Play recommendation and Season Plan therefore start from the same strategic path.

If the user has already made a current-week pick, the normal Season Plan still honors that real
locked pick, while Best Play deliberately ignores the current-week lock and continues to show
what the model recommends. Future manually locked picks remain part of the strategic plan.

### Week Rankings now make the source-of-truth distinction visible

The planner-selected team is pinned first and receives a **Best path** badge. Remaining available
options continue in Survivor Score order. This preserves the quick heuristic without presenting
it as the authoritative recommendation. A user's current pick keeps its own **Your pick** badge
and is no longer artificially promoted to rank #1 just because it was selected.

### “Why this pick?” now explains the actual recommendation

The explanation panel now states that Best Play is season-planner driven. Survivor Score rank is
shown explicitly as secondary context. The Season Path section reads from the strategic plan
coverage/probability instead of presenting a separate heuristic-vs-planner disagreement.

### Future locked picks now reserve their team correctly

While validating P1.2, a one-use bug was found in `buildSeasonPlan()`: a team locked in a future
week did not invalidate an earlier beam state that had already used that same team. The locked
branch now discards any state where the team is already used, so future manual picks reserve the
team throughout the earlier optimization path.

### Validation

Added `tests/recommendation-source.test.js`. The fixture intentionally creates a case where
Survivor Score prefers a 99% Week 1 team but the full-season path correctly starts with an 80%
team so the 99%-rated team can be saved for Week 2. The test also verifies current-week locks do
not redefine Best Play and future locks are respected without team reuse. Existing what-if tests
were tightened so an already-used team is treated as an invalid hypothetical pick. `npm run check`
passes all suites.

## v1.10.3 — P1.3 safety + P2 explanation

### Entry reset is now confirmed

`Reset this entry's picks` no longer clears immediately. It opens a dedicated confirmation dialog
that names the active entry and explicitly states that other entries/pools are unaffected.

### Unsynced local edits can no longer be silently overwritten on reconnect

A persistent local dirty marker records durable survivor changes until a cloud PUT succeeds. If
a linked device has unsynced local edits when a cloud pull succeeds (including after a browser
reload), the remote profile is held in memory and the sync dialog requires an explicit choice:
**Keep this device** pushes local picks to cloud; **Use synced copy** applies the cloud snapshot
locally. Nothing is overwritten before that choice. Normal simultaneous edits after both devices
are fully hydrated still use the existing last-write-wins model; this change specifically closes
the offline/startup-unsynced-data loss case.

### Sync payload validation is byte-accurate

`api/sync.js` now measures the serialized profile with `Buffer.byteLength(..., 'utf8')` rather
than JavaScript string length, so multibyte text cannot bypass the 200 KB limit. POST now rejects
malformed/missing profiles with 400 instead of creating an empty skeleton snapshot.

### “Why this pick?” is live

The Best Play card now has an on-demand **Why this pick?** panel. The explanation reuses existing
engines rather than inventing a second model and shows:

- current-week raw safety rank and gap to the safest option;
- future opportunity cost / best later spot;
- a season-path what-if check against leading alternatives;
- the hardest future week after burning the team, based on 90%+ option scarcity;
- Survivor Score rank and model source.

If the current Survivor Score leader is not the full-path leader, the panel says so explicitly.
That is intentional transparency while P1.2 (one recommendation source of truth) remains open.
The path check is on-demand so the beam-search work is not added to every normal render.

### Validation

Added `tests/pick-explanation.test.js` and `tests/p1-p2-ui.test.js`; expanded storage, sync API,
and sync-safety tests for persistent dirty state, explicit conflict resolution, reset confirmation,
malformed POST rejection, and true UTF-8 byte limits. `npm run check` now runs 16 test files.

## v1.10.2 — P0 reliability pass

This release is deliberately about trust/correctness rather than adding another feature.

### Sync responses are no longer cacheable

`vercel.json` previously applied `s-maxage=900, stale-while-revalidate=3600` to every `/api/*`
route, which unintentionally included `/api/sync`. Personalized sync reads now have their own
`private, no-store, max-age=0, must-revalidate` rule, and `api/sync.js` sets the same header
itself on every response. `js/sync.js` also requests `cache: 'no-store'` on sync reads/deletes.
The public-ish `/api/survivor-data` route keeps its shared cache.

### Startup pull/push race closed

A linked device now starts with `syncHydrationReady = false`. `scheduleSyncPush()` refuses to
write cloud state until the initial `GET /api/sync` has succeeded and the cloud profile has been
applied locally. If that pull fails, the device remains blocked from cloud writes rather than
risking stale localStorage overwriting newer picks. The sync dialog exposes **Retry sync**; a
successful retry unlocks pushes.

### Cloud profile now contains durable survivor state only

Sync profile schema is now v2. It includes each pool's season + entries (id/name/picks), but no
longer includes active pool, active entry, focused week, grid sort/view, or other device UI
context. Old v1 server blobs are still readable; their legacy navigation fields are ignored.
Applying a cloud profile preserves the receiving device's active pool/week and keeps its active
entry when that entry still exists. UI-only saves (week navigation, week-column sorting,
entry/pool focus) persist locally without scheduling a cloud write.

### Incomplete plans can no longer masquerade as full-season probabilities

`buildSeasonPlan()` now tracks `modeledWeekCount`, `requiredWeekCount`, `missingWeeks`, and
`coverageComplete`. The beam search itself prioritizes complete coverage before raw log
probability, preventing a path that skips a week from beating a complete path merely because the
skip adds no probability loss. If no complete path exists, `survivalProbability` is `null` and
`modeledSurvivalProbability` is reported separately. UI wording becomes **Modeled path
survival**, with `X/Y weeks modeled` and explicit missing weeks; the top Plan Survival metric
shows `—` until the full remaining path is modeled. What-if comparison likewise refuses to show
false `vs best` deltas for incomplete paths.

### Validation

Added `tests/sync-safety.test.js`; expanded storage/sync/season-plan tests for the v2 profile,
cache controls, hydration gate, device-local navigation, incomplete coverage, and a regression
where a 99% one-week path must lose to a lower-probability but complete two-week path. Full
`npm run check` passes.

Files changed: `vercel.json`, `api/sync.js`, `js/sync.js`, `js/storage.js`, `js/app.js`,
`js/survivor-score.js`, `index.html`, `css/survivor.css`, `package.json`, `tests/storage.test.js`,
`tests/season-plan.test.js`, `tests/sync-api.test.js`, `tests/sync-client.test.js`, new
`tests/sync-safety.test.js`, `README.md`, `HANDOFF.md`.

## v1.10.1 — Sync hardening (P8)

Three additions to `/api/sync.js`, none of which change the wire format or break existing
synced codes:

### TTL-based cleanup for abandoned codes

Every successful POST (create) and PUT (update) now sets a 180-day expiry on the code's KV
record via `kvSet`'s new `ttlSeconds` parameter (Upstash's `SET ... EX <seconds>`, passed as a
query param on the REST call). An actively-used code's expiry keeps getting pushed out with
every write and never comes close to firing; a code nobody touches for 180 days quietly expires
and frees its KV storage instead of sitting there forever. GET (reads) deliberately does **not**
refresh the TTL — see the code comment in `api/sync.js` for why "only writes count as activity"
is the right rule here (a poll-only reader shouldn't be able to keep a genuinely-abandoned code
alive forever).

### Real delete endpoint

New `DELETE ?code=XXXX-XXXX` permanently removes a code's synced data from KV immediately,
rather than waiting on the TTL. This is distinct from "Stop syncing this device" (which only
clears the code from *this device's* localStorage and leaves the server data and every other
linked device untouched) — the sync dialog now has both, clearly separated, with delete requiring
an explicit "Yes, delete everywhere" confirmation step naming the code and warning that every
device using it loses access. `js/sync.js` gained `deleteSyncAccount(code)`.

### Rate limiting

Every request is now rate-limited per client IP, counted using the KV store itself
(`kvIncr`/`kvExpire` — a fixed-window counter). This deliberately isn't an in-memory counter:
serverless functions don't share memory across invocations or regions, so an in-memory limiter
would silently do nothing under real multi-instance traffic while looking like it works locally.
Two tiers: account creation (POST) is capped at 8 per 10 minutes per IP, since each one is a new
stored record; everything against an existing code (GET/PUT/DELETE) gets a much more generous 60
per minute per IP, since normal usage (a debounced push after every pick, an occasional pull,
possibly from multiple devices sharing a household IP) can legitimately fire several requests a
minute. Over-limit requests get `429` with a `Retry-After` header. `createHandler()` gained an
injectable `now` function so the fixed-window bucket is testable deterministically instead of
depending on wall-clock timing during test runs.

### Last-write-wins conflict handling: deliberately left as-is

The work queue's original P8 note also asked to "consider whether last-write-wins is still
acceptable at higher usage." Decision: leave it as-is for this pass. Real conflict resolution
(optimistic concurrency with a 409-on-stale-write, or an actual field-level merge) is a
meaningfully larger change that affects the push/pull contract itself, not just the storage
layer underneath it — bundling it into a "hardening" pass alongside TTL/delete/rate-limiting
risked scope creep into a half-done merge system. It stays a explicitly tracked possibility, not
a silent gap: if sync sees enough concurrent-multi-device usage that stale overwrites become a
real complaint, that's the trigger to revisit it as its own focused change.

### Tests

`tests/kv-client.test.js` gained coverage for `kvSet`'s TTL query param, `kvDelete`, `kvIncr`,
and `kvExpire`. `tests/sync-api.test.js` was substantially extended: TTL is asserted on both
POST and PUT, the full DELETE endpoint (success, deleting an already-gone code, malformed code),
and a dedicated rate-limiting section — verifies the 9th creation in a window is blocked with the
correct `Retry-After`, that a different IP gets an independent budget, that the general bucket
blocks its 61st request, that creation and general requests don't share a budget, and that a
missing `x-forwarded-for` header degrades to a shared bucket rather than crashing.
`tests/sync-client.test.js` gained coverage for `deleteSyncAccount`. `npm run check` passes (15
suites, same count as v1.10.0 — these were additions to existing test files, not new ones).

Verified live in a browser with Playwright (mocked `/api/sync`): the full delete flow — button →
confirmation naming the specific code → confirm → dialog reverting to the "not syncing" state —
renders and behaves correctly with zero console errors, screenshots taken at each step.

Files changed: `api/_lib/kv.js`, `api/sync.js`, `js/sync.js`, `js/app.js`, `css/survivor.css`,
`tests/kv-client.test.js`, `tests/sync-api.test.js`, `tests/sync-client.test.js`.

## v1.10.0 — What-if comparison (P3) + future-week scarcity (P4)

### What-if comparison (P3)

New "Compare" toggle on each Week Rankings card. Select 2-4 teams for the current week and a
panel shows, for each, the full remaining-season survival probability if that pick is locked in
now and the planner plays optimally afterward — not just this week's raw win probability, but
"this pick, then the best possible path from there." Sorted best-to-worst with each option's
delta from the best. Matches the original roadmap's example format (e.g. "Use Mississippi
State: 63.4%" vs "Use Alabama: 58.9%," difference +4.5%).

Implementation: `compareWhatIf()` in `js/survivor-score.js` reuses `buildSeasonPlan()` itself
rather than a separate estimate — for each candidate it locks that team in for the current week
via `buildSeasonPlan()`'s existing `lockedPicks` mechanism and reads off the resulting
`survivalProbability`. This keeps the comparison honest (same beam-search engine, same
one-team-once enforcement) instead of maintaining a second, possibly-inconsistent estimate.
Selection state (`state.compareSelection`) is scoped to the currently-viewed week and resets
automatically when the week changes.

### Future-week scarcity (P4)

New "Future-week difficulty" strip on the Season Plan view. For each remaining week, counts how
many not-yet-used teams are 90%+ favorites and labels the week Easy / Medium / Hard / Very Hard
— a week with only one or two safe options is a week worth saving a strong team for; a week
stacked with lopsided favorites is a week to spend one on, since there's no shortage of other
safe picks that week.

Implementation: `seasonScarcity()` in `js/survivor-score.js`. **Display-only for this pass** —
it is not yet wired into `futureProfile()`/`survivorScore()`'s weighting (tracked as a separate
P4-follow-up item in the work queue above; changing what the app actually recommends deserves
its own focused change and re-validation, not to be bundled quietly into a display feature).

### Demo data fix (found while building P4)

Building the scarcity strip against demo data surfaced a real issue in the demo win-probability
generator: it previously derived each game's probability from a hash of that specific game
(`away|home|week`), independent of any other game the same team played. That produced a roughly
uniform 42-95% spread with no concept of team strength, so genuine blowouts (95%+) almost never
appeared — every week's scarcity strip looked like a wall of "Very Hard" regardless of the
actual slate, which wasn't a bug in the new scarcity engine (verified correct via unit tests
against hand-crafted data) but made the feature look broken and uninformative in the one place
most people will actually see it first.

Fixed in `js/demo-data.js`: each team now gets one fixed power rating (stable across all its
games, derived from a hash of the team name alone), and each game's probability comes from the
rating gap via the same normal-CDF approach `api/survivor-data.js`'s real SP+ fallback already
uses (kept the exact same `erf`/`normalCdf` implementation for consistency, duplicated locally
rather than importing the API file into browser code). Real demo blowouts and real demo
underdogs now both show up, and weeks vary meaningfully in difficulty. Added
`tests/demo-realism.test.js` as a regression guard — it would fail against the old per-game-hash
model. This only touches the synthetic demo generator; it has no effect on real CFBD-backed data.

### Tests

Added `tests/whatif-scarcity.test.js` (compareWhatIf and seasonScarcity against hand-crafted
matchups, including used-team handling, completed-game exclusion, and missing-matchup
fallbacks) and `tests/demo-realism.test.js` (see above). `npm run check` passes (15 suites).

Verified live in a browser with Playwright at both desktop and 390px mobile widths: selecting
2-3 teams in Week Rankings renders the compare panel with correct sorted survival probabilities
and deltas (screenshots taken); the mobile 3-button row (Details / Compare / Use) required
widening `.rank-mobile-actions`'s grid from 2 to 3 columns, confirmed no overflow at 390px. The
Season Plan scarcity strip renders correctly on both desktop and mobile (horizontal scroll) with
zero console errors throughout.

Files changed: `js/survivor-score.js`, `js/app.js`, `js/demo-data.js`, `index.html`,
`css/survivor.css`, `tests/whatif-scarcity.test.js` (new), `tests/demo-realism.test.js` (new),
`package.json`.

## v1.9.0 — Cross-device sync

Implements the P0 item from the work queue: the same entries/picks now visible on phone,
laptop, and any other device, without building full email/password accounts.

### Design decision: sync code instead of real accounts

The "account" is a single random code (format `ABCD-2345`), not an email/password login.
Whoever has the code can read and overwrite the synced data — the security model is
deliberately equivalent to a shared-document link, not a real login. This was a conscious
scope choice for a casual pool tool used by a small number of people who already trust each
other: it avoids an email provider, password hashing/reset flows, and session management
entirely, and it's trivially easy to migrate away from later (a future PickGauge merge doesn't
need to preserve this "account" concept — the code is disposable, unlike real user identities).

**Explicit acknowledgment**: this was built standalone per your instruction, ahead of the
PickGauge integration review the handoff had recommended doing first. If/when that merge
happens, this sync layer either gets replaced by PickGauge's real auth, or stays as an
unauthenticated fallback — either way nothing here should block that decision, since there's no
real user identity invested in a sync code.

### Architecture

- **Storage**: a single JSON blob per code, containing both pools' full state (entries, picks,
  active entry, current week, season) plus which pool was last active — the same shape
  `js/storage.js` already keeps in localStorage, so syncing is "upload this blob" / "download
  this blob," not a field-by-field API.
- **Backend**: `api/sync.js` (new Vercel serverless function) with `POST` (create a code, seeded
  with the calling device's current state so the first device to sync doesn't lose picks),
  `GET ?code=` (pull), and `PUT` (push/overwrite). Basic profile-shape validation and a 200KB
  payload cap guard against obviously-malformed writes.
- **KV client**: `api/_lib/kv.js` — a small hand-written fetch client for Upstash Redis's REST
  API (the same protocol Vercel KV exposes, using the identical `KV_REST_API_URL` /
  `KV_REST_API_TOKEN` env var names Vercel injects automatically when you add Vercel KV via the
  dashboard). Written by hand instead of adding the `@vercel/kv` npm package, to keep this
  project's zero-npm-dependency style (matches `api/survivor-data.js`'s hand-written CFBD
  client) and to keep it testable the same way — mocking `global.fetch` — without needing SDK
  test doubles or a live Redis instance. `_lib` (underscore prefix) is Vercel's documented
  convention for excluding shared helper files from automatic function-per-file routing.
  Missing env vars fail safe with a 503, mirroring how `CFBD_API_KEY` being unset already works.
- **Frontend**: `js/sync.js` (network calls only) + `js/storage.js` additions
  (`loadSyncCode`/`saveSyncCode`/`clearSyncCode` for the code itself, `buildSyncProfile`/
  `applySyncProfile` for snapshotting/restoring both pools at once) + `js/app.js` wiring:
  - **Pull on boot**: if a sync code is saved locally, fetch the latest profile in the
    background on load and apply it, then re-render. Local data renders immediately first (no
    blocking on the network) and gets replaced once the pull resolves.
  - **Debounced push on save**: `saveLocal()` (the app's single local-persistence chokepoint,
    already called from every pick/entry/settings change) now also schedules a push to the
    server if a sync code is set, debounced 900ms so rapid clicking doesn't fire a request per
    click.
  - **Conflict handling**: last-write-wins, no field-level merge. Acceptable for a once-a-week
    pick tool used solo or by a couple of people who coordinate by talking to each other; real
    merge logic would be substantial added complexity for low payoff here.
- **UI**: a new header button (⇄) opens a sync dialog with two states — not yet syncing
  (Enable sync / enter-a-code-to-link) and syncing (code display + copy button, sync status with
  last-synced time, stop-syncing action that clears the local code only, without deleting the
  server-side data or affecting other linked devices).

### Not built (intentionally out of scope for this pass)

- No delete/cleanup endpoint for abandoned sync codes — they just sit unused in KV. Fine at
  small scale; would want a TTL or cleanup job before this saw heavier use.
- No merge of concurrent edits from two devices — last write wins, full stop.
- No real identity/auth — see the design-decision note above.
- No rate limiting beyond whatever Vercel's infra applies by default.

### Tests

Added `tests/kv-client.test.js` (KV client against mocked `fetch`), `tests/sync-api.test.js`
(all three endpoints: create/get/put, malformed input, 404s on unknown codes, oversized-payload
rejection, method-not-allowed), and `tests/sync-client.test.js` (frontend network wrapper against
mocked `fetch`). `tests/storage.test.js` gained coverage for the new sync-code and
profile-snapshot helpers.

`npm run check` passes (13 suites). Verified live in a browser with Playwright, mocking
`/api/sync` at the network layer (no live KV store was available to test against in this
environment — this still needs a real smoke test against actual Vercel KV before relying on it):
confirmed end-to-end that (1) enabling sync creates a code and a later pick correctly triggers a
debounced `PUT` with that pick included, (2) linking a fresh device with an existing code pulls
and correctly applies the remote entries/picks, and (3) reloading a device that already has a
saved sync code automatically pulls on boot and applies the latest data — all three matched the
mocked server data exactly with zero console errors.

### Deploy setup

Add "Vercel KV" to the project in the Vercel dashboard's Storage tab (or point
`KV_REST_API_URL`/`KV_REST_API_TOKEN` at any Upstash-compatible Redis REST endpoint). No code
changes needed. Without it configured, `/api/sync` returns a clean 503 and the rest of the app
is unaffected — sync is purely additive.

Files changed: `api/sync.js` (new), `api/_lib/kv.js` (new), `js/sync.js` (new), `js/storage.js`,
`js/app.js`, `index.html`, `css/survivor.css`, `.env.example`, `tests/kv-client.test.js` (new),
`tests/sync-api.test.js` (new), `tests/sync-client.test.js` (new), `tests/storage.test.js`,
`package.json`.

## v1.8.3 — Authoritative 2026 Big Ten Splash schedule

Extended the same fix v1.7 made for SEC (using the pool provider's own game list instead of
naive "any game involving a conference member" filtering) to the Big Ten pool.

- Added `data/bigten-pool-schedule-2026.js`: all 122 games across all 13 weeks, transcribed from
  user-supplied Splash pool screenshots on 2026-08-26 (Week 11 supplied in a follow-up message
  after the initial 5 screenshots, which had jumped from Week 10 straight to Week 12). Weekly
  counts: `14, 15, 11, 9, 8, 8, 7, 6, 9, 8, 9, 9, 9`.
- Extracted the schedule-matching engine (normalize team name → build CFBD candidate map →
  match pool slots → report unmatched slots) out of `data/sec-pool-schedule-2026.js` into a new
  shared `data/pool-schedule-utils.js`, so it isn't hand-duplicated per pool. Refactored the SEC
  file to use it with no change to its public API (all existing SEC tests still pass unmodified
  in behavior, just re-verified).
- `api/survivor-data.js` now applies whichever pool's authoritative schedule exists via a
  `POOL_SCHEDULE_APPLIERS` lookup (`{ sec, bigten }`) instead of an SEC-only `if` branch, and all
  the response text (warnings, `eligibilityRule`, `scheduleSource`, `scheduleRule`) is now
  pool-agnostic rather than hardcoded SEC strings.
- Added generic "schedule gap" detection: if a pool's schedule file is ever missing an entire
  week (as Big Ten's was for Week 11 before it was supplied), the API surfaces a warning instead
  of silently rendering an empty week. This is data-driven off each schedule's declared week
  counts, not a hardcoded pool check, so it will catch a similar gap in any future pool/year too.
- `js/demo-data.js`'s Big Ten demo mode now uses the real Splash schedule (previously fully
  synthetic), with the same gap-detection logic driving its demo warning banner.
- Fixed a bug this surfaced in `js/app.js`: the header chrome ("Splash schedule" badge/subtitle)
  was hardcoded to only ever display for SEC. Added a shared `hasAuthoritativeSchedule(poolId,
  year)` helper (exported from `demo-data.js`, which already imports both schedule files) so
  Big Ten's chrome is now correct too, without a second hand-maintained flag that could drift.
- Team names for Big Ten opponents are stripped of mascots to match CFBD's school-name
  convention (e.g. "Ohio Bobcats" → "Ohio", "Louisiana Ragin' Cajuns" → "Louisiana"). A few
  ambiguous ones (Cal/California, UConn/Connecticut, Louisiana) couldn't be verified against a
  live CFBD response without an API key, so defensive aliases were added for both common
  spellings; if a guess is still wrong, the game surfaces as unmatched in `missing` rather than
  silently breaking, exactly like the SEC schedule already does for ULM/Southern Miss.
- Added `tests/bigten-schedule.test.js`: schedule content/count checks, alias checks, an
  end-to-end handler fixture (confirms an off-schedule Big Ten game is excluded and both a
  Week 3 and a Week 11 listed game are included), and a check that no gap warning fires now that
  all 13 weeks are supplied. Updated the pre-existing Big Ten fixture in `tests/data-model.test.js`
  (it used a game not on the real Splash list, so it now tests the year-2025 naive-filter
  fallback path instead, since that's the path it was actually meant to exercise).

Files changed: `data/bigten-pool-schedule-2026.js` (new), `data/pool-schedule-utils.js` (new),
`data/sec-pool-schedule-2026.js`, `api/survivor-data.js`, `js/demo-data.js`, `js/app.js`,
`tests/bigten-schedule.test.js` (new), `tests/data-model.test.js`, `package.json`.

`npm run check` passes (10 suites). Visually confirmed with Playwright: the Big Ten board
renders the real 13-week schedule with no gaps, the week selector includes 1–13 with no missing
entries, the demo warning banner no longer mentions a Week 11 gap, and the header chrome
correctly reads "Big Ten pool · Splash schedule" / "Listed Big Ten games · either team."

## v1.8.2 — Single source of truth for SEC/Big Ten rosters

Extracted the SEC and Big Ten team lists (and conference display name / CFBD abbreviation)
into a new shared module, `data/pool-teams.js`, imported by both `js/pools.js` (frontend) and
`api/survivor-data.js` (API). Previously each file hardcoded its own independent copy of the
same two team lists — a realignment change or a typo fix had to be made in both places, with
no guardrail if they drifted apart.

- `js/pools.js`'s `POOLS` is now a direct re-export of `data/pool-teams.js`'s `POOL_DEFINITIONS`
  (not a second copy), and `getPool()` delegates to the shared `getPoolDefinition()`.
- Removed the frontend-only `short` field (`'SEC'`/`'B1G'`) from the pool objects since it was
  identical to the already-shared `cfbdConference` field; `app.js`'s one usage (`brandMarkText`)
  now reads `pool.cfbdConference` directly.
- `api/survivor-data.js` now imports `POOL_DEFINITIONS` instead of defining its own `POOLS`.
- Added `tests/pool-teams.test.js`: asserts `js/pools.js` really re-exports the shared object
  (not a coincidentally-matching copy), checks roster length/contents for both pools, and
  checks every rostered team has a `TEAM_META` entry (so the UI never falls back to the
  generic gray/3-letter badge for a real conference member).
- `data/pool-teams.js` added to the `npm run check` syntax-check chain.

Files changed: `data/pool-teams.js` (new), `js/pools.js`, `js/app.js`, `api/survivor-data.js`,
`tests/pool-teams.test.js` (new), `package.json`.

`npm run check` passes (8 suites). Visually confirmed both the SEC and Big Ten Season Boards
still render correctly (all 16/18 teams, correct brand mark "SEC"/"B1G") with no console errors
after switching pools.

## v1.8.1 — Season Plan locked-pick fix + storage cleanup

Two fixes from a code-review pass (no rules, schedule, or scoring-weight changes):

1. **Season Plan silently dropped/reused already-picked teams.** `buildSeasonPlan()` in
   `js/survivor-score.js` fed locked picks (real picks you'd already made for an upcoming
   week) through the same `weekCandidates()` filter used for open weeks, which drops any
   matchup with a null win probability (e.g. the model hasn't priced that game yet). If your
   locked pick had no probability yet, the planner reported that week as "skipped" and — more
   seriously — never added that team to its internal used-team set, so it could recommend the
   same already-burned team again in a later week. Locked picks are now applied directly to
   every beam-search path regardless of model availability, are always marked `locked: true`
   (and `noModel: true` when there's no probability yet), and always occupy their team slot in
   the used-team set. `js/app.js`'s planner rendering (`renderPlanner`) was updated to handle
   `p === null` picks gracefully (excluded from the average/weakest-week stats, shown as
   "Locked · no model data yet" instead of a stray 0%/NaN).
2. **Renamed `storage.js`'s `resetState()` to `resetAllEntriesForPool()`** and documented that
   it wipes every entry in a pool, not just the active one. It was unused dead code (the actual
   "Reset this entry's picks" button already correctly clears only the active entry via
   `syncStateToActiveEntry()` + `saveState()`), but the old name was a landmine for a future
   session that might wire it to a single-entry reset action.
3. Added `tests/season-plan.test.js`, a dedicated regression test for the locked-pick behavior
   (with-model, without-model, and the no-lock/no-model skip case), wired into `npm run check`.

4. Removed the dead `formattedSpread` field from `chooseConsensusLine()` in
   `api/survivor-data.js`. It was always hardcoded to `null` and never read anywhere in the
   frontend (spread formatting actually happens later via `formatTeamSpread()`) — pure
   leftover with no behavior change. Confirmed no other file referenced it before removing.

Files changed: `js/survivor-score.js`, `js/app.js`, `js/storage.js`, `api/survivor-data.js`,
`tests/storage.test.js`, `tests/season-plan.test.js` (new), `package.json`.

`npm run check` passes (7 suites). Visually confirmed both the Season Board and Season Plan
views still render correctly with demo data (spreads/probabilities intact, no console errors)
after the `chooseConsensusLine` cleanup.





## v1.8 — Season Board readability + probability sorting

- Increased Season Board font sizes after user feedback that the v1.3.1/v1.6 compact grid had become difficult to read.
- Desktop rows are now ~52px minimum instead of 48px; mobile rows are ~56px minimum instead of 54px.
- Opponent names, team names, probability values, line/source text, and week headers were enlarged.
- Week headers are now sort controls. Clicking `Week N` orders conference-team rows by that week's displayed win probability, highest first; missing model probabilities go last.
- Clicking the same sorted header again restores canonical pool-team order.
- Sorting does not mutate `pools.js` team order and does not change pool/entry pick state.
- The active sort is visually indicated with a downward arrow and `aria-sort="descending"`.
- Week-header clicks no longer navigate away from the Season Board. Week Rankings remains available through its normal tab.
- Added `tests/grid-sort.test.js` and included it in `npm run check`.

## v1.7 — Authoritative 2026 SEC Splash schedule

- The 2026 SEC Survivor board now uses the exact 106-game schedule supplied from the SplashSports pool.
- Weekly game counts are: `10, 13, 11, 9, 6, 7, 7, 6, 5, 8, 8, 6, 10`.
- Games omitted by the Splash pool are excluded even when an SEC team participates (including omitted non-FBS matchups).
- Either side of every listed game remains selectable.
- CFBD is still used to attach game IDs, true home/away, kickoff, spreads, direct pregame WP, SP+ fallback, and line fallback to the listed pool games.
- If the conference-filtered CFBD schedule misses a listed game, the API supplements from the full regular-season schedule and then re-applies the authoritative Splash filter.
- Big Ten behavior is unchanged in v1.7.

## Product

One application contains two distinct survivor pools:

1. **SEC Survivor** — uses the authoritative 2026 SplashSports pool schedule (106 listed games, Weeks 1–13); either side of each listed game can be picked. Games omitted by Splash are not eligible even if an SEC team participates.
2. **Big Ten Survivor** — any game involving one of the 18 Big Ten teams; either side can be picked.

These are separate pools, not two conferences inside one shared survivor entry. Picks and burned teams never cross between pools.

## Rules

- one pick per week;
- straight-up winner;
- team can only be used once within that entry;
- no double picks;
- **SEC 2026:** a game is eligible only if it is on the supplied SplashSports SEC pool schedule; omitted games are excluded;
- **Big Ten:** a game is eligible when it involves a Big Ten member;
- **either side of an eligible game may be selected**. For SEC, non-conference opponents are selectable only when their game is present on the Splash schedule.

## v1.3 fixes

### 1. Missing probabilities no longer become 0%

There were two JavaScript coercion bugs:

- backend `asNumber(null)` became `0` because `Number(null) === 0`;
- frontend `probabilityFor()` / `fmtPct()` could also convert missing values to zero.

All three paths now explicitly reject null/undefined/empty/boolean values. Missing probability displays as `—`, never `0%`.

### 2. Added SP+ probability fallback

The backend now also requests:

`GET /ratings/sp?year=YYYY`

Probability hierarchy:

1. CFBD `/metrics/wp/pregame` direct probability;
2. SP+ derived probability;
3. consensus spread-derived probability when SP+ cannot rate both teams;
4. unavailable (`null`).

SP+ fallback calculation:

`projected home margin = home SP+ - away SP+ + home-field adjustment`

- home-field adjustment = 2.5 points unless neutral;
- projected margin converts to WP with a normal CDF using 16.0 points as CFB game-margin SD;
- derived probabilities are capped at 1% / 99% to avoid fake certainty.

The UI labels the source as `WP`, `SP+`, `Line`, or `—`. Matchup details show the full source and SP+ ratings when available.

### 3. Fixed Big Ten live-data retrieval

The prior build sent `conference=Big Ten`. CFBD conventionally uses the Big Ten abbreviation `B1G`.

v1.3 uses:

- SEC -> `conference=SEC`
- Big Ten -> `conference=B1G`

If a conference-filtered schedule returns zero games anyway, the backend automatically requests the full regular-season schedule and filters it by the canonical 18-team Big Ten / 16-team SEC list. Lines have a similar full-season fallback.

This removes the conference-name dependency that caused the Big Ten board to load without schedule data.

### 4. Added data coverage diagnostics

`/api/survivor-data` now returns:

```json
{
  "coverage": {
    "gamesFetched": 0,
    "eligibleTeamMatchups": 0,
    "directPregame": 0,
    "spDerived": 0,
    "spreadDerived": 0,
    "missingProbability": 0,
    "spRatingsLoaded": 0
  }
}
```

This makes it much easier to distinguish missing CFBD data from frontend bugs.

### 5. Added tests

`tests/data-model.test.js` validates null handling, SP+ conversion, model priority, spread fallback, Big Ten normalization, and the B1G request parameter.

Run `npm run check` before deployment.

## Main files changed in v1.3

- `api/survivor-data.js` — B1G schedule fix, SP+ fallback, probability hierarchy, coverage diagnostics.
- `js/survivor-score.js` — fixed null-to-zero probability coercion; planner now carries source metadata.
- `js/app.js` — fixed percent formatting and added probability-source labels to grid/rankings/hero/details/planner.
- `css/survivor.css` — probability-source label styling.
- `js/demo-data.js` — compact demo source label.
- `package.json` — v1.3.0 and test runner.
- `tests/data-model.test.js` — new regression tests.
- `README.md` — updated data/model documentation.
- `HANDOFF.md` — this handoff.

## Validation completed

`npm run check` passes, including the Big Ten handler fixture and B1G request assertion.

## First live deployment checks

1. Deploy with the real `CFBD_API_KEY`.
2. Open `/api/survivor-data?year=2026&pool=bigten` directly and confirm `matchups` is populated and `cfbdConference` is `B1G`.
3. Review the returned `coverage` counts for both pools.
4. Spot-check 5–10 future games to confirm cells labeled `SP+` have plausible probabilities.
5. Spot-check spread orientation against known market lines.
6. Revisit the 16.0-point margin-SD and 2.5-point HFA later if we want to calibrate derived WP empirically against historical CFB games.


## v1.3.1 desktop grid density
- Reduced Season Board desktop team/game rows from 72px minimum to 48px.
- Reduced desktop week header height from 42px to 36px.
- Removed the desktop grid max-height so the board no longer creates an unnecessary nested vertical scrollbar.
- Tightened avatar, padding, and metadata sizing on desktop only.
- Mobile row sizing remains unchanged for touch usability.

## v1.4 multiple entries per pool

Each conference pool now supports multiple survivor entries.

### Storage model

v1.4 changes local state from one entry per pool:

```js
{ entryName, picks, currentWeek, season }
```

to:

```js
{
  entries: [
    { id, name, picks }
  ],
  activeEntryId,
  currentWeek,
  season
}
```

- Entries are isolated inside their conference pool.
- Each entry has its own weekly picks and burned teams.
- The active entry drives Season Board states, Week Rankings, the top recommendation, and Season Plan.
- Current viewed week and season remain pool-level UI state.
- Existing `cfb-survivor-state-v2:*` state is automatically migrated to the first v1.4 entry.

### UI

- Added a global **Entry** selector in the header beside Pool.
- Added a `+` action to create a new entry and jump to My Picks for naming.
- My Picks can rename the active entry.
- Added guarded entry deletion with a confirmation dialog; the final entry in a pool cannot be deleted.
- Reset now explicitly clears only the active entry's picks.

### Files changed in v1.4

- `index.html` — entry selector/add control, delete-entry control/dialog, reset copy.
- `css/survivor.css` — entry controls and responsive styles.
- `js/app.js` — active-entry switching, creation, rename, deletion, entry-specific calculations.
- `js/storage.js` — v3 multi-entry storage schema and automatic v2 migration.
- `tests/storage.test.js` — new migration/isolation regression tests.
- `package.json` — v1.4.0 and storage test runner.
- `README.md` / `HANDOFF.md` — documentation.

### Validation

`npm run check` passes both the existing data-model suite and the new multi-entry storage tests.


## v1.5 two-sided eligibility

Pool eligibility is now based on the **game**, not on whether the selected team is a conference member.

- SEC pool: if a game contains at least one SEC team, either team is selectable.
- Big Ten pool: if a game contains at least one Big Ten team, either team is selectable.
- A non-conference team that is selected becomes burned for that entry just like a conference team. If it appears against another pool member later, it cannot be reused.
- The API normalizes every eligible game into two selectable side records with complementary probabilities/spreads.
- Weekly Rankings and Season Plan consume all selectable sides, so non-conference opponents can rank or be optimized into the path.
- The Season Board remains anchored to conference-member rows for compactness. Each cell shows the member side plus the opponent probability/state, and the matchup dialog lets the user select either side.
- The top recommendation can now be a non-conference opponent when its modeled probability/Survivor Score warrants it.
- Header copy now states `conference game · either team`; the eligible-team metric is based on all unique selectable teams in the loaded season, not just conference membership.
- Schedule fallback intentionally fetches the full regular-season schedule without an FBS-only classification filter so FCS opponents remain eligible.

### Files changed in v1.5

- `api/survivor-data.js` — two-sided normalization, eligible-team list, updated fallback coverage.
- `js/app.js` — rankings/planner/metrics accept outside opponents; two-sided matchup picker; grid opponent states.
- `js/demo-data.js` — creates both selectable sides for demo games.
- `js/storage.js` — adds a safe in-memory fallback if browser localStorage is unavailable.
- `index.html` — eligibility copy and second pick-side action.
- `css/survivor.css` — opponent badges and side-comparison UI.
- `tests/data-model.test.js` — regression coverage for non-conference opponent eligibility.
- `package.json` — v1.5.0.
- `README.md` / `HANDOFF.md` — rule/documentation update.

### Validation

`npm run check` passes. The handler fixture confirms an Ohio State–Akron Big Ten-involved game returns **both Ohio State and Akron** as selectable sides.


## v1.6 mobile UX redesign

This release implements the full mobile UX audit from the August 23 screenshot review.

### Mobile changes

1. Rebuilt the Best Play card to prevent text/probability overlap and establish a compact primary decision hierarchy.
2. Removed the Season Board's mobile `max-height`; the page now owns vertical scrolling and the table only scrolls horizontally.
3. Rebuilt the mobile header into labeled Pool / Entry controls plus separate Season and refresh controls while preserving the Survivor brand.
4. Compressed the Season Board heading area; explanatory help is now a disclosure rather than a permanent Tip box.
5. Reduced mobile board rows/columns while preserving 54px row touch targets.
6. Raised small secondary type and reduced excessive heavy-weight text.
7. Added dedicated Week Ranking mobile card layout and actions.
8. Made the matchup dialog pick-first on phones by placing a full-width action inside each eligible side card.
9. Changed the middle decision metric from season-wide `Eligible left` to `Available this week`.
10. Made model-data warnings compact/expandable and fixed plural warning grammar.
11. Added 44px mobile step/select/header controls.
12. Added extra <=390px width refinements.

### Files changed in v1.6

- `index.html` — metric label and collapsible board help.
- `css/survivor.css` — full mobile UX redesign and responsive overrides.
- `js/app.js` — new hero markup, available-this-week metric, ranking mobile content, pick-first dialog actions, expandable status banner.
- `api/survivor-data.js` — plural warning grammar fix.
- `tests/mobile-ux.test.js` — static regression checks for the mobile-specific requirements.
- `package.json` — v1.6.0 and mobile UX test runner.
- `README.md` / `HANDOFF.md` — documentation.

No survivor scoring, SP+ derivation, storage schema, pool eligibility, or season-planner algorithm was changed in this release.

## v1.17.0 — CI + Data Health UI

- Added `.github/workflows/ci.yml` with separate fast and Playwright jobs on pushes and pull requests. CI uses Node 20, `npm ci`, installs Chromium with Playwright dependencies, then runs the existing fast/browser suites.
- Added `js/data-health.js`, a pure trust/coverage model that derives schedule match status, selectable-side probability coverage/source mix, results availability and generation time.
- Added a compact expandable Data Health strip above the recommendation area. Healthy state stays unobtrusive; schedule mismatch or model gaps surface visibly and the details reveal unmatched Splash games and warnings.
- Demo mode now exposes production-shaped coverage/results metadata so Data Health can be reviewed without a live CFBD key.
- Added fast tests for health calculations and CI configuration plus a real browser Data Health test.


## v1.18.0 — Architecture cleanup phase 2

### What changed

- Extracted all four main view renderers from `js/app.js`:
  - `js/views/season-board.js`
  - `js/views/week-rankings.js`
  - `js/views/season-plan.js`
  - `js/views/my-picks.js`
- Extracted the matchup dialog into `js/dialogs/matchup-dialog.js`.
- Extracted shared entry selector/name/delete-control rendering into `js/entry-controls.js`.
- Removed the deliberate `app.js ↔ sync-ui.js` circular import. `sync-ui.js` now exposes `configureSyncUI()` and receives `renderAll`/`loadData` callbacks from `app.js` at boot.
- Reduced `js/app.js` from roughly 1,000 lines after phase 1 to about 700 lines. It now primarily coordinates data loading, shared recommendation/status chrome, events, and application boot.
- Updated the older source-regex tests to concatenate the new view/dialog modules rather than accidentally losing coverage after the extraction.
- Added `tests/architecture-phase2.test.js` to guard the module boundaries and prevent the circular import from quietly returning.

### Why

This finishes the architecture cleanup identified in the v1.14 work queue and creates a much cleaner future PickGauge integration boundary. Survivor-specific views can now move into PickGauge as modules instead of copying a large central `app.js`, while shared CFB data infrastructure can be reconciled separately.

### Behavior intentionally unchanged

No pool eligibility, Splash schedules, two-sided pick behavior, exact planner logic, scoring weights, result status behavior, sync storage model, or Data Health calculations were changed. This is a structural release.

### Validation

- `npm run check` passes after the extraction.
- The fast suite now syntax-checks every new module and includes an architecture-boundary regression test.
- Existing source-based UI tests were updated to include the extracted modules rather than weakening their assertions.
- Existing Playwright browser suites remain the behavioral regression suite for the four views/dialogs. In the ChatGPT sandbox, `npm ci` timed out before Chromium could be installed, so the browser suite could not be re-run locally in this session; GitHub Actions remains configured to run it on push/PR.

### Still open

The next architecture decision should be the PickGauge integration/data-layer plan, not another standalone cleanup pass. General CFBD fetching/results/odds/model infrastructure should ultimately be shared with PickGauge rather than duplicated.
