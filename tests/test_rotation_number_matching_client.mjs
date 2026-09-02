// Regression coverage for rotation-number matching (Aug 27 feature),
// client side. Confirmed (Drew, against a real week's live Odds API pull
// vs. a real Powers PDF for the same week) that Brad Powers' own
// rotation numbers match The Odds API's rotation numbers for the same
// real games -- see tests/test_rotation_numbers.py for the server-side
// half (api/fetch_odds.py requesting/extracting them, api/parse_pdf.py
// returning the ones it already extracted internally). This file covers
// findBoardGameByRotation() and its integration into applyPdfData()
// (app/js/pdf-import.js), extracted and run as the REAL functions, not a
// hand-copied reimplementation, per this project's established pattern
// (see tests/test_pdf_error_handling.mjs's own header comment).
import fs from "node:fs";
import vm from "node:vm";

const pdfImportSrc = fs.readFileSync(new URL("../app/js/pdf-import.js", import.meta.url), "utf8");
const mainSrc = fs.readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");
const teamAliasSrc = fs.readFileSync(new URL("../app/data/team-alias.js", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

function extractFunction(name, source) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

function extractConst(name, source) {
  const marker = `const ${name}=`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  const semi = source.indexOf(";", start);
  return source.slice(start, semi + 1);
}

function makeCtx(boardGames) {
  const ctx = { console, games: boardGames, state: { inputs: {}, pdfGames: [], lastGames: boardGames }, demoInputs: {}, isDemo: false };
  vm.createContext(ctx);
  vm.runInContext(teamAliasSrc, ctx); // real TEAM_ALIAS table, not a stub
  vm.runInContext(extractFunction("norm", mainSrc), ctx);
  vm.runInContext(extractFunction("mkey", mainSrc), ctx);
  vm.runInContext(extractFunction("stripEllipsis", mainSrc), ctx);
  vm.runInContext(extractFunction("teamTokens", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("aliasOf", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("prefixOk", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("teamMatch", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("resolveTrunc", mainSrc), ctx);
  vm.runInContext(extractFunction("teamMatchTrunc", mainSrc), ctx);
  vm.runInContext(extractConst("POWERS_TEAM_ALIASES", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("normPowersTeam", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("powersTeamMatch", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("findBoardGame", pdfImportSrc), ctx);
  vm.runInContext(extractFunction("findBoardGameByRotation", pdfImportSrc), ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// findBoardGameByRotation() in isolation
// ---------------------------------------------------------------------------
{
  const board = [
    { key: "auburn@alabama", away: "Auburn", home: "Alabama", awayRotation: 181, homeRotation: 182 },
    { key: "gastate@coastal", away: "Georgia State", home: "Coastal Carolina" }, // no rotation numbers at all
  ];
  const ctx = makeCtx(board);

  check("findBoardGameByRotation(): finds the correct game when both rotation numbers match exactly",
    ctx.findBoardGameByRotation(181, 182)?.key === "auburn@alabama");
  check("findBoardGameByRotation(): returns null when the PDF side is missing awayRotation",
    ctx.findBoardGameByRotation(null, 182) === null);
  check("findBoardGameByRotation(): returns null when the PDF side is missing homeRotation",
    ctx.findBoardGameByRotation(181, null) === null);
  check("findBoardGameByRotation(): returns null when BOTH are missing",
    ctx.findBoardGameByRotation(null, null) === null);
  check("findBoardGameByRotation(): returns null against a board game that has no rotation numbers at all (undefined !== number, correctly no match)",
    ctx.findBoardGameByRotation(999, 998) === null);
  check("findBoardGameByRotation(): a lone away-number match with the WRONG home number is not a match -- both must agree, same reasoning as findBoardGame()'s own both-teams-required rule",
    ctx.findBoardGameByRotation(181, 999) === null);
  check("findBoardGameByRotation(): numbers from a totally different, unrelated game do not accidentally match",
    ctx.findBoardGameByRotation(1, 2) === null);
}

// ---------------------------------------------------------------------------
// Real-world value: rotation numbers succeed where team-name matching
// would have failed outright -- confirms this isn't just a redundant
// second path to the same answer, it's genuinely more robust for the
// exact failure classes this project has already hit for real (Splash
// import's ranked-team "(10)Oklahoma" garbling, PDF ellipsis truncation).
// ---------------------------------------------------------------------------
{
  const board = [
    // Deliberately garbled/abbreviated names that teamMatch() would very
    // likely fail on, standing in for the real classes of name-matching
    // failure this project has actually hit (see api/parse_pool.py's
    // TEAM_RE_LEADING fix and app/js/pool-contexts.js's known ellipsis
    // truncation) -- rotation numbers don't care about any of this.
    { key: "g1", away: "(10)Oklahoma", home: "UTEP Miners Extra Junk", awayRotation: 187, homeRotation: 188 },
  ];
  const ctx = makeCtx(board);
  const byRotation = ctx.findBoardGameByRotation(187, 188);
  check("real-world value: rotation match succeeds against garbled/mismatched names that team-name matching would likely miss",
    byRotation?.key === "g1");
  const byName = ctx.findBoardGame("Oklahoma", "UTEP");
  check("(context, not a bug) confirms team-name matching genuinely WOULD fail here without rotation numbers -- proves the rotation path is adding real value, not just duplicating an easy case",
    byName === null);
}

// ---------------------------------------------------------------------------
// applyPdfData() integration -- rotation match tried FIRST, existing
// name-based fallback chain (exact mkey, then fuzzy findBoardGame)
// completely unchanged for games where either side lacks a rotation
// number.
// ---------------------------------------------------------------------------
{
  const board = [
    { key: "auburn@alabama", away: "Auburn", home: "Alabama", awayRotation: 181, homeRotation: 182, vegas: -14 },
    { key: "gastate@coastal", away: "Georgia State", home: "Coastal Carolina", vegas: 3.5 }, // no rotation numbers -- an FCS-opponent-style buy game
  ];
  const ctx = makeCtx(board);
  vm.runInContext(extractFunction("inputsFor", mainSrc), ctx);
  ctx.state.pdfGames = [
    // Rotation numbers present and correct, but the NAMES are garbled --
    // must still match via rotation, proving applyPdfData() actually
    // tries findBoardGameByRotation() first rather than only having the
    // helper defined and unused.
    { away: "AUB", home: "BAMA", awayRotation: 181, homeRotation: 182, bp: -13.5, comp: -14.5, homeVegas: -14 },
    // No rotation numbers at all -- must still work via the untouched
    // exact-mkey/fuzzy-name fallback chain.
    { away: "Georgia State", home: "Coastal Carolina", bp: 3, comp: 3.5, homeVegas: 3.5 },
  ];
  vm.runInContext(extractFunction("applyPdfData", pdfImportSrc), ctx);
  const filled = ctx.applyPdfData();

  check("applyPdfData(): both games filled (one via rotation match despite garbled names, one via the unchanged name-based fallback)",
    filled === 2);
  check("applyPdfData(): rotation-matched game's BP got written to the RIGHT board key despite garbled PDF team names",
    ctx.state.inputs["auburn@alabama"]?.[0] === -13.5);
  check("applyPdfData(): the no-rotation-numbers game still works via the existing name-based fallback, completely unaffected by this change",
    ctx.state.inputs["gastate@coastal"]?.[0] === 3);
}

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
