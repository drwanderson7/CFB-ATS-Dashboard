# PickGauge session summary — source identity / model-match normalization fix

Date: 2026-09-02
Base: `pickgauge-2026-09-02-M-edge-board-offline-export.zip`

## Reported production symptoms

- Sam Houston vs Troy could not attach the live Vegas number.
- UAB vs Illinois was missing nearly all PickGauge Model # predictive inputs.
- Western Michigan vs Michigan was missing nearly all PickGauge Model # predictive inputs.
- Miami (FL) vs Stanford was missing nearly all PickGauge Model # predictive inputs.
- Toledo vs Michigan State was missing nearly all PickGauge Model # predictive inputs.

## Production/source verification

The live PickGauge public odds cache contained all five games, including Sam Houston State @ Troy with rotations 213/214 and a live market. PredictionTracker also contained rows/model values for the four reported model-input matchups. The problem was therefore client-side identity/normalization, not missing upstream source data.

## Root cause 1 — PredictionTracker normalizer corrupted full school names

`normTracker()` used abbreviation regexes that required a token boundary only at the start, not the end. As a result, valid full names were mutated, for example:

- `Illinois` -> `Illinoisinois`
- `Michigan` -> `Michiganigan`
- `Michigan St.` -> `Michiganigan State`
- `Stanford` -> `Stateanford`
- `Penn State` -> `Penn Stateate`
- `Vanderbilt` -> `Virginianderbilt`

This directly caused the UAB/Illinois, Western Michigan/Michigan, Miami/Stanford, and Toledo/Michigan State rows to fail matching.

### Fix

PredictionTracker abbreviation expansion now requires the abbreviation to terminate as a real token. Abbreviations such as `Western Mich.`, `Michigan St.`, `West Va.`, `Florida Intl.`, and `Ohio St.` are still expanded, while already-complete names remain unchanged.

## Root cause 2 — Sam Houston live-odds identity

Pool/display data can use `Sam Houston`, while the live Odds API payload uses `Sam Houston State Bearkats`. The canonical team matcher treated `State` as identity-bearing, so the live odds row did not attach.

### Fix

- Added the canonical `Sam Houston` / `Sam Houston State` alias in both browser and grading identity maps.
- Improved alias-prefix matching so a short alias prefix does not immediately fail when a longer valid alias can resolve the identity.
- Preserved collision protection: `Sam Houston` does not match `Houston`, and `Miami` does not match `Miami (OH)`.

## Files changed

- `app/js/main.js`
- `app/js/pdf-import.js`
- `app/data/team-alias.js`
- `api/grade_picks.py`
- `tests/test_prediction_tracker_team_normalization.mjs`
- `tests/test_prediction_tracker_token_normalization.mjs` (new)
- `tests/test_sam_houston_live_odds_alias.mjs` (new)

## Model behavior unchanged

No changes were made to:

- PickGauge Model # weights
- 3-of-5 predictive-input requirement
- Vegas share
- model arithmetic
- grading methodology
- Survivor calculations

This change only repairs source identity/row attachment.

## Validation

`bash scripts/test_all.sh --fast`

Result: **100 test files passed, 0 failed**.

The fast suite intentionally skips the seven real-browser Playwright files; this environment has repeatedly blocked browser navigation to localhost. All non-browser integration, model, matching, grading, pool, Survivor, export, and persistence regressions passed.
