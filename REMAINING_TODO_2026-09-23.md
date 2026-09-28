# PickGauge — Remaining To-Do Only
Updated September 23, 2026. Replaces `REMAINING_TODO_2026-09-01.md` and the
older `cfb_ats_todo.md` (both deleted; their still-open items are carried
over below). Completed work is removed; see `CURRENT_STATE.md` for history.
Original item numbers from the Sept 1 list are kept in brackets.

## 🚨 Security — on Drew, not code

### 1. Confirm or rotate leaked credentials [from cfb_ats_todo.md]
A shared Word doc once contained `CLERK_SECRET_KEY`, `ODDS_API_KEY`,
`CFBD_API_KEY` and an app secret in plaintext. If not already done, rotate
all four (Clerk dashboard / the-odds-api.com / collegefootballdata.com),
update each in Vercel → Settings → Environment Variables, and redeploy.
Clerk secret is the most urgent. **Needs Vercel/Clerk admin access.**

## 🟢 Just shipped (Sept 23) — verify live

### 2. Confirm automatic lines/models loading in production
First signed-in visit of the day should trigger at most one Odds API
refresh; later visits within ~30 min should trigger none. Watch the calls-left
count in Settings → Advanced for a few days.

### 3. Confirm automatic weekly archive in production
Week 4 picks should appear in Results on their own after the week's last
game (+5h), then grade on the 14:00 UTC cron or via "Check results now."
Check one pool context and No Pool.

### 4. Phone check of the compacted All Games rows
Real iPhone/Android: card-first layout, side-by-side pick buttons, in-card
Why?, long school names, "Your line" editor after picking.

## 🎯 UI/UX workflow backlog (Sept 23 review)
Done: #1 auto-load, #2 auto-archive, #5 This Week de-dup, #6 single All
Games link, #9 one pool prompt, #10 mobile rows, #12/#13/#16/#17 small
fixes, #14 Confidence ATS banner, #18 stray root `app.css`, phone
pre-slate stack.

### 5. Pick into multiple pools from one tap [review #3]
"Add pick" opens a small popover listing every pool/entry (with each pool's
locked line) so multi-pool players stop switching the Viewing context.
Biggest remaining workflow win.

### 6. One "My Pools" hub [review #4]
ATS, Confidence and Survivor pools as cards with this-week status (lines
imported, picks x/7, submitted) and the weekly PDF upload on the card.
Proposed nav: This Week | All Games | My Pools | Results. Larger IA change;
do after #5.

### 8. Trim the This Week stats strip [review #7]
"Key-number crossings" (often every game) and "Shortlisted 0" add little.

### 9. Shortlist vs. pick [review #8]
Two save concepts (flag vs. star); on phones they're unlabeled icons.
Drop Shortlist or relabel; show "+ Pick" text on phones.

### 10. Pools page cleanup [review #11]
Four "create pool" buttons on one screen; "FULL SLATE" eyebrow wrongly shown
on My Picks and Pools.

### 12. Update or delete 4 stale browser tests [new]
Fail identically on the unmodified Sept 16 zip; not in `--fast`:
`test_e2e_mobile_ux.py`, `test_e2e_pools_hides_shared_widgets.py`,
`test_e2e_weekly_setup.py` (pre-Sept 9 navigation/copy), and
`test_e2e_ui_behaviors.py` (the pre-split monolith — likely just delete).

### 13. Documentation sprawl [review #20, old #27]
`CURRENT_STATE.md` is ~3,500 lines (a changelog, not a state); 28
`SESSION_SUMMARY_*.md` files at the repo root; `handoff.md` 172K. Proposal:
`CURRENT_STATE.md` ≤150 lines present-tense, history to `docs/CHANGELOG.md`,
summaries to `docs/sessions/`. Drew to decide on `handoff.md` /
`chatgptnotes.md`.

## Launch acceptance (needs real accounts/devices)

### 14. Authenticated Survivor persistence acceptance [old #3]
Real Clerk account: create/rename entries, make/remove SEC/Big Ten/Kelly
picks, refresh right after saving, sign out/in; state must survive.

### 15. Cross-device Survivor acceptance [old #4]
Same account on desktop + phone: entries/picks sync both ways; viewed
pool/week/sub-tab stays device-local.

### 16. Survivor mobile production QA [old #5]
Season Board scroll/sticky column, Kelly two-pick rows, History, Portfolio
Strategy, entry management, share/export.

### 17. Real Survivor results and week rollover [old #6]
Real CFBD finals: W/L, elimination, Kelly both-must-win,
postponed/rescheduled, automatic next-week move.

### 18. Full production smoke test incl. email sign-in [old #8]
Clean session with email auth; walk every tab end to end, logout/login.

### 19. Physical-device signoff, whole app [old #9]
Safari on iPhone, Chrome on Android: keyboard/focus, imports, dropdowns,
dense tables/cards, This Week, My Numbers, Account/Settings, Survivor.

### 20. Live 2026 CFBD / closing-line validation [old #10]
During games: identity joins, live/final status, kickoff locks, auto
grading, retained pre-kick closes, neutral sites, FBS/FCS, reschedules.

### 21. Splash locked-line sign convention after a Wednesday lock [from cfb_ats_todo.md]
Confirm with a real post-lock Splash sample (pre-lock import convention is
verified; post-lock still unconfirmed).

## Production operations

### 22. DMARC record [old #11]
Verify `_dmarc`; if missing add the monitor-only `p=none` record from
`DNS_EMAIL_SETUP.md`. **DNS admin access.**

### 23. Redis monitoring and recovery routine [old #12]
Upstash usage/latency/errors/storage check routine + documented recovery.

### 24. Retire old migration access [old #13]
Unset any migration-only secret/endpoint once confirmed unused.
**Vercel admin access.**

### 25. Feedback/monitoring loop [old #14]
Regular review of Vercel errors, API failures, activation metrics, feedback.

### 26. Normalize Vercel `maxDuration` settings [old #28]

### 27. Vercel function storage near 10GB Hobby limit
pdfplumber bundle duplicated across API functions; longer-term fix open.

### 28. Run tests automatically on every push [from cfb_ats_todo.md]
No `.github/workflows` yet. A GitHub Action running
`scripts/test_all.sh --fast` would catch regressions before deploy.

## Product / monetization

### 29. Homepage positioning around PickGauge Model # [old #15, in progress]
### 30. My Numbers CSV export [old #19]
### 31. Free vs. premium boundaries [old #20]
### 32. Payment/paywall when ready [old #21]
### 33. Launch marketing plan [old #22]
Splash commissioners, beta invites, X/Twitter model-disagreement posts, Top
5 Edge graphics, Survivor graphics, pool-import examples.

## Model work on the horizon
### 34. Sagarin direct fetch (weekly shared-tier cron)
### 35. Brad Powers rotation-number integration (needs live comparison)
### 36. SP+ backtest via cfbd-python
### 37. Brad Powers overlay weight toggle (after backtesting)

## Post-launch / future
### 38. Multiple personal models / optional My Composite [old #23]
### 39. Survivor recommendation-change alerts [old #29]
### 40. Weekly Survivor email/report [old #30]
### 41. Deeper historical/model analytics once 2026 data exists [old #31]
### 42. Commissioner-facing tools [old #32]

## Intentionally tabled
Model-family correlation / optimized re-weighting, WEPA, weather, opponent
adjustments and other speculative model expansion — behind launch
validation and real 2026 data.
