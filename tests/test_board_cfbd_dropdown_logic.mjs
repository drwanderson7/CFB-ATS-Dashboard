// Structural tests for the Edge Board's new "Matchup breakdown" per-game
// dropdown (ratings + Matchup Intelligence), added alongside the
// Snapshot-only version those panels already had.
//
// Same "structural, not full DOM execution" reasoning already established
// for the mobile nav hamburger and Pools-row dropdowns this session:
// renderBoard() is a large function with heavy DOM/state dependencies
// (boardHeadRow/boardBody/boardEmpty/dataBadge/alignFilterWrap, `games`,
// `state`, pool context, etc.) -- fully mocking that just to prove this
// one addition is disproportionate, and the underlying panel functions
// themselves (cfbdRatingsPanelHTML()/cfbdMatchupPanelHTML()) are already
// independently tested in test_cfbd_insights_logic.mjs. What's worth
// pinning down here specifically: the toggle is wired correctly, its
// label is genuinely visible text (not an icon alone -- the actual
// request was "make the dropdown button obvious"), the detail row's
// colspan is computed exactly rather than guessed, and the CSS backs up
// the "obvious" claim with real visual weight, not just a comment saying so.
//
// Run with:
//     node tests/test_board_cfbd_dropdown_logic.mjs
import fs from "node:fs";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- State tracking ----------------------------------------------------
check("board.js declares boardExpandedKeys as a Set (mirrors snapExpandedKeys' own ephemeral-UI-state pattern)",
  /const boardExpandedKeys=new Set\(\)/.test(board));
check("boardExpandedKeys is declared OUTSIDE renderBoard() (module-level), so a re-render doesn't collapse an already-open dropdown",
  (() => {
    const declIdx = board.indexOf("const boardExpandedKeys=new Set()");
    const fnIdx = board.indexOf("function renderBoard()");
    return declIdx !== -1 && fnIdx !== -1 && declIdx < fnIdx;
  })());

// --- The button itself: genuinely visible text in BOTH states ----------
check("collapsed-state button label is real visible text ('Matchup breakdown'), not an icon alone -- the actual request was to make this obvious",
  /boardExpanded\?'▴ Hide matchup breakdown':'▾ Matchup breakdown'/.test(board));
check("the toggle carries aria-expanded, reflecting real open/closed state (not just a visual-only affordance)",
  /aria-expanded="\$\{boardExpanded\?'true':'false'\}"/.test(board));
check("the toggle gets an 'open' class when expanded, for the CSS to visually distinguish state (checked below too)",
  /class="board-cfbd-toggle\$\{boardExpanded\?' open':''\}"/.test(board));

// --- Detail row: exact colspan, not a guessed/hardcoded number ---------
check("totalCols is computed from the REAL rendered header column count (headRow.children.length), not a hardcoded guess that could drift as BP/Comp/sys-columns/CLV visibility changes",
  /const totalCols=headRow\?headRow\.children\.length:/.test(board));
check("the detail row's colspan actually uses totalCols, not a different/hardcoded value",
  /<td colspan="\$\{totalCols\}">/.test(board));

// --- Detail row: wired to the SAME already-tested panel functions ------
check("the Board detail row calls cfbdRatingsPanelHTML(g), the same function Snapshot's own detail row uses (not a reimplementation)",
  /const ratingsHTML=\(typeof cfbdRatingsPanelHTML==="function"\)\?cfbdRatingsPanelHTML\(g\):""/.test(board));
check("the Board detail row calls cfbdMatchupPanelHTML(g), the same function Snapshot's own detail row uses (not a reimplementation)",
  /const matchupHTML=\(typeof cfbdMatchupPanelHTML==="function"\)\?cfbdMatchupPanelHTML\(g\):""/.test(board));
check("the detail row is only built when boardExpanded is true (not unconditionally, which would render a hidden row's worth of markup for every single game on the board every time)",
  /if\(boardExpanded\)\{[\s\S]{0,50}const ratingsHTML=/.test(board));
check("an empty-context game shows an honest explanatory note rather than an empty box (same discipline as Matchup Intelligence's own preseason empty-state fix)",
  /No matchup breakdown available for this game yet/.test(board));

// --- Click wiring: toggles the Set, then re-renders ---------------------
check("[data-board-expand] click handler toggles the key in boardExpandedKeys (add if absent, delete if present)",
  /if\(boardExpandedKeys\.has\(key\)\) boardExpandedKeys\.delete\(key\); else boardExpandedKeys\.add\(key\);/.test(board));
check("the click handler calls renderBoard() after toggling, so the new state actually shows up",
  /boardExpandedKeys\.(add|delete)\(key\);\s*\n\s*renderBoard\(\);/.test(board));
check("the click wiring lives inside bindRowInputs(), which renderBoard() itself calls at the end of every render -- so a fresh row's toggle button is rebound every time (same pattern already relied on for the shortlist toggle and pick buttons)",
  (() => {
    const bindStart = board.indexOf("function bindRowInputs()");
    const wireIdx = board.indexOf('querySelectorAll("[data-board-expand]")');
    const bindEnd = board.indexOf("\n}", wireIdx);
    return bindStart !== -1 && wireIdx > bindStart && wireIdx < bindEnd;
  })());

// --- CSS: "obvious" is backed by real visual weight, not just a comment ---
const cssBlockMatch = html.match(/\.board-cfbd-toggle\{[^}]*\}/);
check("app/index.html defines .board-cfbd-toggle's base style",
  cssBlockMatch !== null);
if (cssBlockMatch) {
  const css = cssBlockMatch[0];
  check(".board-cfbd-toggle has a real, non-transparent background (a filled pill, not a bare icon-style button like .shortlist-toggle's own transparent background)",
    !/background:transparent/.test(css) && /background:#/.test(css));
  check(".board-cfbd-toggle has a visible border (further distinguishes it from plain inline text)",
    /border:1px solid/.test(css));
  check(".board-cfbd-toggle uses bold text weight, reinforcing that this is meant to be noticed, not blend into the row",
    /font-weight:700/.test(css));
}
check("app/index.html defines a distinct .open state for the toggle (visually confirms expanded vs collapsed, not just the label text change)",
  /\.board-cfbd-toggle\.open\{/.test(html));
check("app/index.html styles tr.board-detail-row distinctly (matches the existing tr.detail-row treatment used for Snapshot's own detail rows, for visual consistency)",
  /tr\.board-detail-row\{/.test(html) && /tr\.board-detail-row td\{/.test(html));

console.log(failures.length ? `\n${failures.length} of ${total} FAILURE(S):` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
