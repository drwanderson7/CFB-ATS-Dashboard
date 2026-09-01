# PickGauge — Remaining To-Do Only
Updated September 1, 2026 after cumulative Survivor P1–P4 integration.

Completed work has been removed from this list.

## Launch-critical

### 1. Deploy the integrated cumulative build
The full current project now contains Survivor P1 #1–9, P2 #10–17, P3 #18–22, and P4 #25–26. Deploy this integrated build to Vercel after reviewing the included integration report.

### 2. Run the browser E2E suite in an unrestricted environment
All non-browser regression files pass. `tests/test_e2e_ui_behaviors.py` could not run here because this sandbox blocks Playwright navigation to `localhost` with `ERR_BLOCKED_BY_ADMINISTRATOR`. Run it locally/CI or use production/previews for the equivalent smoke pass.

### 3. Complete authenticated Survivor persistence acceptance
With a real Clerk account, create/rename entries, make/remove SEC/Big Ten/Kelly picks, refresh immediately after a save, sign out/in, and confirm durable state survives through the real Clerk + Redis stack.

### 4. Complete cross-device Survivor acceptance
Use the same account on desktop and a second browser/phone. Entries and picks should sync both directions, while viewed pool/week/sub-tab remains device-local.

### 5. Complete Survivor mobile production QA
Test a real phone-width build, especially Season Board scrolling/sticky team column, Kelly two-pick rows, History, Portfolio Strategy, entry management, and share/export actions.

### 6. Validate real Survivor results and actual week rollover
Use real CFBD finals to confirm W/L grading, elimination, Kelly both-must-win behavior, postponed/rescheduled handling, and automatic movement to the next Survivor week.

### 7. Retire the standalone Survivor deployment
Only retire/archive the old standalone Survivor project after the integrated production acceptance evidence passes `node scripts/check_survivor_retirement_gate.mjs`.

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

### 15. Finalize homepage positioning around PickGauge Model #
Make the branded blended Model # a clearer product differentiator without unsupported “beats Vegas” claims. Explain the value while keeping the proprietary weights hidden.

### 16. Refine My Numbers manual-entry UX
After real usage, decide whether users should be able to type natural input such as `Georgia -7` instead of only a numeric home-team-perspective value. Avoid silent guessing when a team/side is ambiguous.

### 17. Add clearer pool-entry progress/status
Show progress such as `5 of 7 picks selected`, plus ready/submitted state and useful submission timing so users immediately know whether an entry is complete.

### 18. Build My Numbers historical performance
Track the user's personal projections over time: ATS record, win rate, average edge and useful edge buckets. Freeze historical inputs rather than recalculating old weeks with today's model.

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

### 27. Repository cleanup
Remove generated caches (`__pycache__`, `.pyc`, `.pytest_cache`) and stale/unused artifacts or lockfiles from the actual Git repository. Preserve `.github/`, `.gitignore`, and other hidden project files in handoffs.

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
