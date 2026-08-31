# PickGauge Session Summary — Aug 30, 2026 (ChatGPT)

## Matchup Intelligence v2

Implemented the post-Week-0 Matchup Intelligence fixes after real CFBD season data began populating.

### Data/API changes
- `/stats/season/advanced` now explicitly requests `excludeGarbageTime=true`.
- Fetches `classification=fbs` **and** `classification=fcs`; FCS is additive/best-effort so an FCS-only provider failure does not remove FBS context.
- Advanced cache namespace bumped to `pickgauge_cfbd_advanced_v2`.
- Client local advanced cache namespace bumped to `pickgauge_cfbd_advanced_v2_`.
- `trim_advanced_team()` now retains offense/defense `plays` and `drives` for sample disclosure.
- Offense havoc is retained and correctly interpreted as havoc allowed/suffered; defense havoc remains havoc generated.
- Canonical season game identity now retains `/games.completed` so completed-game hindsight protection still works after a game leaves the live scoreboard window.
- The server identity cache namespace was bumped to `pickgauge_cfbd_identity_v2` and the browser identity key to `pickgauge_cfbd_identity_v3`, forcing one clean refresh so already-cached pre-change schedule rows cannot silently lack `completed`.

### UI/logic changes
- Removed the old standalone defense-vs-defense Havoc row. Havoc is now compared in each actual offense-vs-defense direction.
- Replaced `Edge` terminology with `Matchup lean` (`Balanced`, team lean) because thresholds are descriptive heuristics, not a calibrated probability/model edge.
- Added a Difference column on desktop; hidden on mobile to preserve readable width.
- Headers now show compact school abbreviations where available, with produced/allowed semantics.
- Added a season/sample note with garbage-time status and offensive play counts; under 200 plays is explicitly labeled a small early-season sample.
- If only one side has advanced data, the panel now explains the missing coverage instead of silently disappearing.
- Completed games hide season-to-date Matchup Intelligence because the aggregate then contains the game itself; users are directed to `Results → Why?` for postgame analysis.

### Verification
- CFBD's current official `AdvancedSeasonStat` schema confirms `excludeGarbageTime`, `classification`, offense/defense `plays`, and havoc under both offense and defense.
- Regression tests were expanded for: FBS+FCS request parameters, garbage-time exclusion, offense/defense havoc semantics, sample-size disclosure, compact headings, matchup-lean wording, missing coverage, and completed-game hindsight protection.
- `api/fetch_teams.py` identity tests now pin the `completed` flag.

### Files changed
- `api/fetch_cfbd.py`
- `api/fetch_teams.py`
- `app/js/cfbd-insights.js`
- `app/js/main.js`
- `app/css/app.css`
- `tests/test_cfbd_insights.py`
- `tests/test_cfbd_insights_logic.mjs`
- `tests/test_cfbd_identity.py`
- `tests/test_e2e_ui_behaviors.py`
- `CURRENT_STATE.md`
- `NEW_SESSION_START_HERE.md`
- `PICKGAUGE_LAUNCH_CHECKLIST.md`
- `methodology.html`

### Test result after changes
- Permanent test files: **67 total**.
- `scripts/test_all.sh`: **66 files passed**.
- The only failed file is `tests/test_e2e_ui_behaviors.py`; Chromium is blocked from opening localhost in this environment (`ERR_BLOCKED_BY_ADMINISTRATOR`) before the first application assertion executes. This is an environment limitation, not a failing product assertion.
