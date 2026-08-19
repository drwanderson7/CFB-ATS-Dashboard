# PickGauge — CFB ATS Project Handoff (v25)

*(Renamed from "Edge Board" as of v18 -- see that section for the full
rename writeup, including what was deliberately NOT renamed and why.)*

**Read v13 first if you haven't** — v14 fixes a real bug Drew found from
an actual screenshot: Snapshot's CLV column showed blank for almost
every row in a real pool (anything not yet picked). Everything in v13
below is unchanged and still accurate.

**Read v12 first if you haven't** — v13 covers two rounds since then:
provider game IDs for grading (a real architecture change, not polish),
and a fix for the reported Chrome credential-popup issue. Everything in
v12 below is unchanged and still accurate.

**Read v11 first if you haven't** — v12 fixes a real CSS bug (not just
polish) that was breaking Snapshot's mobile table layout, then builds
Snapshot's own dedicated mobile treatment. Everything in v11 below is
unchanged and still accurate.

**Read v10 first if you haven't** — v11 is the first UI Pass 3 item: My
Picks redesigned into a real entry-review workspace, with genuinely new
logic (not just visual polish this time) and 12 new tests to prove it.
Everything in v10 below is unchanged and still accurate.

**Read v9 first if you haven't** — v10 is the "de-AI" visual finishing
pass (softer/consistent corner radii, de-badged Raw Edge to match Cover
%, flatter Week Snapshot, #1 Top Opportunity accent, less shouty
uppercase). Still zero calculation/logic changes, still verified by the
same 114 tests passing unchanged. Everything in v9 below is unchanged
and still accurate.

**Read v8 first if you haven't** — v9 is Pass 2 of the UI/visual polish
pass (Snapshot refinement: layout restructure, edge-magnitude bars,
sticky context bar, redesigned expand panel — still zero calculation/
logic changes, still verified by the same 114 tests passing unchanged).
Everything in v8 below is unchanged and still accurate.

**Read v7 first if you haven't** — v8 is Pass 1 of a UI/visual polish pass
(colors, hierarchy, buttons, badges — zero calculation/logic changes,
verified by the same 114 tests passing unchanged). Everything in v7 below
is unchanged and still accurate.

**Read v6 first if you haven't** — v7 covers implementing the top-priority
item v6 explicitly left open: private-state writes are now genuinely
atomic, not just re-checked. Everything in v6 below is unchanged and
still accurate.

**Read v5 first, which itself points to v4 first, if you haven't** — this
document covers a follow-up round triggered by an independent ChatGPT
re-audit of the actual v5 repo (not just the v4/v5 handoff text). That
re-audit found real gaps in the v5 concurrency/authorization work; this
session fixed the smaller/faster ones (ownership checks, a dead UI
button, an overly-broad shared-clear endpoint) per Drew's explicit
prioritization. The bigger item the re-audit raised — the revision/
concurrency system isn't actually atomic (a genuine TOCTOU race between
the read and the write) — is NOT fixed yet; see "Known open items."

**⚠️ Also from this round: real credentials were found pasted in plaintext
in a Word doc that had been uploaded to both ChatGPT and Claude** (Clerk
secret key, Odds API key, CFBD API key, and an app secret). Flagged to
Drew immediately as the top priority, ahead of any code work. Confirm
these were rotated before treating this deployment as secure regardless
of anything else in this document.

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

**Status (original 13-item audit, v4/v5 numbers unchanged): 7 of 13 fully
closed (6 fixed and tested, 1 investigated and found already correct — see
"Resolved this session without a code change" below). 1 handled
differently than requested (with reasoning). 5 not started — see "Known
open items" below, which supersedes v3's list.**

**Independent re-audit of the v5 repo (this round) found 6 additional real
issues in the v4/v5 concurrency/authorization work** — see "New this
round" below. 3 of those 6 are fixed here; the concurrency/atomicity ones
(the bigger, more involved ones) are not, per Drew's explicit call to do
the smaller fixes first.

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

## Resolved this session without a code change

**Priority 9 — "raw vs. market-adjusted Model#/Edge split."** Investigated
before writing anything, per this project's own principle of verifying
against the real repo first. Turns out this was already built correctly,
predating this session: Vegas has an adjustable weight (not a boolean
toggle) sitting right next to BP/Comp's weight inputs in the Prediction
Systems panel, defaulting to 1 (equal weighting); set it to 0 and Vegas
drops out of Model# entirely, same mechanism as any other system. The
Vegas column itself is always rendered on the board regardless of that
weight. Confirmed with actual execution (not just reading the code):
extracted `weightOf`/`weightedModel`/`myNumber`/`edgeOf` and ran them —
default weight, Vegas-only input, Model# matches Vegas exactly (Edge=0,
correct); weight set to 0, Model# correctly returns `null` (nothing left
to average). The audit's "dilution" complaint is really just "the default
weight is 1, same as everything else" — a deliberate, already-tunable
choice, not a bug. No code changed.

**Possible improvement down the road, not done:** the Vegas weight input's
tooltip is sparse — doesn't explain that raising it dilutes Edge toward
zero by design. Worth a one-line addition (e.g. "Vegas counts as one more
input at its current weight — set to 0 to see your model's number
independent of the market") so this doesn't get rediscovered as a "bug" by
a future session or by Drew months from now. Low priority, purely a
discoverability nicety.

---

## New this session: Snapshot tab

Added a quick-scan summary view (`app/index.html`, new "Snapshot" tab, now
the default landing view when the app loads) — Top Opportunities cards,
a Week Snapshot stat panel, and a condensed Full Slate table, with a
"View full board →" button that switches to the existing Edge Board tab,
completely unchanged. Prompted by a Stitch-generated mockup Drew shared;
built as a real, tested feature rather than a static preview.

**Architecture decision:** this is a new tab inside the existing
single-file `app/index.html`, not a separate page. A separate page would
mean re-fetching shared/private state a second time, re-authenticating
Clerk again, and duplicating `myNumber()`/`edgeOf()`/`clvOf()`/pick-toggle
logic in two places — exactly the kind of drift risk `test_auth_sync.py`
already exists to catch elsewhere in this project. Snapshot reuses the
SAME `games` array, `state` object, and real computation functions the
full board uses; nothing here is a separate data source.

**Pick Score — handled carefully, on purpose.** The mockup showed a
"Pick Score" (0–100) that doesn't exist anywhere else in this app.
Built it, but as an explicitly-labeled heuristic: an EQUAL-WEIGHTED
percentile rank across three signals the app already computes with real
fitted methodology — Raw Edge magnitude, modeled Cover % (from
`probabilityCoverForGame`), and key-number proximity (from
`keyNumberScore`) — ranked relative to just that week's own slate. No
per-signal weight is hand-tuned. The UI itself says plainly that this is
a sorting convenience, not a new probability estimate, and that it isn't
calibrated against historical outcomes the way Cover % is (see
`snapMethodology` in the render code). **Off by default**
(`state.snapShowScore`) — Raw Edge, the metric the app has always used, is
the fallback ranking.

Also deliberately did NOT add a "Dog value" signal badge (present in an
earlier preview iteration, cut before this reached the real app) — the
app's existing `edgeExtrasHTML()` has a stated philosophy of showing NO
badge rather than manufacturing one when there's no real signal to report;
matched that instead of introducing a fabricated concept into production.

**Real bugs caught and fixed during this build, by testing it, not by
reading it:**
- An early sign-convention mistake in a *preview* iteration (before any
  of this reached the real app) had the wrong team recommended relative
  to its own team badge — caught by re-deriving the math from
  `app/index.html`'s actual `edgeOf()` convention and re-screenshotting.
- The "Key-number crossings" stat initially counted by `e.keyTier` (can
  be `"minor"` from several sub-threshold contributions that individually
  never clear the 0.5 proximity bar `edgeExtrasHTML()` requires to show a
  badge) instead of `e.keyNumbers.length` (what's actually visibly
  badged) — produced a stat number with no visible badges to back it up.
  Caught by screenshotting real demo data and counting badges by eye
  against the stat. Fixed to count by `keyNumbers.length`, matching what's
  actually shown.
- Condensed table cells were missing `data-label` attributes the app's
  existing mobile CSS (`td[data-label]::before`) relies on — meant the
  Snapshot table rendered unlabeled on mobile while the rest of the app's
  tables label correctly. Caught by an actual mobile-viewport screenshot,
  not assumed from the desktop render. Fixed; not pixel-identical to the
  full board's custom mobile grid layout, but functional and labeled —
  flagged as a minor open polish item below, not blocking.

**Context/entry selectors are shared, not duplicated.** Refactored
`renderContextSelect()`/`renderEntrySelect()` to populate/wire EVERY
matching element (via `.ctx-select`/`.entry-select` classes) instead of
one hardcoded ID, so Snapshot's pool/entry dropdowns and the board's stay
in sync automatically. Confirmed via screenshot: picking a pool on one
tab is reflected on the other; making a pick from a Snapshot card shows up
highlighted on the real, unmodified Edge Board table.

**How this was verified:** real Playwright renders against the actual
`app/index.html` with a mocked Clerk session (same pattern documented in
`chatgptnotes.md`) and the app's own existing demo-data path — not a
separate mockup file. Exercised: default render, Pick Score toggle, each
filter pill, making a pick from a Top Opportunity card (confirmed it
updates the pick count, the Week Snapshot stats, AND shows correctly
highlighted on the real board after switching tabs), the "View full
board" button, and a mobile viewport. Full inline `<script>` block
syntax-checked after every round of edits. New automated tests in
`tests/test_snapshot_logic.mjs` (14 checks: `percentileRank` correctness
including ties and the single-element edge case, Pick Score blending
proof — a game dominant on all three signals scores highest, weak-on-all
scores lowest, and a high-edge-only game does NOT automatically outscore
a balanced one — and each filter pill's exact narrowing behavior).
`tests/_render_snapshot.py` (not part of the numbered suite, a manual
Playwright screenshot script) is checked in for whoever picks this up
next to re-run visually.

**Not done:**
- Mobile table layout is functional (labeled correctly) but not
  pixel-matched to the full board's custom per-column mobile grid CSS —
  low-priority visual polish.
- No live-deploy verification, same caveat as everything else in this
  handoff — tested against mocked Clerk + the app's own demo data in a
  sandboxed dev environment, not your actual Vercel deployment.
- Pick Score's methodology is a considered, disclosed heuristic, not a
  historically-calibrated model — worth revisiting once a full season of
  graded picks exists (same "revisit after real outcome data" note as
  Probability Edge Phase 2 elsewhere in this project's history).

---

## New this round: fixes from an independent ChatGPT re-audit

Drew had ChatGPT independently re-audit the actual v5 repo (not just the
handoff text) and asked me to verify the findings before acting — same
discipline as every prior round. Verified 5 of the findings directly
against the real code before touching anything; all were accurate.

**Fixed this round (the "smaller/faster" group, per Drew's explicit
prioritization):**

- **`_publish_pool` had no ownership check.** Any signed-in user could
  overwrite another person's already-published pool just by reusing its
  `id` — and the function's own docstring incorrectly claimed this
  couldn't happen. Fixed: updating an existing pool id now requires
  `existing.publishedBy == this caller's uid`, rejected with 403
  otherwise. A brand-new id is still open to anyone (that's the intended
  "share for testing" behavior). New tests prove both the block and that
  the original publisher can still update their own pool.
- **`action=clear_predictions` let any signed-in user wipe shared
  predictions for every other user.** Removed entirely — it now returns
  410. "Clear predictions" in the UI is local-only now (stops using
  predictions on that one device/account without touching the shared
  cache anyone else reads), matching what the button already did for
  BP/Comp/PDF data. Removed the now-dead `merge_shared()` helper and its
  supporting constants in `api/state.py` that existed only to support
  this action, rather than leave unused code that misdescribes what the
  file does.
- **Dead legacy-claim UI removed from `app/index.html`.** The button
  called `claim_legacy` without the `X-Migration-Secret` header the v5
  security fix requires — it would 403 on every click, and putting that
  admin secret in browser-shipped JS to "fix" it would defeat the whole
  point of the fix. Removed the button, its input field, and its click
  handler entirely. Migration for the handful of real legacy users stays
  admin-side (curl the endpoint with the secret), as already documented
  in `api/state.py`.

**Not fixed this round, on Drew's explicit call — bigger and more
involved:**

- **The revision/concurrency system isn't actually atomic.** `_get_json()`
  and `kv_set()` are two separate Upstash REST calls with nothing atomic
  between them — two concurrent requests can both read revision 5, both
  pass the `expectedRevision` check, both write revision 6, and one write
  silently vanishes. The existing test only proves *sequential* stale
  writes are rejected (device 2 writes, then device 1's stale write is
  rejected) — it does not exercise genuinely concurrent writes, which is
  the actual race. Needs a real compare-and-set, e.g. a Lua/EVAL script
  on Upstash so the read-compare-write happens as one atomic Redis
  operation instead of three separate HTTP round trips.
- **Missing `expectedRevision` still bypasses the check entirely** for an
  *existing* user's write, not just a brand-new one — the server doesn't
  actually verify the account is new before allowing the unconditional
  write through.
- **The grader has the identical race**, and the `_rev` bump it does on
  write doesn't protect against it — it can silently clobber a pick a
  person added while grading was in flight.
- **Shared-blob writes across different endpoints can race each other**
  (`fetch_odds.py` and `fetch_predictions.py` each do their own
  read-modify-write-the-whole-blob cycle) — a real fix likely means
  moving off "one big JSON blob per shared key" toward per-field Redis
  storage (e.g. a hash) so independent writers can't stomp on each other.

**⚠️ Credential exposure, unrelated to the code review itself:** the
Word doc Drew shared for this review had real production credentials
pasted in plaintext at the top — `CLERK_SECRET_KEY`, `ODDS_API_KEY`,
`CFBD_API_KEY`, and an app secret (`APP_Secret = edge`, also trivially
guessable as a value even ignoring the exposure). That doc had already
been uploaded to ChatGPT before reaching this session. Flagged to Drew as
the top-priority action, ahead of any of the above — **confirm these were
actually rotated** before treating anything else in this document as
sufficient. `CLERK_SECRET_KEY` is the most urgent (full backend access to
the Clerk user base).

---

## New this round, part 2: Snapshot's "Quick Look" table was showing everything

Drew pointed out the Snapshot tab's condensed table was rendering the
entire filtered slate (34 games in his real pool) instead of a genuine
quick scan. Fixed:

- Capped the table at `SNAPSHOT_ROW_LIMIT` (8) rows, regardless of which
  filter pill is active — Week Snapshot's stat counts (Games analyzed,
  Strong/Good edges, key crossings) are NOT capped, only the row list is.
- Renamed the section from "Full slate / All games" to "Quick look / Top
  games" so the UI itself doesn't claim to be comprehensive.
- Added a footer that appears only when there are more matching games
  than shown ("Showing top 8 of 34 games") with a "See full slate →"
  button that jumps to the real Edge Board tab — same destination as the
  existing "View full board" CTA lower on the page, just contextual and
  immediate rather than requiring a scroll.

**Verified, not assumed:** demo data only ships 6 games (under the cap),
so the truncation path needed a targeted test — monkey-patched
`snapshotRows()` in a real Playwright page to return 20 synthetic
`edgeOf()`-shaped rows, confirmed the footer text, row count, and that
the button actually switches to the board tab. Also added 4 new checks to
`tests/test_snapshot_logic.mjs` (34-game slate caps to exactly 8, a
3-game slate isn't padded/altered, `SNAPSHOT_ROW_LIMIT` itself is sane).
One test-harness quirk hit and fixed along the way: `vm.runInContext`
exposes top-level `function` declarations as context properties
automatically but NOT `const` bindings — needed an explicit
`this.SNAPSHOT_ROW_LIMIT = SNAPSHOT_ROW_LIMIT` in the test harness itself,
not a change to the real source. 81 checks total now pass.

---

## New this round, part 3: Snapshot was missing team logos

Drew pointed out Snapshot's team names had no logos while the full Edge
Board's did — inconsistent page to page. Fixed: both the Top Opportunity
cards and the Quick Look table rows now show the recommended team's logo,
reusing `g.awayLogo`/`g.homeLogo` (already populated on every game by
`applyTeamLogos()`, which already runs at the top of `renderBoard()` —
since `renderBoard()` cascades into `renderSnapshot()`, the logos are
already resolved by the time Snapshot renders; no new fetch or matching
logic needed) and the exact same `.teampick-logo` class/markup pattern the
full board uses, for real visual consistency rather than a look-alike.

**One real bug caught while wiring this up:** the full board hides
`.teampick-logo` on mobile (`display:none`) because mobile swaps to
bigger flanking logo badges instead — but that CSS rule was unscoped, so
it would have silently hidden Snapshot's new logos on mobile too, with
nothing to replace them (Snapshot has no flanking-badge layout). Scoped
the rule to `.teampick .teampick-logo` (full board's pick buttons only)
so Snapshot's inline logos survive on mobile. Verified with real
Playwright screenshots at both a desktop and a 390px mobile viewport,
using synthetic logos matched through the actual `applyTeamLogos()`
team-name-matching pipeline (not just images pasted into fixed
positions) — confirmed logos render correctly in both places on desktop,
survive correctly on Snapshot mobile, and the full board's own existing
mobile logo-badge swap still works exactly as before.

---

## v7 — TOP PRIORITY item implemented: private-state writes are now genuinely atomic

A follow-up ChatGPT review of the actual v6 repo (not just the v6 handoff
text) correctly identified that the `_rev`/`expectedRevision` mechanism
from v6, while an improvement, was still a real TOCTOU race: the read,
the revision comparison, and the write were three separate HTTP round
trips to Upstash, and another request's write could land in the gap
between them. The review explicitly required: *"Do not accept a
sequential simulation as sufficient proof."* This round addresses that
directly — implemented, tested with genuinely concurrent writers (real
Python threads racing against a lock-guarded mock, not two sequential
calls), not just claimed.

**Files changed:**
- `api/state.py` — added `kv_eval()` (atomic Lua EVAL via Upstash's REST
  API), `CAS_SCRIPT` (the actual Lua), and `cas_write()` (the Python
  wrapper). Rewrote `_post_user_state()` to use `cas_write()` instead of
  `_get_json()`-then-`kv_set()`, and to REQUIRE `expectedRevision` on
  every write (428 if missing) instead of treating its absence as "must
  be a new account."
- `api/grade_picks.py` — same `kv_eval()`/`CAS_SCRIPT`/`cas_write()`
  duplicated (per this project's established cross-file duplication
  pattern — see below). New `grade_and_write_user()` replaces the old
  batch-read-then-batch-write loop: reads fresh, grades, atomic
  CAS-writes, and on conflict re-reads the NEW current state and
  re-grades THAT from scratch (grading is idempotent — only touches picks
  with `result=None` — so recomputing against a fresh copy is always
  correct, never a partial or duplicate grade), up to 3 retries.
- `app/index.html` — no behavior change needed (the client already always
  sent `expectedRevision`, defaulting to 0); added a distinct status
  message for the 428 case as a defensive backstop, since the server now
  enforces it unconditionally even though this client should never
  actually trigger it.
- `tests/test_auth_sync.py` — extended with a second, narrower drift
  check specifically for `kv_eval()`/`cas_write()`/`CAS_SCRIPT` between
  `state.py` and `grade_picks.py` (not all 7 files, since only these two
  write with a revision check) — a drift in the Lua script itself would
  be the single most dangerous kind of duplication bug here, since it's
  the thing supposed to be provably atomic.
- `tests/test_state.py` — rewrote the fake KV backend to add
  `fake_kv_eval()`, which replicates `CAS_SCRIPT`'s exact semantics
  guarded by a real `threading.Lock`, so genuinely concurrent test
  callers get the same mutual-exclusion guarantee a real Redis EVAL
  provides server-side. Added the missing-revision-is-rejected test, and
  the real acceptance test: two actual Python threads (synchronized with
  a `threading.Barrier` so they hit the write at the same instant), both
  racing to write against the SAME expected revision — proves exactly one
  succeeds, exactly one gets 409, the final revision increments exactly
  once (not twice, not zero), and the final stored content exactly
  matches the winner (the loser's write did not partially apply).
- `tests/test_grading.py` — added the grader's equivalent acceptance
  test: seeds revision 5 with one ungraded pick, injects a simulated
  concurrent user write (a second pick added, revision bumped to 6)
  landing between the grader's read and its first write attempt, and
  proves the grader's CAS conflict is actually hit, it correctly reloads
  and re-grades the NEW state, both picks end up graded, and the user's
  concurrently-added pick is never silently dropped.

**Before/after behavior:**
- Before: two simultaneous writes at the same expected revision could
  both pass the check and both write — one update would silently vanish
  with no error to either caller.
- After: exactly one of two simultaneous writers succeeds; the other
  receives 409 with the current server state, atomically, in one
  Redis-side operation — not a race between separate read/compare/write
  steps.
- Before: an existing account's write could omit `expectedRevision`
  entirely and skip the concurrency check.
- After: every private write requires `expectedRevision`; omitting it
  returns 428 regardless of whether the account is new or existing.
- Before: the grader read a batch snapshot of every user's state once,
  graded it, and wrote it back with a manually-incremented `_rev` with no
  re-check — a pick added mid-grading could be silently overwritten.
- After: the grader reads fresh, atomically CAS-writes, and on any
  conflict reloads and re-grades the actual current state before retrying
  — up to 3 times — so a concurrently-added pick is never lost.

**Security/reliability reason:** this closes the actual TOCTOU race the
v6 `_rev` check only partially addressed — the review's core finding was
correct, and the fix required a genuinely atomic Redis-side primitive
(Lua EVAL), not a better-checked version of the same three-step pattern.

**Schema/state changes:** none beyond what v6 already introduced (`_rev`
on private state objects). No migration needed.

**Backward compatibility:** existing saved state without `_rev` is
treated as revision 0 by `CAS_SCRIPT` itself (a missing/undecodable
`_rev` field defaults to 0 inside the Lua script), so old data self-heals
on its next write exactly as it did under the v6 mechanism.

**Tests added:** 10 new checks (`test_state.py`: missing-revision
rejection + the 4-assertion genuine concurrent-write test; `test_grading.py`:
the 6-assertion grader-race test; `test_auth_sync.py`: 6 new drift checks
for the duplicated CAS code). **114 checks total now pass** (was 96).

**Test results:** all 114 passing, verified from a clean run immediately
before this handoff was written.

**Vercel/Upstash-specific assumptions:** this relies on Upstash's REST
API supporting `EVAL` for atomic Lua scripts, confirmed against Upstash's
own documentation and blog before implementing (not assumed) — POSTing
`["EVAL", script, numkeys, ...keys, ...args]` as the request body to the
database's base REST URL. Not yet verified against a real Upstash
database from this environment (no live credentials available here) —
see "still requires live validation" below.

**What still requires live deployment validation, honestly stated:** the
concurrent-write test proves the CAS *logic* is correct under genuine
thread contention against a mocked backend that replicates Upstash's
documented Lua semantics — it does NOT prove Upstash's real Lua engine
behaves identically, or that the exact REST request shape used here
(`kv_eval()`'s JSON body format) is accepted by a real Upstash database
without a syntax or encoding issue that only shows up against the real
service. This needs a real concurrent-write test against a real Upstash
database before being treated as fully proven in production — the single
most important item in "Known open items" below.

**What this round did NOT touch, on purpose** (still open, matching the
v6 review's own priority order):
- Priority 4 (shared-state hash redesign for `fetch_odds.py`/
  `fetch_predictions.py`/pool publishing) — a bigger, separate
  architecture change; deliberately not folded into this round to keep
  the diff reviewable and reduce regression risk.
- Priority 5 (pool-publication abuse limits/validation).
- Priority 6 (durable per-user `usePredictions` preference instead of
  locally clearing shared data).
- Priority 7 (Clerk version pinning), Priority 9 (unified test command +
  CI), Priority 11 (provider game IDs), Priority 12 (Splash sign
  validation), Priority 13 (full live-deployment regression checklist).

---

## New this round, part 4: Market vs. Model color separation + expandable rows

Drew asked how to implement three related ChatGPT UI suggestions
(compact rows, expandable-for-detail, visually separating "your model"
from "the market"). Rather than three separate changes, built them as one
cohesive design:

- **Merged the Line and Model # columns** into a single "Market → Model"
  cell — market number in muted gray, model number in a new blue accent
  (`--model-blue`, distinct from the green/amber/red already used for
  edge-strength coloring, so "this is your number" reads as its own
  consistent visual language rather than colliding with existing
  semantics). This both compacts the row (one column instead of two) and
  makes the model-vs-market gap visible at a glance, before even reading
  the Raw Edge pill.
- **Added an expand chevron per row.** Clicking it reveals an inline
  detail panel: three percentile bars (Raw Edge / Cover % / key-number
  proximity) that show regardless of whether Pick Score is toggled on —
  Drew's explicit call, since they're useful context either way, not
  just supporting evidence for a score — plus the combined Pick Score
  itself when that toggle is on, the specific key numbers crossed (real
  data already returned by `keyNumberScore()`, nothing fabricated per
  number), and an "Open on full board →" link. Expanded/collapsed state
  lives in an in-memory `Set` (`snapExpandedKeys`), deliberately NOT
  saved to `state` — which rows happen to be expanded isn't worth
  persisting across reloads or syncing across devices.
- `computeSnapshotScores()` now stores the three individual percentile
  ranks (`edgeRank`/`coverRank`/`keyRank`) on every row, not just the
  blended `pickScore` — needed so the detail panel can show them
  independent of the toggle.

**Verified:** real Playwright screenshots confirming the merged column
renders correctly, the detail panel opens/closes correctly (including
that it survives toggling Pick Score on/off without losing its expanded
state), the "Open on full board" link actually switches tabs, and a
mobile viewport check (functional, appropriately caveated as not
pixel-polished — same known gap as the rest of Snapshot's mobile layout).
15 new automated checks added to `tests/test_snapshot_logic.mjs` (per-row
rank storage, `ordinalSuffix()` including the 11/12/13 exception). 96
checks total now pass.

---

## v8 — UI/visual Pass 1 (from a ChatGPT visual design handoff)

A separate ChatGPT session produced a detailed visual-design handoff
(light/black/green palette, typography hierarchy, button/badge
discipline, spacing) with an explicit regression requirement: preserve
every calculation and pass the full existing test suite unchanged. Drew
scoped this round to Pass 1 only (pure visual polish, no layout
restructuring) after two decisions on real conflicts with prior work:

**Two conflicts flagged and resolved per Drew's explicit call, not
silently changed:**
- The doc says never use blue for Model # (distinguish it from Market by
  weight/position, not color) — directly contradicted the `--model-blue`
  accent added in v6 part 4. **Reverted to black+bold**, per Drew's
  choice. Removed the now-dead `--model-blue`/`--model-blue-fill`/
  `--model-blue-text` tokens rather than leave unused CSS variables
  behind. The expand-panel percentile bars, which also used the blue
  accent, switched to green instead — not an arbitrary substitute, but
  because those bars represent Raw Edge/Cover%/key-number rank, exactly
  the signals the doc's own color semantics assign to green.
- The doc's exact new hex palette (`#F5F7F5` page bg, `#238C50` green,
  etc.) is close to but not identical to the app's existing tokens
  (`#16A34A` green, `#FAFAFA` page). Drew chose to **keep the existing
  hex values** and apply only the hierarchy/spacing/restraint guidance —
  a full palette swap would touch every color reference across both
  Snapshot and the full Edge Board (they share one `:root` token block),
  which is a much bigger blast radius than "visual polish."

**Changes made (all in `app/index.html`):**
- **Raw Edge is now visibly the hero metric** on Top Opportunity cards —
  new `.opp-stat-val.edge-hero` (28px, green, bold), distinct from Cover
  %/Pick Score which stay at a smaller, secondary size. Matches the
  doc's explicit "Raw Edge is the quickest decision signal" priority.
- **Cover % is no longer badge-styled.** It was sharing the same `.pill`
  treatment as Raw Edge (background, padding, rounded shape) via the
  shared `probCellHTML()` — the doc explicitly names "Cover 57.1 /
  Market -6.5 / Model -10.2" as bad badge candidates ("normal metrics,
  not statuses"). New `.cover-val` class keeps the green/red color
  semantic but drops the badge shape. Since `probCellHTML()` is shared by
  Snapshot AND the full board, this fixes both consistently in one
  place, matching the doc's own instruction to preserve shared
  computation/rendering functions rather than fork Snapshot-specific
  copies.
- **Three-tier button hierarchy added.** Primary (`.btn-go`, green fill)
  was already correct and untouched. New `.btn-secondary` (white bg,
  black text, black border, bold) applied to the doc's explicitly-named
  secondary actions: "View full board," "Import pool sheet," "Import
  Powers PDF," both "Load model predictions" buttons. `.btn-light`
  (existing, unchanged) now serves as the tertiary tier (Details, star/
  pick-toggle icons, Sign out, filter pills, etc.) — it was already close
  to the doc's "simple text/light border" description, so it didn't need
  a new class, just a narrower role now that secondary exists separately.
- **Picked-row accent**: added a 3px green left-edge accent (`box-shadow:
  inset` on the first cell, not a `border-left` on `<tr>`, which doesn't
  render reliably across browsers in table layouts, and doesn't disturb
  cell padding/layout the way a real border would) alongside the
  existing light-green row tint — matches the doc's "instantly visible
  without overpowering" guidance exactly.

**What Pass 1 did NOT touch, on purpose** (Drew's explicit scope call —
"Pass 1 only, no layout changes"): whitespace/padding increases beyond
what the above changes incidentally include, further border/box-nesting
reduction elsewhere in the app, the context bar becoming sticky, nav
styling, empty/loading states, edge-magnitude bars, the 3-column
Model/Market/Signals expand-panel redesign, and everything in the doc's
Pass 2 (stronger Snapshot refinement) and Pass 3/4 (My Picks redesign,
Results dashboard) — those are separate future rounds, explicitly scoped
out of this one.

**Verified, not assumed:** real Playwright screenshots of both tabs
(Snapshot and Edge Board) before/after, plus a dedicated screenshot after
making a pick to confirm the new left-border accent actually renders.
Full syntax check on the inline script. **All 114 existing tests re-run
and pass unchanged** — this was a pure styling pass with zero logic
changes, and the test suite proves that rather than just asserting it.

---

## v9 — UI/visual Pass 2 (Snapshot refinement)

Second round of the ChatGPT visual-design handoff, scoped to Pass 2's
listed items: layout restructure so Top Opportunities/Week
Snapshot/Quick Look match the doc's own recommended hierarchy, edge-
magnitude bars, a sticky context bar, and the 3-column expand-panel
redesign. Still zero calculation changes — verified by the same 114
tests passing unchanged, same as v8.

**Changes made (all in `app/index.html`):**

- **Layout restructure.** Top Opportunities and Week Snapshot were
  side-by-side in a 2fr/1fr grid; now stacked full-width, matching the
  doc's own example hierarchy (`TOP OPPORTUNITIES → WEEK SNAPSHOT →
  QUICK LOOK`) exactly. Removed the now-dead `.snap-top-grid` CSS rather
  than leave an unused rule behind.
- **Week Snapshot is now a horizontal strip** (`.snap-strip`/`.snap-tile`)
  instead of a vertical list of rows — desktop shows one row of
  divided tiles, mobile wraps into a 2-column grid, matching the doc's
  explicit desktop/mobile guidance for this section.
- **Edge magnitude bars** added under Raw Edge on the Top Opportunity
  cards — a small bar scaled to magnitude only (capped at 12pts = 100%
  width), explicitly NOT implying probability, per the doc's own
  requirement stated in the same section.
- **Sticky context bar** — the Context/Entry/Rank-by row now sticks to
  the top of the viewport on scroll, desktop only (disabled under 701px
  — screen space is too precious on mobile for this). Verified by
  actually scrolling in a real Playwright viewport, not just reading the
  CSS.
- **Expand panel redesigned into the doc's 3-column layout** (Your
  Model / Market / Signals), replacing the old flat 3-bar-in-a-row
  layout — using ONLY real, already-available data:
  - **Your Model**: individual BP/Comp/prediction-system inputs via
    `inputsFor()`/`predsFor()`/`enabledSystemsOrdered()` — the exact
    same functions the full board already uses, so this is genuinely
    real per-system data, not a new parallel data source. Shows only
    systems actually toggled on and actually matched for that game, with
    Model # as a totaled line at the bottom.
  - **Market**: pool line vs. current market when in a pool (via
    `g.lockedLine`/`g.liveVegas`, the real fields CLV is already computed
    from), or the resolved live line otherwise.
  - **Signals**: real key-number and CLV facts, PLUS the three
    percentile-rank bars from v6 part 4 — kept, not removed, since Drew
    explicitly wanted those visible regardless of the Pick Score toggle;
    this redesign reorganizes them into the new layout rather than
    dropping that requirement.

**Real bug caught and fixed while building this, by looking at the
actual screenshot, not by reading the code:** the Market column's book
label showed the literal string `"demo"` instead of "Consensus" for
demo-mode games — `g.book` is set to `"demo"` (not `"consensus"`) in
demo mode, and the label logic only special-cased `"consensus"`. Looked
exactly like a stray floating label in the screenshot before being
traced to its actual cause. Fixed to treat both `"consensus"` and
`"demo"` as the generic "Consensus" label.

**What Pass 2 did NOT touch:** mobile card polish beyond what the
layout restructure incidentally improves, and everything in Pass 3/4
(My Picks redesign, model-agreement indicator, data-completeness
indicators, pool-vs-market callout, entry review warnings, Results
dashboard) — still explicitly out of scope, still their own future
scoping conversation, per the same reasoning as v8.

**Verified, not assumed:** real Playwright screenshots of the default
Snapshot view, the expanded detail panel, actually scrolling to confirm
the sticky bar engages, and a mobile viewport (confirming the strip
wraps to 2 columns and the expand panel stacks instead of squeezing 3
columns into a narrow screen). Full syntax check on the inline script.
**All 114 existing tests re-run and pass unchanged.**

---

## v10 — "De-AI" visual finishing pass

A ChatGPT status review (the "8/11 night" consolidated handoff) flagged
that despite Pass 1/Pass 2, the interface still had several tells of an
"AI-generated" look it specifically named: large card radii (~18px),
fully-rounded 20px capsule buttons, pill-shaped filters/toggles at 999px
radius, a symmetrical 3-card Top Opportunities row with no visual
hierarchy between rank 1/2/3, and heavy uppercase micro-labeling
throughout. I verified every one of these claims against the actual CSS
before touching anything — all accurate, none overstated.

**Changes made (all in `app/index.html`, purely visual, zero JS logic
changes):**

- **Consistent, softer corner radii everywhere** — reduced from a mix of
  12–20px down to a uniform 8px (6px for small chips/badges) across
  `.card`, `.btn`, `.board`, `.full-board-cta`, `.teampick`, `.badge`,
  `.iconbtn`, `.pick-chip`, form inputs, and the Snapshot-specific
  `.opp-card`. This was genuinely inconsistent before (12px here, 14px
  there, 18px elsewhere, 999px capsules in a few places) — now it's one
  deliberate scale, not a redesign.
- **Raw Edge de-badged**, matching the treatment Cover % already got in
  v8 — dropped the colored-background pill shape, kept the bold colored
  text (still the most visually prominent number on the row, just reads
  as a value now instead of a status chip). This is the single biggest
  "fewer green (and red) backgrounds" change, and it's shared by both
  Snapshot's Quick Look table AND the full Edge Board's own Edge column
  (same `.pill` class, one change fixes both consistently).
- **Full board's Edge/Pick column whole-row highlight fill was
  deliberately LEFT ALONE** (radius fixed for consistency, but the fill
  itself kept) — that's the single largest green/red background in the
  app, but it's a load-bearing scanning aid for a 40+ row dense table,
  not a decorative badge like Raw Edge/Cover% were. Removing it would be
  a real functional change to how the full board reads at a glance, not
  cosmetic polish — flagged explicitly rather than silently changed.
- **Top Opportunity #1 is now visually distinguished** from #2/#3 — a
  slightly wider grid column (1.12fr vs 1fr) plus a green accent
  border/background on rank 1 specifically. Not a full redesign, just
  enough asymmetry that your eye lands there first.
- **Week Snapshot flattened** — no longer a bordered/shadowed card, just
  a hairline top/bottom divider with the page background showing
  through, per the doc's specific "flatter Week Summary" request.
- **Reduced uppercase micro-labeling** on the card-level stat labels
  (Raw edge/Cover est./Pick score) and the expand panel's column headers
  (Your model/Market/Signals) — sentence case now, no letter-spacing.
  Section-level eyebrows (TOP OPPORTUNITIES, QUICK LOOK) and table column
  headers were deliberately left uppercase — that's a conventional
  analyst-table pattern the doc's own "Bloomberg-style" aesthetic target
  explicitly wants, not part of the "shouty label" problem being fixed.

**Verified, not assumed:** real Playwright screenshots of Snapshot, the
full Edge Board, the expand panel, and a mobile viewport, all after the
change. Full syntax check on the inline script. **All 114 existing tests
re-run and pass unchanged** — this was, once again, a pure styling pass
with zero logic changes.

**What this did NOT touch, on purpose:** the dark header/navigation band
was explicitly called "optional" in the source doc, and it's the single
biggest brand-identity change in the whole list — left it as-is rather
than silently flip it. If you want that too, it's a quick follow-up, not
a big lift given everything else is already de-radiused/de-badged.

---

## v11 — My Picks redesigned into a real entry-review workspace (UI Pass 3, item 1)

The first UI Pass 3 item from the status tracker — "the biggest remaining
UX improvement" per both ChatGPT docs. Unlike v8-v10, which were pure
visual polish, this introduces genuinely new computed logic, not just
restyled markup — so it gets its own test file, not just screenshots.

**What changed (all in `app/index.html`):**

- **New helper `pickedSideStats(live, pickedSide)`** — computes Edge and
  Cover % from the perspective of the side someone ACTUALLY picked, not
  whichever side the model currently favors. This is a real distinction:
  `edgeOf()`/`probabilityCoverForGame()` always report the model's own
  favored side, which can silently diverge from an actual pick if the
  market moved since the pick was made, or if someone picked against
  what the model likes. This function is the actual mechanism behind
  every new warning below — not a UI label, a real computation.
- **New helper `movePick(entryId, key, dir)`** — reorders one entry's
  picks by rebuilding the picks object with new key insertion order.
  Picks are stored as `{key: {...}}`, not an array; JS preserves
  string-key insertion order (ES2015+), and `Object.entries(e.picks)`
  already relied on that same guarantee elsewhere in this file before
  this change, so no new schema field was needed to support reordering.
- **`renderPicksDetail()` rewritten.** Each pick row now shows: rank
  number, team + line (bold headline, matchup as secondary text, same
  pattern used elsewhere in this project), real Edge/Cover % for the
  picked side, CLV when in a pool (reusing the existing `clvOf()`), and
  four actions — move up, move down, open on full board (reuses the
  same jump-and-scroll pattern from Snapshot's expand panel), remove.
- **Entry-review panel** at the bottom of each entry: a completeness line
  (✓/○ `N / limit picks selected`), and warnings generated from real
  data only — no fabricated heuristics like "too many favorites":
  - Off-board picks (game no longer on the current board)
  - Picks with no model inputs loaded
  - Picks with `edgePts` below `state.goodThresh` **from the picked
    side's own perspective** — this catches picks that go against what
    the model currently favors, which the old bare pick list had no way
    to surface at all
  - In a pool: CLV that's moved more than 1 point against the pick

**Real bug this actually caught during testing, not a hypothetical:**
tested with 6 real demo picks and the warning system correctly flagged
a Houston pick showing **-1.2 edge** — meaning that specific pick goes
against what the model currently favors for that game. The OLD pick
list would have shown nothing wrong with it; the new one catches it
immediately. This is exactly the class of problem the whole feature was
built to surface, verified with an actual screenshot, not asserted.

**Verified, not assumed:** real Playwright run — made actual picks
through the real board UI, viewed the redesigned My Picks tab, confirmed
the warning system fired correctly on a real weak/negative-edge pick,
confirmed reordering actually swaps pick order in the underlying data
(not just visually), confirmed a mobile viewport renders without
breaking (functional, not fully polished — same caveat as Snapshot's
mobile table elsewhere in this project). Full syntax check. **12 new
tests** added in `tests/test_mypicks_logic.mjs` (same Node `vm`
extraction pattern as the rest of the suite) proving `pickedSideStats`
correctly returns opposite-sign edges for the two sides of the same
game, returns `null` for off-board/no-model-data games, and that
`movePick` correctly reorders, is a no-op at the boundaries, and doesn't
corrupt pick data. **126 checks total now pass** (was 114).

**What this did NOT include, on purpose:** a hard "Lock Entry" state
(would need a new persisted field and gating logic across every place
picks get added/removed — a bigger, riskier change than this pass
scoped for) and drag-and-drop reordering (up/down arrows achieve the
same reordering goal without a new dependency or the fragility
drag-and-drop tends to have in a vanilla-JS single file). Both are
reasonable future follow-ups, not silently dropped.

---

## v12 — Mobile Snapshot polish (item 17), and a real bug found along the way

Went to do a scoped "polish" pass and found a genuine CSS specificity
bug instead of just a rough-edges problem — worth reading the actual
root cause below, not just the visual result.

**The real bug, found before touching anything cosmetic:** the full
board's dedicated mobile layout (`@media(max-width:720px)`) uses several
completely unscoped selectors — bare `table{}`, `thead{}`, `tbody{}`,
`tr{display:grid;grid-template-columns:60px repeat(4,1fr) 60px;...}`,
`td{}`, and about a dozen more — built specifically for the full board's
own column structure (game/BP/Comp/Vegas/Model#/Cover%/Edge). Since none
of them were scoped to `.board` (the full board's wrapper div), they were
silently also applying to Snapshot's Quick Look table, which has a
completely different column set (chevron/bet/market-model/edge/cover/
[clv]/signal/[score]/action). Snapshot's table cells were being forced
into a 6-column grid template that doesn't match their actual structure,
with no explicit grid-column placement for most of them (since they don't
have the full board's `veg-cell`/`myn-cell`/etc. classes) — so they fell
through to the browser's default grid auto-placement, scattering across
the wrong-shaped grid. That's the actual cause of the cramped, misaligned
mobile table Drew saw — not a lack of polish, a real specificity bug.

**Fix, in two parts:**
1. **Scoped 15 full-board-specific selectors to `.board`** (verified each
   replacement was unique and applied exactly once via a script, not by
   hand editing 20+ individual rules and hoping nothing was missed).
   Confirmed the full board's own mobile card layout — logos, key-number
   badges, edge highlight box — is completely unaffected (screenshot
   comparison before/after).
2. **Built Snapshot's own dedicated mobile treatment**, scoped to
   `#tab-snapshot table` specifically so it can never interfere with or
   inherit from the full board's rules again: chevron in its own column,
   team+matchup as the headline, pick action in the top-right corner
   (was dangling below with dead space in the old generic `data-label`
   fallback), and every stat cell (Market→Model, Raw Edge, Cover %,
   Signal, CLV/Score when present) stacking cleanly on its own row via
   CSS grid's natural auto-placement — each subsequent cell requesting
   the same column span automatically gets bumped to the next free row,
   no manual row-numbering needed for the variable-length set of
   optional cells.

**A real mistake caught mid-build, not shipped:** my first version of
the new grid rule used `display:inline` on a grid item and an unused
`.pr-mobile-stats` wrapper class that was never actually applied
anywhere in the JS — dead CSS that looked plausible but did nothing.
Caught by actually rendering it and looking at the screenshot rather
than trusting the CSS reasoning, then fixed to rely on grid
auto-placement correctly (verified the fix visually, not just
theoretically).

**Also polished:**
- Week Snapshot strip: horizontal scroll instead of a 2-column wrap grid
  that was breaking visual rhythm (some labels wrapping to 2 lines,
  others staying on 1). Reuses the exact same swipeable-strip pattern
  `nav.tabs` already established, rather than inventing a new one.
- Removed the now-dead `display:grid` rule for `.snap-strip` from the
  earlier de-AI pass rather than leave two conflicting mobile rules for
  the same element across two different breakpoints.
- Tightened expand-panel spacing on mobile (was sized for its desktop
  3-column layout, too loose once stacked to 1 column).

**Verified, not assumed:** real Playwright screenshots at a 390px
viewport — Snapshot before and after, the expand panel, the full board
(confirming zero regression there), and My Picks (confirming zero
regression there too, since it wasn't touched but shares some of the
same CSS classes touched in this pass). Full syntax check. **All 126
existing tests re-run and pass unchanged** — this was CSS-only, no JS
logic touched.

---

## v13 — Provider game IDs for grading, and a Chrome credential-popup fix

Two separate rounds. The first is a real architecture change (Priority
10/10 in the original ChatGPT CFBD research doc, flagged as unfinished in
every prior round); the second is a targeted fix for a long-standing open
item that couldn't be verified without live access.

### Provider game IDs (item 9 — grading no longer relies solely on team names)

Every pick now carries The Odds API's own stable event ID
(`providerGameId`) alongside the existing matchup/team-name data.
Grading tries the ID first; team-name matching is now the fallback, not
the only mechanism.

**Verified before building anything:** confirmed via The Odds API's own
documentation that this ID is genuinely stable across `/odds` and
`/scores` for the same real-world game — the `/scores` endpoint
explicitly accepts filtering by `eventIds` obtained from `/odds`, which
only works if they share the same ID space. Not assumed.

**Files changed:**
- `api/fetch_odds.py` — `extract_games()` now captures `ev.get("id")`
  from The Odds API into the shared cache.
- `api/grade_picks.py` — `score_lookup()` captures the same ID from
  `/scores`; `find_final_score()` rewritten to accept the full pick
  object (was just a matchup string), tries `providerGameId` first,
  falls back to the original team-name matching for picks that don't
  have one (old archived picks, or picks on games that never matched a
  live odds entry).
- `app/index.html` — `buildGames()` carries the ID through for both
  Overall board (inherited from the shared cache) and pool context
  (pulled from the matched live board game, when one exists).
  `pickTeam()` stores it on every new pick.

**Real bug caught and fixed while building this, not just new code
added:** both week-archiving functions (`closeWeek()` and
`archivePoolCurrentWeek()`) built their archived snapshots by naming
specific fields explicitly, with no spread operator — meaning they would
have silently dropped `providerGameId` the instant a week got archived,
which is exactly when grading needs it. Caught by tracing the data flow
all the way through the archive path, not just adding the field to
`pickTeam()` and assuming it would survive. Fixed both functions to
carry it through, refreshing it from the live game at archive time when
possible (maximizing the chance of having a valid ID by the time grading
actually runs) and falling back to whatever was already stored on the
pick otherwise.

**Verified with real execution, not just unit tests:** ran the actual
`pickTeam()` flow in a real Playwright page and confirmed the ID landed
on the stored pick; then ran the actual `closeWeek()` flow and confirmed
it survived into the archived record — the exact spot that was silently
dropping it. 6 new tests in `tests/test_grading.py` covering
`find_final_score()`: ID match takes priority, an ID not present in the
current scores payload correctly falls through to team-name matching
(not treated as ungradeable), a legacy pick with no ID at all still
works exactly as before (backward compatible), and the function still
accepts a raw matchup string directly for any caller that hasn't been
updated.

**What this does NOT include:** a new CFBD integration (the CFBD
research doc's own "Phase 1" recommendation was building a dedicated
`/api/cfbd_week` endpoint and using CFBD's game IDs specifically) — this
uses the Odds API's ID, which is already being fetched, no new
integration required. If a CFBD identity layer gets built later, it can
coexist with or replace this the same way team-name matching still
coexists as the fallback now.

### Chrome credential-popup fix (item 21)

**Honest limitation stated first:** reproducing a live Chrome native
credential-manager popup requires a real Chrome browser profile and
access to the actual live deployment — neither exists in this sandboxed
environment. This was NOT reproduced directly; a concrete, plausible
root cause was found by inspecting the actual code instead, and fixed.
Needs confirmation on the real live site that the popup is actually
gone — flagged as an open item below until that happens.

**What was found:** this app has exactly one `type="password"` field
anywhere in the entire codebase — the personal Odds API key field in
Settings — and it is not a login credential at all. It sits directly
next to a "Save key" button. That's precisely the pattern Chrome's
password-manager heuristics look for. Confirmed the app uses zero
`<form>` elements anywhere (a `<form>` wrapper isn't required for modern
Chrome's heuristics to trigger — they specifically evolved to catch
JS-driven "forms" like this app's own architecture, since so many modern
single-page apps don't use native `<form>` elements anymore).

**Fix:** changed `apiKeyInput` from `type="password"` to `type="text"`,
with `autocomplete="off"` and a new `.apikey-mask` CSS class using
`-webkit-text-security` to visually obscure the value on screen exactly
like a password field, without the browser attaching credential-manager
semantics to it. Not supported in Firefox (falls back to plain text
there) — an acceptable tradeoff given this is a personal API key, not an
account password, and the reported issue is Chrome-specific.

**Verified:** confirmed the field's `type` is genuinely `text` now, that
`.value` still round-trips correctly through the real save/load flow
(typed a value, clicked the real Save key button, confirmed
`state.apiKey` updated correctly), and screenshotted the field to
confirm it still visually renders masked (dots), not plaintext.

**Files changed:** `app/index.html` only.

### Test count

**136 checks total** (130 before this round + 6 new in
`tests/test_grading.py`), all passing as of this handoff.

---

## v14 — Snapshot's CLV column was blank for almost every row (real bug, found from a real screenshot)

Drew reported this from an actual screenshot of a real pool ("Splash
pool TEST"), not a hypothetical — every row in the Quick Look table
showed "—" under CLV except (potentially) a picked game.

**Root cause:** the CLV column only ever passed a pick's `side` into
`clvOf()`. For any UNPICKED game — which is almost every row in a real
34-game slate — that argument was `null`, and CLV genuinely can't be
computed without knowing which side to grade against, so it fell back to
a blank dash for nearly the whole table.

**Why the full board never had this problem:** it already had a fallback
for exactly this case (`clvHTML` in `renderBoard()`) — when a game isn't
picked yet, it shows the *raw* home-perspective market movement since
lock (a real number, not tied to any side) instead of nothing. Snapshot's
condensed table just never got the same treatment when it was built.

**Fix:** matches the full board's existing behavior. Extracted the
decision logic into a new pure function, `snapClvCellData(g, pickedSide)`
— returns `{kind: "none"|"raw"|"pick", value}` — separate from the HTML-
building code, so it's independently testable (matches this project's
established pattern, e.g. `pickedSideStats`). Unpicked games with real
lock/live data now show the raw market move with an explanatory tooltip;
picked games still show the pick-specific CLV exactly as before; games
with no lock or no live match still correctly show nothing (that's
genuinely not a bug — there's nothing to report).

**Checked whether the expand panel had the same bug — it didn't.** Its
CLV computation already fell back to the model's own recommended side
(`e.side`) instead of `null` when nothing's picked, so only the table's
dedicated CLV column ever had this gap.

**Verified with a real pool scenario built through the actual app, not
just code reasoning:** constructed a real pool with locked lines and a
live odds match, gave the games real model inputs so they'd actually
appear in the list, made one real pick, and screenshotted the result —
confirmed the unpicked row shows the raw market move, the picked row
shows the pick-specific CLV, and the sign correctly flips when picking
the opposite side of the same game.

**Files changed:** `app/index.html` only (new `snapClvCellData()`
function + the CLV cell rendering in `renderSnapshot()`).

**8 new tests** in `tests/test_snapshot_logic.mjs` — including one that
names the exact reported bug directly ("an UNPICKED game with real
lock/live data shows 'raw' (the actual fix), not blank"), plus picked-
side matching `clvOf()`'s own math directly (no reimplemented
calculation), sign flipping correctly for the opposite side, and the
genuinely-nothing-to-report cases (no lock, no live match, zero
movement) still correctly showing nothing rather than being misread as
also-broken.

**Test count: 144 checks total** (136 before this round + 8 new), all
passing as of this handoff.

---

## v15 — Snapshot mobile fixes, a real sign-convention bug, Prediction Systems
   restructure, mobile nav overflow, and a new "Weekly Setup" status card

A long session driven by real screenshots and a full UI/workflow walkthrough
rather than a single bug report. Everything below was verified either by
running the real 150-check suite (grown from 144 this session) or by
rendering the actual page with Playwright + a mocked Clerk session — several
items specifically caught real bugs that reasoning alone would have missed.

### Snapshot mobile: labels and pairing on the Quick Look table
The mobile card layout (from v12) hid the table's `<thead>` and rebuilt each
row as a CSS grid, but never carried over any equivalent to the full board's
`data-label` fallback (`.board td[data-label]::before`) — every stat cell
was a bare, unlabeled number. Fixed with a scoped `#tab-snapshot
td[data-label]::before` rule. Also repositioned the grid (4 columns instead
of 3) so Raw Edge pairs with Cover % and CLV pairs with Signal side by side,
per Drew's screenshot request, with each cell placed explicitly by its
`data-label` value (not source order) so CLV/Score being absent in non-pool
mode doesn't shift anything else. A follow-up bug from this same change —
Signal defaulting to the paired-with-CLV half-width even when CLV didn't
exist, leaving a dead gap — was caught while capturing screenshots for an
unrelated request and fixed same-session (`CLV ~ Signal` sibling-combinator
override instead of an unconditional rule). The expand chevron was also
bumped from 11px/light-gray to 20px/bold/ink with a real ~36px tap target.

### Real bug: Market → Model sign convention (not cosmetic)
`myNumber()`/`weightedModel()` always return the model number in
home-team-spread convention — that's documented and intentional. `e.line`
(from `edgeOf()`), however, is already flipped to whichever side got
picked. The Snapshot condensed row's "Market → Model" cell displayed these
two numbers side by side with an arrow implying direct comparison, with no
adjustment — so for any AWAY pick, it silently mixed two different sign
conventions. Confirmed against three real screenshot examples (North Texas
+40.5, Ohio +23.5, Toledo +11.5) before touching code: e.g. North Texas
showed "+40.5 → -32.2" when the real edge (8.3) only works out if the
model number is +32.2. Fixed via a new `mktModelHTML(e, myn)` function that
flips `myn` when `e.side==="away"`. A real regression test was added
(`tests/test_snapshot_logic.mjs`) using the exact screenshot numbers, not
synthetic ones. The SAME bug family existed in the Snapshot detail panel's
"Market" column — outside a pool it fell back to `e.line` too, while the
"Your model" column stayed correctly home-perspective throughout (BP, Comp,
each system, and the Model # total). Fixed there differently: rather than
touching the model side, swapped `e.line` for `g.vegas` (home-perspective),
matching the exact pattern the full board's own Vegas column already uses
(`pool?g.liveVegas:g.vegas`) — no new convention introduced, and the
BP/Comp/system breakdown rows didn't need to change at all.

### Prediction Systems: real accuracy data replaces a blind "top 4" button
Drew provided real 2-year backtest data (40% ATS% / 30% MAE / 30% |Bias|,
rank-weighted composite) ranking all ~40 systems. The old "Enable top 4 (my
eval)" button silently encoded a guess (`sag`+`sagpred`+`dokter`+`big200`)
that was never verified against real column names — removed entirely.
Replaced with a `TOP_SYSTEM_RANKS` lookup and a "★ Top 10" pill (amber,
matching the existing key-number badge palette) next to each matching
system's checkbox, plus a legend line above the grid. **5 of the 7 real
systems in the backtest are mapped and starred**: Dokter Entropy (#3), Big
200 (#4), Congrove Computer Rankings (#6 — matched to code `cong`, NOT the
plain `congrove` entry, which is a different row), TeamRankings.com (#8),
ESPN FPI (#10). **#1 "Sagarin Points" and #2 "Sagarin Ratings" are
deliberately left unmapped** — this app has four Sagarin codes (`sag`
"Sagarin (Rating)", `sagpred` "Sagarin Predictor", `saggm` "Sagarin Golden
Mean", `sagr` "Sagarin Recent") and none of them says "Points"; guessing
which two are the real #1/#2 risked exactly the kind of fabricated-signal
mislabeling this project has been strict about elsewhere. Needs Drew to
confirm the mapping — see Known Open Items.

### Mobile nav tabs no longer silently clip
With 6 tabs the nav bar overflows and scrolls (existing v-something
behavior) but gave zero indication that Settings/Help were off-screen.
Added `.tabs-wrap::before/::after` edge-fade gradients (color-matched to
the nav's own dark background) toggled by *actual scroll position* via a
`scroll` + `resize` listener (`initNavTabsScrollHint()`/
`updateNavTabsScrollHint()`), not just "is this wider than the viewport."
Verified all three states (start/middle/end) in a real 390px-wide render.
Confirmed a genuine no-op on desktop, where `scrollWidth === clientWidth`
and neither fade class ever applies.

### Input Weights: BP/Comp boxes were showing even when unchecked
The "Input weights" bar always displayed BP, Comp, and Vegas weight inputs
regardless of whether BP/Comp were actually toggled on in the checklist
below — misleading, since `weightedModel()` skips both entirely when their
checkbox is off. Fixed: `#cwBp`/`#cwComp` now hide/show based on
`state.enabledSystems`, computed inside `renderSystemsSettings()` (already
called on every relevant state change). **Vegas was deliberately left
always-visible** — unlike BP/Comp it has no checkbox anywhere and
`weightedModel()` folds it in unconditionally whenever a game has a live
line; there's no toggle to gate its box behind. Whether to add a *real*
Vegas on/off toggle (which would change what Model # means, not just what's
displayed) is an open question for Drew — see Known Open Items.

### New: persistent cross-tab data-completeness system, then a full
    "Weekly Setup" checklist
Identified during a full UI/workflow walkthrough: the only completeness
signal in the whole app was the "you're looking at demo data" banner,
which (a) only ever lived inside the Board tab's markup — Snapshot, the
DEFAULT landing tab, had zero completeness signal at all, even in plain
demo mode — and (b) said nothing about the specific "real lines loaded but
forgot to load model inputs" case, which is real and invisible: Model #
can't be used to detect "no inputs loaded" because `weightedModel()` always
folds Vegas in whenever present, so with zero other inputs it silently
EQUALS Vegas for every game (edge reads ~0 everywhere, but nothing ever
comes back null).

First pass: a single persistent `#setupNotice` card (moved out of the Board
tab into shared markup in `<main>`, before both tab `<section>`s, so it
shows regardless of which tab is active) with one dynamic message covering
demo / zero-model-input / partial-coverage / fully-set-up states.

Drew then asked for the fuller version from his own mockup: a real
"WEEK N SETUP" checklist with 5 independently-checkable items (Vegas lines
updated, Powers PDF imported, prediction systems loaded, pool lines
imported, entry selected), each backed by real state — not inferred from a
derived number — plus freeform warnings below for things that are a matter
of degree rather than pass/fail (currently: odds staleness via
`minsAgo(state.lastRefresh)`, threshold 180min). "Powers PDF imported"
reports exact missing counts ("BP missing for 2 of 2 games") by reading
`inputsFor()` directly per game, the same source Model # itself reads, so
it can't drift from what's actually on the board. A "Finish Setup →" button
jumps to Settings if no API key is saved yet, else Board (where PDF/pool/
predictions controls all live). When everything's true, the card collapses
to a single slim confirmation line ("✓ Week 1 setup complete") rather than
vanishing outright, matching Drew's "immediate confidence" framing.

Final refinement: made the checklist itself a native `<details>`,
collapsed by default with just the indicator line showing (`⚠ WEEK 1
SETUP  2 of 5 complete  ▸`), full checklist revealed on click. The tricky
part: this card re-renders on nearly every state change (any checkbox,
pick, or refresh calls `renderBoard()`/`renderSnapshot()`, both of which
call this). A naive full-innerHTML rebuild would silently re-collapse an
expanded card the instant anything else on the page changed. Fixed by
having the render function check whether a `<details>` node from the
PREVIOUS render already exists and reusing it in place (only updating the
`<summary>`/body content, never touching `.open`) rather than recreating
it — a fresh node only gets created (defaulting closed) the first time the
card appears in checklist mode. Proved this actually holds via
`element.open` checks in a real Playwright session, both directions
(survives an unrelated re-render while expanded; survives while collapsed
too), not just asserted.

**Deliberate design choice worth flagging**: "Pool lines imported" and
"Prediction systems loaded" are unconditional requirements in this
checklist, matching Drew's mockup exactly. If some week Drew runs BP/Comp-
only with no pool, this card will permanently show 2 warnings that aren't
really problems for that week. Not softened without being asked — see
Known Open Items.

### Full UI + workflow audit (analysis only, most of it now acted on)
A full walkthrough of every tab (rendered via Playwright + mocked Clerk +
the app's own built-in DEMO dataset, not reasoned from memory) produced a
written UI and workflow analysis. Most concrete findings from it were
picked up this same session (mobile nav clip, Prediction Systems flat
list, the Market/Model sign bug, data-completeness). Still open: see Known
Open Items below, and a separate "what's missing vs. a normal website"
pass (landing-page trust/legal gaps — no Privacy Policy, no Terms, no
responsible-gambling link, no account-deletion or email/password-change UI
in-app, no favicon, no feedback channel, no error boundary — flagged as
elevated priority specifically BECAUSE auth mode is currently Public).

### Test suite: 144 → 150 checks
6 new checks in `tests/test_snapshot_logic.mjs` covering `mktModelHTML()`
directly, using the real North Texas / Ohio / Toledo screenshot numbers
plus a home-pick sanity check and a null-input case. No new tests were
added for `computeWeeklySetup()`/`computeSetupDisplay()` — like
`computeWeekStats()` before them, these read module-level `games`/`state`/
`currentPool()` globals directly rather than taking pure params, which is
outside this project's existing `vm`-extraction test pattern; verified via
real Playwright renders (seeded non-demo `state.lastGames` via
`localStorage`, not just the DEMO array) covering all-missing, partial,
fully-complete, and stale-odds states instead.

## v16 — Shared-state race fixed for real, a new Weekly Setup checklist, a
   global Context Bar, and two design passes

The largest single-session jump in the project's history by item count.
Everything below was verified either against the real 158-check suite
(unchanged in count this session -- see "Known gap" at the end) or by
rendering the actual page with Playwright + a mocked Clerk session. Two
real bugs were found DURING verification, not just fixed on request --
both are called out below because the pattern behind them is worth
knowing for next time, not just the specific fix.

### The shared Redis race, actually fixed this time
Long-standing open item: `fetch_odds.py`, `fetch_predictions.py`, and pool
publishing (`api/state.py`) all did unprotected read-modify-write against
ONE combined key (`edge_board_shared`). Two different endpoints refreshing
close together could silently overwrite each other's write with no error
and no indication it happened. Fixed by splitting into three independent
keys -- `edge_board_shared_odds`, `edge_board_shared_predictions`,
`edge_board_shared_pools` -- so odds and predictions can no longer touch
each other's data even in principle, not just "less likely to collide."
Pool publishing got stronger treatment than a key split alone: it's a
genuine multi-writer LIST merge (two people publishing different pools at
once), so it now uses the same atomic compare-and-set already proven for
private-state writes (`cas_write`/`CAS_SCRIPT`), with a retry-on-conflict
loop. `GET scope=shared` reads all three keys and merges them into the
same flat shape `index.html` already expected, falling back to the legacy
combined key for any field not yet under its new key -- so the cutover
doesn't blank out whatever was cached before the split deployed. Proved
the fix with a REAL concurrent-write test (actual Python threads, not two
sequential calls) publishing two different pools at once -- both survive.
`tests/test_state.py` grew from 28 to 36 checks for this.

### Weekly Setup: from a single banner to a context-aware checklist
Built in stages across the session. Started as one dynamic status message
(`#setupNotice`) covering demo/no-inputs/partial-coverage states, moved
into your own mockup's full "WEEK N SETUP" checklist (5 independently-
checked items: Vegas lines, Powers PDF, prediction systems, pool lines,
entry selected), then made collapsible by default (native `<details>`,
reused across re-renders rather than rebuilt, so a manual expand survives
the next unrelated state change instead of silently re-collapsing), then
made CONTEXT-AWARE: "Prediction systems loaded" and "Pool lines imported"
used to be unconditionally required, which meant a deliberately BP/Comp-
only week or a non-pool week permanently showed 2 false warnings. Now:
BP/Comp and prediction-system items go gray/"not applicable" if you
haven't toggled them on at all; Pool lines goes gray/"not applicable"
outside a pool context. "na" items don't count toward the completion
ratio, so a genuinely-complete BP/Comp-only week reads "3 of 3 complete,"
not "3 of 5" implying two unaddressed problems that were never real.
Found and fixed a real edge case while verifying this: an EMPTY pool
(zero games imported) was hitting the generic "no games loaded, hide the
whole card" rule before the checklist ever got to say "Pool lines
imported: [warning]" -- exactly backwards, since an empty pool is the one
case that item exists to catch. Fixed the hidden-mode guard to only fire
when there's no pool context to explain the emptiness.

### Vegas weight now defaults to 0, and a real bug that would have undone it
Vegas used to default to weight 1 (full inclusion in Model #) with no
checkbox to turn it off the way BP/Comp/prediction-systems have --
meaning Model # silently included the market itself for anyone who'd
never touched that box, including brand-new users who never consciously
chose that. Changed the default to 0 in `weightOf()`. Found a real bug
while implementing this, not after: `setWeight()` had a sparse-storage
optimization -- "if the typed value matches the default, don't bother
storing an override" -- hardcoded to compare against `1` for every input.
With Vegas's default now `0`, that same code would have silently DELETED
a user's explicit "1" entry for Vegas the moment they typed it, reverting
it right back to 0 -- exactly backwards from "let the user specify a
weight." Fixed to compare against each key's own actual default. Also
fixed "Reset to equal," which used to just clear `state.weights` entirely
(fine when every default was uniformly 1; wrong now, since clearing would
leave Vegas at 0 while resetting everything else to 1) -- it now
explicitly writes 1 to every input actually in play. Verified all three
behaviors with real interaction: typed "1" into the real Vegas box and
confirmed it sticks; confirmed `myNumber()` returns `null` (not a silent
Vegas mirror) when nothing else is enabled; confirmed Reset to equal
lands Vegas on 1, not 0.

### Account/profile management via Clerk's own UI
One button ("Manage account" in Settings -> Account) calling
`window.Clerk.openUserProfile()` -- Clerk's own hosted modal for email/
password/security, already loaded for sign-in. No custom form built or
maintained here.

### Global JS error boundary
`window.onerror` + `unhandledrejection`, both registered as literally the
first statement in the inline script (before anything else runs), showing
a dismissible banner -- deliberately NOT a full-page takeover, since most
caught errors are recoverable and the rest of the page may still work.
Registered WITHOUT `capture:true` specifically so it doesn't fire on
resource-load failures (a blocked font, a flaky CDN image) -- those
dispatch a plain Event that doesn't bubble to window on the default
phase, confirmed by injecting a broken image on a clean page load and
checking the boundary never shows. Markup lives outside both the sign-in
gate and the app root (`position:fixed`, high z-index) so it can catch
and display something even if the crash happens before Clerk resolves
sign-in.

### README.md written from scratch
Repo structure, architecture (the private/shared Redis split above),
every environment variable actually referenced across `api/*.py` (pulled
by grepping the files, not from memory), test commands, deploy notes.

### Header restructure: Settings/Help become icons, not tabs
Nav bar dropped from 6 tabs to 4 (Snapshot/Edge Board/My Picks/Record).
Account, Settings, and Help moved to three circular icon buttons in the
header (person/gear/question), lighting up on whichever's active. The old
single "Settings" tab was actually two unrelated things wearing one
label -- split into a real `#tab-account` panel (signed in as, Manage
account, Sign out, sync buttons) and a slimmer `#tab-settings` (API key/
book/thresholds, backup/export/reset). Caught and fixed two stale Help-
text claims while in there: both said prediction systems get "toggled on
in Settings," but those checkboxes have always lived in the Prediction
Systems panel on the Edge Board tab, not Settings -- wrong before this
change too, just never noticed until this touched the same text.

### Global Context Bar: one Pool/Entry/Week source of truth, replacing
    real DOM duplication
Before this, Context and Picking-for existed as two SEPARATE `<select>`
pairs -- `snapContextSel`/`snapEntrySel` on Snapshot, `contextSel`/
`activeEntrySel` on Board -- kept in sync via a shared render pass but
still two places a person had to re-locate the same control. Snapshot
(the default landing tab) had NO week indicator anywhere. Replaced both
with one persistent bar (`#contextBar`, shared across every tab like
`#setupNotice`) showing "Pool · Entry · Week" plus a status line (pick
count, lock status, odds staleness), click to open a compact 3-column
switcher. Week's switcher section is deliberately NOT the same flat-list
pattern as Pool/Entry -- a pool's week isn't calendar-navigable (it's
whatever the last imported sheet set), so pool context shows static
status text there instead of prev/next controls that would imply a
control that doesn't do anything.

Found and fixed a real, subtle bug while verifying this with actual
clicks (not just reading the code): clicking a week-navigation button
inside the open switcher was closing the switcher on its OWN click. Cause
-- the button's own click handler re-renders the switcher's week section
synchronously, which detaches the original (mid-click) button from the
document as a side effect. The click-outside-to-close listener used
`bar.contains(e.target)`, a LIVE tree check -- and a just-detached node
correctly reads as "not contained in anything," so it looked exactly like
an outside click. Fixed by switching to `event.composedPath()`, which
captures the dispatch path at the START of the event, before any handler
gets a chance to mutate the DOM -- a since-replaced node still correctly
shows up as having been inside the bar when the click actually happened.
Re-verified the full week-navigation sequence after the fix (Next, Next,
Prev, Show all weeks, jump-to-date) with the switcher confirmed open
(`display:grid`) after every single click, plus confirmed a genuine
outside click still closes it.

### Two design passes, from a 4-point design critique
The critique's 4 points, in the order tackled: (2) green was used in 61
places, diluting its meaning -- audited and found the real problem wasn't
volume, it was CONFLATION: "this is where you currently are" (active tab,
active header icon, active toggle) was colored identically to "this is
positive/actionable" (Add Pick, positive edge, the #1 opportunity card).
Reassigned exactly 3 rules (active tab underline, active header icon,
active Raw Edge/Pick Score toggle) to neutral colors already used
elsewhere in the app for the same "current selection" meaning (dark slate
-- matching the Quick Look filter pills' existing convention) -- and
explicitly did NOT touch anything genuinely positive (the #1 card's
green highlight, STRONG/GOOD labels, win badges, positive edge values),
per an explicit instruction not to over-correct. Then (4) one primary
action per section + (3) give #1 more visual weight, done together since
they reinforce each other: found that all THREE Top Opportunity cards
were independently rendering their own green "Add pick" button whenever
unpicked -- up to three identical CTAs competing for the same click, not
just a hypothetical risk. Now only the #1 card gets `btn-go` (green);
#2/#3 get `btn-secondary` (bold dark outline -- still clearly clickable,
not demoted to plain text). The grid ratio went from `1.12fr 1fr 1fr` (a
12% width difference too subtle to register -- literally invisible enough
that this was described as if it didn't exist) to `1.5fr 1fr 1fr`, with
#2/#3's team-name and edge-number type scaled down to match, so the
narrower column reads as "less emphasis," not just "less room." Point
(1) of the critique -- reducing pill/badge/rounded-card density generally
-- is deliberately NOT started; it's the biggest remaining item and was
sequenced last on purpose.

### Chased down two more stale-doc inconsistencies from an independent
    ChatGPT re-audit
`handoff.md`'s own title still said "(v14)" despite a full v15 section
existing below it -- fixed (now correctly says v15, and this v16 section
keeps it current). `api/fetch_teams.py`'s 401 error message said "pass
?key=" when the code actually reads an `X-Cfbd-Api-Key` header -- a
leftover from before the API-key-hardening pass moved keys off query
strings; message corrected. `api/parse_pdf.py`'s CORS headers were
missing `Authorization` compared to every other endpoint; normalized.

### Clerk pinned to a real version
`@clerk/clerk-js@latest` -> `@6.28.1` (checked against npm directly, not
assumed) in `app/index.html`'s script tag. This was the ONE thing
standing between a visitor and a signed-in session silently pulling in
whatever Clerk shipped that day, with no way to roll back to what was
actually tested.

### Known gap: test coverage didn't grow with feature count this session
`tests/test_state.py` grew (28 -> 36) for the shared-key/CAS work, and
that's the only automated-test growth this session -- the Context Bar,
error boundary, Weekly Setup context-awareness, and the icon-nav
restructure all have ZERO automated coverage. All of it was verified via
real Playwright renders during the session (documented in each section
above), which proves the logic worked AT THE TIME but doesn't protect
against a future change silently breaking any of it. Worth a dedicated
pass before this list gets much longer -- `computeContextSummary()`
particularly, since it's pure enough to unit-test the way `mktModelHTML()`
already is.


## v17 — Pool-vs-market CLV strengthened, Snapshot header decluttered, and the entire JS-splitting pass (app/index.html: 4,815 -> 1,837 lines)

Two threads this session: a handful of real UI fixes early on, then a
long-running structural pass that took up most of the session -- pulling
`app/index.html`'s single 4,815-line inline `<script>` block apart into
15 separate files with zero behavior change, verified at every single
step. Test suite grew from 158 to 168 checks; the 10 new checks are all
from the CLV work below, not the file-splitting (splitting moved code,
it didn't add new logic to test).

### Pool-vs-market CLV callout, actually strengthened (not just moved)
Item 13's "pool-vs-market value callout" gets marked DONE by this
session, but not as a new component -- as a real gap found between two
EXISTING views of the same data. Snapshot's Quick Look CLV column showed
raw, unsigned, home-perspective market movement for any unpicked game,
while the SAME row's detail panel (one click away) already showed a
correctly-oriented, colored CLV number for the model's recommended side.
`snapClvCellData()` gained a third state (`"recommended"`, alongside
`"pick"` and the old `"raw"` fallback) so the compact column now matches
what the panel already showed. Also brought the ⚡ alignment badge
(market drift + remaining model disagreement pointing the same
direction -- previously Board-tab-only) to both the Quick Look column and
the detail panel's signal lines. Found a real, separate, pre-existing bug
while shipping this: `fmt()` already prepends its own `+` sign for
positive numbers, but three separate CLV-rendering call sites were ALSO
adding one on top, rendering `++3.0`. Fixed in the two spots touched this
session (Quick Look cell, detail panel signal line); the same bug still
exists in the full Board tab's CLV cell and in My Picks' CLV display --
flagged, not yet fixed. `tests/test_snapshot_logic.mjs` grew by 10 checks
for the new `"recommended"` kind and `clvAlignment()`.

### Snapshot header decluttered
Two small, Drew-requested UI changes, both verified with real Playwright
renders at desktop and mobile widths:
- The "Rank By" toggle moved from its own sticky bar above the Top
  Opportunities card into that card's own header row (title left, toggle
  right) -- saves a full row of vertical height. Trade-off noted to
  Drew: the toggle is no longer sticky while scrolling on desktop (it
  wasn't judged to need to be -- a one-time sort choice, not a
  mid-scroll control).
- The Context Bar's collapsed summary line gained a small "VIEWING"
  eyebrow label to its left, matching the wording the open switcher's
  own first column already used -- the bar had no visual cue that it WAS
  a control (not just a status strip) until clicked. Hidden under 640px
  where the summary text already needs the room to wrap.

### The JS-splitting pass
Starting point: `app/index.html` was one 4,815-line / 287KB file --
markup, CSS, and a single inline `<script>` block containing every
function in the app, including a single 13.6KB literal one-liner
(`BUCKETED_COVER_TABLE`). Ending point: `app/index.html` is 1,837 lines /
~114KB (38% of original), with the removed code living in 15 plain,
unbundled `<script src="...">` files -- NO build step, NO bundler added,
every file still just an ordinary global-scope script loaded in a fixed
order, functionally identical to being inline. Absolute script paths
(`/app/js/whatever.js`, not relative) throughout, deliberately -- the app
is served at the exact path `/app` with no trailing slash, and a
relative path resolves wrong at that specific URL shape.

Split out, in order:
- `app/data/pred-systems.js`, `app/data/team-alias.js`,
  `app/data/cover-table.js` -- pure static reference data.
- `app/js/model.js` -- the composite probability model (weighted-model
  average, key-number scoring, the fitted cover table, edge/CLV math).
- `app/js/board.js` -- Board tab AND Snapshot tab rendering (they were
  never separate sections in the source; genuinely share render helpers
  like `mktModelHTML()`).
- `app/js/picks.js` -- picks/entries/My Picks/Compare view.
- `app/js/odds.js` -- Vegas line refresh + per-device sportsbook
  resolution.
- `app/js/settings.js` -- Settings error redirect, local backup
  export/import.
- `app/js/record.js` -- week archiving/restoring, manual grading, the
  Record tab.
- `app/js/tabs.js` -- tab switching (drives ALL navigation), `syncAll()`.
- `app/js/sync.js` -- the client-side half of the atomic-write system
  (debounced pushes, 409 conflict handling, tier pulls). Flagged as one
  of the more sensitive files split, given the 409/revision handling
  exists because of a real TOCTOU race fixed here previously, not a
  theoretical one.
- `app/js/pdf-import.js` -- like board.js, broader than its name:
  contains `teamMatch()` ITSELF (the core matcher used everywhere --
  grading, logos, predictions, PDF), team logos, PDF/prediction merge,
  the actual Powers import flow.
- `app/js/pool-contexts.js` -- the Context Bar and Splash/OFP pool sheet
  import. Largest single split (~400 lines) -- includes
  `initContextBar()`'s `composedPath()`-based click-outside logic, a
  real historical bug fix (a week-nav click inside the switcher used to
  close the switcher on its own navigation click via `bar.contains()`'s
  live-tree-walk timing).
- `app/js/prediction-tracker.js` -- thepredictiontracker.com CSV fetch,
  the Prediction Systems settings panel.
- `app/js/init.js` -- LAST, and handled differently from the other nine.
  Contains `clearColumn()`/`init()`/`rehydrateAfterSync()` plus the
  DEFINITIONS (not invocations) of `initErrorBoundary()` and
  `bootstrap()`. Every other file moved 100% of its code since nothing
  in them executed immediately at top level. This section is different:
  `initErrorBoundary()` is called as the literal FIRST statement of the
  whole app and `bootstrap()` as the literal LAST -- both invocations
  deliberately stay in `app/index.html` itself, unmoved, so error-
  boundary registration still happens before anything else can throw.

Verification discipline, applied at every single one of the 15 split files,
not just spot-checked: syntax-checked independently (`node --check`),
full 168-check suite re-run, swept for stale "see X above/below" comments
left pointing at code that had physically moved (found and fixed several
real ones -- e.g. a comment in `odds.js` referencing `SHARED_FRESH_MINUTES
above` when that const stayed in the main script), and a real Playwright
render against an actual local HTTP server serving the repo at the exact
`/app` path (not `file://`) to prove the absolute script paths resolve
correctly in production's exact URL shape, not just in a sandbox
approximation.

Two verifications went further than a type-check or a render:
- **pool-contexts.js**: reproduced the EXACT historical
  `composedPath()`-vs-`bar.contains()` bug scenario for real -- opened
  the Context Bar switcher, clicked the week-nav button INSIDE it (the
  precise action that used to close the switcher on itself), confirmed
  it correctly stayed open, then confirmed a genuine outside-click still
  closes it.
- **init.js**: forced a REAL error inside `init()`'s own execution
  (overrode `document.getElementById` via an injected init script to
  throw on one specific call `init()` makes early on) and confirmed the
  error boundary still caught it -- proving `initErrorBoundary()` is
  genuinely registered before `init()` can run, not just reasoned
  through from the code's shape.

Test files updated in lockstep, never reimplemented: each `tests/*.mjs`
now extracts real function source from whichever file it actually lives
in post-split (`modelSrc`/`boardSrc`/`picksSrc`/`oddsSrc`/`poolContextsSrc`,
alongside the original `src` = index.html). Real gotcha hit and worked
around: `test_mypicks_logic.mjs` and `test_snapshot_logic.mjs` both
deliberately stub real functions that live in the same split files they
also need OTHER functions from (`myNumber`, `activeEntry`, `edgeClass`,
`renderPicksDetail`) -- pulling a whole split file's content into those
tests would silently clobber the stub, since a `function` declaration
overwrites an existing same-named global in a `vm` context (a `const`
doesn't -- confirmed this asymmetry empirically with a throwaway Node
script before trusting it, not just from memory of the spec). Those
tests extract only the specific functions they need instead of the whole
file.

`NEW_SESSION_START_HERE.md` updated throughout (not just at the end) to
describe the new file layout, so a future session -- Claude or ChatGPT --
doesn't work from a stale "single-file frontend" mental model and either
fail to find a function or, worse, redefine it in `index.html` by
mistake.

**Known gap, stated plainly:** every one of the 15 split files has been
verified against a throwaway local HTTP server in this sandbox serving
the repo at the exact `/app` path Vercel would use -- never against the
actual live Vercel static-file serving. Absolute script paths were
chosen specifically to survive the one real difference (no trailing
slash on `/app`) that could plausibly bite in production; still "logic
verified, live unverified" until Drew confirms on the real deployment.

## v18 — ChatGPT audit fixes, three new test files, and the PickGauge rebrand

Two sessions' worth of work never got a formal write-up here (only
updated "when asked," per standing instruction) -- this entry covers
both, briefly for the first (already delivered, already verified, just
undocumented until now) and in more detail for the rebrand.

### ChatGPT audit fixes (undocumented until now)
A v17 ChatGPT audit surfaced several real, confirmed bugs and gaps.
Fixed, in the order tackled:
- **`sharedUpdatedAt` never surfaced by `_get_shared_state()`** — meant
  the non-forced startup shared-pull silently no-opped on every page
  load, not just a fresh browser. Fixed in `api/state.py` (now returns
  the newest of the three domains' own timestamps) and `_publish_pool()`
  (now stamps its own). Also found and closed a related gap: a
  private-tier pull's field-preservation list didn't include
  `sharedUpdatedAt`, which would have undermined the fix on the very next
  private sync — added it to `SHARED_FIELDS`. Regression test added to
  `test_state.py` (+5 checks); proved it actually catches the bug by
  temporarily reverting the fix and confirming the new checks failed.
- **Remaining `++3.0` double-plus CLV bug** — the Snapshot fix from
  earlier didn't propagate to `board.js`'s full Edge Board CLV cell (2
  spots) or `picks.js`'s My Picks CLV pill. Fixed all three.
- **"Reset all data" button mislabeled** — only ever cleared the local
  browser, never synced account data, but didn't say so. Renamed to
  "Reset this browser," added a standing (not just tooltip) explanation,
  updated the confirm dialog and added a post-click confirmation message.
- **Two new permanent test files**: `test_script_paths.mjs` (63 checks —
  every `<script src>` in `app/index.html` resolves to a real file, every
  one passes `node --check`, no orphaned file exists without a loader
  tag) and `test_team_match_parity.py` (76 checks — the real JS
  `teamMatch()` and the real Python `team_match()` must agree on a shared
  corpus of team-name pairs, plus a direct `TEAM_ALIAS`/
  `SIGNIFICANT_TOKENS` dict/set comparison; proved both directions of
  drift get caught by temporarily breaking each side in turn).
- **Automated tests for Context Bar / Weekly Setup / error boundary** —
  previously zero coverage, Playwright-verified only. Split into pure
  decision-logic tests (`test_context_bar_logic.mjs`, 17 checks;
  `test_weekly_setup_logic.mjs`, 28 checks) and a genuinely new kind of
  test for this suite, `test_e2e_ui_behaviors.py` (19 checks) — a real
  Chromium browser via Playwright, since the composedPath() click-outside
  fix and the error boundary both depend on real DOM event listeners a
  vm context can't provide. Proved the composedPath() regression test
  actually works by reverting to the old `bar.contains()` bug and
  confirming exactly one check failed, the right one.
- **Empty logo `alt` text** — 6 occurrences audited individually, not
  blanket-fixed: 4 are genuinely decorative (team name visible in the
  same element as the logo) and correctly stay `alt=""`; the 2 standalone
  Edge Board table logo columns (no team name in the same cell) got real
  `alt="{Team} logo"` text.
- **Record → Results rename** — every user-visible occurrence (tab
  label, empty-state headings, help text, 3 confirm/prompt dialogs)
  became "Results." Internal identifiers (`data-tab="record"`,
  `id="tab-record"`, `app/js/record.js`, `renderRecord()`) deliberately
  left alone — this project already tolerates that kind of internal/
  external naming mismatch (`teamMatch()` lives in `pdf-import.js`).
  "Running record" (the win-loss tally heading) was deliberately left
  as-is too — ordinary English usage of the word, not a reference to the
  tab.
- 6 places with stale "Vegas is averaged
  into Model #" copy that didn't reflect Vegas defaulting to weight 0;
  `README.md` (never touched during the JS-split pass, including a
  silently-broken greedy-regex verification snippet); a genuine
  file-count error (13 vs. the real 15 split files) in multiple docs.
- **Correction to this entry, made honestly**: this section originally
  claimed the Privacy Policy's false "never sent to" Odds-API-key claim
  was fixed here too. It wasn't — the v18 rebrand pass touched that exact
  paragraph (renaming the brand mention) without noticing the underlying
  claim was still wrong, and the handoff note describing the fix got
  written without the fix actually happening. Caught and actually fixed
  in the following session, when asked for a status update and the real
  file was checked rather than trusted from memory — exactly the kind of
  mistake this project's own "verify against the real file" rule exists
  to catch. The corrected language: the key IS transmitted (via the
  `X-Odds-Api-Key` header to `api/fetch_odds.py`'s own proxy) but never
  persisted in Redis, synced, or exported — that's the real protection,
  and the copy now says so accurately.

Test suite grew from 168 (end of v17) to 376 across this stretch.

### v18's actual focus: rebrand to PickGauge
Drew provided a new logo (dark card, green isometric stadium + bar-chart
icon, "PickGauge" wordmark) and asked to rebrand the whole site from
"Edge Board." This took real care in two specific ways, both because a
careless global find-and-replace would have gotten them wrong:

**"Edge Board" means two different things in this codebase, and only one
of them is the brand.** The product's name was "Edge Board" everywhere
(title, header, footer, error messages) -- but "Edge Board" is ALSO the
name of one specific tab (the dense table view, as distinct from
Snapshot/My Picks/Results), a name that predates and is unrelated to the
product's own brand name. Every one of ~56 occurrences across 10 files
was individually classified before touching anything: brand-name
instances became "PickGauge," the 8 genuine tab-name instances (nav
button, Help section heading, code comments, help copy explicitly saying
"the Edge Board tab") were left alone. Verified by rendering the actual
app header screenshot afterward and confirming it reads "PICKGAUGE" in
the brand area while the nav tab directly below it still correctly says
"EDGE BOARD."

**The provided logo needed real image processing, not just a drop-in.**
It's a 1024x1024 marketing-card image (dark rounded rect, icon + full
wordmark), not a ready-to-use favicon or small nav mark. Cropped a clean
square icon-only region from it (Pillow), generated the actual favicon
set (16/32/48px, 180px apple-touch-icon, plus 96px/512px general-purpose
versions), and discovered by rendering the icon at true pixel size
(nearest-neighbor upscaled for inspection, not smoothed) that 16px is
too detailed to read as anything but a green blob -- flagged this to
Drew explicitly with a side-by-side reference sheet before shipping
rather than silently shipping something suboptimal. Drew's call: ship it
anyway (32px+ looks genuinely good, 16px imperfect-but-common is
acceptable). Also replaced the old plain-text "EB" monogram badge
(28px green square) on the 4 legal pages + landing nav with the real
icon, and added a visible icon to the main app header and sign-in gate
for the first time -- previously text-only, no logo image anywhere in
the actual product.

**Explicitly NOT renamed, on Drew's explicit call**: the Redis key names
(`edge_board_shared_odds`/`_predictions`/`_pools`) and the localStorage
key (`cfb_edge_state_v1`). Renaming these would silently orphan every
existing user's data under the old key name -- flagged as a real
data-reset risk before touching anything; Drew chose to leave them alone
for now. If this ever needs to happen, it needs a real migration (read
the old key as a fallback, same pattern `SHARED_KEY`'s own legacy-fallback
already uses), not a plain rename.

**Caught mid-verification, not before**: a hardcoded `edgeboard.app/
dashboard` fake URL inside a landing-page mockup graphic -- missed by
every case-sensitive text search because it was lowercase/no-space, only
found by actually looking at a rendered screenshot of the landing page
nav and hero section. This is the same "verify by looking, not by
assuming the search was exhaustive" lesson this project has hit before
(the double-`+` CLV bug was found the same way).

## v19 — First real production test found a real bug: sign-in was broken for every new visitor

Drew pushed v18 to GitHub, confirmed Vercel auto-deployed, and asked
whether the site could be shared with a friend for testing. This is
exactly the "live validation against real Vercel/Clerk/Upstash" item
that's been sitting on the open-items list since v16 — genuinely tried
for the first time here, and it immediately paid for itself.

I fetched the live URL directly (`web_fetch`, real external request, not
another sandbox mock) and the response included the error boundary's
"Something went wrong" text prominently. I couldn't tell from a text-only
fetch whether that was actually visible or just present-but-hidden markup
-- said so plainly rather than overclaiming -- and asked Drew to check in
his own browser. His normal browser looked fine; **incognito showed a
real red error banner**. That contrast (works normally, breaks
incognito) was the key clue: it pointed straight at a cold-cache/
first-visit-only bug, not a general one -- and a genuine first visit is
exactly what a new friend testing the app would hit every time.

Drew reproduced it in incognito and copied the real error via the
boundary's own "Copy error details" button:

```
[PickGauge error boundary] Error: Clerk was not loaded with Ui components
    at sM.assertComponentsReady (...clerk.browser.js:18:232515)
    at sM.mountSignIn (...clerk.browser.js:18:195549)
    at bootstrap (.../app/js/init.js:407:18)
```

Root cause, confirmed against Clerk's OWN current documentation (fetched
live, not recalled from training data -- their JS quickstart, updated
literally the day before this session): Clerk's current SDK architecture
splits UI components (`<SignIn>` etc.) into a **separate bundle**
(`@clerk/ui`) from the core `clerk.browser.js` script. This project's
Clerk integration only ever loaded the core script and never the
separate UI bundle, and never passed `ui: {ClerkUI:
window.__internal_ClerkUICtor}` into `Clerk.load()` -- both required as
of Clerk's current major version. On a warm cache (any repeat visit,
including Drew's own normal browser throughout this entire project) the
missing chunk happened to already be cached from something else on that
domain, masking the bug completely. On a genuinely cold cache -- every
new visitor's actual first load -- it wasn't cached, and `mountSignIn()`
threw before the sign-in UI could render at all. This was invisible in
every sandbox test this project has ever run, all session, because every
one of them used a mocked `window.Clerk` object that never exercised
real UI-bundle loading in the first place.

Fixed in `app/index.html` (added the missing `<script>` tag for
`@clerk/ui@1.30.2/dist/ui.browser.js`, version-pinned with the same
discipline already applied to `clerk-js` itself, checked against the npm
registry directly) and `app/js/init.js`'s `bootstrap()` (now waits for
`window.__internal_ClerkUICtor` alongside `window.Clerk` before calling
`.load()`, and passes the `ui` option Clerk now requires). Updated the
one test file this broke -- `test_e2e_ui_behaviors.py`'s Clerk mock never
needed to define that global before, since the old code never checked
for it -- and `test_script_paths.mjs`'s external-CDN-script-count
sentinel (2 -> 3, a real and correct change, not a false alarm).

**Honest limit on this session's own verification**: this sandbox has no
network access to `clerk.accounts.dev` at all (it's not in the allowed
domain list), so the fix could be checked against Clerk's actual current
documentation and could be verified not to break the existing mocked
test suite, but could NOT be verified end-to-end against the real Clerk
CDN the way the original bug was found -- that verification is only
possible by Drew redeploying and re-testing incognito for real, which is
the necessary next step here, not optional.

**Also surfaced, not yet fixed**: a separate Clerk console warning
("Clerk has been loaded with development keys... should not be used when
deploying to production") -- the app is currently running on a
`pk_test_...` Clerk instance rather than `pk_live_...`. Not today's
crash, but worth Drew's attention before this goes beyond one friend
testing it.

## v20 — Security/production-readiness pass: rate limiting, centralized error handling, the Pools tab, and cleanup

Seven separate pieces of work this session, each verified with real
Playwright renders and the full existing suite re-run after every change
(not just reasoned through):

**Weekly Setup checklist made actually actionable.** Each incomplete row
is now clickable and jumps to the exact control that fixes it — switches
tab if needed, opens the collapsed Prediction Systems panel if the
control lives inside it, scrolls to it, and gives it a brief highlight
pulse. Previously the fix text just said things like "above" or "Import
this pool's sheet above" regardless of which tab you were actually on.
"Finish Setup" was also silently routing based on whether you had a
*personal* Odds API key set (`state.apiKey?"board":"settings"`), which
was both stale (the server's own `ODDS_API_KEY` covers everyone by
default now) and wrong — it could send someone to Settings for a key
problem they didn't have while the real blocker sat untouched on Edge
Board. Now routes to whatever's actually first-incomplete.

**Centralized API error handling — `app/js/api-client.js`.** New
`apiFetch()`/`classifyApiError()` wraps every `fetch()` call site and
classifies failures into `auth`/`missing_key`/`forbidden`/`conflict`/
`revision_required`/`rate_limit`/`server`/`offline`, using the
already-consistent `error`-vs-`message` key convention across all
`api/*.py` 401 responses as the discriminator (no backend changes
needed). Fixes a real bug: `refreshLines()` used to treat *every* 401 as
"no odds key" and send the person to Settings, even a genuinely expired
Clerk session. Rolled out to `odds.js`, `pdf-import.js`,
`pool-contexts.js`, `prediction-tracker.js`, `picks.js`, `sync.js`
(preserving the 409/CAS conflict-adoption logic exactly), and `init.js`.

**Server-side rate limiting + odds/predictions freshness gates.** The
browser's own 30-minute freshness check was client-side only — a
signed-in person could hit `/api/fetch_odds` directly and repeatedly,
burning the shared paid Odds API quota. `fetch_odds.py` and
`fetch_predictions.py` now check the shared cache server-side first and
return it directly (no upstream call at all) when under
`SHARED_FRESH_MINUTES` old and using the shared key; a personal key skips
that gate but still gets a 1-per-30-second cooldown. Backstop rate limits
added to `fetch_teams.py`, `parse_pdf.py`, `parse_pool.py`, and
`state.py` (including a tighter limit specifically on `publish_pool`).
All six duplicated copies of the fixed-window `RATE_LIMIT_SCRIPT` (Redis
Lua, same pattern as `CAS_SCRIPT`) proven correct independently via a
faithful Python simulation, not just asserted identical by text diff.

**The Pools tab — built and then genuinely completed.** New `POOLS` tab:
Overall pinned at top (no delete/archive actions, it isn't a real pool),
every pool as a row with create/import/re-import/edit pick limit/archive/
delete/share-for-testing/week-history, all backed by real functions
(`archivePool()`, `unarchivePool()`, `deletePoolById()`,
`createEmptyPool()`, `editPoolPickLimit()`), not placeholders. Archive is
genuinely soft (reversible, keeps all data) alongside the existing hard
delete, per an explicit decision. Once proven out, the now-redundant
Edge Board toolbar buttons (`✕ pool`, `🔗 share for testing`, `＋ Import
pool sheet`) were removed — and the Weekly Setup checklist's "Pool lines
imported" row, which pointed at the toolbar's `poolImportLabel` element,
was caught and fixed to point at the per-pool import button on Pools
instead (each pool row now gets a real unique id,
`poolImportLabel_<poolId>`), otherwise that checklist link would have
silently gone dead.

**Context Bar + Weekly Setup hidden on Pools, My Picks, and Results.**
Both are shared, tab-independent elements that persist across every
`switchTab()` call — on Pools they're actively contradictory (a single
"VIEWING: X" summary above a list of *every* pool, not just the one
you're viewing), and on My Picks/Results they're redundant (both tabs
already carry their own pool/entry context). One shared
`sharedWidgetsHiddenOnCurrentTab()` helper checked in both
`renderSetupStatus()` and `renderContextBar()`. A real gap was caught and
fixed mid-session: `switchTab()` only called `renderContextBar()`
unconditionally, not `renderSetupStatus()`, so a direct tab click to
Pools initially left the Weekly Setup card stuck showing whatever it
last rendered on Edge Board — fixed by calling both on every switch.
Later: Context Bar and Weekly Setup made to sit side-by-side on
desktop/tablet (≥760px) on the tabs where they do still show, since both
are short in their default collapsed state — falls back to stacked on
mobile.

**Security headers added to `vercel.json`.** `X-Content-Type-Options:
nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(),
geolocation=(), payment=(), usb=()`, applied site-wide. Can't be
live-tested locally (these are applied by Vercel's routing layer, not
app code) — confirmed no `api/*.py` handler already sets any of these
four explicitly (which would silently override the config), and pinned
the config itself with a static test. Live confirmation is still an open
item (see below).

**Raw exception strings no longer leak in `500` responses.** All 12
`self._respond(500, {"error": str(e)})`-style sites across
`state.py`/`fetch_odds.py`/`fetch_predictions.py`/`fetch_teams.py`/
`grade_picks.py`/`parse_pdf.py`/`parse_pool.py` now return one consistent
generic message; the real exception goes to a duplicated
`_log_server_error()` (stderr, captured as Vercel function logs) instead.
Verified for real, not just written: ran the actual `state.py` handler
code with a forced exception containing a fake internal hostname and
secret token, confirmed neither ever reaches the HTTP response body.
Deliberately left the five remaining `502` (upstream-connectivity)
`str(e)` sites untouched — different, lower-sensitivity category, out of
the scope actually asked for.

**New test files this session:** `test_error_shapes.py` (22),
`test_rate_limits.py` (56), `test_pools_page_logic.mjs` (40),
`test_vercel_headers.py` (14), `test_no_raw_exceptions_in_500s.py` (42).
Existing files extended: `test_context_bar_logic.mjs`,
`test_e2e_ui_behaviors.py` (19 -> 29). Test suite: **376 -> 436 checks**.

**Not started this session, deliberately:** the actual Clerk
Development-to-Production migration. Drew doesn't have a real domain yet
(expected next week) and Clerk explicitly rejects `*.vercel.app`
addresses for a production instance, so there's no code to write yet —
what happened instead was a detailed, verified-against-current-Clerk-docs
step-by-step plan (domain purchase → Vercel DNS → Clerk production
instance → DNS verification → `pk_live_`/Frontend API swap → `CLERK_JWKS_URL`
env var → incognito retest), ready to execute once the domain exists.

---

## v21 — Watchlist feature, CI, admin-gating publish_pool, and doc fixes

Continuation of the same session as v20 above. Eight more pieces of work,
each verified with real Playwright renders and the full suite re-run
after every change:

**`privacy.html` wording fixed.** Two real inaccuracies: "The only
account information Edge Board itself uses" (stale branding, now says
PickGauge), and the shared-data section claimed published pool structure
includes "entry names" — it doesn't (`state.py`'s `safe_pool` never
carries them), and that claim directly contradicted the very next
sentence's "your individual picks and entries are never included in that
shared data." Removed the false claim; left the private-data section's
own mention of entry names alone since that one's accurate.

**Watchlist / shortlist — a third pick-adjacent state.** New
`currentWatchlist()`/`isWatched()`/`toggleWatch()`, scoped per-context
exactly like entries/picks already are (Overall and each pool never
share game keys, so they can't share a watchlist either). A `⚑` toggle
added in three places (full Edge Board rows, Snapshot's Top Opportunities
cards, Snapshot's Quick Look table), a new "Shortlisted" filter pill and
stat tile on Snapshot, and — after Drew's follow-up feedback — a matching
"⚑ Watchlist only" filter checkbox added to the full Edge Board too
(Snapshot had one, the board where the toggle actually lives didn't).
Two real bugs caught and fixed along the way, not just written and
assumed correct: (1) the first icon pass used a 🔖 emoji styled via CSS
`color` for active/inactive — emoji glyphs render with their own
built-in color regardless of CSS, so the active state was invisible;
switched to `⚑` (proven via `getComputedStyle` before/after a real click
that the color genuinely changes to `--amber`). (2) `watchlist` needed
explicit backfill in `normalizeState()` (both top-level and per-pool) and
`"watch"` added to the `SNAP_FILTERS` allowlist, or a saved filter
selection would silently reset to "all" on next load.

**Edge column's empty-state message was misleading.** `edgeOf(g)`
returns null for two different reasons -- no live Vegas line yet, or
Vegas exists but every model input (BP/Comp, every prediction system) is
still empty -- and both showed the same generic "enter lines" text. New
`edgeEmptyHTML(g)` in `model.js` distinguishes them: "no line yet" vs.
"no model inputs", used in both places this fallback renders (initial
row build and the live-typing update path, which had the exact same
fallback duplicated).

**GitHub Actions CI.** New `scripts/test_all.sh` runs all 18 real test
files (Python first, then Node) in one command, aggregates pass/fail
without fail-fast (a broken file doesn't hide failures in the rest), and
exits nonzero if anything failed. `--fast` skips the one real-browser
E2E test for a quicker local check. `.github/workflows/tests.yml` runs
it on every push to main and every PR. Verified for real, not just
written: ran it locally (clean pass), deliberately broke one test file
and confirmed the script correctly reported the failure while still
running the other 17, then restored the file. README's "Running the
tests" section was badly stale (said 312 checks / 9 files; real number
was already 580 at the time, now 594 after this section's own
additions) -- rewritten with the accurate file list and `scripts/test_all.sh`
as the primary entry point, plus a CI status badge added at the top.

**Real Upstash CAS concurrency test — built, not yet run.** New
`tests/_live_cas_concurrency_test.py`, deliberately NOT part of the
automated suite (excluded from `scripts/test_all.sh` by name). Fires two
genuinely concurrent writes (held at a `threading.Barrier` so they
release at the same instant) against the REAL deployed `/api/state`
endpoint, using a real Clerk session token Drew has to supply. Designed
to be safe against real data: builds both payloads as a full copy of the
real current private state plus one harmless marker field, and cleans
the marker back off automatically afterward regardless of pass/fail.
Every detail of the request/response handling was cross-checked line by
line against the actual `api/state.py` source (exact 409 body shape,
`serverRevision`/`state` keys, raw-JSON-body contract). Since Claude has
neither live credentials nor a network path to Vercel/Upstash from its
sandbox, the SCRIPT itself was proven correct instead by running it
against two local mock HTTP servers over real sockets: one with correct
atomic behavior (clean pass), one with a deliberately broken/racy
implementation (correctly caught the failure, exited nonzero). Drew
still needs to actually run this against production.

**`publish_pool` ("Share for testing") is now admin-gated.** New
`is_admin(uid)` in `state.py` reads `PICKGAUGE_ADMIN_UIDS` from the
environment (comma-separated Clerk user IDs), fails toward "nobody is
admin" if unset/empty. Checked before the existing rate limit so a
rejected non-admin gets a clear reason rather than a confusing
rate-limit message on retry. A real UX gap was caught and fixed
alongside this: `pushPoolToShared()` previously only returned a plain
boolean, and a failure just silently reverted the share button with the
real reason logged to console only -- fine when failures were rare edge
cases, not fine now that 403 is the expected outcome for most users.
Changed to return `{ok, error}`, wired into the Pools page's
`#poolStatus` element. A real test regression was caught and fixed
properly (not patched around): `test_state.py`'s pre-existing ownership/
CAS/concurrent-publish tests all called `publish_pool` and broke when the
gate was added: rather than weaken the gate, the file-wide test default
now treats both test users as admins (isolating those pre-existing tests
from this orthogonal concern), and a new dedicated section tests the
gate's real enforcement with a deliberately stricter admin set -- proving
through the actual `do_POST` path that a non-admin gets a real 403, the
rejected pool is never written to KV at all, and an actual admin still
succeeds. Verified in a real browser too: mocked the exact 403 the server
now returns, confirmed the real message reaches the person (in red, in
the right place) and the button correctly reverts rather than getting
stuck on "sharing…".

**One backlog item found to already be resolved, not fixed.** The
"double-`+` CLV bug, remaining spots" item (Board tab / My Picks) carried
forward from a stale v17 note turned out not to exist in the current
code -- checked the actual rendering (`fmt(c.forPick)`, no second sign
concatenated anywhere) and then proved it empirically with a real
positive-CLV scenario in a live browser (`+3.0` in both places, not
`++3.0`). No fix needed; removed from the open-items list below.

Test suite: **580 -> 594 checks, 18 files** (`test_state.py` alone grew
41 -> 50 from the admin-gate tests).

---

## v22 — Custom 404 page and landing-page SEO tags

Small, self-contained addition, prompted by Drew asking whether any
pages were still missing. Answer: no tab/page inside the app itself was
missing (Pools closed that gap in v20), and no cross-linked marketing/
legal page was dangling -- checked every internal `href="*.html"` across
all top-level pages, all resolve to a real file. The one real gap: no
custom 404.

**New `404.html`** at the repo root. Matches `privacy.html`/`terms.html`'s
lighter style (not the heavier marketing landing page) -- same nav,
same footer, same color variables. `noindex` meta tag. Vercel serves
this automatically for any unmatched route on a static deployment like
this one; no `vercel.json` change needed.

**`index.html` (the marketing landing page, not `app/index.html`)** got
a real `meta description` and Open Graph/Twitter card tags. One honest
limitation, flagged directly in the file with an HTML comment: `canonical`,
`og:url`, `og:image`, and `twitter:image` all need a real domain, which
doesn't exist yet -- used the exact same explicit-placeholder pattern
`contact.html` already established (`https://REPLACE-ME.example`) rather
than inventing one, with a comment pointing at exactly what to
find-and-replace once the domain's live.

Verified with a real Playwright render of both pages (zero console
errors, landing page pixel-identical to before the `<head>` addition --
confirmed it's a pure metadata change, no visual regression) and
confirmed via `grep` that the automated test suite's `index.html`
references are all to `app/index.html` (the app itself, a completely
different file at a different path), so there was zero risk of overlap
with any existing test. No new automated tests added for this one --
static HTML/meta tags with no logic to unit test; the real verification
is the rendered page itself.

---

## v23 — Shortlist terminology unification, and a real correctness bug fix: archived pick lines were being silently overwritten

Two pieces of work, prompted by a second ChatGPT audit pass against the
v22 handoff zip (that audit's full text isn't reproduced here, but its
findings drove both this section and most of the "Known open items"
rewrite below).

**Shortlist terminology unified.** The feature launched in v21 as
"Watchlist" in code/data but "Shortlisted" in some UI copy and "Watchlist
only" in other UI copy -- flagged by the audit as a real inconsistency.
Renamed EVERYTHING, not just user-facing text: `currentWatchlist()` ->
`currentShortlist()`, `isWatched()`->`isShortlisted()`,
`toggleWatch()`->`toggleShortlist()`, `state.watchlist`/`pool.watchlist`
-> `shortlist`, `state.boardWatchOnly`->`boardShortlistOnly`, the
`.watch-toggle` CSS class -> `.shortlist-toggle`, `data-watch`/
`data-snap-watch` -> `data-shortlist`/`data-snap-shortlist`, element IDs,
the `SNAP_FILTERS` filter value, and every tooltip/aria-label. Renamed
the test file itself (`tests/test_watchlist_logic.mjs` ->
`tests/test_shortlist_logic.mjs`, old file deleted, `scripts/test_all.sh`
and `README.md` updated to match). Verified with a repo-wide
`grep -riE "watch(list|ed)?"` sweep afterward -- clean, nothing left --
and a real Playwright run confirming the toggle/filter/stat-tile/pill
all still work end to end post-rename.

**Fixed a real, serious data-integrity bug: `closeWeek()` was silently
overwriting the archived pick line with today's live market line.**
This is more serious than a cosmetic issue -- confirmed via source
inspection (not just taking the audit's word for it) that
`api/grade_picks.py`'s `_grade_history()` reads the archived `line`
field DIRECTLY to compute automatic W/L/P via
`grade(picked_score, opp_score, line)`. So the bug could silently
produce a WRONG automatic grade, not just a wrong displayed number,
whenever the market moved between picking a game and archiving the
week. Confirmed the audit's claim that pools are mostly exempt (post-
lock, `g.vegas` becomes the locked line, not a moving target) but found
a narrower version of the SAME bug for a pool pick made pre-lock, whose
provisional live-matched number gets replaced by the real locked line by
archive time -- the fix (always use `p.line`, never read from the live
game object) protects both cases with one change.

Two new fields captured separately, and NEVER read by grading:
`closingLine` (the market's read at archive time, in the picked team's
own perspective) and `clv` (reusing the app's own already-tested
`clvOf()` math rather than re-deriving the sign convention by hand and
risking a second bug while fixing the first). Added a CLV badge to the
Results tab's archived-pick display. Caught a real mistake in my OWN
test while writing it (asserted the wrong CLV sign for a home-favorite-
growing-stronger scenario) -- rather than "fix" correct code to match a
wrong test, checked it against the exact math pattern already verified
via a real screenshot earlier this session and fixed the test instead.

New `tests/test_archive_line_integrity.mjs` (17 checks) on a function
that had ZERO test coverage before this -- exactly how a bug like this
went unnoticed. Verified end to end in a real running browser too:
picked a game at -6.5, moved the market to -8, archived the week,
confirmed the archived record shows -6.5 (not -8) with correct
closingLine/CLV alongside it, zero console errors.

**One honest limitation, not fixable from here:** this only protects
weeks archived from now on. Any already-archived week from before this
fix where the market had moved before archiving is already corrupted,
and there's no way to recover what the original pick-time line actually
was after the fact.

Test suite: 594 -> 611 checks, 19 files.

---

## v25 — Native browser dialogs replaced with one reusable PickGauge modal layer

Removed every shipped runtime use of browser-native `alert()`, `confirm()`, and
`prompt()`. Added `app/js/dialogs.js`, a single Promise-based modal primitive
with wrappers for alerts, confirmations, prompts, choice lists, and multi-field
forms. It includes Escape/backdrop cancellation, focus trapping and focus
restoration, body-scroll locking, inline validation, destructive-action styling,
and a queue so multi-step flows (notably account deletion) cannot overlap.

The migration also improves several awkward old flows instead of recreating them
literally: **New pool** is now one form with Pool name + Picks per entry; a new
pool-sheet import selects its target from a real choice list instead of typing a
number; pick-limit edits validate inline; account deletion keeps its two-step
friction plus a second code-level `DELETE` backstop. Archive/restore, backup
restore, reset browser, entry rename/delete/unlock, pool delete, clear-column,
and import confirmation paths all use the same component.

Added `tests/test_dialog_migration.mjs` (43 fast checks), including a repo scan
that fails if a native dialog invocation returns. Extended the real Chromium E2E
file from 29 to 39 checks with modal creation, invalid-form validation, Escape
cancellation, and a guard that Playwright never receives a native browser
`dialog` event during the migrated flow. Current suite: **34 files / 1,017
checks**; **33 fast files / 978 checks pass** in the review environment.

---

## CFBD live scoring + power-rating context pass (August 18, 2026)

Built directly on the canonical CFBD identity layer rather than adding another
name-based join:

- New `api/fetch_cfbd.py` exposes two authenticated read-only views.
  `view=scoreboard` proxies `/scoreboard` through a 60-second shared Redis
  cache; `view=ratings&year=...` merges CORE, SP+, FPI, Elo and SRS through a
  six-hour shared cache. The five rating calls run concurrently on a cold
  cache, partial system failures are isolated, and `vercel.json` gives this
  function a 30-second budget.
- New `app/js/cfbd-insights.js` keeps a small local cache, refreshes live
  scoreboard context about every 90 seconds while the page is visible, and
  resolves games by exact `cfbdGameId` before any team-name fallback.
- My Picks now shows scheduled/live/final score state and computes the current
  ATS cover margin using the PICK'S frozen line and `cfbdPickedTeamId`. This is
  display-only transient context; it does not rewrite private pick state every
  90 seconds.
- `api/grade_picks.py` now prefers CFBD final games by exact canonical ID and
  orients scores by canonical picked-team ID. The Odds API score path remains
  intact for legacy picks that predate CFBD IDs and as a fallback if CFBD is
  unavailable.
- Snapshot's expanded game detail now shows available CORE/SP+/FPI/Elo/SRS
  values side by side. The UI explicitly labels them `Context only — not part
  of Model #`; no production projection/Edge/Cover/EV/Agreement math changed.
- Auth/error/rate-limit meta-tests were expanded from seven to eight protected
  API files so the new endpoint cannot silently drift from the existing Clerk
  and Redis conventions. Dedicated CFBD insight tests cover scoreboard trim,
  ratings merging/latest CORE week, exact-ID grading/orientation, live ATS
  display and UI wiring.

Current fast suite after this pass: **37 files / 1,066 checks**, all passing.
The complete CI suite is **38 files / 1,112 checks** including the existing
46-check Playwright file.

## Known open items (updated August 18, 2026 after the current audit/work pass)

`CURRENT_STATE.md` is now the concise current source of truth. This section
is kept in the historical handoff as a current pointer, not as another long
copy of already-completed work.

### Blocked on production-domain/live infrastructure
1. **Clerk Development → Production + JWT hardening.** Bundle the real domain,
   expected `iss`/`azp` validation, contact/canonical/OG placeholders, HSTS/
   CSP, and a clean incognito deployment test.
2. **Live Upstash CAS concurrency run.** The manual test exists and the CAS
   logic is covered locally, but the script still needs one real deployment
   run with a fresh Clerk token.
3. **Live security-header confirmation.** Static `vercel.json` tests are green;
   confirm the deployed headers after the production-domain pass.

### Highest-value functional validation
4. **Real locked Splash/ESPN/OFP pool sheet end to end.** Confirm home/away
   favorites/dogs, PK, integer/half-point lines through parser → home-line
   storage → pick line → retained pre-kick close → CLV → grading. This remains
   the most important real-world validation gap; synthetic fixtures cannot
   prove the vendor's exact locked-sheet shape/sign convention.

### Product/architecture next
5. **CFBD identity + scoring + ratings context — COMPLETE.** Runtime games and new picks carry stable CFBD game/team IDs while retaining The Odds API `providerGameId` separately. My Picks now uses cached CFBD scoreboard data for scheduled/live/final scores and live ATS position; persistent grading prefers exact CFBD IDs and falls back to Odds for legacy picks. Snapshot detail also surfaces cached CORE/SP+/FPI/Elo/SRS ratings as context only.
6. **Model correlation / weighting — TABLED.** Keep as a long-term research
   idea; do not change current production weights for this now.
7. **Confirm Sagarin Points/Ratings code mapping** before labeling/starring the
   strongest historical variants.
8. **Final UI-density pass** (fewer pills/rounded cards, clearer primary action,
   especially mobile).
9. **Deeper Results research after real 2026 samples exist** — the core splits/calibration filters are now implemented; future work should focus on confidence/significance, conference/context splits, and deciding which patterns remain stable out of sample.
10. **Public Methodology / final Responsible Play verification** before wider
    public launch; useful but below the correctness/auth items above.

### Completed in the August 18 audit/work pass — do not reopen from older notes
- Reliable account-level backup restore.
- Manual grader rate limit and request/body limits.
- Self-service PickGauge-data deletion.
- Admin status delivered to client; non-admin template controls hidden.
- Raw 500/502 exception strings and raw CFBD/Odds HTTP bodies redacted.
- Full decision-time pick snapshot (Model #, Raw + picked-side Edge, Cover %,
  EV, key-number info, enabled inputs/weights, book, timestamp/model version).
- Odds/prediction fresh-response fallback when shared cache persistence fails.
- Private sync freshness based on server `_rev`, not browser timestamps.
- Retained server-side pre-kick line history; archive CLV no longer uses the
  line at archive time.
- Kickoff-aware 30/15/10/5-minute odds freshness windows.
- Transparent Model Agreement (`X/Y agree`).
- Draft → Ready → Submitted entry state with true editing lock + Unlock.
- First Results analytics pass (ATS, pick-time Edge, true CLV, positive CLV,
  Edge buckets, Model Agreement buckets).
- Shared-pool behavior formalized as one-time **Publish template / Unpublish
  template** lifecycle; unpublishing never deletes recipients' local copies.
- Test runner auto-discovers all permanent test files instead of relying on a
  manually-maintained list.
- Reusable PickGauge modal/dialog layer; zero shipped native `alert()`/`confirm()`/`prompt()` calls remain.
- Canonical CFBD identity plus cached live scoreboard/final-score grading. Exact `cfbdGameId`/`cfbdPickedTeamId` are primary; Odds IDs/name matching remain legacy fallbacks.
- CFBD CORE/SP+/FPI/Elo/SRS Snapshot context panel. Five upstream rating feeds refresh concurrently behind a six-hour shared cache and are explicitly excluded from Model #.

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

## Files changed (cumulative; through v25, August 18 audit/work pass)

**v24 additions**: pick-time decision snapshots; retained pre-kick market
history and true archive CLV; cache-outage local fallback; `_rev`-based private
sync freshness; kickoff-aware odds freshness; Model Agreement; Draft → Ready →
Submitted locking; first Results analytics; upstream error-body redaction;
one-time Publish/Unpublish pool-template lifecycle; current-state documentation;
and automatic test discovery in `scripts/test_all.sh`. New regression coverage
for each of those areas. See `CURRENT_STATE.md` for the concise maintained state.


**v23 additions**: `app/js/record.js` (`closeWeek()` line-integrity fix,
`closingLine`/`clv` fields, CLV badge in `renderRecord()`); `app/index.html`
(full shortlist rename -- data model, functions, filter value, CSS,
element IDs); `app/js/board.js` (shortlist rename); `app/js/init.js`
(shortlist filter checkbox wiring). New: `tests/test_archive_line_integrity.mjs`,
`tests/test_shortlist_logic.mjs` (renamed from `tests/test_watchlist_logic.mjs`,
old file deleted). Updated: `scripts/test_all.sh`, `README.md` (both the
renamed test file reference).


**v22 additions**: `404.html` (new); `index.html` (the root marketing
landing page -- meta description, Open Graph/Twitter card tags, with a
`REPLACE-ME.example` placeholder for the domain-dependent ones, same
pattern as `contact.html`'s placeholder email). No test files touched --
static HTML with no logic to unit test.


**v21 additions**: `privacy.html` (wording fixes); `app/index.html`
(watchlist data layer -- `currentWatchlist()`/`isWatched()`/
`toggleWatch()`, `normalizeState()` backfill, `SNAP_FILTERS`/
`boardWatchOnly` additions, watch-toggle + watch-filter CSS, CI badge);
`app/js/board.js` (watch-toggle markup in 3 places, `boardVisibleGames()`,
`edgeEmptyHTML()` in `model.js`, admin-gate-aware share button feedback);
`app/js/model.js` (`edgeEmptyHTML()`); `app/js/init.js` (watch-filter
checkbox wiring); `app/js/picks.js` (`pushPoolToShared()` now returns
`{ok,error}`); `app/js/pool-contexts.js` (share button surfaces the real
error via `#poolStatus`); `api/state.py` (`is_admin()`, wired into the
`publish_pool` route). New: `scripts/test_all.sh`,
`.github/workflows/tests.yml`, `tests/requirements-test.txt`,
`tests/_live_cas_concurrency_test.py` (manual-only, excluded from the
automated suite), `tests/test_watchlist_logic.mjs`. Extended:
`tests/test_snapshot_logic.mjs`, `tests/test_state.py` (41 -> 50 checks).
`README.md` (CI badge, corrected stale test count/file list).


**v20 additions**: `app/js/api-client.js` (new — `apiFetch()`/
`classifyApiError()`); `app/js/odds.js`, `app/js/pdf-import.js`,
`app/js/pool-contexts.js`, `app/js/prediction-tracker.js`,
`app/js/picks.js`, `app/js/sync.js`, `app/js/init.js` (rolled out to);
`app/js/board.js` (clickable setup rows, `goToSetupItem()`,
`sharedWidgetsHiddenOnCurrentTab()`); `app/js/tabs.js` (`renderSetupStatus()`
called on every tab switch, not just `renderContextBar()`);
`api/state.py` (`RATE_LIMIT_SCRIPT`/`rate_limited()`,
`GENERIC_SERVER_ERROR`/`_log_server_error()`, both duplicated to
`api/fetch_odds.py`, `api/fetch_predictions.py`, `api/fetch_teams.py`,
`api/parse_pdf.py`, `api/parse_pool.py`; `api/grade_picks.py` gets the
error-logging pair only); `api/fetch_odds.py`/`api/fetch_predictions.py`
additionally get `_fresh_shared_odds()`/`_fresh_shared_predictions()`;
`app/index.html` (Pools tab markup, toolbar buttons removed,
side-by-side Context Bar/Weekly Setup CSS); `vercel.json` (security
headers). 5 new test files (`tests/test_error_shapes.py`,
`tests/test_rate_limits.py`, `tests/test_pools_page_logic.mjs`,
`tests/test_vercel_headers.py`, `tests/test_no_raw_exceptions_in_500s.py`);
`tests/test_context_bar_logic.mjs` and `tests/test_e2e_ui_behaviors.py`
extended.


**v19 additions**: `app/index.html` (added the `@clerk/ui` script tag),
`app/js/init.js` (`bootstrap()` now waits for and passes the UI bundle
into `Clerk.load()`), `tests/test_e2e_ui_behaviors.py` (Clerk mock
updated), `tests/test_script_paths.mjs` (external-script-count sentinel
updated 2 -> 3).


**v18 additions**: see the v18 section above for the full list — covers
`api/state.py`, `app/index.html`, `app/js/board.js`, `app/js/picks.js`,
`app/js/init.js`, `app/js/pool-contexts.js`, `app/js/record.js`,
`app/js/tabs.js`, `api/fetch_odds.py`, `api/fetch_predictions.py`,
`api/fetch_teams.py`, `privacy.html`, `index.html`; 3 new test files
(`tests/test_script_paths.mjs`, `tests/test_team_match_parity.py` +
`tests/_team_match_js_runner.mjs`, `tests/test_context_bar_logic.mjs`,
`tests/test_weekly_setup_logic.mjs`, `tests/test_e2e_ui_behaviors.py`);
6 new icon files at repo root (`favicon-16.png`, `favicon-32.png`,
`favicon-48.png`, `apple-touch-icon.png`, `icon-96.png`, `icon-512.png`
— `favicon.svg` is now unreferenced/orphaned, left in place but unused);
`README.md`, `NEW_SESSION_START_HERE.md`, `handoff.md` updated for the
rebrand and to close a documentation gap for the untracked audit-fix work.

**v17 additions**: `app/index.html` (Snapshot CLV strengthening --
`snapClvCellData()`'s new `"recommended"` kind, ⚡ alignment badge on
Quick Look + detail panel, double-`+` display fix; Top Opportunities
header restructure with inline Rank-By toggle; Context Bar "VIEWING"
eyebrow label; and the JS-splitting pass itself -- ~3,000 lines of
function bodies removed and replaced with pointer comments + `<script
src>` loader tags, down to 1,837 lines / ~114KB from 4,815 / 287KB).
15 new files: `app/data/pred-systems.js`, `app/data/team-alias.js`,
`app/data/cover-table.js`, `app/js/model.js`, `app/js/board.js`,
`app/js/picks.js`, `app/js/odds.js`, `app/js/settings.js`,
`app/js/record.js`, `app/js/tabs.js`, `app/js/sync.js`,
`app/js/pdf-import.js`, `app/js/pool-contexts.js`,
`app/js/prediction-tracker.js`, `app/js/init.js`. `tests/test_snapshot_logic.mjs`
(+10 checks for the CLV work, plus updated to extract from
`boardSrc`/`modelSrc`/`picksSrc` post-split), `tests/test_client_logic.mjs`
(updated to extract from `modelSrc`/`oddsSrc`), `tests/test_mypicks_logic.mjs`
(updated to extract from `modelSrc`/`picksSrc`), `tests/test_pdf_error_handling.mjs`
(updated to extract from `poolContextsSrc`). `NEW_SESSION_START_HERE.md`
rewritten throughout to describe the new file layout.

**v16 additions**: `app/index.html` (Clerk pinned to `@6.28.1`; Vegas
weight default 0 + `setWeight()`/"Reset to equal" fixes; `#tab-account`
split out of `#tab-settings`; `.icon-nav-btn` header icons replacing the
Settings/Help tabs; `#contextBar`/`computeContextSummary()`/
`renderContextBar()`/`renderContextSwitcherContent()`/`initContextBar()`
(global Context Bar, `event.composedPath()` click-outside fix);
`#errorBoundary`/`initErrorBoundary()` (global error boundary); Weekly
Setup context-awareness (`computeWeeklySetup()` na/ok/bad tri-state,
`computeSetupDisplay()`'s pool-vs-no-games guard fix); green-audit CSS
(`nav.tabs button.active`/`.icon-nav-btn.active`/`.toggle-btn.active`);
Top Opportunities hierarchy (`.opp-grid` ratio, rank-aware button class,
`#2`/`#3` typography scale-down); "Manage account" button); `api/state.py`
(`SHARED_ODDS_KEY`/`SHARED_PREDICTIONS_KEY`/`SHARED_POOLS_KEY`,
`_get_shared_state()` migration-fallback merge, `_publish_pool()` rewritten
with atomic CAS + retry); `api/fetch_odds.py` and `api/fetch_predictions.py`
(own dedicated shared keys); `api/fetch_teams.py` (stale error message
fixed); `api/parse_pdf.py` (CORS headers normalized); `tests/test_state.py`
(+8 checks: concurrent pool publishing, ownership, migration fallback);
new root files `privacy.html`, `terms.html`, `responsible-play.html`,
`contact.html`, `favicon.svg`; new `README.md`.

**v15 additions**: `app/index.html` (Snapshot mobile labels/pairing/chevron,
`mktModelHTML()`, detail-panel Market column fix, `TOP_SYSTEM_RANKS` +
star pills, removed `sysSelTop`, `.tabs-wrap` scroll-fade + `initNavTabsScrollHint()`/
`updateNavTabsScrollHint()`, `#cwBp`/`#cwComp` conditional visibility,
`computeInputColumnCoverage()`, `computeWeeklySetup()`, `computeSetupDisplay()`,
`renderSetupStatus()`, `#setupNotice` moved to shared `<main>` markup),
`tests/test_snapshot_logic.mjs` (+6 checks for `mktModelHTML()`).

```
api/state.py                REPLACE — legacy-claim gate (MIGRATION_ADMIN_SECRET),
                             shared-write lockdown (410 on generic POST,
                             publish_pool action). v6: publish_pool ownership
                             check (existing.publishedBy must match caller),
                             the now-inaccurate "can't overwrite someone
                             else's pool" docstring claim corrected,
                             clear_predictions action REMOVED (410) along
                             with the now-dead merge_shared() helper. v7:
                             kv_eval()/CAS_SCRIPT/cas_write() added (real
                             atomic Redis-side compare-and-set via Upstash
                             Lua EVAL); _post_user_state() rewritten to use
                             it instead of get-then-set; expectedRevision now
                             REQUIRED on every write (428 if missing), not
                             just existing accounts
api/fetch_odds.py           REPLACE — per-book line extraction (not one resolved
                             number), server-side shared write, API key off
                             URL onto X-Odds-Api-Key header
api/fetch_predictions.py    REPLACE — server-side shared write (predictions/predMeta)
api/fetch_teams.py          REPLACE — CFBD key off URL onto X-Cfbd-Api-Key header
api/grade_picks.py          REPLACE — pool-history grading fix, user-scoped
                             manual grading vs. cron-grades-all, 7-day lookback.
                             v7: same kv_eval()/CAS_SCRIPT/cas_write() duplicated;
                             new grade_and_write_user() replaces the old
                             batch-read-then-batch-write loop with a
                             read-fresh/grade/atomic-CAS-write/retry-on-conflict
                             cycle (bounded 3 retries) so a pick added mid-grading
                             can no longer be silently overwritten
index.html                  NEW (v4) — marketing landing page, replaces what
                             used to be the dashboard at this path
app/index.html               MOVED (v4) from root index.html + FIXED (v4:
                             sportsbook resolution, EV push fix, shared-write
                             client migration, revision/409 handling) + NEW (v5:
                             Snapshot tab — renderSnapshot()/computeSnapshotScores()/
                             computeWeekStats()/snapshotRows()/snapshotFilterRows()/
                             percentileRank(), shared .ctx-select/.entry-select
                             selector refactor) + FIXED (v6: dead legacy-claim
                             UI removed entirely — button, input, click handler;
                             clearColumn('pred') no longer calls the removed
                             clear_predictions endpoint, local-only clear now) +
                             v7: distinct status message for the (defensive-only)
                             428 case, no other behavior change needed since the
                             client already always sent expectedRevision
tests/test_state.py         NEW (v4) — legacy-claim gate, shared-write lockdown,
                             concurrency/409, publish_pool scoping (16 checks).
                             v6: +6 checks for publish_pool ownership enforcement
                             and clear_predictions removal (22 checks). v7:
                             fake_kv_eval() added (lock-guarded, replicates
                             CAS_SCRIPT semantics); +6 checks including the real
                             multi-threaded concurrent-write acceptance test
                             (28 checks total)
tests/test_grading.py       NEW (v4) — grade() win/loss/push, pool-history grading,
                             pending-count across pools (12 checks). v7: +6 checks
                             proving grade_and_write_user()'s atomic retry protects
                             a concurrently-added pick from being dropped (18 checks
                             total)
tests/test_auth_sync.py     NEW (v4) — AST-diffs verify_user()/_get_jwks_client()
                             across all 7 api/*.py files (14 checks). v7: +6 checks
                             extending the drift check to kv_eval()/cas_write()/
                             CAS_SCRIPT between state.py and grade_picks.py
                             (20 checks total)
tests/test_client_logic.mjs NEW (v4) — extracts and executes resolveVegasLine/
                             resolveBookLines/probabilityCoverForGame from the
                             real app/index.html via Node vm (15 checks)
tests/test_snapshot_logic.mjs NEW (v5) — percentileRank/Pick Score blending/
                             filter-pill correctness, extracted from the real
                             app/index.html via Node vm (14 checks)
tests/_render_snapshot.py   NEW (v5) — manual (not numbered-suite) Playwright
                             screenshot script: mocked Clerk + real demo data,
                             exercises the Snapshot tab end to end

Unchanged (included in the delivered package for completeness):
api/parse_pdf.py, api/parse_pool.py, requirements.txt, vercel.json
```

**Test count, cumulative:** this line was last accurately updated around
v7 (114 checks) and never bumped through v8-v16's additions -- rather
than guess the intermediate history, the accurate current figure is
**168 checks across 7 automated test files** (36 `test_state.py` + 24
`test_grading.py` + 20 `test_auth_sync.py` + 15 `test_client_logic.mjs`
+ 57 `test_snapshot_logic.mjs` + 12 `test_mypicks_logic.mjs` + 4
`test_pdf_error_handling.mjs`), all passing as of v17. See
`NEW_SESSION_START_HERE.md`'s own Test suite section for the always-kept-
current version of this count going forward.

**Env var changes:** new `MIGRATION_ADMIN_SECRET` (unset = legacy migration
disabled, safe default). `ODDS_API_KEY`/`CFBD_API_KEY` unchanged in meaning,
just no longer read from query strings.

**Schema changes:** private state objects gain a server-assigned `_rev`
(missing = treated as 0, no migration needed). Shared `lastGames` entries
gain a `books` field (old entries without it fall back to their existing
single `vegas`/`book` fields, self-heals on next refresh). `state` gains
`snapShowScore` (bool, default false) and `snapFilter` (string, default
"all") for the Snapshot tab — both default cleanly for existing saved
state via `normalizeState()`, no migration needed.
