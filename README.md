# PickGauge — CFB ATS Decision Dashboard

[![Tests](https://github.com/drwanderson7/CFB-ATS-Dashboard/actions/workflows/tests.yml/badge.svg)](https://github.com/drwanderson7/CFB-ATS-Dashboard/actions/workflows/tests.yml)

*(Renamed from "Edge Board" — see handoff.md's rename note if you're
looking at an older reference to the old name anywhere.)*

A college-football against-the-spread pick tool: live Vegas lines, ~40
computer prediction systems, Powers-newsletter numbers, and pool tracking
with closing-line value, weighted into one number per game so you can
scan a slate fast and pick with less manual spreadsheet work.

This is a small, independently-run side project, not a commercial product.
It's informational only — it doesn't take bets, hold money, or guarantee
any outcome. See [`/terms.html`](./terms.html) and
[`/responsible-play.html`](./responsible-play.html) once deployed.

## What's in this repo

```
index.html              Landing / marketing page, served at "/"
privacy.html             Privacy policy
terms.html                Terms of service
responsible-play.html      Responsible-play resources
contact.html                 Contact page
favicon.svg

app/index.html           The app shell -- served at "/app". Markup, CSS,
                          and a small inline-script preamble (state setup,
                          DEMO data, general utilities). NOT a single
                          large file anymore as of the v17 JS-splitting
                          pass -- it loads 15 plain, unbundled
                          <script src="..."> files (absolute paths,
                          since "/app" has no trailing slash and a
                          relative path would resolve wrong there). No
                          build step or bundler was introduced by that
                          split -- every one of those files is still an
                          ordinary global-scope script, loaded in a
                          fixed order, functionally identical to being
                          inline. If you're looking for a function and
                          it's not in app/index.html, check the one-line
                          pointer comment left at its old location -- it
                          names the exact file it moved to.
app/data/                 Static reference data (3 files)
  pred-systems.js            Prediction Tracker system code -> display name
  team-alias.js               Team-name alias table (kept in sync BY HAND
                               with api/grade_picks.py's own copy --
                               tests/test_team_match_parity.py protects
                               this pairing, see "Running the tests" below)
  cover-table.js               The fitted cover-margin probability table
app/js/                   App logic (18 files)
  api-client.js               Authenticated fetch/error classification helper
  beta.js                     First-party aggregate analytics, feedback modal,
                               and admin beta-summary UI
  dialogs.js                  Reusable Promise-based PickGauge modal layer;
                               replaces native alert/confirm/prompt flows
  model.js                    Composite probability model: weighted-
                               model average, key-number scoring, the
                               cover table, edge/CLV math
  my-numbers.js               Private personal projected spreads: inline
                               manual entry, CSV import/template, matching
                               review, and independent My Edge calculation
  cfbd-insights.js            CFBD live scoreboard + CORE/SP+/FPI/Elo/SRS
                               context; shared cached reference data only
  board.js                    Board tab AND Snapshot tab rendering (they
                               share real render helpers, never split)
  picks.js                     Picks/entries, My Picks, Compare view
  odds.js                       Vegas line refresh, per-device book
                                 preference
  settings.js                    Settings I/O, backup export + account-level restore
  record.js                       Week archive/restore, manual grading
  tabs.js                          Tab switching, full re-render
  sync.js                           Cross-device sync -- debounced
                                     private-tier pushes, 409 conflict
                                     handling, shared-tier pulls
  pdf-import.js                      teamMatch() itself (used throughout
                                      the app, not just PDF import), team
                                      logos, Powers PDF import,
                                      predictions merge
  pool-contexts.js                    The Context Bar (Pool/Entry/Week
                                       switcher), Splash/OFP pool import
  prediction-tracker.js                thepredictiontracker.com fetch,
                                        the Prediction Systems panel
  init.js                               Event wiring, bootstrap, error
                                         boundary -- the only split file
                                         where two invocations
                                         (initErrorBoundary()/bootstrap())
                                         deliberately stayed behind in
                                         app/index.html itself; see this
                                         file's own header comment
  main.js                               Core global state normalization,
                                         persistence helpers, context accessors,
                                         and remaining shared utilities

api/                      Vercel Python serverless functions
  fetch_odds.py             Live Vegas spreads (The Odds API), writes the
                             shared odds cache
  fetch_predictions.py       Prediction-system data (thepredictiontracker.com
                              CSV), writes the shared predictions cache
  fetch_teams.py              CFBD canonical team/game identity + logos
  fetch_cfbd.py               CFBD live scoreboard + power-rating proxy/cache
  parse_pdf.py                  Parses a Brad Powers newsletter PDF into
                                 BP/Comp numbers
  parse_pool.py                 Parses a Splash Sports / OFP pool sheet
  grade_picks.py                 Auto-grades picks (daily cron) + manual
                                  "check results now". Own copy of
                                  team_match()/TEAM_ALIAS, hand-synced
                                  with app/js/pdf-import.js +
                                  app/data/team-alias.js
  state.py                        Private per-user state (picks, entries,
                                   pools, inputs) + the three shared-data
                                   keys (odds/predictions/pools)
  beta.py                         First-party aggregate product analytics,
                                   beta-feedback storage, and admin-only views

tests/                    63 permanent test files; run via
                          scripts/test_all.sh -- CI runs the full suite on
                          every push/PR (see "Running the tests" below)

handoff.md                Full version-by-version project history --
                           read this for the detailed "why" behind
                           anything non-obvious in the code
chatgptnotes.md           Cross-AI (Claude ↔ ChatGPT) working notes --
                           practical advice for whichever AI picks this
                           project up next
NEW_SESSION_START_HERE.md  Fast-onboarding doc for a new chat session --
                            read this FIRST, then grep handoff.md as needed
CURRENT_STATE.md          Concise current source of truth: completed reliability
                           work, current test status, and remaining priorities

vercel.json               Function timeouts + the daily grading cron
requirements.txt          Python dependencies for api/*.py
```

## Architecture, briefly

- **No build step, no bundler.** `app/index.html` (markup/CSS/a small
  inline-script preamble) loads 15 plain `<script src="...">` files from
  `app/data/` and `app/js/` -- every one of them is still an ordinary
  global-scope script, edited and deployed exactly as-is, no compile
  step. See the file tree above for what's in each one.
- **Auth**: [Clerk](https://clerk.com) (email/password). The app never
  sees or stores a password itself.
- **Storage**: [Upstash Redis](https://upstash.com), accessed via its REST
  API (no Redis client library — plain HTTP calls, see `_kv_creds()` /
  `kv_get()` / `kv_set()` in `api/state.py`).
  - **Private tier** (one key per signed-in user): picks, entries, pools,
    PDF-derived BP/Comp inputs, weights. Writes are atomic (Redis-side
    Lua `EVAL` compare-and-set — see `cas_write()`/`CAS_SCRIPT` in
    `api/state.py`), so two devices writing near-simultaneously can't
    silently clobber each other.
  - **Shared tier** (same data for every signed-in user): live odds,
    prediction-system averages, and any pool published for "share for
    testing." Split across three independent keys
    (`edge_board_shared_odds` / `_predictions` / `_pools`) rather than one
    combined blob, specifically so two different endpoints refreshing at
    the same time can't overwrite each other's write. Pool publishing
    additionally uses the same atomic CAS as the private tier, since it's
    a genuine multi-writer list merge, not a simple replace.
- **Deployment**: [Vercel](https://vercel.com), auto-deploys on push to
  `main`. Each file in `api/` is an isolated serverless function — Vercel
  doesn't reliably support importing a sibling module across them, so a
  few small pieces (`verify_user()`, the KV REST helpers) are deliberately
  duplicated across files rather than centralized. `tests/test_auth_sync.py`
  diffs `verify_user()` across all nine authenticated files and fails if they drift, so
  that duplication doesn't have to be kept in sync by hand.

## Environment variables (set in Vercel's project settings)

| Variable | Used for |
|---|---|
| `CLERK_JWKS_URL` | Verifying signed-in users' session tokens |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis REST API — or the `UPSTASH_REDIS_REST_*` / `STORAGE_KV_REST_API_*` equivalents, depending on how the Upstash integration was installed (all three naming schemes are checked, see `_kv_creds()`) |
| `ODDS_API_KEY` | Shared fallback Odds API key (each person can also add their own in Settings, sent as an `X-Odds-Api-Key` header instead) |
| `CFBD_API_KEY` | CollegeFootballData.com canonical identity, live/final scores, and power-rating context |
| `PICKGAUGE_ADMIN_UIDS` | Comma-separated Clerk User IDs allowed to publish/unpublish shared pools, force CFBD refreshes, and view beta analytics/feedback |
| `MIGRATION_ADMIN_SECRET` | Gates the one-time legacy-account migration endpoint — not a per-user secret |
| `CRON_SECRET` | Vercel's own cron-authentication convention, verifies the daily grading job actually came from Vercel's scheduler |

None of these belong in the code. The one key that *is* safe to commit is
Clerk's **publishable** key in `app/index.html` — that's meant to be
client-visible, unlike a secret key.

## Running the tests

CI (`.github/workflows/tests.yml`) runs the full suite automatically on
every push to `main` and every pull request -- see the badge at the top
of this file. Current repo: **63 permanent test files**; the fast local
variant runs **62 non-browser files** and skips only the Playwright E2E file.
To run everything locally, same as CI does:

```
scripts/test_all.sh
```

`scripts/test_all.sh --fast` skips `test_e2e_ui_behaviors.py` (the one
real-browser test, and by far the slowest file here) for a quicker local
check; CI always runs the full set. Every file still runs regardless of
an earlier one failing, and the script's own exit code is nonzero if any
file failed -- the failed-file list prints at the end.

Individually, in case you want to run just one:

```
python3 tests/test_state.py             # private/shared state, atomic CAS, pool publishing, sharedUpdatedAt regression
python3 tests/test_grading.py           # grading, provider + CFBD game IDs
python3 tests/test_cfbd_identity.py      # canonical CFBD team/game identity + cache
python3 tests/test_cfbd_insights.py      # live scoreboard/ratings merge + CFBD-first grading
python3 tests/test_auth_sync.py         # cross-file auth-code drift detection (across api/*.py)
python3 tests/test_team_match_parity.py # cross-LANGUAGE drift detection: the real JS teamMatch()
                                         # (app/js/pdf-import.js + app/data/team-alias.js) and the
                                         # real Python team_match() (api/grade_picks.py) must agree
                                         # on a shared corpus of team-name pairs, plus a direct
                                         # TEAM_ALIAS/SIGNIFICANT_TOKENS comparison. Shells out to
                                         # `node` internally (tests/_team_match_js_runner.mjs).
python3 tests/test_error_shapes.py      # pins the error/message-key convention apiFetch()'s
                                         # classifyApiError() depends on to tell a real Clerk-auth
                                         # 401 apart from a missing/rejected feature key
python3 tests/test_rate_limits.py       # the fixed-window rate-limit Lua script proven correct
                                         # against a faithful simulation, plus the odds/predictions
                                         # freshness-gate decision logic
python3 tests/test_vercel_headers.py    # static check on vercel.json's security headers
python3 tests/test_api_no_store_headers.py # every API JSON response explicitly opts out of caching
python3 tests/test_pdf_upload_hardening.py # %PDF- signature gate + pdfplumber resource close
python3 tests/test_sitemap_social_metadata.py # public sitemap + 1200x630 OG/Twitter share card
python3 tests/test_beta_analytics_feedback.py # first-party analytics/feedback backend + privacy/admin wiring
node tests/test_beta_client_logic.mjs   # coarse client event payloads; app_open once per page
python3 tests/test_no_raw_exceptions_in_500s.py # static internal-exception redaction guard
python3 tests/test_upstream_error_redaction.py  # CFBD/Odds raw response bodies never reach the browser
python3 tests/test_pre_kick_lines.py            # retained true pre-kick market-history behavior
python3 tests/test_odds_freshness_logic.py      # server kickoff-aware 30/15/10/5-minute freshness windows
python3 tests/test_e2e_ui_behaviors.py  # REAL BROWSER test (Playwright + Chromium) -- Context Bar,
                                         # Weekly Setup, the global error boundary, and that both
                                         # are correctly hidden on Pools/My Picks/Results
node tests/test_client_logic.mjs        # sportsbook resolution, EV math
node tests/test_snapshot_logic.mjs      # Snapshot tab logic
node tests/test_mypicks_logic.mjs       # My Picks entry-review logic
node tests/test_pdf_error_handling.mjs  # pdf.js failure messaging
node tests/test_pools_page_logic.mjs    # Pools tab: lock-status label, row HTML, and the actual
                                         # state mutations of archive/unarchive/delete/edit-pick-limit
node tests/test_context_bar_logic.mjs   # pure decision logic behind the Context Bar
node tests/test_weekly_setup_logic.mjs  # pure decision logic behind the Weekly Setup checklist
node tests/test_shortlist_logic.mjs     # shortlist scoping and toggle logic
node tests/test_refresh_fallback_logic.mjs # odds/predictions survive shared-cache failure
node tests/test_sync_revision_logic.mjs # server revision beats browser-clock skew
node tests/test_model_agreement_logic.mjs # transparent X/Y model agreement
node tests/test_entry_workflow_logic.mjs # Draft/Ready/Submitted lock workflow
node tests/test_results_analytics_logic.mjs # frozen-snapshot Results metrics/buckets
node tests/test_cfbd_insights_logic.mjs # My Picks live ATS status + ratings panel wiring
node tests/test_odds_freshness_client.mjs # client kickoff-aware freshness windows
node tests/test_dialog_migration.mjs    # shared modal API + zero native browser dialogs
node tests/test_script_paths.mjs        # deployment-shape: every <script src> in app/index.html
                                         # resolves to a real file, every one of those files passes
                                         # node --check, and no app/js|data/*.js file exists without
                                         # a loader tag pointing at it -- protects against a silent
                                         # typo/rename breaking production now that the app is split
                                         # across 16 external files.
```

Not part of the automated suite (underscore-prefixed, deliberately excluded
from `scripts/test_all.sh` and CI):

```
tests/_render_*.py                    # one-off Playwright verification scripts, run by hand
                                       # during a working session, not permanent regression coverage
tests/_team_match_js_runner.mjs       # internal helper shelled out to BY test_team_match_parity.py
tests/_live_cas_concurrency_test.py   # hits a REAL production URL with a REAL Clerk session token --
                                       # manual-only, needs live credentials CI doesn't have. See the
                                       # file's own docstring for how to run it yourself.
```

Also worth running after touching any `app/js/*.js`, `app/data/*.js`, or
`app/index.html`'s own inline script:

```
node tests/test_script_paths.mjs
```

That single command now covers what an ad-hoc `re.search(r'<script>...')`
snippet used to do by hand before the JS-splitting pass -- and does it
correctly. (A version of that exact snippet used to live in this README;
it broke silently once the split added more `<script>` tags, since a
greedy regex match spans from the FIRST `<script>` tag in the file to the
LAST `</script>`, not the one specific inline block intended -- swallowing
every loader tag and comment in between. `test_script_paths.mjs`
doesn't have that problem, since its regex only ever matches one
`<script ...>` opening tag at a time (non-greedy up to the first `>`),
never spanning multiple tags, and it's an actual maintained test rather
than a paste-and-forget snippet, so use that instead.)

These tests instantiate the real handler classes and run the actual
production code paths against a mocked Redis/Clerk backend — not
reimplementations of the logic that could silently drift from the real
file. See `chatgptnotes.md` for the extraction technique if you're adding
a new one.

## Deploying

Push to `main` — Vercel auto-deploys. There's no separate staging
environment; everything in this repo is verified against a mocked
backend in development, not a live redeploy, so treat any given change as
"logic verified, live unverified" until you've actually checked it
against the real deployment yourself.

## Where to start

If you're a person: `NEW_SESSION_START_HERE.md`.
If you're an AI picking this project up in a new session: same file, then
`handoff.md` for full detail, then `chatgptnotes.md` for working notes
specific to this codebase's quirks.
