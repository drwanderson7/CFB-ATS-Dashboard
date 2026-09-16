# Session Summary — Pick Board Mobile Hierarchy (Sep 9, 2026)

## Goal
Act on direct beta-user feedback that PickGauge's mobile Pick Board was too configuration-heavy before the user reached the games. This is P0 item #1 from the feedback review: simplify the mobile hierarchy without changing any calculations/data behavior.

## Shipped in this patch
- Replaced the old multi-row Board action area with a compact primary toolbar: **Sort / Filters / More**.
- Kept the existing sort state, all sort options, direction toggle, filters, export actions, prediction loading state, My Numbers, and Prediction Systems functionality.
- **Filters** now opens the existing shortlist / CLV+Model-alignment controls directly under the toolbar.
- **More** opens a mobile action sheet containing prediction status/loading, My Numbers, Prediction Systems, and board export.
- My Numbers and Prediction Systems no longer appear before the game list. The main DOM order is now **toolbar → filters (only when opened) → week → games → advanced tools**.
- On phones, My Numbers / Prediction Systems open as full-height mobile drawers from More instead of occupying normal page flow.
- On phones, removed the redundant Pick Board eyebrow/title/description above the already-self-explanatory This Week / My Picks / Pool Settings subnav, saving another chunk of vertical space.
- Desktop keeps the advanced tools and filter controls available; advanced panels now live below the slate and can be jumped to from More.

## Files changed
- `app/index.html`
- `app/css/app.css`
- `app/js/init.js`
- `tests/test_pick_board_mobile_hierarchy.mjs` (new regression coverage)

## Verification
- All **91 Node `.mjs` regression files** passed.
- **36 non-browser Python regression files** passed (browser/live/network-specific scripts intentionally skipped in this environment).
- New mobile-hierarchy regression checks pass.
- Existing Pick Board sort visibility regression passes.
- Existing board export regression passes 21/21.
- Existing My Numbers and Prediction Systems regressions pass.

## Still intentionally not part of this patch
- Renaming Snapshot / This Week (separate feedback item).
- Broader copy reduction.
- Progressive "Why this game?" disclosure changes.
- Replacing emoji-style icons across the app.
- Custom line analyzer.

## Review note
A self-contained interactive UI preview was produced separately so Drew can review the hierarchy before uploading/deploying the code. The real app data/calculation paths were not changed.
