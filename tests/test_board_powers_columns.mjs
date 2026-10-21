// All Games Powers / Computer columns collapse while empty (Oct 21, 2026).
// Runs the real boardPowersColumnsShown() from app/js/board.js: collapsed when
// no visible game has a value and no Powers PDF is imported; shown again on
// its own once any value, a "check PDF" flag or a PDF exists, or when the
// person asked for the columns. The browser side (header control, sorting,
// phones) is tests/test_e2e_board_powers_columns.py.
//
// Run with:
//     node tests/test_board_powers_columns.mjs
import fs from "node:fs";
import vm from "node:vm";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const init = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("../app/js/main.js", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

const m = board.match(/function boardPowersColumnsShown\(rows,inputsLookup,pdfGames,userShown\)\{[\s\S]*?\n\}/);
check("boardPowersColumnsShown() exists in board.js", !!m);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${m[0]};this.shown=boardPowersColumnsShown;`, ctx);
const shown = ctx.shown;

const rows = [{ key: "a@b" }, { key: "c@d" }, { key: "e@f" }];
const inputs = (map) => (key) => map[key] || [null, null];

check("collapsed: no values, no PDF, not requested", shown(rows, inputs({}), null, false) === false);
check("collapsed: an empty pdfGames list counts as no PDF", shown(rows, inputs({}), [], false) === false);
check("collapsed: empty-string values (a cleared input) count as empty", shown(rows, inputs({ "a@b": ["", null] }), null, false) === false);
check("collapsed: a value on a game that isn't visible doesn't count", shown(rows, inputs({ "x@y": [-3.5, null] }), null, false) === false);
check("collapsed: no visible games at all", shown([], inputs({}), null, false) === false);

check("shown: the person asked for the columns (manual entry)", shown(rows, inputs({}), null, true) === true);
check("auto-shown: any visible Brad Powers value", shown(rows, inputs({ "c@d": [-3.5, null] }), null, false) === true);
check("auto-shown: any visible Computer Line value", shown(rows, inputs({ "e@f": [null, 7] }), null, false) === true);
check("auto-shown: a value of 0 (pick'em) counts", shown(rows, inputs({ "a@b": [0, null] }), null, false) === true);
check("auto-shown: a Powers PDF is imported", shown(rows, inputs({}), [{ away: "A", home: "B" }], false) === true);
check("auto-shown: a game flagged 'check PDF' (dropped BP value)", shown([{ key: "a@b", bpSuspect: true }], inputs({}), null, false) === true);

// Wiring: renderBoard uses the rule for both the header and every row, the
// control toggles the saved choice, and the choice survives a reload.
check("renderBoard decides once per render from the VISIBLE games",
  /const powersShown=boardPowersColumnsShown\(visibleGames,inputsFor,state\.pdfGames,!!state\.boardPowersShown\);/.test(board));
check("collapsed header shows the '+ Add Powers / Computer lines' control",
  /class="powers-add-btn" data-powers-toggle="show"[^>]*>\+ Add Powers \/ Computer lines<\/button>/.test(board));
check("collapsed rows render one empty cell (header and rows stay aligned), no inputs",
  /const cells=!powersShown\?\(powersAny\?`<td class="hide powers-collapsed-td"><\/td>`:""\)/.test(board));
check("shown columns keep their sortable Powers / Computer headers",
  /powersShown&&coreEnabled\.has\("bp"\)\)\?sortHeaderHTML\("bp","Powers"/.test(board)
  && /powersShown&&coreEnabled\.has\("comp"\)\)\?sortHeaderHTML\("comp","Computer"/.test(board));
check("the header click handler toggles state.boardPowersShown and re-renders",
  /data-powers-toggle\]"\);[\s\S]{0,200}state\.boardPowersShown=show; save\(\); renderBoard\(\);/.test(init));
check("state.boardPowersShown is normalized on load (persists with the rest of state)",
  /s\.boardPowersShown=!!s\.boardPowersShown;/.test(main));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
