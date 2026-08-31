# PickGauge — ChatGPT session summary — Aug 30, 2026 — items #11 + #12

## Scope
Implemented the next two launch-list items:
1. Beta analytics review / activation-funnel instrumentation.
2. Beta feedback workflow/context improvements.

## #11 — Analytics
- Existing aggregate event counts were not sufficient to calculate conversion because repeat actions (refreshes, picks, tab views) can fire many times per person.
- `/api/beta` now stores a **daily event-specific HyperLogLog** in addition to the existing daily overall HLL. This preserves the privacy-light aggregate architecture while allowing true unique signed-in users per milestone across a 1–90 day range via PFCOUNT union.
- Core milestones: `app_open`, `signup`, `pool_ready`, `predictions_ready`, `pick_ready`, `snapshot_view`, `entry_submitted`.
- `pool_ready`, `predictions_ready`, and `pick_ready` are emitted on app startup when synced state already contains the milestone, and again after the corresponding successful action; HLL deduplication means repeats do not inflate unique-user conversion.
- `signup` is emitted only when Clerk says the account was created within the last 24 hours; HLL deduplication prevents refreshes from multiplying that user.
- Snapshot tab visits now emit `snapshot_view`.
- Account → Beta admin now shows: active users, new accounts, app opens, entry submissions, Snapshot exports, feedback; signed-in activation funnel; feature activity; app-open mobile/desktop mix; recent 7-day activity; recent feedback.
- Important: public marketing-page visits are intentionally not tracked, so the admin panel explicitly calls this a signed-in activation funnel rather than pretending it measures visit→signup conversion.
- Per-event unique funnel data starts with this Aug 30 build (`funnelSince=2026-08-30`). Existing overall active-user HLL data remains continuous.

## #12 — Feedback
- Feedback types are now Bug / Confusing / Feature request / Other (`idea` remains accepted server-side and normalizes to `feature` for backward compatibility).
- Modal shows the exact coarse context that will be attached before submission.
- Automatically attached, allowlisted context: active tab, mobile/desktop, Overall/pool, season/week, header-vs-Help feedback entry point, recent product action/source.
- Core attempted actions are remembered client-side before network/parsing work starts, so a failed action can still be useful context in the report.
- Still never attached: screenshots, picks, model numbers, pool names, email addresses, imported-file contents.
- Admin feedback list surfaces the new context inline.
- Privacy policy updated to match the exact behavior.

## Files materially changed
- `api/beta.py`
- `app/js/beta.js`
- `app/js/tabs.js`
- `app/js/pool-contexts.js`
- `app/js/prediction-tracker.js`
- `app/js/picks.js`
- `app/js/odds.js`
- `app/js/pdf-import.js`
- `app/js/my-numbers.js`
- `app/js/board.js`
- `app/index.html`
- `app/css/app.css`
- `privacy.html`
- `tests/test_beta_analytics_feedback.py`
- `tests/test_beta_client_logic.mjs`
- `CURRENT_STATE.md`

## No model/grading changes
No PickGauge Model #, odds, line, grading, CFBD, pool parsing, or result calculations were changed.
