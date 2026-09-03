# PickGauge — Current State

## September 2, 2026 -- ATS pool setup wizard (matching Confidence's guided-setup pattern)

**Context:** ChatGPT proposed extending the Confidence pool wizard's
step-by-step setup pattern to ATS pools and Survivor too. Analyzed the
proposal against the actual codebase before building anything -- found
that Survivor's proposal (dynamic "which conference, either side eligible"
rules) assumes an eligibility engine that doesn't exist; SEC/Big
Ten/Kelly today are hardcoded, hand-authored full-season schedule files,
not a rule evaluator. Flagged that as its own, much larger, separately-
scoped project. Drew's decisions: Survivor stays presets-only (no new
engine) for now; build the ATS wizard standalone rather than waiting to
extract a shared component first (matching ChatGPT's proposed order);
drop the proposed "use live Vegas lines" pool mode for v1 (no such
"named pool, always-live, no locked sheet" mode exists today -- Overall
board already covers untracked live-market use, so it wasn't worth adding
a redundant middle mode without a clearer need).

**Built:**
- New ATS pool setup wizard (`app/js/pool-contexts.js`): Name → Weekly
  picks (set number / every game) → Lines (import sheet / manual) →
  Entries → Review, replacing the old single-form `createEmptyPool()`
  flow as what the "+ New pool" button actually opens.
- Choosing "Import my pool sheet" flows straight into a PDF upload prompt
  right after the pool is created (`atsPromptImportForNewPool()`), reusing
  the existing `importPool(file, targetPoolId, statusElId)` targeting
  mechanism rather than building a second upload path.
- "Pick every game" uses a documented sentinel (999) rather than changing
  `pickLimit()`'s shared `||7` fallback -- that fallback is read at 13
  other call sites throughout the app; changing its semantics risked
  subtly affecting every existing pool. Flagged clearly in code for a
  future session that might want a real "no limit" representation.
- Old single-form `createEmptyPool()` preserved as a direct,
  backward-compatible programmatic path (not deleted) -- same pattern the
  Confidence wizard used when it replaced its own predecessor.
- **Shared visual layer, standalone logic** (per Drew's explicit
  decision): renamed the Confidence wizard's CSS from `.cp-wizard-*` to a
  generic `.pg-wizard-*` prefix (these styles were already 100% generic --
  no confidence-specific content in them -- so this cost nothing and both
  wizards now look visually identical) and reused `cpWizardChoice()`
  directly (a genuinely generic "render a two-column choice card" helper
  with zero confidence-specific logic). The actual step-state-machine
  logic (`atsWizard`/`atsRenderWizardStep()`/etc.) is a fully separate,
  standalone implementation from the Confidence wizard's own -- deliberate
  duplication for now, not an oversight; unifying the two into one shared
  component is a good future project once a second real example exists to
  generalize from, but wasn't done this pass per Drew's explicit call.
- Also fixed a real, minor UX gap found while building this: typing an
  invalid number into any wizard's numeric field (weekly pick count, entry
  count, confidence count, drop-weeks count) didn't live-update the
  Continue button's disabled state -- it was still functionally blocked
  (clicking Continue on bad input silently no-ops), just without visual
  feedback until some other re-render happened to occur. Fixed in **both**
  wizards for consistency, since both had the identical gap.

**Verification:**
- New `tests/test_ats_pool_setup_wizard.mjs` (40 checks): step-gating
  logic, the actual pool object `atsCreatePoolFromDraft()` produces
  (trimmed name, correct pickLimit for both modes, the 999 sentinel,
  auto-numbered entries clamped to 25, informational `weeklyPickMode`/
  `lineSource` fields), each step's rendered HTML, the review step
  reflecting real draft values, and confirming the shared `.pg-wizard-*`
  CSS classes are actually used (not a separate ATS-only set).
- New `tests/_render_ats_pool_wizard.py` (27 checks, real headless
  Chromium): the complete wizard flow end-to-end -- Continue
  disabled/enabled at each step, prefill defaults, the "no live Vegas
  lines option" absence, the import-mode PDF-prompt notice, the entry
  stepper, editing a step from the review screen and re-confirming values
  survive, and confirming pool creation actually updates
  `state.activeContext` and the global Context Bar (verified on a
  different tab, since the Context Bar is deliberately hidden while on
  the Pools tab itself). Confirmed visually via screenshot.
- Updated two pre-existing real-browser E2E tests that had assumed the old
  single-modal-form flow (`test_e2e_dialogs.py`, `test_e2e_mobile_ux.py`)
  to exercise the new wizard instead, preserving each test's original
  intent (inline-validation-equivalent, mobile viewport containment,
  touch-target sizing, 16px input fonts) rather than just deleting the
  now-outdated assertions.
- Also updated `test_dialog_migration.mjs`'s pool-creation assertion to
  reflect the new wizard rather than the old pgForm.
- Full suite (`scripts/test_all.sh`, all real-browser E2E files included):
  113/113 files passed.

**Not built this pass, explicitly deferred:**
- Survivor setup wizard (presets-only scope agreed, not yet started).
- Unifying the Confidence and ATS wizards' JS step-state-machines into one
  shared component (only the CSS layer and one small helper function are
  shared today).

## September 2, 2026 -- Confidence pools corrected: against the spread, not straight-up

**Drew sent his real Splash sheet** ("Grundy's Gang" Team Pickem, Week 1
2026) right after the initial confidence-pool build shipped. It revealed a
wrong assumption: every game on the real sheet carries a spread (e.g.
"Colorado +6.5" / "Georgia Tech -6.5") and grading is against that number
-- not straight-up winners as originally built. Also revealed: 18 games
that week, every one required to be ranked (matches the earlier "unless I
set an amount" rule), and a real season rule -- "Your 2 lowest-scoring
weeks will be dropped."

**Corrected, same day, before this ever reached real use:**
- `app/js/confidence.js`: replaced `cpStraightUpWinner()` with
  `cpAtsResult()` -- the exact same cover-margin math
  `api/grade_picks.py`'s `grade()` already uses for every ATS pick in this
  app. A game's `line` (home-team-perspective spread) is now **required**
  to grade at all, not decorative reference text. Result vocabulary
  switched from an invented `winner`/`correct` pair to `"W"/"L"/"P"` --
  the same vocabulary every ATS pick in this app already uses, for
  consistency.
- Added `dropLowestWeeks` as a per-pool setting (Splash's stated rule is a
  contest-specific number, not hardcoded). `cpSeasonTotal()` now excludes
  the N lowest-scoring graded weeks from the season sum, progressively as
  weeks are graded -- flagged as a documented, simple interpretation since
  Splash's own tie-break/timing rules for the drop aren't fully known;
  worth confirming against Drew's actual rules page before trusting final
  standings.
- `app/js/confidence-integration.js`: the game's line is now a real,
  directly editable number input in "This week's games" (prefilled from
  the live board's Vegas number when added that way, but always
  correctable to match the actual printed sheet). Team-pick buttons now
  show the line inline -- "Colorado +6.5" / "Georgia Tech -6.5" -- matching
  Splash's own display convention exactly. Custom-add-by-hand now requires
  a line. New "drop lowest weeks" edit control next to pick-count edit.
  Season standings table gains a "Dropped" column when a pool has a drop
  setting.
- `api/grade_picks.py`'s `_grade_confidence_pools()`: rewritten to reuse
  `grade(picked_score, opp_score, line)` directly -- the identical function
  every ATS pick already grades through -- instead of a bespoke
  straight-up comparison. `_pending_count()`/`_pending_requirements()`
  updated to check the renamed `result` field instead of the old `winner`
  field.
- `cpValidatePicks()` now also flags any game missing its line, even
  during live/incomplete editing (not just at close-week time) -- a
  missing line can never be graded no matter how the picks shake out, so
  it's surfaced immediately rather than discovered only once grading
  silently can't resolve it.

**Verification:** `tests/test_confidence_pool_logic.mjs` rewritten (43
checks) around real Splash-sheet-shaped numbers (Georgia Tech -6.5, etc.),
including the new `dropLowestWeeks` behavior. `tests/test_grading.py`'s
confidence-pool section rewritten (14 checks in that section, 58 total)
with real cover-margin scenarios: a covering favorite, a non-covering
underdog, a pick'em push, and a missing-line case that correctly blocks
grading. New one-off Playwright script updated end-to-end: editable line
inputs, team buttons showing "Team +/-N.N", full close-week flow -- 17/17
checks passing, confirmed visually via screenshot against the real sheet's
layout. Full suite (`scripts/test_all.sh`, all 108 files including
real-browser E2E): passing.

## September 2, 2026 -- Confidence pools built (initial version, since corrected above)

**What Drew asked for:** confidence pool functionality (a Splash Sports
sheet type he'll attach a PDF for later, but not yet). Clarified via 5
direct questions before building: (1) every game must be ranked unless a
pick count is set; (2) Model #/Edge shown as reference only, never used in
grading; (3) its own dedicated tab/module, like Survivor; (4) when a
custom pick count is set, points run 1-to-pickCount (not 1-to-totalGames
with gaps); (5) supports multiple parallel pools running all season, like
Survivor's SEC/Big Ten/Kelly structure -- reinterpreted as "support
multiple named pool instances" rather than hardcoded fixed schedules,
since (unlike Survivor's real fixed-schedule contests) a confidence pool's
slate comes from whatever's added each week, closer to how ATS pools
already work.

**Note:** the clarifying questions never asked "against the spread or
straight-up" -- a real gap in that round, corrected the same day once
Drew's actual sheet arrived (see the entry above this one, which is now
the accurate description of how grading actually works). Everything else
from this initial round of decisions held up unchanged.

**Built, from scratch:**
- **`app/js/confidence.js`** -- pure, DOM-free logic: points-value
  validation (range, uniqueness, required-count, stale-pick detection),
  grading math, season-total aggregation (always derived from history,
  never a stored running counter -- same principle Survivor/My Numbers
  already follow).
- **`app/js/confidence-integration.js`** -- new "Confidence" tab: pool
  creation, entry management, manual game-adding (checklist off the live
  board + add-by-hand, mirroring ATS pools' existing manual picker
  pattern -- no PDF importer yet, deliberately, since Drew has no
  machine-readable sample to build the parser against; slots in later
  without touching the manual path), the picks+points interface, live
  validation messaging, and a season standings table.
- **`api/grade_picks.py`**: new `_grade_confidence_pools()`, wired into
  the same `grade_all_pending()` pass (and same atomic CAS write) as
  everything else -- no new endpoint, no extra CFBD/Odds API cost. Also
  fixed `_pending_count()`/`_pending_requirements()` to actually scan
  confidence pools -- without this, a pending confidence-only account
  would report 0 pending work and the whole grading run would skip
  fetching scores entirely, silently starving confidence pools of
  grading forever. Caught before shipping, not after.
- New state: `state.confidencePools` (own array, deliberately not folded
  into `state.pools` -- different pick shape, different grading, would
  otherwise mean every ATS-pool code path branching on pool "type"
  forever) and `state.confidenceActivePoolId`.
- New CSS block in `app/css/app.css` for the tab's own components.

**Explicitly deferred, not started:** PDF import for a real Splash
confidence sheet; CFBD canonical identity resolution at archive time
(confidence games grade via team-name/provider-ID matching only for now).

**Verification (initial build):** `tests/test_confidence_pool_logic.mjs`
(34 checks, since rewritten), `tests/test_grading.py` extended (+13
checks, since rewritten), `tests/_render_confidence_tab.py` (14 checks,
since extended to 17). Full suite passing at every step -- see the
correction entry above for the current, accurate numbers.

## September 2, 2026 -- BP/Comp never actually counted toward My Blend (real bug, fixed)

**Drew's report:** "when i enable BP and COMP and set weighting it doesnt
show me my total model # it still only shows pickgauge model #" -- with a
screenshot showing BP and Comp both checked, weight 1 each, PickGauge
Model # active, and the board showing only a `PICKGAUGE MODEL #` column --
no `MY BLEND` column anywhere.

**Root cause:** `myBlendActive()`/`myBlendNumber()` (`app/js/model.js`,
built Sept 1 for the My Blend feature, then extended Sept 2 for the Vegas
checkbox) only ever checked `enabledSystemsOrdered()` (prediction-tracker
systems) plus a Vegas-specific check. `enabledSystemsOrdered()`
*deliberately excludes* `"bp"`/`"comp"`/`"vegas"` -- they aren't
prediction-tracker system codes, they're handled specially elsewhere. But
"elsewhere" for Vegas got built in (Sept 2, earlier today); BP and Comp
never did, in either the original Sept 1 build or the Sept 2 Vegas
addition. So checking BP/Comp and setting real weights right in the grid
had **zero effect** on whether a blend was considered active or what it
computed -- with no error, no missing-data indicator, nothing visibly
wrong. BP/Comp still rendered fine as their own read-only comparison
columns (exactly why this was easy to miss) -- they just never actually
fed into Model #.

**Fix:** `myBlendActive()` and `myBlendNumber()` now check `bp`/`comp` the
same explicit way Vegas already was -- via `state.enabledSystems` and each
one's own weight, reading raw values from `inputsFor(g.key)` (the same
source `weightedModel()`'s DIY path already uses for BP/Comp).

**`MODEL_VERSION` bumped 4 -> 5**, stamped onto pick snapshots
(`modelVersion` field) -- any pick made with BP/Comp checked+weighted
under v4 could have silently used pure PickGauge instead of the intended
blend; v5 marks the point this was corrected.

**Verification:**
- `tests/test_pickgauge_model_logic.mjs` grew from 64 to 71 checks: BP+Comp
  both activating the blend, BP alone still working (proving the two
  checkboxes are independently wired), exact blend-math verification
  against known inputs, and clean collapse back to pure PickGauge when
  unchecked.
- New one-off Playwright script `tests/_render_bp_comp_blend_fix.py`
  reproduces Drew's exact screenshot scenario in real headless Chromium:
  confirms the board's `hide-myblend` class (the actual visibility gate
  behind the missing column) is present before checking BP/Comp and
  removed after. Confirmed visually via before/after screenshots -- the
  `MY BLEND` column header now appears once BP and Comp are checked.
- Full suite (`scripts/test_all.sh`): 99/99 files passed.

## September 2, 2026 -- Model performance grading now uses the real closing line, not a stale account-local snapshot

**Drew's report:** model-system grading was using whatever market line one
account's browser happened to have observed on its last pre-kickoff
refresh (`marketHomeLine`, frozen at snapshot-capture time) rather than the
real closing line. Could be hours-to-days stale depending on that one
account's own usage pattern. Drew's call: **"THAT NEEDS TO CHANGE TO GRADE
THEM TO THE CLOSING LINE."**

**Fix:** wired in infrastructure that already existed for a different
purpose (pick CLV) rather than building anything new. `api/fetch_odds.py`
already maintains `preKickLines` -- a SHARED, cross-account record where
every signed-in user's odds refresh contributes, each bookmaker's line
freezing the moment kickoff passes. That's a genuine closing-line source;
it just wasn't being read by `_grade_model_performance()` in
`api/grade_picks.py`.

- New `_resolve_closing_line(gm, pre_kick_lines)`: matches a model-
  performance game to its shared record by `providerGameId` first (exact
  Odds API event id match), team-name matching as fallback for older
  snapshots. Returns the **consensus** close (average across every book in
  the shared record, same rounding-to-nearest-0.5 algorithm
  `resolveVegasLine()` already uses client-side).
- `_grade_model_performance()` now resolves this real closing line per
  game (once, lazily, only if something's still pending) and grades every
  system against it instead of `marketHomeLine`.
- When resolved, the game object gets `closingHomeLine` /
  `closingLineBook` / `closingLineObservedAt` / `closingLineSource:
  "shared_prekick"` written onto it -- inspectable, not a silent
  substitution, and available for a future Results-tab surface.
- **Falls back to the old `marketHomeLine`-only behavior**
  (`closingLineSource: "captured_snapshot_fallback"`) when no shared
  record matches -- old data predating this feature, or a game this
  deployment never had a signed-in user's odds refresh cover pre-kickoff.
  Not a regression for that edge case, same result as before.
- **User pick grading is unaffected and intentionally unchanged** -- a
  person's actual bet is still graded against `pk["line"]`, the real
  number they picked against at pick time, never a closing line. Only
  full-slate model-performance tracking (`modelPerformanceHistory`) uses
  the new closing-line resolution.
- Threaded `pre_kick_lines` through `grade_all_pending()` /
  `grade_and_write_user()` / the top-level handler, fetched once per
  grading run (one extra Redis GET, not per-user) from the same shared key
  `api/state.py` already reads (`edge_board_shared_odds`).

**Verification:** `tests/test_grading.py` grew from 30 to 44 checks --
`_round_half()`/`_consensus_line_from_books()`/`_resolve_closing_line()`
unit coverage, plus an end-to-end case where the SAME prediction flips
from a graded W (against the stale captured line) to a graded L (against
the real closing line) -- proving the fix actually changes outcomes, not
just records extra metadata. Also covers the no-matching-record fallback
and full backward compatibility when `pre_kick_lines` is omitted entirely
(old call signature). Full suite (`scripts/test_all.sh`): 98/98 files
passed.


## September 2, 2026 -- Vegas is now a real, checkable Model # input

**Drew's report:** "I still don't see functionality for anyone to
incorporate the live vegas line as part of their model #."

**Root cause:** the functionality existed in a limited, easy-to-miss form,
not not-at-all. Vegas was permanently, structurally included in the fully-
custom DIY Model # (`weightedModel()`), gated only by its own weight --
which defaulted to 0 -- inside an "Input Weights" box that was itself
entirely hidden the moment PickGauge Model # was turned on. So: (a) in DIY
mode, a user had to know to find a specific number field and raise it
above 0, with no checkbox anywhere signaling "this is a thing you can turn
on"; (b) in My Blend mode (PickGauge on, the flow Drew was most likely
using), there was no way to add Vegas at all -- a deliberate Sept 1 design
choice to avoid double-counting the market (PickGauge's own recipe already
bakes it in at a fixed ~19%).

**Fix -- Vegas is now a real checkbox** in the Prediction Systems grid
("Vegas (live line)"), grouped with BP/Comp/Import PDF at the top, exactly
like every other system:
- Works in **both modes**. DIY custom Model # (`weightedModel()`,
  `app/js/model.js`) and My Blend (`myBlendNumber()`) both now check it via
  `state.enabledSystems.includes("vegas")`, the same pattern as every
  comparison system.
- **My Blend can now double-count Vegas if a user deliberately checks it**
  (once from PickGauge's own fixed recipe share, once again as this extra
  blend term) -- a deliberate reversal of the Sept 1 "no double-counting"
  design. Drew's call: users should be able to lean further into the
  market if they want to, not have the tool quietly prevent it.
- Both paths use the same lock-aware market line
  (`pickGaugeModelMarketLine()`) PickGauge's own recipe already uses, so
  "Vegas" means the same number everywhere.
- Weight now **defaults to 1** once checked (matching every other system),
  not the old special-cased 0 -- since inclusion is now an explicit
  checkbox action, defaulting to a weight that silently does nothing until
  separately edited would just be confusing.
- The old standalone, always-visible "Input Weights ... Vegas" box is
  removed (superseded by the grid's inline checkbox+weight, same pattern
  BP/Comp already use).
- **Migration:** a pre-existing account that had already set a real
  nonzero Vegas weight under the old mechanic gets the new checkbox
  auto-enabled once (`normalizeState()`'s `_vegasCheckboxMigrated` block,
  `app/js/main.js`), so their Model # doesn't silently change the moment
  this ships. A brand-new account, or one that never touched the old
  weight box, gets it unchecked by default -- exactly what "0 weight" used
  to mean for them.

**Verification:**
- New `tests/test_vegas_checkbox_logic.mjs` (15 checks): weightOf()
  default, DIY-mode inclusion/exclusion, My Blend inclusion, the migration
  logic (4 account shapes), and the UI/copy changes.
- Updated `tests/test_pickgauge_model_logic.mjs`'s `setWeight()` default-
  comparison assertion (no longer expects a vegas-specific default).
- New one-off Playwright script `tests/_render_vegas_checkbox.py` (12
  checks) drives the real Edge Board panel in headless Chromium: confirms
  the checkbox exists and is unchecked by default in DIY mode, checking it
  reveals a weight input defaulting to 1, the old standalone Vegas weight
  box is gone, switching to My Blend mode resets it (existing, intentional
  "clean start" behavior shared with BP/Comp), and checking it again
  *within* My Blend mode works and reveals its weight input there too.
  Confirmed visually via screenshot.
- Full suite (`scripts/test_all.sh`): 98/98 files passed.


## September 2, 2026 -- Prediction Systems panel: restricted list + "Top 7" badge reinstated

**Two related changes, both from Drew's explicit screenshots/list:**

**1. Restricted the visible checklist to Drew's exact 19-item list.**
`FEATURED_SYSTEM_CODES` (`app/data/pred-systems.js`) previously had 20 codes
(Aug 20 list); rebuilt to 17 (BP/Comp are core items rendered separately,
always shown, not part of this Set -- 17 + 2 = 19 visible total): Sagarin
Rating, Sagarin Predictor/Points, Sagarin Golden Mean, Sagarin Recent, ESPN
FPI, SP+, CORE, Dokter Entropy, Massey Ratings, Team Rankings, Congrove
Computer Rankings (`cong` only now -- the Aug 20 ambiguity between `cong`
and plain `congrove` is resolved by Drew's Sept 2 wording), Waywardtrends,
Talisman Red, Laz Index, Versus Sports Sim, David Harville, Beck Elo.
Removed: Big 200, Keeper, Pigskin Index, Pi-Ratings Mean, plain Congrove.

**Flagged, not silently dropped:** Drew's list also named "System Median."
That's not a real togglable system -- it's thepredictiontracker.com's own
cross-system aggregate row from the backtest table (like "System Average"
and "Line (updated)"), not an individual model, so there's no PRED_SYSTEMS
code for it to map onto. Left out rather than guessed; flagged to Drew.

All "20 curated systems" copy sitewide (sign-in screen, Snapshot CTA, Help
text) updated to the new count of 17.

**2. Reinstated the "★ Top 7" badge** (previously removed entirely --
see the Aug-era comment that used to sit in `renderSystemsSettings()`)
on exactly the 7 systems Drew named: Sagarin Rating, Sagarin
Predictor/Points, Waywardtrends, Team Rankings, SP+, ESPN FPI, Dokter
Entropy. `TOP_SYSTEM_RANKS` (`app/js/main.js`) rebuilt with real composite
scores read directly from Drew's own backtest table screenshot for the 6
systems that were actually in that backtest (re-ranked to skip
thepredictiontracker.com's own non-togglable aggregate/market rows).

**One deliberate exception, clearly flagged in code comments:** SP+
(`cfbdsp`) carries the badge too, per Drew's explicit request, even though
it was never actually a row in that backtest (it's CFBD-derived, not a
thepredictiontracker.com column). It's in `TOP_SYSTEM_RANKS` with
`composite:null` rather than an invented number -- flagged so a future
session doesn't "fix" this as an inconsistency.

**Verification:**
- `tests/test_sagarin_mapping_logic.mjs` rewritten: still locks in
  sagpred=rank1/sag=rank2 (the real Sagarin-naming business rule), now
  also checks the exact 7-code membership, the real composite values, and
  that "★ Top 7" renders.
- `tests/test_guest_preview_ux.mjs` updated: the stale "20 curated" string
  match and the (now-inverted) "Top 10 badge removed" assertion both
  fixed.
- New one-off Playwright script `tests/_render_pred_systems_top7.py`
  opens the real Edge Board panel in headless Chromium and asserts the
  live DOM's visible-system-name set and badged-system-name set both
  match Drew's spec exactly, element-for-element. Confirmed visually via
  screenshot too -- legend reads "★ TOP 7", badge appears on exactly the
  7 specified systems, all 19 (+BP/Comp) items visible, nothing extra.
- Full suite (`scripts/test_all.sh`): 97/97 files passed.


## September 2, 2026 -- Week 1 Big Ten survivor board: UMass @ Rutgers was silently dropped

**Bug report:** Rutgers at home vs UMass, a real Week 1 game listed on the pool's
own schedule, was missing from the Big Ten survivor board.

**Root cause:** The game was never actually missing from any data source. It's
in `BIGTEN_POOL_SCHEDULE_2026` (`{ week: 1, teams: ['UMass', 'Rutgers'] }`),
and there's even a verified-omission fallback for it in
`survivor-data-adapter.js`. The real bug: CFBD's canonical `school` spelling
for that opponent is "Massachusetts", not "UMass". The shared fuzzy team
matcher (`teamMatch()` / `data/team-alias.js`) already knows `umass ==
massachusetts`, so `pgsHasCanonicalPair()` correctly saw a real CFBD game and
skipped adding the synthetic fallback -- but the *authoritative-schedule*
matcher used to line the pool's game list up against CFBD (`pool-schedule-
utils.js`'s `createScheduleMatcher`, driven by each pool file's own small
`TEAM_ALIASES` map) had no `umass`/`massachusetts` alias entry for the Big Ten
pool. So the real CFBD game and the pool's "UMass" slot never matched, the
slot fell into `missing`, and -- because the fallback-guard logic thought a
canonical match already existed -- nothing filled the gap. Net effect: the
game vanished from the board entirely, with no fallback and no real match.

The Kelly pool's schedule file (`kelly-pool-schedule-2026.js`) already carried
this exact alias (`massachusetts -> umass`), which is how the fix was found --
Big Ten's file just never got it when the two were written.

**Fix:** added `['massachusetts', 'umass']` / `['umass', 'umass']` to
`TEAM_ALIASES` in `app/survivor-core/data/bigten-pool-schedule-2026.js`.

**Test coverage added:** `tests/test_survivor_schedule_fallback.mjs` now has a
dedicated case that calls the real `applyBigTenPoolSchedule()` (not the
passthrough mock used by the rest of that file) with a CFBD-shaped game
spelled "Massachusetts", and asserts the Week 1 slot matches and is not
reported missing. Verified this case fails without the alias fix and passes
with it.

**Verification:** full suite run (`scripts/test_all.sh`) -- 97/97 files
passed after the fix.


**Last updated: September 1, 2026 (Claude: "My Blend" shipped -- comparison systems can now actually influence Edge/Cover %/pick recommendations while PickGauge Model # is active, without changing the branded number itself)**

## September 1, 2026 -- "My Blend" (Option 2)

**The problem, in Drew's own words:** with PickGauge Model # active, a manually-enabled comparison system was strictly read-only -- it rendered as its own column purely to eyeball, but structurally could never influence Edge, Cover %, or the pick recommendation, no matter its weight. `weightedModel()` short-circuited straight to `pickGaugeModelNumber()` and never looked at `state.enabledSystems` at all while PickGauge was on.

**Three designs were proposed; Drew picked Option 2 explicitly: leave the PickGauge Model # column exactly as it's always been (pure, fixed recipe, never touched), and add a separate "My Blend" column/number that mixes it with whatever comparison systems the user enables, at their own weights.**

**What shipped, in `app/js/model.js`:**
- `myBlendActive()` -- true only when PickGauge is on AND at least one comparison system carries positive weight. The common case (PickGauge on, nothing else enabled) is false, so nothing changes for the vast majority of users.
- `myBlendNumber(g)` -- weighted average of the pure `pickGaugeModelNumber(g)` (its own weight, `weightOf("pickgauge")`, new special-cased default of **3** -- heavier than a newly-enabled system's default of 1, so checking one box tilts the blend rather than instantly splitting it 50/50) and each enabled comparison system's raw value at its own weight. Deliberately does NOT add a second Vegas term -- PickGauge already has the market baked in at its fixed 19%; double-counting it would quietly change how much the market matters beyond what either the recipe or the user's own weights say.
- `myNumber(g)` -- the function Edge/Cover %/CLV/sort/My Picks/pick-decision snapshots all actually key off -- now returns the blend when `myBlendActive()`, otherwise unchanged (byte-for-byte the same as before this session).
- `modelColumnDisplayNumber(g)` -- new, narrow-purpose function: ALWAYS the pure PickGauge number when active, regardless of blend state. This is the one function the "PickGauge Model #" column itself calls now -- the guarantee Option 2 exists to keep.

**Real bug caught and fixed before it shipped:** `setWeight()`'s "does this match the key's own default, so we can skip storing it" comparison hardcoded `1` for everything except Vegas. With "pickgauge" now defaulting to 3, an explicit weight of 1 for PickGauge (a completely reasonable thing to want -- "barely weight the branded number, mostly trust my comparison system") would have been silently treated as "matches the default" and deleted, reverting back to 3 the moment the user typed the value they actually wanted. Fixed by extending the same three-way default logic `weightOf()` already used.

**Real bug caught via actual screenshot, not code review:** the new mobile `.myblend-cell` grid-row collided with the pre-existing `.board-cfbd-toggle-cell` ("Matchup breakdown" button) -- both were `grid-row:5`, so on a real 390px render the My Blend value sat directly on top of the toggle button, both partially unreadable. Fixed by moving the toggle to row 6. New `tests/test_board_mobile_grid_rows.mjs` (5 checks) pins that no two full-width mobile card elements can ever share a grid-row again, and pins the specific stacking order (My Numbers -> My Blend -> Matchup breakdown) the screenshot confirmed.

**UI:** new "My Blend" board column, hidden by default via the same `.hide-myblend`/visibility-toggle pattern the My Numbers column already established -- only appears once a blend is genuinely active. New weight box in the Prediction Systems panel ("MY BLEND · PickGauge [3]") plus per-system weight boxes now stay visible while PickGauge is active (previously hidden entirely, since they had no effect on anything). Panel copy and the board's own explanatory footnote both rewritten to describe the new behavior accurately.

**`MODEL_VERSION` bumped 3 -> 4** -- this is exactly the kind of semantics change that constant exists to flag: a pick made under v3 with identical inputs could compute a different `myNumber()` under v4 purely because this new code path exists, not because any single historical value changed.

**Testing:** `tests/test_pickgauge_model_logic.mjs` extended with a dedicated My Blend section (`myBlendActive()` gating including the "weight explicitly 0" edge case, the blend math itself, the pure-column guarantee, the setWeight() default-comparison fix, sort-key separation) -- 20 new checks, 64/64 in that file. Also fixed a state-contamination issue in the file's own existing fixture (an earlier check intentionally enables a comparison system to prove PickGauge stays *active*; under the new code that same leftover state would have silently activated a blend for every later pinned-recipe test in the file -- reset explicitly rather than relying on the coincidence that the leftover system happened to have no value in the mock and therefore didn't change any numbers).

**Verified in a real browser via the actual UI flow, not direct state mutation:** clicked the real PickGauge checkbox (confirmed it correctly clears `enabledSystems` first, so a fresh user's default 2-system starter composite doesn't accidentally count as a "blend"), opened the real Prediction Systems panel, checked a real system's checkbox, confirmed both weight boxes render, and confirmed the PickGauge column and My Blend column show genuinely different, mathematically correct numbers on real seeded data (-7.5 vs -8.2, etc.) -- desktop and mobile.

Full regression status: `bash scripts/test_all.sh` -> **95/95 files pass** (was 94; one new test file, `test_pickgauge_model_logic.mjs` grew in place).


## September 1, 2026 -- My Numbers column visibility (UI/UX review item #3)

**Problem:** the My Numbers column rendered unconditionally on the Edge Board even at "0 of N entered" -- 8 empty "enter line" boxes as the widest non-data column on desktop, and repeated as its own row on every single mobile card regardless of whether the feature was ever touched.

**Fix, in `app/js/my-numbers.js`:**
- `myNumbersColumnVisible()` -- true if the My Numbers panel (`<details id="myNumbersPanel">`) is open, OR at least one number is genuinely entered this week (`currentMyNumbersCount()>0`). Real data is never hidden, regardless of panel state.
- `updateMyNumbersColumnVisibility()` -- toggles a `hide-usernum` class on the `.board` wrapper div (confirmed via source that `renderBoard()` only ever touches `#boardBody`/`#boardHeadRow` innerHTML, never replaces `.board` itself, so a class set on it survives every re-render).
- Wired into all the right triggers: `renderMyNumbersControls()` (called on every board render, every single-cell edit, CSV import via `renderBoard()`, and clear-all), plus a `toggle` event listener on the panel itself for the case where the user manually expands/collapses it without touching any number.
- `board.js`'s `usernum` `<th>` given the same `.usernum-cell` class the `<td>` cells already had, so one CSS rule (`.board.hide-usernum .usernum-cell{display:none!important;}`) hides header and every row's cell together -- no column/row misalignment risk.
- Mobile needed **no separate rule at all**: the mobile card layout is the same `<td class="usernum-cell">` reflowed via CSS grid (`data-label` + `grid-column`/`grid-row`), not a separate render path -- hiding the `<td>` on desktop automatically removes the mobile card row too.

**Verified in a real browser across all three states, desktop AND mobile:** panel closed + nothing entered -> hidden; panel opened -> reappears; number entered then panel closed again -> **stays visible** (the never-hide-real-data guarantee, the one behavior most worth getting right and the one that's easy to get backwards). Also confirmed mobile has no overflow in any state, and that a second game's entry keeps the column visible on a multi-game slate.

Extended `tests/test_my_numbers_logic.mjs` with a minimal fake DOM (settable `#myNumbersPanel.open`, a `.board` stub with real two-arg `classList.toggle` semantics) rather than adding a separate file -- 13 new checks covering the visibility function itself plus the wiring (header class, `renderMyNumbersControls()` calling it, the toggle listener, the CSS rule existing). 62/62 in that file.

Full regression status: `bash scripts/test_all.sh` -> **94/94 files pass** (same count -- extended an existing file rather than adding a new one).

**Remaining UI review findings still open:** header's `calls left: —` exposes raw Odds API quota in user-facing chrome; four unlabeled header icon buttons.


## September 1, 2026 -- Snapshot thin-week handling (UI/UX review item #5)

**Problem:** Snapshot's "Top Opportunities" is headed *"Your strongest ATS edges this week"* and unconditionally rendered `ranked.slice(0,5)`. On a week where the model and market broadly agree, that filled all five cards with SLIM leans under that heading -- while the stat strip immediately beneath it read "STRONG EDGES 0 · GOOD EDGES 0", directly contradicting the heading one line above. Same family as the Edge Board tier fix: report what's actually there.

**Fix:**
- Cards are now gated on clearing the "good" threshold (`edgeClass(pts)!=="r"`), still capped at 5. Fewer qualify -> fewer cards.
- The bar is deliberately **edgeClass-based even when ranked by Cover %**, because each card's own tier label and `computeWeekStats()`'s strong/good tiles are both edgeClass-based -- so the note's "N games clear the bar" can never disagree with the STRONG/GOOD numbers directly below it. Cover % still controls the ORDER of whatever qualifies.
- Heading swaps to "No standout edges this week" when leans exist but none qualify. Guarded on `allRows.length&&!qualifying.length` so a genuinely empty slate keeps the normal heading (its own empty state already covers that case).
- New amber note explains the shortfall and points to Quick Look for the full slate.
- **The shareable export is blocked too.** `exportSnapshotTopEdgesGraphic()` produces a public graphic titled "TOP 5 EDGES"; on an all-slim week that publishes the same overstatement in its most durable form. Now refuses with an explanation, placed after the existing empty-rows guard so a truly empty slate still gets its own distinct message.

**Two things caught by actually rendering rather than reasoning:**
1. **A duplicate-message bug I introduced.** First pass had both the amber note AND a grid empty-state saying essentially the same sentence, stacked. Caught in the flat-week screenshot; grid now renders nothing when the note is showing.
2. **A "fix" that made things worse, reverted.** I initially set `gridTemplateColumns` dynamically, assuming the hardcoded `repeat(5,1fr)` would squeeze a lone card into a 1/5-width sliver. Measured it instead of trusting that: the default grid already sizes a single card correctly (~176px, same as any other card), and my override stretched it to full width -- turning a merely "Good" edge into a hero-sized card, the exact over-emphasis this change was meant to remove. Removed entirely; the default grid was already right and the trailing whitespace honestly conveys a thin week.

**Verified in a real browser** across three constructed slates -- normal (5 qualify), thin (1 qualifies), flat (0 qualify) -- plus mobile at 390px with no overflow. Confirmed the note's counts match the stat tiles exactly in each case. The export guard was verified by evaluating its condition against real export rows (`flat -> blocked, normal -> allowed`); the full export path couldn't be driven end-to-end in this sandbox because it fetches team logos over the network first, which hangs here -- noted rather than glossed.

**One existing test legitimately broke and was updated, not silenced:** `test_snapshot_quicklook_layout.mjs` pinned the literal string `ranked.slice(0,5).map(...)` to enforce an older "5 cards, not 3" decision. That intent still holds (cap is still 5) but the expression changed, so the assertion was rewritten against the new shape with a comment pointing at the new behavior's own test.

New test file `tests/test_snapshot_thin_week.mjs` (20 checks): the gate, the edgeClass basis that keeps note/tiles in lockstep, heading adaptation, note visibility in all three states, the no-duplicate-messaging fix, and the export guard's placement.

Full regression status: `bash scripts/test_all.sh` -> **94/94 files pass** (was 93; one new test file).

**Remaining UI review findings still open:** header's `calls left: —` exposes raw Odds API quota in user-facing chrome; the My Numbers column renders empty inputs even at "0 of N entered"; four unlabeled header icon buttons.


## September 1, 2026 -- Edge Board tier labels (UI/UX review item #1)

**Problem found during a full UI review** (rendered every populated state in a real browser, not read from source): the Edge Board rendered every game's lean identically -- same bold team name, same layout, under a column headed **"Edge — pick"** -- with background color as the ONLY signal distinguishing a 0.3-point edge (noise; thresholds are 1.5 "good" / 3.0 "strong") from a 3.0-point one. A user scanning the board saw what looked like a recommended pick on every single row.

**The inconsistency that made it clearly wrong rather than just debatable:** Snapshot's Top Opportunities cards have labelled their tiers in words (STRONG/GOOD/SLIM, `.opp-tier`) since they shipped. So the same underlying number was already being described responsibly in one view and as a flat "pick" in the other. This was an alignment fix, not a new opinion -- and it matters for a product whose positioning explicitly avoids unsupported-confidence claims.

**Fix:**
- New shared `edgeTierLabel(pts)` in `app/js/model.js`, placed directly next to `edgeClass()` whose thresholds it mirrors (so the two can't drift into different tier boundaries). Snapshot's own inline ternary was replaced with a call to it -- there is now ONE implementation, not two copies.
- Edge Board cells render the tier word above the team name. Suppressed entirely on a genuine "no lean" (model agrees with market) -- nothing to rate there.
- **Both** Board render paths updated: `renderBoard()`'s initial render AND `updateRowCalc()`'s live-update path, which runs on every My Numbers / manual line edit. Missing the second would have silently stripped the label from exactly the rows a user just touched -- a pinned test now enforces both.
- Column header **"Edge — pick" -> "Edge — lean"** (the board reports a model lean; it doesn't tell you what to bet). Changed in `board.js`'s `sortHeaderHTML()` (the live header) AND `app/index.html`'s static fallback `<th>` -- the static one is easy to miss since it's overwritten at render time.
- Board legend changed from "strong / edge / no edge" to "strong / good / slim" -- caught this only after rendering the fix, since the new cell labels would otherwise have introduced a second vocabulary for the same three tiers on the same screen.
- "How this works" explainer updated to say plainly what Slim means.

**CSS:** `.edge-tier` styled to match `.opp-tier`'s treatment, tier-colored to its cell. Needed a separate mobile rule (`flex:0 0 100%`) because the mobile edge cell is a flex row -- the desktop `display:block` does nothing inside a flex container, so without it the label would have sat inline instead of above the pick. Verified by real render at 390px, not reasoned about.

**Verified in a real browser at both viewports:** confirmed all three tiers render correctly against deliberately-constructed edges spanning every threshold (Strong 4.0 / Good 1.5 / Slim 0.3 / no-lean 0.0), the no-lean row correctly carries no tier word, and mobile has no horizontal overflow.

New test file `tests/test_edge_tier_label.mjs` (21 checks): pins the tier boundaries against the real function, that user-configured thresholds are respected rather than hardcoded defaults, that Board and Snapshot share one implementation, that BOTH Board render paths emit the label, and that the vocabulary stays consistent across cells/legend/header.

Full regression status: `bash scripts/test_all.sh` -> **93/93 files pass** (was 92; one new test file).

**Remaining UI review findings NOT actioned** (presented to Drew, not yet prioritized): the header's `calls left: —` exposes raw Odds API quota in user-facing chrome; the My Numbers column renders 8 empty inputs even at "0 of N entered"; four unlabeled header icon buttons; and Snapshot's "Your strongest ATS edges this week" shows a top-5 even when only 2 clear the good threshold.


## September 1, 2026 -- PickGauge Model # recipe replaced

**Old recipe retired entirely:** Sagarin Ratings 13% / Sagarin Predictor 13% / Dokter Entropy 22% / SP+ 20% / Vegas 22% / Big 200 10%. Dokter Entropy and Big 200 are no longer part of the internal recipe at all (both remain available as ordinary DIY Model # inputs in the Prediction Systems panel -- only removed from the branded PickGauge preset specifically).

**New recipe**, per Drew's own backtest table:

| System | Weight | Code |
|---|---|---|
| TeamRankings.com | 20% | `teamrank` |
| Vegas Live # | 19% | `vegas` |
| Sagarin Points | 18% | `sagpred` |
| SP+ | 16% | `cfbdsp` |
| Waywardtrends | 15% | `wayward` |
| Sagarin Ratings | 12% | `sag` |

Sums to exactly 100. Still 5 predictive models + Vegas (same count as before), so every "5 predictive models" / "3, 4, or all 5 feeds" description elsewhere in the app (marketing copy, methodology, the 3/5-4/5 dynamic-fallback UI note) remained numerically accurate and needed no wording changes.

**Sagarin code mapping used the ALREADY-RESOLVED Aug 25 mapping** documented in `app/data/pred-systems.js`'s own comment history, not re-guessed: `sagpred` (Sagarin Predictor/Pure Points) is the backtest's "Sagarin Points"; `sag` (overall Sagarin Rating) is the backtest's "Sagarin Ratings." These are a real 6-point-apart weight difference (18% vs 12%), not interchangeable -- got this right by reading the file's own history rather than assuming from the name alone.

**Both new systems (`teamrank`, `wayward`) were already fully supported** -- both already existed in `PRED_SYSTEMS`/`FEATURED_SYSTEM_CODES` and are ordinary `thepredictiontracker.com` CSV columns the app already ingests. This was a pure weight/composition change, not a new data-pipeline feature -- confirmed before touching any code, not assumed.

**Files changed:**
- `app/data/pred-systems.js` -- the `PICKGAUGE_MODEL_PRESET` object itself, plus its header comment rewritten to document the new recipe and the Sagarin mapping reasoning inline.
- `app/js/model.js` -- `pickGaugeModelValues()` (was reading `preds.dokter`/`preds.big200`, now reads `preds.teamrank`/`preds.wayward`) and the missing-inputs tooltip's `names` map (was hardcoding the old 6 display names). `pickGaugeModelMissingInputs()`/`pickGaugeModelCoverage()`/`pickGaugeModelNumber()` needed NO changes -- confirmed by reading them first -- they're fully generic over whatever `PICKGAUGE_MODEL_PRESET.systems`/`.weights` contains.
- `app/js/record.js`'s `modelPerformancePickGaugeNumber()` -- confirmed generic, no changes needed.
- Confirmed `app/js/main.js`'s `TOP_SYSTEM_RANKS` (Drew's own separate 2-year backtest ranking of ALL individual systems, keyed 1-10) is an unrelated, independent dataset -- not the recipe, didn't touch it.

**Tests:** `tests/test_pickgauge_model_logic.mjs` (the file that explicitly "pins the recipe") -- every weight-value check and every missing-model-fallback arithmetic check recomputed by hand against the new weights/codes, not just find-and-replaced. 48/48 pass. Also updated `tests/test_model_performance_history_logic.mjs`'s own local mock of the preset (technically inconsequential to its pass/fail since it's a self-contained closed mock, but left with the old recipe it would have silently misled a future reader into thinking dokter/big200/13/13/22/20/10 was still real) -- 14/14 pass.

**Verified end-to-end in a real browser**, not just in the vm-based unit tests: loaded the real app, confirmed `PICKGAUGE_MODEL_PRESET` as actually parsed by the browser matches the new recipe exactly, and confirmed `pickGaugeModelNumber()` computes the mathematically correct result (-4.58 for a hand-checked test input) end to end through the real running code path.

Full regression status: `bash scripts/test_all.sh` -> **92/92 files pass**, including the real-browser E2E suite.


## September 1, 2026 -- ChatGPT's guest-snapshot fix, merged and independently verified

**Real production bug, confirmed via ChatGPT's own live-endpoint diagnosis before any code changed:** a logged-out visitor reaching Snapshot stayed stuck on "Live data is warming up for the public preview" forever. Root cause: `api/public_snapshot.py`'s odds view was intentionally read-only (only ever reading the shared `edge_board_shared_odds` Redis cache that AUTHENTICATED usage populates) -- during any quiet period with no signed-in user refreshing odds recently enough, the public preview had no way to ever become ready on its own. A public landing flow was accidentally dependent on signed-in traffic to self-warm.

**Fix, independently code-reviewed (not accepted on the summary alone) -- two claims specifically verified against actual source:**
- **"One GLOBAL Redis cooldown across all anonymous visitors," not per-IP:** confirmed -- `_warm_public_odds()` calls `rate_limited("__global_odds_warm__", 1, 300)` with a literal constant bucket key, not a per-caller one, so the whole warm path is genuinely gated by one shared 5-minute cooldown regardless of visitor volume. Fails OPEN if Redis itself is unreachable (documented, same fail-open pattern this file already used elsewhere) -- an availability-over-cost-protection tradeoff during a Redis outage, consistent with the rest of the codebase.
- **"`reqLeft` and `preKickLines` never appear in the public response":** confirmed by reading `_public_odds_body()` directly -- it returns exactly `{ready, games, lastRefresh, booksSeen, asOfMinutes, stale, source}`. Those two fields exist in the internal cache dict but are never in what gets serialized back to an anonymous caller.

Other real protections in the warm path: server-owned `ODDS_API_KEY` only (never a user-supplied key), a hard quota floor (won't warm if the shared key has fewer than 50 provider calls left, matching the shared-key floor already used elsewhere in this codebase), a bounded 24-hour stale-cache fallback if a warm is blocked/unavailable, and negative/stale responses get a short 15-second CDN TTL (vs. 60s for healthy data) so a just-completed warm becomes visible quickly instead of sitting behind a minute of negative caching. `app/js/guest-snapshot.js` adds a bounded 3-attempt auto-retry (6s apart, cache-busting query on retries) specifically for the case where another visitor currently owns the one allowed global warm -- properly guarded by `_guestActive` and cleared on every exit path (checked: 3 separate `clearTimeout` sites), so it can't become a zombie polling loop after a visitor navigates away. `vercel.json`'s `public_snapshot.py` maxDuration raised 10s -> 20s to give the guarded upstream warm enough headroom.

**Verification, not trust:** ChatGPT's own sandbox reported `scripts/test_all.sh --fast` passing (85 files) but could not run the real Playwright/Chromium E2E suite (`ERR_BLOCKED_BY_ADMINISTRATOR`, the same sandbox restriction seen earlier this same day on a different ChatGPT handoff). Merged the diff into this working copy and ran the FULL suite here, unblocked -- **92/92 files pass, including the real-browser E2E suite** -- the first genuine end-to-end confirmation this fix has actually gotten, not just a partial/fast run.

Files touched: `api/public_snapshot.py`, `app/js/guest-snapshot.js`, `vercel.json` (maxDuration only), `tests/test_public_snapshot.py` (extended), new `tests/test_guest_snapshot_logic.mjs`.


## September 1, 2026 session summary (Claude, part 7) -- TODO #26 split the Playwright suite

**`tests/test_e2e_ui_behaviors.py` (739 lines, one `main()`, one shared browser session, 7 numbered scenarios run sequentially) split into 7 independent files**, each with its own server + browser session: `test_e2e_context_bar.py`, `test_e2e_weekly_setup.py`, `test_e2e_error_boundary.py`, `test_e2e_pools_hides_shared_widgets.py`, `test_e2e_dialogs.py`, `test_e2e_results_analytics.py`, `test_e2e_mobile_ux.py`. The cut points matched the file's own existing numbered section banners exactly, not a fresh re-derivation. Mobile UX (259 lines) deliberately stayed as ONE file rather than splitting further -- its checks build on each other's state within the same page/session on purpose (documented inline), so further splitting would mean re-deriving that sequential setup per file for no real independence gain, unlike the other 6 scenarios which genuinely don't depend on each other.

**Shared boilerplate (Clerk mock, static-file HTTP handler, browser launch with system-Chromium fallback -- ~35 lines every scenario needed) factored into a new `tests/_e2e_common.py`** (underscore-prefixed, so `test_all.sh`'s `test_*.py` glob never picks it up directly -- same convention as `_render_*.py` and `_team_match_js_runner.mjs`). Each of the 7 files still spins up its own server + browser and tears it down itself; the shared module only removes literal duplicate setup code, not the independence itself.

**Verified lossless, not assumed:** all 7 new files run individually before the old file was deleted -- 8+5+6+10+10+7+25 = 71 checks, the exact same total the original single file had. Then **proved the actual fix, not just claimed it**: temporarily injected a hard `RuntimeError` mid-way through `test_e2e_context_bar.py` and ran the full suite -- the other 90 files (including the other 6 E2E scenarios) ran completely unaffected and reported normally; only `test_e2e_context_bar.py` showed as failed, by name. Under the old single-file design this same crash would have silently aborted the whole run and hidden all 6 other scenarios' results -- exactly the problem TODO #26 was written to fix. Reverted the injected crash immediately after confirming.

**Updated everything that referenced the old filename:** `scripts/test_all.sh`'s `--fast` flag logic (now skips `tests/test_e2e_*.py` via glob instead of one hardcoded filename), 4 other test files' comments pointing at the old file for "real DOM behavior lives here" context (`test_context_bar_logic.mjs`, `test_dialog_migration.mjs`, `_render_setup_rows.py`, `test_nav_hamburger_wiring.mjs`), and `README.md`/`NEW_SESSION_START_HERE.md`'s test-running instructions. Left `PICKGAUGE_LAUNCH_CHECKLIST.md`'s Aug 26 mention alone -- it's already a dated historical snapshot with its own stale file-count from before today's other additions, same as this file's own dated entries are never retroactively rewritten.

**Known pre-existing gap, not introduced by this change:** `README.md`'s testing section still opens with a stale "63 permanent test files" count from before several recent sessions' worth of additions (today alone added ~10 files across My Numbers, pool progress, Survivor tables, and this split). Only fixed the specific lines this session's change made factually wrong (naming a file that no longer exists); the broader file-count reconciliation is a separate, smaller cleanup worth doing sometime but out of scope for TODO #26 specifically.

Full regression status: `bash scripts/test_all.sh` -> **91/91 files pass** (was 85; +7 new E2E files, -1 removed original). `--fast` correctly skips all 7 E2E files now (84 files), confirmed by grepping the run output for zero `test_e2e` invocations under `--fast`.


## September 1, 2026 session summary (Claude, part 6) -- TODO #24 Snapshot/export refactor

**`app/js/board.js` (1851 lines) split into `board.js` (984 lines, Board tab only) and a new `app/js/snapshot-export.js` (915 lines, the entire Snapshot tab + social-export PNG generator).** board.js's own header comment had already flagged this exact split as a known future improvement, including the reason it wasn't done trivially: `edgeExtrasHTML()`/`probCellHTML()`/`mktModelHTML()` are genuinely called by BOTH `renderBoard()` and `renderSnapshot()`. Resolved the same way that comment suggested -- those three helpers (plus `bindRowInputs()`/`updateRowCalc()`/`updatePickCount()`/`renderPickSummary()`, which `renderBoard()` needs directly and Snapshot's re-render path depends on indirectly) stayed in `board.js` as the canonical Board-cell-rendering module; `snapshot-export.js` calls them the same way `picks.js`/`record.js` already call `board.js` functions across files -- ordinary global scope, no imports, consistent with this project's whole file-splitting pattern.

**What actually moved:** `renderSnapshot()` and everything only it uses -- `computeSnapshotScores()`, `renderSnapDetailRow()`, `percentileRank()`, `ordinalSuffix()`, `computeWeekStats()`, `snapshotRows()`/`snapshotFilterRows()`, the whole `exportSnapshotTopEdgesGraphic()` PNG-generation pipeline (canvas drawing helpers, logo/data-URL fetching, brand drawing), and the Snapshot-only module state (`SNAPSHOT_ROW_LIMIT`, `SNAP_FILTER_LABELS`, `snapExpandedKeys`). Verified every one of these was Snapshot-exclusive by grepping for external callers across the whole app before moving anything, not assumed from function names.

**Boundary matched an existing section comment exactly:** board.js already had a `/* ---------- Snapshot tab ---------- */` banner marking where the Snapshot section began (right after `renderBoard()`'s own closing brace) -- confirmed as the correct cut line by tracing every call site rather than trusting the comment alone.

**Wiring:** new `<script src="/app/js/snapshot-export.js">` tag added to `app/index.html` right after board.js's own tag. `tests/test_script_paths.mjs` (deployment-shape check for exactly this class of mistake -- an orphaned or unwired split file) confirms it resolves and parses.

**Test updates:** 6 test files read `board.js`'s source directly to extract/check Snapshot-related functions (`test_snapshot_export_feature.mjs`, `test_snapshot_logic.mjs`, `test_snapshot_quicklook_layout.mjs`, `test_shortlist_logic.mjs`, `test_html_injection_safety.mjs`, `test_pickgauge_model_logic.mjs`). Each now concatenates `board.js` + `snapshot-export.js` under the same variable name it already used, so every existing extraction/check inside them keeps working unchanged regardless of which file a given function now actually lives in -- caught one of these (`test_pickgauge_model_logic.mjs`) via a real full-suite failure, not by memory, and fixed it the same way as the other five. 5 other board.js-referencing test files (`test_board_cfbd_dropdown_logic.mjs`, `test_cfbd_identity_logic.mjs`, `test_cfbd_insights_logic.mjs`, `test_pool_setup_cta_logic.mjs`, `test_weekly_setup_logic.mjs`) needed no changes -- confirmed individually, not assumed, that none of them touch anything that moved.

Full regression status: `bash scripts/test_all.sh` -> **85/85 files pass**, including the real-browser E2E suite (which directly exercises the Snapshot tab, including its own mobile-overflow checks) -- same file count as before since this was a pure reorganization, no new test file needed beyond the wiring check `test_script_paths.mjs` already provides.


## September 1, 2026 session summary (Claude, part 5) -- TODO #25 remaining inline CSS

**index.html (marketing homepage):** had a 1218-line inline `<style>` block that turned out to be a full compiled Tailwind utility-CSS dump (the `--tw-*` preflight reset, hundreds of utility classes) pasted inline rather than loaded via the Tailwind CDN script. Moved verbatim to `css/marketing.css` (pure file move, zero rule changes) and replaced with a single `<link>`. `index.html` now has zero inline `<style>` blocks, matching `app/index.html`'s own state since the Aug 28 extraction.

**8 root pages shared near-identical boilerplate:** `methodology.html`, `pricing.html`, `privacy.html`, `terms.html`, `contact.html`, `responsible-play.html`, `404.html` each carried their own copy of the same nav chrome / base reset / footer-link-row CSS (~13-25 lines each, small individually but real duplication across 7-8 copies). Programmatically diffed all of them (not eyeballed) to find the rules that were BYTE-IDENTICAL across every one, extracted only those into `css/legal-pages.css`, and left every genuinely page-specific rule (colors, spacing, unique classes like `.source-card`/`.helpline`/`.card`) in each page's own now-much-smaller residual `<style>` block. Nothing divergent was force-merged -- e.g. `terms.html`'s amber-themed `.callout` and its extra `--amber`/`--amber-bg` root vars stayed exactly as they were, not unified with the other pages' green-themed version.

**Real bug caught mid-work, not shipped:** the first extraction pass used a naive regex to split CSS into individual rules for comparison. That regex doesn't understand nested braces, so on `pricing.html` (the only one of the 8 with `@media` blocks) it silently stripped the `@media(max-width:680px){ ... }` wrapper off two responsive overrides (`.tiers` and `.why-grid` collapsing to one column on mobile), leaving them applying UNCONDITIONALLY -- which would have made pricing.html's tier cards render single-column on desktop too, a real visible regression. Caught by grepping the output for `@media` and finding zero matches, before packaging anything. Rewrote the splitter to be nesting-aware (treats an `@media{...}` block as one atomic unit), reconstructed `pricing.html` from the verified original text, and reverified with a real headless-Chromium render at both desktop and mobile viewport widths confirming `.tiers` is a real 2-column grid at 1280px and correctly collapses to 1 column at 420px.

**Verification, not just "it compiled":** every one of the 8 affected pages was rendered in real headless Chromium (not just brace-balance/syntax checked) -- confirmed `nav` computes `position:sticky`, body background resolves to the right `--bg` value, and each page's h1 font-size matches its page-specific rule, plus full-page screenshots reviewed for `index.html`, `terms.html` (amber callout), `404.html` (buttons/footer), and `pricing.html` (desktop + mobile grid). Consistent with this file's own standing CSS lesson: syntactically valid CSS can still be functionally wrong, and only a real render catches that class of bug -- borne out directly by the `@media` bug above.

New regression test: `tests/test_root_page_css_extraction.py` (23 checks) -- verifies every page's `<link>` resolves to a real file, guards against any future page re-declaring a rule that duplicates `css/legal-pages.css` (which would silently reintroduce the exact drift this cleanup removed), and specifically pins both of `pricing.html`'s `@media` blocks so the exact bug caught above can never silently regress.

Full regression status: `bash scripts/test_all.sh` -> **85/85 files pass** (was 84; one new test file).


## September 1, 2026 session summary (Claude, part 4) -- TODO #27 repo cleanup

Removed 17 stale/superseded root files -- all confirmed resolved or fully absorbed into this file before deleting (checked cross-references first; fixed one dangling pointer in this file's own Aug 25 entry that named a file being removed):

- `package-lock.json` -- empty stub (`"packages": {}`), no real dependencies; consistent with "no build step" (see Tech stack notes)
- `CLAUDE_START_HERE_SURVIVOR_MERGE.md` -- its P0 blocker (stub Survivor core) and its Section 7 live smoke-test checklist are both long since resolved/superseded by `REMAINING_TODO_2026-09-01.md` #3-#6/#8
- `DOMAIN_STRATEGY_HANDOFF_2026-08-27.md`, `NETWORK_BLOCK_HANDOFF_2026-08-27.md` -- both about the Talos "Gambling" categorization blocking Drew's work network; confirmed resolved in this file's own Aug 27/28 entries (Talos removed the category, access restored)
- All 9 `SESSION_SUMMARY_*.md` files (Aug 24 through Aug 30) -- individual dated session logs, fully superseded by this file's own chronological entries (that's the whole point of "CURRENT_STATE.md is the single source of truth, updated per delivery")
- `INTEGRATION_TEST_REPORT_2026-09-01.md`, `PICKGAUGE_CLAUDE_HANDOFF_2026-09-01.md`, `PICKGAUGE_CLAUDE_HANDOFF_2026-09-01-B.md` -- today's own session handoff docs, content already folded into this file's Sept 1 entries above

**NOT removed -- flagged for Drew instead of unilaterally deleting:**
- `cfb_ats_todo.md` -- very old tracker (references "77 automated checks," pre-Redis-CAS architecture, clearly stale on everything else in it) but contains an unresolved-looking `[ ] Rotate your credentials` item (CLERK_SECRET_KEY, ODDS_API_KEY, CFBD_API_KEY, an app secret exposed in a shared Word doc). No later doc confirms this was actually done. **Do not delete until Drew confirms those 4 credentials were actually rotated** -- silently deleting the only record of a security to-do is worse than leaving a stale file around.
- `handoff.md` (172K) and `chatgptnotes.md` -- the pre-`CURRENT_STATE.md` versioned dev log (v1-v26) and its own onboarding note. `NEW_SESSION_START_HERE.md` still explicitly points to `handoff.md` as "the historical/version log -- grep it for the detailed 'why' behind something." Removing both would orphan that pointer and lose "why" detail not necessarily preserved elsewhere. This is a real editorial call about how much history to keep, not a clear-cut staleness call -- left for Drew to decide rather than assumed.

**Kept, confirmed still-live (checked content, not just filename):** `PICKGAUGE_LAUNCH_CHECKLIST.md` is a genuinely different, still-accurate granular pre-launch checklist (Clerk/Redis/email/legal-specific items), not redundant with `REMAINING_TODO_2026-09-01.md`'s numbered list -- its open items agree with REMAINING_TODO's open items, not contradicting or duplicating. `NEW_SESSION_START_HERE.md` is explicitly load-bearing (part of every handoff zip per the project's own workflow convention) -- untouched.

Full regression status after cleanup: `bash scripts/test_all.sh` -> **84/84 files pass**, unaffected (none of the removed files were referenced by any code, test, or `vercel.json` route -- verified via grep across `api/`, `app/`, `tests/`, and config files before deleting, not just assumed).

**Also added: `.gitignore`.** There wasn't one in the repo at all, which is exactly why `__pycache__` kept needing manual removal between sessions (running the test suite regenerates `api/__pycache__/*.pyc` every time). Covers Python caches, `node_modules/`, OS cruft, local `.env*` files, and editor folders.


## September 1, 2026 session summary (Claude, part 3)

**TODO #15 (homepage Model # positioning) -- started, not finished.** Confirmed a real gap first: `index.html` (marketing homepage) never mentioned "PickGauge Model #" by name anywhere -- the entire hero and "How It Works" section only described the DIY build-your-own-composite workflow. `PickGauge Model #` is a separate, standalone curated preset (5 models + market blend, proprietary weights hidden -- see `app/js/model.js`'s `isPickGaugeModelActive()`/`PICKGAUGE_MODEL_PRESET`), distinct from the general user-configurable composite `methodology.html` describes. Proposed three positioning directions (add as a second path / flip the hero to lead with Model # / evidence-first once real 2026 ATS data exists); Drew chose the lowest-risk option -- keep the current DIY-led hero and headline untouched, add one sentence.

**Shipped:** one sentence appended to the hero paragraph in `index.html` (root marketing homepage, NOT `app/index.html` -- flagged explicitly since they share a filename pattern):
> "Don't want to pick weights yourself? Turn on **PickGauge Model #** instead — a pre-built blend of the top systems plus the market, ready with zero setup."

Verified `tests/test_sitemap_social_metadata.py` (the one test file that reads root `index.html`) still passes -- it only checks JSON-LD/meta tags, unaffected by hero prose. Full suite: 84/84.

**Still open from TODO #15:** the `SYS_MSG` mono line at the bottom of the hero, and the "How It Works" section further down the page, still don't mention Model # -- deliberately left alone this round since Drew only wanted the one sentence for now. Revisit if/when a bigger positioning pass (options 2 or 3 from the proposal) gets picked up.


## September 1, 2026 session summary (Claude, part 2)

**Survivor entry comparison: cards -> real tables (shipped).** Drew's feedback verbatim: "it doesnt show it in table form and it isnt very visual." The old Entry comparison section (History tab) was a grid of individual cards, one per entry -- readable for 2 entries, not genuinely comparable at a glance for 3+, and not a table. Replaced with two real HTML tables in `app/js/survivor-integration.js`:
- **Stats table** (`pgSurvivorEntryComparisonStatsTableHTML()`) -- one row per metric (Status, Record, Teams used, Projected survival, 4★+ left, Best assets), one column per entry, so you scan a row across every entry at once instead of reading N separate cards. Non-active entry column headers are clickable (preserves the old cards' "View history" action, now as a header click via the same `data-survivor-history-entry` handler).
- **Pick grid** (`pgSurvivorPickGridTableHTML()`) -- one row per week, one column per entry, cell = the team that entry picked that week. Colored using the SAME elite/strong/medium/risky tiers as the Season Board itself (`pgSurvivorCellClass`), so the visual language matches across the whole Survivor tool. **New: a diamond marker (◆) flags any team used by 2+ entries in the same week** -- this makes the exact overlap Portfolio Strategy's math is trying to reduce visible at a glance, not just as an aggregate "shared exposure" count.
- Both guard against the single-entry case with a plain one-line nudge ("Add another entry...") instead of an empty/broken table.
- CSS: removed the old `.survivor-entry-compare-grid`/`.survivor-entry-compare-card` rules entirely (confirmed zero remaining references anywhere in the codebase before removing), added `.survivor-compare-table`/`.survivor-pick-grid-table`/`.survivor-grid-pick` reusing the existing `--surv-elite/strong/medium/risky` CSS vars and the sticky-first-column pattern the Season Board already established.
- Tests: extended `tests/test_survivor_p3_18_22.mjs` (source-level assertions, matching this file's existing test convention) plus a new `tests/test_survivor_entry_comparison_tables.mjs` with genuine behavioral coverage -- extracts and actually runs both functions (not just regex-checks source), including real assertions on the shared-pick detection logic, tier-class boundaries, and the single-entry guard. 26/26 new checks, both existing and new files pass.

Full regression status: `bash scripts/test_all.sh` -> **84/84 files pass** (was 83; one new test file), including the real-browser E2E suite.


## September 1, 2026 session summary (Claude)

**Survivor P4 #25-26 (multi-entry diversification + at-least-one-survives probability):** integrated by ChatGPT into the full repo, independently re-verified in a fresh sandbox (all 82 non-browser test files pass, plus the previously-blocked `tests/test_e2e_ui_behaviors.py` -- 71/71 checks -- runs clean here with no sandbox restriction). **Deployed to production by Drew.** Full suite is 83/83 including the real-Chromium E2E run.

**Rotation numbers doc contradiction found and fixed:** the Sept 1 ChatGPT handoff claimed rotation-number matching was "still intentionally unresolved," directly contradicting this file's own Aug 27 entry below, which documents it as built, verified against real data, and shipped (`api/fetch_odds.py`'s `includeRotationNumbers`, `parse_pdf.py`'s rotation extraction, `pdf-import.js`'s `findBoardGameByRotation()`). Confirmed against actual source: the feature is real and working. The stale claim was not carried into this file -- noted here as a lesson: **a handoff doc's claims are not automatically trustworthy just because they're newer; always check source**, especially for anything that sounds like a reversal of previously-shipped work.

**#17 -- clearer pool-entry progress/status (shipped):** the Pools list previously showed only a raw entry count ("3 entries") with no indication of whether any entry was started, complete, or submitted -- you had to open the pool to find out. Added `poolEntryProgressHTML()` (`app/js/pool-contexts.js`), rendering per-entry Draft/Ready/Submitted chips with pick counts and submission timestamps directly in each pool row, reusing the existing `.entry-status-*` pill classes. Also added the same submission timestamp to the simpler entry-switcher list in `app/js/picks.js` (My Picks), which previously showed status without a "when." Tests: `tests/test_pools_page_logic.mjs`, 12 new checks, 95/95 total in that file.

**#18 -- My Numbers historical performance (shipped):** My Numbers previously had no historical tracking at all -- only a live per-cell "My edge" comparison against today's market. Added a full manual-grading performance tracker in `app/js/my-numbers.js`:
- Records now freeze `vegasAtEntry` (the market line at entry time) on every edit **until graded**, then lock forever -- a later market move or Model # change can never retroactively alter a graded week's edge. This mirrors the same "freeze the decision snapshot" principle `pickTeam()` already uses for real picks.
- `myNumbersRecordEdge()` computes edge from the frozen line, deliberately separate from the live `myNumbersEdge()` used by the board cell.
- `myNumbersGradableRecords()` surfaces past-week (never current-week) ungraded records with a real implied lean for manual W/L/P grading -- same toggle-button UX Results already uses for real picks (`setResult()`), not a new CFBD auto-grading pipeline. **Deliberate scope decision, flagged to Drew:** My Numbers apply to any board game regardless of pick/pool status, so there's no existing archive-on-close hook to attach automatic CFBD grading to the way real picks have via `api/grade_picks.py`. Manual grading was the lower-risk MVP; full CFBD auto-grading (matching final scores by `cfbdGameId`, already stored on each record) is a reasonable follow-up if Drew wants it, and would slot into the existing `myNumbersGradableRecords()`/`setMyNumbersResult()` interface without changing the frozen-input data model.
- `myNumbersPerformanceStats()` aggregates W-L-P record, win rate (pushes excluded from the decision denominator), average edge, and edge-size buckets -- bucket boundaries deliberately match `recordAnalytics()`'s own `edgeBuckets` in `app/js/record.js` so edge-size language means the same thing in both places.
- New "My Numbers performance" collapsible section added to the Edge Board UI (`app/index.html`, inside `#myNumbersPanel`): summary line, bucket table, grading list.
- Tests: `tests/test_my_numbers_logic.mjs`, 24 new checks, 49/49 total in that file.

**#16 -- My Numbers manual-entry UX refinement: eliminated from the TODO per Drew's call.** (Natural-language entry like "Georgia -7" already existed for CSV import; no further work needed there.)

Full regression status after this session: `bash scripts/test_all.sh` -> **83/83 files pass**, including the real-browser E2E suite.


## Guest Snapshot: odds cutoff had the SAME mistake ratings did, fixed (Aug 31, Claude), Drew's live report

Live-checked both `/api/public_snapshot` views directly against production after the ratings-cutoff fix above: `?view=ratings` came back real, correct data (`ready:true`, 138 real FBS teams + national averages, `asOfMinutes:201`) — that fix worked. `?view=odds` still came back `{"ready": false}`.

Root cause was the exact same mistake as the ratings bug, just in the sibling constant: `MAX_AGE_MINUTES_ODDS` had been set to 60 minutes, anchored to `api/fetch_odds.py`'s `SHARED_FRESH_MINUTES` (30min) — but that constant answers "should we spend a real paid Odds API call," not "is this cached data still usable at all." That file's own real worst-case-usability bound is `STALE_ODDS_MAX_MINUTES` = 6 hours. Given ratings was sitting at 201 minutes old with no active signed-in traffic, odds was almost certainly in the same multi-hour-but-still-real state — just older than a 60-minute cutoff that was never the right reference point to begin with.

**Fixed:** `MAX_AGE_MINUTES_ODDS` now set to 360 (matching `STALE_ODDS_MAX_MINUTES`). Also proactively fixed `MAX_AGE_MINUTES_PREDICTIONS` the same way (60×24×7, matching `fetch_predictions.py`'s real `STALE_FALLBACK_MAX_MINUTES` bound) even though that view isn't called by the guest UI yet — same category of bug, closed before it could recur if that view ever gets wired up later. `tests/test_public_snapshot.py`'s staleness-boundary checks use relative offsets from the constants themselves, so they kept passing unchanged; full suite 73/73.

**Lesson for next time a "not ready" cutoff gets added here:** anchor to the data source's own real worst-case usability bound (the constant that file uses for ITS OWN stale-serving fallback), never to a freshness window that exists for a totally different purpose (deciding whether to spend a real upstream API call) just because it's the first/only related constant sitting nearby in that file.

## Guest Snapshot: freshness-cutoff mismatch fixed (Aug 31, Claude), Drew's live report

After the header-chrome fix above, Drew still saw "Live data is warming up" on a real logged-out visit. Root cause: `api/public_snapshot.py` used one flat `MAX_AGE_MINUTES = 180` (3h) cutoff for every view, but the REAL underlying server cache freshness policy for CFBD ratings (`api/fetch_cfbd.py`'s `RATINGS_FRESH_SECONDS`) is **6 hours** — so ratings data that was still perfectly valid and being served to signed-in users could get rejected by this file's own stricter cutoff, purely because this file's threshold was tighter than the data source it was reading. Self-inflicted, not a data-availability problem.

**Fixed:** replaced the single `MAX_AGE_MINUTES` with three per-view constants, each set to roughly match (plus slack) the real freshness policy of the cache it reads:
- `MAX_AGE_MINUTES_ODDS = 60` (odds' own `SHARED_FRESH_MINUTES` is 30 — double it as slack)
- `MAX_AGE_MINUTES_PREDICTIONS = 180` (unused by the current guest UI's SP+-only composite, but kept correct)
- `MAX_AGE_MINUTES_RATINGS = 420` (7h — real server policy is 6h/360min)

`tests/test_public_snapshot.py` updated to reference the three new constant names (same staleness-boundary checks, still 34/34 passing). Full suite: 73/73.

**Also flagged as a likely contributing factor, not just the cutoff:** `fetchCfbdRatings()` only populates the ratings cache on a real SIGNED-IN page load — if genuinely nobody has been signed in and used the app since deploying this feature, the cache is empty (not stale, never populated), independent of any cutoff. Asked Drew to check `https://pickgauge.com/api/public_snapshot?view=odds` and `?view=ratings&year=2026` directly to distinguish "empty" from "was being rejected by the cutoff," and to sign into the real app once (auto-fetches ratings on load, no manual action needed) if it turns out to be genuinely empty.

## Guest Snapshot: header chrome deadlock fixed (Aug 31, Claude), Drew's live report

Drew hit `pickgauge.com/app` logged out (incognito) while the shared caches were still cold (correctly showed the "warming up" message from the earlier session's work) and reported the page "locks up." Root cause: `initGuestSnapshot()` only wired the Snapshot tab's own row-level controls and the nav tabs — two pieces of always-visible header chrome that `init()` (app/js/init.js) normally wires were left with no click handler at all in guest mode: the green **"Refresh lines"** button and the **"Overall board · Entry 1 · Week 0"** context-bar row. Neither did anything when clicked, which reads exactly like a lockup even though nothing had actually crashed.

**Fixed in `app/js/guest-snapshot.js`:**
- `#contextBarToggle` now routes to `guestRequireSignIn()` like every other account-specific control (pool/entry/week switching needs an account).
- `#refreshBtn` gets a genuinely useful guest-mode behavior instead: clicking it re-runs `_guestLoadData()` to re-check whether the public preview's shared cache has warmed up yet, with the same disable/"↻ Loading…" pattern the real `refreshLines()` (`app/js/odds.js`) uses. Deliberately NOT routed to sign-in — re-checking is a harmless, accountless action that spends none of Drew's paid Odds API quota (only reads `api/public_snapshot.py`'s own cache), so gating it would just be a needless dead end for someone who landed mid-warm-up.
- `initNavHamburger()`/`initNavTabsScrollHint()` now also run in guest mode (pure UI wiring, no account dependency) so the mobile tab menu actually opens.
- Separately, a real bug in the same area: the header's "not refreshed yet" / calls-left text was NEVER updating even after a successful guest data load, because `refreshMeta()` (`app/js/odds.js`) was never called from the guest path, and `state.lastRefresh` was never set from the odds response. Both fixed -- `_guestLoadData()` now sets `state.lastRefresh` from `/api/public_snapshot`'s own `lastRefresh` field and calls `refreshMeta()` on a successful load. `reqLeft`/calls-left correctly stays "—" for a guest either way, since the public endpoint deliberately never exposes that (unchanged, intentional).

**Verified live** (Playwright, same technique as the original guest-mode delivery): clicking the context-bar row opens sign-in; clicking "Refresh lines" while the mocked endpoint returns `ready:false` then flipping it to `ready:true` and clicking again shows the header updating to a real "updated H:MM" time and the row rendering, button correctly re-enabling itself afterward, zero page errors. Full suite still 73/73 (frontend-only change, no existing test file needed updates).

## Team-name matching bug fixed: FCS schools were silently borrowing a real FBS team's SP+ rating (Aug 31, Claude)

Drew flagged a live screenshot: three Week 1 buy games — North Carolina A&T @ Georgia State, Houston Baptist @ Rice, Arkansas Pine Bluff @ Missouri — showed a 40-60pt SP+/Vegas disagreement, including a full sign reversal (the model favoring the massive FCS underdog over the real favorite), while every FBS-vs-FBS game on the same board showed sane 7-10pt disagreement.

**Root cause, confirmed against CFBD's own live `/ratings/sp?year=2026` response** (Drew ran it directly, pasted the result): CFBD's SP+ table genuinely does not rate any of the three FCS schools — expected, SP+ is FBS-only. So the numbers shown for those games weren't "CFBD's number for this team," they were a **different team's real rating, silently attached to the wrong game** by `teamMatch()` (`app/js/pdf-import.js` / `api/grade_picks.py`'s `team_match()` — the shared token-based matcher used everywhere in this app: grading, PDF import, logos, predictions, and now CFBD ratings).

The mechanism: `teamMatch()` strips `&` before tokenizing, so "North Carolina A&T" tokenizes to `north carolina at` — one leftover token, `at`, which wasn't in `SIGNIFICANT_TOKENS` (the list of trailing words that block an otherwise-valid token-prefix match). So "North Carolina A&T" silently prefix-matched real FBS **North Carolina**, and inherited ITS SP+ rating. Same exact shape for "Houston Baptist" → real FBS **Houston** (`baptist` unprotected) and "Arkansas Pine Bluff" → real FBS **Arkansas** (`pine`/`bluff` unprotected).

**Fix:** added `at`, `baptist`, `pine`, `bluff` to `SIGNIFICANT_TOKENS` in both copies — `app/js/pdf-import.js` and `api/grade_picks.py` (the two are deliberately duplicated per-language; kept in sync exactly as the existing Texas/Nevada/Florida `SIGNIFICANT_TOKENS` entries already were). Swept for the same "real short FBS name + unprotected trailing FCS-school modifier" pattern against every other common FCS naming convention (X State, X A&M, X Southern, X Central, X Christian) — all already protected by existing entries; these three were the only live gaps found.

**Test coverage:** `tests/test_team_match_parity.py` (the existing cross-language JS/Python drift + collision-corpus test) gained the three real cases as permanent regression entries, run through the REAL unmodified `teamMatch()`/`team_match()` functions in both languages, not reimplemented. All 85 checks pass, including the file's own existing direct `SIGNIFICANT_TOKENS` set-equality check between the two files (confirms the two copies didn't just individually get fixed, they're still byte-identical to each other). Full suite: **73/73 files passing** (`--fast`).

**Scope of the actual impact, for context:** this matcher is shared well beyond CFBD ratings — grading (`api/grade_picks.py`), Powers PDF import, prediction-tracker merging, and team logos all use the same function. A wrong SP+ number was the symptom that surfaced it, but the same collision shape could in principle have silently affected any of those other paths for these three specific team names too (not confirmed to have actually happened elsewhere — just the same latent risk, now closed everywhere at once since it's one shared list per language).

This is the SINGLE source of truth for what is true in the current codebase and what's next — not a separate ChatGPT/Claude roadmap doc on either side. Whichever AI session does real work (fixes, features, or reprioritization) updates this file as part of delivering the change, same as this file itself is exempt from Drew's "don't touch `handoff.md` unless asked" rule. Two competing status documents WILL drift — see "Cross-AI corrections log" below for concrete examples that already happened, more than once. `handoff.md` remains the historical/version log; use this file and `NEW_SESSION_START_HERE.md` for current priorities.

## Guest (logged-out) Snapshot preview — FRONTEND SHIPPED, live-browser smoke-tested (Aug 31, Claude), Option 1 per Drew's call

Closes the "next session should start here" item from earlier this session. Drew chose **Option 1** (a separate guest-only path, NOT a rework of `bootstrap()`'s real signed-in flow) and specified the default composite should be **SP+ only**, not Sagarin+SP+ — narrower than this app's own real new-account default, on purpose, since this is a teaser.

**What shipped — new `app/js/guest-snapshot.js` + a real (not just structural) change to `bootstrap()` in `app/js/init.js`:**
- `bootstrap()` no longer shows the classic blocking `#signInGate` the instant Clerk reports no user. It shows `#appRoot` and calls `initGuestSnapshot()` instead, with a fallback to the old blocking-gate behavior if `guest-snapshot.js` somehow failed to load. A new `__pgInited` flag (not `#appRoot`'s visibility, which is now `block` in both guest and signed-in states) tracks whether the real signed-in `init()` has actually run — the Clerk `addListener` callback uses that flag instead of the old `root.style.display` check to decide whether a `user` event is a genuine new sign-in.
- `initGuestSnapshot()` reuses the app's REAL rendering pipeline — `buildGames()`, `resolveBookLines()`, `applyCfbdDerivedPredictions()`, `renderSnapshot()` (`app/js/board.js` / `app/js/cfbd-insights.js`) — fed by `/api/public_snapshot`'s odds + ratings views instead of the authenticated endpoints. This is deliberately NOT a duplicated parallel renderer: a guest sees the exact same Snapshot tab, same methodology, same Cover %/Edge math a signed-in user does.
- **SP+-only composite, done safely**: `state.enabledSystems` is temporarily forced to `["cfbdsp"]` in memory only — never `save()`d, never touches `localStorage`. `guestTeardown()` restores whatever was really there (a genuinely fresh browser's own new-account default, or a returning-but-currently-signed-out user's real saved selection) the instant a real sign-in is detected, **before** `init()` ever runs — so a genuinely new account still gets this app's real new-account default (Sagarin + SP+) rather than silently inheriting the guest preview's narrower composite.
- **Never fabricates data**: if `/api/public_snapshot` reports `ready:false` for either view (empty/stale shared cache), the guest Snapshot shows an honest "Live data is warming up... check back in a few minutes, or sign in for the full board" message — deliberately does NOT fall through to `buildGames()`'s own demo-data path (which would seed fake `DEMO` games; showing fabricated numbers to a logged-out visitor would undercut the entire pitch).
- **Every "I want more" moment routes to Clerk sign-in**, per Drew's explicit call: every other nav tab (Edge board/My picks/Pools/Survivor/Results/Account/Settings), every row-level action (`[data-snap-pick]`, `[data-snap-shortlist]`, `[data-snap-jump]`, the export button, "see full board"), and the Cover%/Raw-Edge + filter-pill toggles all get their `onclick` replaced with `guestRequireSignIn()` (same classic `#signInGate` + `Clerk.mountSignIn()` call `bootstrap()` already used) rather than performing any real action. **Left deliberately un-gated:** expanding a row's own detail panel (`[data-snap-expand]`) — pure display, touches no account state, and the more of the real product a guest can genuinely explore before signing up, the better the pitch.
- Setup-checklist/pool-import CTA chrome (`#setupNotice`, `#poolSetupCta`) is hidden in guest mode — none of it is actionable without an account and would just read as broken UI.
- **NOT built this round, explicitly deferred:** the Prediction Systems panel living on the Edge Board tab can't be shown "visible but disabled" without a Board-tab guest path — out of scope now that Board tab correctly routes straight to sign-in. Revisit if Drew wants that specific polish later.

**Verification — live headless-browser smoke test (Playwright/Chromium, real render, not just source-text/unit checks)**, following this project's own established standard for frontend changes: a self-contained local static server + mocked `window.Clerk` (no user) + mocked `/api/public_snapshot` responses, confirmed all of:
- `#appRoot` visible / `#signInGate` hidden on a fresh logged-out load; Snapshot tab active with 2 real synthetic games rendered (team names present).
- The rendered Model # matches the real SP+-derived math by hand (`awayRating − homeRating − 2.6` HFA: `10 − 24 − 2.6 = -16.6`, present in the rendered row) — confirms the composite is genuinely SP+-only, computed through the real `cfbdDerivedSpread()`/`weightedModel()` path, not a hardcoded stand-in.
- Clicking the Edge Board tab does NOT switch tabs; instead `#signInGate` becomes visible and `Clerk.mountSignIn()` fires exactly once.
- Clicking a row's pick button does NOT mutate any pick; `Clerk.mountSignIn()` fires instead.
- **`localStorage` has zero keys after the full guest session** (load, render, tab-click-to-gate, pick-click-to-gate) — directly confirms `save()` is never called anywhere in the guest path, the core safety property this whole design depends on.
- A separate run with both `/api/public_snapshot` views returning `{"ready": false}` confirms zero rows render, the honest "warming up" message shows, and there are no page errors — the demo-data fallback is genuinely never reached.
- No `pageerror` exceptions in either run (only expected CORS/network noise from Clerk's real script URLs being unreachable from the sandboxed test origin, and an unrelated 501 from the plain Python test server not supporting POST — neither is guest-snapshot-related).

Full automated suite still **73/73 files passing** (`--fast`) — this change is additive frontend-only, no existing test files needed updates. **No new permanent automated test file was added for this frontend piece** (the existing `tests/test_*.mjs` harness pattern runs functions in a bare Node `vm` context without a real DOM/fetch/Clerk, which is exactly what this feature's real risk surface — actual render + actual click routing + actual localStorage behavior — needed a live browser to catch; the Playwright script used for this session's verification was a one-off, following the same pattern as this project's existing `tests/_render_*.py` manual-verification scripts, not added to the permanent suite). **Worth a follow-up:** decide whether a permanent Playwright regression test for the guest flow belongs in `tests/test_e2e_ui_behaviors.py` or a new dedicated file, so this doesn't silently regress on some future unrelated `board.js`/`init.js` change.

**Not yet done:** a real live-deployment smoke test (Vercel Preview or prod, real Clerk, real `/api/public_snapshot` hitting real Redis) — this session's verification was a local static-file render with mocked auth/data, same "logic verified, live unverified" gap this project already tracks elsewhere for other features.

## Public/unauthenticated Snapshot preview — BACKEND, shipped (Aug 31, Claude). Frontend wiring is in the entry above this one (same day, same session).

Marketing goal driving this: Twitter traffic should be able to click straight into a real Snapshot view and see real model-vs-market edges before ever hitting Clerk's sign-in wall — the current app gates 100% of the UI (including Snapshot) behind `bootstrap()` in `app/js/init.js`, which shows `#signInGate` and never calls `init()` at all until `window.Clerk.user` exists. Drew confirmed the intended shape in conversation: Snapshot renders logged-out with the fixed default composite (Sagarin + SP+, matching this app's own real new-account default) and capped/teased rows; every other tab, and every "I want more" moment on Snapshot itself (locked rows, the Prediction Systems panel), routes to Clerk sign-in; Prediction Systems should render **visible but disabled** while logged out rather than hidden, to sell the product's depth.

**What's actually done this session — new `/api/public_snapshot.py`:**
- Unauthenticated (no `verify_user()` gate at all), GET-only, `?view=odds|predictions|ratings` (a `year` param on the ratings view, defaults to the current year).
- **Read-only by construction, not just by convention** — it never calls The Odds API, thepredictiontracker.com, or CFBD directly; it only reads the same three shared Redis caches `fetch_odds.py`/`fetch_predictions.py`/`fetch_cfbd.py`'s ratings view already populate on ordinary signed-in usage (`edge_board_shared_odds`, `edge_board_shared_predictions`, `pickgauge_cfbd_ratings_v1:{year}`). Costs one Redis GET per call regardless of traffic volume; can never spend any of Drew's paid upstream quota. `tests/test_public_snapshot.py` pins this with a structural check that the file contains no request construction referencing any of the three provider domains and never calls `_kv_set` (read-only).
- **Trims each view down to the public default composite only**, since this data is now reachable by anyone, not just a signed-in user: odds drops `reqLeft` (Drew's paid-quota count) and `preKickLines` (grading/CLV internals) entirely; predictions filters every game's `systems` dict down to ONLY `sag`, drops a game entirely if it has no `sag` value, and hardcodes the response's `systems` list to `["sag"]` rather than exposing the real ~40-system aggregated dataset; ratings filters every team down to ONLY `{team, conference, sp}` (needed client-side for the existing `cfbdDerivedSpread()` SP+ derivation), dropping core/srs/elo/fpi entirely.
- **Never serves fabricated or stale data**: any view responds `{"ready": false}` (not an error, not placeholder/demo data) when its cache is empty, when trimming leaves zero games/teams, or when the cached data is older than `MAX_AGE_MINUTES` (180) — a logged-out visitor has no refresh control, so honest "not ready" beats quietly serving old lines.
- Per-IP rate limiting (`x-forwarded-for`, generous — 60/60s), fails OPEN if Redis/eval itself is unreachable (a Redis hiccup degrades to "no extra throttling," not "public preview goes down"). `Cache-Control: public, max-age=60, s-maxage=60` (deliberately different from every authenticated endpoint's `private, no-store` — this response is identical for every anonymous caller and cheap to recompute, so a real CDN/browser cache should absorb a traffic spike rather than every hit reaching the function).
- `vercel.json`: added `api/public_snapshot.py` with `maxDuration: 10` (Redis-read-only, doesn't need the 15–30s upstream-fetch budget the other data endpoints get). No CSP change needed — same-origin `/api/*`, already covered by the existing `connect-src 'self'`.
- New `tests/test_public_snapshot.py`, 34/34 checks passing: each view's ready/not-ready/trimming/staleness logic directly, `do_GET()`'s view dispatch + 400 on missing/unrecognized view + 429 on rate-limit via a fake-handler harness (same technique `test_cfbd_insights.py` already uses), `client_ip()`'s `x-forwarded-for` parsing, and the structural provider/read-only/cache-header checks above. Full suite: **73/73 files passing** (`--fast`).

**NOT done yet — this is backend-only, deliberately not wired to anything frontend in this session:**
- `bootstrap()`/`init.js` still gates 100% of the app behind Clerk sign-in — nothing currently calls this new endpoint from the browser. The Snapshot tab does not yet render logged-out.
- No guest-mode app shell exists: `switchTab()`/`renderSnapshot()`/`computeSnapshotScores()` (`app/js/board.js`) and everything they touch currently assume a real synced `state` object (from `sync.js`'s authenticated pull) exists before they're called. Making Snapshot render logged-out means either building a separate minimal guest-state path feeding the SAME render functions with public-endpoint data + the fixed default composite, or restructuring `bootstrap()` itself so `init()` can run in a real "no account, public data only" mode — this is a genuine architecture decision (touches the core production auth bootstrap flow), not a small addition, and hasn't been made yet.
- Every other tab prompting Clerk sign-in on click, locked rows past the cap, and the Prediction Systems panel's visible-but-disabled logged-out state are all still to build once the guest-mode shell above exists.
- **Next session should start here**, with Drew's explicit sign-off on which bootstrap approach to take before writing it, given it changes the app's core entry flow.

## Survivor merge — P0 stub-core blocker RESOLVED (Aug 31, Claude)

Closes the P0 blocker `CLAUDE_START_HERE_SURVIVOR_MERGE.md` flagged: the 7 `app/survivor-core/*` files in the merged worktree were fixture stubs (`buildSeasonPlan()`→`{picks:[]}`, `survivorScore()`→constant `90`, `evaluateEntryStatus()`→always `{status:'alive'}`, schedules built from `Array.from({length:N},()=>({teams:['A','B']}))`). This is what was making the Season Board fail to populate: `data/pool-teams.js`'s stub `POOL_DEFINITIONS` gave SEC/Big Ten exactly one fake team each (`'A'`/`'B'`), so the board rendered a single dead row with no real matchups ever matching it.

Drew supplied the real standalone source (`cfb-survivor-multipool-v1.23.4.zip`). The 7 files were copied byte-for-byte into `app/survivor-core/` (`js/survivor-score.js`, `js/results.js`, `data/pool-schedule-utils.js`, `data/{sec,bigten,kelly}-pool-schedule-2026.js`, `data/pool-teams.js`), verified against every hard number in the handoff doc before and after wiring: SEC 106 games, Big Ten 122 games (including UMass @ Rutgers Week 1), Kelly 321 games / 114 teams / 642 selectable sides, `SURVIVOR_SCORE_WEIGHTS` = `{safety:0.85, preservation:0.08, scarcity:0.07}`, real exact min-cost-max-flow optimizer (`buildSeasonPlan()` returns `optimizer:'exact-assignment'`, `optimality:'exact'`), real `evaluateEntryStatus()` state machine (PICK NEEDED/ALIVE/ELIMINATED/MISSING PICK/etc, not a constant).

**One real integration bug found and fixed during wiring, not just a file swap:** the real `applySecPoolSchedule`/`applyBigTenPoolSchedule`/`applyKellyPoolSchedule` functions are `(games, year)` — they need the year to resolve the pool's authoritative schedule; called with just `(games)` they silently return `authoritative:false` and pass every candidate game through unfiltered (same failure shape as the stub, just harder to notice because it'd show real teams instead of `A`/`B`). `app/js/survivor-data-adapter.js`'s `pgsApplyAuthoritativeSchedule()` now takes and forwards an explicit `season` param (`2026`) and throws if the real matcher itself reports `authoritative:false`, rather than silently degrading to "no filter." `core-manifest.js`'s `arrayExport`/`exports` metadata also corrected — it named a `GAMES` export that never existed in the real files (`SEC_POOL_SCHEDULE_2026` etc. is the real name); this wasn't read anywhere at runtime so it didn't cause the bug, but was wrong documentation.

Verified end-to-end (not just import-and-hope) with a Node `vm` harness that runs the *actual* `survivor-data-adapter.js` against the *actual* real core modules with synthetic CFBD candidate games, for all three pools: SEC matches exactly 106/106 and excludes a deliberately-injected non-listed noise game; Big Ten correctly reports `canonicalMatched:121` + `upstreamFallbackCount:1` when CFBD is missing Rutgers–UMass, matching the fallback-supplement logic already in the merged adapter; Kelly yields exactly 114 unique teams / 642 sides; `buildSeasonPlan()` returns a real non-empty exact plan; `evaluateEntryStatus()` returns real per-scenario statuses.

New permanent regression file `tests/test_survivor_core_not_stub.mjs` — the Section-4 stub-detection tests the handoff doc asked for. Confirmed it actually catches the regression: re-ran it against copies of the old stub files and it fails hard (not silently) on the first assertion. 26/26 checks pass against the real files. Full suite: **72/72 files passing** (`--fast`, i.e. excluding the Playwright browser E2E file, which needs a real browser environment not exercised in this session).

**Not yet done:** the live smoke-test checklist in `CLAUDE_START_HERE_SURVIVOR_MERGE.md` Section 7 (real signed-in browser session against Vercel Preview/prod — Data Health counts, Season Plan rendering, mobile overflow, Clerk/PDF/Analytics regressions) still needs to run before this is deploy-ready. This session's verification was direct-module-level (real functions, synthetic CFBD data), not a live browser render.

## Survivor Season Board visual redesign (Aug 31, Claude), Drew's explicit call

Drew compared the now-working PickGauge Season Board against the original standalone CFB-Survivor product's own board and asked for it to look more like the original — color-coded win-probability tiers, team logo badges, cleaner sticky header. Ported the actual design language from the standalone repo's real `js/views/season-board.js` + `css/board-rankings.css` (not reinvented from the screenshot), adapted to PickGauge's own CSS tokens (`--green`/`--red`/`--amber`/`--ink`/`--muted`/`--line`) instead of importing the standalone's separate color system wholesale.

`app/js/survivor-integration.js`'s `pgSurvivorRenderBoard()`: added a color-tier legend (90%+/80–89%/70–79%/<70%) next to the view header; each game cell now gets a colored top-border + tinted gradient background matching its probability tier (green/blue/amber/red, reusing the existing `pgSurvivorCellClass()` thresholds — those were already correct, only the CSS was flat pastel before); cells show a state badge (PICK/OPP PICK/USED/W-L result) via new `pgSurvivorCellStateLabel()`, matching the standalone's own priority order (result > pick > opponent's pick > used); team rows get a logo badge via new `pgSurvivorTeamLogo()` (reuses PickGauge's existing `cfbdTeamForName()` team-identity lookup — same one `survivor-data-adapter.js` already used — falling back to a colored initials circle via `pgSurvivorTeamInitials()` when no logo resolves); the focused/viewing week column gets a highlighted header + tinted cells.

`app/css/survivor-integration.css`: new `--surv-elite/strong/medium/risky` tier colors (green/blue/amber/red) plus tint variants for cell backgrounds, `.survivor-legend`, `.survivor-team-avatar` (logo image or initials-circle fallback), sticky table header (`position:sticky;top:0`) in addition to the existing sticky-left team column, restyled `.survivor-game-cell`/`.survivor-cell-*` to match the reference's typography/spacing.

Full suite still 72/72 after the change (no test coverage exists yet for the board's rendered HTML/CSS specifically — this was a visual-only change verified via direct Node execution of the two new pure helper functions, `pgSurvivorCellClass()`/`pgSurvivorTeamInitials()`, plus a syntax/brace-balance check on both changed files). **Not yet verified in a real browser** — same outstanding gap as the rest of Survivor: needs the Section 7 live smoke test on a Vercel Preview.

**Follow-up same day: real bug found and fixed after Drew reported the board still looked broken.** The claim above ("verified via syntax/brace-balance check") was insufficient — brace-balance passing doesn't mean the CSS actually renders correctly, and it didn't. Root cause: several `str_replace` edits to `app/css/survivor-integration.css` inserted literal two-character `\n` (backslash + letter n) between rules instead of real newline bytes, at 15 separate rule boundaries. Outside a CSS string, `\n` is parsed as an escaped identifier character, so `}\n.survivor-game-cell{...}` was actually being parsed as `}n.survivor-game-cell{...}` — a selector requiring a literal `<n>` element, which doesn't exist, so the rule silently matched nothing. This is why every color tier, the flex layout, sticky header, and team avatar styling for the game cells never applied, even though the CSS file loaded fine and other untouched rules in the same file worked normally.

Caught by actually rendering the compiled HTML+CSS in a headless Chromium instance (Playwright, already available in this sandbox at `/opt/pw-browsers`) and reading real `getComputedStyle()` output rather than reasoning about the CSS text — `border-top` was resolving to the browser's UA default button style, not the authored rule, which is what led to inspecting `document.styleSheets[0].cssRules` and finding the literal escaped-newline corruption at the byte level. Fixed by replacing all 15 literal `\n` byte-pairs with real `0x0A` newlines (`app/css/survivor-integration.css`). Re-verified: `getComputedStyle()` on `.survivor-game-cell.elite` now correctly reports `display:flex`, `width:120px`, and the green tier border — confirmed visually with a full-board screenshot rendered from the actual real files (not a hand-rebuilt approximation), matching the reference design's color tiers, team badges, and PICK/OPP PICK/USED states. Full suite still 72/72 (CSS-only fix, no JS touched). **Lesson for future CSS edits to this file:** verify visually with a real headless-browser render before calling a CSS change done, not just a text-level syntax check — a brace-balanced file can still be functionally inert.

## Survivor Season Board UX fixes (Aug 31, Claude), Drew's explicit call

Three usability gaps Drew flagged after the visual redesign:

1. **Clicking an already-picked team did nothing** (no way to unselect from the board). `pgSurvivorAddPick()` in `app/js/survivor-integration.js` now checks `selected.includes(m.team)` first and calls the existing `pgSurvivorRemovePick(m.week, m.team)` instead of no-op-returning — same removal path the My Picks chip's × button already used, so Kelly's multi-pick-per-week removal (drop just that one team, keep the other) and single-pick removal both work identically from the board. Applies to the Week Rankings "Use" button too, since it shares the same click handler.
2. **No way to sort the team column A–Z or by Future Value.** Added `pgSurvivorSortedTeams()` plus `pgSurvivorSetTeamSortMode()`/`pgSurvivorBoardSort()` (per-pool sort state in `pgSurvivorRuntime`, resets on reload — not synced, this is view-only). Future Value sorts on the real continuous `teamFutureValueRating().index` from the real optimizer (0–1, matches the standalone product's own `sortTeamsByFutureValue()` approach), not the bucketed half-star display value. Two small buttons in the team-column header (A–Z / FV ★), matching the standalone product's own control.
3. **No way to sort a weekly column by win probability.** `pgSurvivorToggleWeekSort(week)` — clicking a week header sorts all rows by that week's own win probability (teams without a game that week sort last), clicking the same week again clears it and falls back to whatever team-sort mode (A–Z/FV) was active underneath. Sort/focus column both get a highlighted header + tinted cells so it's clear which week is driving the current order.

`app/css/survivor-integration.css`: new `.survivor-team-col-head`/`.survivor-sort-btn`/`.survivor-week-sort-btn`/`.survivor-sort-arrow`/`.survivor-sorted-col` rules, appended as a single continuous line matching the rest of the file's existing convention — **deliberately avoided embedding any `\n` escape sequences in the edit this time**, after the literal-backslash-n corruption bug from the redesign pass (see above). Verified with the same Playwright/Chromium `getComputedStyle()` render check, not just a syntax check.

All three behaviors verified by directly executing the real `survivor-integration.js` functions in a Node `vm` context against synthetic matchup/pick data (not just rendering HTML): alpha sort, Future-Value sort ordering by the real `.index` field, week-probability sort ordering (including a team with no game that week sorting last), week-sort toggle-off restoring the prior team-sort mode, and pick→click-again→removed round-tripping through `pgSurvivorSelectedPicks()`. Full suite still 72/72.

## Survivor Data Health card collapsed by default (Aug 31, Claude), Drew's explicit call

Drew asked whether Data Health should collapse on mobile; follow-up call was to collapse it everywhere, not just mobile. Pool/Entry/Week selector card stays expanded always — it's the primary control surface, needed on every visit, and already minimal (three dropdowns + a button).

`app/js/survivor-integration.js`: `pgSurvivorRenderHealth()` now renders a single always-visible summary line (`Data health   Schedule 106/106 ✓ · Probabilities 91% modeled  ›`) inside a `<button data-survivor-health-toggle>`, collapsed by default (`pgSurvivorHealthOpen()`/`pgSurvivorRuntime.healthOpenByPool`, same per-pool runtime-only pattern as the existing "Why this pick?" toggle — resets on reload, not synced). Clicking expands the full breakdown (Schedule/CFBD IDs/Probabilities-by-source/Lines/Results) below the summary line. The loading and error states are NOT collapsible — always shown in full, since those need to be seen immediately, not opted into.

`app/css/survivor-integration.css`: new `.survivor-health-toggle`/`.survivor-health-summary`/`.survivor-health-chevron`/`.survivor-health-details` rules; the existing mobile stacked-grid fix (`@media(max-width:620px)`, added earlier so the WP/SP+/Line breakdown didn't require horizontal swiping) now targets `.survivor-health-details` instead of the old flat `.survivor-health-strip` children, since that content only exists in the DOM once expanded — the readability fix itself is unchanged, just re-scoped to where the content now lives.

Verified two ways: a real Playwright/Chromium screenshot of both collapsed and expanded states at desktop (700px) and mobile (390px) width, and a Node `vm` check running the actual `pgSurvivorRenderHealth()` against synthetic pool data confirming the details block is genuinely absent from the rendered HTML by default (not just visually hidden) and appears correctly once `healthOpenByPool` is toggled. Full suite still 72/72.

## Current architecture

- Static frontend: `app/index.html` + plain global-scope files under `app/js/` and `app/data/`; no build step or bundler.
- Vercel Python serverless APIs under `api/`.
- Clerk authentication.
- Upstash Redis for private per-user state and three isolated shared domains: odds, predictions, and pool templates.
- GitHub Actions runs `scripts/test_all.sh` on pushes/PRs.
- Python runtime dependencies are explicitly pinned in `requirements.txt`; as of Aug 26 the repo pins the user-uploaded PDF path to `pdfplumber==0.11.10` and Clerk JWT verification to `PyJWT[crypto]==2.13.0`.

## Reliability/data-integrity work already complete

- Private sync uses atomic Redis CAS and server revisions; browser clocks are no longer the authority for private-tier freshness.
- Successful odds/prediction fetches fall back to the fresh endpoint response if shared-cache persistence/pull fails.
- Pick-time decision snapshots freeze what PickGauge knew when the pick was made, including Model #, raw and picked-side Edge, Cover %, EV, key-number signal, enabled model inputs/weights, selected book, and timestamp.
- True pre-kick line history is retained separately from the live odds feed, so the last observed pre-kick line survives after an event disappears from `/odds`.
- Archive CLV uses the pick's frozen sportsbook preference and the retained pre-kick line; missing closes remain null instead of being fabricated from archive-time data.
- Odds freshness tightens automatically from 30 minutes to 15/10/5 minutes as kickoff approaches.
- Backup import performs a real account-level restore against the current server revision rather than only replacing localStorage.
- Manual grading is rate-limited; request/body limits are enforced; self-service PickGauge-data deletion exists.
- Raw internal exceptions and raw third-party CFBD/Odds error bodies are not returned to browsers.
- Shared pool publishing is admin-only and now explicitly behaves as a one-time **template** lifecycle: Publish template / Unpublish template. Unpublishing never deletes recipients' already-created private pools or picks.
- **Canonical CFBD identity layer is implemented:** a shared six-hour server cache combines `/teams/fbs` and the season `/games` schedule, runtime games receive `cfbdGameId` plus canonical home/away team IDs/names/conferences/season/week, picks freeze those IDs, and saved-pick key migration prefers `cfbdGameId` before name matching. The Odds API `providerGameId` remains a separate namespace.
- **CFBD live/final game status is implemented:** `/scoreboard` is proxied through a 60-second shared cache and the client refreshes it about every 90 seconds while visible. My Picks shows scheduled/live/final scores plus the pick's current ATS position. The persistent grader now prefers canonical `cfbdGameId`/`cfbdPickedTeamId` final scores and falls back to The Odds API for legacy picks.
- **CFBD power-rating context is implemented:** CORE, SP+, FPI, Elo and SRS are fetched through a six-hour shared cache, cold refreshes run concurrently, and Snapshot game details show the available ratings side by side. They are explicitly informational and do not change Model #, Edge, Cover %, EV or Model Agreement — **except SP+ and CORE specifically, which as of Aug 19 ALSO exist as real, toggleable prediction-system inputs** (`cfbdsp`/`cfbdcore` in the Prediction Systems checklist, right alongside BP/Comp/Sagarin/every thepredictiontracker.com system) — a deliberate, explicit exception to the "context only" rule every other CFBD feature follows, confirmed with Drew before building. Since SP+/CORE are team RATINGS, not per-game predicted spreads, a derived spread is computed client-side (`cfbdDerivedSpread()`/`applyCfbdDerivedPredictions()`, `app/js/cfbd-insights.js`): `awayRating − homeRating − 2.6`, home-team-spread convention, matching every other system. **The 2.6-point home-field-advantage constant is real, sourced research** (a multi-season empirical HFA study puts "true" CFB HFA around 2.6, vs. oddsmakers' own typical convention of ~3.0) — Drew explicitly confirmed 2.6 over the alternative before this was built, not a number either AI picked alone. Known, documented simplification: HFA genuinely varies by team (roughly 0.2–5.7 points across real programs in a 2025 dataset) — a flat constant runs a bit generous for weak home fields and a bit stingy for elite ones, same category of simplification every other fixed-methodology system here already represents. `applyCfbdDerivedPredictions()` merges into `predByKey` rather than replacing it, so it never clobbers a real thepredictiontracker.com system already present for the same game; wired through every existing `applyPredictions()` call site via one shared exit point (`_finishApplyPredictions()`) rather than touching each of the ~10 call sites individually, and re-fires from `_cfbdRenderConsumers()` once ratings finish their (asynchronous, later-than-first-render) load.
- **Matchup Intelligence v2 is implemented (Aug 30, ChatGPT):** real 2026 Week 0 data exposed several semantics/UX issues in v1, all now corrected. `/api/fetch_cfbd?view=advanced` fetches CFBD's documented `/stats/season/advanced` schema with `excludeGarbageTime=true`, merges both `classification=fbs` and `classification=fcs` coverage, retains offense/defense play counts for early-season sample disclosure, and keeps **offense.havoc** (havoc allowed/suffered) as well as **defense.havoc** (havoc generated). The client compares havoc inside each offense-vs-defense matchup instead of the old defense-vs-defense standalone row. The table uses compact school abbreviations in value headers, explicit produced/allowed semantics, a numeric Difference column on desktop, and **Matchup lean** language instead of presenting heuristic thresholds as a hard "Edge"; the Difference column hides on mobile to preserve width. A season/sample note shows garbage-time exclusion and each team's offensive-play count, with a small-sample warning under 200 plays. **Aug 30 follow-up:** every raw matchup value now also gets a compact **classification-aware rank + percentile** (`#rank/teams with data · percentile`) calculated from the same loaded CFBD advanced dataset. FBS and FCS are ranked separately, offense/defense directionality is handled correctly (including reversed havoc semantics), and the denominator explicitly means teams with that metric currently available — important in Week 0/1 when not every team has played yet. **Completed games deliberately hide the season matchup table** because CFBD's cumulative season aggregate then includes that same game and can become a hindsight mirror (exactly what the first Jacksonville State–North Dakota State screenshot showed with one-game samples); the panel instead directs users to Results → Why? for the true postgame box-score breakdown. Missing one-team/FCS coverage renders an explicit explanation instead of silently disappearing. CFBD's populated 2026 field shape has been verified against live data and the current official schema; the old "field names unconfirmed" caveat is closed. Context only — still does not change Model #, Edge, Cover %, EV or Model Agreement.
- **Advanced postgame box-score analysis is implemented ("why did this pick win or lose"):** each graded pick in Results with a canonical CFBD identity gets a "Why?" toggle that lazily fetches `/api/fetch_cfbd?view=boxscore&id={cfbdGameId}` (CFBD's `/game/box/advanced`, 24h cache since a finished game's box score is immutable). **Aug 30 follow-up:** the panel is now an explanation rather than only a stat table. It shows the final score, the user's archived ATS pick/line/W-L-P and computed cover margin, an **Overall read** (which team led more tracked categories), and the **three largest statistical separators** before the full advanced box-score comparison. Separator ordering normalizes unlike units with simple football-scale denominators and is explicitly labeled descriptive/not causal — it never feeds Model # or rewrites the grade. The full table now includes success rate, PPA/play, explosiveness, scoring-opportunity volume, points per scoring opportunity, defensive havoc, and turnovers so both getting into scoring position and finishing those drives are visible. Built with meaningfully stronger footing than Matchup Intelligence v1's original build: the response shape was checked against CFBD's own live, current API reference (with a real documented example response, verified directly against `trim_box_score()` before shipping) rather than generic field-name knowledge, and the "empty result is valid, not an error" lesson from that earlier incident was applied proactively here from the start instead of needing its own production bug first. **One remaining, explicitly flagged gap:** turnovers comes from a second call (`/games/teams`) whose stat categories have no fixed schema in CFBD's docs — a "turnovers" category is confirmed to exist by a well-established third-party CFBD wrapper (cfbfastR), but the exact string wasn't independently confirmed against a live response; degrades to "—" rather than guessing wrong if the match fails. Also independently smoke-testable RIGHT NOW against any real past completed game (e.g. a 2025 gameId) — unlike Matchup Intelligence/ratings, this endpoint doesn't depend on the current season having any games played yet.
- **Historical CFBD betting-line integration is implemented ("line check"):** the same "Why?" panel in Results now also fetches `/api/fetch_cfbd?view=lines&id={cfbdGameId}` (CFBD's `/lines`, every tracked provider's spread/spreadOpen/overUnder, 24h cache — same immutable-once-final reasoning as boxscore) and shows CFBD's own historical closing line side by side with the pick's own retained pre-kick close, flagging a real mismatch (>0.5pt) vs. ordinary cross-book variance. Context/validation only — never writes into the pick's own `closingLine`/CLV fields or Model #; explicitly deferred backfilling missing pre-kick lines from this data to a separate, later decision rather than bundling a money-relevant pipeline change into a display feature. **Sign convention independently verified, not assumed:** CFBD's `/lines` schema example uses placeholder 0-values that can't reveal a sign convention on their own, so this was checked against a real third-party analytics site that explicitly documents pulling from this exact CFBD feed and states plainly "negative = home favored" — matching this app's own convention throughout, no flip needed on CFBD's side, only the existing picked-side conversion already used for `closingLine` itself. **A real bug in the trimming logic was found and fixed before it ever ran**, not after: the first draft included the CFBD response's own `gameId` in the trimmed result, which would have silently overwritten the handler's authoritative requested game ID via dict-spread ordering — most dangerously in the empty-result case, where it would've become `None`. Caught by re-reading the logic before testing, then a real negative-control test was written specifically for it.

- **"Show all N available systems" browse toggle removed (Aug 26, Claude), Drew's explicit call:** the Prediction Systems checklist previously showed Drew's curated `FEATURED_SYSTEM_CODES` subset by default with a toggle to reveal all ~48 ingestible systems. That toggle (and its `systemsShowAll` state, button render/click logic, and dead CSS) is now removed entirely — there is no UI path to browse or newly enable anything outside the curated list. **Ingestion and Model # math are unchanged**: a real sheet can still supply any of the ~48 system codes, and any already-`enabled` system (from before this change, or auto-populated from a sheet) still counts toward Model # and still renders its row in the checklist — the existing safety net that prevents an invisible-but-active toggle was deliberately kept. `tests/test_prediction_tracker_logic.mjs` updated to assert the toggle is gone and that a non-featured/non-enabled system stays hidden across re-renders. Full suite: **56/56 files passing** (including the real-browser Playwright suite, which ran successfully end-to-end in this sandbox — the Chromium-blocked-on-localhost issue noted in the prior Aug 25 handoff did not reproduce here).

- **Clerk JWT `azp` claim confirmed against a real production token, hardened to fail-closed (Aug 26, Claude).** Drew pulled a real token from `window.Clerk.session.getToken()` on live `pickgauge.com` and decoded it via jwt.io. Confirmed: `azp` is reliably populated (`https://www.pickgauge.com` for a www-origin sign-in), and the token carries **no `aud` claim at all** — validating that `decode_kwargs`'s `verify_aud: False` was correct all along, not an unverified guess. Since `azp`'s presence is now confirmed rather than assumed, `verify_user()`'s previously-fail-open behavior on a *missing* `azp` (deliberately permissive until this was confirmed, to avoid silently breaking all production auth on a wrong guess) is now fail-closed, identically applied across all 8 duplicated `api/*.py` copies. `tests/test_auth_sync.py` gained a new `_ALLOWED_AZP` constant drift check (the constant is referenced by name inside `verify_user()`'s body but defined at module level, so the existing AST body-diff didn't cover it) — 32/32 checks pass, all 8 files confirmed byte/AST-identical. `tests/test_clerk_token_hardening.py` updated to assert the new fail-closed behavior instead of the old fail-open one — 11/11 pass. Full suite: 56/56.

- **Live CAS concurrency test run against real production Upstash (Aug 26, Drew) — PASS.** `tests/_live_cas_concurrency_test.py`'s browser-console equivalent run directly against `https://www.pickgauge.com/api/state` with a real signed-in session. Two genuinely concurrent writes fired at the same instant: exactly one got 200 (new revision), exactly one got a real 409 with the *winner's* actual data (not stale/corrupted), `serverRevision` in the 409 matched the real new revision, cleanup succeeded. Confirms the CAS logic holds against real Upstash's actual Lua EVAL semantics under genuine race conditions, not just `tests/test_state.py`'s Python-threaded simulation. **This item is done — no longer a launch blocker.**

- **Real Splash pool-sheet import bug found and fixed (Aug 26, Claude) — closes launch blocker #7.** Drew tried importing a real Week-1 2026 Splash PDF (`Splash_CFB_Wk_1_Preliminary.pdf`, a ranked-opponents "Edit picks" screen) and got a hard 500 ("Something went wrong processing that request"). Root cause, confirmed by reproducing the browser's real extraction rather than guessing: built a Playwright harness that loads the actual vendored `app/vendor/pdfjs/*` build and runs the real `extractPdfTextLines()` (from `app/js/pool-contexts.js`) against Drew's actual PDF file. The real output showed the spread badge landing BEFORE the team name on this export (`"(+29.5)UMass"`), the opposite of `TEAM_RE`'s only supported shape (`"UMass(+29.5)"`, name then spread) — so every single team line in the real PDF failed to match, `parse_splash()` found zero games, and `parse_pool_lines()`'s own `raise ValueError("Couldn't find any games...")` became the generic 500. Reproduced exactly (`games found: 0`) before the fix, confirmed resolved (`43/43 games, pickLimit 7, all ranked-team names clean, sign convention verified against the source screenshot`) after it.

  Fix (`api/parse_pool.py`): `TEAM_RE` split into `TEAM_RE_LEADING` (new; spread-before-name, with an optional `"(##) "` rank-badge prefix stripped) and `TEAM_RE_TRAILING` (the original, kept for whichever real export produced the earlier-confirmed name-then-spread sample). `parse_splash()` tries LEADING first, falls back to TRAILING. Also handles the two real rank-badge shapes seen: floating alone on its own line (silently skipped, no team name to pollute) and glued onto the spread's own line (stripped via the regex's optional group). Team names containing real parens (`"Miami (FL)"`) pass through untouched since the leading markers are anchored to the start of the line only.

  Test coverage (`tests/test_pool_parsing.py`): targeted unit cases for the LEADING shape, both rank-badge variants, and parenthesized team names, PLUS the full 247-line real pdf.js output captured from Drew's actual file embedded verbatim as `REAL_SPLASH_WK1_PRELIM_SAMPLE` — the strongest regression guard available, since it's the literal real bytes the browser actually produced, not a hand-typed approximation. 50/50 checks pass in this file; full suite 56/56.

  **Not yet done, worth a follow-up:** this confirms the FIX works against this one real file. Drew still needs to actually re-upload this same PDF through the live deployed app once this is merged/deployed, to confirm the end-to-end path (real Clerk auth, real request size, real UI wiring) behaves the same as this direct-function-level verification. That's the difference between "the parsing logic is now correct" (done) and "a real live import through the running app succeeds" (still pending a live retry) — same "logic verified, live unverified" distinction this project already tracks elsewhere.

- **New-account default systems changed from an accidental BP/Comp-on to Sagarin (Rating) + SP+ (Aug 26, Claude), Drew's explicit call.** Drew flagged a real account showing BP + Comp pre-checked and asked why. Root cause: `normalizeState()`'s BP/Comp migration (`app/js/main.js`) was written to preserve an EXISTING account's pre-toggle behavior (BP/Comp used to always count toward My# unconditionally) by auto-adding them once, gated on a `_bpCompMigrated` flag — but that flag is equally absent for a genuinely brand-new signup, so new accounts got swept into the same "preserve prior behavior" path with nothing to actually preserve. Fixed by computing `_hadPriorState` (several independent real-usage signals: existing `enabledSystems`, `weights`, `pools`, `lastGames`, `pdfGames`, `inputs`, or either migration flag already set) at the very top of `normalizeState()`, before any of its own migrations could set a flag that would erase the account's real age. A genuine pre-existing account still gets BP/Comp preserved exactly as before; a genuinely brand-new account now gets `sag` (Sagarin Rating) + `cfbdsp` (SP+) instead — not BP (needs a personal newsletter subscription + per-user PDF upload a new signup won't have), not Comp (no empirical backtested track record in this project's own ranking work), not nothing (confusing zero-input first-run board).

  New dedicated test file `tests/test_new_user_system_defaults.mjs` directly runs `normalizeState()` (not just a source-text check) against both a brand-new shape (`null`, and `{}` — the actual shape `sync.js`'s own spread produces for a fresh server GET) and several genuine pre-existing-account shapes (an existing enabled system, a saved custom weight, a saved pool, an account that already ran the old migration in a prior session) — 15/15 pass. Verified further with a real Playwright browser render against a genuinely cleared `localStorage`: confirmed exactly `['sag','cfbdsp']` checked, nothing else. Full suite: 57/57.

- **Powers PDF removed from the required Weekly Setup gate (Aug 26, Claude), Drew's explicit call.** Drew flagged that a new user's Weekly Setup checklist showed "Powers PDF imported ⚠ BP missing for 43 of 43 games" as one of the items blocking "Finish Setup" — not appropriate given most users will never use this feature (it needs a personal Brad Powers newsletter subscription plus a per-user PDF upload). `computeWeeklySetup()` (`app/js/board.js`) previously gave this item `"bad"`/`"ok"` status (counted toward `requiredCount`/blocking `allOk`) whenever BP or Comp happened to be toggled on; now it's always `"na"` regardless of on/off/coverage state — same "na never blocks completion" mechanism the checklist already used for Prediction systems and Pool lines. Still shown as an informational row with real missing-coverage detail and a working click-through for the minority who do use BP/Comp and want to see/fix it — just never one of the "N of N complete" required items.

  `tests/test_weekly_setup_logic.mjs` updated: the two tests that pinned the old "bad"/"ok" behavior now assert "na" instead (with real detail text still verified present when data's missing), plus a new end-to-end case using the actual new-account-default shape (Sagarin+SP+ enabled, no BP/Comp) confirming the pdf item stays out of the required count there too. 37/37 pass. Verified live in a real browser render matching Drew's exact reported scenario (BP enabled, all 43 games missing BP data, otherwise fully set up) -- the setup card now fully collapses (mode `complete`) instead of showing the blocking "3 of 4 complete" warning from the original screenshot. Full suite: 57/57.

- **Powers PDF removed from the Weekly Setup card entirely (Aug 26, Claude), Drew's follow-up call.** Same-day tightening of the earlier fix: Drew's first message asked that Powers PDF not gate "Finish Setup" (fixed by making the item always `"na"`); his immediate follow-up asked for something stronger — "powers pdf does not need to be part of the weekly setup card at all." `computeWeeklySetup()` (`app/js/board.js`) no longer pushes a `"pdf"` item into the checklist under any circumstances (BP/Comp on or off, data missing or fully covered) — the whole block, and the now-unused `enabledCore` variable it was the only reader of, were removed outright. `computeInputColumnCoverage()` (the coverage-counting helper) is left defined but uncalled, in case BP/Comp coverage is ever surfaced elsewhere (e.g. the board's own bp/comp column headers) later.

  `tests/test_weekly_setup_logic.mjs` updated: the BP/Comp block now asserts `r.items.find(i => i.key === "pdf") === undefined` across every scenario (off, on-with-missing-data, on-and-covered, the new-account Sagarin+SP+ shape) rather than asserting any particular status — the item shouldn't exist, not just be non-blocking. 32/32 pass. Verified live in a real browser render reproducing Drew's exact original scenario (BP enabled, data missing): the checklist now shows exactly 4 rows (Vegas, Prediction systems, Pool lines, Entry selected) with no Powers PDF row at all, dash or otherwise. Full suite: 57/57.

- **Help page ("How to use Edge board") audited and corrected (Aug 26, Claude), per Drew's request to carefully review it.** Checked every factual/numeric claim against the actual codebase rather than skimming for typos. Two real inaccuracies found and fixed, both stale from earlier changes this session:
  1. **Quick Start steps 6-7 described a "star" mechanic that doesn't exist.** The real Edge Board has no star icon for picking — picks are made by clicking a team's own pick button directly (team name + spread, right on the matchup row). The only star-like icon (★) lives exclusively in the Snapshot tab's compact pick buttons, not the Edge Board this section describes. Also, "max 7" isn't a hardcoded universal cap — it's `pickLimit()`'s per-pool value (`pool.pickLimit || 7`), 7 only as the default fallback. Rewrote both steps to describe the real click-to-pick mechanism and correctly frame 7 as the default, not a hard limit.
  2. **"toggle any of the ~40 individual computer systems" was stale** after this session's earlier removal of the "Show all" browse toggle (see that entry above) — the checklist now only ever offers the curated ~20 (`FEATURED_SYSTEM_CODES`), not "any" of the full ~48 (`PRED_SYSTEMS`, confirmed by direct count, not the doc's old "~40"/"44" guesses). Rewrote to state both real numbers accurately and explain that an already-enabled non-featured system still counts even though there's no UI path to newly enable one.

  Also fixed a stale code comment directly above `FEATURED_SYSTEM_CODES` (`app/data/pred-systems.js`) that still described the removed "Show all" toggle and the old "44 systems" count — same root cause as the help-page issue, just in a source comment instead of user-facing copy.

  Everything else in the page was checked and confirmed accurate against the real source: the 5,705-game/2018-2025 key-number dataset (matches `model.js`, `board.js`, `cover-table.js` exactly), `goodThresh`/`strongThresh` defaults (1.5/3), Vegas's weight-0 default, the Powers PDF page 2/page 6 extraction (matches `parse_pdf.py`'s real fallback indices), the remaining-API-calls display, and the Settings export/backup feature — no changes needed to any of those. Full suite: 57/57 (unrelated to this HTML-only change, but reconfirmed clean).

- **Pick Score ranking removed entirely, replaced by ranking on real Cover % (Aug 26, Claude), Drew's explicit call.** Drew flagged the Snapshot tab's "Pick Score" ranking mode (a blended, equal-weighted percentile average of Raw Edge/Cover %/key-number proximity) for removal, wanting Cover % used as the alternate ranking mode instead of Raw Edge — not a synthetic blend, the real modeled cover probability the app already computes and has fitted against 5,705 real games.

  `app/js/board.js`: `computeSnapshotScores()` no longer computes a blended `pickScore` field — still computes the three independent `edgeRank`/`coverRank`/`keyRank` percentiles (unaffected; still used by the detail panel's mini progress bars). `renderSnapshot()`'s ranking toggle (`state.snapRankByCover`, renamed from `snapShowScore` for honesty about what it now does) sorts directly by `e.prob.pCover` when active instead of a blended score. The Top Opportunities cards' extra "Pick score" stat and the Quick Look table's extra "Score" column were removed outright — both were redundant once ranking is just real Cover %, since Cover % is already its own always-visible column/stat regardless of ranking mode. The row-expand detail panel's highlighted top number now shows the real Cover % (with the same real methodology language used elsewhere in the app) instead of a synthetic score when Cover %-ranked. `app/index.html`: toggle button relabeled "Pick Score" → "Cover %"; the now-dead `.has-score`/`.snap-score-cell` CSS rules removed.

  Test coverage: `tests/test_snapshot_logic.mjs` — the Pick-Score-blend-specific assertions replaced with assertions that the three individual percentile ranks still compute correctly independently, plus an explicit check that `pickScore` no longer exists on any computed row at all (52→62 checks, still 100% passing). `tests/test_snapshot_export_feature.mjs` and the manual `tests/_render_snapshot.py` visual helper had stale "Pick Score" wording in comments/check names updated to match (their actual assertions were unaffected — the export always ranked by raw edge regardless of on-screen ranking mode, unchanged). Verified live in a real browser: toggle labels read "Raw Edge"/"Cover %", the rank note and methodology text update correctly on toggle, and the table header confirms no leftover "Score" column. Full suite: 57/57.

## Product work already complete

- **"No ads, ever" claim removed from the draft pricing page (Aug 28, Claude).** Drew's call: this project has explicitly explored advertising and affiliate revenue as options before (see the longer-term backlog below) — a permanent public promise ruling that out entirely was premature while the business model is still being figured out. Removed the whole `why-card` ("No ads, ever, on any tier" / "Pro is the only monetization path being considered") from `pricing.html`'s "A few things that won't change" section, not just the headline claim — the body text made the same premature commitment. The section's grid CSS was fixed alongside this (`repeat(auto-fit,minmax(240px,1fr))` instead of a fixed 2-column layout) so 3 remaining cards fill one row cleanly instead of leaving a lonely trailing card — verified in a real browser render. No other "no ads" language existed anywhere else on the site (checked).
- **Canonical URLs added to the 5 static pages that were missing them (Aug 28, Claude).** Drew's call, per Google's own guidance for duplicate-URL situations: `methodology.html`, `privacy.html`, `terms.html`, `responsible-play.html`, `contact.html` are all reachable from both `pickgauge.com` and the Vercel hostname, but only the homepage had an explicit `<link rel="canonical">` before this. Added one to each, using the exact same URL format already established in `sitemap.xml` (`.html` extension, no trailing slash) — so the two stay consistent with each other, not just each individually correct. `tests/test_sitemap_social_metadata.py` extended with a real check (not just presence-of-file) that each of the 6 sitemap URLs (including the homepage) has a matching canonical tag on its actual page pointing at that exact URL — 21/21 checks pass, up from 15.

- **First-party product analytics + beta feedback (Aug 26, ChatGPT):** authenticated `/api/beta` stores **aggregate daily event counts** plus HyperLogLog unique-user estimates using one-way SHA-256 account tokens; there is no raw clickstream. Current funnel events cover app open, tab views, odds refreshes, prediction loads, Powers imports, pool imports, My Numbers manual/CSV use, pick creation, entry submission, Snapshot export, and feedback submission, with only coarse allowlisted context (`tab`, mobile/desktop, Overall/pool, source). Analytics and feedback both expire after ~400 days. A persistent header 💬 button plus Help-tab CTA opens a custom feedback modal (Bug/Confusing/Feature request/Other + max-2000-char message); feedback stores a pseudonymous user token, time/category/message and coarse app context only — no email, screenshots, picks, model numbers, or imported-file contents. Admins already listed in `PICKGAUGE_ADMIN_UIDS` get an Account-tab **Beta admin** card with a 30-day unique-user/funnel summary and recent feedback; backend GET views are separately admin-gated. This remains the signed-in product-usage layer and is deliberately separate from Vercel's anonymous website-traffic analytics. New regression files: `tests/test_beta_analytics_feedback.py` and `tests/test_beta_client_logic.mjs`.
- **Beta analytics review + feedback workflow v2 (Aug 30, ChatGPT):** admin analytics now reports a real **unique-user signed-in activation funnel** instead of inferring conversion from repeatable event counts. `/api/beta` keeps one daily HyperLogLog per core milestone (`app_open`, `signup`, `pool_ready`, `predictions_ready`, `pick_ready`, `snapshot_view`, `entry_submitted`) and unions those HLLs across the requested date range; no raw user-level event stream is introduced. The Account → Beta admin card now shows active/new users, milestone coverage, feature activity, mobile/desktop app-open mix, 7-day activity, and richer feedback context. Funnel milestone uniques begin with the Aug 30 build. Feedback categories are now Bug / Confusing / Feature request / Other, and submissions automatically attach only coarse diagnostics: tab, Overall/pool, device, season/week, header-vs-Help entry point, and recent product action. Failed core actions are remembered locally so a bug report can say it came after an attempted pool/predictions/odds/Powers/My Numbers/Snapshot action even when that action never succeeded. No screenshots, picks, model numbers, pool names, emails, or imported-file contents are attached.
- **Vercel Web Analytics integration prepared (Aug 30, ChatGPT):** all nine user-visible HTML pages now load the same-origin Vercel Web Analytics intake through a CSP-safe external bootstrap (`/vercel-analytics.js` + `/_vercel/insights/script.js`). The bootstrap installs a `beforeSend` guard that removes all URL query strings and fragments before page-view transmission, so transient auth/query state is not useful analytics data. `privacy.html` now separately discloses anonymous aggregate Vercel website traffic (page views/visitors/referrers/device/browser/location) versus PickGauge's signed-in first-party product funnel, and the Account → Beta admin copy makes that separation explicit. No Google Analytics, Meta Pixel, advertising tracker, Vercel custom event payloads, picks, pool names, model numbers, files, or email addresses are added. **One infrastructure step is still required after deploying this code:** Vercel project → Analytics → Enable, then redeploy; the currently live `cfb-ats-dashboard` project still returns 404 for `/_vercel/insights/script.js`, which confirms Web Analytics is not enabled yet. New `tests/test_vercel_web_analytics.py` pins every page, load order, CSP compatibility, privacy disclosure and query/hash stripping. Current repo: **69 permanent test files — 68 non-browser + 1 Playwright E2E file**.

- **Launch P2 hardening (Aug 26, ChatGPT):** the four remaining P2 launch-hardening items are shipped. A root `sitemap.xml` now advertises only the publicly indexable marketing/legal pages and `robots.txt` points crawlers to it while continuing to exclude `/app/`, `/api/`, and the draft pricing page. A dedicated **1200×630 `social-share.png`** built from the current PickGauge stadium mark replaces the square favicon as the homepage Open Graph/Twitter image; OG width/height/alt metadata is explicit and Twitter now uses `summary_large_image`. The server-side Powers PDF endpoint now rejects uploads that do not carry a `%PDF-` signature within the first 1024 bytes **before** handing user bytes to pdfplumber, and `parse_pdf_bytes()` now closes the opened PDF in a `finally` block even when parsing fails. Finally, every JSON `_respond()` path across all nine authenticated `api/*.py` functions explicitly sends `Cache-Control: private, no-store, max-age=0`, preventing authenticated/user-state or paid-upstream responses from being retained by browser/intermediary caches. New regression files: `tests/test_sitemap_social_metadata.py` (15 checks), `tests/test_pdf_upload_hardening.py` (9 checks), and `tests/test_api_no_store_headers.py` (originally 8 checks; now **9/9** including `/api/beta`). At that point the repo had **61 permanent test files — 60 non-browser + 1 Playwright E2E file** and the fast suite passed **60/60**; the Playwright file was attempted separately and was blocked before app assertions by this sandbox's `ERR_BLOCKED_BY_ADMINISTRATOR` localhost restriction.
- **My Numbers Phase 1 (Aug 26, ChatGPT):** shipped as a private, account-synced personal projection layer that stays deliberately independent from both **PickGauge Model #** and the customizable **Model #**. The Edge Board now has a sortable **My Numbers** column with inline numeric entry; each entered line immediately shows its own compact **My edge** against the same board reference line (live Vegas on Overall, locked/provisional pool line in pool context) without changing the main model/Edge ranking. Values are stored in `state.myNumbers` by **season + CFB week**, with CFBD/Odds IDs and team-name fallback identity so the same game reuses the same personal number across Overall and multiple pools. A new collapsible **My Numbers** panel supports CSV import, a current-slate CSV template download, clear-current-slate, and an inline review queue for unmatched rows. Documented CSV columns are `Away Team, Home Team, My Line`; `My Line` accepts plain home-perspective numbers, `PK`, or human-friendly signed-team forms such as `Georgia -7` (converted internally to PickGauge's home-team-spread convention). On mobile, My Numbers intentionally gets its own full-width row beneath the core Vegas/CLV/Model#/Cover% stats rather than squeezing another stat into the already-dense grid. `tests/test_my_numbers_logic.mjs` adds 24 checks for persistence/week scoping, cross-context reuse, independent edge math, CSV quoting/parsing, named-team sign conversion, auto-match/unmatched review, state initialization, script/UI wiring, and independence from the core model. At the time Phase 1 landed, the repo contained 58 permanent test files. The current repo now contains **69 permanent test files: 68 non-browser + 1 Playwright E2E file**; Playwright still cannot reach localhost here (`ERR_BLOCKED_BY_ADMINISTRATOR`) before app assertions begin.
- **PickGauge Model # standalone mode (Aug 25):** the Prediction Systems dropdown has one dedicated **PickGauge Model #** button backed by a fixed six-input 100% internal recipe: Sagarin Ratings 13%, Sagarin Predictor 13%, Dokter Entropy 22%, SP+ (CFBD-derived) 20%, current/updated Vegas 22%, Big 200 10%. **This is NOT membership-gated yet; premium/subscription functionality is explicitly deferred.** The important UX correction is that PickGauge Model # is now a real standalone model mode, not a preset that auto-enables its five source systems. Turning it on clears the current visible/custom system selection so the board immediately shows one **PickGauge Model #** aggregate column; its five internal model inputs stay behind the scenes and are not written into `state.enabledSystems`. A user may then manually enable any individual system as a separate comparison column without altering the PickGauge calculation. Turning the PickGauge button off returns to custom Model # behavior. A one-time `_pickGaugeStandaloneMigrated` state migration converts the short-lived earlier Aug 25 preset-shaped saved state into the new standalone flag and removes those auto-enabled ingredient columns. **Pool semantics remain deliberate:** after a pool line locks, the PickGauge market ingredient uses current live Vegas (`g.liveVegas`), while Edge still compares the finished PickGauge Model # against the pool's locked line. **Missing-source rule (Aug 25 live-season correction):** current/updated Vegas remains mandatory, but PickGauge Model # may calculate with **3, 4, or all 5 predictive models** when publishers have not posted yet. The unavailable model share is redistributed proportionally across whichever predictive-model inputs are available, preserving their intended relative influence while Vegas keeps its fixed 22% share. If **fewer than 3 predictive models** are available, the branded number stays blank. A compact `3/5 models` or `4/5 models` note appears under the board value whenever this fallback is active. `MODEL_VERSION` is now 3 so pick snapshots distinguish the changed missing-input semantics. Pick-time snapshots tag `modelPresetAtPick:"pickgauge"`; source values are frozen for audit/history, but the proprietary numeric weight recipe is no longer copied into user-exportable pick state. The Prediction Systems UI hides custom numeric weight controls while PickGauge mode is active and explains only that the number blends five selected models plus some influence from Vegas. `tests/test_pickgauge_model_logic.mjs` pins the recipe, 3/5 + 4/5 dynamic fallback, fixed-Vegas behavior, and standalone/hidden-component behavior. Regression suite passed at the time; the current repo now contains **69 permanent test files** (see the current test-suite section below).
- **Public Methodology page + data-source attribution (Aug 20):** new `methodology.html`, linked from every footer site-wide (marketing landing page, in-app footer on both the signed-in app and the pre-signup sign-in gate, and every legal/info page), explaining what Model # actually is, crediting every real data source (thepredictiontracker.com for prediction systems, The Odds API for lines, CFBD for context + the SP+/CORE exception), and explicitly stating PickGauge isn't affiliated with or endorsed by any of them. A matching disclosure line was added directly in the Prediction Systems panel itself, next to the existing thepredictiontracker.com link. **Real gap found while researching this, not assumed:** thepredictiontracker.com has no visible Terms of Use, no formal API, and appears to be a single-person, ad-supported/donation-funded hobby site (confirmed via a real interview with the operator, not assumed) — meaningfully lower legal exposure than the Brad Powers paid-newsletter situation (which is why BP stays private-tier), but genuinely no formal permission either. Attribution was chosen as the honest, low-cost default regardless of what's strictly required — not a claim that it resolves the underlying licensing question, which stays open if PickGauge ever moves toward being a real paid product built partly on someone else's free, unaffiliated work.
- **Prediction Systems checklist uses a curated featured subset (introduced Aug 20; current behavior updated Aug 26):** the checklist no longer exposes a browse/show-all toggle. Only Drew's curated `FEATURED_SYSTEM_CODES` subset (`app/data/pred-systems.js`) is available for newly enabling systems in the UI. Ingestion still accepts the full supported system set, and any already-enabled non-featured system remains visible and active so it can never become an invisible toggle with no way to turn it off. If `FEATURED_SYSTEM_CODES` fails to load, filtering fails OPEN rather than silently hiding every system. See the Aug 26 "Show all N available systems" removal entry above for the current implementation. **Sagarin is no longer ambiguous:** Aug 25 research confirmed `sagpred` = Sagarin Predictor/Pure Points (the backtest's "Sagarin Points") and `sag` = overall Sagarin Rating (the backtest's "Sagarin Ratings"). All four Sagarin variants remain featured because Drew had explicitly asked to keep the other Sagarin models available too.
- **Model Agreement:** transparent `X/Y agree` signal based on enabled, positively weighted non-Vegas model inputs.
- **Draft → Ready → Submitted:** entry readiness status plus a real Submitted lock; explicit Unlock re-enables editing.
- **Your pick performance / Results analytics:** ATS record/win rate, average pick-time Edge, true CLV/positive-CLV rate, Edge and Model Agreement buckets, favorite/dog, home/away, spread ranges, key-number tiers, CLV-vs-ATS, Cover-% calibration, season/week filters, and small-sample warnings. Legacy picks with no frozen snapshot are excluded from snapshot-specific metrics rather than recomputed with today's model.
- **Full-slate historical model performance (Aug 30, ChatGPT):** Results now has a separate **Model performance** card that evaluates the prediction systems independently of which games the user chose. A new private `state.modelPerformanceHistory` captures every available pre-kick game once PickGauge has both a market line and model projections; later pre-kick refreshes update the same game, while kickoff makes the snapshot immutable so postgame predictions cannot contaminate history. The snapshot includes all curated/featured systems that have a number, plus any legacy enabled non-featured system, and computes **PickGauge Model # even when its standalone UI mode is off** using the same fixed recipe and 3-of-5 fallback rules as the live board. `api/grade_picks.py` now grades each hypothetical model lean from canonical CFBD finals in the same CAS write as user picks. Exact model=market observations are stored as `N` (no lean), not fake pushes; pushes remain in ATS records but are excluded from win-rate denominators. The dashboard shows model-by-model W-L-P / win % / average absolute model-vs-market gap, a PickGauge Model # hero record, and PickGauge-specific edge-size, favorite/underdog, and home/away splits. **Methodology guardrail:** the benchmark line is the market/book frozen with the last pre-kick snapshot that this account actually observed — it is not reconstructed later and is not necessarily an official close. This dataset starts prospectively with deployment; prior weeks are intentionally not backfilled from current predictions because that would introduce hindsight. Model tracking remains private/account-scoped, so a future public "official PickGauge record" would need a separate server-owned canonical consensus snapshot pipeline.
- **Reusable PickGauge dialogs:** browser-native `alert()`/`confirm()`/`prompt()` calls have been removed from shipped app JS. Pool creation is one validated form, sheet targeting is a choice list, destructive actions use consistent danger styling, and the modal layer supports Escape, backdrop dismissal, focus trapping/restoration, queued multi-step dialogs, and inline validation.
- **Pools tab action-density pass:** each pool row now shows only "View" and "Import ▾" always visible; Edit pick limit, Publish/Unpublish template, Archive, and Delete all collapsed into a single "⋮ More" dropdown. Down from 6-7 equal-weight buttons to 2-3 controls.
- **"Select games manually" is implemented:** a pool that isn't on Splash/ESPN/OFP at all (a pool on some other site, a paper sheet, a group text) previously had NO way to get a game list — `createEmptyPool()`'s own message says "you can import its weekly sheet afterward," but there was nothing for "there is no sheet." New "Import ▾" menu item on every pool row opens an inline checklist (not a modal — the shared `pgForm()` dialog system isn't built for a large scrollable list) of the current week's already-loaded live games, each with a spread input prefilled from the live Vegas line but always editable; a free-text fallback covers a game the live odds feed doesn't track at all. Reuses the exact same `applyParsedPoolData()` pipeline the PDF/paste import paths already use — a manually-built games array is just a third way to produce the `{source, pickLimit, games}` shape that function already accepts, not a new pool-mutation code path.
- **Import Powers PDF moved into the prediction-systems checklist grid**, positioned right after BP (before Comp) instead of sitting in a separate INPUT WEIGHTS box. **Real bug found and fixed during the move:** `#pdfFile` now lives inside the JS-rendered grid and gets destroyed/recreated on every `renderSystemsSettings()` call (every checkbox toggle, weight change, predictions load) — `init.js`'s old one-time onchange binding ran BEFORE this element existed in the DOM at all, which would have thrown. Fixed by moving the binding inside `renderSystemsSettings()` itself, rebinding on every render (same pattern already used there for `[data-sys]`/`.sys-weight`). `prediction-tracker.js` had zero test coverage before this; `tests/test_prediction_tracker_logic.mjs` is new.

- **Edge Board toolbar decluttered on mobile (Aug 20):** a real screenshot showed the Weekly Setup card, sort dropdown, two filter checkboxes, the color legend, and "Load model predictions" stacking into ~9 persistent rows before a single game was visible on a phone. Sort/filters/legend are now one collapsible `<details>` panel (closed by default on mobile, open on desktop, matching the Prediction Systems panel's own existing pattern — set once at startup from viewport width, never re-toggled on resize so it can't silently close a panel someone deliberately opened). The Weekly Setup card now disappears entirely once genuinely complete (`computeSetupDisplay()`'s "complete" mode now keys off `okCount===requiredCount`, not `allOk && !warnings.length` — see the corrections log for the real bug this fixed) rather than shrinking to a compact card; "Setup ✓" folds into the Context Bar's own line2 instead, so a fully-set-up week costs zero extra vertical space. "Load model predictions" collapses to a quiet "predictions loaded ✓ · reload" text link once `state.predMeta.fetchedAt` is set, instead of staying a persistent full-width button with nothing left to do. **One item from the request not yet resolved:** the screenshot also showed an amber "WEEK 1 · PICK 7"-style element that could not be located anywhere in the codebase despite several genuinely separate search attempts (every JS file, the literal text, CSS badge classes, "next pick"/"on the clock" patterns) — it was left untouched (nothing near it was restructured, so it should be unaffected either way) rather than guessed at. Needs Drew to point at it directly (a tap, a fuller screenshot, or just a description) before it can be addressed.
  **Correction, same lesson as the one already documented above:** this was originally handed off with the canonical 62-check `tests/test_e2e_ui_behaviors.py` marked "could not be re-run here end-to-end" (blamed on a Chromium-blocks-localhost limitation) and a smaller, non-permanent "self-contained acceptance harness" (26/26) substituted as a stand-in. That claim went unquestioned into this file the first time. It was re-checked directly in the next session: **the actual, canonical 62-check file runs successfully end to end** (confirmed twice, including a negative control — reverted the Pools-stacking CSS fix, watched the exact right check fail, restored it, watched it pass again). Whether a given sandbox can launch Chromium against `localhost` genuinely varies by environment — the fix each time is the same: try the real file before repeating the claim forward, not accept it as settled.
  **Still not a substitute for physical-device signoff:** no real iPhone/Android or browser-cloud connector exists in any of these sandboxes — one real Safari-on-iPhone + Chrome-on-Android pass remains before calling mobile launch validation fully complete.

- **ChatGPT's Aug 20 audit items shipped (Aug 20-21):**
  - **Neutral-site SP+/CORE HFA bug fixed.** `cfbdDerivedSpread()` used to apply the 2.6pt HFA constant unconditionally, giving whichever team CFBD calls "home" a false edge on every neutral-site game. `trim_games()` (`api/fetch_teams.py`) now passes CFBD's own `neutralSite` flag through the identity layer; frozen onto each pick at pick time so a later reschedule can't retroactively change which HFA a graded pick's numbers were computed with.
  - **CFBD ratings-panel label fixed.** Used to hardcode "Context only — not part of Model #" even when SP+/CORE were actually enabled as real Model # inputs. Now reads `state.enabledSystems` and says so when they're on.
  - **Closing-line freshness/quality tracking added.** New `closingLineFreshness()`/`closingLineFreshnessNote()` (Excellent/Good/Stale/Low-confidence tiers by minutes-before-kickoff) surfaced both inline in Results rows and in the "Why?" line-check panel — a retained close now visibly shows how stale it actually is, not just the bare number. Wording fixed site-wide from "true closing lines" to "last observed pre-kick lines" (there's still no automatic recurring odds-capture job, only the daily grading cron — that's the real remaining gap this doesn't solve).
  - **PredictionTracker reliability hardened.** `api/fetch_predictions.py` gained stale-if-error fallback (serves the last known-good fetch, up to 7 days old, if a live re-fetch or an empty CSV would otherwise hard-fail), immutable weekly snapshots keyed by ISO calendar week (26-week TTL, for future model-calibration research), and schema-drift alarms (sharp game/system-count drops, a core system like Sagarin silently vanishing, duplicate-matchup spikes) surfaced as non-blocking `warnings` in the response and echoed to the console.

- **Shared Odds API key is now the real default for every signed-in person (Aug 21):** the backend already had an `ODDS_API_KEY` env-var fallback, but onboarding copy across the app (the demo banner, the empty-board message, the Settings panel, the Quick Start guide) all still told people to get their own personal key first — directly contradicting the FAQ, which already said the shared connection worked automatically. All of that copy now leads with "hit Refresh lines, works automatically once signed in"; a personal key is framed as optional, for someone who wants their own separate refresh budget. The personal-key field itself is now tucked behind a collapsed "Advanced" panel in Settings (closed by default) instead of sitting open as if it were step one.
  **Real usage-protection additions**, since a shared key now funds every user by default: a **global (not per-user) upstream lock** in `api/fetch_odds.py` bounds real upstream API calls to at most 1 every 5 seconds system-wide, regardless of how many different signed-in people ask at once (closes a thundering-herd gap the existing per-user cooldown couldn't touch); a **quota floor** refuses to spend any more of the shared key's quota once its last-known remaining-calls count drops below 50, serving stale cached data instead and pointing people to add their own key if they want to bypass it.

- **Pool-setup discoverability CTA added (Aug 21):** Snapshot and Edge Board previously had zero path to discovering pools exist once real (non-demo) data was loaded — the only pool-import mention lived in the demo banner, which disappears the moment live odds load. New single-clickable banner ("❓ How to set up a pool → Go to Pools") shows on both tabs whenever someone's on the Overall board and has never created a pool; jumps straight to the Pools tab and highlights the Upload PDF control. Self-limiting instead of dismissible — disappears permanently once a pool is created, no separate "dismissed" state to track.

- **Snapshot UI polish pass (Aug 21), driven by several real screenshots:**
  - **Sort & filter panel**: fixed internal checkbox/legend spacing (was relying on collapsed HTML whitespace for gaps), then — per follow-up feedback — removed the boxed/collapsible "dropdown" card entirely on desktop in favor of individual controls directly in the toolbar, matching the pre-collapsible layout. Mobile keeps the boxed collapsible panel (that was the real mobile-only problem a card layout was solving).
  - **"Matchup breakdown" toggle**: moved from a far-right, disconnected table column to directly beside the shortlist flag. Implemented as a second, responsively-shown copy of the same button (desktop: inline next to the flag; mobile: the original dedicated `<td>`) rather than nesting one button in both places — nesting would have silently reintroduced an earlier, real mobile positioning bug (CSS grid-row repositioning only works on direct `<tr>` children).
  - **Quick Look table**: Signal column was right-aligned by inheritance from the base table style with no override for the body cells (only the header had one) — badges rendered left-aligned regardless, producing the reported "signal header is misaligned." Fixed with an explicit `text-align:left`. Team-name/matchup-subtitle text was similarly inheriting `text-align:right` from the base table style with no override, causing each line to right-align independently within its own shrink-to-fit box — invisible when both lines happened to render the same width, ragged and inconsistent for real (uneven-length) team names. Fixed the same way. Logos enlarged (38px, from the shared 18px) using a padded-circular-badge treatment (wrapping `<span>` + inset `<img>`, not a bare `border-radius:50%` crop) so a square logo's corners don't get clipped by the circle. Signal badges (key-number/model-agreement) now stack vertically instead of side-by-side, narrowing what had become one of the widest columns in the table.
  - **Top Opportunities cards**: now shows top 5 instead of top 3, all five sized identically — the featured #1 card is distinguished purely by its green highlight, not by being physically larger (an intermediate version gave it a wider column and bigger text/logo; removed per follow-up feedback).
  - **Empty states, both places**: the Quick Look table's "No games match this filter" is now three distinct messages depending on the actual cause (no games loaded at all / games loaded but no model inputs configured, with a working "Load prediction systems" link straight to the panel / a specific filter pill matching nothing) instead of one generic sentence regardless of cause. The Weekly Setup checklist's "Prediction systems loaded — None enabled this week" row (deliberately a quiet dash, not a warning, so someone who's genuinely opted out isn't nagged) previously had no click target at all; now carries an "Explore →" link to the same panel, so a brand-new person who's simply never discovered prediction systems has an actual way to find them — still excluded from the completion ratio, still not a nag.
  - **Mobile spillover hardening**: a reported context-bar horizontal-overflow issue on mobile didn't reproduce against current code in repeated attempts (same pattern as a separate "massive logos" report that also turned out to be a stale build) — added a hard `html,body{overflow-x:hidden}` safety net regardless, so the whole category of "something pushes the page wider than the viewport" becomes structurally impossible going forward, without touching the app's own legitimate nested horizontal-scroll containers (the wide board table, the week-nav strip).
  - Net new/changed test coverage from this pass: `tests/test_snapshot_quicklook_layout.mjs` (41 checks, structural), plus updates across `tests/test_odds_shared_key_usage_protection.py`, `tests/test_fetch_predictions.py`, `tests/test_fetch_predictions_client_logic.mjs`, `tests/test_cfbd_identity.py`, `tests/test_cfbd_identity_logic.mjs`, `tests/test_cfbd_insights_logic.mjs`, `tests/test_board_cfbd_dropdown_logic.mjs`, `tests/test_pool_setup_cta_logic.mjs`, `tests/test_settings_advanced_key_logic.mjs`, `tests/test_weekly_setup_logic.mjs`, `tests/test_e2e_ui_behaviors.py`.

- **Mobile spillover, Context Bar + Snapshot stat strip (Aug 24, Claude):** two real screenshots showed the Context Bar's summary line ("Splash pool TEST · Entry 1 · Week 1" / "1/7 picks · 24/43 lines locked...") and the Snapshot stat strip (Games Analyzed / Strong Edges / Good Edges) both spilling past the right edge on mobile. Context Bar root cause: `ctxLine1`/`ctxLine2` were direct siblings in a single nowrap flex row; line1 could wrap but line2 got squeezed to near-zero width beside it, so its existing `overflow:hidden`/`text-overflow:ellipsis` never actually engaged and the text was hard-clipped by the page's `overflow-x:hidden` safety net instead of truncating with "…". Fixed by wrapping both lines in a new `.context-bar-text` container that switches to `flex-direction:column` on mobile, giving each line the full bar width. Snapshot strip: not actually a layout bug — it's a deliberate horizontal-scroll strip (6 tiles, genuinely wider than a phone viewport) that gave zero visual indication it was scrollable; the last visible tile's `border-right` landed flush against the card edge and read as clipped content. Added a right-edge fade-to-background gradient plus breathing-room padding as a "swipe for more" cue. Verified with real Playwright screenshots at 390×844 using the exact text from the reported screenshots (`body.scrollWidth === window.innerWidth`, confirmed 6-tile/858px-content strip genuinely needs the scroll). **Unresolved cross-session note:** Drew reported the fix still wasn't visible on a real device after this; separately, ChatGPT also shipped a fix for the same two elements and Drew confirmed that one resolved it live. Whether ChatGPT's fix superseded, duplicated, or conflicts with what's in this repo as of this commit was never reconciled — this session's `app/index.html` still contains the fix described above, written without visibility into ChatGPT's actual diff (no live GitHub access from this sandbox to compare). **Next session: diff this against whatever's actually deployed before trusting either description.**
- **thepredictiontracker.com de-spotlighted in all public/in-app copy (Aug 24, Claude), Drew's explicit call after a risk discussion:** Drew hasn't spoken to the site's operator and has no agreement with them; decided the safer default is dropping the named/linked attribution from user-facing surfaces while keeping the underlying disclosure honest ("aggregated third-party computer prediction systems", no name/link). Changed: Prediction Systems panel intro + disclosure paragraph, the Load-model-predictions legend text, two FAQ entries, the Quick Start guide, the per-system column header hover tooltip and the Load-predictions button hover tooltip (`app/js/board.js`), and the Methodology page's dedicated source card — which previously named/linked the site AND invited its operator to reach out with questions about how their data was used, i.e. was actively inviting exactly the scrutiny this change is meant to avoid. **Deliberately left untouched:** internal code comments in `pred-systems.js`/`prediction-tracker.js`/`pdf-import.js`/`index.html`'s own `<script>` blocks (not rendered to anyone, useful for future sessions to know where the data actually comes from), and `privacy.html`'s mention (different purpose — third-party data-flow disclosure alongside Clerk/Vercel/Upstash, not credit — flagged to Drew as a separate open call, not yet decided).

- **Security hardening pass (Aug 25, Claude): CSP shipped, PDF.js self-hosted, `force=1` admin-gated, `robots.txt` added.**
  - **The last inline `<script>` block in `app/index.html` (~500 lines) is externalized** to `app/js/main.js`, at the exact same position/load order it occupied inline (right after `init.js`, right before `</body>`; `initErrorBoundary()`/`bootstrap()` invocations unchanged). This was the actual blocker on a restrictive CSP — an inline `<script>` with real content can only pass CSP via `'unsafe-inline'` (defeats the point) or per-response nonces (extra server-side moving parts this static-file project doesn't have). A plain external file needs neither.
  - **`vercel.json` now sends a real `Content-Security-Policy` header**, built against Clerk's own documented CSP requirements (looked these up directly rather than guessed — `script-src`/`connect-src` allow `clerk.pickgauge.com` + Cloudflare's bot/fraud-protection hosts, `worker-src 'self' blob:`, `style-src` keeps `'unsafe-inline'` because Clerk's components require it regardless of this app's own ~87 inline `style=` attributes, `img-src` stays broad `https:` since team logos come from CFBD's dynamic response with no fixed CDN domain), plus `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`.
  - **PDF.js is self-hosted**, not loaded from cdnjs. Pulled the exact pinned version (3.11.174) via `npm pack pdfjs-dist@3.11.174` — the same publish cdnjs itself mirrors, byte-for-byte — into `app/vendor/pdfjs/pdf.min.js` + `pdf.worker.min.js`. `app/index.html`'s script tag and `app/js/init.js`'s `GlobalWorkerOptions.workerSrc` both repointed to the local copies. Removes the last third-party origin from the trust chain for a library that handles arbitrary uploaded PDFs, and let `script-src` in the CSP stay `'self' + clerk.pickgauge.com` instead of also allowlisting cdnjs.
  - **`/api/fetch_cfbd`'s `force=1` (bypasses the shared Redis cache, forces a real upstream CFBD round trip) is now admin-only.** Added `is_admin(uid)` to `api/fetch_cfbd.py`, identical to `api/state.py`'s existing copy (reads `PICKGAUGE_ADMIN_UIDS`, fails toward "nobody is admin" on unset/misconfigured). `tests/test_auth_sync.py` got a new `ADMIN_FUNCS`/`ADMIN_FILES` drift check (same pattern as the file's existing `CAS_FUNCS` check) so the two `is_admin()` copies can't silently diverge. A non-admin's `force=1` doesn't error — it's silently downgraded to a normal request, verified with a real functional test against `do_GET()`'s actual control flow (`tests/test_cfbd_insights.py`, not just a source-text check).
  - **`robots.txt` added** at repo root — `Disallow: /app/` (the P1 "noindex /app/" item — no value in a crawler indexing a client-rendered SPA behind Clerk auth), `Disallow: /api/`, `Disallow: /pricing.html` (defense-in-depth alongside its existing `noindex` meta tag).
  - **SPF/DKIM/DMARC — ALL THREE COMPLETE (Aug 28).** SPF live (MXToolbox `spf:pickgauge.com` pass). DKIM live and active (2048-bit, `google` selector, "Start authentication" confirmed clicked Aug 26). DMARC added Aug 28 after the 48h settle window (`_dmarc` TXT, `v=DMARC1; p=none; rua=mailto:support@pickgauge.com`) — confirmed via MXToolbox: record published, valid syntax, only one record (no conflicting duplicate), external validation passed. The one red "DMARC Policy Not Enabled" flag MXToolbox shows is expected/correct — that's just noting `p=none` (monitor-only) rather than enforcement, which is the deliberate, recommended starting point. Reports will accumulate at `support@pickgauge.com` over the coming weeks; revisit tightening to `p=quarantine` only after reviewing real report data, not on a timer. Also confirmed (Aug 26, Drew): despite the non-standard single-entry MX record (`smtp.google.com` priority 1, not the usual multi-record `ASPMX.L.GOOGLE.COM` pattern), `support@pickgauge.com` **can** receive mail — verified directly, not a blocker.
  - **Test fallout from the extraction, all fixed:** 5 `.mjs` test files (`test_client_logic`, `test_mypicks_logic`, `test_shortlist_logic`, `test_snapshot_logic`, `test_cfbd_insights_logic`) read `app/index.html`'s raw text and `extractFunction()`/`extractConst()` specific functions out of it by name — those functions (e.g. `round1`, `PRED_SHORT`) moved into `main.js` along with everything else in the old inline block, so the extractors came up empty. Fixed the same way this codebase already handles every other file split out of `index.html` (see `readJsFile()`'s own comment in `test_client_logic.mjs`): append `main.js`'s content to the `src` string these extractors search by default, rather than reimplementing anything. `test_script_paths.mjs`'s hardcoded "3 external CDN scripts" count also needed updating to 2 (pdf.js is no longer external). **All caught by actually running the suite before calling this done — not assumed safe because the diff looked mechanical.** Also ran the real 71-check Playwright/Chromium suite (`tests/test_e2e_ui_behaviors.py`) afterward specifically because a script-loading change is exactly the kind of thing a real browser catches that a Node-only test can't — all 71 passed, confirming the app actually boots with the new file layout, not just that individual functions are still reachable by string-extraction.

- **Launch-readiness continuation (Aug 25, ChatGPT): four open items closed or narrowed with permanent coverage.**
  - **HTML/attribute-injection P0 closed as no-repro, with a permanent hostile-input regression test.** `tests/test_html_injection_safety.mjs` now runs real hostile strings through `esc()` and `norm()`/`mkey()`, pins the `[a-z0-9]+@[a-z0-9]+` key invariant, confirms visible team names are escaped, and confirms the audited `data-pickteam="${g.key}"` path receives the normalized key rather than raw team text. 18/18 checks pass. This is stronger than leaving a prose-only "couldn't reproduce" note.
  - **Sagarin backtest mapping resolved and applied.** Sagarin's own documentation identifies PREDICTOR as PURE_POINTS, so backtest #1 "Sagarin Points" maps to `sagpred`; the Prediction Tracker separately identifies "Sagarin Ratings" as distinct from Predictor/Golden Mean/Recent, so backtest #2 maps to `sag`. `TOP_SYSTEM_RANKS` now includes rank #1/#2. Their composite values remain `null` because the original handoff did not retain those two numeric scores; the UI has a null-safe tooltip and never fabricates them. `tests/test_sagarin_mapping_logic.mjs` pins the mapping and the no-guess behavior (8/8).
  - **Redis TTL audit complete.** `tests/test_redis_ttl_integrity.py` confirms private account state and shared pool CAS writes use plain Redis `SET` with no expiration, shared odds/predictions use non-expiring writes, and grader state is also non-expiring. Only fixed-window abuse counters and the intentional ~26-week immutable prediction snapshots have TTLs. 8/8 checks pass.
  - **Responsible Play content audited/updated against current NCPG resources.** The page now mirrors Terms' legal-age/local-law framing, still states PickGauge is not a sportsbook, keeps `1-800-MY-RESET` as the primary National Problem Gambling Helpline, retains `1-800-522-4700` as the active alternate, and links directly to `1800myreset.org` for chat/help. `tests/test_responsible_play_content.py` pins the critical content (6/6).
  - **Documentation drift fixed:** `vercel.json` already contained HSTS even though this file's old priorities still said it was missing. HSTS is shipped; it is not an open task.
  - **Current test-suite shape:** 68 permanent test files total — 67 non-browser files plus `tests/test_e2e_ui_behaviors.py` (Playwright). The Aug 26 Claude environment recorded the full 57/57 files passing. Browser access to localhost varies by sandbox, so later reviews should run the browser file if possible and report environment blocking separately from assertion failures.



- **Logo fix (Aug 25, Claude):** the header brand mark (`<img src="/icon-96.png">`, present on every top-level HTML page plus `app/index.html`) and the Open Graph/Twitter share image (`icon-512.png`) were still the OLD logo design after a new set of logo files was uploaded under different filenames (`android-chrome-*.png`, `favicon.ico`, etc.) at the end of the prior session — those new files got wired into browser tabs/`site.webmanifest` correctly, but the two files actually referenced by every visible in-page `<img>` were never touched. Fixed by overwriting `icon-96.png`/`icon-512.png` in place with resized copies of the new design (sourced from `android-chrome-512x512.png`). Zero HTML changes needed anywhere.
- **Homepage copy rewrite (Aug 25, Claude), three rounds of iteration with Drew:** (1) removed the Brad Powers mention from the marketing homepage (`index.html`, distinct from `app/index.html`) — matches the "de-spotlighted" treatment already applied everywhere else in the app, and reframed around "20 of the best prediction systems." (2) Drew caught that the first draft implied PickGauge automatically combines all 20 into one composite by default — it doesn't; `state.enabledSystems` defaults to an empty array (confirmed in `app/js/main.js`'s `normalizeState()`), nothing is on until the user actively toggles it. Revised to "you choose which ones to use, set your own weights." (3) Drew asked for more homepage emphasis on the pool-import use case (PDF upload for Splash/ESPN, ESPN paste-text, or manual game selection for any other pool) — real, fully-built features that were underrepresented on the homepage. Rewrote "How it works" STEP_01 (was generic "Load the slate") to "Import your pool," and capability card 03 (was "Pool-Specific Lines") to "Import Any Pool," both now naming the three import paths explicitly. Homepage (`index.html`) only — `app/index.html` untouched by this round.

- **Live production auth 401 regression discovered + patched (Aug 25, ChatGPT):** Drew's live DevTools screenshot showed `/api/state`, `/api/fetch_cfbd`, `/api/fetch_teams`, and `/api/fetch_predictions` ALL returning the same auth-shaped 401 at once. That proved this was not a Prediction Tracker/source failure; PickGauge rejected the Clerk session before any protected feature call could run. Two hardening fixes were applied without weakening the existing JWT signature/issuer checks: (1) the `azp` allowlist now accepts both real production browser origins, `https://pickgauge.com` and `https://www.pickgauge.com` (plus optional comma-separated `PICKGAUGE_ALLOWED_AZP` extras for intentional aliases), because Clerk's `azp` is the exact browser Origin; (2) `apiFetch()` now retries exactly once after a real auth-shaped 401 using Clerk's documented `session.getToken({skipCache:true})`, so a stale short-lived token self-heals instead of forcing a manual sign-out/sign-in. Missing-key 401s are deliberately NOT retried. `tests/test_api_auth_retry_logic.mjs` (6/6) and expanded `tests/test_clerk_token_hardening.py` (11/11) pin both behaviors. **Production retest succeeded after deployment on Aug 25: Drew confirmed model-prediction loading works again.** The follow-up real JWT claim inspection was completed Aug 26: `azp` was confirmed present, no `aud` claim was present, and missing `azp` was hardened to fail closed (see the Aug 26 JWT entry above).

Current permanent suite: **68 test files total** — 67 non-browser files plus the one Playwright/Chromium E2E file. `scripts/test_all.sh` auto-discovers every `tests/test_*.py`/`tests/test_*.mjs` file, so file counts should be derived from the repo rather than copied forward from an older handoff.

- `scripts/test_all.sh --fast`: current non-browser target is **60 files**.
- `tests/test_e2e_ui_behaviors.py`: **71 Playwright/Chromium checks** (46 desktop + 25 mobile, at a 390×844 touch/mobile viewport). The Aug 26 Claude session recorded the full 57/57-file suite passing in an environment that allowed Chromium to reach localhost. Whether a later review sandbox can launch Chromium against `localhost` varies by environment (some block it, some don't), so treat browser availability as an environment fact and simply try the real file before making a claim either way.


## Cross-AI corrections log (why this file says "single source of truth" above)

Concrete, worth-remembering lessons from reconciling work handed off between sessions — kept here rather than lost, since the whole point of a single source of truth is that these don't have to be relearned.

1. **(Aug 19) A real bug slipped through undetected specifically because the e2e suite's "can't run here" note went unquestioned instead of re-verified.** `tests/test_e2e_ui_behaviors.py` line ~325 was clicking `[data-archive="p1"]` directly — a leftover from before the Pools-row tiered-menu change — but Archive now lives inside the "⋮ More" dropdown, hidden until its own trigger is clicked. Because the section had no try/except, this crashed the script and silently skipped 20 of the file's 46 checks in every real run, including some Results-analytics checks. Fixed by opening `[data-pooltrigger="p1_more"]` first, matching how the rest of the file already correctly handles `data-editlimit`. **Lesson: "this environment can't run X" is a claim about the environment, not the code — the code's actual correctness still needs verifying somewhere, and it's worth just trying before repeating the claim into a new session.**
2. **(Aug 19) A previously-shipped feature was listed as still-open in a separately-maintained roadmap doc.** ChatGPT's roadmap listed "Continue simplifying pool controls: consider placing secondary actions beneath a ⋯ menu (Edit / Publish / Archive / Delete)" as LOW/MEDIUM open work — it was already fully shipped, including every action it named. **Lesson: this is exactly the drift a second roadmap document produces. Going forward, roadmap/priority content lives HERE, not in a separately-maintained list on either AI's side — see the top of this file.**
3. **(Aug 19, mobile UX pass) The SAME "unverified environment claim" lesson from #1 recurred almost immediately, on a different handoff.** The mobile UX work was documented as "the canonical 62-check e2e file could not be re-run here end-to-end" (blamed on a Chromium-blocks-localhost limitation), with a smaller, non-permanent "self-contained acceptance harness" (26/26) substituted as a stand-in — and that unverified claim was written into this file as if settled. The next session ran the actual file directly: all 62 checks pass, confirmed twice including a negative control. **Lesson, restated because #1 apparently wasn't enough on its own: whether a sandbox can launch Chromium against `localhost` genuinely varies by environment, so the claim itself isn't the problem — writing it into the shared source of truth without trying the real file first is. Try it before it goes in this file, every time, not just the first time this bit someone.**
4. **(Aug 20) The mobile UX pass's own 16 new checks had a real, reported-by-Drew gap: none of them ever opened the Edge Board's "▾ Matchup breakdown" dropdown.** That dropdown (added earlier, same day, in different work) got unintentionally caught by the Board's mobile table→card CSS reflow: `.board tr{display:grid;grid-template-columns:60px repeat(4,1fr) 60px;}` applies to every `<tr>`, and the detail row's plain `<td>` (no `away-logo`/`game`/`edge` class, so none of the explicit column-placement rules matched it) fell into CSS Grid's auto-placement default — the first, 60px-wide logo column — crushing the whole panel into an unreadable sliver. Confirmed from an actual screenshot on a real phone, not caught by any of the 16 mobile checks that shipped alongside it. Fixed with a more-specific `.board tr.board-detail-row{display:block;}` override; 3 new mobile checks added that actually open this specific dropdown and check panel width/overflow, verified with a negative control (reverted the fix, watched the exact right check fail, matching the screenshot). **Lesson: a "mobile UX pass" is only as complete as the interactions it actually clicked through — new UI added the same day as the pass (or even earlier that day, by a different task) needs its own explicit mobile check, not an assumption that the broad overflow checks would have caught everything.**
5. **(Aug 20, same feature, second real bug from a second screenshot) Fixing the overflow didn't fix the actual complaint: the toggle rendered ABOVE the Vegas/CLV/Model#/Cover% stats (still nested in the Game column's cell, mobile row 1), when it needed to render AFTER them.** CSS `grid-row`/`grid-column` placement only works on direct `<tr>` children — content nested inside one `<td>` can never visually escape into a position after a DIFFERENT `<td>`'s row, no matter what CSS is applied to it. Genuinely required restructuring: the toggle moved out of the Game column into its own dedicated `<td>` (`board-cfbd-toggle-cell`), which needed a matching empty `<th>` in the header row so desktop's real `<table>` column count didn't misalign — then mobile CSS places that new cell at `grid-row:4` (a genuinely empty row, after the stats row). Verified with a real geometric position check (toggle's Y-position `>=` the stats row's bottom edge), not just an overflow check — confirmed with a negative control that reverting the row placement specifically (not the whole fix) makes exactly that check fail. **Lesson: "no horizontal overflow" and "positioned where it was actually asked to be" are different claims: the first mobile fix genuinely fixed overflow, and could easily have been mistaken for fully fixing the report, but the report was about POSITION specifically. Test the specific thing that was asked for, not just the general category of thing (overflow) it happens to resemble.**
6. **(Aug 20) A third real screenshot: the Edge Board's toolbar (Weekly Setup card, sort dropdown, two filter checkboxes, the legend, "Load model predictions") stacked into ~9 persistent rows before a single game was visible on a phone.** Three fixes, all in the "Product work already complete" section below (Mobile UX hardening entry) — collapsed Sort/Filters/Legend into one `<details>` panel (closed by default on mobile, open on desktop, matching the Prediction Systems panel's own existing pattern); the Weekly Setup card now disappears entirely once genuinely complete instead of shrinking to a compact card (folded into the Context Bar's own line2 instead); "Load model predictions" shrinks to a quiet "reload" text link once predictions are already loaded. **A real bug found and fixed while building item 2's compact-mode threshold specifically**: `computeSetupDisplay()`'s old `allOk && !warnings.length` check meant a genuinely 4-of-4-complete pool (matching the actual screenshot) STILL showed the big itemized card, purely because an unrelated stale-odds warning was present — even though every warning that function can produce already duplicates something the Context Bar's own line shows. Fixed to key off `okCount===requiredCount` instead. **A second real bug found while writing the e2e test FOR that fix, not in the fix's own logic**: the new mobile check initially failed because `renderContextBar()` deliberately no-ops on tabs without shared widgets (`TABS_WITHOUT_SHARED_WIDGETS`), and the test's `page.evaluate()` never switched back to a tab where it actually re-renders — so `#ctxLine2` still showed stale text left over from an earlier test step, even though `computeSetupDisplay()` itself was already returning the correct answer. Root-caused with a live debug dump inside the real sequential test run (an isolated standalone repro of the same seed had NOT reproduced the failure, since it didn't carry the same leftover tab state a long sequential run does) rather than guessed at. **Lesson: a test failure isn't always a bug in the code under test — sometimes it's a gap in the test's OWN setup, and the fix is to make the test's state assumptions explicit (here: which tab is active) rather than assume a fresh page's defaults. Verify which one it is with a real debug dump inside the actual failing context, not an isolated reproduction that might not carry the same accumulated state.**

- **Second real Splash pool-sheet shape found and fixed, plus the error-masking bug that hid it (Aug 28, Claude) — closes a real live-import failure.** Drew tried importing a real Madwood pool's Week-1 2026 sheet (a "pick every game"/confidence-style Splash template, 25 games with a per-game 1-point winner pick and a combined-score tiebreaker — structurally different from the pick-7 "Edit picks" template `REAL_SPLASH_WK1_PRELIM_SAMPLE` already covers) and got a generic 500 ("Something went wrong processing that request") with zero indication of why.

  **Bug #1, the actual reason was hidden:** `api/parse_pool.py`'s `do_POST` caught every exception with one broad `except Exception`, including the deliberate, already-user-facing `ValueError` that `parse_pool_lines()` raises for expected conditions (no games found, unsupported source) — flattening a real, specific reason into the generic message every time. Fixed by catching `ValueError` separately and responding 400 with the real message; a genuinely unexpected (non-`ValueError`) exception still logs server-side and returns the generic 500 as before — confirmed both paths with a real `do_POST` invocation (`tests/test_parse_pool_error_shape.py`, new, 9/9), not just source inspection.

  **Bug #2, the sheet itself didn't parse:** confirmed via a real Playwright + the actual vendored `app/vendor/pdfjs/*` build running the real `extractPdfTextLines()` against Drew's actual Madwood PDF (same standard as the earlier Splash acceptance test) that this template's real shape is genuinely different: the spread glues directly onto the team name with **zero separator** — no parens, no space (`"+6.5Colorado"`, `"-6.5Georgia Tech"`), unlike either existing paren-based shape. The header line's leading spread badge and trailing away-abbreviation also land inconsistently (sometimes glued onto the weekday/date/time text, sometimes stranded on an unrelated adjacent line), which broke `HDR_RE`'s anchored match. **Worth noting for future sessions:** an initial fix attempt was built from a `pdfplumber`-based coordinate simulation reasoned through without running a real browser — that simulation's gap measurements didn't actually match real pdf.js behavior on this file and would have shipped a wrong fix (a `clusters.slice(0,2)` "bug" that turned out not to be one). Re-verified with the real harness before writing anything — same "verify against the real thing, not memory" standard as the original Splash acceptance test.

  Fix (`api/parse_pool.py`): new `TEAM_RE_GLUED` regex (mandatory sign, since every real sample line carries one — this is what keeps it from matching an unrelated glued run of prose that happens to end in a bare unsigned number, e.g. tiebreaker instructional text) tried as a third fallback after LEADING/TRAILING. `HDR_RE` changed from an anchored `.match()` to `.search()` since the header pattern no longer reliably sits at the start of the line. New `PICKS_RE_BARE` (a bare `"0/25"` line) since this template's footer never uses the word "picks made" that the two existing pick-limit regexes require — `pickLimit` was silently coming back `null` even though the sheet states it plainly. `detect_source()` now explicitly recognizes this template's `"Picks lock:"`/`"Spreads lock:"` phrasing (reversed order and pluralization from the original template's `"Spread locks:"`) instead of only reaching `parse_splash()` by coincidence of there being nothing else to fall back to.

  Test coverage: `tests/test_pool_parsing.py` gained `REAL_MADWOOD_WK1_PRELIM_SAMPLE` — the actual real captured `extractPdfTextLines()` output from a real Playwright + real pdf.js run against Drew's real file, embedded verbatim (same standard as `REAL_SPLASH_WK1_PRELIM_SAMPLE`) — confirming all 25 games, correct sign conventions, correct `pickLimit`, a header line that lost its own leading spread badge, a multi-word glued team name, and the last game in the sheet all parse correctly; plus isolated `TEAM_RE_GLUED` unit checks. Full suite: 66/66 (65 existing + the new `test_parse_pool_error_shape.py`), including the original 43-game pick-7 Splash sample unchanged — confirms this is additive, not a regression.

- **"Overall board" banner removed from the top of the Pools tab (Aug 28, Claude), Drew's explicit call.** The pinned card at the top of Pools (`#poolsOverallCard`, populated by `renderPoolsPage()` in `app/js/pool-contexts.js`) showed "Overall board — The default analysis context..." with a "currently viewing"/"View" toggle. Removed the container `<div>` from `app/index.html`, the JS block that populated it, and the now-dead `.pool-overall-card` CSS. Switching back to Overall board is still available from the global Context Bar switcher (unrelated code, not specific to this tab), so this doesn't remove the only way to get there — just this one redundant card. Verified live in a real Playwright render: the tab now opens directly on "Import a pool sheet," no leftover gap. Full suite: 66/66.

- **Last remaining thepredictiontracker.com mention removed from privacy.html (Aug 28, Claude), closing the Aug 24 open item.** Every other user-facing surface was already de-spotlighted Aug 24 (name/link stripped, honest unnamed disclosure kept). `privacy.html`'s third-party-services list was the one deliberately-left-open exception at the time ("different purpose — third-party data-flow disclosure alongside Clerk/Vercel/Upstash, not credit — flagged to Drew as a separate open call, not yet decided"). Drew's call now: remove it there too. Changed "The Odds API and thepredictiontracker.com" to "The Odds API and third-party computer prediction-system providers" — same honest-disclosure pattern as everywhere else, no name. Checked every remaining occurrence of the string across the repo first: all 11 are inside `//`/`<!-- -->` code comments (internal, never rendered to a visitor), deliberately left untouched per the original Aug 24 reasoning. `tests/test_beta_analytics_feedback.py` and `tests/test_sitemap_social_metadata.py` (the two files that touch `privacy.html`) re-run clean, no assertion pinned the old wording. Full suite: 66/66.

- **Entry progress wording clarified to "N/limit picks selected" (Aug 28, Claude), Drew's call — no timestamps.** Drew liked the "5/7 picks selected" framing from the backlog but explicitly didn't want a submitted-at timestamp alongside it. Two spots already tracked this count but said it plainly/subtly: the global Context Bar's line2 (`computeContextSummary()`, `app/js/pool-contexts.js`) said `"3/7 picks"`, and My Picks' per-entry row (`renderEntries()`, `app/js/picks.js`) showed a bare `"3/7"` in small muted-gray monospace easy to miss next to the Draft/Ready/Submitted badge. Both now say `"3/7 picks selected"`; the My Picks entry badge also got a real visual bump (muted gray → `var(--ink)`, 12px → 12.5px, added `font-weight:600`) so it reads as actual status rather than filler metadata. No new timestamp anywhere — `entryWorkflowStatus()`'s existing `submittedAt` field is untouched and still not surfaced in either location, matching Drew's ask. `tests/test_context_bar_logic.mjs`'s existing assertions use `.startsWith("3/7 picks")`, so the appended " selected" didn't require any test changes there; re-ran clean regardless, along with `test_entry_workflow_logic.mjs`/`test_mypicks_logic.mjs`. Verified live in a real Playwright render at both locations. Full suite: 66/66.

- **Inline `<style>` block extracted into `app/css/app.css` (Aug 28, Claude).** The last major inline block left after the Aug 25 JS-splitting pass — CSS just hadn't been split the same way. `app/index.html`'s ~1,437-line inline `<style>` block (lines 55–1491) moved verbatim into a new `app/css/app.css`, loaded via a plain `<link rel="stylesheet" href="/app/css/app.css">` tag placed at the exact same position the `<style>` block occupied — same absolute-path, no-build-step reasoning already established for every `<script src="/app/js/...">` tag (the page is served at the exact path `/app` with no trailing slash, so a relative path breaks). No CSP change needed: `style-src` already includes `'self'` (see `vercel.json`), which covers a same-origin linked stylesheet; the existing `'unsafe-inline'` there stays only because Clerk's own components require it, unrelated to this file. Pure organization — zero visual or behavioral change, confirmed via a real Playwright render (identical output to before the split).

  **Test fallout, same pattern as the Aug 25 JS-splitting pass:** 7 `.mjs` test files read `app/index.html`'s raw text and regex-matched CSS selectors/rules directly out of it (`test_board_cfbd_dropdown_logic`, `test_dialog_migration`, `test_my_numbers_logic`, `test_nav_hamburger_wiring`, `test_pickgauge_model_logic`, `test_pool_setup_cta_logic`, `test_snapshot_quicklook_layout`) — those assertions came up empty once the CSS moved out. Fixed the same way this codebase already handles every other file split out of `index.html`: each file's `html`/`htmlSrc`/`indexSrc` read now also reads and appends `app/css/app.css`'s content, rather than reimplementing anything. All caught by actually running the suite before calling this done, not assumed safe because the diff looked mechanical. `NEW_SESSION_START_HERE.md`'s own architecture description updated to match (previously described `app/index.html` as containing "the `<head>`/CSS/HTML markup" — no longer accurate). Full suite: 66/66.

- **JSON-LD structured data added to the marketing homepage (Aug 28, Claude).** Drew's call after an SEO discussion — the site had zero schema.org markup anywhere. Added a `WebApplication` block to `index.html`'s `<head>` (name, url, description matching the existing meta description, `applicationCategory: SportsApplication`, the real `social-share.png` as `image`, an `offers` block reflecting the CURRENT actual state — free, no paywall, `price: "0"` — not a permanent pricing commitment, just today's fact, revisit if/when Pro tiers ship, and a nested `Organization` publisher block). Deliberately did NOT add `FAQPage` schema: Google's structured-data guidelines require schema to match visible on-page content, and the app's real FAQ content lives inside the signed-in app behind Clerk auth (`Disallow: /app/` in robots.txt) — adding FAQ schema to a page with no visible FAQ content would violate that. `tests/test_sitemap_social_metadata.py` extended with a real check (parses the actual embedded JSON, not just presence-of-tag) confirming valid JSON, the schema.org context, and every required field (32 checks, up from 21). Full suite: 66/66.

  **Broader SEO context, not acted on yet, Drew's call whenever he wants to prioritize it:** the bigger gap isn't technical (metadata/robots/sitemap were already solid) — it's that the site has no content targeting how people actually search (no blog, no public FAQ; the FAQ content that exists is trapped behind auth) and only 6 indexable pages total. Low priority relative to real second-user validation and physical mobile testing, worth revisiting once a real 2026 beta group is running.

- **X (Twitter) link added to the marketing homepage (Aug 28, Claude).** Drew's call — `https://x.com/PickGauge` added to `index.html`'s footer, styled identically to the existing Methodology/Privacy/Terms/Contact/Responsible Play links. Since this is the first external link on this page, it gets `target="_blank" rel="noopener noreferrer"` (opens in a new tab rather than navigating away from the marketing page; `noopener` closes off the new tab reaching back into `window.opener`). Also added the same URL as `sameAs` on the JSON-LD `Organization` publisher block added earlier the same day — the correct schema.org way to associate a social profile with the entity, and directly strengthens that same structured-data addition rather than sitting separately from it. `tests/test_sitemap_social_metadata.py` extended with 3 more real checks (footer link presence, the exact `target`/`rel` attributes together, and the JSON-LD `sameAs` value) — 35 checks, up from 32. Full suite: 66/66.

- **Real "hide an unwanted admin-published pool" gap fixed (Aug 28, Claude), Drew's ask.** Drew asked whether a user could hide a published pool from their dropdowns if they didn't want to see it. Investigated first rather than assuming: `archivePool()`'s own code comment already claimed archiving "hides the pool from the normal Pools list and the Context Bar's 'Viewing' switcher" — but neither `renderContextSelect()` (the `.ctx-select` dropdown) nor `renderContextSwitcherContent()`'s `viewRows` (the Context Bar's own "Viewing" list) actually filtered on the `archived` flag. Archive correctly hid a pool from the main Pools tab list, but it stayed fully visible in both dropdowns — the comment was aspirational, not accurate. Fixed both to filter `!p.archived`, so Archive now genuinely does what it always claimed to (a bug fix, not a new feature) — confirmed live with a real Playwright render (Context Bar switcher screenshot before/after).

  **Second, related gap:** deleting (not archiving) a pool that originated from an admin-published template didn't actually stick — `deletePoolById()` only removed it from `state.pools`, and `mergeSharedPoolsIntoLocal()`'s own guard (skip if this id is already local) would then silently re-add it the very next time the shared tier synced, since nothing tracked that the deletion was a deliberate decline. Fixed with a new private, per-account, synced field `state.declinedSharedPools` (an array of pool ids): `deletePoolById()` now records the id there, but only if the pool actually came from `state.sharedPools` in the first place — a manually-created pool was never going to reappear on its own, so nothing extra is tracked for those. `mergeSharedPoolsIntoLocal()` now skips any id already in that list.

  Test coverage: `tests/test_pools_page_logic.mjs` — 3 new `deletePoolById()` cases (records the decline for a published pool, doesn't track anything for a manually-created one, doesn't duplicate an already-declined id) plus 2 new dropdown-filter cases (a real extracted `renderContextSelect()` run confirming an archived pool's `<option>` is genuinely absent; a source-text check pinning `renderContextSwitcherContent()`'s equivalent filter, since fully mocking that function's entry/week DOM wasn't worth building for one line). `tests/test_mypicks_logic.mjs` — 5 new `mergeSharedPoolsIntoLocal()` cases against the real extracted function (adds a new shared pool, doesn't duplicate an existing one, does NOT re-add a declined one — the actual fix, a decline is scoped to just that one pool id, and a missing `declinedSharedPools` field doesn't throw). Full suite: 66/66.

## Highest-priority remaining work

1. **Deploy current code, then full production smoke test + email sign-in.** Google OAuth is already confirmed. Still run email/password (or email-code) auth, then an incognito production flow: sign in → Edge Board → import/load real data → make a pick → Snapshot/My Picks/Results → sign out/in and confirm persistence. **This deploy specifically needs to include the Aug 28 Clerk revert back to `clerk.pickgauge.com`** (see the dated entry below) — confirm Vercel's Production `CLERK_JWKS_URL` was actually updated back to the production value and a fresh deploy triggered, or sign-in on the live site is currently broken (frontend issuing production tokens, backend still checking against the old Development-instance JWKS).
2. **Physical iPhone/Android signoff.** Browser-level mobile/touch validation is extensive, but still do one real Safari-on-iPhone + Chrome-on-Android pass for keyboard/focus behavior, tap feel, import controls, and the dense Board/Snapshot interactions.
3. **Live 2026 CFBD/closing-line validation.** Matchup Intelligence's populated `/stats/season/advanced` field shape is now validated and v2 semantics are fixed. Still confirm schedule identity joins, live/final status, automatic grading, and retained pre-kick lines through reschedules/postponements/FBS-vs-FCS/neutral-site games during real Week 1 operation.

Done as of Aug 28, no longer on this list: **SPF + DKIM + DMARC, all three, fully complete** — confirmed via MXToolbox (DMARC record published, valid syntax, single record, external validation passed; `p=none` monitor-only is the deliberate current state, not a gap). Also done as of Aug 26 (see the dated entries above / Aug 26 session summary for full detail): real locked Splash pool-sheet acceptance test, Clerk JWT inspection + `azp` fail-closed hardening, live Upstash CAS concurrency test, the 57-file full-suite run recorded in the Aug 26 Claude environment, the Python dependency-security upgrade (`pdfplumber==0.11.10`, `PyJWT[crypto]==2.13.0`), and first-party product analytics + in-app beta feedback.

## Production auth: moved off clerk.pickgauge.com (Aug 27) then REVERTED BACK (Aug 28) — the Gambling categorization that caused the move is resolved

**Talos removed the Gambling category from pickgauge.com, and Drew confirmed pickgauge.com is reachable again from his previously-blocked work network.** The Aug 27 move to Clerk's Development instance was always an explicitly accepted *temporary* tradeoff for as long as the underlying block existed — not a permanent architecture choice — so it was reverted the same way it was built: deliberately, with full test coverage both directions, not just undone informally.

**What changed back** (`app/index.html`, `vercel.json`): the two Clerk `<script>` tags and the CSP header's `script-src`/`connect-src` are back to `clerk.pickgauge.com` with the real production `pk_live_...` key — byte-identical to the original pre-Aug-27 state.

**What was deliberately KEPT, not reverted**: `_ALLOWED_AZP` across all 9 `api/*.py` files still includes `https://cfb-ats-dashboard.vercel.app` as a permanent secondary origin. Costs nothing to leave in place, and gives a fast, now-twice-exercised, fully-tested path back to a working state if this categorization ever regresses again — this isn't theoretical resilience, it's a real procedure that's now been run in both directions. The homepage copy softening (`index.html` marketing page — "Top Pool Pick," "market/reference spreads," "calculated model disagreement," the added disclaimer) was also kept — no reason to revert language that's accurate and lowers the odds of a future recategorization regardless of what caused this one.

**Still needed from Drew** (Vercel dashboard, can't be done from this repo): revert `CLERK_JWKS_URL` in Vercel's Production environment back to `https://clerk.pickgauge.com/.well-known/jwks.json`, then trigger a redeploy — env var changes don't apply retroactively to what's already live.

Test coverage: `tests/test_clerk_dev_instance_permanent.mjs` (the Aug 27 file) renamed to `tests/test_clerk_production_domain_restored.mjs` and rewritten to check the reverted state — same rigor both directions (checks the intended values' presence AND the unintended values' absence, so a half-reverted state can't silently pass). `tests/test_vercel_headers.py` and its CSP assertion reverted to match. Full suite: 66/66. Verified live in a real browser render: correct `clerk.pickgauge.com` script tags in the rendered DOM, zero JS errors.

**If this needs to move again in the future** (a categorization regression, a different network block, etc.), both this entry and the equivalent Aug 27 entry together form a complete, tested playbook — not a from-scratch investigation.

## Homepage copy softened for a second Talos submission (Aug 27, Claude) — KEPT after the Aug 28 revert

Talos's human reviewer added "Sports and Recreation" as an additional category but explicitly left "Gambling" in place too — Talos adds categories, it doesn't replace them, so both being present is still enough to keep the block active on category-based filters. Per Drew's request (`index.html`, public marketing page only, in-app dashboard untouched): "Recommended Bet" → "Top Pool Pick" (preview graphic table header), "sportsbook lines" → "market/reference spreads" (feature description), "calculated ATS edge" → "calculated model disagreement" (comparison list), and a new explicit disclaimer added as real visible page content (not buried footer text, since Talos's reviewers read actual page content): *"PickGauge is a college-football pick'em pool analytics platform. PickGauge does not accept wagers, deposits, bets, or sportsbook transactions."* Verified rendered correctly in a real browser. No test coverage needed/added (pure marketing copy, no logic). **Next step, Drew's to do once this deploys**: submit a fresh Talos ticket referencing the updated page — a second request against visibly different content has a better shot than resubmitting against the same page already reviewed once.

## Firebase Auth migration — ABANDONED (Aug 27), superseded by the permanent Clerk Dev-instance move above

Was seriously scoped earlier the same day (verified technical approach: Firebase ID tokens are RS256 JWTs verifiable via a real JWKS endpoint, so the existing `PyJWT`/`PyJWKClient` pattern could have been reused). No code was ever written for it. Superseded once the SNI/curl test revealed the block was specific to the `pickgauge.com` hostname pattern (not IP or content-based), which meant staying on Clerk but changing which domain it's bound to was sufficient — a much smaller change than a full auth-provider migration. **Don't resurrect this unless the Clerk Dev-instance approach above turns out to have a real problem** (e.g. the 100-user cap becomes a genuine constraint at real launch).

## Current prioritization call

Launch-readiness remains the default priority. PickGauge Model # is now built as a standalone model experience, but **premium membership/entitlement work is intentionally deferred** until later; do not add billing or gating as part of model UX work unless Drew explicitly asks. Do not expand into additional speculative model features ahead of the production smoke test, email sign-in validation, DMARC, physical-device signoff, and live-2026 validation unless Drew reprioritizes again. Matchup Intelligence and historical lines are already built; model correlation/optimized weighting remains tabled.

## Rotation-number matching — BUILT (Aug 27, Claude)

**No longer blocked.** Drew ran the real comparison (fixed browser console script, correct field names `away_rotation`/`home_rotation` after an initial mistake using the wrong ones) against a live Odds API pull and a real Powers PDF for the same week: **confirmed Brad Powers' rotation numbers match The Odds API's rotation numbers for the same real games.** That's the decision gate this thread was waiting on, and it passed.

Built:
- `api/fetch_odds.py`: requests `includeRotationNumbers=true`; `extract_games()` includes `awayRotation`/`homeRotation` on each game only when The Odds API actually provides one (never a null placeholder — omitted entirely, so client code can use a plain truthiness/undefined check).
- `api/parse_pdf.py`: the rotation number it already extracted internally (previously used purely as an away/home pairing + cross-page join key, then discarded) now flows into the final output as `awayRotation`/`homeRotation`.
- `app/js/pdf-import.js`: new `findBoardGameByRotation()`, tried FIRST in `applyPdfData()`'s matching chain, before the existing exact-`mkey` and fuzzy-`teamMatch()` fallbacks — both of which are completely unchanged and still the only path for any game where either source lacks a rotation number (confirmed common for lower-profile FCS-opponent buy games — The Odds API often doesn't bother assigning them one at all). Requires an exact match on BOTH away and home rotation numbers, same "both sides must agree" reasoning `findBoardGame()` already used.

Real-world value confirmed directly in test, not just assumed: a synthetic case with genuinely garbled/mismatched team names (standing in for the actual failure classes this project has hit for real — the ranked-team `"(10)Oklahoma"` parsing bug, PDF ellipsis truncation) matches correctly via rotation number while the equivalent name-based lookup on the same inputs genuinely fails, proving this is real added robustness, not a redundant second path to the same answer.

Tests: `tests/test_rotation_numbers.py` (9 checks, server-side extraction/schema), `tests/test_rotation_number_matching_client.mjs` (12 checks, client-side matching including the full `applyPdfData()` integration — caught and fixed a real test-setup bug of my own along the way, where a missing `state.lastGames` stub silently made the test pass via the wrong code path). Full suite: 65/65 (63 → 65, two new files).

## Feature ideas under consideration (not started, no priority order implied)

Captured here (not as a separate roadmap doc — see "single source of truth" note above) so they're not lost, but deliberately kept at summary depth; expand into real spec/design only when actually starting one.

**CFBD-powered context (biggest visible product upside, per ChatGPT's own assessment):**
- ~~Matchup Intelligence v2~~ — **shipped, see "Product work already complete" above.** Populated live 2026 field shape, garbage-time filtering, FCS coverage, early-season sample disclosure, completed-game hindsight protection, offense-havoc vs defense-havoc semantics, and classification-aware national rank/percentile context are all implemented.
- ~~Historical CFBD betting-line integration~~ — **shipped as a "line check" comparison, see "Product work already complete" above.** Deliberately does NOT do the "backfill older games into CLV" part yet — that's flagged there as a separate, later decision, not started.
- **WEPA / opponent-adjusted metrics** — now that both Matchup Intelligence and historical lines have landed; display alongside raw efficiency, not folded into Model #.
- ~~Advanced postgame box-score analysis~~ — **shipped, see "Product work already complete" above.** The Results → Why? panel now includes archived ATS result/cover margin, overall read, top three statistical separators, and the full comparison table. Turnovers field-name verification is the only remaining data-shape caveat.
- **CFBD ATS history/context** — a team's own season ATS record and average cover margin as pure context, not a model input.
- **Weather warnings** — simple flags (wind/rain/heat/cold) on the board for extreme conditions only; detail belongs in Snapshot.
- **Preseason-only context** (returning production, Team Talent Composite, transfer portal impact) — for Weeks 0-4 when current-season stats are noisy.
- **CFBD "Saturday Mode"** — a dedicated live-multi-game view once normal pool usage is established; not current priority.

**Results/analytics:**
- ~~Full-slate model ATS performance dashboard~~ — **shipped Aug 30.** Prospective pre-kick snapshots now grade PickGauge Model # + curated prediction systems across every captured game, independent of the user's selected picks; Results also includes PickGauge edge/favorite-dog/home-away splits. See the completed-work bullet above for methodology/limitations.
- **The remaining research below still needs real 2026 sample size before being interpreted or expanded:**
- Statistical confidence intervals around ATS%/calibration once sample sizes grow (a 6-2 record shouldn't visually read the same as 60-35).
- CLV-vs-ATS and Model-Agreement-vs-ATS performance breakdowns.
- Conference/ranked/neutral-site/time-of-day/week-of-season filters, added only once sample size can support real conclusions.

**Pool/entry workflow:**
- Real-world test Draft → Ready → Submitted in an actual pool; watch for friction around locking/unlocking/switching entries.
- Clearer weekly entry progress ("5/7 picks selected", "Submitted at 11:42 AM").
- Review how intuitive Publish/Unpublish template is for a recipient account — make sure they understand it's a one-time template copy, not ongoing sync.

**Frontend/infra, low priority:**
- ~~Extract the large inline `<style>` block out of `app/index.html` into `app/css/app.css`.~~ — **shipped Aug 28, see "Product work already complete" above.**
- Keep splitting `app/js/*.js` only when there's a genuinely clear responsibility boundary; don't fragment just to reduce line count.

**Production/security (see "Highest-priority remaining work" #3 above for the actionable version of this):**
- Full account-flow testing in a fresh/incognito session once production Clerk is live: signup, login, logout, cross-device sync, backup/restore, account deletion, expired sessions, unauthorized API calls.

**Product/business (Drew's call, not an engineering priority call):**
- Recruiting a small real 2026 beta group is probably the single most important product validation once the season starts — whether other people voluntarily use this weekly matters more than any feature above.
- Free vs. Pro feature boundaries — decide after observing real usage, not up front.
- Commissioner product (an admin running the whole pool: participant accounts, deadlines, locking, standings, exports) — potentially the strongest acquisition mechanism, but explicitly LATER.
- Notifications/alerts (line movement on a saved pick, key-number proximity, incomplete entry before deadline) — LATER.

## Lower-priority / later

- **Tabled:** model correlation/optimized weighting. Keep as a long-term research idea; do not change the production Model # for this now.
- Deeper Results research once enough 2026 graded picks exist (conference/context splits, confidence intervals/significance, and deciding which observed patterns are stable enough to matter).
- ~~Public Methodology page~~ — **shipped, see "Product work already complete" above.**
- Verify Responsible Play resource details immediately before wider public launch.
- Deliberate full palette change only if doing a coordinated redesign; avoid piecemeal hex swapping.
