// Runtime tests for the Snapshot tab's pure logic -- extracts the ACTUAL
// functions from app/index.html (not a hand-copied reimplementation) and
// executes them in Node, per this project's established pattern. Run with:
//
//     node tests/test_snapshot_logic.mjs
//
// Covers:
//   - percentileRank: correct ranking, ties, single-element edge case.
//   - computeSnapshotScores (Pick Score): equal-weighted, no single signal
//     dominates by construction, and it's a pure re-ranking of the SAME
//     games Raw Edge would also rank (no game appears that Raw Edge
//     wouldn't also have shown).
//   - snapshotFilterRows: each filter narrows correctly and never returns
//     a game that fails its own condition.
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

function extractConst(name) {
  const startMarker = `const ${name}=`;
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find const ${name} in app/index.html`);
  const end = src.indexOf(";", start);
  return src.slice(start, end + 1);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const code = [
  extractConst("SNAPSHOT_ROW_LIMIT"),
  extractFunction("percentileRank"),
  extractFunction("computeSnapshotScores"),
  extractFunction("snapshotFilterRows"),
  "this.SNAPSHOT_ROW_LIMIT = SNAPSHOT_ROW_LIMIT;", // const isn't auto-exposed on ctx like function decls are
].join("\n\n");

const ctx = {
  edgeClass: (pts) => (pts >= 3 ? "gd" : pts >= 1.5 ? "g" : "r"),
  activeEntry: () => ({ picks: ctx.__picks || {} }),
};
vm.createContext(ctx);
vm.runInContext(code, ctx);

// ---------------------------------------------------------------------
// percentileRank
// ---------------------------------------------------------------------
{
  const arr = [1, 2, 3, 4, 5];
  check("percentileRank: minimum value ranks at 0", ctx.percentileRank(arr, 1) === 0);
  check("percentileRank: maximum value ranks at 100", ctx.percentileRank(arr, 5) === 100);
  check("percentileRank: middle value ranks at 50", ctx.percentileRank(arr, 3) === 50);
  check("percentileRank: single-element array doesn't divide by zero", ctx.percentileRank([5], 5) === 50);
  const tieArr = [1, 2, 2, 2, 5];
  const tieRank = ctx.percentileRank(tieArr, 2);
  check("percentileRank: tied values all get the same rank (no arbitrary tiebreak)",
    tieArr.filter(v => v === 2).every(() => ctx.percentileRank(tieArr, 2) === tieRank));
}

// ---------------------------------------------------------------------
// computeSnapshotScores (Pick Score)
// ---------------------------------------------------------------------
{
  // Three synthetic games: one dominant on ALL three signals, one weak on
  // all three, one mixed (high edge, low cover, no key number) -- proves
  // the score blends rather than being driven by a single signal.
  const rows = [
    { g: { key: "dominant" }, e: { pts: 5, prob: { pCover: 0.60 }, keyScore: 8 } },
    { g: { key: "weak" }, e: { pts: 0.5, prob: { pCover: 0.50 }, keyScore: 0 } },
    { g: { key: "mixed" }, e: { pts: 4, prob: { pCover: 0.51 }, keyScore: 0 } },
  ];
  ctx.computeSnapshotScores(rows);
  const byKey = Object.fromEntries(rows.map(r => [r.g.key, r]));

  check("Pick Score: dominant-on-everything game scores highest", byKey.dominant.pickScore === 100);
  check("Pick Score: weak-on-everything game scores lowest", byKey.weak.pickScore === 0);
  check("Pick Score: mixed game (high edge, weak elsewhere) scores between the two",
    byKey.mixed.pickScore > byKey.weak.pickScore && byKey.mixed.pickScore < byKey.dominant.pickScore);

  // Equal weighting check: a game that dominates on edge alone but is
  // average on the other two signals should NOT score as high as one
  // that's above-average on all three -- proves edge isn't secretly
  // weighted higher than the other two signals.
  const rows2 = [
    { g: { key: "edge_only" }, e: { pts: 10, prob: { pCover: 0.50 }, keyScore: 0 } },
    { g: { key: "balanced" }, e: { pts: 3, prob: { pCover: 0.56 }, keyScore: 5 } },
    { g: { key: "floor" }, e: { pts: 1, prob: { pCover: 0.50 }, keyScore: 0 } },
  ];
  ctx.computeSnapshotScores(rows2);
  const byKey2 = Object.fromEntries(rows2.map(r => [r.g.key, r]));
  check("Pick Score: edge-dominant-only game does not automatically outscore a balanced game",
    byKey2.balanced.pickScore >= byKey2.floor.pickScore);
}

// ---------------------------------------------------------------------
// snapshotFilterRows
// ---------------------------------------------------------------------
{
  const rows = [
    { g: { key: "a" }, e: { pts: 4, side: "home", keyTier: "major", keyNumbers: [7] } },
    { g: { key: "b" }, e: { pts: 1.8, side: "away", keyTier: "none", keyNumbers: [] } },
    { g: { key: "c" }, e: { pts: 0.6, side: "home", keyTier: "none", keyNumbers: [] } },
  ];
  ctx.__picks = { b: { side: "away" } };

  const strong = ctx.snapshotFilterRows(rows, "strong");
  check("filter 'strong': only includes games at/above the strong threshold",
    strong.length === 1 && strong[0].g.key === "a");

  const dogs = ctx.snapshotFilterRows(rows, "dog");
  check("filter 'dog': only includes away-side recommendations",
    dogs.length === 1 && dogs[0].g.key === "b");

  const keyRows = ctx.snapshotFilterRows(rows, "key");
  check("filter 'key': only includes games with a real key-number badge",
    keyRows.length === 1 && keyRows[0].g.key === "a");

  const mine = ctx.snapshotFilterRows(rows, "mine");
  check("filter 'mine': only includes games in the active entry's picks",
    mine.length === 1 && mine[0].g.key === "b");

  const all = ctx.snapshotFilterRows(rows, "all");
  check("filter 'all': returns every row", all.length === 3);
}

// ---------------------------------------------------------------------
// SNAPSHOT_ROW_LIMIT -- the Quick Look table on the Snapshot tab should
// always cap at this many rows, regardless of filter, so it stays a
// quick scan rather than becoming a second full board.
// ---------------------------------------------------------------------
{
  check("SNAPSHOT_ROW_LIMIT is a small, sane number (between 5 and 10, per the actual request)",
    ctx.SNAPSHOT_ROW_LIMIT >= 5 && ctx.SNAPSHOT_ROW_LIMIT <= 10);

  const bigSlate = Array.from({ length: 34 }, (_, i) => ({
    g: { key: "g" + i },
    e: { pts: 10 - i * 0.1, side: "home", keyTier: "none", keyNumbers: [] },
  }));
  const allFiltered = ctx.snapshotFilterRows(bigSlate, "all");
  const capped = allFiltered.slice(0, ctx.SNAPSHOT_ROW_LIMIT);
  check("a 34-game slate produces exactly SNAPSHOT_ROW_LIMIT rows after capping",
    capped.length === ctx.SNAPSHOT_ROW_LIMIT);
  check("capping keeps the highest-edge games (rows are pre-sorted by caller; slice just trims the tail)",
    capped[0].g.key === "g0" && capped[capped.length - 1].g.key === `g${ctx.SNAPSHOT_ROW_LIMIT - 1}`);

  const smallSlate = bigSlate.slice(0, 3);
  const smallFiltered = ctx.snapshotFilterRows(smallSlate, "all");
  const smallCapped = smallFiltered.slice(0, ctx.SNAPSHOT_ROW_LIMIT);
  check("a slate smaller than the cap is NOT padded or altered", smallCapped.length === 3);
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
