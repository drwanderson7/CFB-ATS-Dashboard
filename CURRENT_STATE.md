# PickGauge — Current State

**Last updated: August 19, 2026**

This is the SINGLE source of truth for what is true in the current codebase and what's next — not a separate ChatGPT/Claude roadmap doc on either side. Whichever AI session does real work (fixes, features, or reprioritization) updates this file as part of delivering the change, same as this file itself is exempt from Drew's "don't touch `handoff.md` unless asked" rule. Two competing status documents WILL drift — see "Corrections from the August 19 merge" below for a concrete example that already happened. `handoff.md` remains the historical/version log; use this file and `NEW_SESSION_START_HERE.md` for current priorities.

## Current architecture

- Static frontend: `app/index.html` + plain global-scope files under `app/js/` and `app/data/`; no build step or bundler.
- Vercel Python serverless APIs under `api/`.
- Clerk authentication.
- Upstash Redis for private per-user state and three isolated shared domains: odds, predictions, and pool templates.
- GitHub Actions runs `scripts/test_all.sh` on pushes/PRs.

## Reliability/data-integrity work already complete

- Private sync uses atomic Redis CAS and server revisions; browser clocks are no longer the authority for private-tier freshness.
- Successful odds/prediction fetches fall back to the fresh endpoint response if shared-cache persistence/pull fails.
- Pick-time decision snapshots freeze what PickGauge knew when the pick was made, including Model #, raw and picked-side Edge, Cover %, EV, key-number signal, enabled model inputs/weights, selected book, and timestamp.
- True pre-kick line history is retained separately from the live odds feed, so the last observed pre-kick line survives after an event disappears from `/odds`.
- Archive CLV uses the pick's frozen sportsbook preference and the retained pre-kick line; missing closes remain null instead of being fabricated from archive-time data.
- Odds freshness tightens automatically from 30 minutes to 15/10/5 minutes as kickoff approaches.
- Backup import performs a real account-level restore against the current server revision rather than only replacing localStorage.
- Manual grading is rate-limited; request/body limits are enforced; self-service PickGauge-data deletion exists.
- Raw internal exceptions and raw third-party CFBD/Odds error bodies are not returned to browsers.
- Shared pool publishing is admin-only and now explicitly behaves as a one-time **template** lifecycle: Publish template / Unpublish template. Unpublishing never deletes recipients' already-created private pools or picks.
- **Canonical CFBD identity layer is implemented:** a shared six-hour server cache combines `/teams/fbs` and the season `/games` schedule, runtime games receive `cfbdGameId` plus canonical home/away team IDs/names/conferences/season/week, picks freeze those IDs, and saved-pick key migration prefers `cfbdGameId` before name matching. The Odds API `providerGameId` remains a separate namespace.
- **CFBD live/final game status is implemented:** `/scoreboard` is proxied through a 60-second shared cache and the client refreshes it about every 90 seconds while visible. My Picks shows scheduled/live/final scores plus the pick's current ATS position. The persistent grader now prefers canonical `cfbdGameId`/`cfbdPickedTeamId` final scores and falls back to The Odds API for legacy picks.
- **CFBD power-rating context is implemented:** CORE, SP+, FPI, Elo and SRS are fetched through a six-hour shared cache, cold refreshes run concurrently, and Snapshot game details show the available ratings side by side. They are explicitly informational and do not change Model #, Edge, Cover %, EV or Model Agreement.

## Product work already complete

- **Model Agreement:** transparent `X/Y agree` signal based on enabled, positively weighted non-Vegas model inputs.
- **Draft → Ready → Submitted:** entry readiness status plus a real Submitted lock; explicit Unlock re-enables editing.
- **Results analytics:** ATS record/win rate, average pick-time Edge, true CLV/positive-CLV rate, Edge and Model Agreement buckets, favorite/dog, home/away, spread ranges, key-number tiers, CLV-vs-ATS, Cover-% calibration, season/week filters, and small-sample warnings. Legacy picks with no frozen snapshot are excluded from snapshot-specific metrics rather than recomputed with today's model.
- **Reusable PickGauge dialogs:** browser-native `alert()`/`confirm()`/`prompt()` calls have been removed from shipped app JS. Pool creation is one validated form, sheet targeting is a choice list, destructive actions use consistent danger styling, and the modal layer supports Escape, backdrop dismissal, focus trapping/restoration, queued multi-step dialogs, and inline validation.
- **Pools tab action-density pass:** each pool row now shows only "View" and "Import ▾" always visible; Edit pick limit, Publish/Unpublish template, Archive, and Delete all collapsed into a single "⋮ More" dropdown. Down from 6-7 equal-weight buttons to 2-3 controls.

## Automated test status

Current permanent suite: **38 test files / 1,112 checks**.

- `scripts/test_all.sh --fast`: **37 files / 1,066 checks**, passing.
- `tests/test_e2e_ui_behaviors.py`: **46 Playwright/Chromium checks**, all passing as of the August 19 merge (see correction below — this was NOT actually fully green before that). Covers real-DOM modal flow, Results filtering, Context Bar/Weekly Setup/error-boundary flows, and the Pools-row tiered-menu interactions.
- `scripts/test_all.sh` now discovers every `tests/test_*.py` and `tests/test_*.mjs` file automatically, preventing a newly-added test file from being accidentally omitted from CI.
- Whether a given review sandbox can actually launch Chromium against `localhost` varies by environment (some block it, some don't) — don't assume either way; just try running `tests/test_e2e_ui_behaviors.py` directly before claiming it can't run here.

## Corrections from the August 19 merge (why this file says "single source of truth" above)

Drew handed this project to a Claude session with this file plus a separate ChatGPT-authored roadmap doc pasted in. Reconciling them surfaced two concrete, worth-remembering lessons:

1. **A real bug slipped through undetected specifically because the e2e suite's "can't run here" note went unquestioned instead of re-verified.** `tests/test_e2e_ui_behaviors.py` line ~325 was clicking `[data-archive="p1"]` directly — a leftover from before the Pools-row tiered-menu change — but Archive now lives inside the "⋮ More" dropdown, hidden until its own trigger is clicked. Because the section had no try/except, this crashed the script and silently skipped 20 of the file's 46 checks in every real run, including some Results-analytics checks. Fixed by opening `[data-pooltrigger="p1_more"]` first, matching how the rest of the file already correctly handles `data-editlimit`. **Lesson: "this environment can't run X" is a claim about the environment, not the code — the code's actual correctness still needs verifying somewhere, and it's worth just trying before repeating the claim into a new session.**
2. **A previously-shipped feature was listed as still-open in a separately-maintained roadmap doc.** ChatGPT's roadmap listed "Continue simplifying pool controls: consider placing secondary actions beneath a ⋯ menu (Edit / Publish / Archive / Delete)" as LOW/MEDIUM open work — it was already fully shipped, including every action it named. **Lesson: this is exactly the drift a second roadmap document produces. Going forward, roadmap/priority content lives HERE, not in a separately-maintained list on either AI's side — see the top of this file.**

## Highest-priority remaining work

1. **Real locked pool-sheet acceptance test.** Run a genuine locked Splash Sports / ESPN/OFP sheet through parser → home-perspective line → pick → archive → pre-kick close → CLV → grading. Synthetic fixtures are not enough for the final real-world sign-convention check. Compare the retained pre-kick close against CFBD's own historical line afterward and investigate any real discrepancy.
2. **Live Upstash CAS test.** `tests/_live_cas_concurrency_test.py` still needs one real deployment run with a fresh Clerk token.
3. **Production auth/domain launch bundle.** Move Clerk from development to production, validate expected JWT `iss`/`azp`, replace contact/canonical/OG placeholders, add HSTS/CSP, and perform a clean incognito deployment test. Note: `iss`/`azp` validation specifically does NOT need a real domain to implement/test — only the Clerk Dev→Prod migration and the canonical/OG URL swap are actually domain-blocked. No need to hold all four hostage to "once the domain exists."
4. **Live 2026 CFBD/closing-line validation.** During real games, confirm canonical schedule joins, live scoreboard status, automatic final grading and retained pre-kick lines stay correct through kickoff/reschedules, postponements, FBS-vs-FCS, neutral-site games, and rematches.
5. **Confirm Sagarin code mapping.** Do not label/star the best historical Sagarin methodologies until the app's four system codes are positively mapped.
6. **Mobile UX validation pass.** Real iPhone/Android testing of the dialog layer, pool creation/import, entry management, Results filters, Snapshot, live scoring, and submitted-entry locking — not just sandbox/Playwright viewport checks.

## A real open prioritization question, not yet decided

ChatGPT's proposed build order put three new CFBD feature builds (Matchup Intelligence, historical betting lines, WEPA) ahead of finishing the production-hardening items above. That's a real tension worth deciding explicitly rather than defaulting into: if PickGauge stays a personal/small-group tool a while longer, building more features first is fine; if there's real intent to open it to other people this season, security hardening shouldn't sit behind three speculative feature builds. Whoever picks this back up next should get an explicit answer from Drew rather than assuming either way.

## Feature ideas under consideration (not started, no priority order implied)

Captured here (not as a separate roadmap doc — see "single source of truth" note above) so they're not lost, but deliberately kept at summary depth; expand into real spec/design only when actually starting one.

**CFBD-powered context (biggest visible product upside, per ChatGPT's own assessment):**
- **Matchup Intelligence v1** — offense-vs-defense context (PPA/play, success rate, explosiveness, rushing/passing efficiency, havoc, standard/passing downs) shown in Snapshot as plain-language context. Do NOT feed into Model # initially.
- **Historical CFBD betting-line integration** — pull CFBD's own historical provider spreads with clear line provenance (`closingLineSource: pickgauge_live` vs `cfbd_historical`) to validate our own pre-kick capture, backfill older games, and enable historical ATS backtests.
- **WEPA / opponent-adjusted metrics** — after Matchup Intelligence v1 lands; display alongside raw efficiency, not folded into Model #.
- **Advanced postgame box-score analysis** — explain why a pick won/lost (success rate, PPA, turnovers) in Results detail.
- **CFBD ATS history/context** — a team's own season ATS record and average cover margin as pure context, not a model input.
- **Weather warnings** — simple flags (wind/rain/heat/cold) on the board for extreme conditions only; detail belongs in Snapshot.
- **Preseason-only context** (returning production, Team Talent Composite, transfer portal impact) — for Weeks 0-4 when current-season stats are noisy.
- **CFBD "Saturday Mode"** — a dedicated live-multi-game view once normal pool usage is established; not current priority.

**Results/analytics (needs real 2026 sample size before any of this, not a build-now item):**
- Statistical confidence intervals around ATS%/calibration once sample sizes grow (a 6-2 record shouldn't visually read the same as 60-35).
- CLV-vs-ATS and Model-Agreement-vs-ATS performance breakdowns.
- Conference/ranked/neutral-site/time-of-day/week-of-season filters, added only once sample size can support real conclusions.

**Pool/entry workflow:**
- Real-world test Draft → Ready → Submitted in an actual pool; watch for friction around locking/unlocking/switching entries.
- Clearer weekly entry progress ("5/7 picks selected", "Submitted at 11:42 AM").
- Review how intuitive Publish/Unpublish template is for a recipient account — make sure they understand it's a one-time template copy, not ongoing sync.

**Frontend/infra, low priority:**
- Extract the large inline `<style>` block out of `app/index.html` into `app/css/app.css`. Compatible with the no-build-step constraint (still a plain `<link>`, no bundler) — just file organization.
- Keep splitting `app/js/*.js` only when there's a genuinely clear responsibility boundary; don't fragment just to reduce line count.

**Production/security (see "Highest-priority remaining work" #3 above for the actionable version of this):**
- Full account-flow testing in a fresh/incognito session once production Clerk is live: signup, login, logout, cross-device sync, backup/restore, account deletion, expired sessions, unauthorized API calls.

**Product/business (Drew's call, not an engineering priority call):**
- Recruiting a small real 2026 beta group is probably the single most important product validation once the season starts — whether other people voluntarily use this weekly matters more than any feature above.
- Free vs. Pro feature boundaries — decide after observing real usage, not up front.
- Commissioner product (an admin running the whole pool: participant accounts, deadlines, locking, standings, exports) — potentially the strongest acquisition mechanism, but explicitly LATER.
- Notifications/alerts (line movement on a saved pick, key-number proximity, incomplete entry before deadline) — LATER.

## Lower-priority / later

- **Tabled:** model correlation/optimized weighting. Keep as a long-term research idea; do not change the production Model # for this now.
- Deeper Results research once enough 2026 graded picks exist (conference/context splits, confidence intervals/significance, and deciding which observed patterns are stable enough to matter).
- Public Methodology page.
- Verify Responsible Play resource details immediately before wider public launch.
- Deliberate full palette change only if doing a coordinated redesign; avoid piecemeal hex swapping.
