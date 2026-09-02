# PickGauge → ChatGPT handoff
Date: September 1, 2026 (Claude session)

## Start here
Read this file first for the narrative, then `CURRENT_STATE.md`'s September 1 entries (12 dated sub-sections, chronological, each self-contained) for full technical detail on any item below. `MODEL_DATA_PACKAGE_2026-09-01.md` (same folder) is a separate, focused document — the ATS model/backtest data specifically, prepared because Drew asked for it directly. Read that one on its own if model/recipe analysis is the task; it duplicates some of this file's recipe-change summary for that reason.

**`REMAINING_TODO_2026-09-01.md`** is the live, current to-do list — treat it as more current than any older handoff/todo doc still floating around the repo.

## What happened this session, in order

1. **Merged and independently verified a guest-snapshot public-preview fix** that arrived as a separate ChatGPT-produced zip. Real bug (anonymous visitors could get permanently stuck on "warming up"), fix code-reviewed against source (confirmed the Redis cooldown is genuinely global, not per-IP; confirmed sensitive fields never leak to the public response), then re-verified with the FULL test suite including the real-browser E2E tests that ChatGPT's own sandbox couldn't run.

2. **Replaced the PickGauge Model # recipe entirely** with Drew's new 6-system weighted table (TeamRankings.com 20% / Vegas 19% / Sagarin Points 18% / SP+ 16% / Waywardtrends 15% / Sagarin Ratings 12%). Full detail plus a real discrepancy this surfaced (the app's own stored backtest table doesn't include 2 of the 6 new recipe systems) is in `MODEL_DATA_PACKAGE_2026-09-01.md`.

3. **Full UI/UX review** — rendered every populated app state in a real browser (not just read from source) and found 5 real issues. Worked through 3 of them today, in priority order Drew picked:
   - **Edge Board now labels lean strength in words** (Strong/Good/Slim), not color alone — previously every game's lean looked like an equally-weighted "pick," including 0.3-point noise. Shared one `edgeTierLabel()` helper between Board and Snapshot so the two views can't describe the same edge differently.
   - **Snapshot no longer overstates a flat week.** "Top Opportunities" used to always show 5 cards regardless of quality; now gated on actually clearing the edge threshold, heading adapts ("No standout edges this week"), and the shareable "Top 5 Edges" export graphic is blocked on an all-slim week rather than publishing the overstatement. Caught and fixed a real bug I introduced mid-work (duplicate messaging) and reverted a "fix" that made card sizing worse — both caught only by actually re-rendering, not by reasoning about the code.
   - **My Numbers column/mobile row hidden by default** until the panel is opened or a number is actually entered — was previously 8 empty "enter line" boxes on every board view and every mobile card regardless of whether anyone used the feature. Verified the one behavior that mattered most to get right: entering a number then closing the panel again keeps the column visible (never hides real data).
   - **Completed Sept. 2:** removed raw provider quota from the primary authenticated header, moved it into collapsed Advanced provider diagnostics, added desktop text labels to Feedback/Account/Settings/Help while preserving icon-only mobile controls, and moved manual Pull/Push sync actions under collapsed Sync troubleshooting.

4. **Repo cleanup** (TODO #27, mostly done): removed 17 confirmed-stale/resolved files. Two items still need Drew's own confirmation before final cleanup — see `REMAINING_TODO_2026-09-01.md` #27 for exactly what's pending and why (one involves a possibly-unresolved credential rotation, deliberately not auto-resolved).

5. **Structural work, all shipped:** extracted the last big inline CSS blocks (`css/marketing.css`, `css/legal-pages.css`) out of 8 root HTML pages; split Snapshot/social-export code out of `board.js` into its own `snapshot-export.js`; split the single 739-line Playwright E2E test file into 7 independent scenario files (proved the fix by injecting a real crash into one and confirming the other 6 ran unaffected — the exact problem that split was meant to solve).

## Regression status
`bash scripts/test_all.sh` → **94 test files pass, 0 failed** as of the last change this session, including the full real-browser E2E suite (7 files, split from the original one).

## Verification discipline this session (worth knowing before auditing further)
Several real bugs were caught only by actually rendering the app in a real browser and looking at the output, not by reading code:
- A naive CSS-rule-splitting script silently stripped an `@media` wrapper off two responsive rules during the CSS extraction work — would have broken `pricing.html`'s desktop layout. Caught by grepping the output for `@media` and finding zero matches.
- The Snapshot thin-week fix initially showed the same "nothing qualifies" message twice (an amber note plus a duplicate grid message) — caught in a screenshot, not in code review.
- An assumed CSS fix (dynamically resizing the Top Opportunities grid) was reverted after actually measuring that the default layout already handled it correctly and the "fix" made a single card wrongly stretch to hero size.

If continuing this work, the same standard applies: render before claiming something is fixed, especially for anything touching CSS grid/flex layout or multi-state conditional rendering.

## Next up
`REMAINING_TODO_2026-09-01.md` #3 (authenticated Survivor persistence acceptance) is next in the original priority order — needs Drew's real Clerk/Redis production account, not testable in a sandbox. The remaining general UI review item from this pass is the marketing-homepage CTA wording; the authenticated header/quota/sync cleanup was completed Sept. 2.
