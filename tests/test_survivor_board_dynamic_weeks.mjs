// Season Board drops finished weeks automatically (Sept 23, 2026).
//
// Drew: "we are now to week 5 so I'm not concerned with wk 1-4 showing on
// the grid anymore." pgSurvivorBoardWeeks() (app/js/survivor-integration.js)
// is the pure decision; this runs the REAL extracted function.
//
// Run with:  node tests/test_survivor_board_dynamic_weeks.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
function extractFunction(name, source) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`missing ${name}()`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extractFunction("pgSurvivorBoardWeeks", src), ctx);
const W = (all, o) => JSON.parse(JSON.stringify(ctx.pgSurvivorBoardWeeks(all, o)));

let fail = 0, total = 0;
const check = (name, cond) => { total++; console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`); if (!cond) fail++; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const season = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];

let r = W(season, { startWeek: 1, actualWeek: 5, focusWeek: 5 });
check("current week 5: board shows W5-W13", eq(r.visible, [5, 6, 7, 8, 9, 10, 11, 12, 13]));
check("current week 5: W1-W4 reported as hidden past weeks", eq(r.hiddenPast, [1, 2, 3, 4]));

r = W(season, { startWeek: 1, actualWeek: 5, focusWeek: 5, showPast: true });
check("'Show finished weeks' brings W1-W4 back", eq(r.visible, season) && r.hiddenPast.length === 0);

r = W(season, { startWeek: 1, actualWeek: 5, focusWeek: 3 });
check("viewing a past week (W3) keeps it on the board: starts at W3", eq(r.visible.slice(0, 3), [3, 4, 5]) && eq(r.hiddenPast, [1, 2]));

r = W(season, { startWeek: 1, actualWeek: 5, focusWeek: 5, sortWeek: 2 });
check("sorting by a past week (W2) keeps that column visible", r.visible[0] === 2 && eq(r.hiddenPast, [1]));

r = W(season, { startWeek: 1, actualWeek: 1, focusWeek: 1 });
check("week 1: nothing hidden", eq(r.visible, season) && r.hiddenPast.length === 0);

r = W([1, 2, 3, 4, 5, 6], { startWeek: 2, actualWeek: 4, focusWeek: 4 });
check("pool starting Week 2 never shows W1, hides only its own finished weeks", eq(r.visible, [4, 5, 6]) && eq(r.hiddenPast, [2, 3]));

r = W(season, { startWeek: 1, actualWeek: 13, focusWeek: 13 });
check("final week: only W13 shown, 12 past hidden", eq(r.visible, [13]) && r.hiddenPast.length === 12);

r = W(season, { startWeek: 1, actualWeek: null, focusWeek: undefined });
check("no usable week info: show everything (never an empty board)", eq(r.visible, season));

r = W([], { startWeek: 1, actualWeek: 5 });
check("no weeks at all: empty, no crash", r.visible.length === 0 && r.hiddenPast.length === 0);

r = W(["5", "3", "4", "3"], { startWeek: 1, actualWeek: 4, focusWeek: 4 });
check("string/duplicate/unsorted week lists are normalized", eq(r.visible, [4, 5]) && eq(r.hiddenPast, [3]));

// Wiring
const render = extractFunction("pgSurvivorRenderBoard", src);
check("renderBoard builds its columns from pgSurvivorBoardWeekSet(), not raw data.weeks", render.includes("const weekSet=pgSurvivorBoardWeekSet(), weeks=weekSet.visible") && !/const weeks=data\.weeks/.test(render));
check("renderBoard shows a Show/Hide finished weeks toggle", render.includes('data-survivor-toggle-past="show"') && render.includes('data-survivor-toggle-past="hide"'));
const set = extractFunction("pgSurvivorBoardWeekSet", src);
check("anchor uses the core's current pool week, viewed week, and sorted week", set.includes("actualWeek:pgSurvivorActualWeek()") && set.includes("focusWeek:pgSurvivorFocusWeek()") && set.includes("sortWeek:"));
check("toggle state is per pool and device-local (survivor UI localStorage)", src.includes("showPastByPool:(raw.showPastByPool&&") && src.includes("u.showPastByPool[pid]=true"));
check("click handler wired for the toggle", src.includes("e.target.closest('[data-survivor-toggle-past]')"));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
