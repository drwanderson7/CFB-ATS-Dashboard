# PickGauge — Copy cleanup: All Games, Prediction Systems, Pool Setup

**Date:** September 9, 2026

Follow-up to beta-user feedback about excessive instructional text competing with the app's decision-making workflow. This pass changes copy and information density only; no model, pool, import, grading, odds, or persistence logic changed.

## Shipped

### All Games header + workflow
- All Games subtitle reduced to **“Full slate, ranked by your active model.”**
- My Picks and Pool Settings subview descriptions shortened.
- Default Overall workflow now says **Live market / No pool selected. Rankings use live lines.**
- Pool workflow states reduced to short action-oriented messages for missing lines, missing entry, in-progress card, and complete card.
- First-time pool CTA shortened to **Use your pool's lines / Import a sheet or enter locked lines manually.**

### Prediction Systems
- Replaced the long opening paragraph with two compact sentences explaining the only immediate choice: use PickGauge Model # or enable systems for comparison/My Blend.
- Third-party/source disclaimer reduced to one line plus Methodology link.
- My Blend helper copy shortened.
- Top 7 backtest explanation reduced to a short visible label; detailed weighting remains in the title tooltip.
- Removed the large always-visible methodology paragraph from the bottom of the panel. Replaced with one line explaining which number drives Edge/Cover % plus a Methodology link.
- Detailed behavior remains documented on `/methodology.html` and in Help; calculations are unchanged.

### Pool setup + import
- Heading changed from “Set up and maintain your ATS pools” to **Pool setup**.
- Overview reduced to **Create a pool once. Each week, update its contest lines here.**
- Three primary tasks shortened to Create pool / Update this week's lines / Manage entries.
- Dynamic weekly and entry messages shortened while retaining manual-vs-PDF behavior.
- “Quick import / other formats” renamed **Import another way**.
- Splash/ESPN PDF and ESPN paste instructions shortened.
- ATS setup wizard line-source step now asks **Where do your pool lines come from?** with shorter Import/Manual explanations.
- Per-pool ESPN paste help shortened without removing the no-kickoff-time caveat.

## Files changed
- `app/index.html`
- `app/js/tabs.js`
- `app/js/board.js`
- `app/js/pool-contexts.js`
- Regression copy contracts updated in:
  - `tests/test_this_week_core_experience.mjs`
  - `tests/test_pool_setup_cta_logic.mjs`
  - `tests/test_ats_pool_setup_wizard.mjs`
  - `tests/test_pickgauge_model_logic.mjs`

## Verification
- **92/92** Node `test_*.mjs` regression files passed.
- **37/37** non-browser Python `test_*.py` regression files passed.
- Browser E2E scripts were not run in this environment.
