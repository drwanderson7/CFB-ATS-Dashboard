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
- **CFBD power-rating context is implemented:** CORE, SP+, FPI, Elo and SRS are fetched through a six-hour shared cache, cold refreshes run concurrently, and Snapshot game details show the available ratings side by side. They are explicitly informational and do not change Model #, Edge, Cover %, EV or Model Agreement — **except SP+ and CORE specifically, which as of Aug 19 ALSO exist as real, toggleable prediction-system inputs** (`cfbdsp`/`cfbdcore` in the Prediction Systems checklist, right alongside BP/Comp/Sagarin/every thepredictiontracker.com system) — a deliberate, explicit exception to the "context only" rule every other CFBD feature follows, confirmed with Drew before building. Since SP+/CORE are team RATINGS, not per-game predicted spreads, a derived spread is computed client-side (`cfbdDerivedSpread()`/`applyCfbdDerivedPredictions()`, `app/js/cfbd-insights.js`): `awayRating − homeRating − 2.6`, home-team-spread convention, matching every other system. **The 2.6-point home-field-advantage constant is real, sourced research** (a multi-season empirical HFA study puts "true" CFB HFA around 2.6, vs. oddsmakers' own typical convention of ~3.0) — Drew explicitly confirmed 2.6 over the alternative before this was built, not a number either AI picked alone. Known, documented simplification: HFA genuinely varies by team (roughly 0.2–5.7 points across real programs in a 2025 dataset) — a flat constant runs a bit generous for weak home fields and a bit stingy for elite ones, same category of simplification every other fixed-methodology system here already represents. `applyCfbdDerivedPredictions()` merges into `predByKey` rather than replacing it, so it never clobbers a real thepredictiontracker.com system already present for the same game; wired through every existing `applyPredictions()` call site via one shared exit point (`_finishApplyPredictions()`) rather than touching each of the ~10 call sites individually, and re-fires from `_cfbdRenderConsumers()` once ratings finish their (asynchronous, later-than-first-render) load.
- **Matchup Intelligence v1 is implemented:** `/api/fetch_cfbd?view=advanced` fetches CFBD's season advanced team stats (PPA/play, success rate, explosiveness, standard-downs/passing-downs and rushing/passing splits, defensive havoc) through the same six-hour shared-cache/stale-fallback pattern as ratings. Snapshot game details show both offense-vs-defense directions (away offense vs. home defense, and vice versa) plus a standalone defensive-havoc comparison, with plain-language "X edge" labels above a small noise threshold. Context only — does not change Model #, Edge, Cover %, EV or Model Agreement. **Real bug found and fixed after first live use (Aug 19):** `/stats/season/advanced` computes CUMULATIVE season stats from games actually played, so a preseason request (confirmed via a real curl-equivalent request to CFBD directly) correctly returns `200` with body `[]` — there was nothing wrong with the API key or tier at all. The original code treated any empty result as an upstream failure and threw a 502; fixed to treat an empty-but-successful result as valid (cached and returned normally), and the client now shows a clear "not available yet this season" note instead of silently rendering nothing when that happens — silence is exactly what caused the original confusion. Field-name assumptions in `trim_advanced_team()` are still otherwise unconfirmed against a populated response (defensive `.get()`-based throughout either way) — that part of the original caveat still holds and stays tracked in item 4 below; re-check once actual 2026 games have been played and the array is non-empty. **Also now shown on the Edge Board (Aug 19), not just Snapshot:** each Board row has an obvious "▾ Matchup breakdown" pill (filled background, bold text, not a bare icon) that expands a detail row with the same ratings + Matchup Intelligence panels — reusing the exact same `cfbdRatingsPanelHTML()`/`cfbdMatchupPanelHTML()` functions Snapshot uses, not a duplicate implementation. Deliberately does NOT reuse Snapshot's full rich detail row (model/market/signals breakdown): that depends on percentile ranks computed against Snapshot's own opportunity-filtered row set, which doesn't apply to Board's full game list (including "no lean" games Snapshot excludes), and Board's own row cells already show those numbers directly.
- **Advanced postgame box-score analysis is implemented ("why did this pick win or lose"):** each graded pick in Results with a canonical CFBD identity gets a "Why?" toggle that lazily fetches `/api/fetch_cfbd?view=boxscore&id={cfbdGameId}` (CFBD's `/game/box/advanced`, 24h cache since a finished game's box score is immutable) and shows success rate, PPA/play, explosiveness, points per scoring opportunity, defensive havoc, and turnovers side by side for both teams. Context only, never touches the W/L/P grade itself. Built with meaningfully stronger footing than Matchup Intelligence v1's original build: the response shape was checked against CFBD's own live, current API reference (with a real documented example response, verified directly against `trim_box_score()` before shipping) rather than generic field-name knowledge, and the "empty result is valid, not an error" lesson from that earlier incident was applied proactively here from the start instead of needing its own production bug first. **One remaining, explicitly flagged gap:** turnovers comes from a second call (`/games/teams`) whose stat categories have no fixed schema in CFBD's docs — a "turnovers" category is confirmed to exist by a well-established third-party CFBD wrapper (cfbfastR), but the exact string wasn't independently confirmed against a live response; degrades to "—" rather than guessing wrong if the match fails. Also independently smoke-testable RIGHT NOW against any real past completed game (e.g. a 2025 gameId) — unlike Matchup Intelligence/ratings, this endpoint doesn't depend on the current season having any games played yet.

## Product work already complete

- **Model Agreement:** transparent `X/Y agree` signal based on enabled, positively weighted non-Vegas model inputs.
- **Draft → Ready → Submitted:** entry readiness status plus a real Submitted lock; explicit Unlock re-enables editing.
- **Results analytics:** ATS record/win rate, average pick-time Edge, true CLV/positive-CLV rate, Edge and Model Agreement buckets, favorite/dog, home/away, spread ranges, key-number tiers, CLV-vs-ATS, Cover-% calibration, season/week filters, and small-sample warnings. Legacy picks with no frozen snapshot are excluded from snapshot-specific metrics rather than recomputed with today's model.
- **Reusable PickGauge dialogs:** browser-native `alert()`/`confirm()`/`prompt()` calls have been removed from shipped app JS. Pool creation is one validated form, sheet targeting is a choice list, destructive actions use consistent danger styling, and the modal layer supports Escape, backdrop dismissal, focus trapping/restoration, queued multi-step dialogs, and inline validation.
- **Pools tab action-density pass:** each pool row now shows only "View" and "Import ▾" always visible; Edit pick limit, Publish/Unpublish template, Archive, and Delete all collapsed into a single "⋮ More" dropdown. Down from 6-7 equal-weight buttons to 2-3 controls.
- **"Select games manually" is implemented:** a pool that isn't on Splash/ESPN/OFP at all (a pool on some other site, a paper sheet, a group text) previously had NO way to get a game list — `createEmptyPool()`'s own message says "you can import its weekly sheet afterward," but there was nothing for "there is no sheet." New "Import ▾" menu item on every pool row opens an inline checklist (not a modal — the shared `pgForm()` dialog system isn't built for a large scrollable list) of the current week's already-loaded live games, each with a spread input prefilled from the live Vegas line but always editable; a free-text fallback covers a game the live odds feed doesn't track at all. Reuses the exact same `applyParsedPoolData()` pipeline the PDF/paste import paths already use — a manually-built games array is just a third way to produce the `{source, pickLimit, games}` shape that function already accepts, not a new pool-mutation code path.
- **Import Powers PDF moved into the prediction-systems checklist grid**, positioned right after BP (before Comp) instead of sitting in a separate INPUT WEIGHTS box. **Real bug found and fixed during the move:** `#pdfFile` now lives inside the JS-rendered grid and gets destroyed/recreated on every `renderSystemsSettings()` call (every checkbox toggle, weight change, predictions load) — `init.js`'s old one-time onchange binding ran BEFORE this element existed in the DOM at all, which would have thrown. Fixed by moving the binding inside `renderSystemsSettings()` itself, rebinding on every render (same pattern already used there for `[data-sys]`/`.sys-weight`). `prediction-tracker.js` had zero test coverage before this; `tests/test_prediction_tracker_logic.mjs` is new.

## Automated test status

Current permanent suite: **41 test files / 1,267 checks**.

- `scripts/test_all.sh --fast`: **40 files / 1,221 checks**, passing.
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
4. **Live 2026 CFBD/closing-line validation.** During real games, confirm canonical schedule joins, live scoreboard status, automatic final grading and retained pre-kick lines stay correct through kickoff/reschedules, postponements, FBS-vs-FCS, neutral-site games, and rematches. **Also includes confirming Matchup Intelligence v1's `/stats/season/advanced` FIELD NAMES** once real 2026 games have actually been played and the array stops being empty (see "Product work already complete" above for what was already confirmed vs. what's still open — the empty-preseason-response bug itself is fixed and confirmed against a real CFBD request; the exact field-name shape of a POPULATED response is the remaining unknown).
5. **Confirm Sagarin code mapping.** Do not label/star the best historical Sagarin methodologies until the app's four system codes are positively mapped.
6. **Mobile UX validation pass.** Real iPhone/Android testing of the dialog layer, pool creation/import, entry management, Results filters, Snapshot, live scoring, and submitted-entry locking — not just sandbox/Playwright viewport checks.

## A real open prioritization question, not yet decided

ChatGPT's proposed build order put three new CFBD feature builds (Matchup Intelligence, historical betting lines, WEPA) ahead of finishing the production-hardening items above. That's a real tension worth deciding explicitly rather than defaulting into: if PickGauge stays a personal/small-group tool a while longer, building more features first is fine; if there's real intent to open it to other people this season, security hardening shouldn't sit behind three speculative feature builds. Whoever picks this back up next should get an explicit answer from Drew rather than assuming either way.

## Feature ideas under consideration (not started, no priority order implied)

Captured here (not as a separate roadmap doc — see "single source of truth" note above) so they're not lost, but deliberately kept at summary depth; expand into real spec/design only when actually starting one.

**CFBD-powered context (biggest visible product upside, per ChatGPT's own assessment):**
- ~~Matchup Intelligence v1~~ — **shipped, see "Product work already complete" above.** Live-data field-name verification still needed (tracked in "Highest-priority remaining work" #4).
- **Historical CFBD betting-line integration** — pull CFBD's own historical provider spreads with clear line provenance (`closingLineSource: pickgauge_live` vs `cfbd_historical`) to validate our own pre-kick capture, backfill older games, and enable historical ATS backtests.
- **WEPA / opponent-adjusted metrics** — now that Matchup Intelligence v1 has landed; display alongside raw efficiency, not folded into Model #.
- ~~Advanced postgame box-score analysis~~ — **shipped, see "Product work already complete" above.** Turnovers field-name verification still needed (tracked in "Highest-priority remaining work" #4, alongside Matchup Intelligence's own field-name check).
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
