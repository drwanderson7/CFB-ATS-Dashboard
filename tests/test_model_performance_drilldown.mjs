import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

// Drew's ask: "I wish I was able to see each model's game-by-game
// results" -- the Model Performance table only ever showed an aggregate
// ATS record per model. This adds a click-to-expand drill-down on each
// row listing every graded game that fed that model's record, honoring
// whatever season/week filter is already applied to the aggregate above
// it.

const src = fs.readFileSync(new URL("../app/js/record.js", import.meta.url), "utf8");

const context = {
  console, Math, Date, Number, String, Array, Object, Set, JSON,
  state: { enabledSystems: [] },
  esc: s => String(s ?? ""),
  fmt: n => (n == null ? "—" : (n > 0 ? "+" : "") + Number(n).toFixed(1)),
  MODEL_PERF_PICKGAUGE_CODE: "pickgauge",
  PRED_SYSTEMS: [{ code: "sag", name: "Sagarin Ratings" }],
  PRED_NAME: { sag: "Sagarin Ratings" },
};
vm.createContext(context);
vm.runInContext(src, context, { filename: "record.js" });

// --- recordModelPerfGameRowsHTML() itself -----------------------------
context.rows = [
  { code: "sag", g: { matchup: "UMass @ Rutgers", startDate: "2026-09-03T22:00:00Z", home: "Rutgers", away: "UMass" }, pred: -21.4, market: -24.5, result: "L", side: "home", pickedLine: -24.5, edge: 3.1 },
  { code: "sag", g: { matchup: "Ball State @ Ohio State", startDate: "2026-09-05T16:30:00Z", home: "Ohio State", away: "Ball State" }, pred: -55.9, market: -50.5, result: "W", side: "home", pickedLine: -50.5, edge: 5.4 },
  { code: "sag", g: { matchup: "Pending Game", startDate: "2026-09-06T16:30:00Z", home: "X", away: "Y" }, pred: -3, market: -2.5, result: null, side: "home", pickedLine: -2.5, edge: 0.5 },
  { code: "other-model", g: { matchup: "Should Not Appear", startDate: "2026-09-05T16:30:00Z" }, pred: 1, market: 1, result: "W", side: "home", pickedLine: 1, edge: 0 },
];

const html = vm.runInContext("recordModelPerfGameRowsHTML('sag', rows)", context);

assert.ok(html.includes("UMass @ Rutgers"), "a graded game for this model should appear");
assert.ok(html.includes("Ball State @ Ohio State"), "a second graded game for this model should appear");
assert.ok(!html.includes("Should Not Appear"), "a different model's game must not leak into this model's drill-down");
assert.ok(!html.includes("Pending Game"), "an ungraded (still-pending) game must not appear -- no result to show yet");
assert.ok(html.includes(">L<") || html.includes(">L</span>"), "the loss result should render");
assert.ok(html.includes(">W<") || html.includes(">W</span>"), "the win result should render");
assert.ok(html.includes("grid-column:1/-1"), "the drill-down spans the full table width, not one grid cell");

// Sort order: most recent game first.
const rutgersIdx = html.indexOf("UMass @ Rutgers");
const ohioIdx = html.indexOf("Ball State @ Ohio State");
assert.ok(ohioIdx < rutgersIdx, "most recent game (Sep 5) should list before an older one (Sep 3)");

// Empty state: no graded games at all for a model in this filter scope.
const emptyHtml = vm.runInContext("recordModelPerfGameRowsHTML('nonexistent-code', rows)", context);
assert.ok(emptyHtml.includes("No graded games"), "a model with zero graded games in scope gets an explicit empty state, not a blank table");

// --- wiring: expand state persists across a re-render (Set-based, same
//     pattern as recordExpandedBoxScores) ------------------------------
assert.match(src, /let recordExpandedModelPerf=new Set\(\);/);
assert.match(src, /data-model-perf-toggle="\$\{esc\(s\.code\)\}"/);
assert.match(src, /wrap\.querySelectorAll\("\[data-model-perf-toggle\]"\)\.forEach\(b=>b\.onclick=\(\)=>\{/);
assert.match(src, /if\(recordExpandedModelPerf\.has\(code\)\) recordExpandedModelPerf\.delete\(code\);/);

// --- the aggregate table actually calls the drill-down and passes the
//     SAME rows the aggregate itself was built from (a.rows), i.e. the
//     same season/week filter already applied above -- not a fresh,
//     unfiltered pull ---------------------------------------------------
assert.match(src, /recordModelPerfGameRowsHTML\(s\.code,a\.rows\)/);
assert.match(src, /systems,rows,/, "modelPerformanceAnalytics() must expose its own filtered rows for the drill-down to reuse, not force a second computation");

// --- accessibility: a real <button>, not a styled div, with aria-expanded
assert.match(src, /<button type="button" class="model-perf-row/);
assert.match(src, /aria-expanded="\$\{expanded\?'true':'false'\}"/);

console.log("Model Performance drill-down tests passed");
