# Start here — CFB ATS Edge Board

This is a fast-onboarding doc for a new chat session. `handoff.md` has
the full version-by-version history (v4 through v16 as of this writing)
if you need the detailed "why" behind something — read this first, then
grep `handoff.md` for specifics as needed rather than reading it front
to back.

## What this project is

A college-football against-the-spread pick tool for Drew's weekly
pick'em pools. Frontend is `app/index.html` (markup + CSS + a small
inline-script preamble) plus 13 plain, unbundled `<script src="...">`
files it loads -- 3 under `app/data/` (static reference tables) and 10
under `app/js/` (logic split out of index.html over the JS-splitting
pass, now complete -- see that section below for the full list and what
each one covers). NO BUILD STEP, NO BUNDLER -- every file is still just
an ordinary global-scope script, loaded in a fixed order, exactly as if
it were all still inline. See "JS-splitting pass" below before assuming
something lives in index.html itself. Python serverless functions on
Vercel + Upstash Redis + Clerk auth, deployed from GitHub
(`drwanderson7/CFB-ATS-Dashboard`), auto-deploy on push to main. Landing
page at repo root (`index.html`), the actual app lives at `app/index.html`
served at `/app`.

## How Drew works

- Direct, all-caps for emphasis sometimes, pushes back on hedging. Keep
  answers concrete.
- GitHub web editor + Vercel auto-deploy — no local CLI, no `git`
  commands. Always deliver complete, ready-to-paste files, never diffs
  or "run this command" instructions.
- Uses both Claude and ChatGPT across sessions. `chatgptnotes.md` in the
  repo is the cross-AI source of truth for conventions — don't duplicate
  it into a Claude-specific skill (this was explicitly discussed and
  rejected: a second copy of the same knowledge that only one AI can see
  risks silently drifting from the real one).
- **Only updates `handoff.md` when asked.** Don't auto-update it after
  every change — he said so explicitly. This doc (`NEW_SESSION_START_HERE.md`)
  is the exception — always safe to keep current, it's not the detailed
  version log.
- Attach files individually in responses, not zipped, unless he
  specifically asks for a zip. When attaching `app/index.html`, call it
  out by name explicitly — the attachment UI can flatten the path and
  it's been confused with the root `index.html` (the landing page)
  before. Since the JS-splitting pass, this applies doubly to
  `app/js/*.js` and `app/data/*.js` files — the attachment UI flattens
  those paths too, so always say explicitly which folder each one goes
  in (e.g. "this is `app/js/model.js`, goes in a new `app/js/` folder").

## Non-negotiable habits established this project (violating these has caused real bugs)

1. **Verify against the real file, not memory.** Multiple rounds where
   trusting an earlier assumption (about CSS scope, about a field
   surviving an archive function, about what a mock's parameters
   evaluate to) turned out wrong. Grep the actual current file before
   claiming something is or isn't already handled -- and since the
   JS-splitting pass (see below, now COMPLETE), "the real file" for a
   given function is very likely one of `app/js/*.js` (model.js,
   board.js, picks.js, odds.js, settings.js, record.js, tabs.js, sync.js,
   pdf-import.js, pool-contexts.js, prediction-tracker.js, init.js), not
   `app/index.html` -- only a small amount of genuinely shared preamble
   (state setup, DEMO data, general utilities) is still inline. Check the
   pointer comment left behind at the function's old location if unsure.
2. **Test with real execution, not just reasoning.** Playwright
   screenshots for anything visual; Node `vm`-extraction tests (see
   `tests/*.mjs`) that pull the ACTUAL function source out of the real
   file it now lives in (`app/index.html`, or one of `app/js/*.js` post-
   split) and run it, not a hand-copied reimplementation that could
   drift. Same pattern for Python (`tests/test_*.py` monkeypatch
   `kv_get`/`kv_set`/`kv_eval` and run the real handler code).
3. **Run the full test suite after every change, before delivering.**
   Currently 168 checks across 7 files. See "Test suite" below.
4. **Full syntax check on every JS file touched before claiming anything
   works** — `app/index.html`'s inline `<script>` still needs this (see
   the extraction snippet in "Test suite" below for how to pull it out),
   and so does any `app/js/*.js`/`app/data/*.js` file touched, via a
   plain `node --check path/to/file.js`. This has caught real syntax
   errors before screenshots would have.
5. **When inserting a new section into `handoff.md`, use the Python
   script-replace method shown below, not `str_replace`.** `str_replace`
   has twice consumed an adjacent markdown heading by accident when
   inserting a large block, silently corrupting the document structure.
   Always verify afterward with `grep -n "^## " handoff.md` and check for
   `\n\n\n\n` artifacts.
6. **Don't claim something is fixed on the live site.** This sandbox has
   no access to the real Vercel deployment, real Upstash Redis, real
   Clerk auth, or a real Chrome browser profile. Every fix in this
   project is "logic verified, live unverified" until Drew confirms it
   on the real deployment himself. Say so plainly rather than implying
   otherwise. This now also applies specifically to the `app/js/*.js` /
   `app/data/*.js` split files: they've only ever been verified by
   spinning up a throwaway local HTTP server in the sandbox and loading
   `app/index.html` at the exact `/app` path Vercel would use (absolute
   script paths, e.g. `/app/js/model.js`, are load-bearing here -- a
   relative path breaks at that exact URL shape) -- never against the
   real Vercel static-file serving.

## JS-splitting pass -- COMPLETE

`app/index.html` was 4,815 lines / 287KB before this pass started -- one
single inline `<script>` block plus a few genuinely enormous inline data
consts (one was a single 13.6KB line). It's now **1,837 lines / ~114KB**
(38% of the original) and every originally-identified section has been
split out. What moved, in the order it was split out:

- `app/data/pred-systems.js`, `app/data/team-alias.js`,
  `app/data/cover-table.js` -- pure static reference data, zero logic.
- `app/js/model.js` -- the composite probability model: weighted-model
  average, key-number scoring, the fitted cover-margin probability table,
  edge/CLV math.
- `app/js/board.js` -- Board tab AND Snapshot tab rendering. (Despite the
  name, this is NOT just the Board tab -- they were never actually
  separate sections in the source and genuinely share render helpers
  like `mktModelHTML()`. See this file's own header comment before
  assuming Snapshot logic lives somewhere else.)
- `app/js/picks.js` -- making/clearing a pick, the entry list, the
  Compare view, My Picks entry-review (`pickTeam`/`renderEntries`/
  `movePick`/`renderPicksDetail`/etc).
- `app/js/odds.js` -- pulling fresh Vegas lines through the serverless
  proxy (`refreshLines()`) and resolving each device's own sportsbook
  preference from the shared per-book line cache
  (`resolveVegasLine()`/`resolveBookLines()`).
- `app/js/settings.js` -- error redirect to Settings (`goSettings()`),
  local backup export/import (`exportBackup()`/`importBackup()`).
- `app/js/record.js` -- archiving a week's picks (`closeWeek()`), undoing
  that (`restoreWeek()`), manual W/L/P grading (`setResult()`), the
  Record tab's own render (`renderRecord()`).
- `app/js/tabs.js` -- tab switching (`switchTab()` -- drives ALL
  navigation, every tab click runs through this), the mobile nav-tabs
  scroll-fade hint, `syncAll()` (full re-render after a bulk data
  change).
- `app/js/sync.js` -- the client-side half of the atomic-write system
  documented in `api/state.py`: debounced private-tier pushes
  (`scheduleSync()`/`pushState()`), optimistic-concurrency (409) conflict
  handling, and pulling either tier with newer-wins merge logic
  (`pullTier()`/`pullState()`). One of the more sensitive files split so
  far -- the 409/revision handling exists because of a real TOCTOU race
  found and fixed here, not a theoretical one.
- `app/js/pdf-import.js` -- like board.js, broader than its banner name
  ("Powers PDF import") suggests: also contains `teamMatch()` ITSELF, the
  core token-based team-name matcher used throughout the app (grading,
  logo matching, prediction-tracker matching, PDF matching all share this
  one matcher), plus team logos (`applyTeamLogos()`/`fetchTeamLogos()`),
  `applyPdfData()`/`applyPredictions()` (merging PDF/tracker numbers onto
  the board by team match), and `importPowers()` (the actual upload ->
  parse -> merge flow). `api/grade_picks.py` keeps its own separate
  Python copy of team matching, manually synced with this file -- no
  automated drift check exists for that pairing yet.
- `app/js/pool-contexts.js` -- the Context Bar (Pool/Entry/Week switcher
  -- `initContextBar()`'s click-outside-to-close deliberately uses
  `composedPath()` rather than `bar.contains()`, fixing a real bug where
  a week-nav click inside the switcher re-renders and detaches itself
  from the DOM, which used to close the switcher on its own navigation
  clicks) and Splash/OFP pool sheet import (`importPool()` and helpers,
  including `extractPdfTextLines()` -- client-side pdf.js text
  extraction, NOT server-side like the Powers newsletter, since a Splash
  export can be ~23MB and Vercel's serverless body cap is 4.5MB).
- `app/js/prediction-tracker.js` -- fetching thepredictiontracker.com's
  CSV (`fetchPredictions()`, same freshness-window-reuse pattern as
  `refreshLines()` in odds.js) and the Prediction Systems settings panel
  (`renderSystemsSettings()`/`setWeight()`/`bindWeightInput()` -- the
  ~40-system checklist plus BP/Comp/Vegas core weights).
- `app/js/init.js` -- the LAST file split, and the only one handled
  differently from the rest. Contains `clearColumn()`, `init()` (all DOM
  event-listener wiring + the first render pass), `rehydrateAfterSync()`,
  and the DEFINITIONS of `initErrorBoundary()` and `bootstrap()` -- but
  NOT their invocations. Every other split file moved 100% of its code
  because everything in them was lazily-called function bodies with no
  immediate top-level execution. This section is different:
  `initErrorBoundary()` is called as the literal FIRST statement of the
  whole app (must run before anything else, including the main script's
  own early setup) and `bootstrap()` is called as the literal LAST
  statement (the actual entry point). Both invocations were deliberately
  left in place in `app/index.html` itself -- only their function
  DEFINITIONS moved to init.js. See init.js's own header comment for the
  full reasoning and a diagram of exactly where each piece lives. This
  ordering was verified for real, not just reasoned through: forced an
  actual error inside `init()`'s own execution (overrode
  `document.getElementById` to throw) and confirmed the error boundary
  still caught it, proving `initErrorBoundary()` really is registered
  before `init()` can run, exactly as before the split.

Every one of these is loaded as a plain, unbundled
`<script src="/app/js/whatever.js">` tag (absolute path, not relative --
the page is served at the exact path `/app` with no trailing slash, so a
relative path would resolve wrong) placed before the main inline script,
in an ordinary global scope -- NOT ES modules, no bundler, no build step.
This only works because nothing in any split-out file does top-level
evaluation against a global defined elsewhere (`state`, `myNumber()`,
`activeEntry()`, etc.) -- every such reference is inside a function body,
resolved lazily at call time, long after every script on the page has
loaded (init.js is the one exception, handled as described above).
Verify that constraint by hand for anything moved into one of these
files in the future; nothing enforces it automatically.

Test files were updated in lockstep: `tests/*.mjs` extract real function
source from whichever file it now actually lives in (`src` = index.html,
`modelSrc`/`boardSrc`/`picksSrc`/etc = the split files), never a
reimplementation. Several tests deliberately stub real functions these
split files also declare (`myNumber`, `activeEntry`, `edgeClass`,
`renderPicksDetail`) -- pulling a whole split file's content into those
specific tests would silently clobber the stub, since a `function`
declaration overwrites an existing same-named global in a `vm` context
(a `const` doesn't). Those tests extract only the specific function they
need instead. Worth knowing before adding a new test against any of
these files.

`app/index.html` now contains: the `<head>`/CSS/HTML markup, the
still-inline preamble (state setup, DEMO data, general utility functions
like `esc()`/`fmt()`/`round1()`, and a handful of functions genuinely
shared across split files that were never worth their own file), the
`<script src>` loader tags for all 13 split files, and the two order-
critical invocation lines described above.


```python
python3 -c "
with open('handoff.md') as f:
    content = f.read()
with open('/tmp/new_section.md') as f:
    section = f.read()
anchor = '## Known open items (...)'  # exact current heading text
assert content.count(anchor) == 1, 'anchor not unique!'
content = content.replace(anchor, section + anchor)
with open('handoff.md', 'w') as f:
    f.write(content)
"
```
Then verify: `grep -n "^## " handoff.md` (check heading count/order) and
confirm no `\n\n\n\n` artifact.

## Test suite (168 checks as of the JS-splitting pass)

```
python3 tests/test_state.py           # 36 — auth, atomic CAS, ownership, concurrent pool publishing
python3 tests/test_grading.py         # 24 — grading, provider game IDs
python3 tests/test_auth_sync.py       # 20 — cross-file drift detection
node tests/test_client_logic.mjs      # 15 — sportsbook resolution, EV
node tests/test_snapshot_logic.mjs    # 57 — Snapshot tab logic
node tests/test_mypicks_logic.mjs     # 12 — My Picks entry-review logic
node tests/test_pdf_error_handling.mjs # 4 — pdf.js failure messaging
```
Run all of these, every time, before delivering anything. No CI exists
yet (`npm test` / GitHub Actions is still an open item) — this is
manual, on purpose, until that's built.

**Test coverage gap worth knowing:** the v16 features (Context Bar, global
error boundary, Weekly Setup's context-aware logic) have ZERO automated
coverage above — they were verified via real Playwright renders during
the session that built them, not added to the permanent suite. Don't
assume "168 passing" means those are protected against a future
regression the way `mktModelHTML()` or the shared-key CAS logic are.

## Current architecture, briefly

- **Private vs shared Redis tiers**: private (picks, entries, pools,
  BP/Comp inputs) is per-user via Clerk JWT-derived keys. Shared
  (odds/predictions/published pools) used to be ONE combined bucket
  everyone reads and writes — as of v16 it's THREE independent keys
  (`edge_board_shared_odds`/`_predictions`/`_pools`), specifically so
  `fetch_odds.py` and `fetch_predictions.py` can't clobber each other's
  writes anymore (they used to, silently). Both private writes AND pool
  publishing are genuinely atomic (Lua/EVAL compare-and-set via Upstash's
  REST API, see `cas_write()` in `api/state.py` and `api/grade_picks.py`
  — duplicated across both files since Vercel functions can't share
  imports; a drift-check test in `test_auth_sync.py` keeps them in sync).
  Odds and predictions writes are plain `SET`s on their own dedicated key
  (no CAS needed for those two specifically — see handoff.md's v16
  section for why that's safe). `GET scope=shared` merges all three keys
  into one flat response so the client didn't need to change at all, with
  a read-only fallback to the old combined key for anything not yet
  under its new key.
- **Grading** matches picks to final scores by The Odds API's own stable
  event ID first (`providerGameId`, added in v13), falling back to
  team-name matching for older picks or unmatched games.
- **Four tabs + three header icons, shared computation**: Snapshot
  (quick-scan default view), Edge Board (the original dense table), My
  Picks, and Record are the tab bar now — Settings/Help/Account moved out
  to three circular icon buttons in the header (v16) rather than
  competing for tab-bar space. All board-rendering call the same
  `edgeOf()`/`myNumber()`/`clvOf()`/`probabilityCoverForGame()` — never
  fork Snapshot-specific versions of these. Snapshot has its own
  dedicated mobile CSS scoped to `#tab-snapshot` — the full board's
  mobile CSS is scoped to `.board` — these were unscoped and colliding
  until v12, don't reintroduce that.
- **Global Context Bar** (v16): `#contextBar`, shared across every tab
  the same way `#setupNotice` (Weekly Setup) is, shows "Pool · Entry ·
  Week" + a status line, click to open a 3-column switcher. Replaced two
  separate DOM copies of Context/Entry dropdowns that used to exist
  (Snapshot and Board each had their own). If you're adding a new
  Pool/Entry/Week-dependent control anywhere, it almost certainly belongs
  reading from this, not a new dropdown.
- **UI passes**: v8 (palette/hierarchy/buttons/badges), v9 (Snapshot
  layout restructure), v10 ("de-AI" — corner radii, de-badging, less
  uppercase), v11 (My Picks entry-review workspace), v12 (mobile CSS bug
  fix), v16 (green-audit — active/current-location chrome no longer
  colored the same as positive/actionable states; Top Opportunities
  primary-action + size hierarchy). Pass items still open: model-
  agreement indicator, pool-vs-market callout (neither needs season data,
  despite earlier notes saying otherwise), entry review warnings, Results/
  learning dashboard (that one DOES need real season data), and the
  biggest remaining visual item — a general pill/badge/rounded-card
  density reduction, deliberately sequenced last.

## Known open items worth knowing immediately

Full list is in `handoff.md`'s "Known open items" section (26 items as of
v16), but the two biggest:
1. **Atomic CAS logic — including the v16 shared-pools CAS — is proven
   correct against a mock, not against real Upstash.** No live
   credentials available in this environment to test against the real
   database.
2. **First real-season live test** hasn't happened yet — still the
   single highest-value remaining validation step, and can't be done
   from this sandbox.

Also: Drew mentioned a GitHub Actions check showing a red X next to
"Test snapshot" — this was reported but not yet investigated (no CI
exists in this repo yet, so it's unclear what check that actually is;
may be a Vercel deployment check surfaced in GitHub's UI, not a repo
test). Ask for a screenshot or more detail before assuming what it is.
