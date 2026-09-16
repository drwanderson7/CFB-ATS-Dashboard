# PickGauge handoff — 2026-09-02 — Powers pool-match + duplicate-rotation fix

## Base
This build continues from `pickgauge-2026-09-02-J-predictiontracker-match-fix.zip`.
Do not reapply J separately.

## User-visible bug
In an imported ATS pool context, multiple games showed blank BP/Comp cells even though the uploaded Brad Powers Week 1 2026 newsletter contained both values. The pool pick-button line could differ from the live Vegas column, confirming these were pool-context games rather than the Overall board.

## Root causes fixed
1. `applyPdfData()`'s Powers fallback used strict `teamMatch()` even though imported pool labels can literally be ellipsis-truncated. The app already had the collision-guarded `teamMatchTrunc()` for this class of pool name. Powers matching now uses it as a source-specific fallback.
2. Powers-specific aliases were added for `FIU` <-> `Florida International` and `Sam Houston State` <-> `Sam Houston`, without weakening the global matcher used by grading/CFBD/pools.
3. The actual Week 1 2026 Powers PDF prints BOTH Texas State and Texas as rotation `190` on the schedule/computer-line pages. `api/parse_pdf.py` previously keyed rows by rotation, overwriting Texas State and dropping the matchup. Duplicate rotations now infer the missing partner from odd/even rotation parity.

## Real PDF verification
Using the user's uploaded `Powers_Wk 1 2026.pdf` locally (not included in this repo/package):
- parser before fix: 42 FBS-vs-FBS games, Texas State @ Texas missing
- parser after fix: 43 games
- Texas State @ Texas: BP -30.0, Comp -30.1, homeVegas -29.5, inferred rotations 189/190
- BP/Comp also verified parsed for UL-Monroe @ Mississippi State, Western Michigan @ Michigan, San Jose State @ Eastern Michigan, Central Michigan @ New Mexico, Western Kentucky @ Nevada, Washington State @ Washington, FIU @ South Florida, and Sam Houston State @ Troy.

## Files changed
- `api/parse_pdf.py`
- `app/js/pdf-import.js`
- `tests/test_rotation_number_matching_client.mjs`
- `tests/test_powers_pdf_pool_matchups.mjs` (new)
- `tests/test_powers_duplicate_rotation.py` (new)

## Validation
- exact uploaded PDF parser regression: PASS, 43 games
- Powers pool-context matching regression: 20/20 PASS
- rotation-number client regression: 12/12 PASS
- full `bash scripts/test_all.sh --fast`: 96 test files passed, 0 failed

## Important boundaries
- No PickGauge Model # weights changed.
- No 3-of-5 rule changed.
- No global team-name alias was loosened.
- No grading, CFBD identity, pool parser, or Survivor logic changed.
- The user's paid Powers PDF is NOT included in the project ZIP.
