# PickGauge Confidence Splash PDF Import Fix — 2026-09-02

## Problem
The real Grundy's Gang 2026 Week 1 Splash Team Pickem PDF rendered correctly to a person, but PickGauge's browser-side generic PDF text extractor reconstructed only 2/18 games and cross-paired some teams.

## Root cause
Splash Team Pickem uses the full page width for away team, centered kickoff, home team, and full pick buttons. The generic extractor was designed around ESPN's two-cluster layout and kept only the first two horizontal clusters on each row. On this Splash layout that could drop the home side or combine the wrong fragments.

## Fix
- `app/js/pool-contexts.js`
  - Added Splash-specific full-width row extraction.
  - Preserves metadata/kickoff rows intact.
  - Splits actual two-sided pick-option rows at the page midpoint so both full team names and frozen spreads survive.
  - ESPN retains the existing sidebar/two-cluster logic.
- `api/parse_pool.py`
  - Team Pickem sheets now prefer full team pick buttons after the `Winner` marker and ignore abbreviated scoreboard fragments.
  - Handles sticky footer glue such as `WinnerPicks` and `Winner0/18`.
  - Week-number regex now handles concatenated Splash navigation text such as `Week 1Week 2...`.

## Acceptance result against the actual uploaded PDF
- 18/18 games
- exact matchup order
- exact locked ATS spreads
- pickLimit = 18
- dropLowestWeeks = 2
- weekNumber = 1
- card lock = 2026-09-03T19:00:00

## Tests
- Added `tests/test_splash_fullwidth_pdf_extraction.mjs`
- Expanded `tests/test_confidence_splash_import.py`
- Full fast suite: 105 test files passed, 0 failed.

## Changed files
- `app/js/pool-contexts.js`
- `api/parse_pool.py`
- `tests/test_splash_fullwidth_pdf_extraction.mjs`
- `tests/test_confidence_splash_import.py`

The user's Splash PDF is not included in the project archive.
