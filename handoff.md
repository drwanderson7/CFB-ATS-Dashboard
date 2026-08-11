# CFB ATS Edge Board — Project Handoff (v4)

**What it is:** A college-football against-the-spread pick tool. Reads Brad
Powers' newsletter PDF and Splash Sports/OFP pool sheets, pulls live Vegas
lines, computes a composite "Model #" per game, surfaces edges (with a
fitted-to-real-data probability model), tracks picks across pool entries,
and auto-grades results. Multi-user via Clerk accounts (v3), currently in
Public sign-up mode.

**Stack (unchanged):** Static `index.html` (all UI + browser logic) +
Python serverless functions on Vercel + Upstash Redis, Clerk auth
(email + password). GitHub repo `drwanderson7/CFB-ATS-Dashboard`
auto-deploys to Vercel on push to `main`.

**Site structure changed this session:** the dashboard (formerly the root
`index.html`) now lives at `app/index.html`, served at `/app` by Vercel's
normal static directory-index behavior (a folder with an `index.html`
inside is served at that folder's path — no `vercel.json` rewrite needed;
worth a quick post-deploy check since this environment can't verify a live
Vercel deploy). A new static marketing landing page now sits at the root
`index.html`. Flow: `/` (landing, no auth awareness) → "Launch Dashboard"
button → `/app` → the dashboard's existing Clerk gate handles both new
sign-ups (Public mode, sign-up link built into Clerk's own widget) and
returning sessions (skips straight to the board) — no new auth logic
needed, the landing page is just a front door in front of what already
existed.

**Read the prior handoff (v3) first if you haven't** — this document covers
what changed since. This session's trigger: an external ChatGPT audit of
the whole tool surfaced 4 critical, several high, and several medium
findings (security/data-isolation, functional bugs, ATS math, authorization,
sync, API key handling, model presentation, grading robustness,
maintainability, tests). Everything below was verified against the real
repo with real code execution (mocked Redis/Clerk, not live) — see
"How this was verified."

**Status: 6 of the audit's 13 numbered priorities fully fixed and tested
this session. 1 handled differently than requested (with reasoning). 6 not
started — see "Known open items" below, which supersedes v3's list.**

---

## 🔴 The big ones: two real security holes, closed this session

### Legacy account claiming could expose another user's private data

`POST /api/state?action=claim_legacy&legacy_id=<handle>` accepted any
signed-in user's request with any `legacy_id` and no proof of ownership —
since the pre-Clerk system was just a self-typed handle, any authenticated
user could type someone else's old handle and pull that person's private
picks/entries into their own account. Confirmed exploitable, not
theoretical, especially given Public sign-up.

**Fix:** `claim_legacy` now also requires an `X-Migration-Secret` header
matching a new `MIGRATION_ADMIN_SECRET` env var — separate from the
person's own Clerk token. Disabled entirely (403) if that env var isn't
set. Migrations for real legacy users now require someone who knows the
admin secret to run them.

### Any signed-in user could overwrite the global shared data

`POST /api/state?scope=shared` accepted any JSON body from any signed-in
user and overwrote the ENTIRE shared bucket (odds, predictions, published
test pools) for everyone — an accepted gap called out explicitly in v3's
code comments, closed properly now.

**Fix:** Generic `POST scope=shared` now returns `410 Gone`. The shared
tier is server-owned: `fetch_odds.py`/`fetch_predictions.py` write their
own slice of the bucket themselves right after a successful fetch (a
scoped read-modify-write, never a full replace). The two legitimate
client-initiated shared writes — publishing a test pool, clearing shared
predictions — go through new narrow endpoints
(`action=publish_pool`, `action=clear_predictions`) that can only touch
their own named field(s).

---

## Other fixes this session

- **Pool picks were invisible to auto-grading.** `grade_picks.py`'s grader
  only ever walked `state.history` (the overall board's archived weeks).
  Picks archived inside a pool context save to `state.pools[i].history`
  instead — which is how nearly every real pick gets made (Splash
  imports). This meant pool picks sat "pending" forever, both via cron and
  the manual "Grade now" button. Fixed with one reusable `_grade_history()`
  routine applied to the top-level history AND every pool's history; the
  pre-flight pending-count check had the identical blind spot and got the
  same fix.
- **Sportsbook selection was baked into the shared cache.** Whichever
  device happened to trigger a refresh had ITS OWN book preference
  resolved into a single number, cached for everyone for up to 30 minutes.
  Fixed: `fetch_odds.py` now extracts and stores every bookmaker's line
  (`g.books = {draftkings: -6.5, fanduel: -7, ...}`); `index.html` resolves
  its own device's preference from that shared per-book snapshot at
  render/pull time (`resolveVegasLine()`/`resolveBookLines()`), not at
  fetch time. Verified two devices with different book prefs now see
  different, correct lines from the identical fetch.
- **EV formula counted pushes as losses.** `ev = pCover*0.9091-(1-pCover)`
  implicitly treated `(1-pCover)` as pure loss. Now computes
  `pCover`/`pPush`/`pLoss` explicitly; `ev = pCover*0.9091 - pLoss`. Push
  detection is gated on the line being a whole number (final scores are
  always integers, so a half-point line can never structurally push) —
  this gate was added *after* an initial version of the fix registered
  spurious push mass on a half-point line, caught by the test suite, not
  by review.
- **Manual "Grade now" could mutate every user's picks.** Any signed-in
  user hitting `/api/grade_picks` graded and rewrote every
  `edge_board_user_*` key, not just their own. Now split: Vercel's cron
  (via `CRON_SECRET`) still grades everyone as intended; a real person's
  browser request grades only their own key.
- **Odds/CFBD API keys rode in URL query strings.** Moved to request
  headers (`X-Odds-Api-Key`, `X-Cfbd-Api-Key`); server still falls back to
  `ODDS_API_KEY`/`CFBD_API_KEY` env vars so the app works without anyone
  pasting a personal key.
- **Private sync was last-write-wins on the whole blob.** Added a `_rev`
  counter; a stale `expectedRevision` on a private POST is now rejected
  with `409` (and the current server state, for reconciliation) instead of
  silently overwriting a newer write from another device. `grade_picks.py`
  bumps the same counter when it writes graded results.
- **Grading lookback widened** from `daysFrom=3` to `daysFrom=7`, so a
  missed cron run doesn't leave a game permanently ungraded. (The audit's
  "better" fix — storing a provider game ID per pick for exact-match
  grading — is not done; still name-matching.)

---

## One item handled differently than the audit asked, on purpose

The audit asked for the duplicated `verify_user()`/JWKS code across all 7
`api/*.py` files to be centralized into shared modules
(`api/_auth.py`, etc.). I looked into whether Vercel's Python runtime
reliably supports importing a sibling module across these isolated
functions — it's a real, documented pain point (even the underscore-prefix
workaround has reported production failures), and there's no way to verify
an actual Vercel deploy from a sandboxed dev environment. Restructuring
imports with no way to test the real build risked silently breaking every
endpoint in production for a marginal win.

**Instead:** kept the duplication (matches this project's existing,
deliberate stance on it — see chatgptnotes.md), but added
`tests/test_auth_sync.py`, which AST-diffs `verify_user()`/
`_get_jwks_client()` across all 7 files and fails loudly on real drift.
Same pattern already used for `teamMatch()`/`TEAM_ALIAS` drift-checking.
**If a future session gets to verify a real Vercel deploy, revisit
this** — don't flip it without that verification.

---

## Known open items (supersedes v3's list — carried-over items re-checked, some resolved)

1. **Raw vs. market-adjusted Model#/Edge split** — not started. This is the
   audit's "Vegas is inside Model # and then Model # is compared back to
   Vegas" dilution complaint. Needs a design decision (second visible
   column vs. an under-the-hood always-Vegas-excluded number driving
   Edge) — bring options, don't just pick one.
2. **Clerk version pinning** — not checked this session. v3 flagged the
   free/Development tier's 100-user cap (needs a custom domain to lift);
   still true, still deferred.
3. **This handoff's own accuracy needs a live check** — everything in
   "Other fixes this session" was verified with mocked Redis/Clerk in a
   sandboxed dev environment, NOT against the actual live Vercel deploy,
   real Upstash Redis, or real Clerk JWTs. Treat as "logic verified, deploy
   unverified" until someone actually pushes this and tests it live.
4. **No automated test for the API-key-header change** — moved off the URL
   by code review only; no harness proves `refreshLines()` actually sends
   `X-Odds-Api-Key` correctly end-to-end.
5. **No automated test for the manual-grading auth split** — same
   situation, code-reviewed only.
6. **Splash locked-spread sign convention** (carried from v3) — still
   unconfirmed post-lock; still needs a real sample from after Wednesday
   11am lock.
7. **Chrome native credential popup on the live site** (carried from v3) —
   left mid-diagnosis last session; unclear if this was ever resolved.
   Follow up before assuming it's fixed.
8. **Mid-session auth expiry / empty logo alt text / silent pdf.js CDN
   failure** (carried from v3) — not touched this session, still open.
9. **`README.md`** (carried from v3) — still local-only, never pushed.
10. **First real-season live test** — still the single highest-value
    remaining validation step, and this session's fixes make it more
    likely to actually work correctly (pool grading was broken before
    today) rather than less.

---

## Key learnings & principles (carried over, plus new ones from this session)

- **Validate with real execution, not assumption — reinforced hard again.**
  The EV push-fix genuinely shipped wrong on the first attempt (spurious
  push probability on a half-point line from a bucket-mixing artifact) and
  was only caught because a test was actually run against it, not because
  it looked right on read-through.
- **An editing tool can silently do more than intended.** A `str_replace`
  during cleanup deleted two working lines it shouldn't have — caught
  immediately by re-reading the file after the edit rather than assuming
  it worked, same discipline as the CSS-comment-balance check from v3.
- **Don't restructure something you can't verify.** The auth-centralization
  ask was declined in favor of a drift-detection test specifically because
  this environment has no way to test an actual Vercel deploy — a
  correct-looking import restructure is not the same as a verified one.
- **Testing methodology established this session** (see updated
  chatgptnotes.md): mocked-handler tests for the Python endpoints
  (bypass `BaseHTTPRequestHandler`'s socket machinery, mock
  `send_response`/`send_header`/`kv_get`/`kv_set`, call the real
  `do_GET`/`do_POST`), and a Node `vm`-based harness that extracts actual
  function source out of `index.html` by brace-depth parsing (not a
  hand-copied reimplementation that could drift) and executes it.

---

## Files changed this session

```
api/state.py                REPLACE — legacy-claim gate (MIGRATION_ADMIN_SECRET),
                             shared-write lockdown (410 on generic POST,
                             new publish_pool/clear_predictions actions),
                             revision-based concurrency (_rev/expectedRevision/409)
api/fetch_odds.py           REPLACE — per-book line extraction (not one resolved
                             number), server-side shared write, API key off
                             URL onto X-Odds-Api-Key header
api/fetch_predictions.py    REPLACE — server-side shared write (predictions/predMeta)
api/fetch_teams.py          REPLACE — CFBD key off URL onto X-Cfbd-Api-Key header
api/grade_picks.py          REPLACE — pool-history grading fix, user-scoped
                             manual grading vs. cron-grades-all, 7-day lookback,
                             _rev bump on graded writes
index.html                  REPLACE — sportsbook resolution (resolveVegasLine/
                             resolveBookLines), EV push fix, shared-write client
                             migration (publish_pool/clear_predictions/server-owned
                             odds+predictions), revision/409 handling in sync,
                             dead client-side parseOdds/homeLine/spreadHome removed
tests/test_state.py         NEW — legacy-claim gate, shared-write lockdown,
                             concurrency/409, publish_pool scoping (16 checks)
tests/test_grading.py       NEW — grade() win/loss/push, pool-history grading,
                             pending-count across pools (12 checks)
tests/test_auth_sync.py     NEW — AST-diffs verify_user()/_get_jwks_client()
                             across all 7 api/*.py files (14 checks)
tests/test_client_logic.mjs NEW — extracts and executes resolveVegasLine/
                             resolveBookLines/probabilityCoverForGame from the
                             real index.html via Node vm (15 checks)

Unchanged this session (included in the delivered package for completeness):
api/parse_pdf.py, api/parse_pool.py, requirements.txt, vercel.json
```

**Env var changes:** new `MIGRATION_ADMIN_SECRET` (unset = legacy migration
disabled, safe default). `ODDS_API_KEY`/`CFBD_API_KEY` unchanged in meaning,
just no longer read from query strings.

**Schema changes:** private state objects gain a server-assigned `_rev`
(missing = treated as 0, no migration needed). Shared `lastGames` entries
gain a `books` field (old entries without it fall back to their existing
single `vegas`/`book` fields, self-heals on next refresh).
