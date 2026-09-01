# PickGauge → Claude handoff
Date: September 1, 2026

## Start here
This ZIP is now the **complete integrated PickGauge project**, not a patch bundle.

Read in this order:
1. `INTEGRATION_TEST_REPORT_2026-09-01.md`
2. `REMAINING_TODO_2026-09-01.md`
3. `CURRENT_STATE.md` / older historical handoffs only when deeper background is needed

Do not reapply the old ChatGPT patch ZIPs. Their code is already integrated into this project.

## Current engineering state
The user uploaded the latest GitHub Download ZIP and ChatGPT applied all current Survivor work through P4 #25–26 directly to that full project.

The previously verified production GitHub/Vercel base was:
`403bce57669740526b86cb96b52171cd53dc57fd`

Production was still on that older base when this handoff was prepared. This integrated ZIP has **not** been deployed yet.

## Regression status
`bash scripts/test_all.sh`

- 82 test files passed
- 1 browser E2E file was blocked by this sandbox before the app could load:
  `ERR_BLOCKED_BY_ADMINISTRATOR` on Playwright navigation to localhost

All new Survivor P1/P2/P3/P4 regressions pass.
See `INTEGRATION_TEST_REPORT_2026-09-01.md` for exact details.

## Survivor rules that must remain intact

### SEC
- 1 pick/week
- no reuse
- for any listed game involving an SEC team, **either side is selectable**, including a non-SEC opponent

### Big Ten
- 1 pick/week
- no reuse
- for any listed game involving a Big Ten team, **either side is selectable**, including a non-Big Ten opponent

### KellyInVegas Championship
- 2 picks/week
- both must win
- no reuse
- cannot take opposite sides of the same game

### Shared modeling/data
- reuse PickGauge CFBD data layer
- no separate Survivor API pipeline
- HFA = 2.6
- margin SD = 16
- probability priority: CFBD Pregame WP → SP+ → line-derived → missing

## Durable vs device-local state
Durable account state:
`state.survivor`

Includes entries, picks, selection-time metadata and recommendation history.

Device-local navigation:
`pickgauge_survivor_ui_v1`

Includes active pool, active entry selection, viewed week and Survivor sub-tab.

Do not move the UI-navigation state back into synced account state.

## Integrated Survivor feature set

### P0/core already present on the uploaded base
- real exact season optimizer
- Kelly 2-pick exact handling
- no reuse
- same-game capacity/opposite-side protection
- schedule/results engine
- fallback schedule lifecycle

### P1 integrated
- interrupted debounced-sync recovery via account-bound pending marker
- cross-device durable-state contract
- CFBD timeout/network hardening
- degraded enrichment retry/cache protection
- rollover/result edge regressions
- production acceptance checklist
- standalone retirement gate

### P2 integrated
- Best Play / Best Pair explanation
- simplified data-health presentation
- Future Value stars
- mobile Season Board density improvements
- entry management
- used-team history
- weekly Survivor summary
- Survivor share/export graphic

### P3 integrated
- History tab
- results/history dashboard
- selection-time pick metadata
- recommendation history
- entry comparison
- strategy indicators
- richer share cards

Historical rule: do **not** fabricate old selection-time probabilities/recommendations when they were not actually recorded.

### P4 #25 integrated — multi-entry diversification
Pure engine:
`app/survivor-core/js/portfolio.js`

The portfolio layer sits above the existing single-entry exact optimizer. It generates strong exact candidate paths per entry, then chooses the cross-entry combination that improves the modeled chance at least one entry survives.

Labels:
- ANCHOR = stays on strongest standalone exact path
- DIVERSIFIER = may accept a small individual-path sacrifice to reduce shared exposure

It does not automatically edit saved picks.

### P4 #26 integrated — at least one survives probability
For up to 12 live entries it uses exact inclusion-exclusion over path events:
- same team/same game = shared outcome
- identical paths are not double-counted
- partial overlap only shares actual common events
- opposite sides of one game cannot both survive

For >12 live entries it uses deterministic seeded Monte Carlo.

Different games still use the normal across-game independence assumption.

The displayed probability is conditional from the current week forward.

## Important integration fixes made during full-repo application
Two patch-package problems and two regression-contract problems were discovered only after applying the cumulative chain to the actual repo. They are fixed in this ZIP:
- missing P2 #10–15 runner dependency
- P3 History installer quote/markup mismatch
- launch acceptance test asserted nonexistent interaction attributes
- P3 test expected escaped History markup

Do not restore the old versions of those tests/install assumptions.

## PickGauge Model # decisions to preserve
- branded PickGauge Model # is user-facing
- proprietary weights stay hidden
- may describe it as a blend of selected successful models plus market influence
- current market/Vegas ingredient stays part of the formula
- dynamic predictive inputs may renormalize when some sources are unavailable
- fewer than the minimum predictive-source threshold should yield blank/unavailable rather than fake precision
- My Numbers does not automatically alter PickGauge Model #

## Rotation numbers
Still intentionally unresolved. Do not build an Odds API rotation-number feature until there is a real Brad Powers vs Odds API comparison proving the number source matches the pool sheets.

## Premium
Payment/paywall is still deferred unless the user explicitly reprioritizes it.

## Next work
Use `REMAINING_TODO_2026-09-01.md` as the active list.

Immediate sequence:
1. run the blocked browser E2E suite in an unrestricted environment if available
2. deploy this integrated project
3. authenticated Survivor persistence acceptance
4. second-device acceptance
5. mobile production acceptance
6. real CFBD result + week-rollover validation
7. retire standalone Survivor only after the gate passes
8. finish overall PickGauge production launch QA

Do not start another speculative Survivor feature phase before those acceptance steps unless the user explicitly asks.
