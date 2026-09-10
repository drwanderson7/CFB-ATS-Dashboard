// Regression coverage for edgeTierLabel() and its use on the Edge Board.
//
// The real problem this fixes: the Edge Board used to render EVERY game's
// lean identically -- same bold team name, same layout, under a column
// headed "Edge — pick" -- with background color as the ONLY signal that a
// 0.3-point edge (noise, below the 1.5 "good" threshold) was different from
// a 3.0-point one. Snapshot's Top Opportunities cards had labelled their
// tiers in words since they shipped, so the same number was described
// responsibly in one view and as a flat "pick" in the other.
//
// These checks pin: (1) the thresholds the tier words map to, (2) that
// Board and Snapshot share ONE implementation rather than two ternaries
// that can drift, (3) that BOTH Board render paths emit the label -- the
// initial render and the live-update path that runs on every My Numbers /
// manual line edit, where an omission would silently strip the label off
// exactly the rows a user just touched, and (4) that a genuine "no lean"
// carries no tier word, since there's no pick to rate.
// Regression coverage for edgeTierLabel()/edgeClass() (model.js, unchanged)
// and the Edge Board's OWN visual treatment (board.js), which no longer
// uses either for its per-row display.
//
// History: the Edge Board used to render every game's lean identically --
// same bold team name, same layout -- with background color as the ONLY
// signal that a 0.3-point edge (noise) was different from a 3.0-point one.
// The fix at the time was a text tier word ("Strong"/"Good"/"Slim") above
// the team name, shared with Snapshot's Top Opportunities cards via one
// function (edgeTierLabel()) so the two views could never drift.
//
// Sept 2026: Drew asked to remove that word from the Board specifically --
// a small edge isn't a warning, it's just not much of a signal, and a flat
// "Slim" (colored red-family) overstated that. Replaced with a continuous
// color gradient (edgeGradientColors() in board.js) instead of 3 fixed
// buckets, and the two stacked lines (tier word, then team+points) merged
// into one. edgeClass()/edgeTierLabel() themselves are UNCHANGED and still
// load-bearing elsewhere (Snapshot's Top Opportunities filter, PNG/CSV
// exports, My Numbers) -- this only changes what the Board itself renders.
//
// These checks pin: (1) the thresholds edgeTierLabel()/edgeClass() still
// map to, for everything that still depends on them, (2) that Snapshot
// still calls the shared helper rather than a local copy, (3) that the
// Board genuinely no longer emits the tier word or the old discrete
// gd/g/r classes anywhere (not orphaned dead markup), (4) that both Board
// render paths (initial + the live-update path used on every My Numbers/
// manual line edit) share ONE gradient implementation rather than two that
// could drift, and (5) the gradient function's own boundary behavior.
import fs from "node:fs";
import vm from "node:vm";

const modelSrc = fs.readFileSync(new URL("../app/js/model.js", import.meta.url), "utf8");
const boardSrc = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const snapshotSrc = fs.readFileSync(new URL("../app/js/snapshot-export.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}
function extractFunction(name, source) {
  const marker = `function ${name}(`, start = source.indexOf(marker);
  if (start < 0) throw new Error(`missing ${name}`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

// --- the tier boundaries themselves, run against the real function --------
// (edgeClass()/edgeTierLabel() are unchanged -- still real, still tested at
// the source of truth, since Snapshot/exports/filters still depend on them.)
const ctx = { state: { strongThresh: 3, goodThresh: 1.5 }, Number };
vm.createContext(ctx);
vm.runInContext(extractFunction("edgeClass", modelSrc), ctx);
vm.runInContext(extractFunction("edgeTierLabel", modelSrc), ctx);

check("an edge at the strong threshold (3.0) is 'Strong'", ctx.edgeTierLabel(3) === "Strong");
check("an edge above the strong threshold is 'Strong'", ctx.edgeTierLabel(7.4) === "Strong");
check("an edge just below the strong threshold is 'Good', not 'Strong'", ctx.edgeTierLabel(2.9) === "Good");
check("an edge at the good threshold (1.5) is 'Good'", ctx.edgeTierLabel(1.5) === "Good");
check("an edge just below the good threshold is 'Slim', not 'Good'", ctx.edgeTierLabel(1.4) === "Slim");
check("a near-zero edge is 'Slim' -- edgeClass()/edgeTierLabel() still see it as the weakest bucket, for filtering/export purposes",
  ctx.edgeTierLabel(0.3) === "Slim");
check("a zero edge is 'Slim'", ctx.edgeTierLabel(0) === "Slim");
check("tier words stay in lockstep with edgeClass()'s own tiers (gd/g/r), not a second independent threshold set",
  ctx.edgeTierLabel(3) === "Strong" && ctx.edgeClass(3) === "gd"
  && ctx.edgeTierLabel(1.5) === "Good" && ctx.edgeClass(1.5) === "g"
  && ctx.edgeTierLabel(0.3) === "Slim" && ctx.edgeClass(0.3) === "r");

// tiers must follow user-configured thresholds, not hardcoded 3/1.5
const custom = { state: { strongThresh: 5, goodThresh: 2 }, Number };
vm.createContext(custom);
vm.runInContext(extractFunction("edgeClass", modelSrc), custom);
vm.runInContext(extractFunction("edgeTierLabel", modelSrc), custom);
check("tier words respect the user's own configured thresholds rather than hardcoded defaults",
  custom.edgeTierLabel(3) === "Good" && custom.edgeTierLabel(5) === "Strong" && custom.edgeTierLabel(1.9) === "Slim");

// --- one shared implementation, not two drifting copies -------------------
check("edgeTierLabel() is defined once, in model.js next to edgeClass()",
  /function edgeTierLabel\(/.test(modelSrc));
check("Snapshot calls the shared helper instead of carrying its own inline tier ternary",
  snapshotSrc.includes("edgeTierLabel(e.pts)")
  && !snapshotSrc.includes('cls==="gd"?"Strong":cls==="g"?"Good":"Slim"'));
check("neither Board nor Snapshot redefines its own local edgeTierLabel()",
  !/function edgeTierLabel\(/.test(boardSrc) && !/function edgeTierLabel\(/.test(snapshotSrc));

// --- the Board genuinely does not use the tier word or old discrete classes,
//     anywhere -- not just "doesn't call edgeTierLabel()" but no orphaned
//     .edge-tier markup/CSS left behind either --------------------------
check("Board never emits a tier-word span at all (removed, not just unused)",
  !boardSrc.includes("edge-tier"));
check("Board's edge cell no longer applies the old discrete gd/g/r classes to the cell, pill, or pick-side",
  !/class="edge \$\{edge(?:Strength)?Class/.test(boardSrc)
  && !boardSrc.includes('class="pill ${edgeClass')
  && !boardSrc.includes('class="pick-side ${edgeClass'));
const desktopEdgeRenderSrc=extractFunction("edgeCellRender", boardSrc);
check("desktop Edge-cell rendering still does not use discrete tier words/classes (mobile decision summary may label strength separately)",
  !desktopEdgeRenderSrc.includes("edgeClass(e.pts)") && !desktopEdgeRenderSrc.includes("edgeTierLabel(e.pts)"));

// --- both Board render paths share ONE gradient implementation ------------
check("edgeGradientColors() (the continuous replacement) is defined once in board.js",
  (boardSrc.match(/function edgeGradientColors\(/g) || []).length === 1);
check("a single shared edgeCellRender() is used by BOTH the initial render and the live-update path -- not two copies that could drift",
  (boardSrc.match(/(?<!function )edgeCellRender\(e,g\)/g) || []).length === 2);

// --- edgeGradientColors()'s own boundary behavior --------------------------
const gradCtx = { state: { strongThresh: 3 }, Number, Math };
vm.createContext(gradCtx);
vm.runInContext(extractFunction("edgeGradientColors", boardSrc), gradCtx);
check("null/no edge gets no gradient color at all", gradCtx.edgeGradientColors(null) === null);
{
  const low = gradCtx.edgeGradientColors(0.3);
  const atStrong = gradCtx.edgeGradientColors(3);
  const wayAbove = gradCtx.edgeGradientColors(9);
  check("a sub-1pt edge is the fixed neutral gray (#EEF1F0), not part of the green ramp",
    low.bg === "#EEF1F0");
  check("an edge at strongThresh reaches the full-saturation dark green endpoint",
    atStrong.bg === "rgb(187,247,208)" && atStrong.fg === "rgb(22,101,52)");
  check("an edge well past strongThresh is capped at the same full-saturation color, not overshooting it",
    wayAbove.bg === atStrong.bg && wayAbove.fg === atStrong.fg);
  const mid = gradCtx.edgeGradientColors(2); // halfway between lo=1 and hi=3
  check("a mid-range edge is visibly distinct from both the gray floor and the full-green ceiling (a real gradient, not a third fixed bucket)",
    mid.bg !== low.bg && mid.bg !== atStrong.bg);
}

// --- column header no longer overstates ----------------------------------
check("the Edge column header reads 'Edge — lean', not 'Edge — pick' (the board reports a model lean; it does not tell you what to bet)",
  boardSrc.includes('sortHeaderHTML("edge","Edge — lean"') && !boardSrc.includes('"Edge — pick"'));
check("the static fallback Edge header remains present with contextual help",
  html.includes(">Edge — lean</th>") && !html.includes(">Edge — pick</th>"));

// --- the filter-bar legend (a separate element from the per-row label,
//     unaffected by removing the per-row text) still uses one vocabulary --
check("the board legend still uses strong/good/slim words for its color-swatch key, not the old strong/edge/no-edge set",
  html.includes(">good</span>") && html.includes(">slim</span>")
  && !html.includes(">no edge</span>"));
check("the Help glossary still tells the user what Slim actually means",
  html.includes("<b>Slim</b> means the model and the line barely disagree"));

// --- the old per-row tier CSS is actually gone, not just unused -----------
check("the old .edge-tier CSS rule is removed, not left as dead code", !css.includes(".edge-tier{"));
check("the old discrete td.edge.gd/.g/.r background rules are removed (color now comes from an inline style)",
  !css.includes("td.edge.gd{background") && !css.includes("td.edge.g{background") && !css.includes("td.edge.r{background"));
check("td.edge still has its rounded corners, now unconditionally rather than only on the gd/g/r modifier classes",
  /td\.edge\{[^}]*border-radius:8px/.test(css));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
