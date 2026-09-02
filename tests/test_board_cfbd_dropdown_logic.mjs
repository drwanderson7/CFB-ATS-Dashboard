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
const html = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8")
  // CSS moved out of index.html into app/css/app.css (Aug 28, pure file-
  // split, same "append the split-out file's content" fix this codebase
  // already established for the JS-splitting pass -- see readJsFile()'s
  // own comment in test_client_logic.mjs for the precedent).
  + fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

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

// --- Sort & filter panel layout (reported as clunky/unorganized) -------
// The two filter checkboxes used to be bare sibling <label> elements
// separated only by a collapsed HTML whitespace character -- no real gap
// system, and no vertical rhythm between that row and the legend row
// below it. Pins down the actual structural/CSS fix (verified visually
// via tests/_render_sort_filter_panel.py at both desktop and mobile
// widths) so a future edit can't silently unwrap the filters back into
// bare siblings without a test catching it.
check("the two board filter checkboxes are wrapped in a dedicated .board-sf-filters flex container, not left as bare whitespace-separated siblings",
  /<div class="board-sf-filters">[\s\S]*?id="alignFilterWrap"[\s\S]*?id="shortlistFilterWrap"[\s\S]*?<\/div>/.test(html));
check(".board-sf-filters defines its own flex gap (the actual fix -- consistent spacing instead of relying on collapsed HTML whitespace)",
  /\.board-sf-filters\{display:flex;flex-wrap:wrap;gap:8px;\}/.test(html));
check(".board-sf-panel's base panel body is a flex column with a real gap (the mobile/boxed layout -- desktop overrides this back to a row, see the min-width:721px checks below)",
  /\.board-sf-panel \.pred-panel-body\{display:flex;flex-direction:column;gap:10px;\}/.test(html));

// --- Desktop: no boxed/collapsible "dropdown" at all, just individual
// controls directly in the toolbar (second round of feedback -- the
// collapsible-panel treatment was specifically a MOBILE fix; desktop
// never needed it and having it looked like an unnecessary dropdown). ---
check("a min-width:721px query strips the card chrome (border/background/radius) from .board-sf-panel on desktop",
  /@media\(min-width:721px\)\{[\s\S]{0,400}\.board-sf-panel\{border:none;background:transparent;border-radius:0;margin:0;min-width:0;overflow:visible;\}/.test(html));
check("desktop hides the summary/title/collapse-arrow entirely (sortHeaderHTML()'s own ▲/▼ column-header arrow already shows the active sort, so this was redundant chrome)",
  /@media\(min-width:721px\)\{[\s\S]{0,600}\.board-sf-panel \.pred-summary\{display:none;\}/.test(html));
check("desktop forces the panel body to always render as a flat inline row (not dependent on the <details> open attribute, and not the mobile column layout)",
  /@media\(min-width:721px\)\{[\s\S]{0,900}\.board-sf-panel \.pred-panel-body\{display:flex !important;flex-direction:row;flex-wrap:wrap;align-items:center;gap:14px;padding:0;border-top:none;\}/.test(html));
check("mobile breakpoint (≤720px) still applies its own full-width override, so the desktop un-boxing doesn't leak into the mobile boxed/collapsible layout",
  /\.board-sf-panel\{width:100%;min-width:0;\}/.test(html));

// --- "Matchup breakdown" toggle: moved next to the shortlist flag ------
// Was its own far-right table column (Aug 20 fix -- see that CSS rule's
// own comment). Third round of feedback: on desktop this reads as
// disconnected, floating way out past Edge/Pick with a lot of empty
// space in between. Moved to sit right after the home-team-logo column
// (invisible/display:none on desktop -- see td.home-logo,th.logo-th),
// which visually lands it immediately next to the shortlist flag inside
// the Game cell, WITHOUT nesting it inside that cell -- nesting would
// have broken the Aug 20 mobile fix, since CSS grid-row/grid-column
// repositioning (used to move it after the stats row on mobile) only
// works on direct <tr> children. Verified structurally here (still its
// own <td>, just reordered) and visually via
// tests/_render_board_matchup_toggle_position.py, which also confirms
// the mobile grid position is byte-for-byte unchanged (row 4, col 2).
check("the header's Matchup-breakdown <th> now sits right after the home-team-logo <th>, before BP/Comp -- not at the end of the header row anymore",
  /aria-label="Home team logo"><\/th>`\+\s*`<th class="logo-th" aria-label="Matchup breakdown">/.test(board));
check("the header row's LAST th is now Edge — lean, not the Matchup-breakdown placeholder (confirms it actually moved, not just got duplicated)",
  /sortHeaderHTML\("edge","Edge — lean",\{title:"Click to sort\."\}\);\s*\n\s*\}/.test(board));
check("the body's board-cfbd-toggle-cell <td> now sits right after the home-logo <td>, still as its own direct <tr> child (required for the Aug 20 mobile grid-row fix to keep working -- nesting it inside .game would break that)",
  /class="home-logo">[\s\S]{0,200}<\/td>\s*\n\s*<td class="board-cfbd-toggle-cell">/.test(board));
check("the board-cfbd-toggle-cell <td> comes BEFORE the BP\\/Comp \\$\\{cells\\} interpolation now, not after \\$\\{edgeHTML\\}'s <td> at the row's end",
  board.indexOf('<td class="board-cfbd-toggle-cell">') < board.indexOf("${cells}${sysCells}"));

// --- Matchup breakdown toggle: second copy inline next to the flag -----
// Third round of feedback: even after moving the WHOLE COLUMN next to
// the (invisible-on-desktop) home-logo cell, it still wasn't literally
// adjacent to the shortlist flag the way the person wanted -- a real
// screenshot showed the empty space they meant. Since nesting the ONE
// existing button inside .matchup-picks would have broken the Aug 20
// mobile grid-row fix (see that CSS rule's own comment), this adds a
// SECOND copy of the same toggle instead, shown responsively so only one
// is ever visible: the inline copy for desktop, the original dedicated
// <td> for mobile. Both share the same data-board-expand key.
check("a second, inline copy of the toggle (.board-cfbd-toggle-inline) is rendered inside .matchup-picks, immediately after the shortlist-toggle flag button",
  /data-shortlist="\$\{esc\(g\.key\)\}"[^>]*>⚑<\/button><button class="board-cfbd-toggle board-cfbd-toggle-inline/.test(board));
check("both copies of the toggle share the exact same data-board-expand key and aria-expanded state (computed once as boardToggleAttrs, not two independently-drifting copies)",
  /const boardToggleAttrs=`data-board-expand="\$\{esc\(g\.key\)\}" aria-expanded="\$\{boardExpanded\?'true':'false'\}"`/.test(board)
  && (board.match(/\$\{boardToggleAttrs\}/g) || []).length === 2);
check("both copies share the exact same label text (computed once as boardToggleLabel), so they can never show conflicting open/closed states",
  /const boardToggleLabel=boardExpanded\?'▴ Hide matchup breakdown':'▾ Matchup breakdown'/.test(board)
  && (board.match(/\$\{boardToggleLabel\}/g) || []).length === 2);
check(".board-cfbd-toggle-inline is hidden by default (mobile keeps using the dedicated <td> instead), only shown inside the min-width:721px desktop query",
  /\.board-cfbd-toggle-inline\{display:none;\}/.test(html)
  && /@media\(min-width:721px\)\{[\s\S]{0,500}\.board-cfbd-toggle-inline\{display:inline-block;\}/.test(html));
check("the SAME min-width:721px query hides the dedicated .board-cfbd-toggle-cell <td> on desktop, so the two copies are never both visible at once",
  /@media\(min-width:721px\)\{[\s\S]{0,600}\.board td\.board-cfbd-toggle-cell\{display:none;\}/.test(html));

console.log(failures.length ? `\n${failures.length} of ${total} FAILURE(S):` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
