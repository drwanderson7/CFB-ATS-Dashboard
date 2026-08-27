// Runtime tests for computeWeeklySetup()/computeSetupDisplay()'s pure
// decision logic -- what the Weekly Setup checklist should say, separate
// from how renderSetupStatus() puts it on screen. Run with:
//
//     node tests/test_weekly_setup_logic.mjs
//
// Why this exists: same gap as the Context Bar (see
// test_context_bar_logic.mjs's header comment for the full reasoning) --
// zero automated coverage before this, Playwright-verified only during
// the session that built it. The most important property this checklist
// has, and the one most worth protecting against a future regression, is
// its OWN stated design goal: an item you've deliberately opted out of
// (BP/Comp both off, no prediction systems enabled, viewing Overall with
// no pool) must read "na" and NOT count toward the required total --
// several checks below exist specifically to pin that down, since a
// naive "count everything" implementation is the easy way to accidentally
// break it.
//
// Extracts the ACTUAL functions from app/js/board.js, not a hand-copied
// reimplementation.
import fs from "node:fs";
import vm from "node:vm";

const boardSrc = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");

function extractFunction(name, source) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const code = [
  extractFunction("computeInputColumnCoverage", boardSrc),
  extractFunction("computeWeeklySetup", boardSrc),
  extractFunction("computeSetupDisplay", boardSrc),
].join("\n\n");

function makeCtx(overrides = {}) {
  const base = {
    state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null },
    games: [],
    isDemo: false,
    currentPool: () => null,
    activeEntry: () => ({ name: "Entry 1", picks: {} }),
    enabledSystemsOrdered: () => [],
    inputsFor: () => [null, null],
    minsAgo: () => null,
  };
  return Object.assign(base, overrides);
}

function run(overrides) {
  const ctx = makeCtx(overrides);
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.computeWeeklySetup();
}

function runDisplay(overrides) {
  const ctx = makeCtx(overrides);
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.computeSetupDisplay();
}

// --- Vegas lines: always meaningful, never "na" -------------------------
{
  const r = run({ isDemo: true, state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null } });
  const vegas = r.items.find((i) => i.key === "vegas");
  check("Vegas item is 'bad' when in demo mode (demo data isn't live lines)", vegas.status === "bad");
  check("Vegas item counts toward the required total (never 'na')", vegas.status !== "na");
}
{
  const r = run({ isDemo: false, state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: null, predMeta: null } });
  const vegas = r.items.find((i) => i.key === "vegas");
  check("Vegas item is 'ok' once real lastGames data exists outside demo mode", vegas.status === "ok");
}

// --- Powers PDF (BP/Comp): REMOVED from Weekly Setup entirely (Drew's Aug
// 26 follow-up call, tightened same day from an earlier "always na"/
// informational pass -- "does not need to be part of the weekly setup
// card at all"). No "pdf" item should exist in the checklist AT ALL,
// regardless of whether BP/Comp happen to be toggled on, missing data, or
// fully covered -- not "na", not any status, just absent. ---
{
  const r = run({ state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null } });
  check("BP and Comp both off: no 'pdf' item exists in the checklist at all", r.items.find((i) => i.key === "pdf") === undefined);
}
{
  // BP on, 2 games, BP present for 1 of 2 -- still no 'pdf' item at all,
  // even though there'd be real missing data to report if this were still
  // tracked. The point of this fix is that Weekly Setup no longer cares.
  const games = [{ key: "g1" }, { key: "g2" }];
  const r = run({
    state: { enabledSystems: ["bp"], lastGames: null, lastRefresh: null, predMeta: null },
    games,
    inputsFor: (key) => (key === "g1" ? [10, null] : [null, null]),
  });
  check("BP on with real missing data: still no 'pdf' item in the checklist -- Weekly Setup doesn't track this at all anymore", r.items.find((i) => i.key === "pdf") === undefined);
}
{
  // Comp on instead of BP, fully covered -- same result, no 'pdf' item,
  // covering the other half of the old bpOn/compOn branch that no longer
  // exists.
  const games = [{ key: "g1" }, { key: "g2" }];
  const r = run({
    state: { enabledSystems: ["comp"], lastGames: null, lastRefresh: null, predMeta: null },
    games,
    inputsFor: () => [null, 10],
  });
  check("Comp on, fully covered: still no 'pdf' item -- neither BP nor Comp being enabled brings this item back", r.items.find((i) => i.key === "pdf") === undefined);
}

// --- Full end-to-end sanity check: a genuinely new account (per the
// separate Aug 26 new-user-defaults fix, defaults to Sagarin+SP+, NOT
// BP/Comp) viewing Overall with live lines and an entry selected should
// show a clean, fully-complete checklist with no Powers PDF row anywhere
// -- not even as an informational line. ---
{
  const r = run({ state: { enabledSystems: ["sag", "cfbdsp"], lastGames: [{ id: 1 }], lastRefresh: new Date().toISOString(), predMeta: { fetchedAt: new Date().toISOString() } } });
  check("new-account-shaped scenario (Sagarin+SP+ enabled, no BP/Comp): no 'pdf' item anywhere in the checklist", r.items.find((i) => i.key === "pdf") === undefined);
}

// --- Prediction systems: "na" when none enabled, not a standing warning -
{
  const r = run({ enabledSystemsOrdered: () => [] });
  const preds = r.items.find((i) => i.key === "preds");
  check("No prediction systems enabled: preds item is 'na', not 'bad'", preds.status === "na");
  check("No prediction systems enabled: 'na' still doesn't count toward requiredCount (unchanged by the discoverability fix below)", !r.requiredCount || r.items.filter(i=>i.status!=="na").length===r.requiredCount);
  // Real gap fix: a brand-new person who's never touched prediction
  // systems got the exact same static, non-clickable row as someone who
  // deliberately opted out -- no path from "None enabled this week" to
  // actually seeing what's available. Still "na" (not a nag/warning),
  // but now carries a target so renderSetupStatus() can render it as a
  // clickable "Explore ->" row instead of a dead end.
  check("the 'na' preds item now carries a target (the discoverability fix) pointing at the Prediction systems panel on Edge Board",
    preds.target && preds.target.tab === "board" && preds.target.openPanel === "predPanel");
}
{
  const r = run({ enabledSystemsOrdered: () => ["sag"], state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null } });
  const preds = r.items.find((i) => i.key === "preds");
  check("A system enabled but never loaded (no predMeta): preds item is 'bad'", preds.status === "bad");
}
{
  const r = run({
    isPickGaugeModelActive: () => true,
    enabledSystemsOrdered: () => [],
    state: { pickGaugeModelEnabled: true, enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null },
  });
  const preds = r.items.find((i) => i.key === "preds");
  check("PickGauge Model # active with no loaded predictions: preds item is 'bad' even though no individual systems are enabled", preds.status === "bad");
}
{
  const r = run({
    enabledSystemsOrdered: () => ["sag"],
    state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: { fetchedAt: "2026-08-14T12:00:00Z" } },
  });
  const preds = r.items.find((i) => i.key === "preds");
  check("A system enabled AND loaded: preds item is 'ok'", preds.status === "ok");
}

// --- Pool lines: "na" on Overall board, real pass/fail inside a pool ----
{
  const r = run({ currentPool: () => null });
  const pool = r.items.find((i) => i.key === "pool");
  check("Overall board (no pool): pool item is 'na', not a standing warning", pool.status === "na");
}
{
  const r = run({ currentPool: () => ({ name: "Test Pool", games: [] }) });
  const pool = r.items.find((i) => i.key === "pool");
  check("Inside a pool with 0 games: pool item is 'bad'", pool.status === "bad");
  check("Inside a pool with 0 games: detail names the actual pool", pool.detail.includes("Test Pool"));
}
{
  const r = run({ currentPool: () => ({ name: "Test Pool", games: [{ away: "A", home: "B" }] }) });
  const pool = r.items.find((i) => i.key === "pool");
  check("Inside a pool with games loaded: pool item is 'ok'", pool.status === "ok");
}

// --- Entry selected: always meaningful, never "na" -----------------------
{
  const r = run({ activeEntry: () => null });
  const entry = r.items.find((i) => i.key === "entry");
  check("No active entry: entry item is 'bad'", entry.status === "bad");
}
{
  const r = run({ activeEntry: () => ({ name: "Entry 1", picks: {} }) });
  const entry = r.items.find((i) => i.key === "entry");
  check("An active entry exists: entry item is 'ok'", entry.status === "ok");
}

// --- Staleness warning: only fires when lines are actually live+old -----
{
  const r = run({
    isDemo: false,
    state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: "old", predMeta: null },
    minsAgo: () => 200,
  });
  check("Live lines older than 3h: a staleness warning is added", r.warnings.some((w) => w.includes("old")));
}
{
  const r = run({
    isDemo: false,
    state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: "fresh", predMeta: null },
    minsAgo: () => 10,
  });
  check("Live lines refreshed 10m ago: no staleness warning", r.warnings.length === 0);
}
{
  const r = run({ isDemo: true, minsAgo: () => 400 });
  check("Demo mode: no staleness warning even if minsAgo would otherwise trigger one (demo isn't 'live' lines)",
    r.warnings.length === 0);
}

// --- allOk / okCount / requiredCount are internally consistent ----------
{
  // Everything opted out except Vegas (live) and Entry (present) -> both ok, both required, nothing else required.
  const r = run({
    isDemo: false,
    state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: null, predMeta: null },
    currentPool: () => null,
    activeEntry: () => ({ name: "Entry 1", picks: {} }),
  });
  check("A fully-opted-out week with live lines + an entry: allOk is true", r.allOk === true);
  check("Same scenario: requiredCount is exactly 2 (Vegas + Entry; preds/pool 'na', no 'pdf' item at all)", r.requiredCount === 2);
  check("Same scenario: okCount equals requiredCount", r.okCount === r.requiredCount);
}

// --- computeSetupDisplay(): the higher-level mode selector ---------------
{
  const d = runDisplay({ isDemo: true, currentPool: () => null });
  check("computeSetupDisplay: demo mode with no pool -> mode 'demo'", d.mode === "demo");
}
{
  const d = runDisplay({ isDemo: true, currentPool: () => ({ name: "Test Pool", games: [] }) });
  check("computeSetupDisplay: demo mode WITH a pool -> mode 'hidden' (pool's own empty state covers it)", d.mode === "hidden");
}
{
  const d = runDisplay({ isDemo: false, games: [], currentPool: () => null });
  check("computeSetupDisplay: no games loaded, no pool -> mode 'hidden'", d.mode === "hidden");
}
{
  const d = runDisplay({
    isDemo: false,
    games: [{ away: "A", home: "B" }],
    state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: null, predMeta: null },
    currentPool: () => null,
    activeEntry: () => ({ name: "Entry 1", picks: {} }),
  });
  check("computeSetupDisplay: everything actually complete -> mode 'complete'", d.mode === "complete");
}
// REAL BUG, found from a real screenshot: a pool where every item was
// genuinely 4/4 "ok" was STILL showing the big itemized checklist card,
// not the compact "setup complete" summary -- because a stale-odds
// WARNING (independent of any item's own ok/bad status) was blocking the
// old "allOk && !warnings.length" check from ever reaching "complete"
// mode. Every warning this function can produce already duplicates
// something the Context Bar's own summary line shows (odds freshness),
// so this was pure wasted mobile screen space, not new information.
{
  const d = runDisplay({
    isDemo: false,
    games: [{ away: "A", home: "B" }],
    state: { enabledSystems: [], lastGames: [{ away: "A", home: "B" }], lastRefresh: "2026-08-19T09:00:00Z", predMeta: null },
    currentPool: () => ({ id: "p1", name: "Test Pool", games: [{ away: "A", home: "B" }] }),
    activeEntry: () => ({ name: "Entry 1", picks: {} }),
    minsAgo: () => 200, // >=180min threshold -> triggers the staleness warning
  });
  check("computeSetupDisplay: a pool with EVERY item genuinely ok, but a stale-odds WARNING present too, still resolves to 'complete' -- warnings alone no longer force the big checklist card back (the actual bug from the real screenshot)",
    d.mode === "complete");
  check("computeSetupDisplay: 'complete' mode now carries the real setup object too (so callers -- e.g. computeContextSummary()'s 'Setup ✓' fold-in -- don't need a second computeWeeklySetup() call)",
    d.setup && d.setup.okCount === d.setup.requiredCount && d.setup.requiredCount > 0);
}
{
  const d = runDisplay({
    isDemo: false,
    games: [{ away: "A", home: "B" }],
    state: { enabledSystems: [], lastGames: null, lastRefresh: null, predMeta: null },
    currentPool: () => null,
    activeEntry: () => null,
  });
  check("computeSetupDisplay: something genuinely incomplete -> mode 'checklist', carries the real setup object",
    d.mode === "checklist" && d.setup && Array.isArray(d.setup.items));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
