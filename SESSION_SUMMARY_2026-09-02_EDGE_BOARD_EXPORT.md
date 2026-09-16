# PickGauge Edge Board Offline Export — Sept 2, 2026

## Implemented

Added a new **Export board ▾** menu to the Edge Board with three actions:

1. **Weekly Board PDF** — primary/default offline-review export. Opens a dedicated landscape, multi-page print report for the entire current slate and intentionally ignores temporary Edge Board filters.
2. **Current view PDF** — same report format, but only includes the games currently visible after Board filters.
3. **Board CSV** — exports the full slate with one raw column per enabled BP/Comp/prediction-system input for Excel/Sheets.

## PDF / print report contents

The report includes:
- pool/context, active entry, week, generation time
- current Board sort/order
- rotation numbers and kickoff times
- matchup
- pool line (when in a pool) and live Vegas line
- every user-enabled BP/Comp/prediction-system value
- My Numbers when entered
- PickGauge Model # (or normal Model #)
- My Blend when active
- Cover %
- edge/lean + strength tier
- pick status and shortlist status

To keep the landscape report readable even when many systems are enabled, model inputs are grouped into a compact **Model inputs** cell instead of expanding to 15–20 horizontal table columns. The CSV retains one column per input.

The report deliberately excludes expanded Matchup Intelligence and does not expose PickGauge Model #'s proprietary internal weights.

## Implementation

New:
- `app/js/board-export.js`
- `tests/test_edge_board_export.mjs`

Changed:
- `app/index.html`
- `app/css/app.css`
- `app/js/init.js`

Help copy was also updated to explain the three export choices.

## PDF behavior

The PDF action uses a dedicated print document + the browser's native print dialog rather than a raster screenshot. On desktop choose **Save as PDF**. This preserves selectable text, clean multi-page page breaks, and better print quality.

## Validation

- Dedicated Edge Board export regression: **21/21 passed**
- Full fast PickGauge regression suite: **98 test files passed, 0 failed**
- JS syntax checks passed for the new export layer and init changes.

The sandbox Playwright install cannot render the report here because its bundled Chromium executable is unavailable; this is an environment limitation, not a product test failure. The report generator itself is covered by direct HTML-contract tests, and the full non-browser suite is clean.
