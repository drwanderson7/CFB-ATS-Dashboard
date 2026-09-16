# Session Summary — P1 Icons + Pool Onboarding (2026-09-09)

## Scope
Two P1 UX items requested by Drew:
1. Replace emoji-style UI decoration with a consistent product icon system.
2. Standardize pool onboarding across ATS, Confidence, and Survivor.

## Icon cleanup
- Added `app/js/icons.js` with `pgIcon()` and a native inline SVG sprite in `app/index.html`.
- Replaced visible OS/color emoji in primary application UI with consistent stroke icons (feedback, account, settings, chart/results, key number, trophy, trend, warning, lock, target, upload/download, flag, sliders, etc.).
- Kept simple semantic glyphs such as checkmarks, stars, arrows, and close marks where they function as ordinary UI symbols rather than emoji decoration.
- No external icon package/dependency was added, avoiding browser/platform emoji differences and keeping the app self-contained.
- Hardened the Prediction Tracker PDF-import icon path so the module still works if loaded in isolation without the shared icon helper.

## Pool onboarding
The primary journey is now expressed consistently as four steps rather than a collection of unrelated setup/admin cards.

### ATS pools
1. Create pool
2. Add weekly slate / contest lines
3. Make picks
4. Track results

The steps reflect actual pool state and identify Done / Next / Later. `Manage entries` remains available but is intentionally secondary because it is pool administration, not the core weekly user journey.

### Confidence pools
Uses the same four-step structure and state-driven progression. `+ Create pool` is now a clearly named primary action. The weekly import/pick/results views are reachable directly from the relevant journey step.

### Survivor pools
Uses the equivalent four-step structure:
1. Choose pool
2. Load schedule
3. Make picks
4. Track survival

The existing prominent `+ Create pool` action remains at the top. The journey reflects loaded schedule, saved weekly picks, and survival history.

## Responsive behavior
- Four columns on desktop.
- Compact 2×2 step grid on mobile.
- The current step is visually emphasized; completed steps are subdued-success state; unavailable future steps are visually de-emphasized.

## Verification
- 96/96 JavaScript regression test files passed.
- 37/37 non-browser Python regression test files passed.
- Added `tests/test_p1_icons_pool_onboarding.mjs` and updated affected copy/icon contract tests.
- Browser E2E scripts were not counted in the Python total because the current environment does not support the required local browser navigation reliably.

No model math, grading logic, odds logic, pool scoring rules, or Survivor eligibility rules were intentionally changed in this P1 pass.
