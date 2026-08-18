// Runtime tests for the shortlist feature's data-layer functions --
// currentShortlist()/isShortlisted()/toggleShortlist() in
// app/index.html's main inline script. Extracts the ACTUAL functions,
// not a hand-copied reimplementation, per this project's established
// pattern (see test_snapshot_logic.mjs). Run with:
//
//     node tests/test_shortlist_logic.mjs
//
// Covers: per-context scoping (Overall vs. a pool never share a
// shortlist, same as they never share game keys), lazy initialization
// (older saved state without the field doesn't need a migration step),
// toggle add/remove, and that toggling correctly calls through to
// save()/renderBoard() so a real change actually persists and re-renders.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const boardSrc = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");

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
  extractFunction("currentShortlist"),
  extractFunction("isShortlisted"),
  extractFunction("toggleShortlist"),
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

// --- Overall (no pool): state.shortlist -----------------------------------
{
  const ctx = makeCtx(null);
  check("currentShortlist(): lazily creates state.shortlist as [] when missing, not undefined/throw",
    Array.isArray(ctx.currentShortlist()));
  check("currentShortlist(): the lazily-created array is actually stored back on state (same reference on repeat calls)",
    ctx.currentShortlist() === ctx.currentShortlist());

  check("isShortlisted(): a key not yet added is not shortlisted", ctx.isShortlisted("g1") === false);
  ctx.toggleShortlist("g1");
  check("toggleShortlist(): adding a key makes isShortlisted() true", ctx.isShortlisted("g1") === true);
  check("toggleShortlist(): the key actually landed in state.shortlist", ctx.state.shortlist.includes("g1"));
  ctx.toggleShortlist("g1");
  check("toggleShortlist(): toggling the SAME key again removes it (true toggle, not add-only)",
    ctx.isShortlisted("g1") === false);
  check("toggleShortlist(): removed key is actually gone from the array, not just falsy", !ctx.state.shortlist.includes("g1"));

  check("toggleShortlist(): calls save() every time (2 toggles above -> 2 calls)", ctx.__calls.save === 2);
  check("toggleShortlist(): calls renderBoard() every time (2 toggles above -> 2 calls)", ctx.__calls.renderBoard === 2);
}

// --- A pool: pool.shortlist, independent of Overall's ----------------------
{
  const pool = { id: "p1", name: "Test Pool" }; // deliberately no shortlist field -- lazy init must handle this
  const ctx = makeCtx(pool);
  check("currentShortlist(): a pool with no shortlist field yet gets one lazily initialized",
    Array.isArray(ctx.currentShortlist()));
  ctx.toggleShortlist("g2");
  check("toggleShortlist() on a pool context: lands on the POOL's shortlist, not state.shortlist",
    pool.shortlist.includes("g2") && !("shortlist" in ctx.state));
}

// --- Independent scoping: two different pools, and Overall, never share ---
{
  const poolA = { id: "pA", shortlist: ["shared-key-name"] };
  const poolB = { id: "pB", shortlist: [] };
  const ctxA = makeCtx(poolA);
  const ctxB = makeCtx(poolB);
  check("shortlist scoping: a key present on pool A's shortlist does NOT show as shortlisted under pool B's context",
    ctxA.isShortlisted("shared-key-name") === true && ctxB.isShortlisted("shared-key-name") === false);

  const ctxOverall = makeCtx(null);
  check("shortlist scoping: a key shortlisted in a pool does NOT show as shortlisted on Overall (separate array entirely)",
    ctxOverall.isShortlisted("shared-key-name") === false);
}

// --- boardVisibleGames(): the Edge Board's two independent row filters ---
{
  const code = extractFunction("boardVisibleGames", boardSrc);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const games = [
    { key: "a", __aligned: true },
    { key: "b", __aligned: false },
    { key: "c", __aligned: true },
  ];
  // clvAlignment() itself isn't stubbed here -- boardVisibleGames() calls
  // whatever global clvAlignment is in scope, so provide a minimal stub
  // keyed off a test fixture field, same pattern used elsewhere in this
  // suite for functions that call out to bigger real logic.
  ctx.clvAlignment = (g) => g.__aligned;

  const neither = ctx.boardVisibleGames(games, false, false, []);
  check("boardVisibleGames: neither filter on -> every game shown",
    neither.length === 3);

  const alignOnly = ctx.boardVisibleGames(games, true, false, []);
  check("boardVisibleGames: only the alignment filter on -> only aligned games shown",
    alignOnly.length === 2 && alignOnly.every(g => g.__aligned));

  const shortlistOnly = ctx.boardVisibleGames(games, false, true, ["b"]);
  check("boardVisibleGames: only the shortlist filter on -> only shortlisted games shown",
    shortlistOnly.length === 1 && shortlistOnly[0].key === "b");

  const both = ctx.boardVisibleGames(games, true, true, ["a", "b"]);
  check("boardVisibleGames: BOTH filters on -> AND logic, a game must pass both (game 'b' is shortlisted but not aligned, correctly excluded)",
    both.length === 1 && both[0].key === "a");

  const bothNoMatch = ctx.boardVisibleGames(games, true, true, ["b"]);
  check("boardVisibleGames: both filters on with no game satisfying both -> empty, not a silent fallback to 'all'",
    bothNoMatch.length === 0);
}

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
