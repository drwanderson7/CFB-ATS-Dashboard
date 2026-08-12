# CFB ATS Edge Board — Project Handoff (v13)

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

## Known open items (supersedes v3's list — re-checked and corrected as of v13; several items below were done in later sessions but never marked here until now)

1. **Clerk version pinning** — still not pinned (`@clerk/clerk-js@latest`,
   confirmed still present as of v12's mobile-CSS work). Still deferred.
2. **This handoff's own accuracy needs a live check** — everything in this
   entire document was verified with mocked Redis/Clerk/Odds-API/CFBD in a
   sandboxed dev environment, NOT against the actual live Vercel deploy,
   real Upstash Redis, or real Clerk JWTs. Treat as "logic verified,
   deploy unverified" until someone actually pushes this and tests it
   live. This is the single most important item on this whole list.
3. **No automated test for the API-key-header change** — moved off the URL
   by code review only; no harness proves `refreshLines()` actually sends
   `X-Odds-Api-Key` correctly end-to-end.
4. **No automated test for the manual-grading auth split** — same
   situation, code-reviewed only.
5. **Splash locked-spread sign convention** — still unconfirmed post-lock;
   still needs a real sample from after Wednesday 11am lock.
6. **Chrome native credential popup** — a concrete, plausible cause was
   found and fixed in v13 (the Odds API key field was `type="password"`
   with no login purpose, sitting next to a "Save key" button — exactly
   what triggers Chrome's password-manager heuristics, which don't
   require a `<form>` wrapper). NOT independently reproduced or confirmed
   fixed on the live site — this sandboxed environment can't run a real
   Chrome profile against the real deployment. Needs a real check.
7. **Mid-session auth expiry / empty logo alt text** — not touched, still
   open. (Silent pdf.js CDN failure — the other item originally grouped
   here — was fixed properly in a later round; see v-numbered sections
   above for that one specifically.)
8. **`README.md`** — still local-only, never pushed.
9. **First real-season live test** — still the single highest-value
   remaining validation step.
10. **Atomic CAS unverified against real Upstash** (v7) — the concurrent-
    write logic is proven correct against a mocked backend that
    replicates Upstash's documented Lua EVAL semantics, but has NOT been
    tested against a real Upstash database (no live credentials available
    in this environment). A real concurrent-write test against production
    Upstash should happen before fully trusting this under real load.
11. **Shared-blob writes across endpoints can still race each other** —
    `fetch_odds.py`/`fetch_predictions.py`/pool publishing still do
    read-modify-write on one big shared JSON blob. The recommended fix is
    moving to a Redis HASH so independent writers can't stomp on each
    other; deliberately not folded into the atomic-CAS work to keep that
    diff reviewable.
12. **Pool-publication abuse limits** — a brand-new pool id can still be
    published by any signed-in user with no size/quota validation
    (existing ids are ownership-protected, new ones aren't rate-limited).
13. **Durable per-user prediction preference** — "clear predictions"
    currently clears the local view of shared data rather than storing a
    private `usePredictions` preference; can produce inconsistent
    behavior after another shared pull or on a second device.
14. **UI Pass 3/4 remaining items** — My Picks redesign (v11) and mobile
    Snapshot polish (v12) are DONE. Still open: model-agreement indicator,
    data-completeness indicators, pool-vs-market value callout, entry
    review warnings, and a richer Results dashboard (edge-bucket/CLV/
    model-agreement performance) — the Results dashboard specifically is
    more useful once real graded season data exists.
15. **Full palette hex swap** — the design doc's exact new color values
    were deliberately NOT adopted (Drew's call in the de-AI pass, v10);
    revisit only as a deliberate full-app decision, not incremental polish.
16. **CFBD identity layer / CORE / WEPA / PPA / matchup intelligence** —
    the broader CFBD research track (separate from provider-game-ID
    grading, which IS done as of v13 using the Odds API's own ID) is
    still fully open: no `/api/cfbd_week` endpoint, no CORE/WEPA/PPA
    integration, no independent CFBD-projected-spread model, no
    historical backtesting infrastructure. Deliberately not started —
    the CFBD doc's own recommendation is production reliability first,
    modeling expansion only after real graded season data exists to
    backtest against.

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

## Files changed (cumulative, v4 + v5 + v6 + v7 + v8 + v9 + v10 + v11 + v12 + v13)

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

**Test count, cumulative:** 114 checks across 5 automated test files (57
from v4 + 14 new in v5 + 6 new in v6 + 4 new in v6 part 2 + 15 new in v6
part 4 + 18 new in v7), all passing as of this handoff.

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
