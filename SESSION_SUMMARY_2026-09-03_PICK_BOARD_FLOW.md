# PickGauge — Pick Board navigation flow
Date: 2026-09-03

## Source of truth
Built directly on the user-uploaded `pickgauge-2026-09-03-B-cache-control-fix.zip`.

## Product decision
Normal spread-pool workflows are now grouped under one user-facing top-level **Pick Board** destination rather than three separate top-level tabs.

Top-level product navigation:
- Snapshot
- Pick Board
- Confidence
- Survivor
- Results

Pick Board internal navigation:
- This Week — existing Edge Board implementation
- My Picks — existing entry/pick management implementation
- Pool Settings — existing Pools/import/setup implementation

The term "ATS" is intentionally not used as the top-level navigation label. Existing ATS/Edge Board terminology remains where it is useful inside analysis/help content.

## Implementation
### `app/index.html`
- Replaced top-level Edge Board / My Picks / Pools buttons with `Pick Board`.
- Reordered Confidence before Survivor to match the simplified product hierarchy.
- Added `#pickBoardShell` and 3 internal subview buttons.
- Updated Snapshot CTA/guest copy to use Pick Board language.
- Updated My Picks intro copy to point users to Pick Board → This Week.

### `app/js/tabs.js`
- Added `PICK_BOARD_VIEWS = board/picks/pools`.
- Existing `switchTab("board")`, `switchTab("picks")`, and `switchTab("pools")` calls now canonicalize to top-level Pick Board while activating the correct legacy panel.
- This deliberately preserves mature implementation ids/functions and avoids a risky repo-wide rename.
- Added `switchPickBoardView()`, `initPickBoardNav()`, and Pick Board heading/subtitle rendering.
- Mobile hamburger label stays `Pick Board` while internal subview state remains inside the Pick Board shell.
- Analytics now records `tab:"pickboard"` with a `subview` value.

### `app/js/init.js`
- Initializes the Pick Board internal navigation.

### `app/css/app.css`
- Added compact responsive Pick Board shell/subnav styling.
- On mobile the three internal choices become a 3-column grid.

### Copy cleanup
- Pool-setup CTA now says `Open Pool Settings →`.
- Setup guidance points to `Pick Board → Pool Settings` or `Pick Board → This Week`.
- Guest locked Snapshot buttons say `Pick Board 🔒`.

## Compatibility
The following old internal/deep-link calls continue to work:
- `switchTab("board")` -> Pick Board / This Week
- `switchTab("picks")` -> Pick Board / My Picks
- `switchTab("pools")` -> Pick Board / Pool Settings

This is important for:
- Snapshot "open board" actions
- Results -> My Picks actions
- setup CTA -> pool import
- existing pool-management code
- guest post-auth destination routing

No changes were made to:
- Edge Board model math or layout
- ATS pool state/grade logic
- ATS setup wizard behavior
- Confidence logic
- Survivor logic
- API/cache/security code

## Tests
New:
- `tests/test_pick_board_navigation.mjs` — 25 checks.

Updated:
- navigation hamburger regression
- pool setup CTA regression
- affected Playwright/browser selectors

Validation:
- New Pick Board test: 25/25 passed.
- Focused ATS/nav/guest/My Picks regressions all passed.
- All 72 `tests/test_*.mjs` front-end/Node test files passed.
- Modified Python browser-test files compile with `py_compile`.
- Full `scripts/test_all.sh --fast` was attempted; it produced no failures but exceeds this sandbox's command-time window before completion. No Python application/API source was changed in this batch.

## Recommended next Pick Board pass
1. Review the Pick Board shell visually on desktop + real phone after deployment.
2. Decide whether `My Picks` should be renamed to a more task-oriented label such as `My Card` (not changed in this build).
3. Consider making the Pool Settings landing card emphasize:
   - Create pool
   - Import/update this week's sheet
   - Entries
   rather than exposing every management control equally.
4. After user feedback, consider whether Snapshot should deep-link specific locked actions into the exact Pick Board subview rather than generic Pick Board.
5. Do not rename internal `tab-board/tab-picks/tab-pools` ids unless there is a strong engineering reason; the alias layer is intentional.
