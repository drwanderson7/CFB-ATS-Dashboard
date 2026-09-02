# PickGauge — Survivor Homepage Marketing Update

Date: 2026-09-02
Base package: `pickgauge-2026-09-02-G-closing-line-grading.zip`

## What changed

The public marketing homepage now presents Survivor as a substantial second PickGauge capability without replacing the ATS-first hero positioning.

### Homepage
- Kept the main hero headline unchanged: `Import your pool. Pick your models. Find your edge.`
- Changed the hero eyebrow to `CFB ATS + Survivor analytics`.
- Added a small hero link: `Also built for CFB Survivor pools →`.
- Added a dedicated `#survivor` section between Capabilities and How It Works.
- Survivor section explains:
  - Best Play & Best Pair
  - future schedule value / team scarcity
  - exact remaining-season path optimization
  - used-team history
  - multi-entry diversification / at-least-one-survives strategy
- Added an illustrative Survivor strategy preview panel so the feature is visually understandable rather than just a text bullet.
- Did **not** add another Survivor item to the homepage nav/menu; existing product navigation remains untouched.
- Updated the final CTA copy so it describes both ATS and Survivor use cases.

### SEO / social metadata
- Homepage meta description now includes ATS + Survivor.
- Open Graph description and image alt now include Survivor.
- Twitter description and image alt now include Survivor.
- JSON-LD WebApplication description now includes Survivor.

## Files changed
- `index.html`
- `tests/test_homepage_survivor_marketing.py` (new)
- `SESSION_SUMMARY_2026-09-02_SURVIVOR_HOMEPAGE.md` (new)

No app logic, ATS model math, pool logic, Survivor optimizer logic, persistence, API behavior, or authenticated navigation was changed.

## Validation
- `tests/test_homepage_survivor_marketing.py`: 13/13 checks passed.
- `tests/test_root_page_css_extraction.py`: 23/23 checks passed.
- `tests/test_sitemap_social_metadata.py`: 35/35 checks passed.
- `bash scripts/test_all.sh --fast`: 92 test files passed, 0 failed.
- Full Playwright E2E remains unavailable in the ChatGPT sandbox because browser navigation to localhost is blocked with `ERR_BLOCKED_BY_ADMINISTRATOR`.

## Intentional design decisions
- ATS remains the primary hero story.
- Survivor gets a prominent dedicated section rather than being reduced to a generic feature card.
- No direct `/app?tab=survivor` routing was added in this pass; the section CTA opens PickGauge normally and the existing Survivor product navigation remains the entry point inside the app.
