// Entry correlation math (Oct 1, 2026). Runs the REAL extracted functions from
// app/js/survivor-integration.js and the REAL portfolio engine from
// app/survivor-core/js/portfolio.js against hand-computed answers.
//
// Run with:  node tests/test_survivor_entry_correlation.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
const portfolio = await import("../app/survivor-core/js/portfolio.js");
function fn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`missing ${name}()`);
  let i = src.indexOf("{", start), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(["pgSurvivorEntryWeekSets", "pgSurvivorEntryCorrelation", "pgSurvivorSharedExposure", "pgSurvivorAllSurviveProbability", "pgSurvivorSavedPicksPortfolio", "pgSurvivorCorrCellStyle"].map(fn).join("\n"), ctx);
const J = (v) => JSON.parse(JSON.stringify(v));

let fail = 0, total = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) fail++; };
const near = (a, b, t = 1e-9) => Math.abs(a - b) < t;
const E = (id, name, picks) => ({ id, name, picks });

// ---- similarity: the basics
{
  const a = E("a", "A", { 1: "Alabama", 2: "Georgia", 3: "LSU" });
  const same = E("b", "B", { 1: "Alabama", 2: "Georgia", 3: "LSU" });
  const none = E("c", "C", { 1: "Texas", 2: "Utah", 3: "Ohio State" });
  const swapped = E("d", "D", { 1: "Georgia", 2: "LSU", 3: "Alabama" }); // same teams, never the same week
  const r = ctx.pgSurvivorEntryCorrelation([a, same, none, swapped], 1);
  check("identical entries: 100% same picks and 100% same teams", r.cells[0][1].samePick === 1 && r.cells[0][1].sameTeams === 1);
  check("completely different entries: 0% on both", r.cells[0][2].samePick === 0 && r.cells[0][2].sameTeams === 0);
  check("same teams in different weeks: 0% same picks but 100% same teams (the whole point of having both)", r.cells[0][3].samePick === 0 && r.cells[0][3].sameTeams === 1);
  check("matrix is symmetric", r.cells[1][0].samePick === r.cells[0][1].samePick && r.cells[3][0].sameTeams === r.cells[0][3].sameTeams);
  check("diagonal is empty", r.cells[2][2] === null);
  check("shared picks are listed with week and team", J(r.cells[0][1].sharedPicks).length === 3 && r.cells[0][1].sharedPicks[0].week === 1 && r.cells[0][1].sharedPicks[0].team === "Alabama");
}

// ---- partial overlap, hand-computed
{
  // A: W1 Alabama, W2 Georgia, W3 LSU, W4 Texas ; B: W1 Alabama, W2 Utah, W3 LSU, W4 Ohio State
  // Distinct (week, team) picks: W1 {Alabama}=1, W2 {Georgia,Utah}=2, W3 {LSU}=1, W4 {Texas,Ohio State}=2 -> 6.
  // Identical picks: Alabama(W1), LSU(W3) = 2  ->  2/6 = 1/3.
  // Teams A {Alabama,Georgia,LSU,Texas}, B {Alabama,Utah,LSU,Ohio State}: shared 2, distinct 6 -> 1/3.
  const r = ctx.pgSurvivorEntryCorrelation([
    E("a", "A", { 1: "Alabama", 2: "Georgia", 3: "LSU", 4: "Texas" }),
    E("b", "B", { 1: "Alabama", 2: "Utah", 3: "LSU", 4: "Ohio State" }),
  ], 1);
  check("partial overlap: same-pick similarity = 2 shared / 6 distinct picks = 33.3%", near(r.cells[0][1].samePick, 1 / 3));
  check("partial overlap: same-team similarity = 2 shared / 6 distinct teams = 33.3%", near(r.cells[0][1].sameTeams, 1 / 3));
  check("shared teams are named and sorted", J(r.cells[0][1].sharedTeams).join() === "Alabama,LSU");
}

// ---- two-pick weeks (Kelly pools)
{
  // W1: A {Alabama,Georgia} vs B {Alabama,Texas}: shared 1, distinct 3.  W2: identical {LSU,Utah}: shared 2, distinct 2. => 3/5
  const r = ctx.pgSurvivorEntryCorrelation([
    E("a", "A", { 1: ["Alabama", "Georgia"], 2: ["LSU", "Utah"] }),
    E("b", "B", { 1: ["Alabama", "Texas"], 2: ["LSU", "Utah"] }),
  ], 1);
  check("two-pick pool: pooled over weeks = 3 shared / 5 distinct = 60%", near(r.cells[0][1].samePick, 0.6));
}

// ---- only weeks BOTH entries have picked are compared (planning depth is not penalized)
{
  const r = ctx.pgSurvivorEntryCorrelation([
    E("a", "A", { 1: "Alabama", 2: "Georgia", 8: "Texas", 9: "Utah" }),   // planned far ahead
    E("b", "B", { 1: "Alabama", 2: "Georgia" }),
  ], 1);
  check("an entry that planned ahead isn't penalized: identical in the 2 shared weeks = 100%", r.cells[0][1].samePick === 1 && r.cells[0][1].weeks === 2);
  const none = ctx.pgSurvivorEntryCorrelation([E("a", "A", { 1: "Alabama" }), E("b", "B", { 2: "Georgia" })], 1);
  check("no week in common: no number (not a fake 0%)", none.cells[0][1] === null && none.pairs.length === 0);
  const early = ctx.pgSurvivorEntryCorrelation([E("a", "A", { 1: "Alabama", 3: "LSU" }), E("b", "B", { 1: "Texas", 3: "LSU" })], 3);
  check("weeks before the pool's start week are ignored", early.cells[0][1].weeks === 1 && early.cells[0][1].samePick === 1);
}

// ---- summary callouts
{
  const r = ctx.pgSurvivorEntryCorrelation([
    E("a", "My Entry", { 1: "Alabama", 2: "Georgia", 3: "LSU" }),
    E("b", "Entry 2", { 1: "Alabama", 2: "Georgia", 3: "Texas" }),
    E("c", "Entry 3", { 1: "Utah", 2: "Ohio State", 3: "LSU" }),
  ], 1);
  check("most alike pair is the one with the highest same-pick score (My Entry & Entry 2)", r.mostAlike.a === "My Entry" && r.mostAlike.b === "Entry 2");
  check("most different pair is the lowest (Entry 2 & Entry 3: 0 shared)", r.mostDifferent.a === "Entry 2" && r.mostDifferent.b === "Entry 3" && r.mostDifferent.samePick === 0);
  check("average over the 3 pairs is computed", near(r.avgSamePick, (r.pairs.reduce((s, p) => s + p.samePick, 0)) / 3));
  check("'used by every entry' lists only teams ALL entries have used (none here)", r.everyEntry.length === 0);
  const all = ctx.pgSurvivorEntryCorrelation([E("a", "A", { 1: "Alabama", 2: "LSU" }), E("b", "B", { 1: "LSU", 2: "Alabama", 3: "Utah" })], 1);
  check("'used by every entry' ignores which week: Alabama and LSU are in both", J(all.everyEntry).join() === "Alabama,LSU");
  const single = ctx.pgSurvivorEntryCorrelation([E("a", "A", { 1: "Alabama" })], 1);
  check("one entry: no pairs, no crash", single.pairs.length === 0 && single.mostAlike === null);
}

// ---- cell colors
check("heat color scales with similarity and is empty for no data", ctx.pgSurvivorCorrCellStyle(0).includes("0.05") && ctx.pgSurvivorCorrCellStyle(1).includes("0.55") && ctx.pgSurvivorCorrCellStyle(null) === "");

// ---- shared pending exposure
{
  const matchups = {
    "6|Northwestern": { opponent: "Penn State", winProbability: 0.62, completed: false },
    "6|Arizona State": { opponent: "Baylor", winProbability: 0.71, completed: false },
    "5|Georgia": { opponent: "Vanderbilt", winProbability: 0.95, completed: false },
    "5|Kansas": { opponent: "X", winProbability: 0.8, completed: true },    // already played: resolved
  };
  const matchupFor = (team, week) => matchups[`${week}|${team}`] || null;
  const isResolved = (m) => m.completed === true;
  const entries = [
    E("a", "My Entry", { 5: ["Georgia", "Kansas"], 6: ["Northwestern", "Arizona State"] }),
    E("b", "Entry 2", { 5: ["Georgia", "Nebraska"], 6: ["Northwestern", "Arizona State"] }),
    E("c", "Entry 3", { 5: ["Indiana", "Kansas"], 6: ["Northwestern", "Utah"] }),
    E("d", "Dead", { 5: ["Georgia", "Kansas"], 6: ["Northwestern", "Arizona State"] }),
  ];
  const r = J(ctx.pgSurvivorSharedExposure(entries, { startWeek: 1, isAlive: (e) => e.id !== "d", matchupFor, isResolved }));
  const nw = r.rows.find((x) => x.team === "Northwestern"), asu = r.rows.find((x) => x.team === "Arizona State"), geo = r.rows.find((x) => x.team === "Georgia");
  check("eliminated entries are not counted as alive or as exposed", r.aliveTotal === 3 && nw.count === 3 && nw.entries.join() === "My Entry,Entry 2,Entry 3");
  check("Northwestern W6 rides on 3 of 3 live entries, win 62%", nw.aliveTotal === 3 && near(nw.p, 0.62) && nw.opponent === "Penn State");
  check("Arizona State W6 is shared by 2 entries; Georgia W5 by 2", asu.count === 2 && geo.count === 2);
  check("a pick that has already been decided is not an exposure (Kansas W5)", !r.rows.some((x) => x.team === "Kansas"));
  check("picks only ONE entry made are not listed (Utah, Indiana, Nebraska)", !r.rows.some((x) => ["Utah", "Indiana", "Nebraska"].includes(x.team)));
  check("sorted by how many entries depend on it, then week", r.rows[0].team === "Northwestern" && r.rows.length === 3);
  const none = J(ctx.pgSurvivorSharedExposure([E("a", "A", { 6: ["Utah"] }), E("b", "B", { 6: ["Texas"] })], { startWeek: 1, matchupFor, isResolved }));
  check("no shared pending pick -> no rows", none.rows.length === 0);
}

// ---- portfolio odds, checked against hand math and the REAL engine
{
  const games = {
    "6|X": { gameId: 1, opponent: "x", winProbability: 0.8, completed: false },
    "6|Y": { gameId: 2, opponent: "y", winProbability: 0.6, completed: false },
    "6|P": { gameId: 3, opponent: "Q", winProbability: 0.7, completed: false },
    "6|Q": { gameId: 3, opponent: "P", winProbability: 0.3, completed: false },
  };
  const matchupFor = (t, w) => games[`${w}|${t}`] || null;
  const opts = { startWeek: 1, matchupFor, isResolved: (m) => m.completed, portfolioApi: portfolio };
  // Two entries on the SAME pick (X, .8): any = .8, all = .8, expected alive = 1.6
  let r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "X" }), E("b", "B", { 6: "X" })], opts));
  check("identical picks: P(at least one) = 80% (no diversification), P(all) = 80%, expected alive 1.6, all-out 20%",
    near(r.probabilityAny, 0.8) && near(r.probabilityAll, 0.8) && near(r.expectedAlive, 1.6) && near(r.allOut, 0.2));
  // Different games X(.8) and Y(.6): any = 1-(.2*.4) = .92 ; all = .48 ; expected = 1.4
  r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "X" }), E("b", "B", { 6: "Y" })], opts));
  check("independent games: any = 92%, all = 48%, expected 1.4", near(r.probabilityAny, 0.92) && near(r.probabilityAll, 0.48) && near(r.expectedAlive, 1.4));
  check("diversifying raised the chance of keeping at least one entry (92% vs 80%)", r.probabilityAny > 0.8);
  // Opposite sides of one game: P(.7) and Q(.3): exactly one wins -> any = 1.0, all = 0
  r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "P" }), E("b", "B", { 6: "Q" })], opts));
  check("opposite sides of one game: someone always survives (100%), but never both (0%)", near(r.probabilityAny, 1) && r.probabilityAll === 0);
  // skipped entries
  r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "X" }), E("b", "B", {}), E("c", "C", { 6: "Z" })], opts));
  check("an entry with no pending picks and one with an unknown win probability are reported, not guessed", r.entryCount === 1 && r.skipped.length === 2
    && r.skipped.some((s) => s.name === "B" && /no pending/.test(s.reason)) && r.skipped.some((s) => s.name === "C" && /probability/.test(s.reason)));
  r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "X" }), E("b", "B", { 6: "Y" })], { ...opts, isAlive: (e) => e.id === "a" }));
  check("eliminated entries are left out", r.entryCount === 1 && near(r.probabilityAny, 0.8));
  r = J(ctx.pgSurvivorSavedPicksPortfolio([E("a", "A", { 6: "X" })], { ...opts, portfolioApi: null }));
  check("if the core isn't available, the odds are blank instead of wrong", r.probabilityAny === null && r.allOut === null);
}

// ---- wiring
check("the History tab renders the correlation section right after Portfolio Strategy and before Entry comparison",
  /\$\{pgSurvivorPortfolioSectionHTML\(\)\}\s*\n\s*\$\{pgSurvivorEntryCorrelationSectionHTML\(pool\)\}\s*\n\s*<section class="survivor-history-section"><div class="survivor-history-section-head"><div><h3>Entry comparison/.test(src));
check("the section needs 2+ entries", /function pgSurvivorEntryCorrelationSectionHTML\(pool\)\{\s*const entries=pool\?\.entries\|\|\[\];\s*if\(entries\.length<2\)return '';/.test(src));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
