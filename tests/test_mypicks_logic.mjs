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
// bucketForSpread/probabilityCoverForGame moved out of index.html into
// app/js/model.js. Pulling the WHOLE file in here (the way
// test_client_logic.mjs does) would be wrong for this file specifically:
// model.js also declares the real myNumber(), and a `function` declaration
// silently overwrites an existing same-named global in a vm context (const
// doesn't -- only function does), which would clobber the deliberate
// myNumber stub below. So this file extracts just the two functions it
// actually needs from model.js's real source, same brace-matching
// discipline as extractFunction() below, just pointed at a different file.
const modelSrc = fs.readFileSync(new URL("../app/js/model.js", import.meta.url), "utf8");
// pickedSideStats/movePick moved out of index.html into app/js/picks.js.
// Extracted individually below (not the whole file) -- picks.js also
// declares the real renderPicksDetail(), which the movePick test
// deliberately stubs; a `function` declaration would clobber that stub if
// the whole file were dropped in wholesale.
const picksSrc = fs.readFileSync(new URL("../app/js/picks.js", import.meta.url), "utf8");

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

// ---------------------------------------------------------------------
// pickedSideStats
// ---------------------------------------------------------------------
{
  const code = [
    extractFunction("round1"),
    extractFunction("bucketForSpread", modelSrc),
    extractFunction("probabilityCoverForGame", modelSrc),
    extractFunction("pickedSideStats", picksSrc),
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
// pickDecisionSnapshot -- immutable analytics captured at pick time
// ---------------------------------------------------------------------
{
  const code = extractFunction("pickDecisionSnapshot", picksSrc);
  const ctx = {
    state: {
      enabledSystems: ["bp", "comp", "fpi"],
      book: "draftkings",
      lastRefresh: "2026-08-18T20:55:00.000Z",
    },
    MODEL_VERSION: 1,
    myNumber: () => -7,
    inputsFor: () => [-6.5, -7.5],
    predsFor: () => ({ fpi: -8 }),
    enabledSystemsOrdered: () => ["fpi"],
    weightOf: (key) => ({ bp: 1, comp: 2, fpi: 1.5, vegas: 0 }[key] ?? 1),
    edgeOf: () => ({
      pts: 4,
      side: "home",
      team: "Team B",
      keyNumbers: [3, 7],
      keyTier: "major",
      keyScore: 9.2,
    }),
    probabilityCoverForGame: () => ({ pCover: 0.60, pPush: 0.02, pLoss: 0.38 }),
    modelAgreement: (_g, side) => side === "home"
      ? ({side:"home",agree:2,oppose:1,neutral:0,total:3,pct:2/3})
      : ({side:"away",agree:1,oppose:2,neutral:0,total:3,pct:1/3}),
    round1: (n) => Math.round(n * 10) / 10,
  };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const g = { key: "a@b", home: "Team B", away: "Team A", vegas: -3 };
  const snap = ctx.pickDecisionSnapshot(g, "home");
  check("pickDecisionSnapshot: freezes Model # at pick time", snap.modelNumberAtPick === -7);
  check("pickDecisionSnapshot: stores both raw edge and picked-side edge", snap.rawEdgeAtPick === 4 && snap.pickedEdgeAtPick === 4);
  check("pickDecisionSnapshot: stores picked-side cover probability and EV", snap.coverProbabilityAtPick === 0.60 && Math.abs(snap.evAtPick - (0.60 * 0.9091 - 0.38)) < 1e-9);
  check("pickDecisionSnapshot: freezes enabled model systems", Array.from(snap.enabledSystemsAtPick).join(",") === "bp,comp,fpi");
  check("pickDecisionSnapshot: freezes model inputs including Vegas", snap.modelInputsAtPick.bp === -6.5 && snap.modelInputsAtPick.comp === -7.5 && snap.modelInputsAtPick.fpi === -8 && snap.modelInputsAtPick.vegas === -3);
  check("pickDecisionSnapshot: freezes effective model weights", snap.modelWeightsAtPick.bp === 1 && snap.modelWeightsAtPick.comp === 2 && snap.modelWeightsAtPick.fpi === 1.5 && snap.modelWeightsAtPick.vegas === 0);
  check("pickDecisionSnapshot: stores model version and pick timestamp", snap.modelVersion === 1 && typeof snap.pickedAt === "string" && snap.pickedAt.includes("T"));
  check("pickDecisionSnapshot: freezes the market book and market observation timestamp used at pick time",
    snap.bookAtPick === "draftkings" && snap.marketObservedAtPick === "2026-08-18T20:55:00.000Z");
  check("pickDecisionSnapshot: freezes model agreement from the picked side's perspective",
    snap.modelAgreementAtPick.agree === 2 && snap.modelAgreementAtPick.total === 3 && Math.abs(snap.modelAgreementAtPick.pct - 2/3) < 1e-9);

  const against = ctx.pickDecisionSnapshot(g, "away");
  check("pickDecisionSnapshot: pick against model gets negative picked-side edge", against.pickedEdgeAtPick === -4);
  check("pickDecisionSnapshot: pick against model uses opposite-side cover probability", against.coverProbabilityAtPick === 0.38);
}

// ---------------------------------------------------------------------
// movePick
// ---------------------------------------------------------------------
{
  const code = extractFunction("movePick", picksSrc);
  const entries = [{ id: "e1", picks: { a: { team: "A" }, b: { team: "B" }, c: { team: "C" } } }];
  const ctx = {
    activeEntries: () => entries,
    entryIsLocked: (ent) => !!(ent&&ent.submittedAt),
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

  entries[0].submittedAt="2026-09-05T15:00:00Z";
  ctx.movePick("e1", "a", 1);
  check("movePick: submitted entry is locked and cannot be reordered", Object.keys(entries[0].picks).join(",") === "a,b,c");
  delete entries[0].submittedAt;

  ctx.movePick("does-not-exist", "a", 1);
  check("movePick: unknown entry id is a safe no-op, doesn't throw", true);
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
