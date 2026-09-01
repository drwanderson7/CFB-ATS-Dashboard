# PickGauge — Remaining To-Do Only
Updated September 1, 2026 after cumulative Survivor P1–P4 integration + deploy, and the #17/#18 My Numbers/pools shipments.

Completed work has been removed from this list.

## Launch-critical

### 1. Deploy the integrated cumulative build — DONE (Sept 1, Drew)
Deployed to production.

### 2. Run the browser E2E suite in an unrestricted environment — DONE (Sept 1, Claude)
Re-ran `tests/test_e2e_ui_behaviors.py` in a sandbox without the `ERR_BLOCKED_BY_ADMINISTRATOR` restriction: 71/71 checks pass. Full suite is now 83/83 including this file.

### 3. Complete authenticated Survivor persistence acceptance
With a real Clerk account, create/rename entries, make/remove SEC/Big Ten/Kelly picks, refresh immediately after a save, sign out/in, and confirm durable state survives through the real Clerk + Redis stack.

### 4. Complete cross-device Survivor acceptance
Use the same account on desktop and a second browser/phone. Entries and picks should sync both directions, while viewed pool/week/sub-tab remains device-local.

### 5. Complete Survivor mobile production QA
Test a real phone-width build, especially Season Board scrolling/sticky team column, Kelly two-pick rows, History, Portfolio Strategy, entry management, and share/export actions.

### 6. Validate real Survivor results and actual week rollover
Use real CFBD finals to confirm W/L grading, elimination, Kelly both-must-win behavior, postponed/rescheduled handling, and automatic movement to the next Survivor week.

### 7. Retire the standalone Survivor deployment — SKIPPED per Drew
Not being pursued right now. `node scripts/check_survivor_retirement_gate.mjs` remains the gate whenever this is revisited — it still requires real evidence in `docs/SURVIVOR_LIVE_ACCEPTANCE.json` (8 boolean fields), so nothing here needs to change to keep it blocked in the meantime.

### 8. Run the full production PickGauge smoke test, including normal email sign-in
Google OAuth was previously validated. Still test standard email auth in a clean session and walk through Edge Board, model/Powers loading, pool import, My Numbers, picks, Snapshot, My Picks, Results, feedback, logout/login persistence, and Survivor.

### 9. Complete physical-device signoff for the whole PickGauge app
Test Safari on a real iPhone and Chrome on a real Android device. Focus on keyboard/focus behavior, imports, dropdowns, dense tables/cards, Snapshot, My Numbers, Account/Settings, feedback, and Survivor.

### 10. Validate live 2026 CFBD / closing-line behavior
During actual games, confirm canonical identity joins, live/final status, kickoff locks, automatic grading, retained pre-kick closing lines, neutral sites, FBS/FCS games, reschedules/postponements, and Matchup Intelligence advanced-stat fields.

## Production operations / launch setup

### 11. Add or verify the DMARC record
SPF and DKIM were already confirmed. Verify `_dmarc` is present; if not, add the monitor-only `p=none` record documented in `DNS_EMAIL_SETUP.md` and review reports before moving to enforcement.

### 12. Establish Redis operational monitoring and recovery
The data-integrity/CAS logic is tested. Set a simple production routine for Upstash usage, latency/errors/storage, and document how account state would be recovered from a Redis incident.

### 13. Verify old migration access is no longer needed
Confirm the old-user migration period is over and remove/unset any migration-only secret or endpoint access that is still configured. Do not remove anything still needed by real users.

### 14. Operate the beta-feedback and production-monitoring loop
Analytics and feedback plumbing already exist. Regularly review Vercel errors, CFBD/API failures, activation metrics and user feedback, then prioritize fixes from real usage.

## Product / monetization work still open

### 15. Finalize homepage positioning around PickGauge Model # — IN PROGRESS (Sept 1, Claude)
Homepage previously never mentioned "PickGauge Model #" by name at all -- only the DIY build-your-own-composite workflow. Added one sentence to the hero paragraph in `index.html` introducing it as a zero-setup alternative to picking your own weights. Two bigger positioning directions were proposed and NOT taken yet (flip the hero to lead with Model #; evidence-first once real 2026 ATS data exists) -- see `CURRENT_STATE.md`'s Sept 1 part-3 entry. Revisit once there's a real season sample or appetite for a bigger homepage rewrite.

### 16. Refine My Numbers manual-entry UX — ELIMINATED per Drew
Natural-language entry like `Georgia -7` already existed for CSV import (`parseMyNumbersLine()`); no further work needed.

### 17. Add clearer pool-entry progress/status — DONE (Sept 1, Claude)
Pool rows now show per-entry Draft/Ready/Submitted chips with pick counts and submission timestamps (`poolEntryProgressHTML()`, `app/js/pool-contexts.js`). Tests: `tests/test_pools_page_logic.mjs`, 95/95.

### 18. Build My Numbers historical performance — DONE (Sept 1, Claude)
Manual W/L/P grading (same UX pattern as Results' real-pick grading) with frozen-at-entry market lines, aggregate ATS record/win rate/average edge/edge buckets. See `app/js/my-numbers.js` and `CURRENT_STATE.md`'s Sept 1 entry for the full writeup, including the deliberate manual-vs-auto-grading scope decision flagged there. Tests: `tests/test_my_numbers_logic.mjs`, 49/49.

### 19. Add My Numbers CSV export
Allow users to download their saved weekly personal projections for backup, sharing or external analysis.

### 20. Decide free vs premium boundaries
Define what PickGauge offers free versus what eventually becomes paid before implementing billing so product strategy drives entitlement architecture.

### 21. Implement payment/paywall when monetization is ready
When the premium decision is made, add checkout/subscription state, entitlement checks and premium feature gating. This remains intentionally deferred until the launch experience is stable.

### 22. Execute the launch marketing plan
Begin real outreach: Splash commissioners, targeted beta invites, X/Twitter posting, Top 5 Edge graphics, Survivor graphics, and examples demonstrating the pool import workflow.

## Post-launch / maintainability

### 23. Multiple personal models / optional My Composite
Support separate user-defined models such as Power Ratings, Friend's Model or My Model A, with an optional personal composite that remains clearly separate from the proprietary PickGauge Model #.

### 24. Refactor Snapshot/social-export code out of `board.js`
Move large export/share responsibilities into a dedicated module so Board logic remains maintainable as social features grow.

### 25. Extract remaining large inline app CSS
Continue structural cleanup without a framework rewrite. The goal is safer maintenance and mobile changes, not changing the current UI architecture.

### 26. Split the Playwright suite into smaller scenarios
Break the long sequential browser test into independent workflows so failures are easier to diagnose and one setup issue cannot hide later checks.

### 27. Repository cleanup — MOSTLY DONE (Sept 1, Claude)
Removed 17 confirmed-stale root files (empty `package-lock.json`, resolved incident docs, 9 superseded session summaries, today's own already-absorbed handoff docs). See `CURRENT_STATE.md`'s Sept 1 part-4 entry for the full list and reasoning. **Two items intentionally left for you to decide, not auto-deleted:**
- `cfb_ats_todo.md` has an unresolved-looking "rotate your credentials" item (CLERK_SECRET_KEY/ODDS_API_KEY/CFBD_API_KEY/app secret leaked in a shared doc, a while back). **Please confirm whether those were actually rotated** — if yes, safe to delete next round; if no, that's a real outstanding security task, not just a stale file.
- `handoff.md` (172K) + `chatgptnotes.md` — the old pre-`CURRENT_STATE.md` versioned dev log and its onboarding note, still referenced by `NEW_SESSION_START_HERE.md`. Your call whether the deep "why" history in there is worth keeping or whether `CURRENT_STATE.md` alone is enough going forward.
No `__pycache__`/`.pyc`/`.pytest_cache` were present in this handoff to begin with (test runs regenerate and clean these; nothing to remove there this round).

### 28. Normalize Vercel function-duration configuration
Review function `maxDuration` settings (including `fetch_teams`) for consistency now that CFBD/Survivor network budgets have been hardened.

## Future enhancements — not launch blockers

### 29. Recommendation-change alerts
Notify users when a Survivor Best Path materially changes, not for insignificant probability movement.

### 30. Weekly Survivor email/report
Send a concise weekly strategy recap with saved picks, Best Path, future-value pressure and results.

### 31. Deeper historical/model analytics
After enough real 2026 data exists, expand model calibration, recommendation performance and historical analytics based on actual season evidence.

### 32. Commissioner-facing tools
Explore features that help pool commissioners onboard participants, distribute PickGauge workflows, or manage/import pool structures.

## Intentionally tabled
Model-family correlation / optimized re-weighting, WEPA, weather, opponent adjustments and other speculative model expansion remain behind launch validation and real 2026 data.
