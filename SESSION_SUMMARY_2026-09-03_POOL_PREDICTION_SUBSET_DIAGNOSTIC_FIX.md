# PickGauge handoff — Pool Prediction Subset Diagnostic Fix (2026-09-03)

## Why this build exists
After the Madwood 25-game Splash PDF was fixed, the browser console still showed:
`Prediction rows not matched to board: (18)`.

This looked like another PDF parsing failure, but it was not. The weekly PredictionTracker feed contained 43 games while the selected Madwood pool intentionally contained only 25. All 25 pool games matched; the 18 console rows were simply games outside the pool.

## Root cause
`applyPredictions()` treated feed rows outside the current board as failures and `fetchPredictions()` surfaced their count as `unmatched (see console)`.

For subset pool boards, that diagnostic direction is backwards. Off-pool prediction rows are expected. The actionable mismatch is a *board/pool game that did not receive prediction data*.

## Changes
### app/js/pdf-import.js
- Kept `lastPredUnmatched` for compatibility/diagnostics; it now represents feed rows that are off-board.
- Added `lastBoardPredMissing`.
- After prediction matching, computes board rows that did not receive a prediction row.
- Off-board weekly feed rows no longer emit a warning.
- In a selected pool, only missing pool-board prediction rows emit:
  `Pool games missing PredictionTracker data:`

### app/js/prediction-tracker.js
- Removed the misleading `${unm} unmatched (see console)` success suffix.
- Selected pools now report coverage as `matched/boardTotal pool games matched`, e.g. `25/25 pool games matched`.
- If a pool game is actually missing model data, status becomes amber and says exactly how many pool games are missing.
- Same pool-coverage behavior added to the recent-cache path.

## Regression coverage
Added:
- `tests/test_pool_prediction_subset_matching.mjs`
  - 25 on-pool + 18 off-pool feed rows -> 25 matches, no warning, 0 missing pool games.
  - Removing one on-pool row -> 24 matches, 1 missing pool game, actionable warning.
- `tests/test_prediction_pool_subset_status.mjs`
  - 43 rows loaded + 25-game selected pool -> status says `25/25 pool games matched`.
  - Does not say `unmatched`.
  - Full pool coverage stays green.

Updated the two existing PredictionTracker matcher tests to initialize the new `lastBoardPredMissing` diagnostic variable.

## Validation
- 76/76 standalone front-end Node regression files passed.
- No Python/API/PDF parsing code changed in this batch.

## Important interpretation
The screenshot that triggered this fix did not show a failed Madwood parse. The 18 listed matchups were all outside the Madwood 25-game pool. The PDF extraction/parser fix from build E remains intact.
