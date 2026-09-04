# PickGauge Session Summary — Model Performance Week Scope + Standing Open Item
Date: 2026-09-03
Build target: 09-03-H
Source of truth: user-uploaded `pickgauge-2026-09-03-G-pick-board-sort-visibility-fix.zip`

## Goal
Drew wanted to see each prediction system's ATS record for a specific
week on Results (e.g. "Sagarin Ratings went 24-18 this week"), across any
week, for every tracked system — not just a lifetime aggregate. Initial
ask was framed as "on the overall board," narrowed after clarifying
questions to: Results tab is fine, per-week not per-game, full system
list not just a consensus count, all weeks not just current.

## What we found before writing any code
The underlying filtering already existed — `modelPerformanceRows()` in
`app/js/record.js` already accepted `{season, week}` filters and applied
them. Selecting a week in the existing Results filter dropdown already
produced a per-week breakdown. So this was mostly a "make it visible,"
not "build it" task — except for one real bug found while checking:

**Bug:** `modelPerformanceRows()` computed each system's displayed
side/edge from `g.marketHomeLine` (the line frozen at this account's own
last pre-kick snapshot) even though `api/grade_picks.py`'s
`_grade_model_performance()` (built earlier this session, see
`CURRENT_STATE.md`'s Sept 2 "Model performance grading now uses the real
closing line" entry) already grades `g.systemResults` against the real,
shared closing line (`g.closingHomeLine`) whenever one is resolved. This
meant the displayed side/edge — and every favorite-vs-underdog,
home-vs-away, and edge-size breakdown built on top of it — could disagree
with the actual stored W/L/P result for the same system on the same game,
if the market moved between this account's last snapshot and the real
close.

## Changes

### `app/js/record.js`
- `modelPerformanceRows()`: now reads `g.closingHomeLine` first, falling
  back to `g.marketHomeLine` only when no closing line was resolved for
  that game — same fallback convention grading itself already uses. This
  is the correctness fix; every downstream analytics function
  (`modelPerformanceAnalytics()`, the edge/favorite-dog/home-away bucket
  tables) inherits it automatically since they all consume this
  function's output.
- New `recordModelPerformanceScopeLabel(filters)`: returns `"Week N,
  YYYY"`, `"Week N"`, `"YYYY season"`, or `"All weeks"` depending on the
  active season/week filter state.
- `recordModelPerformanceHTML()`: heading now reads `"Model performance —
  <scope>"` instead of always generic `"Model performance"`. Description
  text updated to spell out the actual framing Drew asked for and to
  describe the closing-line-preferred/fallback behavior explicitly, not
  just "the market line."

### Tests
- `tests/test_model_performance_history_logic.mjs`: +10 checks (24
  total). Covers the closing-line-vs-stale-line fix with a real example
  where the displayed side flips depending on which line is used, the
  fallback-when-no-closing-line case, and every `recordModelPerformance
  ScopeLabel()` variant plus the rendered heading text for both a
  filtered and unfiltered state.
- New `tests/_render_model_perf_week_scope.py` (one-off Playwright, 4
  checks): seeds two real weeks of `modelPerformanceHistory` directly,
  drives the actual Results tab in headless Chromium, confirms the
  heading reads "All weeks" by default and "Week 1" once filtered, and
  that the filtered table shows only that week's record. Screenshot-
  confirmed visually, not just assertion-based.
- Full suite (`scripts/test_all.sh`): 118/119 files passed. The single
  failure (`test_e2e_pools_hides_shared_widgets.py`) is a **pre-existing,
  unrelated** issue — see "Standing open item" below. Confirmed it fails
  identically on a completely untouched copy of the delivered zip before
  any change in this session.

## Intentionally unchanged
- ATS setup wizard rules/behavior
- Pool importer/parser logic (including today's earlier two-column Splash
  PDF fix — untouched, still working)
- Grading logic in `api/grade_picks.py` itself (only the *display* layer
  in `record.js` was out of sync with it, not grading)
- Edge Board rendering/model math
- Confidence, Survivor
- Pick Board navigation/Pool Settings landing

## Standing open item — not fixed this session, needs attention
`tests/test_e2e_pools_hides_shared_widgets.py` fails with a Playwright
timeout waiting on `[data-pickboard-view="pools"]` ("Pool Settings")
becoming visible/stable. **Confirmed pre-existing**: fails identically on
a clean, unmodified copy of `pickgauge-2026-09-03-G-pick-board-sort-
visibility-fix.zip` before any change described above. Likely related to
the Pick Board navigation refactor from earlier today (`SESSION_SUMMARY_
2026-09-03_PICK_BOARD_FLOW.md`) — the element resolves in the DOM per the
error log, it just never becomes visible/stable within the test's
timeout. Worth a real-browser investigation (open Pick Board → Pool
Settings manually, check for a CSS/animation/z-index issue, or a
render-timing race) before the next Pick Board change builds further on
top of it.

## Also worth knowing (context, not a defect)
Drew is staying on Vercel's Hobby plan. Confirmed via web search this
session: Hobby caps cron jobs at once-per-day (any more frequent schedule
is rejected at deploy time); Pro allows per-minute. No code change was
made for this — the existing daily cron (`0 14 * * *` UTC) + manual
"Check results now" button remain the only two grading triggers. Worth
remembering if a future ask assumes faster automatic turnaround than that
schedule actually allows.
