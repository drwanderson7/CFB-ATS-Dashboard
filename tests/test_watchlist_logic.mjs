// Runtime tests for the watchlist ("shortlist") feature's data-layer
// functions -- currentWatchlist()/isWatched()/toggleWatch() in
// app/index.html's main inline script. Extracts the ACTUAL functions,
// not a hand-copied reimplementation, per this project's established
// pattern (see test_snapshot_logic.mjs). Run with:
//
//     node tests/test_watchlist_logic.mjs
//
// Covers: per-context scoping (Overall vs. a pool never share a
// watchlist, same as they never share game keys), lazy initialization
// (older saved state without the field doesn't need a migration step),
// toggle add/remove, and that toggling correctly calls through to
// save()/renderBoard() so a real change actually persists and re-renders.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function extractFunction(name, source = src) {
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
  extractFunction("currentWatchlist"),
  extractFunction("isWatched"),
  extractFunction("toggleWatch"),
].join("\n\n");

function makeCtx(pool) {
  const calls = { save: 0, renderBoard: 0 };
  const ctx = {
    state: {},
    currentPool: () => pool,
    save: () => { calls.save++; },
    renderBoard: () => { calls.renderBoard++; },
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  ctx.__calls = calls;
  return ctx;
}

// --- Overall (no pool): state.watchlist -----------------------------------
{
  const ctx = makeCtx(null);
  check("currentWatchlist(): lazily creates state.watchlist as [] when missing, not undefined/throw",
    Array.isArray(ctx.currentWatchlist()));
  check("currentWatchlist(): the lazily-created array is actually stored back on state (same reference on repeat calls)",
    ctx.currentWatchlist() === ctx.currentWatchlist());

  check("isWatched(): a key not yet added is not watched", ctx.isWatched("g1") === false);
  ctx.toggleWatch("g1");
  check("toggleWatch(): adding a key makes isWatched() true", ctx.isWatched("g1") === true);
  check("toggleWatch(): the key actually landed in state.watchlist", ctx.state.watchlist.includes("g1"));
  ctx.toggleWatch("g1");
  check("toggleWatch(): toggling the SAME key again removes it (true toggle, not add-only)",
    ctx.isWatched("g1") === false);
  check("toggleWatch(): removed key is actually gone from the array, not just falsy", !ctx.state.watchlist.includes("g1"));

  check("toggleWatch(): calls save() every time (2 toggles above -> 2 calls)", ctx.__calls.save === 2);
  check("toggleWatch(): calls renderBoard() every time (2 toggles above -> 2 calls)", ctx.__calls.renderBoard === 2);
}

// --- A pool: pool.watchlist, independent of Overall's -----------------------
{
  const pool = { id: "p1", name: "Test Pool" }; // deliberately no watchlist field -- lazy init must handle this
  const ctx = makeCtx(pool);
  check("currentWatchlist(): a pool with no watchlist field yet gets one lazily initialized",
    Array.isArray(ctx.currentWatchlist()));
  ctx.toggleWatch("g2");
  check("toggleWatch() on a pool context: lands on the POOL's watchlist, not state.watchlist",
    pool.watchlist.includes("g2") && !("watchlist" in ctx.state));
}

// --- Independent scoping: two different pools, and Overall, never share ---
{
  const poolA = { id: "pA", watchlist: ["shared-key-name"] };
  const poolB = { id: "pB", watchlist: [] };
  const ctxA = makeCtx(poolA);
  const ctxB = makeCtx(poolB);
  check("watchlist scoping: a key present on pool A's watchlist does NOT show as watched under pool B's context",
    ctxA.isWatched("shared-key-name") === true && ctxB.isWatched("shared-key-name") === false);

  const ctxOverall = makeCtx(null);
  check("watchlist scoping: a key watched in a pool does NOT show as watched on Overall (separate array entirely)",
    ctxOverall.isWatched("shared-key-name") === false);
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
