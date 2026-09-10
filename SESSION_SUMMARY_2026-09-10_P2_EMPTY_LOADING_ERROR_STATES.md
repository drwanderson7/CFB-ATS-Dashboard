# PickGauge Session Summary — P2 Empty / Loading / Error States

**Date:** September 10, 2026

## Goal

Improve the quality of PickGauge's non-happy-path UX across the core product. Empty, loading, partial-data, and error states should tell the user **what happened, why the screen is empty, and what to do next** rather than showing a bare `No data`, an indefinite `Loading…`, or a dead end.

No model, odds, grading, pool scoring, Survivor eligibility, probability, import parsing, or persistence math was changed in this pass.

## Shared state system

Added `app/js/states.js` and loaded it immediately after the shared icon helper. The new `pgStateHTML()` renderer provides consistent:

- empty states
- loading states
- error states
- informational / partial-data states
- success states
- primary and secondary actions
- compact variants
- accessible semantics (`role="alert"` for errors and `aria-live` / `aria-busy` for loading)

`app/css/app.css` now owns the matching shared visual treatment and mobile action layout.

## This Week

`app/js/snapshot-export.js` now distinguishes three materially different reasons a user may see no recommendations:

1. **No games loaded yet** → Refresh lines
2. **Market lines are ready, but model edges are not** → Load models / Open All Games
3. **Slate is loaded, but the selected filter has no matches** → Show all games

The top-opportunity area also gets a concise partial-data state when ranked edges are not ready yet.

## All Games

`app/js/board.js` now explains why the board is empty instead of collapsing every case into one message:

- no market games loaded → Refresh lines / Open Pools if contest lines are needed
- selected ATS pool has no weekly slate → Open Pools / Refresh market
- shortlist is empty → Show full board
- CLV alignment filter has no matches → Show full board
- shortlist + alignment together have no matches → Clear filters

## ATS Pools

`app/js/pool-contexts.js` now provides:

- actionable first-use state when the user has no ATS pools → **Create pool**
- clear manual-entry state when no live market games are available for the selected week → **Refresh lines**

## Confidence

`app/js/confidence-integration.js` now gives weekly pool-sheet imports a proper lifecycle:

- **Reading pool sheet** while extracting the slate/rules/lines/lock
- clear success state after import
- actionable error state when import fails, with retry/manual-setup guidance

Additional Confidence states:

- no confidence pools yet → Create confidence pool
- no live market games in manual setup → Refresh lines
- no submitted cards yet in Results → Back to This Week
- individual entries with no history get a compact entry-level state instead of an ambiguous blank area

## Survivor

`app/js/survivor-integration.js` received the most important reliability UX fix in this pass.

Previously, the top Survivor health area could correctly say **Data issue** while child views such as Rankings, Season Plan, and History continued displaying **Loading… indefinitely**. These child views now inherit the actual runtime failure and expose a Retry action.

The Survivor state system now distinguishes:

- schedule/probability/optimizer loading
- actual load failure
- no unused teams available for the week
- no complete season path yet
- no Survivor history yet

Saved pools, entries, and picks are explicitly described as safe when the data fetch fails.

## Results

`app/js/record.js` now handles:

- no personal/model history at all → **Nothing to grade yet** with routes to My Picks and All Games
- no model snapshots yet → explains when snapshots are captured
- filters that match no graded picks → **Show all history**
- model performance exists but personal pick history has not started → informational first-use state

## Public / guest This Week

`app/js/guest-snapshot.js` now differentiates:

- normal preview warm-up / rate-limited data readiness → **Live preview is warming up**
- hard upstream/network failure → **Public preview could not load**

Both offer meaningful actions rather than leaving the guest preview in a generic not-ready state.

## Tests

Added `tests/test_p2_empty_loading_error_states.mjs` to pin the shared state renderer and each major product surface.

Updated two older Snapshot layout contracts to assert the new structured state behavior rather than legacy literal strings:

- `tests/test_snapshot_quicklook_layout.mjs`
- `tests/test_snapshot_thin_week.mjs`

### Verification

- **98/98 JavaScript `test_*.mjs` files passed**
- **37/37 non-browser Python `test_*.py` files passed**
- **8/8 touched JavaScript files passed `node --check`**
- **No duplicate IDs found in `app/index.html`**

Browser E2E scripts were not run in this sandbox; the existing environment does not provide a reliable local browser-navigation path. A standalone interactive state preview was generated for review before deployment.
