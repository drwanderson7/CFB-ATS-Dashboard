// Regression for Drew's Sept 8, 2026 report: "after loading predictions
// the edge gets populated and then each game row becomes tall again...
// it seems like the edge section is too tall." edgeExtrasHTML()'s
// key-number/model-agreement badges used to render in a plain, block-level
// <div class="edge-extras"> placed AFTER the pick-side+pill spans inside
// td.edge -- always forcing its own line below them, the same
// "unconditional extra line" pattern already fixed for the Game column's
// kickoff-time line earlier today. Wrapped everything in one .edge-flex
// flex container instead, so the badges tuck onto the end of the same
// line whenever there's room. Same "structural, not full DOM execution"
// pattern as test_board_team_display_name.mjs / test_board_kick_inline.mjs.
//
// Run with:
//     node tests/test_edge_flex_inline.mjs
import fs from "node:fs";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- board.js: edgeCellRender() wraps everything in one .edge-flex ---
const edgeCellRenderIdx = board.indexOf("function edgeCellRender(e,g){");
check("edgeCellRender() is defined", edgeCellRenderIdx !== -1);

const htmlLineMatch = board.match(/const html=`<div class="edge-flex">.*?`;/s);
check("edgeCellRender()'s html wraps its content in <div class=\"edge-flex\">, not bare spans directly inside td.edge",
  htmlLineMatch !== null);
if (htmlLineMatch) {
  const line = htmlLineMatch[0];
  const pickSideIdx = line.indexOf('class="pick-side"');
  const pillIdx = line.indexOf('class="pill"');
  const extrasCallIdx = line.indexOf("edgeExtrasHTML(e,g)");
  check("pick-side span, pill span, and edgeExtrasHTML()'s badges are all inside that SAME .edge-flex wrapper, in that order",
    pickSideIdx !== -1 && pillIdx !== -1 && extrasCallIdx !== -1
    && pickSideIdx < pillIdx && pillIdx < extrasCallIdx);
  check(".edge-flex div is properly closed (no unclosed tag leaking the badges outside the flex container)",
    line.trim().endsWith("</div>`;"));
}

// The old structure -- bare spans as direct children of td.edge, with
// edgeExtrasHTML()'s <div class="edge-extras"> as a later sibling rather
// than nested inside a shared flex wrapper -- must be genuinely gone.
check("the old bare-spans-then-sibling-div structure no longer exists",
  !board.includes('const html=`<span class="pick-side"'));

// --- CSS: .edge-flex is a real flex container that wraps, and .edge-extras
// becomes transparent to it (display:contents) so badges join it directly ---
check(".edge-flex is a flex container with flex-wrap:wrap (badges tuck onto the same line, dropping to their own only when out of room)",
  /\.edge-flex\{display:flex;[^}]*flex-wrap:wrap/.test(css));
check(".edge-flex .edge-extras is display:contents -- the existing .edge-extras div (still used as-is elsewhere, e.g. Snapshot's signal-td column) becomes a pass-through here, so its badge children become direct flex items of .edge-flex",
  /\.edge-flex \.edge-extras\{display:contents;\}/.test(css));

// The base .edge-extras rule itself (used by Snapshot's signal-td column,
// which does NOT sit inside .edge-flex) must be untouched by this change --
// only board's usage should get the pass-through treatment.
check(".edge-extras' own base rule (Snapshot's signal-td column relies on this) is unchanged -- still a real flex box on its own, not display:contents globally",
  /\.edge-extras\{display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;\}/.test(css));
check(".signal-td .edge-extras' vertical-stack override (unrelated to this fix) is still present and untouched",
  /\.signal-td \.edge-extras\{flex-direction:column;align-items:flex-start;gap:4px;\}/.test(css));

// --- td.edge no longer forces everything onto one unbreakable line ---
check("td.edge's own white-space:nowrap is gone -- .edge-flex's flex-wrap now governs wrapping instead of the cell forcing one unbreakable line",
  !/td\.edge\{text-align:right;white-space:nowrap/.test(css));

// --- Mobile: the flex/wrap properties moved from td.edge onto .edge-flex,
// since td.edge now has only one child (.edge-flex) instead of three ---
check("mobile's .board td.edge override no longer sets display:flex itself (that would now only apply to a single child, .edge-flex, not lay out pick-side/pill/badges directly)",
  !/\.board td\.edge\{display:flex/.test(css));
check("mobile instead applies flex-wrap/align-items/justify-content/gap to .board .edge-flex",
  /\.board \.edge-flex\{flex-wrap:wrap;align-items:baseline;justify-content:center;gap:3px 7px/.test(css));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
