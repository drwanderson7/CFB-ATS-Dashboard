# PickGauge -- current state

Short, present tense. Updated September 30, 2026 (second pass). The full dated history (every change, test counts, bug post-mortems,
the older "work already complete" lists and the cross-AI corrections log) is in `docs/CHANGELOG.md`. Code comments that
say "see CURRENT_STATE.md's dated entries" mean that file. Trust the source over any note.

## What it is
PickGauge (pickgauge.com) is a college-football ATS analytics app for pool players. It shows where a weighted Model #
disagrees with the market, tracks picks across ATS pools, Confidence pools and Survivor pools, and grades results and
closing-line value. One developer/owner (Drew). Vercel Hobby plan.

## Stack and layout
- **Frontend:** static, vanilla JS in one global scope. Sources: `app/index.html`, `app/js/*.js` (28, incl. the Survivor core bridge), `app/data/*.js` (3),
  `app/css/*.css` (2), `app/survivor-core/` (ES modules). Self-hosted pdf.js in `app/vendor/pdfjs/`.
- **Built files (`app/dist/`, committed):** page load = `app.min.js` (+map) and `app.min.css`. Survivor is LAZY: `survivor.min.js`
  (its two classic scripts), `survivor.min.css` and `survivor-core.min.js` (ES modules) are fetched the first time the Survivor tab
  opens. `index.html` references only the two page-load files. All are generated from the sources by `scripts/build.sh` (esbuild;
  build-only dependency in `scripts/build/`, never installed by Vercel). `scripts/build/manifest.json` is the single source of
  truth for script order and for which files are lazy.
- **Survivor is lazy:** `pgLoadSurvivor()` / `pgShowSurvivor()` (`app/js/tabs.js`) load the three Survivor files on first tab open (and warm on
  hover/focus/touch of a Survivor nav button), show a loading card, and show a retry card if a file is blocked (failures aren't cached;
  a failed module import retries with a fresh URL). Only `tabs.js` calls into Survivor (guarded), plus `main.js` keeping `state.survivor`
  an object. The one CSS rule that hides the ATS bar on the Survivor tab lives in `app.css` so nothing flashes while Survivor CSS loads.
- **pdf.js is lazy:** `pgLoadPdfJs()` (`app/js/pool-contexts.js`) loads it on first PDF use / when a PDF file picker opens.
- **API (Vercel Python, `api/`):** `state.py` (private per-user + three shared Redis domains, Lua compare-and-set),
  `fetch_odds.py` (The Odds API), `fetch_predictions.py` (ThePredictionTracker), `fetch_cfbd.py` + `cfbd_survivor_enrichment.py`
  (CFBD), `fetch_teams.py`, `grade_picks.py` (daily cron 14:00 UTC), `parse_pdf.py` (Brad Powers PDF, pdfplumber),
  `parse_pool.py` (Splash pool sheets), `public_snapshot.py` (logged-out preview), `beta.py` (feedback + analytics).
  No shared imports between functions: helpers are duplicated on purpose and drift-tested.
- **Auth/data:** Clerk (JWT verified server-side); Upstash Redis via REST. `vercel.json`: function timeouts, the cron,
  security headers + CSP (`script-src 'self'` + Clerk), `no-cache, must-revalidate` for `/app/js`, `/app/css`, `/app/dist`.

## How to work in this repo
1. **Edit sources, never `app/dist`.** After ANY change to `app/js`, `app/data`, `app/css` or `app/survivor-core`, run
   `scripts/build.sh` and ship the whole `app/dist/` folder with the change. `tests/test_bundle_in_sync.mjs` fails if it's stale,
   and the browser tests run the built files.
2. **Tests:** `scripts/test_all.sh --fast` (150 files, no browser) must pass. The full run adds Chromium E2E
   (`tests/test_e2e_*.py`, every `/api/*` call mocked). Known failures, identical on the unmodified Sept 16 zip:
   `test_e2e_mobile_ux.py`, `test_e2e_pools_hides_shared_widgets.py`, `test_e2e_weekly_setup.py`, `test_e2e_ui_behaviors.py`
   (old monolith, candidate for deletion).
3. **Verify UI changes in a real browser** with measured geometry at 390px and 360px plus desktop. Source-level checks alone
   have missed real bugs here.
4. **Delivery:** Drew currently asks for zips of the changed files only, paths preserved. GitHub's upload never deletes files,
   so list deletions explicitly. The to-do list lives in chat, not in the repo; session-summary and to-do files were deleted
   on purpose -- don't recreate them.
5. **Docs:** update this file (present tense) and add a dated entry at the top of `docs/CHANGELOG.md` with each delivery.
6. **CSS:** append-only override blocks create dead code. Run `node scripts/build/css-audit.mjs` occasionally (`--fix` to
   remove). Many CSS tests assert source text, so removals can delete their anchors. A `hidden` attribute loses to
   `.btn{display:inline-flex}` unless the selector forces `display:none`.

## Product surfaces
- **This Week:** top ATS edges (Edge / Cover % ranking), "Rest of slate" list without the top-card games, one All Games link.
  Lines and model predictions load automatically when the shared copy is stale (sign-in and tab resume; same freshness gates
  as the buttons, so no extra API quota). Header Refresh is a secondary control (hidden on Survivor and Results).
- **All Games** (with My Picks and Pools subviews): full slate, Model # recipe (TeamRankings 20, Vegas Live 19, Sagarin Points
  18, SP+ 16, Waywardtrends 15, Sagarin Ratings 12), Cover % fitted on 5,705 FBS-vs-FBS games (2018-2025), custom numbers,
  matchup breakdown. Phone rows are compact: recommendation card first, both teams side by side, recommended side outlined.
- **Results:** "Your record" (ATS record, avg CLV, graded count, per-entry rows when there are several entries) -> the latest week
  (expanded) -> older weeks (folded, record in the header) -> "Performance analytics" (folded until 10 graded picks, then open; the
  person's own fold choice sticks). Filters only appear with 2+ weeks. Each pick shows a result chip (W / L / P / Pending) with
  "Edit result" / "Set result" revealing the W/L/P buttons. "Check results now" is a small header button.
- **Picks and grading:** picks freeze the line, edge, model inputs and kickoff at pick time. Finished weeks move to Results
  automatically (every pick's kickoff known, latest game +5 h, no other game that Tue-Mon week still upcoming); restoring a
  week holds it. Grading reads archived history only (cron + "Check results now").
- **Confidence pools:** ATS-graded; Submit writes the week to entry history.
- **Survivor:** pools SEC, Big Ten, KellyInVegas (2 picks), KellyCFB Week 2, plus custom pools. Engine in
  `app/survivor-core` (survivor score, exact season-path optimizer, scarcity, portfolio). Win probability per side: CFBD
  pregame WP, else SP+ (margin = SP+ diff + 2.6 home field, normal curve SD 16, clamped 1-99%), else the line. Cells show the
  real line, or "≈" the SP+ projected spread when no line exists. Season Board starts at the current pool week (finished
  weeks drop off; toggle brings them back). Weekly Snapshot has a one-tap Use/Switch button. Phones open on Week Rankings.
  History pick grid includes planned future picks. Durable picks live in `state.survivor` (per-user sync); navigation state
  is device-local.
- **Phone shell:** one-row header (Feedback is in the menu), secondary buttons have visible outlines, pre-slate controls are
  compact.

## Known gaps
- Survivor does not block picks after kickoff; survival math assumes independence; SD 16 and home field 2.6 are untested.
- Long-open tabs don't refresh Survivor data until reload / Fetch results.
- 4 stale browser tests (above). Brad Powers rotation numbers, Sagarin direct fetch and an SP+ backtest are unbuilt.
- Before/through the season: email sign-in smoke test, real-device (iPhone/Android) pass, live CFBD / closing-line validation.

## Lessons worth keeping
- Re-verify "can't run here" notes instead of copying them forward; keep roadmap content in one place only.
- CSS grid placement only works on direct `<tr>` children; content nested in one `<td>` can't move after another `<td>`.
- Playwright request interception disables the HTTP cache, so warm-load timing through `page.route` is meaningless.
- Code in the lazy Survivor bundle doesn't exist until the tab opens: tests (and any new code) must open the tab and wait for
  `renderSurvivorShell` before touching Survivor globals, and must not read its constants (e.g. the storage key) before that.
- Powers schedule pairs: in each of the Open / Current / BP columns the favorite's row holds the spread and the other row holds the
  TOTAL, and the favorite can differ between columns. Each column must find its own spread row (`_spread_side()` in `api/parse_pdf.py`);
  never read BP from the row the Current column picked.
- Replacement edits have twice dropped a function signature line; tests that load files as real JavaScript catch it.

## Where things are
`docs/CHANGELOG.md` history | `handoff.md` older version log | `NEW_SESSION_START_HERE.md` onboarding (partly stale) |
`README.md` | `PICKGAUGE_LAUNCH_CHECKLIST.md` | `DNS_EMAIL_SETUP.md` | `MODEL_DATA_PACKAGE_2026-09-01.md` | `docs/SURVIVOR_*` acceptance.
