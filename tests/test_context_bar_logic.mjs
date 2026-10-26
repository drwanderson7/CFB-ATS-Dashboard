// Runtime tests for computeContextSummary()'s pure decision logic -- what
// text the Context Bar should show, independent of how renderContextBar()
// puts it on screen. Run with:
//
//     node tests/test_context_bar_logic.mjs
//
// Why this exists: the Context Bar had ZERO automated coverage before this
// -- it was built and verified via one-off Playwright renders during the
// session that shipped it, then never protected against a future
// regression the way most of this app's logic is. This is the first of
// two pieces closing that gap (the DOM-dependent half -- does the bar
// actually open/close correctly, does the composedPath() click-outside
// fix still hold -- needs a real browser and lives in
// tests/test_e2e_context_bar.py instead; a plain vm context has no DOM to
// click on).
//
// Extracts the ACTUAL function from app/js/pool-contexts.js, not a
// hand-copied reimplementation that could silently drift, per this
// project's established pattern.
import fs from "node:fs";
import vm from "node:vm";

const poolContextsSrc = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");
const oddsSrc = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");

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

const code = extractFunction("computeContextSummary", poolContextsSrc)
  + "\n" + extractFunction("poolLockStatusLabel", poolContextsSrc)
  // The real "Lines updated ..." label (app/js/odds.js), Oct 26, 2026.
  + "\n" + extractFunction("linesWhen", oddsSrc)
  + "\n" + extractFunction("linesUpdatedLabel", oddsSrc);

// Stubs for every external reference computeContextSummary() makes --
// real functions in production, kept minimal and swappable here so each
// scenario below can drive them independently. Matches the established
// pattern elsewhere in this suite (ctx.activeEntry stubs, etc.) rather
// than pulling in the whole file (which would risk clobbering these with
// the real ones -- pool-contexts.js declares several of these for real).
function makeCtx(overrides = {}) {
  const base = {
    state: { weekAnchor: null, lastRefresh: null },
    isDemo: false,
    currentPool: () => null,
    activeEntry: () => null,
    pickLimit: () => 7,
    weekLabel: (idx) => (idx <= 0 ? "Week 0" : "Week " + idx),
    currentWeekIndex: () => 3,
    minsAgo: () => null,
  };
  return Object.assign(base, overrides);
}

function run(overrides) {
  const ctx = makeCtx(overrides);
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  return ctx.computeContextSummary();
}

// --- Overall board, no pool, demo data --------------------------------
{
  const r = run({ isDemo: true });
  check("No Pool + demo: line1 uses the simplified 'No Pool' label", r.line1.startsWith("No Pool"));
  check("No Pool + demo: line1 includes the current week label", r.line1.includes("Week 3"));
  check("No Pool + demo: line2 flags demo data", r.line2.includes("demo data"));
  check("No Pool + demo: line2 does NOT also claim odds are stale/fresh (demo data isn't real odds)",
    !r.line2.includes("odds"));
}

// --- Overall board, live data, never refreshed -------------------------
{
  const r = run({ isDemo: false });
  check("Live data, never refreshed: line2 says so plainly", r.line2.startsWith("Lines not loaded yet"));
}

// --- Lines updated earlier today / on an earlier day (Oct 26, 2026) ----
// Lines only refresh on a Refresh lines click now, so the bar says WHEN, with
// the day when it wasn't today, and puts it first so a phone's ellipsis
// can't hide it.
{
  const today = new Date(Date.now() - 12 * 60000).toISOString();
  const r = run({ isDemo: false, state: { weekAnchor: null, lastRefresh: today } });
  const t = new Date(today).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  check("Updated earlier today: 'Lines updated <time>' leads line2", r.line2.startsWith(`Lines updated ${t}`));
}
{
  const d = new Date(Date.now() - 2 * 24 * 3600000);
  const r = run({ isDemo: false, state: { weekAnchor: null, lastRefresh: d.toISOString() } });
  const wd = d.toLocaleDateString(undefined, { weekday: "short" });
  check("Updated two days ago: the weekday is included ('Lines updated Sat 9:14 AM')", r.line2.startsWith(`Lines updated ${wd} `));
  check("the old 'odds updated Xm ago' wording is gone", !r.line2.includes("odds updated"));
}

// --- state.weekAnchor === "ALL" (Overall board only, no pool) ----------
{
  const r = run({ isDemo: true, state: { weekAnchor: "ALL", lastRefresh: null } });
  check("weekAnchor 'ALL' in No Pool view: line1 says 'All weeks', not a specific week number",
    r.line1.includes("All weeks"));
}

// --- Pool context: no games imported yet --------------------------------
{
  const pool = { name: "Test Pool", weekLabel: "Week 2", games: [] };
  const r = run({ currentPool: () => pool, activeEntry: () => ({ name: "Entry 1", picks: {} }), isDemo: true });
  check("Pool with 0 games: line1 uses the POOL's own weekLabel, not the calendar week",
    r.line1.includes("Week 2") && !r.line1.includes("Week 3"));
  check("Pool with 0 games: line2 says so, not a lock-count that would be meaningless at 0/0",
    r.line2.includes("no games imported yet"));
  check("Pool context: line1 shows the pool's name, not 'No Pool'",
    r.line1.startsWith("Test Pool"));
}

// --- Pool context: every game locked ------------------------------------
{
  const pool = { name: "Test Pool", weekLabel: "Week 2", games: [{ line: -6 }, { line: 3.5 }] };
  const r = run({ currentPool: () => pool, activeEntry: () => ({ name: "Entry 1", picks: {} }), isDemo: true });
  check("Pool, all games locked: line2 says 'lines locked' (not a fractional count)",
    r.line2.includes("lines locked") && !r.line2.includes("0/2") && !r.line2.includes("2/2"));
}

// --- Pool context: no games locked yet (all provisional) ----------------
{
  const pool = { name: "Test Pool", weekLabel: "Week 2", games: [{ line: null }, { line: null }] };
  const r = run({ currentPool: () => pool, activeEntry: () => ({ name: "Entry 1", picks: {} }), isDemo: true });
  check("Pool, no games locked: line2 says 'lines provisional', not a count", r.line2.includes("lines provisional"));
}

// --- Pool context: a genuine partial mix ---------------------------------
{
  const pool = { name: "Test Pool", weekLabel: "Week 2", games: [{ line: -6 }, { line: null }, { line: 3.5 }] };
  const r = run({ currentPool: () => pool, activeEntry: () => ({ name: "Entry 1", picks: {} }), isDemo: true });
  check("Pool, partial lock mix: line2 shows the actual fraction (2/3), neither all-locked nor all-provisional wording",
    r.line2.includes("2/3 lines locked"));
}

// --- No active entry ------------------------------------------------------
{
  const r = run({ activeEntry: () => null, isDemo: true });
  check("No active entry: simplified Overall line does not expose a meaningless em dash",
    !r.line1.includes("—") && r.line1.includes("Week 3"));
  check("No active entry: zero-pick status stays hidden until an entry actually matters",
    !r.line2.includes("0/7 picks"));
}

// --- Pick count reflects the active entry's real picks -------------------
{
  const r = run({
    activeEntry: () => ({ name: "Entry 1", picks: { g1: {}, g2: {}, g3: {} } }),
    pickLimit: () => 7,
    isDemo: true,
  });
  // Oct 26, 2026: the lines status ("Lines updated ..." / "demo data") leads
  // line2 so a phone's ellipsis can't hide it; the pick count follows it.
  check("3 real picks on the active entry: line2 shows 3/7, not 0/7, right after the lines status", r.line2.startsWith("demo data · 3/7 picks"));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
