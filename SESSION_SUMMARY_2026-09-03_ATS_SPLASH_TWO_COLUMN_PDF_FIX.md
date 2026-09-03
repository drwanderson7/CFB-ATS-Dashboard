# PickGauge handoff — ATS Splash two-column PDF fix (2026-09-03)

## Source of truth
Built on `pickgauge-2026-09-03-D-pool-settings-landing.zip`.

## User-reported failure
ATS pool import did not fully parse `Madwood CFB_Wk 1.pdf`, a 6-page Splash Team Pickem printout containing 25 ATS games, 25 required picks, a card lock of Mon Sep 7 2026 6:30 PM, and a combined-total-score tiebreaker section.

## Root causes confirmed against the exact uploaded PDF
1. The PDF text layer omits `Splash Sports` / `Team Pickem`, so the browser extractor misclassified it as ESPN and applied the 60%-page-width crop. That deleted the entire right-hand game card from each two-card row.
2. This Splash layout is a persistent two-column desktop grid. Games can cross page boundaries (Marshall/Penn State and Boise State/Oregon from page 2 to page 3), so page-by-page left/right flattening can cross-pair headers and pick buttons.
3. Splash's sticky Week 1–Week 8 scroller on page 3 overlaps the Tulane/Duke and Baylor/Auburn pick-button text in the PDF text layer. Generic row grouping merged the navigation date labels into the real team/spread row.

## Fix
### `app/js/pool-contexts.js`
- Splash detection now also recognizes strong Splash UI phrases such as `Make bulk picks`, `Winner 1 Point`, and `Combined Total Score`, and persists source identity for later pages.
- Detects two-card desktop layouts from separated `Winner` x-position clusters.
- Extracts two-column Splash documents as persistent left/right lanes across all pages so page-boundary continuations remain within the same game lane.
- Adds geometry-derived spaces so a pick row becomes e.g. `Colorado +6.5 Georgia Tech -6.5` instead of a glued unusable string.
- Filters only sticky week-navigation date fragments when they overlap a real pick row, preserving team names and signed spread badges.
- Existing one-card/full-width Splash path remains intact for Grundy's Gang-style PDFs.

### `api/parse_pool.py`
- Sorts parsed Splash games chronologically after de-duplication. This restores natural slate order after lane-by-lane extraction while preserving stable source order for identical kickoff times.

### Tests
- Added `tests/test_splash_two_column_pdf_extraction.mjs` for the brandless two-card layout, right-column retention, sticky week-scroller overlap, and persistent-lane ordering.
- Existing full-width Splash and parser tests remain green.

## Exact uploaded PDF acceptance
Using the production vendored pdf.js build + actual `extractPdfTextLines()` + `parse_pool_lines()` against the user's exact PDF:
- source: splash
- games: 25/25
- pickLimit: 25
- picksLockAt: 2026-09-07T18:30:00
- exact spreads recovered for all 25 games
- Tulane/Duke and Baylor/Auburn recovered despite sticky-nav overlap
- right-column games (UAB/Illinois, Toledo/Michigan State, etc.) recovered
- final SMU/Florida State game recovered

The PDF itself is NOT included in the project ZIP.

## Validation
`bash scripts/test_all.sh --fast` => 109 files passed, 0 failed.

## Changed files
- `app/js/pool-contexts.js`
- `api/parse_pool.py`
- `tests/test_splash_two_column_pdf_extraction.mjs`
- `SESSION_SUMMARY_2026-09-03_ATS_SPLASH_TWO_COLUMN_PDF_FIX.md`

## Deferred
The sheet visibly contains a combined-total-score tiebreaker. This fix prevents that block from interfering with game parsing, but Pick Board does not yet import/use ATS tiebreaker values as a first-class pool rule. Build that separately if desired.
