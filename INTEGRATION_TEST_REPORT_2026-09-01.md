# PickGauge cumulative integration report — September 1, 2026

## Source
User supplied the latest GitHub Download ZIP: `CFB-ATS-Dashboard-main (1).zip`.
The previously verified GitHub/Vercel production base was `main` commit `403bce57669740526b86cb96b52171cd53dc57fd`.

## Integrated Survivor work
Applied to the real full project:
- P1 #1–9: persistence recovery, cross-device state contract, CFBD reliability, rollover/result coverage, production acceptance/retirement gates
- P2 #10–17: Best Play explanation, data-health UX, Future Value stars, mobile board density, entry management, used history, weekly summary, share/export
- P3 #18–22: History, recommendation history, entry comparison, strategy indicators, richer social sharing
- P4 #25–26: multi-entry diversification optimizer + dependency-aware probability at least one entry survives

## Integration issues found and fixed

### 1. Missing cumulative P2 helper
The P4 transfer package referenced `apply_survivor_p2_10_15.py` but did not include it. The intended runner is simply P2 #10–12 followed by P2 #13–15. The integration chain was repaired before the final project was built.

### 2. P3 installer quote mismatch
The P3 History installer searched for backslash-escaped HTML quote sequences, while the real integrated Survivor markup contains normal HTML quotes. The installer was corrected so History is added to the actual post-P2 subnav and the strategy-badge insertion targets the real markup.

### 3. New launch-contract test asserted nonexistent UI attributes
The P1 acceptance-contract test looked for `data-survivor-pool`, `data-survivor-week` and `data-survivor-pick`, but the real UI intentionally uses `#survivorPoolSelect`, `#survivorWeekSelect` and `data-survivor-pick-game`. The regression was corrected to assert the actual production interaction contract.

### 4. P3 test still expected escaped History quotes
The P3 regression was updated to assert the actual `data-survivor-view="history"` markup after the installer correction.

## Full regression result
Command:
`bash scripts/test_all.sh`

Result:
- **82 test files passed**
- **1 test file could not execute because of sandbox browser policy**

The only non-pass:
`python3 tests/test_e2e_ui_behaviors.py`

Failure happened before the app loaded:
`Page.goto: net::ERR_BLOCKED_BY_ADMINISTRATOR at http://localhost:<port>/app/index.html`

This is an environment restriction on Playwright/local browser navigation, not a PickGauge assertion failure.

## Explicit Survivor regressions that pass
- `tests/test_survivor_core_not_stub.mjs`
- `tests/test_survivor_enrichment_client.mjs`
- `tests/test_survivor_launch_acceptance_contract.mjs`
- `tests/test_survivor_p2_ux.mjs`
- `tests/test_survivor_p2_13_15.mjs`
- `tests/test_survivor_p2_16_17.mjs`
- `tests/test_survivor_p3_18_22.mjs`
- `tests/test_survivor_persistence_sync.mjs`
- `tests/test_survivor_portfolio.mjs`
- `tests/test_survivor_rollover_edges.mjs`
- `tests/test_survivor_schedule_fallback.mjs`
- `tests/test_survivor_cfbd_reliability.py`
- existing `tests/test_sync_revision_logic.mjs`
- existing server enrichment coverage

## Static/syntax sanity
Passed:
- `node --check app/js/survivor-integration.js`
- `node --check app/js/survivor-data-adapter.js`
- `node --check app/js/survivor-core-bridge.js`
- `node --check app/survivor-core/js/portfolio.js`
- `node --check app/survivor-core/js/survivor-score.js`
- Python compile checks on `api/fetch_cfbd.py` and `api/state.py`
- local HTTP server/curl retrieval of `app/index.html`, Survivor integration JS and portfolio JS
- index references Survivor integration
- Survivor integration contains Portfolio Strategy
- portfolio module exports `buildDiversifiedPortfolio`

## Source changes versus uploaded base
Changed existing production files:
- `api/fetch_cfbd.py`
- `app/css/survivor-integration.css`
- `app/js/init.js`
- `app/js/survivor-core-bridge.js`
- `app/js/survivor-data-adapter.js`
- `app/js/survivor-integration.js`
- `app/js/sync.js`
- `app/survivor-core/core-manifest.js`

New production/support files:
- `app/survivor-core/js/portfolio.js`
- `.github/workflows/survivor-p1-launch-readiness.yml`
- `docs/SURVIVOR_PRODUCTION_ACCEPTANCE.md`
- `docs/SURVIVOR_LIVE_ACCEPTANCE.example.json`
- `scripts/check_survivor_retirement_gate.mjs`
- new Survivor regression files under `tests/`

## Deployment status
**Not deployed by ChatGPT.**
This ZIP is the complete integrated candidate. Next step is deploy + real authenticated/mobile/cross-device/live-result acceptance.
