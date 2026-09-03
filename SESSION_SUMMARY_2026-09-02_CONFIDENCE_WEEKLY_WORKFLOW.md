# PickGauge Confidence Weekly Workflow — 2026-09-02

## Source of truth
Built on top of the user's `pickgauge-2026-09-02-P-confidence-ats-correction (1).zip` plus the previously completed six-step Confidence pool setup wizard.

The real acceptance sample for weekly import was the user's `Grundy's Gang 2026 Week 1.pdf`. The PDF itself is NOT included in this project ZIP.

## Real Splash confidence PDF findings
The actual Splash Team Pickem export contains:
- Week 1
- 18 ATS games / 18 required picks
- exact contest spreads for every game
- `Your 2 lowest-scoring weeks will be dropped`
- one full-card lock: Thu Sep 3, 2026 at 7:00 PM

The production-style browser pdf.js extraction + `/api/parse_pool` now recovers all 18/18 games and exact contest lines from this format.

## Shared PDF extraction fix
`app/js/pool-contexts.js`

The prior shared extractor always discarded content to the right of ~60% page width to remove ESPN's sidebar. Splash Team Pickem uses the full page width, so this removed much of the home-team side before parsing.

Now:
- Splash / Team Pickem pages keep full page width.
- ESPN retains the existing right-sidebar trim.

## Splash parse metadata
`api/parse_pool.py`

Splash parsing now supports the real Team Pickem text shape and returns:
- `pickLimit`
- `count`
- `games`
- `dropLowestWeeks`
- `picksLockAt`
- `lockMode: "card"` when a single Picks lock is present
- `weekNumber`

The client prefers CFB week derived from actual kickoff dates over literal `Week N` text because Splash navigation can display several week tabs on one sheet.

## Confidence weekly UX
`app/js/confidence-integration.js`

Confidence remains one top-level tab, with internal subviews:
- This Week
- Results
- Pool Settings

### This Week
Primary flow:
1. Import Splash PDF.
2. Review matched games / frozen contest lines.
3. Build or manually edit Confidence Board.
4. Reorder confidence ranks.
5. Complete readiness checks.
6. Mark card submitted.

Manual game setup remains available as troubleshooting/fallback rather than the normal workflow.

### Confidence Board
Each game can show:
- confidence rank / points
- kickoff
- away/home pick choices
- exact frozen pool line
- live Vegas line
- model input summary
- PickGauge Model #
- raw edge
- Cover %
- PickGauge lean

ATS analysis is always against the IMPORTED CONTEST LINE, not the current live line.

### Build PickGauge ranking
For ATS pools:
- uses the existing PickGauge Model # recipe / missing-input requirements
- determines the preferred side against the frozen pool spread
- ranks primarily by estimated Cover %
- breaks ties by raw edge
- Every Game pools fill all games with model coverage
- Pick N pools select the strongest N games
- All Picks confidence assigns N..1
- Top X confidence ranks only X games; other required submitted picks remain worth 0

Straight-up automatic ranking is deliberately NOT guessed yet; see open questions.

### Reorder instead of point dropdowns
Confidence ranking is positional:
- up/down buttons
- desktop drag/drop
- confidence values automatically remain unique
- Top X pools explicitly add/remove games from the ranked set

### Readiness
Shows completion state for:
- required side selections
- required confidence ranks
- contest-line verification for ATS
- first blocking problem when incomplete

### Submission snapshots
`Mark card submitted` creates/updates a dated historical snapshot for the active week without clearing the working card before lock.

Snapshots retain:
- selected side
- confidence points
- exact contest line
- provider game ID where matched
- PickGauge Model # at submission
- Cover % at submission
- live home line at submission

Re-submitting before lock updates the same week's snapshot instead of duplicating it.

### Lock behavior
The Grundy's Gang sample establishes a full-card lock. When the imported card lock has passed, PickGauge disables:
- changing sides
- editing contest lines
- removing games
- reordering confidence
- suggested-card replacement
- submission

### Confidence export
The weekly card supports:
- Print / PDF
- Copy picks
- CSV

The compact print report includes confidence points, pick, matchup, pool line, PickGauge Model # and Cover %.

### Results
Results is labeled `My Entries`, not external standings.
Shows:
- entry totals
- possible points
- graded weeks
- dropped weeks
- submitted weekly cards and game-level result/points details

### Pool Settings
Shows season rules and supports:
- entry rename
- add entry
- delete pool
- rule edits before actual season activity

### Duplicate Entry
Copies the current-week picks/ranking into a new entry but intentionally does NOT copy season history.

## State normalization
`app/js/main.js`

Confidence pool normalization now includes:
- `currentWeekNumber`
- `weekLabel`
- `cardLockAt`
- `lockMode`
- `weekImportMeta`
- submitted-history status / timestamps

Legacy history is normalized into the new submitted-history model.

## CSS
`app/css/app.css`

Added responsive styling for:
- Confidence sub-navigation
- weekly import card / warnings
- Confidence Board
- ranking controls
- readiness / submission bar
- Results / My Entries
- Pool Settings
- mobile board layout

## New tests
- `tests/test_confidence_weekly_workflow.mjs`
- `tests/test_confidence_splash_import.py`

The weekly workflow regression covers import, lock metadata, live provider IDs, suggested ATS ranking, unique point assignment, reorder, readiness, submission/resubmission, historical model context, duplicate entry, lock enforcement and kickoff-derived future-week detection.

## Validation
`bash scripts/test_all.sh --fast`

Result: **104 test files passed, 0 failed**.
The fast runner skips the 7 `tests/test_e2e_*.py` real-browser files by design.

## Open Confidence questions — do not guess
1. **ATS push scoring** — current engine grades a push as `P`, awards 0 confidence points, and does not call it a loss. Confirm actual contest behavior.
2. **Weekly tiebreaker** — the uploaded 5-page pick sheet does not show a tiebreaker. Confirm whether the contest has one elsewhere.
3. **Straight-up suggested ranking methodology** — setup/grading supports straight-up, but automated ranking is intentionally disabled until a win-probability method is chosen. Recommended direction: estimated win probability, not raw spread magnitude.
4. **External Splash leaderboard** — Results currently compares the user's own entries only. Actual contest standings import is not built; obtain a Splash standings/export sample if desired.
5. **Other lock formats** — this real sample confirms full-card lock. Per-game locking for other confidence contests is not generalized yet.
6. **Canceled/postponed-game rules** — needs contest-rule definition before production hardening.

## Changed files in this phase
- `api/parse_pool.py`
- `app/css/app.css`
- `app/js/confidence-integration.js`
- `app/js/main.js`
- `app/js/pool-contexts.js`
- `tests/test_confidence_splash_import.py` (new)
- `tests/test_confidence_weekly_workflow.mjs` (new)
- `SESSION_SUMMARY_2026-09-02_CONFIDENCE_WEEKLY_WORKFLOW.md` (new)
