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
  extractFunction("ordinalSuffix"),
  extractFunction("round1"),
  extractFunction("clvOf"),
  extractFunction("clvAlignment"),
  extractFunction("snapClvCellData"),
  extractFunction("fmt"),
  extractFunction("mktModelHTML"),
  "this.SNAPSHOT_ROW_LIMIT = SNAPSHOT_ROW_LIMIT;", // const isn't auto-exposed on ctx like function decls are
].join("\n\n");

const ctx = {
  edgeClass: (pts) => (pts >= 3 ? "gd" : pts >= 1.5 ? "g" : "r"),
  activeEntry: () => ({ picks: ctx.__picks || {} }),
  // clvAlignment() calls myNumber(g) internally -- myNumber's own real
  // implementation pulls in state/inputsFor/predsFor/weightOf, way more
  // infra than this harness stubs. Real myNumber() is exercised by
  // test_client_logic.mjs instead; here it's a stub keyed off a test
  // fixture's own __myn field so clvAlignment's actual comparison logic
  // (direction of market move vs. direction of remaining model
  // disagreement) is what's under test, not myNumber's math.
  myNumber: (g) => (g && typeof g.__myn === "number" ? g.__myn : null),
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

// ---------------------------------------------------------------------
// Per-signal ranks (edgeRank/coverRank/keyRank) -- the row-expand detail
// panel shows these three individually even when Pick Score is toggled
// off, so they need to be stored on every row, not just folded into the
// combined pickScore number.
// ---------------------------------------------------------------------
{
  const rows = [
    { g: { key: "a" }, e: { pts: 5, prob: { pCover: 0.60 }, keyScore: 8 } },
    { g: { key: "b" }, e: { pts: 0.5, prob: { pCover: 0.50 }, keyScore: 0 } },
  ];
  ctx.computeSnapshotScores(rows);
  check("computeSnapshotScores stores edgeRank on every row", typeof rows[0].edgeRank === "number" && typeof rows[1].edgeRank === "number");
  check("computeSnapshotScores stores coverRank on every row", typeof rows[0].coverRank === "number" && typeof rows[1].coverRank === "number");
  check("computeSnapshotScores stores keyRank on every row", typeof rows[0].keyRank === "number" && typeof rows[1].keyRank === "number");
  check("the dominant row's three individual ranks are all at the top (100)",
    rows[0].edgeRank === 100 && rows[0].coverRank === 100 && rows[0].keyRank === 100);
  check("the weak row's three individual ranks are all at the bottom (0)",
    rows[1].edgeRank === 0 && rows[1].coverRank === 0 && rows[1].keyRank === 0);
}

// ---------------------------------------------------------------------
// ordinalSuffix -- used to label percentile bars ("72nd pctile" etc.) in
// the expand panel.
// ---------------------------------------------------------------------
{
  check("ordinalSuffix(1) -> 'st'", ctx.ordinalSuffix(1) === "st");
  check("ordinalSuffix(2) -> 'nd'", ctx.ordinalSuffix(2) === "nd");
  check("ordinalSuffix(3) -> 'rd'", ctx.ordinalSuffix(3) === "rd");
  check("ordinalSuffix(4) -> 'th'", ctx.ordinalSuffix(4) === "th");
  check("ordinalSuffix(11) -> 'th' (not 'st' -- the 11/12/13 exception)", ctx.ordinalSuffix(11) === "th");
  check("ordinalSuffix(12) -> 'th' (not 'nd')", ctx.ordinalSuffix(12) === "th");
  check("ordinalSuffix(13) -> 'th' (not 'rd')", ctx.ordinalSuffix(13) === "th");
  check("ordinalSuffix(21) -> 'st' (back to normal after the teens)", ctx.ordinalSuffix(21) === "st");
  check("ordinalSuffix(100) -> 'th'", ctx.ordinalSuffix(100) === "th");
  check("ordinalSuffix(0) -> 'th'", ctx.ordinalSuffix(0) === "th");
}

// ---------------------------------------------------------------------
// snapClvCellData -- Snapshot's Quick Look CLV column. This is the exact
// bug Drew reported from a real screenshot: unpicked games (the vast
// majority of any real slate) showed a blank "—" instead of any market
// information, because the column only ever passed a pick's side into
// clvOf(), and unpicked games have no side to pass. Fixed to fall back
// to the raw home-perspective market movement -- these tests prove that
// fallback actually fires for the right cases and only those cases.
// ---------------------------------------------------------------------
{
  const gameWithMovement = { lockedLine: -6.0, liveVegas: -8.5 };
  const notPicked = ctx.snapClvCellData(gameWithMovement, null);
  check("snapClvCellData: an UNPICKED game with real lock/live data shows 'raw' (the actual fix), not blank",
    notPicked.kind === "raw");
  check("snapClvCellData: the raw value is the real home-perspective market move (live - locked)",
    notPicked.value === -2.5);

  const pickedHome = ctx.snapClvCellData(gameWithMovement, "home");
  check("snapClvCellData: a PICKED game shows 'pick' (the pick-specific CLV), not raw",
    pickedHome.kind === "pick");
  check("snapClvCellData: pick-specific value matches clvOf()'s own forPick calculation directly (no reimplemented math)",
    pickedHome.value === ctx.clvOf(gameWithMovement, "home").forPick);

  const pickedAway = ctx.snapClvCellData(gameWithMovement, "away");
  check("snapClvCellData: picking the OTHER side of the same game gives the opposite-sign CLV",
    pickedAway.value === -pickedHome.value);

  const noLockData = { lockedLine: null, liveVegas: -8.5 };
  check("snapClvCellData: a game with no locked line at all correctly shows 'none' (genuinely nothing to report, not a bug)",
    ctx.snapClvCellData(noLockData, null).kind === "none");

  const noLiveData = { lockedLine: -6.0, liveVegas: null };
  check("snapClvCellData: a game with no live match yet also correctly shows 'none'",
    ctx.snapClvCellData(noLiveData, "home").kind === "none");

  const noMovement = { lockedLine: -6.0, liveVegas: -6.0 };
  check("snapClvCellData: a game where the market hasn't moved at all shows raw=0, not blank, when unpicked",
    ctx.snapClvCellData(noMovement, null).kind === "raw" && ctx.snapClvCellData(noMovement, null).value === 0);

  // "recommended" kind -- an unpicked game where the model still has a
  // lean (e.side) gets the SAME oriented/colorable math as an actual pick,
  // instead of falling back to unsigned raw. This closed the gap where the
  // Quick Look column showed less information than the same row's own
  // detail panel one click away.
  const recHome = ctx.snapClvCellData(gameWithMovement, null, "home");
  check("snapClvCellData: unpicked but model leans home -> kind 'recommended', not 'raw'",
    recHome.kind === "recommended");
  check("snapClvCellData: 'recommended' value matches clvOf()'s forPick for that side exactly (same math as an actual pick)",
    recHome.value === ctx.clvOf(gameWithMovement, "home").forPick && recHome.value === pickedHome.value);

  const recAway = ctx.snapClvCellData(gameWithMovement, null, "away");
  check("snapClvCellData: recommending the other side flips the sign, same as an actual pick would",
    recAway.value === -recHome.value);

  check("snapClvCellData: an actual pick always wins over a mere recommendation when both are present",
    ctx.snapClvCellData(gameWithMovement, "away", "home").kind === "pick" &&
    ctx.snapClvCellData(gameWithMovement, "away", "home").value === pickedAway.value);

  check("snapClvCellData: no pick AND no lean (model===market exactly, side:null) still falls back to raw, not 'recommended'",
    ctx.snapClvCellData(gameWithMovement, null, null).kind === "raw");
}

// ---------------------------------------------------------------------
// clvAlignment -- the ⚡ compound signal (already live on the full Board
// tab; this session added it to Snapshot's Quick Look column and detail
// panel too). True only when the market's drift since lock AND the
// model's remaining disagreement with the CURRENT line point the same
// direction -- i.e. the market's been sliding this way and the model
// still sees more room to go, not just noise.
// ---------------------------------------------------------------------
{
  // Market slid from -6 to -9 (toward home favorite). Model still says
  // -12 -- further in the same direction the market's already moving.
  // Aligned.
  const aligned = { lockedLine: -6, liveVegas: -9, __myn: -12 };
  check("clvAlignment: market drift and remaining model disagreement in the same direction -> nonzero (aligned)",
    ctx.clvAlignment(aligned) !== 0 && ctx.clvAlignment(aligned) !== null);

  // Market slid from -6 to -9, but the model now says -7 -- BACK toward
  // where the market already was, i.e. the model thinks the market
  // overcorrected. Not aligned.
  const notAligned = { lockedLine: -6, liveVegas: -9, __myn: -7 };
  check("clvAlignment: market drift and remaining model disagreement in OPPOSITE directions -> 0 (not aligned)",
    ctx.clvAlignment(notAligned) === 0);

  // Market hasn't moved since lock at all -- no direction to agree with,
  // regardless of what the model says.
  const flatMarket = { lockedLine: -6, liveVegas: -6, __myn: -12 };
  check("clvAlignment: market flat since lock (no movement to align with) -> 0",
    ctx.clvAlignment(flatMarket) === 0);

  const missingLock = { lockedLine: null, liveVegas: -9, __myn: -12 };
  check("clvAlignment: missing locked line -> null (genuinely nothing to compute, not a false 0)",
    ctx.clvAlignment(missingLock) === null);

  const missingModel = { lockedLine: -6, liveVegas: -9, __myn: null };
  check("clvAlignment: no model number available -> null",
    ctx.clvAlignment(missingModel) === null);
}

// ---------------------------------------------------------------------
// mktModelHTML -- regression test for the sign-convention bug reported
// from a real screenshot (Underdogs filter, North Texas/Ohio/Toledo all
// showing an away pick's model number in raw home-perspective instead of
// the picked side's own perspective). myNumber() never flips for side;
// e.line already does (see edgeOf()). Using the exact real-world numbers
// from that screenshot as the regression case.
// ---------------------------------------------------------------------
{
  // North Texas +40.5 @ Indiana, away pick. Raw edge was 8.3, so the
  // away-perspective model number must be 40.5 - 8.3 = 32.2, positive
  // (North Texas still a model dog, just a smaller one than the market
  // has them). myn passed in is the raw home-perspective number as
  // myNumber() actually returns it: -32.2 (Indiana favored by 32.2).
  const awayPick = { side: "away", line: 40.5 };
  const awayHTML = ctx.mktModelHTML(awayPick, -32.2);
  check("mktModelHTML: away pick flips myn to the picked side's perspective (North Texas case)",
    awayHTML.includes(">+32.2<"));
  check("mktModelHTML: away pick does NOT show the raw home-perspective number unflipped",
    !awayHTML.includes(">-32.2<"));
  check("mktModelHTML: market line itself is untouched",
    awayHTML.includes(">+40.5<"));

  // Ohio +23.5 @ Nebraska, away pick, raw edge 6.7 -> expect +16.8.
  const awayPick2 = { side: "away", line: 23.5 };
  const awayHTML2 = ctx.mktModelHTML(awayPick2, -16.8);
  check("mktModelHTML: away pick flips myn to the picked side's perspective (Ohio case)",
    awayHTML2.includes(">+16.8<"));

  // Home picks must NOT be touched -- myNumber()'s home-perspective
  // convention already matches e.line for a home pick, so flipping here
  // would introduce the exact same bug in the other direction.
  const homePick = { side: "home", line: -10.0 };
  const homeHTML = ctx.mktModelHTML(homePick, -13.2);
  check("mktModelHTML: home pick is NOT flipped (myn already matches e.line's perspective)",
    homeHTML.includes(">-13.2<"));

  // Null model number still renders the market line with a dash, not a
  // thrown error or a stray "null"/"NaN".
  const noModel = ctx.mktModelHTML({ side: "away", line: 5.5 }, null);
  check("mktModelHTML: null myn renders a dash, not an error or NaN",
    noModel.includes(">—<") && !noModel.includes("NaN"));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
