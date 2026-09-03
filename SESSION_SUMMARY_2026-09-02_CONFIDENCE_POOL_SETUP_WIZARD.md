# PickGauge Confidence Pool Setup Wizard — Sept 2, 2026

Source of truth: `pickgauge-2026-09-02-P-confidence-ats-correction (1).zip`

## Implemented

Replaced the old one-row confidence-pool creation form with a question-by-question one-time setup wizard.

Flow:
1. Pool name
2. Scoring: Against the spread / Straight up
3. Weekly picks: Every game / Pick N games
4. Confidence points: All picks / Top X picks
5. Dropped weeks: none / drop lowest N
6. Entries: numeric stepper; auto-creates Entry 1, Entry 2, etc.
7. Review screen before anything is saved

The wizard is transient. Cancel/back does not create partial pool state. The pool is only persisted after Review -> Create confidence pool.

## Rule schema v2

Confidence pools now save explicit independent rules:
- `scoring`: `ats` | `straight_up`
- `weeklyPickMode`: `all` | `count`
- `weeklyPickCount`: null | N
- `confidenceMode`: `all` | `top`
- `confidenceCount`: null | N
- `dropLowestWeeks`: null | N
- `entries`: auto-created numbered entries

Legacy `pickCount` is preserved/backfilled for backward compatibility but is no longer the conceptual source of truth.

## Important behavior

- Every game + Top 5: every required game must have a selected side; only five picks need confidence values 5..1. Other submitted picks are valid and worth 0 points.
- Pick N archives only the actually submitted games, not every game available on the slate.
- ATS pools require frozen contest lines for grading.
- Straight-up pools do not require a spread and grade the final winner directly.
- Straight-up server grading was added to `api/grade_picks.py`; ATS remains the backward-compatible default for existing pools.
- Pool rules are summarized as chips after creation.
- Existing confidence pools are normalized into the new schema during `normalizeState()` without changing their old behavior.

## Files changed

- `app/js/confidence-integration.js`
- `app/js/confidence.js`
- `app/js/main.js`
- `app/css/app.css`
- `api/grade_picks.py`
- `tests/test_grading.py`

New:
- `tests/test_confidence_pool_setup_wizard.mjs`
- `SESSION_SUMMARY_2026-09-02_CONFIDENCE_POOL_SETUP_WIZARD.md`

## Validation

- Confidence legacy logic: 43/43
- New setup/rule regression: 17/17
- Grading regression incl. straight-up confidence: 62/62
- Full `bash scripts/test_all.sh --fast`: **102 test files passed, 0 failed**
- Fast suite skips the existing 7 real-browser Playwright E2E files.

## Next confidence-pool work

Recommended next phase is weekly setup/import + Confidence Board UX:
- import weekly Splash sheet rather than manually adding games
- dedicated This Week / Results / Pool Settings subviews
- suggested PickGauge confidence ranking
- reorder-based ranking instead of dropdown-heavy entry
- card completion/readiness state
- submitted-card snapshot + locks
