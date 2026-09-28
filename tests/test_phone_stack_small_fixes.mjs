// Fast (no-browser) guards for the Sept 23, 2026 phone pre-slate compaction
// (to-do #7) and small UI fixes (to-do #11). The real-browser proof is
// tests/test_e2e_phone_stack_small_fixes.py; these pin the source so a
// later edit can't quietly undo them between browser runs.
//
// Run with:  node tests/test_phone_stack_small_fixes.mjs
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const html = read("../app/index.html");
const css = read("../app/css/app.css");
const board = read("../app/js/board.js");
const picks = read("../app/js/picks.js");
const tabs = read("../app/js/tabs.js");
const ctx = read("../app/js/pool-contexts.js");
const init = read("../app/js/init.js");
const survivor = read("../app/js/survivor-integration.js");

function extractFunction(name, source) {
  const start = source.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`missing ${name}()`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

let fail = 0, total = 0;
const check = (name, cond) => { total++; console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`); if (!cond) fail++; };

// #11 date pickers
check("no date input left in index.html", !/type="date"/.test(html));
check("no date input rendered by the Viewing switcher", !ctx.includes('type="date"') && !ctx.includes("ctxWeekJump"));
check("no leftover weekJump wiring in board.js / init.js", !board.includes("weekJump") && !init.includes("weekJump"));
check("Viewing switcher keeps prev/next + Show all weeks", ctx.includes('id="ctxWeekPrev"') && ctx.includes('id="ctxWeekNext"') && ctx.includes('id="ctxWeekAll"'));

// #11 Mark submitted once
const entries = extractFunction("renderEntries", picks);
const detail = extractFunction("renderPicksDetail", picks);
check("entry switcher list (renderEntries) no longer renders Mark submitted / Unlock", !entries.includes("data-submit=") && !entries.includes("data-unsubmit="));
check("entry card (renderPicksDetail) still renders Mark submitted and Unlock", detail.includes("data-submit=") && detail.includes("data-unsubmit="));

// #11 header Refresh
check("switchTab toggles lines-refresh-hidden for Survivor and Results only",
  tabs.includes('document.body.classList.toggle("lines-refresh-hidden",name==="survivor"||name==="record");'));
check("CSS hides Refresh + its status line under that class",
  css.includes("body.lines-refresh-hidden #refreshBtn,") && css.includes("body.lines-refresh-hidden #refreshTime{display:none!important;}"));

// #11 Survivor single error
const placeholder = extractFunction("pgSurvivorDataPlaceholder", survivor);
check("Survivor child-view error is an info pointer, not a second red error", placeholder.includes('kind:"info"') && !placeholder.includes('kind:"error"'));
check("Survivor child-view error has no second Retry action", !placeholder.includes("survivor-retry"));
check("Survivor status panel still owns the Retry", survivor.includes("Survivor data could not finish loading") && survivor.includes("data-survivor-retry"));

// #7 phone stack
check("renderBoard marks an empty, unfiltered shortlist row", board.includes('sfWrap.classList.toggle("shortlist-empty",!sl.length&&!shortlistFilterOn);'));
const phone = css.slice(css.indexOf("/* Phone pre-slate stack, compacted (Sept 23, 2026)."));
check("phone block exists", phone.length > 0 && phone.includes("@media(max-width:720px)"));
check("phone: empty shortlist row hidden", phone.includes("#shortlistFilterWrap.shortlist-empty{display:none!important;}"));
check("phone: workflow card forced to one row, explanation hidden", phone.includes(".pickboard-workflow{flex-direction:row!important;") && phone.includes(".pickboard-workflow small{display:none;}"));
check("phone: week bar kept on one line", phone.includes(".week-bar{gap:6px;margin:8px 0 2px;padding:5px 8px;flex-wrap:nowrap;}") && phone.includes(".week-label{white-space:nowrap;"));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
