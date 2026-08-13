// Runtime tests for My Picks entry-review logic -- extracts the ACTUAL
// functions from app/index.html (not a hand-copied reimplementation) and
// executes them in Node, per this project's established pattern. Run with:
//
//     node tests/test_mypicks_logic.mjs
//
// Covers:
//   - pickedSideStats: edge/cover computed from the PICKED side, which can
//     genuinely differ from whatever side the model currently favors --
//     this is the actual bug class the whole feature exists to catch
//     (someone picked against what the model likes, or the market moved
//     since they picked).
//   - movePick: reorders an entry's picks object by rebuilding key
//     insertion order, without needing a new schema field.
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const startMarker = `function ${name}(`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}() in app/index.html`);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// ---------------------------------------------------------------------
// pickedSideStats
// ---------------------------------------------------------------------
{
  const code = [
    extractFunction("round1"),
    extractFunction("bucketForSpread"),
    extractFunction("probabilityCoverForGame"),
    extractFunction("pickedSideStats"),
  ].join("\n\n");

  // Minimal fakes for what pickedSideStats calls that live elsewhere in
  // the real file (myNumber is the full weighted-model average machinery
  // -- not needed here, just needs to return a fixed number per game).
  const ctx = {
    BUCKETED_COVER_TABLE: { "0 to 60": { range: [0, 60], freq: { "0": 1 } } }, // trivial bucket, not exercised precisely
    BREAKEVEN_WINPCT: 0.5238,
    myNumber: (g) => g.__M,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  // Home favored by the model more than the market has it (M < V):
  // model's own favored side is home. Picking home should show POSITIVE
  // edge; picking away (against the model) should show NEGATIVE edge.
  const gameHomeFavored = { vegas: -3, __M: -7 }; // V=-3, M=-7 -> model likes home more
  const homeStats = ctx.pickedSideStats(gameHomeFavored, "home");
  const awayStats = ctx.pickedSideStats(gameHomeFavored, "away");
  check("pickedSideStats: picking WITH the model's favored side gives positive edge", homeStats.edgePts > 0);
  check("pickedSideStats: picking AGAINST the model's favored side gives negative edge", awayStats.edgePts < 0);
  check("pickedSideStats: the two sides' edges are exact opposites (same magnitude, opposite sign)",
    Math.abs(homeStats.edgePts + awayStats.edgePts) < 1e-9);
  check("pickedSideStats: picking the model's own side gets the higher cover %",
    homeStats.coverPct > awayStats.coverPct);

  check("pickedSideStats: returns null for an off-board game (no live game object)",
    ctx.pickedSideStats(null, "home") === null);

  const noModelGame = { vegas: -3 }; // no __M -> myNumber returns undefined
  check("pickedSideStats: returns null when there's no model number for this game",
    ctx.pickedSideStats(noModelGame, "home") === null);
}

// ---------------------------------------------------------------------
// movePick
// ---------------------------------------------------------------------
{
  const code = extractFunction("movePick");
  const entries = [{ id: "e1", picks: { a: { team: "A" }, b: { team: "B" }, c: { team: "C" } } }];
  const ctx = {
    activeEntries: () => entries,
    save: () => {},
    renderPicksDetail: () => {},
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  ctx.movePick("e1", "a", 1); // move "a" down one -> b, a, c
  check("movePick: moving down swaps with the next key", Object.keys(entries[0].picks).join(",") === "b,a,c");

  ctx.movePick("e1", "a", -1); // move "a" back up -> a, b, c
  check("movePick: moving up swaps with the previous key", Object.keys(entries[0].picks).join(",") === "a,b,c");

  ctx.movePick("e1", "a", -1); // already first -- no-op, out of bounds
  check("movePick: moving the first pick up is a no-op (doesn't throw, doesn't reorder)",
    Object.keys(entries[0].picks).join(",") === "a,b,c");

  ctx.movePick("e1", "c", 1); // already last -- no-op, out of bounds
  check("movePick: moving the last pick down is a no-op", Object.keys(entries[0].picks).join(",") === "a,b,c");

  check("movePick: values stay correctly associated with their keys after reordering",
    entries[0].picks.a.team === "A" && entries[0].picks.b.team === "B" && entries[0].picks.c.team === "C");

  ctx.movePick("does-not-exist", "a", 1);
  check("movePick: unknown entry id is a safe no-op, doesn't throw", true);
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
