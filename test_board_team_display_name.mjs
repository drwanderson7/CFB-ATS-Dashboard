// Regression for Drew's Sept 8, 2026 request: Pick/Edge Board rows shouldn't
// spend row height on mascots ("Miami Hurricanes", "Florida A&M Rattlers")
// when CFBD's own "school" field already gives a mascot-free name ("Miami",
// "Florida A&M") that fits pick buttons onto fewer lines.
//
// Same "structural, not full DOM execution" reasoning as
// test_board_cfbd_dropdown_logic.mjs: renderBoard() has heavy DOM/state
// dependencies that would be disproportionate to mock just for this. What's
// worth pinning down here specifically: the display name genuinely prefers
// the CFBD school field, falls back to the raw Odds API name when CFBD
// identity hasn't resolved for a team, is computed once per row (not
// inlined redundantly), and is what actually reaches both the pick buttons
// and the logo cells' alt text.
//
// Run with:
//     node tests/test_board_team_display_name.mjs
import fs from "node:fs";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

check("awayDisplayName prefers g.cfbdAwaySchool (CFBD's mascot-free school name), falling back to the raw Odds API g.away",
  board.includes("const awayDisplayName=g.cfbdAwaySchool||g.away;"));
check("homeDisplayName prefers g.cfbdHomeSchool, falling back to the raw Odds API g.home",
  board.includes("const homeDisplayName=g.cfbdHomeSchool||g.home;"));

check("the away pick button renders awayDisplayName (escaped), not the raw mascot-carrying g.away",
  board.includes('${awayLogoHTML}${esc(awayDisplayName)}<span class="tp-line">'));
check("the home pick button renders homeDisplayName (escaped), not the raw mascot-carrying g.home",
  board.includes('${homeLogoHTML}${esc(homeDisplayName)}<span class="tp-line">'));

check("the away logo cell's alt text uses the same short display name as its pick button (no mismatched name between the two)",
  board.includes('alt="${esc(awayDisplayName)} logo"'));
check("the home logo cell's alt text uses the same short display name as its pick button",
  board.includes('alt="${esc(homeDisplayName)} logo"'));

// Display names are computed once, right alongside the logo HTML they sit
// next to in the row -- not recomputed per-cell, which would risk the two
// spots (button vs. alt text) silently drifting apart in a future edit.
const displayNameIdx = board.indexOf("const awayDisplayName=g.cfbdAwaySchool||g.away;");
const buttonIdx = board.indexOf('${awayLogoHTML}${esc(awayDisplayName)}<span class="tp-line">');
const altIdx = board.indexOf('alt="${esc(awayDisplayName)} logo"');
check("awayDisplayName is declared before both the button markup and the logo-cell alt text that consume it",
  displayNameIdx !== -1 && displayNameIdx < buttonIdx && displayNameIdx < altIdx);

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
