# PickGauge UI/UX Batch 1 — September 2, 2026

Source: `pickgauge-2026-09-02-A.zip`

## Scope
Implemented the first five high-priority UI/UX recommendations from the Sept. 1 deep dive. This is intentionally a first-use/conversion pass, not a broad redesign.

## 1. Public Snapshot now looks intentional
Logged-out Snapshot now shows a compact `Public preview · SP+ model` banner explaining:
- the page is live public data,
- SP+ is the public preview model,
- ranking/filter exploration is available,
- PickGauge Model #, picks, pools, exports, Survivor and full Edge Board unlock after sign-in.

Guest Context Bar copy is overridden to:
- `Public Preview · This week`
- `SP+ model · live market`

It no longer presents a fake `Overall board · Entry 1` context to someone who has no account.

Guest-only header cleanup:
- hides `calls left`,
- hides meaningless sync status,
- preserves refresh timestamp.

## 2. Public exploration controls work without sign-in
Guests may now use, without persistence:
- Raw Edge / Cover % ranking
- All
- Strong
- Underdogs
- Crosses key #
- existing Snapshot detail expansion

Account-specific controls remain gated:
- Add Pick
- Shortlist
- Export
- Full Board / full analysis
- Pools / Survivor / other signed-in tabs

Locked actions are explicitly labeled with `🔒` so a generic `Details`/`Add pick` label no longer unexpectedly throws the user into auth.

`My picks` and `Shortlisted` filters are hidden for guests.

## 3. Auth is no longer a dead end
The Clerk gate now exposes:
`← Back to public preview`

A guest who taps a locked tab has the requested destination remembered. After successful authentication and normal app initialization, PickGauge routes to that requested tab.

Mutation intent is NOT auto-replayed: a user who clicked Add Pick still deliberately clicks the pick again after sign-in.

## 4. Guest state no longer leaks into signed-in preferences
Guest mode now snapshots/restores:
- enabled systems,
- Snapshot filter,
- Raw Edge/Cover % preference.

Guest always starts with:
- SP+ only,
- All filter,
- Cover % rank.

Previously guest mode forced Cover % but did not restore the user's saved preference after sign-in.

## 5. System-count / stale ranking cleanup
User-facing count is now consistently:
`20 curated prediction systems`

Removed stale `~40` claims from:
- sign-in positioning
- sign-in feature card
- Snapshot full-board CTA.

Removed the old two-year `★ Top 10` badges from the Prediction Systems selector. `TOP_SYSTEM_RANKS` data is retained internally because mapping tests/documentation may still reference historical data, but the stale badge is no longer presented beside current model-selection work.

## 6. Stale onboarding copy corrected
Removed old references to:
- `Picking for`
- `Star games`

Updated My Picks / Help / Weekly Setup copy to direct users to:
- the global `Viewing` bar,
- selecting teams from Snapshot or Edge Board,
- the pool's actual pick limit (7 default) rather than hardcoding every entry to 7.

## Files changed
- `app/css/app.css`
- `app/index.html`
- `app/js/board.js`
- `app/js/guest-snapshot.js`
- `app/js/init.js`
- `app/js/picks.js`
- `app/js/prediction-tracker.js`
- `tests/test_sagarin_mapping_logic.mjs`

New:
- `tests/test_guest_preview_ux.mjs`

## Validation
Targeted guest contract tests: PASS
JS syntax checks: PASS

Full fast project regression:
**89 test files passed, 0 failed**

Command:
`bash scripts/test_all.sh --fast`

The fast run intentionally skips the repository's real-browser `tests/test_e2e_*.py` files.

## Next UI/UX batch
Recommended next:
1. remove provider `calls left` from authenticated primary header / move operational quota to admin/advanced Settings,
2. add text labels to desktop header icon controls while retaining icon-only mobile presentation,
3. tuck manual Pull/Push sync controls under `Sync troubleshooting`,
4. update homepage CTA to explicitly advertise `Live Snapshot · No sign-in required`.

Do not start a broad redesign; current Snapshot/Board/Survivor layout should otherwise remain stable unless real-user feedback points to a specific problem.
