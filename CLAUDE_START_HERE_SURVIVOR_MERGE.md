# CLAUDE START HERE — PickGauge + CFB Survivor merge

**Date:** 2026-08-31  
**Primary working ZIP:** `pickgauge-survivor-merged-2026-08-31.zip`  
**PickGauge baseline ZIP:** `pickgauge-vercel-web-analytics-2026-08-30(2).zip`  
**PickGauge production baseline commit:** `28ce6eb19c7ca6e8db3e1f2a6df88168ca573f5f`

## Read this before changing anything

The PickGauge integration shell is substantially merged and is the right starting point. **Do not restart the merge from scratch.** Preserve the native Survivor tab, PickGauge state integration, CFBD adapter/enrichment work, CSS, and existing PickGauge architecture unless a test proves a specific seam is wrong.

However, there is one **P0 blocker discovered after packaging**:

> `app/survivor-core/*` in the merged ZIP contains **test-fixture stubs**, not the real standalone Survivor optimizer/results/schedule source.

Because of that, the current merged ZIP must be treated as a **merge worktree, not production-ready** until the real Survivor core files are restored and tested.

This corrects the earlier handoff language that described the core as fully ported. The surrounding integration is useful; the seven core source files listed below are the problem.

---

# 1. P0 — Replace the stub Survivor core with the real source

Use the current standalone **CFB-Survivor** repo as the source of truth if you have repository access.

Standalone project references:

- GitHub repo: `drwanderson7/CFB-Survivor` (private)
- Current known production commit: `39d3fc783c87ac23ce01891bbf00bdf88c270bf1`
- Vercel project: `cfb-survivor`
- Current production deployment: `dpl_8mkGF7hDwtxQ4ZSsNbkK9aTiLdR6`
- Current production URL: `cfb-survivor-qoo2xsjsr-drwanderson7-1994s-projects.vercel.app`
- Known-good prior deployment with readable full `survivor-score.js`: `cfb-survivor-12t6v97qr-drwanderson7-1994s-projects.vercel.app` (commit `03837ce28335c75856ef12a3b96fea92e77177f1`)

### Replace these files in PickGauge

Copy the real standalone files into the corresponding merged-project locations:

| Standalone Survivor source | PickGauge merged destination |
| --- | --- |
| `js/survivor-score.js` | `app/survivor-core/js/survivor-score.js` |
| `js/results.js` | `app/survivor-core/js/results.js` |
| `data/sec-pool-schedule-2026.js` | `app/survivor-core/data/sec-pool-schedule-2026.js` |
| `data/bigten-pool-schedule-2026.js` | `app/survivor-core/data/bigten-pool-schedule-2026.js` |
| `data/kelly-pool-schedule-2026.js` | `app/survivor-core/data/kelly-pool-schedule-2026.js` |
| `data/pool-schedule-utils.js` | `app/survivor-core/data/pool-schedule-utils.js` |
| `data/pool-teams.js` | `app/survivor-core/data/pool-teams.js` |

### How to recognize the bad stub files immediately

The bad packaged files currently contain obvious fixture code such as:

```js
export function buildSeasonPlan(){return {picks:[]};}
export function survivorScore(){return 90;}
export function deriveCurrentPoolWeek(){return 1;}
export const GAMES=Array.from({length:106},(_,i)=>({week:(i%13)+1,teams:['A','B']}));
```

Do not preserve any of that fixture logic.

### What the real optimizer must contain

The real `survivor-score.js` includes, among other things:

- `probabilityFor()`
- `futureProfile()`
- `SURVIVOR_SCORE_WEIGHTS = { safety: 0.85, preservation: 0.08, scarcity: 0.07 }`
- `futureScarcityProfile()`
- `survivorScoreBreakdown()` / `survivorScore()`
- exact multi-pick season optimization
- min-cost max-flow assignment logic (`minCostMaxFlow`)
- `buildSeasonPlan()` returning `optimizer: 'exact-assignment'`, `optimality: 'exact'`
- `compareWhatIf()`
- `buildStrategicRecommendation()`
- `seasonScarcity()`
- `buildPickExplanation()`
- `teamFutureValueRating()`

Do **not** replace the exact optimizer with a greedy weekly heuristic.

---

# 2. Survivor rules that must remain intact

## SEC Survivor

- 2026 authoritative Splash schedule = **106 games**.
- One pick per week.
- Team may only be used once.
- Eligibility comes from the authoritative Splash game list, not generic conference membership.
- In any eligible game involving an SEC team, **either side may be selected**, including the non-SEC opponent.

## Big Ten Survivor

- 2026 authoritative Splash schedule = **122 games**.
- Same selection rule as SEC: either side of an authoritative eligible game may be selected.
- One pick per week.
- No team reuse.
- Preserve **UMass @ Rutgers, Week 1** even if CFBD still omits it.
- If CFBD is still missing that game, Data Health should distinguish:
  - Schedule coverage: `122/122`
  - Canonical CFBD IDs: `121/122`
  - `1 upstream fallback`
- A real CFBD Rutgers–UMass row must automatically supersede the fallback without duplication.

## KellyInVegas Survivor CFB Championship

- 2026 authoritative schedule = **321 games**.
- 13 weeks.
- **Exactly 2 picks per week**.
- Both picks must win.
- No team reuse.
- Cannot pick both sides of the same game.
- Known schedule shape from prior validation: **114 unique teams / 642 selectable sides**.

---

# 3. Integration architecture already in the merged worktree — preserve it

Do not reintroduce standalone short-code sync or build a second CFBD pipeline.

The intended merged architecture is:

- Native `Survivor` tab in PickGauge between **Pools** and **Results**.
- Durable Survivor data lives under PickGauge private signed-in account state (`state.survivor`).
- PickGauge Clerk + Redis private sync owns Survivor entries/picks.
- Device-local UI context can remain local: active pool, active entry, selected subview/week where appropriate.
- Existing PickGauge CFBD identity/schedule/results infrastructure is reused.
- `/api/fetch_cfbd?view=survivor&year=2026` provides the additional season-level enrichment needed for Survivor.
- Survivor probability source order:
  1. Direct CFBD Pregame WP
  2. SP+ derived
  3. Betting-line derived
  4. Unavailable
- Use PickGauge's **2.6-point HFA** convention for SP+ derivation.
- Survivor margin SD remains explicitly **16.0** pending calibration.
- PickGauge ATS `Model #` is **not** a straight-up Survivor win-probability source.

Important merged files to preserve/review rather than replace wholesale:

- `app/js/survivor-integration.js`
- `app/js/survivor-data-adapter.js`
- `app/js/survivor-core-bridge.js`
- `app/css/survivor-integration.css`
- `api/cfbd_survivor_enrichment.py`
- modifications in `app/index.html`
- modifications in `app/js/main.js`
- modifications in `app/js/tabs.js`
- modifications in `api/fetch_cfbd.py`

---

# 4. Strengthen the tests before calling this production-ready

The earlier Stage-3 tests passed because they mostly validated adapter/enrichment behavior and export/count contracts. They did **not** prove the bundled schedule arrays contained real games or that the exact optimizer was present. That is why the fixture stubs slipped through.

Add permanent regression tests that fail on the exact stub pattern.

At minimum:

### Schedule-content tests

- SEC has exactly 106 authoritative games.
- Big Ten has exactly 122 authoritative games.
- Kelly has exactly 321 authoritative games.
- No schedule contains placeholder teams `A` / `B`.
- Schedules contain real known matchups.
- Big Ten contains `UMass @ Rutgers` in Week 1.
- Kelly yields 114 unique teams and 642 selectable sides if that remains the authoritative source shape.
- Schedule IDs/keys are unique according to the standalone schedule utility rules.

### Optimizer tests

- `buildSeasonPlan()` must return a non-empty real plan for a controlled multi-week fixture.
- Returned `optimizer === 'exact-assignment'` and `optimality === 'exact'`.
- No team reuse across weeks.
- Kelly fixture fills two picks/week when modeled choices exist.
- Two opposite sides of the same game cannot both be selected.
- Exact solver should beat or match a deliberately constructed greedy counterexample.
- Missing-model slots degrade honestly rather than inventing probabilities.

### Score/scarcity tests

- Assert `SURVIVOR_SCORE_WEIGHTS.safety === 0.85`.
- Assert preservation `0.08`, scarcity `0.07`.
- Future-week scarcity remains a **modest secondary input**, not a replacement for current safety or the exact path optimizer.

### Results tests

Exercise real `evaluateEntryStatus()` results for:

- PICK NEEDED
- ALIVE
- ELIMINATED
- AWAITING RESULT
- MISSING PICK
- NOT STARTED
- SURVIVED
- DATA ISSUE

Do not accept a fixture implementation that always returns `{status:'alive'}`.

---

# 5. Current PickGauge baseline and regression context

The user's Aug-30 ZIP was verified against production for the five Stage-3 patch targets before the merge.

PickGauge production commit used as baseline:

`28ce6eb19c7ca6e8db3e1f2a6df88168ca573f5f`

Pre-merge blob hashes verified:

- `app/js/main.js` → `dfe3638b44631dd51539184151ac771b227f47f6`
- `app/js/tabs.js` → `f6d8af244606f77a38edca6bb09705cd32679787`
- `app/index.html` → `8f0c6cb06619502b42248ca1a4f24f77bc0a2ad8`
- `app/css/app.css` → `6e52114cf69ee3d89b0d64ec9d2da42fb781b751`
- `api/fetch_cfbd.py` → `9ae73e82474a8c1a20a8066d970a8bf893d214a0`

One real Python integration issue was already fixed: `fetch_cfbd.py`'s sibling enrichment-helper import now works both under Vercel and under PickGauge's direct-file tests.

Existing PickGauge tests should remain green after replacing the stubs.

The local sandbox previously blocked Playwright from navigating to `localhost` (`ERR_BLOCKED_BY_ADMINISTRATOR`), so browser validation must be done in Claude's environment or on a Vercel preview/live deployment.

---

# 6. First recommended Claude work sequence

1. **Do not deploy the current ZIP yet.**
2. Unzip `pickgauge-survivor-merged-2026-08-31.zip`.
3. Inspect the seven `app/survivor-core/*` files listed in Section 1 and confirm they are fixture stubs.
4. Pull the exact current standalone Survivor source from `drwanderson7/CFB-Survivor`.
5. Replace only those seven core files first.
6. Verify `core-manifest.js` export names still match the real files; adjust manifest only if the real exports changed.
7. Add the stronger schedule/optimizer/results regression tests from Section 4.
8. Run the full PickGauge test suite.
9. Run Survivor-specific direct module tests against the **actual** core.
10. Start the app locally or deploy to a Vercel Preview and smoke-test the real UI.
11. Only after the live smoke test passes, produce a new complete ZIP / deploy candidate.

---

# 7. Live smoke-test checklist

After the real core is restored:

1. Existing Snapshot works.
2. Edge Board works.
3. My Picks works.
4. Pools works.
5. Results works.
6. Survivor tab loads with a signed-in PickGauge account.
7. SEC Data Health = 106/106.
8. Big Ten Data Health = 122/122 and correctly reports the Rutgers–UMass fallback if still needed.
9. Kelly Data Health = 321/321.
10. Rankings show real teams/opponents, not placeholders.
11. Best Play/Pair changes based on real WP/model data.
12. Season Plan is populated and obeys no-reuse constraints.
13. Kelly produces two recommended picks/week and never picks opposite sides of one game.
14. Future Value/scarcity visibly varies by team.
15. My Picks status changes correctly with completed games/results.
16. Survivor picks persist after reload.
17. Survivor picks sync to another signed-in device/account session.
18. Mobile has no page-level horizontal overflow.
19. Existing PickGauge auth/Clerk flow still works.
20. Existing PDF import and Vercel Web Analytics still work.

---

# 8. Product constraints / decisions not to revisit casually

- Survivor is a **native PickGauge feature**, not an iframe or separate website embed.
- Reuse PickGauge's CFBD data layer rather than maintaining duplicate results/data infrastructure.
- SEC and Big Ten selectable sides come from the authoritative Splash schedule: either team in an eligible game can be picked.
- Future-week scarcity should inform scoring modestly but must not overpower current win probability or alter the exact season-path optimizer objective.
- Do not expose PickGauge ATS proprietary model weights through Survivor.
- Do not use the PickGauge ATS Model # as Survivor straight-up win probability.
- Do not remove the Big Ten Rutgers–UMass game just to make CFBD coverage appear perfect.
- Do not replace the exact Kelly optimizer with a simple top-two-weekly pick strategy.

---

# Bottom line

**Use the merged ZIP as the integration worktree, not as a finished production release.**

The main merge shell is valuable and should be preserved. The immediate P0 is replacing the seven fixture/stub `app/survivor-core` files with the exact standalone Survivor implementation, then upgrading the tests so fake count-only schedules or trivial optimizer/result stubs can never pass again.
