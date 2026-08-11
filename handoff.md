# CFB ATS Edge Board — Project Handoff (v6)

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

## Known open items (supersedes v3's list — carried-over items re-checked, some resolved)

1. **Clerk version pinning** — not checked this session. v3 flagged the
   free/Development tier's 100-user cap (needs a custom domain to lift);
   still true, still deferred.
2. **This handoff's own accuracy needs a live check** — everything in
   "Other fixes this session" was verified with mocked Redis/Clerk in a
   sandboxed dev environment, NOT against the actual live Vercel deploy,
   real Upstash Redis, or real Clerk JWTs. Treat as "logic verified, deploy
   unverified" until someone actually pushes this and tests it live.
3. **No automated test for the API-key-header change** — moved off the URL
   by code review only; no harness proves `refreshLines()` actually sends
   `X-Odds-Api-Key` correctly end-to-end.
4. **No automated test for the manual-grading auth split** — same
   situation, code-reviewed only.
5. **Splash locked-spread sign convention** (carried from v3) — still
   unconfirmed post-lock; still needs a real sample from after Wednesday
   11am lock.
6. **Chrome native credential popup on the live site** (carried from v3) —
   left mid-diagnosis last session; unclear if this was ever resolved.
   Follow up before assuming it's fixed.
7. **Mid-session auth expiry / empty logo alt text / silent pdf.js CDN
   failure** (carried from v3) — not touched this session, still open.
8. **`README.md`** (carried from v3) — still local-only, never pushed.
9. **First real-season live test** — still the single highest-value
   remaining validation step, and this session's fixes make it more
   likely to actually work correctly (pool grading was broken before
   today) rather than less.
10. **Snapshot tab's mobile table layout** — functional and labeled, not
    pixel-matched to the full board's custom mobile grid CSS. Low priority.
11. **The revision/concurrency system's actual atomicity gap** (this
    round) — the biggest item still open. See "New this round" above for
    the full detail; needs a real Redis compare-and-set, not a
    read-then-check-then-write across separate HTTP calls.
12. **Missing-`expectedRevision` bypass on existing-user writes** (this
    round) — should require the revision on every write to an existing
    account, not just treat its absence as "must be a new user."
13. **Grader writes have the same non-atomic race as #11** (this round).
14. **Shared-blob writes across endpoints can still race each other**
    (this round) — likely needs per-field Redis storage instead of one
    JSON blob per shared key.

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

## Files changed (cumulative, v4 + v5 + v6)

```
api/state.py                REPLACE — legacy-claim gate (MIGRATION_ADMIN_SECRET),
                             shared-write lockdown (410 on generic POST,
                             publish_pool action), revision-based concurrency
                             (_rev/expectedRevision/409, NOT yet atomic — see
                             open items). v6: publish_pool ownership check
                             (existing.publishedBy must match caller), the
                             now-inaccurate "can't overwrite someone else's
                             pool" docstring claim corrected, clear_predictions
                             action REMOVED (410) along with the now-dead
                             merge_shared() helper and its supporting constants
api/fetch_odds.py           REPLACE — per-book line extraction (not one resolved
                             number), server-side shared write, API key off
                             URL onto X-Odds-Api-Key header
api/fetch_predictions.py    REPLACE — server-side shared write (predictions/predMeta)
api/fetch_teams.py          REPLACE — CFBD key off URL onto X-Cfbd-Api-Key header
api/grade_picks.py          REPLACE — pool-history grading fix, user-scoped
                             manual grading vs. cron-grades-all, 7-day lookback,
                             _rev bump on graded writes
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
                             clear_predictions endpoint, local-only clear now)
tests/test_state.py         NEW (v4) — legacy-claim gate, shared-write lockdown,
                             concurrency/409, publish_pool scoping (16 checks).
                             v6: +6 checks for publish_pool ownership enforcement
                             and clear_predictions removal (22 checks total)
tests/test_grading.py       NEW (v4) — grade() win/loss/push, pool-history grading,
                             pending-count across pools (12 checks)
tests/test_auth_sync.py     NEW (v4) — AST-diffs verify_user()/_get_jwks_client()
                             across all 7 api/*.py files (14 checks)
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

**Test count, cumulative:** 96 checks across 5 automated test files (57 from
v4 + 14 new in v5 + 6 new in v6 + 4 new in v6 part 2 + 15 new in v6 part
4), all passing as of this handoff.

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
