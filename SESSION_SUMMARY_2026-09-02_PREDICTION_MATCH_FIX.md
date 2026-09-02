# PickGauge — PredictionTracker matchup normalization fix (Sept 2, 2026)

## User-reported production symptom
PickGauge Model # showed `incomplete` for several games even though ThePredictionTracker had posted model data, including:
- Northern Illinois @ Iowa
- Kent State @ South Carolina
- Coastal Carolina @ West Virginia
- Florida International @ South Florida
- Sam Houston @ Troy

## Root cause
The PredictionTracker row existed, but `applyPredictions()` failed to attach the row to the board game because PredictionTracker uses a source-specific naming dialect:
- Northern Ill. -> Northern Illinois
- Kent -> Kent State
- West Va. -> West Virginia
- Florida Intl. -> Florida International
- Troy St. -> Troy
- Sam Houston St. -> Sam Houston
- Eastern Mich. -> Eastern Michigan (additional live case found during sweep)

When a row failed to match, all PredictionTracker systems in that row were lost together. PickGauge then often had only CFBD SP+ plus Vegas, correctly leaving the branded model below its required 3-of-5 predictive-model minimum.

## Fix
Changed only `app/js/main.js`'s PredictionTracker-specific `normTracker()` normalization layer. The global `teamMatch()` matcher was deliberately NOT relaxed because it is shared by grading, pool imports, CFBD identity, and Powers PDF matching.

Added exact tracker-source aliases for historical/special names (`Kent`, `Troy St.`, `Sam Houston St.`) plus safe tracker-only abbreviation expansion for `Ill.`, `Mich.`, `Va.`, `Intl.`, and the existing `St.` behavior.

## Regression coverage
New:
- `tests/test_prediction_tracker_team_normalization.mjs`
- `tests/test_prediction_tracker_live_matchups.mjs`

The integration regression uses the exact live source dialect and verifies all affected rows attach their model objects to the correct board games, including a guard that Florida Intl. never collapses into plain Florida.

## Validation
- PredictionTracker normalization regression: PASS
- Exact affected-live-matchup integration regression: PASS
- PickGauge model math regression: PASS
- Fetch-predictions client regression: PASS
- Full fast suite: **94 test files passed, 0 failed**

No PickGauge weights, minimum coverage rule, Vegas behavior, grading logic, pool matching, or CFBD identity logic were changed.
