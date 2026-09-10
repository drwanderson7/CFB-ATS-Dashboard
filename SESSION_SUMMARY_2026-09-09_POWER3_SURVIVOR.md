# Session summary — KellyCFB Week 2 Survivor (2026-09-09)

## User-supplied rules implemented
- Pick 2 straight-up winners per week; both must win to advance.
- Teams cannot be selected more than once for the duration of the contest.
- Pick sheet includes games involving an SEC, Big Ten, or Big 12 team.
- Either side of an eligible game is selectable, including an FBS non-conference opponent.
- Any game containing a non-FBS team is excluded.
- Contest starts with 2026 Week 2 (Sept. 10-12 slate).
- Conference championship slate is not part of this contest. 2026 conference title games are Dec. 4-5, after Week 13; this template therefore stops after Week 13.

## Code changes
- `app/js/survivor-integration.js`
  - Added built-in `power3` template: `KellyCFB Week 2`.
  - `picksPerWeek: 2`, default `startWeek: 2`, `endWeek: 13`.
  - Added template to `+ Create pool` format selector.
  - Added concise visible rule summary.
  - Generalized opposite-sides validation/copy for any two-pick pool.
  - Fixed built-in templates so a template-specific default start week is respected.
  - Custom pool start-week normalization/validation respects a template end week.
- `app/js/survivor-data-adapter.js`
  - Added dynamic rule-derived eligible-game filter for the new template.
  - Requires both teams to be FBS.
  - Requires at least one team to belong to SEC, Big Ten, or Big 12.
  - Excludes postseason and Week 14+ for 2026.
  - Both sides are emitted to the selectable matchup set.
- `tests/test_survivor_power3_pool.mjs`
  - Verifies template configuration and actual eligibility filtering for FBS non-conference opponents, FCS exclusions, unrelated conferences, Week 13 inclusion, championship-week exclusion, and postseason exclusion.

## Verification
- All 19 `tests/test_survivor_*.mjs` files passed.
- `tests/test_survivor_cfbd_reliability.py` + `tests/test_cfbd_survivor_enrichment.py`: 4 passed.
- `node --check` passed for both modified Survivor JS files.
