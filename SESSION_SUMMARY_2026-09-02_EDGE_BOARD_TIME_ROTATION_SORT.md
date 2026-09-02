# PickGauge session summary — Edge Board Game Time + Rotation sorting

Date: 2026-09-02
Base: `pickgauge-2026-09-02-K-powers-pool-match-fix.zip`

## Implemented
- Added `Game time` as an Edge Board sort option.
  - Default direction: ascending / earliest kickoff first.
  - Missing kickoff timestamps always sort last.
  - Games at the same kickoff use rotation number as the first tie-breaker, then matchup name.
- Added `Rotation #` as an Edge Board sort option.
  - Default direction: ascending.
  - Uses the lower/away rotation number as the game-level key.
  - Missing rotation numbers always sort last.
- The Sort & filter selector is now available on desktop as well as mobile so these non-column sort keys have an obvious control.
- Rotation metadata is displayed under the matchup alongside kickoff time when available, e.g. `Sat, 12:00 PM CDT · Rot 159–160`.
- Pool-context runtime games now carry rotation numbers from their matched live Odds API game when available.
- Powers PDF import fills missing runtime rotation metadata from the user's imported PDF, so Rotation # sorting still works in pool contexts that lack live rotation metadata.
- PDF-only boards preserve parsed Powers rotation numbers.
- Updated Help quick-start sorting copy.

## Files changed
- `app/js/board.js`
- `app/js/pdf-import.js`
- `app/index.html`
- `app/css/app.css`
- `tests/test_edge_board_time_rotation_sort.mjs` (new)

## Validation
- Dedicated time/rotation sort regression: 15/15 checks passed.
- Full fast regression suite: 97 test files passed, 0 failed.
- Browser E2E suite not run in this environment because Playwright localhost navigation is blocked here (existing environment limitation).

## Product behavior notes
- Existing default Edge Board sort remains unchanged (`Edge`, descending).
- Users opt into Game time or Rotation # via Sort & filter.
- Sort preference continues to persist in normal PickGauge state exactly like the existing sort keys.
