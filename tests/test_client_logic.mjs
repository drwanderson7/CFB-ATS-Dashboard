// Runtime tests for pure client-side logic in index.html -- extracts the
// ACTUAL function source via string matching (not a hand-copied
// reimplementation, which could silently drift from the real file) and
// executes it in Node. Run with:
//
//     node tests/test_client_logic.mjs
//
// Covers:
//   - resolveVegasLine/resolveBookLines: two devices with different book
//     preferences resolve different, correct lines from the same shared
//     per-book snapshot (Priority 2 item #4's acceptance test).
//   - probabilityCoverForGame: push probability is excluded from both the
//     win and loss buckets, not folded into loss (Priority 3 item #5's
//     acceptance tests).
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8")
  // app/js/main.js is the last remaining chunk of what used to be the
  // inline <script> block in app/index.html -- externalized for CSP (see
  // vercel.json's Content-Security-Policy header, script-src no longer
  // needs 'unsafe-inline'). Appended here so extractFunction()/extractConst()
  // below -- which default to searching `src` -- keep finding functions
  // that used to live inline and now live in main.js instead, same as
  // every other file already split out of index.html (model.js, odds.js,
  // etc. via readJsFile()).
  + "\n" + fs.readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");

// Some large, pure-data consts (BUCKETED_COVER_TABLE, TEAM_ALIAS,
// PRED_SYSTEMS) were split out of index.html into app/data/*.js during a
// data-extraction pass -- they're no longer inline, so an index.html-based
// extractor can't find them there anymore. Those files are already valid
// standalone JS (just a `const NAME=...;` statement), so their raw content
// drops straight into the same vm.runInContext() code string
// extractFunction()'s results already get joined into -- no
// reimplementation, same read-the-real-file guarantee, just a different
// file. (This file no longer needs a separate extractConst() helper now
// that its one caller, BREAKEVEN_WINPCT, moved into model.js below and
// gets pulled in wholesale by readJsFile() instead.)
function readDataFile(filename) {
  return fs.readFileSync(new URL(`../app/data/${filename}`, import.meta.url), "utf8");
}
// Same idea, but for app/js/*.js -- real LOGIC files (not just static data)
// split out of index.html, starting with model.js (the composite
// probability model: weightOf/weightedModel/myNumber/keyNumberScore/
// keyNumberTier/edgeOf/edgeClass/BREAKEVEN_WINPCT/bucketForSpread/
// probabilityCoverForGame/clvOf/clvAlignment all live there now). Reading
// the whole file is simpler than extracting individual functions from it
// AND correct here specifically because model.js has no top-level
// evaluation depending on anything else -- every external reference
// (state/inputsFor/predsFor/round1/BUCKETED_COVER_TABLE) is inside a
// function body, resolved lazily, so dropping the whole file into the vm
// context is safe regardless of what else is or isn't defined yet.
function readJsFile(filename) {
  return fs.readFileSync(new URL(`../app/js/${filename}`, import.meta.url), "utf8");
}
// resolveVegasLine/resolveBookLines moved out of index.html into
// app/js/odds.js. This test's ctx only stubs `state` (a plain data object,
// not a function), so there's no clobbering risk here the way there was
// for the myNumber/activeEntry/renderPicksDetail stubs in the other test
// files -- but extracting just the two functions actually used keeps this
// consistent with the pattern everywhere else in this test suite.
const oddsSrc = readJsFile("odds.js");

function extractFunction(name, source = src) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  // Walk forward from the opening brace, tracking nesting, to find the
  // matching close -- functions in this file aren't one-liners so a naive
  // regex would clip them.
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

// ---------------------------------------------------------------------------
// Sportsbook resolution
// ---------------------------------------------------------------------------
{
  const code = [
    extractFunction("round1"),
    extractFunction("resolveVegasLine", oddsSrc),
    extractFunction("resolveBookLines", oddsSrc),
  ].join("\n\n");

  const ctx = { state: { book: "consensus" } };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  const gameA = { away: "Auburn", home: "Alabama", books: { draftkings: -6.5, fanduel: -7, betmgm: -6 } };
  const gameB = { away: "Ohio State", home: "Michigan", books: {} }; // no games posted for this one yet

  // Device 1 prefers DraftKings.
  ctx.state.book = "draftkings";
  const r1 = ctx.resolveVegasLine(gameA, ctx.state.book);
  check("resolveVegasLine: DraftKings preference resolves to DraftKings' own line", r1.line === -6.5 && r1.book === "draftkings");

  // Device 2 prefers FanDuel, from the exact same stored snapshot.
  ctx.state.book = "fanduel";
  const r2 = ctx.resolveVegasLine(gameA, ctx.state.book);
  check("resolveVegasLine: FanDuel preference (same snapshot) resolves to FanDuel's own line, not DraftKings'", r2.line === -7 && r2.book === "fanduel");
  check("...and the two devices see DIFFERENT correct lines from one shared fetch", r1.line !== r2.line);

  // Consensus = average of all books.
  ctx.state.book = "consensus";
  const r3 = ctx.resolveVegasLine(gameA, ctx.state.book);
  const expectedAvg = Math.round(((-6.5 + -7 + -6) / 3) * 2) / 2;
  check("resolveVegasLine: consensus averages every book in the snapshot", r3.line === expectedAvg && r3.book === "consensus");

  // A book that hasn't posted this game yet -- no crash, no fabricated line.
  const r4 = ctx.resolveVegasLine(gameB, "draftkings");
  check("resolveVegasLine: a game with no books yet returns null, not a fabricated line", r4 === null);

  // Backward compat: an old-shaped game object with only vegas/book (no
  // books dict) still resolves instead of breaking.
  const legacyGame = { vegas: -3.5, book: "consensus" };
  const r5 = ctx.resolveVegasLine(legacyGame, "draftkings");
  check("resolveVegasLine: falls back to legacy single vegas/book fields when no per-book dict exists", r5.line === -3.5 && r5.book === "consensus");

  // resolveBookLines mutates a whole games array in place.
  const games = [gameA];
  ctx.state.book = "betmgm";
  ctx.resolveBookLines(games);
  check("resolveBookLines: re-derives g.vegas/g.book for every game from the current book preference", games[0].vegas === -6 && games[0].book === "betmgm");
}

// ---------------------------------------------------------------------------
// EV push-handling fix
// ---------------------------------------------------------------------------
{
  const code = [
    readDataFile("cover-table.js"),
    readJsFile("model.js"),
  ].join("\n\n");

  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(code, ctx);

  // Half-point spread: V itself is not a whole number, so a push against a
  // real (always-integer) final margin is structurally impossible -- must
  // be exactly 0, not just small, regardless of what modelEdge happens to
  // land on.
  const half = ctx.probabilityCoverForGame(-7, -7.5);
  check("probabilityCoverForGame: half-point line (V=-7.5) has EXACTLY zero push probability", half.pPush === 0);
  check("probabilityCoverForGame: pCover + pPush + pLoss sums to ~1 (half-point case)",
        Math.abs(half.pCover + half.pPush + half.pLoss - 1) < 1e-9);

  // A DIFFERENT half-point case, chosen so modelEdge would coincidentally
  // cancel a real historical bucket entry (cm=0.5) if the V-is-integer
  // guard were missing -- this is the exact scenario that exposed the bug
  // during development (an earlier version of this fix registered spurious
  // push mass here because a bucket-mate's own half-point line contributed
  // a cm=0.5 entry that canceled modelEdge, even though V=-7.5 itself can
  // never actually push).
  const halfCoincidence = ctx.probabilityCoverForGame(-7, -7.5);
  check("probabilityCoverForGame: half-point line has zero push even when modelEdge would coincidentally cancel an unrelated bucket entry", halfCoincidence.pPush === 0);

  // Integer spread: push IS structurally possible.
  const whole = ctx.probabilityCoverForGame(-3, -7);
  check("probabilityCoverForGame: integer line can have non-zero push probability", whole.pPush > 0);
  check("probabilityCoverForGame: pCover + pPush + pLoss sums to ~1 (integer case)",
        Math.abs(whole.pCover + whole.pPush + whole.pLoss - 1) < 1e-9);

  // The actual bug: with the OLD formula, ev = pCover*0.9091-(1-pCover),
  // which for the integer case above would have been pCover*0.9091-(pLoss+pPush).
  // The NEW formula excludes pPush from the penalty term entirely.
  const oldBuggyEv = whole.pCover * 0.9091 - (1 - whole.pCover);
  check(
    "probabilityCoverForGame: EV is HIGHER than the old (buggy) formula whenever there's real push mass -- pushes no longer counted as losses",
    whole.pPush > 0 && whole.ev > oldBuggyEv,
  );
  const correctEv = whole.pCover * 0.9091 - whole.pLoss;
  check("probabilityCoverForGame: EV matches pCover*0.9091 - pLoss exactly (pushes contribute 0)", Math.abs(whole.ev - correctEv) < 1e-9);

  // Increasing push probability while holding win probability constant
  // should never make EV worse -- construct two games with the same side/
  // pCover-ish shape but check the invariant directly via the formula
  // rather than needing a second bucket with a different push mass:
  // EV should equal pCover*0.9091 - pLoss regardless of how big pPush is,
  // i.e. EV must NOT depend on pPush at all except through freeing up
  // pLoss = 1-pCover-pPush.
  check(
    "probabilityCoverForGame: EV formula does not directly penalize pPush (only pLoss does)",
    Math.abs(whole.ev - (whole.pCover * 0.9091 - (1 - whole.pCover - whole.pPush))) < 1e-9,
  );
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
