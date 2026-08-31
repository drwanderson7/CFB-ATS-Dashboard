# PickGauge Session Summary — Aug 30, 2026 — Historical Model Performance (#16)

## What was built

The Results tab now separates **Model performance** from **Your pick performance**.

The important methodology decision is deliberate: model ATS records are **not** calculated only on games the user selected. That would selection-bias the model record. Instead, PickGauge prospectively captures every game for which the account has both a pre-kick market line and model projections, then grades each model's hypothetical ATS lean after the game is final.

### New private historical data layer

`state.modelPerformanceHistory` is initialized in `app/js/main.js` and is private/account-scoped (it is not in `SHARED_FIELDS`). It stores compact week/game snapshots:

- season/week
- canonical CFBD game id when available
- Odds provider game id
- away/home canonical names
- kickoff
- frozen home-perspective market line
- frozen market/book label
- market/prediction/snapshot timestamps
- available model home-line projections
- later `systemResults` W/L/P/N grades

Snapshots are created/updated only **before kickoff**. A later pre-kick refresh updates the same game; after kickoff, capture is immutable to prevent hindsight contamination. A model that disappears on a later refresh is not erased from an earlier valid snapshot.

### Which models are tracked

The snapshot captures:

- PickGauge Model #
- every currently curated/featured prediction system with an available number
- any legacy non-featured system that is still enabled

PickGauge Model # is calculated for the historical snapshot even if the user has not turned the standalone PickGauge UI mode on. It uses the same production recipe and the same minimum 3-of-5 predictive-input fallback; current market remains the Vegas ingredient.

### Market benchmark

The model is graded against the **market/book line frozen with the last pre-kick snapshot this account actually observed**. It is never reconstructed postgame.

This is intentionally described as a frozen pre-kick market snapshot, **not necessarily the official closing line**. Because the snapshot honors the account's selected market/book, two accounts could eventually have slightly different records if they use different book preferences or observe different final pre-kick refreshes.

If PickGauge later needs one public/marketing "official PickGauge Model # record," build a separate server-owned canonical consensus snapshot pipeline rather than pretending these private account records are globally identical.

### Grading

`api/grade_picks.py` now grades `modelPerformanceHistory` in the same nightly/manual grading pass and same CAS write as archived user picks.

Home-team-spread convention is preserved:

- model prediction < market home line -> hypothetical home pick
- model prediction > market home line -> hypothetical away pick
- exact model == market -> `N` / no lean, not a fake push

W/L/P are graded against the frozen market line using canonical CFBD final scores when available, with the same final-score resolution layer used elsewhere.

`_pending_count()` and `_pending_requirements()` now include unresolved model decisions, so the existing grader knows when seasons/finals are needed.

### Results UI

New **Model performance** card appears above **Your pick performance** and supports the same season/week Results filters.

It includes:

- PickGauge Model # ATS hero record
- captured game count
- total graded model decisions
- model leaderboard: model, W-L-P, win %, average absolute prediction-vs-market gap, sample size
- small-n labels
- PickGauge Model # edge-size buckets
  - 0.1–1.4
  - 1.5–2.9
  - 3.0–4.9
  - 5.0+
- PickGauge favorites vs underdogs
- PickGauge home vs away

Pushes are excluded from win-rate denominators. No-leans are excluded from ATS records. Existing user Results analytics remain separate and unchanged in meaning.

### Automatic capture hooks

`captureModelPerformanceSnapshot()` is called after the main places where valid pre-kick inputs can become available/change:

- odds cache/fresh refresh
- prediction cache/fresh refresh
- CFBD derived-rating refresh
- CFBD identity refresh
- week switch
- initial app hydration / rehydrate after sync
- book-preference change

This avoids needing the user to visit the Results page to create historical data.

### State-size protection

`api/state.py` now validates reasonable upper bounds for model-performance history in addition to the existing overall ~2 MB private-state limit.

## Files changed

- `app/js/main.js`
- `app/js/record.js`
- `app/js/prediction-tracker.js`
- `app/js/odds.js`
- `app/js/cfbd-insights.js`
- `app/js/board.js`
- `app/js/pdf-import.js`
- `app/js/init.js`
- `app/css/app.css`
- `api/grade_picks.py`
- `api/state.py`
- `tests/test_model_performance_history_logic.mjs` (new)
- `tests/test_grading.py`
- `tests/test_state.py`
- `CURRENT_STATE.md`
- `NEW_SESSION_START_HERE.md`
- `PICKGAUGE_LAUNCH_CHECKLIST.md`
- `methodology.html`
- this file

## Tests

Current repo shape after this build:

- **67 permanent non-browser test files**
- **1 Playwright E2E file**
- **68 permanent test files total**

New/changed coverage includes:

- 14 model-performance client/history checks
- grading suite: 30/30 checks
- state suite: 76/76 checks
- existing Results analytics suite remains 20/20

All 67 permanent non-browser files passed in segmented runs. The full one-shot runner exceeds this sandbox's execution window because the suite is now large; the files were therefore completed in segments.

The Playwright file was attempted separately and still cannot reach its local HTTP server in this environment:

`ERR_BLOCKED_BY_ADMINISTRATOR`

It fails at `page.goto(http://localhost:...)` before any PickGauge assertion executes, same environment limitation as prior sessions.

## Important deployment behavior

This feature **cannot honestly backfill previous games**. Historical model predictions for already-played games would be contaminated by hindsight/current data. The model dataset therefore begins after this code is deployed and the account loads lines + predictions before kickoff.

### First live validation after deploy

Before a Week 1 kickoff:

1. Load/refresh odds.
2. Load prediction systems.
3. Confirm state sync succeeds.
4. Reopen Results; Model performance should show captured games even before they are graded.

After finals / the next grading run:

5. Confirm PickGauge Model # and source-system W-L-P records populate automatically.
6. Spot-check 2-3 games manually against the frozen market line and final score.
7. Confirm the same season/week filter affects both Model performance and Your pick performance.

## One future product decision, not required for this implementation

Private/account-scoped tracking is correct for a personal Results dashboard and avoids a new global write/race architecture. If Drew wants to publish a single universal record such as **"PickGauge Model # is 57-41 ATS this season"** on the homepage/X, that should be a separate server-owned benchmark using a fixed canonical consensus market snapshot for every game. Do not derive that marketing record by aggregating private user histories.
