# PickGauge — Session Summary, Aug 26 2026 (for ChatGPT handoff)

**Read `CURRENT_STATE.md` first — it's the single source of truth and has
been kept current through this session, updated after every single change
below as part of delivering it, not batched at the end.** This note is a
narrower, narrative recap of just today's work for a fresh ChatGPT session
that wants context fast.

Full test suite: **57/57 files passing** (confirmed by direct execution
after every change below, not assumed safe from a diff) — up from 56 at
the start of the session (one new dedicated test file added, see #6
below). This count does NOT include the separate live/manual verifications
noted per-item below (real browser Playwright renders, a real production
DNS/Google Admin walkthrough, a real uploaded PDF) — those were done in
addition to the suite, not instead of it.

Nine distinct pieces of work today, roughly in order:

---

## 1. SPF/DKIM DNS setup — done, DMARC pending a 48h wait

Walked Drew through the actual Vercel DNS panel + Google Admin console
process (I have no account access to either — this had to be Drew's own
hands). Real progress, not just more drafting:

- **SPF: live and confirmed.** `v=spf1 include:_spf.google.com ~all` TXT
  record added at root, verified via MXToolbox flipping from "No SPF
  Record found" to a pass.
- **DKIM: live and confirmed.** 2048-bit key generated in Google Admin
  (`google` selector), TXT record added at `google._domainkey` in Vercel
  (correctly triggered and confirmed through Vercel's "Wildcard Domain
  Override" dialog, same pattern as Clerk's own `clk._domainkey` records
  already in that DNS list), and **"Start authentication" was clicked** —
  confirmed by Drew, not just assumed.
- **Also confirmed along the way:** despite a non-standard single-entry MX
  record (`smtp.google.com`, not the usual multi-record Workspace
  pattern), `support@pickgauge.com` genuinely can receive mail — verified
  directly by Drew. Not a blocker.
- **Still needed:** the standard ~48h settle window (Google's own
  recommendation) before adding DMARC. Aim for **Aug 28** — add `_dmarc`
  TXT, `v=DMARC1; p=none; rua=mailto:support@pickgauge.com`. Don't jump
  straight to enforcement (`p=quarantine`/`p=reject`) — `p=none` is
  deliberately monitor-only.

---

## 2. Clerk JWT `azp` hardening — confirmed against a REAL production token

The Aug 25 session's `_ALLOWED_AZP` fix was written defensively without
ever inspecting a real token (fail-open on a *missing* `azp`, specifically
to avoid a wrong guess silently breaking all production auth). Drew pulled
a real token live (`window.Clerk.session.getToken()` on `pickgauge.com`,
decoded via jwt.io) and shared the decoded payload:

- `azp` is reliably populated (`https://www.pickgauge.com`).
- **No `aud` claim exists at all** — confirms `decode_kwargs`'s
  `verify_aud: False` was correct all along, not an unverified gap.

Since `azp`'s presence is now confirmed rather than assumed, tightened
`verify_user()` to fail-closed on a missing `azp` too — applied
byte-identically across all 8 duplicated `api/*.py` copies (this
architecture has no shared imports between serverless functions).
`tests/test_auth_sync.py` gained a new `_ALLOWED_AZP` constant drift
check (the existing AST body-diff covered the function itself but not
this module-level constant it references by name). `tests/
test_clerk_token_hardening.py` updated to assert the new fail-closed
behavior. **This closed launch-blocker #6.**

---

## 3. Live CAS concurrency test — run for real, PASS

`tests/_live_cas_concurrency_test.py` needed running against real
production Upstash with a real token — can't be done from a sandbox, and
Drew doesn't have Python on his laptop, so I converted it to a
browser-console equivalent (same logic, grabs its own fresh token via
`window.Clerk`). Drew ran it live against `https://www.pickgauge.com`:
two genuinely concurrent writes fired at once, exactly one got 200, the
other got a real 409 carrying the *winner's* actual data (not stale),
`serverRevision` matched, cleanup succeeded. Confirms the CAS logic holds
against real Upstash's actual Lua EVAL semantics under genuine race
conditions, not just `tests/test_state.py`'s Python-threaded simulation.
**This closed launch-blocker #9.**

---

## 4. Real Splash pool-sheet import bug — found and fixed

Drew tried importing a real Week-1 2026 Splash PDF
(`Splash_CFB_Wk_1_Preliminary.pdf`, a ranked-opponents "Edit picks"
screen) and got a hard 500. Root cause, confirmed by reproducing the
browser's real extraction rather than guessing: built a Playwright
harness loading the actual vendored `app/vendor/pdfjs/*` build, ran the
real `extractPdfTextLines()` (from `app/js/pool-contexts.js`) against
Drew's actual file. Real output showed the spread badge landing BEFORE
the team name on this export (`"(+29.5)UMass"`), the opposite of
`TEAM_RE`'s only supported shape at the time (`"UMass(+29.5)"`) — every
team line failed to match, `parse_splash()` found zero games, and
`parse_pool_lines()`'s own `raise ValueError("Couldn't find any
games...")` became the generic 500.

Fixed (`api/parse_pool.py`): `TEAM_RE` split into `TEAM_RE_LEADING` (new)
and `TEAM_RE_TRAILING` (the original, kept — a different real export
apparently produced that shape), tried in that order. Also handles a
ranked team's `(##)` badge whether it floats alone on its own line or
glues onto the spread's line. Team names containing real parens ("Miami
(FL)") pass through untouched.

`tests/test_pool_parsing.py`: targeted unit cases for every real shape
found, PLUS the full 247-line real pdf.js output from Drew's actual file
embedded verbatim as `REAL_SPLASH_WK1_PRELIM_SAMPLE` — the strongest
regression guard available, literal real bytes not a hand-typed
approximation. Drew re-uploaded the same PDF after the fix — confirmed
working live ("that worked"). **This closed launch-blocker #7.**

---

## 5. New-user default systems — accidental BP/Comp-on fixed

Drew flagged a real account showing BP + Comp pre-checked with weight 1.
Root cause: `normalizeState()`'s BP/Comp migration (`app/js/main.js`) was
written to preserve an EXISTING account's pre-toggle behavior (BP/Comp
used to always count toward My# unconditionally), gated on a
`_bpCompMigrated` flag — but that flag is equally absent for a genuinely
brand-new signup, so new accounts got swept into "preserve prior
behavior" with nothing to actually preserve.

Fixed by computing `_hadPriorState` (several independent real-usage
signals — existing `enabledSystems`, `weights`, `pools`, `lastGames`,
`pdfGames`, `inputs`, or either migration flag already set) at the very
top of `normalizeState()`, before any of its own migrations could set a
flag that would erase the account's real age. A genuine pre-existing
account still gets BP/Comp preserved exactly as before. A genuinely
brand-new account now gets `sag` (Sagarin Rating) + `cfbdsp` (SP+)
instead — Drew's explicit call, not BP (needs a personal newsletter
subscription + per-user PDF upload a new signup won't have), not Comp (no
empirical backtested track record in this project's own ranking work),
not nothing (confusing zero-input first-run board).

New dedicated test file `tests/test_new_user_system_defaults.mjs` (15
checks) directly runs `normalizeState()` against both shapes — this is
the one new test file that brought the suite from 56 to 57. Verified live
in a real browser render against cleared `localStorage`: confirmed
exactly `['sag','cfbdsp']` checked.

---

## 6. Weekly Setup card — Powers PDF removed entirely (two-step correction)

Drew's first message asked that Powers PDF not gate "Finish Setup"
(fixed by making the item always `"na"`, non-blocking). His immediate
follow-up asked for something stronger: **"powers pdf does not need to be
part of the weekly setup card at all."** `computeWeeklySetup()`
(`app/js/board.js`) no longer pushes a `"pdf"` item into the checklist
under ANY circumstances now — the whole block, and the now-unused
`enabledCore` variable, removed outright. `computeInputColumnCoverage()`
(the coverage-counting helper) left defined but uncalled, in case BP/Comp
coverage gets surfaced elsewhere later (e.g. the board's own column
headers).

`tests/test_weekly_setup_logic.mjs` updated: asserts `r.items.find(i =>
i.key === "pdf") === undefined` across every scenario, not just a
non-blocking status. Verified live in a real browser reproducing Drew's
exact original scenario — checklist now shows exactly 4 rows (Vegas,
Prediction systems, Pool lines, Entry selected), no Powers PDF row at
all.

---

## 7. Snapshot "Pick Score" removed, replaced with real Cover % ranking

Drew asked to remove Pick Score (a blended, equal-weighted percentile
average of Raw Edge/Cover %/key-number proximity) entirely and rank by
real Cover % instead — not a synthetic blend, the actual modeled cover
probability the app already fits against 5,705 real games.

`app/js/board.js`: `computeSnapshotScores()` no longer computes a
blended `pickScore` field (still computes the three independent
`edgeRank`/`coverRank`/`keyRank` percentiles — unaffected, still feed
the detail panel's mini bars). The ranking toggle
(`state.snapRankByCover`, renamed from `snapShowScore` for honesty about
what it now does) sorts directly by `e.prob.pCover`. Removed the
now-redundant extra "Pick score" stat card and extra "Score" table
column — both were duplicating Cover %, which is already always-visible
regardless of ranking mode. `app/index.html`: toggle button relabeled
"Pick Score" → "Cover %"; dead `.has-score`/`.snap-score-cell` CSS
removed.

`tests/test_snapshot_logic.mjs`: Pick-Score-blend assertions replaced
with checks that the three ranks still compute correctly independently,
plus an explicit check that `pickScore` no longer exists on any row at
all. `tests/test_snapshot_export_feature.mjs` and the manual
`tests/_render_snapshot.py` helper had stale wording updated (actual
assertions unaffected). Verified live: toggle labels, rank note,
methodology text, and table header all confirmed correct in a real
render.

---

## 8. Help page ("How to use Edge board") — audited, two real errors found

Drew asked for a careful line-by-line audit, not a skim. Checked every
factual/numeric claim against the actual codebase. Two real inaccuracies
found and fixed (both stale from earlier changes, not typos):

1. **Quick Start steps 6-7 described a "star" mechanic that doesn't
   exist** on the Edge Board — picks are made by clicking a team's own
   pick button directly. (A ★ icon does exist, but only in the Snapshot
   tab's compact view.) Also "max 7" isn't a hardcoded universal cap —
   it's `pickLimit()`'s per-pool value, 7 only as the default fallback.
   Rewrote both steps.
2. **"~40 individual computer systems" was stale** after this session's
   earlier "Show all" toggle removal (see item #9 below) — the checklist
   now only ever offers the curated ~20 (`FEATURED_SYSTEM_CODES`), not
   "any" of the full ~48 (`PRED_SYSTEMS`, confirmed by direct count, not
   the doc's old "~40"/"44" guesses).

Also fixed a stale code comment directly above `FEATURED_SYSTEM_CODES`
(`app/data/pred-systems.js`) with the same root cause. Everything else in
the page was checked and confirmed accurate against real source — the
5,705-game/2018-2025 key-number dataset, `goodThresh`/`strongThresh`
defaults, Vegas's weight-0 default, Powers PDF page 2/6 extraction, the
remaining-API-calls display, Settings export — no changes needed to any
of those.

---

## 9. Earlier same-session work (before this file's own mid-session start)

For completeness, since these happened earlier today but predate this
summary being written:

- **"Show all 48 available systems" browse toggle removed entirely**
  (`app/js/prediction-tracker.js`) — the Prediction Systems checklist now
  only ever shows the curated ~20 featured systems, no UI path to browse
  or newly enable anything outside it. An already-`enabled` non-featured
  system still shows/still counts (safety net kept). Ingestion itself
  unaffected — a real sheet can still supply any of the ~48 codes.
- **Hero section copy** (`index.html`, marketing homepage) — several
  rounds of iteration landed on: *"Import your pool. Pick your models.
  Find your edge."* headline, with a subhead naming Splash/ESPN
  import-or-manual, then "pick which college football prediction systems
  to use and set your own weights for each." Verified in real desktop
  (1440px) and mobile (390px) renders — wraps cleanly, no overflow.
- Marketing strategy discussion (Splash commissioner outreach — warm only,
  not cold/bulk; Twitter/email plans) — advisory only, no code.

---

## Still open (see `PICKGAUGE_LAUNCH_CHECKLIST.md` for full detail)

Genuinely blocking launch:
1. Add DMARC record (waiting on the 48h SPF/DKIM settle window — aim Aug 28)
2. Deploy current code, test email/password sign-in on production (only
   Google OAuth verified live so far)
3. Full manual smoke test on the live production URL
4. Physical iPhone/Android pass (emulator coverage is deep, no real-device
   test yet)
5. Live 2026 CFBD/closing-line validation (needs actual games played —
   also the trigger for confirming Matchup Intelligence's field names
   against a populated, non-empty response)

Not blocking: unused Vercel env vars, `MIGRATION_ADMIN_SECRET` decision,
`grade_picks` cron live-fire confirmation, cookie/analytics disclosure
(only if tracking gets added), marketing prep beyond the hero (Splash
outreach, Twitter, weekly digest habit — all still ahead).

## Open side-thread, not launch-blocking

**Vegas rotation numbers.** Confirmed `api/parse_pdf.py` already parses a
real 3-digit rotation number from the Powers PDF — but only as an
internal join key (pairing away/home rows, linking the schedule page to
the Comp page within that same PDF); it's discarded before the final
`{away, home, bp, comp, homeVegas}` output. BP-to-live-board matching is
still fuzzy team-name matching (`teamMatch()`/`aliasOf()`), not numeric.
The Odds API does support rotation numbers (`includeRotationNumbers=true`
param, confirmed via their docs) but PickGauge doesn't currently request
them. Whether adding them would actually help hinges entirely on whether
Brad Powers' rotation numbers match what The Odds API would return for
the same games — genuinely unknown either way. Drew was mid-way through
running a browser-console comparison script when this session ended (hit
a Chrome CSP block from running it on a `chrome://bookmarks` tab instead
of a normal page — likely resolved by retrying on any regular website
tab, but not yet confirmed). **Recommend: don't build the Odds-API
rotation-number integration until that comparison is actually done** —
if the numbers don't match, it's wasted engineering effort.

## New feature scoped, still not built

Unchanged from prior sessions: single "My Numbers" CSV import slot
(bring-your-own-model-numbers). See `SESSION_SUMMARY_2026-08-24.md` for
full scoping notes.
