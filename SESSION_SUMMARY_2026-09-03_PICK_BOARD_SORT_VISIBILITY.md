# PickGauge Handoff — Pick Board Sort Visibility Fix (2026-09-03)

## Source
Built on top of `pickgauge-2026-09-03-F-pool-prediction-subset-diagnostic-fix.zip` working tree.

## User report
After the Pick Board navigation refactor, the user asked what happened to the sort options (Rotation #, Game time, Edge, etc.).

## Root cause
The sort engine and options were still intact. During the earlier mobile toolbar cleanup, the shared sort selector (`mobileSortSel`) was placed inside the collapsible `#boardSortFilterPanel`. The Pick Board shell made that panel easier to overlook, and opening DevTools can narrow the viewport below the mobile breakpoint, causing the panel to start collapsed. The result looked like the sort features had been removed.

## Fix
- Moved the primary Sort by selector + direction button OUTSIDE the collapsible details panel.
- Sort is now always visible on desktop and mobile.
- Kept all existing options:
  - Edge
  - Cover %
  - Model #
  - My Numbers
  - Vegas
  - CLV
  - Game time
  - Rotation #
  - Game (A–Z)
- Renamed the remaining collapsible section to `Filters & legend`.
- Filter/legend panel remains collapsed by default on mobile to preserve the prior vertical-space improvement.
- Existing sort implementation, defaults, and state were not changed.
- Game time and Rotation # still default ascending and preserve stable tie-break behavior.

## Files changed
- `app/index.html`
- `app/css/app.css`
- `app/js/board.js`
- `tests/test_pick_board_sort_visibility.mjs` (new)
- `SESSION_SUMMARY_2026-09-03_PICK_BOARD_SORT_VISIBILITY.md` (new)

## Validation
- New visibility regression passed.
- Existing `test_edge_board_time_rotation_sort.mjs`: 15/15 passed.
- All standalone Node regression files: 77/77 passed (parallel run, excluding underscore helper runners that require stdin).
- `app/js/board.js` and `app/js/init.js` pass `node --check`.

## Product intent
This is a visibility/workflow fix only. Do not remove the table-header click sorting; it remains a useful desktop shortcut alongside the always-visible selector.
