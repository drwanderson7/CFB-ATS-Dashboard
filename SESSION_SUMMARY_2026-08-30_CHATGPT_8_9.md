# PickGauge session summary — Aug 30, 2026 (ChatGPT: items 8 & 9)

## Scope
Drew asked to implement the next two P1 items from the launch list:
1. Add national rank / percentile context to Matchup Intelligence.
2. Improve Results → Why? postgame analysis.

## Matchup Intelligence rank/percentile context
- Implemented entirely client-side from the already-loaded CFBD `/stats/season/advanced` dataset; no additional API requests.
- Every offense and defense raw value can now show `#rank/teams-with-data CLASSIFICATION · percentile` beneath the metric.
- FBS and FCS are ranked separately. An FCS extreme value cannot change an FBS rank.
- Directionality is metric-aware:
  - normal offense metrics: higher is better;
  - normal defense-allowed metrics: lower is better;
  - offense havoc allowed/suffered: lower is better;
  - defense havoc generated: higher is better.
- The denominator is deliberately teams with that metric currently available, not the full nominal FBS/FCS membership. This keeps Week 0/1 truthful before every team has played.
- At very narrow phone widths the percentile phrase hides while the compact `#rank/denominator` remains.
- Footnote in Matchup Intelligence explains classification/availability semantics.

## Results → Why? v2
The postgame panel is now explanatory rather than only a raw comparison table.

It now shows, in order:
1. Final score.
2. The user's archived pick, pick-time line, W/L/P result, and computed ATS cover margin (`covered by`, `missed by`, or `landed on the number`).
3. An `Overall read` showing which team had the stronger value in more tracked categories.
4. The three largest statistical separators.
5. The full advanced box-score comparison.

The full comparison now includes:
- success rate
- PPA/play
- explosiveness
- scoring opportunities
- points per scoring opportunity
- defensive havoc
- turnovers

### Separator methodology
The top-three ordering uses simple football-scale denominators only to make unlike units sortable for display (for example, 5 percentage points of success rate vs. 0.15 PPA/play). It is explicitly labeled descriptive, not causal, and is not a model input or grade calculation.

## Files changed
- `app/js/cfbd-insights.js`
- `app/js/record.js`
- `app/css/app.css`
- `tests/test_cfbd_insights_logic.mjs`
- `CURRENT_STATE.md`
- `methodology.html`
- this session summary

## Test additions
`tests/test_cfbd_insights_logic.mjs` now covers:
- offense rank direction
- FBS/FCS rank separation
- rank/percentile rendering
- final-score rendering
- Overall read
- top-three separator rendering/selection
- scoring-opportunity row
- archived ATS pick context and cover-margin calculation
- record.js propagation of picked team, pick line and W/L/P into the Why panel

## Remaining related follow-up
- Live visual smoke-test ranks on several Week 1 FBS-vs-FBS and FBS-vs-FCS games once deployed.
- Live smoke-test Results → Why? on actual Week 0 graded picks.
- The existing turnover category-name caveat remains: turnover data is best-effort from `/games/teams` and safely degrades to `—` if CFBD's flexible category name does not match.
