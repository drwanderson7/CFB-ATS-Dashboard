// Regression coverage for the mobile CSS-grid row layout of the Edge
// Board's stacked per-game "card" (each <tr> becomes a CSS grid via
// display:grid on mobile; every <td> gets an explicit grid-row so it lands
// in the right spot -- see app/css/app.css's own comments on this pattern).
//
// Real bug this pins: when My Blend (Option 2, Sept 1 2026) was added, its
// new .myblend-cell was given the SAME grid-row as the pre-existing
// .board-cfbd-toggle-cell ("Matchup breakdown" button) -- both grid-row:5.
// On a real mobile render this put the My Blend value directly on top of
// the Matchup breakdown button, the two literally overlapping and both
// partially unreadable. Caught by an actual screenshot at 390px, not by
// reading the CSS -- this test exists so the same collision can be caught
// by `scripts/test_all.sh` next time without needing a screenshot to
// notice it.
//
// This is a source-assertion test (not vm-executed) because CSS grid-row
// resolution is a real-layout-engine concern -- there's no meaningful way
// to "run" a CSS file in a vm context. Pinning that no two mobile .board
// td rules share a grid-row is the fast, no-browser proxy; the real-render
// verification lives in the E2E mobile suite (tests/test_e2e_mobile_ux.py).
import fs from "node:fs";

const css = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// Extract just the mobile media-query block containing the .board grid
// rules, so this test can't accidentally match a desktop rule or an
// unrelated .board declaration elsewhere in the file.
// Anchor: the start of the mobile card-grid block. (It used to be the
// `.board td.game{grid-column:2/6;grid-row:1;...}` rule, but the Sept 23
// phone-row compaction re-places td.game later in the file, which made that
// first rule fully dead, so scripts/build/css-audit.mjs removed it. td.game's
// placement is now covered by tests/test_e2e_mobile_compact_rows.py, which
// measures the rendered layout.)
const mobileBlockStart = css.indexOf(".board tr{\n      display:grid;\n      grid-template-columns:60px repeat(4,1fr) 60px;");
if (mobileBlockStart < 0) throw new Error("couldn't find the mobile .board grid rules -- app.css structure changed");
const mobileBlock = css.slice(mobileBlockStart, mobileBlockStart + 9000);

// Pull every "<selector>{grid-row:N" pair inside that block.
const rowAssignments = [...mobileBlock.matchAll(/\.board\s+(td\.[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)?)\{[^}]*grid-row:(\d+)/g)]
  .map(m => ({ selector: m[1], row: Number(m[2]) }));

check("found real grid-row assignments to check (sanity check the extraction itself worked)", rowAssignments.length >= 5);

// Full-width rows (grid-column: 2/6, spanning the whole card) can never
// coexist on the same grid-row without overlapping -- that's the exact bug
// class this test pins. Cells that share a column with something ELSE
// (e.g. veg-cell/myn-cell/prob-cell, which deliberately sit side-by-side
// in the same row 3) are a different, intentional pattern and excluded.
// td.game and the old full-width toggle cell are re-placed / hidden by the Sept 23 phone-row compaction block (checked below and in
// tests/test_e2e_mobile_compact_rows.py), so only the rows still assigned in this block are compared here.
const fullWidthSelectors = ["td.edge", "td.usernum-cell", "td.myblend-cell"];
const fullWidthRows = rowAssignments.filter(a => fullWidthSelectors.includes(a.selector));

check("every still-assigned full-width mobile card row (edge/usernum/myblend) was found in the CSS", fullWidthRows.length === fullWidthSelectors.length);

const rowCounts = {};
fullWidthRows.forEach(a => { rowCounts[a.row] = (rowCounts[a.row] || []).concat(a.selector); });
const collisions = Object.entries(rowCounts).filter(([row, sels]) => sels.length > 1);

check("no two full-width mobile card elements share the same grid-row (the exact overlap bug -- My Blend vs Matchup breakdown collided on grid-row:5 before this fix)",
  collisions.length === 0);
if (collisions.length) {
  collisions.forEach(([row, sels]) => console.log(`  COLLISION at grid-row:${row} -- ${sels.join(", ")}`));
}

// Pin the specific fix, not just the absence-of-collision property above --
// this is what actually keeps a future edit from quietly reintroducing the
// same bug via some other row number.
const byRow = Object.fromEntries(fullWidthRows.map(a => [a.selector, a.row]));
check("My Blend's row comes after My Numbers' row (stacks below it, matching visual order: numbers, then blend, then the toggle)",
  byRow["td.usernum-cell"] < byRow["td.myblend-cell"]);
check("the phone-row compaction block re-places td.game (card first, pick buttons second) and hides the old full-width toggle cell (its Why? now lives in the card)",
  css.includes(".board td.game{grid-column:1/7;grid-row:2;") && css.includes(".board td.board-cfbd-toggle-cell{display:none!important;}"));

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) {
  console.log("FAILED:");
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
