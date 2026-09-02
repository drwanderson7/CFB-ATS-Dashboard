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
const ctx = { state: { strongThresh: 3, goodThresh: 1.5 }, Number };
vm.createContext(ctx);
vm.runInContext(extractFunction("edgeClass", modelSrc), ctx);
vm.runInContext(extractFunction("edgeTierLabel", modelSrc), ctx);

check("an edge at the strong threshold (3.0) is 'Strong'", ctx.edgeTierLabel(3) === "Strong");
check("an edge above the strong threshold is 'Strong'", ctx.edgeTierLabel(7.4) === "Strong");
check("an edge just below the strong threshold is 'Good', not 'Strong'", ctx.edgeTierLabel(2.9) === "Good");
check("an edge at the good threshold (1.5) is 'Good'", ctx.edgeTierLabel(1.5) === "Good");
check("an edge just below the good threshold is 'Slim', not 'Good'", ctx.edgeTierLabel(1.4) === "Slim");
check("a near-zero edge is 'Slim' -- the whole point, since this used to be presented identically to a real edge",
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

// --- BOTH Board render paths emit the label ------------------------------
const tierEmits = [...boardSrc.matchAll(/class="edge-tier \$\{edgeClass\(e\.pts\)\}"/g)];
check("Board emits the tier label from BOTH render paths (initial render + the live-update path used on every line/My Numbers edit)",
  tierEmits.length === 2);
check("both Board tier emissions are guarded on a real lean existing (e && e.team), so 'no lean' rows get no tier word",
  (boardSrc.match(/\(e&&e\.team\)\?`<span class="edge-tier/g) || []).length === 2);

// --- column header no longer overstates ----------------------------------
check("the Edge column header reads 'Edge — lean', not 'Edge — pick' (the board reports a model lean; it does not tell you what to bet)",
  boardSrc.includes('sortHeaderHTML("edge","Edge — lean"') && !boardSrc.includes('"Edge — pick"'));
check("the static fallback <th> in index.html matches the JS-rendered header",
  html.includes("<th>Edge — lean</th>") && !html.includes("<th>Edge — pick</th>"));

// --- one vocabulary everywhere -------------------------------------------
check("the board legend uses the same strong/good/slim words as the cells, not the old strong/edge/no-edge set",
  html.includes(">good</span>") && html.includes(">slim</span>")
  && !html.includes(">no edge</span>"));
check("the 'How this works' explainer tells the user what Slim actually means",
  html.includes("<b>Slim</b> means the model and the market barely disagree"));

// --- styling exists and is tier-colored ----------------------------------
check("the tier label has real styling", css.includes(".edge-tier{"));
check("the tier label is colored per tier, matching its cell", 
  css.includes("td.edge.gd .edge-tier") && css.includes("td.edge.g .edge-tier") && css.includes("td.edge.r .edge-tier"));
check("the mobile flex edge cell gives the tier label its own full-width line (display:block alone does nothing inside a flex row)",
  css.includes(".board .edge .edge-tier{flex:0 0 100%"));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
