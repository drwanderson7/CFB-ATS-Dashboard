# PickGauge Session Summary — Confidence Straight-Up Ranking

Date: 2026-09-02
Build target: after `R` confidence weekly workflow

## User decisions locked in
- ATS push: 0 confidence points, recorded as a push (not a loss).
- Tiebreaker: unknown / not implemented yet.
- Straight-up confidence pools: yes, build an estimated PickGauge Win % ranking.
- External Splash standings import: later.
- Canceled/postponed game rules: unknown / deferred until Splash rule is known.

## Straight-up confidence ranking implemented
`app/js/confidence-integration.js`

### PickGauge Win % methodology
- Uses the existing PickGauge Model # projected HOME spread.
- Converts implied projected home margin (`-model`) into win probability using a normal residual model.
- Residual standard deviation = 15.5 points, tied to PickGauge's existing historical CFB cover-margin calibration documented in `app/js/model.js` (~15.3–15.7 across spread buckets).
- Does not create a separate Survivor rating or expose proprietary PickGauge blend weights.
- Probability is clamped to 1%–99%.
- A model exactly at pick'em returns 50/50 and no automatic side.

### Confidence Board behavior
- `Build PickGauge ranking` now works for ATS and straight-up pools.
- ATS sorts by Cover % against the locked pool spread, then edge.
- Straight-up sorts by PickGauge Win %, then model-vs-live-market disagreement as tie-breaker.
- Straight-up board displays:
  - Live market line
  - PickGauge Model #
  - Vs market
  - Win %
  - Recommended team + estimated win probability
- ATS board remains unchanged conceptually (Edge / Cover %).

### Submission / export
- Straight-up submission snapshots now save `winProbabilityAtSubmit`.
- PDF/print export switches probability column from Cover % to Win %.
- CSV export switches probability column from Cover % to Win %.

## Tests
Updated `tests/test_confidence_weekly_workflow.mjs`:
- verifies projected margin -> straight-up win probability
- verifies stronger favorite has higher Win %
- verifies one-click straight-up suggested card
- verifies highest Win % receives highest confidence points
- verifies straight-up analysis exposes Win % and no Cover %
- verifies submission snapshot contains both cover/win probability fields for schema stability

Full fast suite: **104 files passed, 0 failed**.

## Still intentionally unresolved
1. Splash confidence tiebreaker rule / UI.
2. Splash actual leaderboard import.
3. Canceled/postponed confidence-game scoring and point treatment.
Do not guess these rules until a real Splash rules/standings artifact is available.
