// Regression for Drew's Sept 8, 2026 follow-up request: after mascot names
// were stripped from Pick Board rows to save height, the kickoff
// time + rotation number line ("Sat, 11:00 AM CDT · Rot 331-332") was still
// forcing its own extra line below the "Matchup breakdown" toggle. Moved it
// to be a flex child of .matchup-picks (same row as the pick buttons/flag/
// toggle) so it sits to the right of the toggle on the same line whenever
// there's room, only wrapping onto its own line when genuinely out of
// width -- same "structural, not full DOM execution" pattern already
// established for test_board_cfbd_dropdown_logic.mjs and
// test_board_team_display_name.mjs.
//
// Run with:
//     node tests/test_board_kick_inline.mjs
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

// --- Structure: .kick lives INSIDE .matchup-picks now, after the toggle ---
const gameCellIdx = board.indexOf('<td class="game">');
check('board.js renders a .game cell', gameCellIdx !== -1);

const matchupPicksOpen = board.indexOf('<div class="matchup-picks">', gameCellIdx);
const toggleIdx = board.indexOf("board-cfbd-toggle-inline", matchupPicksOpen);
const kickIdx = board.indexOf('<div class="kick">', matchupPicksOpen);
const matchupPicksClose = board.indexOf("</div>", kickIdx);

check(".kick appears after the inline Matchup-breakdown toggle button in source order",
  toggleIdx !== -1 && kickIdx !== -1 && toggleIdx < kickIdx);
check(".kick is closed BEFORE .matchup-picks' own closing tag -- i.e. .kick is a CHILD of .matchup-picks, not a sibling after it (the old, taller layout)",
  kickIdx !== -1 && matchupPicksClose !== -1 && kickIdx < matchupPicksClose);
check("gameMetaStr(g) (kickoff + rotation text) is still what actually fills .kick",
  board.slice(kickIdx, kickIdx + 60).includes("${gameMetaStr(g)}"));

// --- The old taller structure (.kick as a sibling AFTER a closed
// .matchup-picks div) must be genuinely gone, not just also present ---
check("the old sibling-.kick pattern ('</div><div class=\"kick\">') no longer exists in board.js",
  !board.includes('</div><div class="kick">'));

// --- CSS: no longer relies on margin-top to visually separate .kick from
// the row above, since it now sits IN that row and .matchup-picks' own
// flex `gap` already spaces wrapped items consistently ---
const kickCssMatch = css.match(/(?<!\.board )\.kick\{[^}]*\}/);
check("base .kick CSS rule exists", kickCssMatch !== null);
if (kickCssMatch) {
  check(".kick no longer carries a manual margin-top (redundant now that it's a flex child of .matchup-picks, which already gaps wrapped items via its own `gap`)",
    /margin-top:0/.test(kickCssMatch[0]));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
