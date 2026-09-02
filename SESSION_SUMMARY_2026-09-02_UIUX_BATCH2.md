# PickGauge UI/UX Batch 2 — September 2, 2026

Source: `pickgauge-2026-09-02-B-uiux-batch1.zip`

## Scope
Focused authenticated-shell cleanup only. No scoring/model math, pool logic, Survivor logic, or persistence architecture was changed.

### 1. Provider quota removed from primary header
The authenticated header no longer displays `calls left` / Odds API request quota. It keeps the useful user-facing status:
- line refresh freshness/time
- account sync status
- Refresh lines action

Operational quota data now lives in a closed-by-default Settings panel:
`Advanced: provider diagnostics`

That panel shows:
- Requests remaining from the most recent provider response
- Last line refresh

Copy explicitly explains that this is troubleshooting information, can reflect either the shared connection or a configured personal key, and is not required for normal use.

### 2. Desktop header controls are labeled
Feedback, Account, Settings, and Help now render as compact icon + text controls on desktop.

At `max-width:720px`, the labels are hidden and the same controls return to 44×44 icon-only circular touch targets, so mobile density is unchanged.

The mobile hamburger's active-view label now reads `.icon-nav-label` from the header control and falls back to the `title` attribute.

### 3. Manual sync controls moved under troubleshooting
Account now leads with:
`Your PickGauge data syncs automatically across signed-in devices.`

The existing forced Pull/Push controls were not removed. They moved into a collapsed:
`Sync troubleshooting`

The disclosure explains that these actions are only for diagnosing a device that appears out of date. Existing button IDs and sync handlers are unchanged.

## Files changed
- `app/index.html`
- `app/css/app.css`
- `app/js/odds.js`
- `app/js/tabs.js`
- `tests/test_nav_hamburger_wiring.mjs`
- `tests/test_authenticated_shell_ux.mjs` (new)
- `PICKGAUGE_CHATGPT_HANDOFF_2026-09-01.md`

## Validation
Targeted:
- `node tests/test_authenticated_shell_ux.mjs` — PASS
- `node tests/test_nav_hamburger_wiring.mjs` — PASS
- `node tests/test_guest_preview_ux.mjs` — PASS
- JS syntax checks for `odds.js` and `tabs.js` — PASS

Full fast regression:
- `bash scripts/test_all.sh --fast`
- **90 test files passed, 0 failed**

The `--fast` suite intentionally skips the repository's real-browser `tests/test_e2e_*.py` files.

## Remaining UI/UX item from the prior recommendation
The marketing homepage CTA can still be revised to explicitly advertise the live no-sign-in Snapshot preview. No broader UI redesign is recommended without real-user feedback.
