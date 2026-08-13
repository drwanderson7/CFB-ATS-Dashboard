# Edge Board — CFB ATS Decision Dashboard

A college-football against-the-spread pick tool: live Vegas lines, ~40
computer prediction systems, Powers-newsletter numbers, and pool tracking
with closing-line value, all averaged into one number per game so you can
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

app/index.html           The actual tool -- served at "/app". Single file:
                          inline <style> and <script>, no build step, no
                          framework or bundler.

api/                      Vercel Python serverless functions
  fetch_odds.py             Live Vegas spreads (The Odds API), writes the
                             shared odds cache
  fetch_predictions.py       Prediction-system data (thepredictiontracker.com
                              CSV), writes the shared predictions cache
  fetch_teams.py              CFBD team/roster data
  parse_pdf.py                  Parses a Brad Powers newsletter PDF into
                                 BP/Comp numbers
  parse_pool.py                 Parses a Splash Sports / OFP pool sheet
  grade_picks.py                 Auto-grades picks (daily cron) + manual
                                  "check results now"
  state.py                        Private per-user state (picks, entries,
                                   pools, inputs) + the three shared-data
                                   keys (odds/predictions/pools)

tests/                    158 automated checks, run manually before every
                          push (see "Running tests" below)

handoff.md                Full version-by-version project history --
                           read this for the detailed "why" behind
                           anything non-obvious in the code
chatgptnotes.md           Cross-AI (Claude ↔ ChatGPT) working notes --
                           practical advice for whichever AI picks this
                           project up next
NEW_SESSION_START_HERE.md  Fast-onboarding doc for a new chat session --
                            read this FIRST, then grep handoff.md as needed

vercel.json               Function timeouts + the daily grading cron
requirements.txt          Python dependencies for api/*.py
```

## Architecture, briefly

- **No build step.** `app/index.html` is one large file. Edit it directly;
  there's no compiler, bundler, or framework to run first.
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
  diffs `verify_user()` across all seven files and fails if they drift, so
  that duplication doesn't have to be kept in sync by hand.

## Environment variables (set in Vercel's project settings)

| Variable | Used for |
|---|---|
| `CLERK_JWKS_URL` | Verifying signed-in users' session tokens |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis REST API — or the `UPSTASH_REDIS_REST_*` / `STORAGE_KV_REST_API_*` equivalents, depending on how the Upstash integration was installed (all three naming schemes are checked, see `_kv_creds()`) |
| `ODDS_API_KEY` | Shared fallback Odds API key (each person can also add their own in Settings, sent as an `X-Odds-Api-Key` header instead) |
| `CFBD_API_KEY` | CollegeFootballData.com team/roster data |
| `MIGRATION_ADMIN_SECRET` | Gates the one-time legacy-account migration endpoint — not a per-user secret |
| `CRON_SECRET` | Vercel's own cron-authentication convention, verifies the daily grading job actually came from Vercel's scheduler |

None of these belong in the code. The one key that *is* safe to commit is
Clerk's **publishable** key in `app/index.html` — that's meant to be
client-visible, unlike a secret key.

## Running the tests

No CI yet (see `handoff.md`'s open items) — this is manual, on purpose,
before every push:

```
python3 tests/test_state.py            # private/shared state, atomic CAS, pool publishing
python3 tests/test_grading.py          # grading, provider game IDs
python3 tests/test_auth_sync.py        # cross-file auth-code drift detection
node tests/test_client_logic.mjs       # sportsbook resolution, EV math
node tests/test_snapshot_logic.mjs     # Snapshot tab logic
node tests/test_mypicks_logic.mjs      # My Picks entry-review logic
node tests/test_pdf_error_handling.mjs # pdf.js failure messaging
```

Also worth running after touching `app/index.html`'s inline script:

```
python3 -c "
import re
html = open('app/index.html').read()
m = re.search(r'<script>(.*)</script>', html, re.S)
open('/tmp/inline.js','w').write(m.group(1))
"
node --check /tmp/inline.js
```

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
