// Fast source guards for the Results tab redesign (Sept 30, 2026). The real
// behavior proof is tests/test_e2e_results_layout.py; these keep --fast honest.
// Run with:  node tests/test_results_layout_source.mjs
import fs from "node:fs";
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const rec = read("../app/js/record.js"), html = read("../app/index.html"), css = read("../app/css/app.css"), init = read("../app/js/init.js");
let total = 0, fail = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) fail++; };
const fnBody = (name) => { const i = rec.indexOf(`function ${name}(`); let d = 0, j = rec.indexOf("{", i); for (; j < rec.length; j++) { if (rec[j] === "{") d++; else if (rec[j] === "}") { d--; if (!d) { j++; break; } } } return rec.slice(i, j); };
const render = fnBody("renderRecord");

check("analytics threshold is 10 graded picks", /const RECORD_ANALYTICS_MIN_GRADED=10;/.test(rec));
check("analytics open state is automatic (null) until the person toggles it", /let recordAnalyticsOpen=null;/.test(rec) && render.includes("recordAnalyticsOpen==null?analyticsAuto:recordAnalyticsOpen"));
check("page order: record summary, filters, (no-match), weeks, analytics", /wrap\.innerHTML=`\$\{summaryHTML\}\$\{showFilters\?filterHTML:""\}\$\{noMatches\}\$\{weeksHtml\}\$\{analyticsSection\}`;/.test(render));
check("filters are still BUILT every time (they normalize stale selections) but only shown for 2+ weeks or an active filter",
  render.indexOf("const filterHTML=recordFilterBarHTML(") >= 0 && render.includes('const showFilters=hist.length>1||recordFilters.season!=="all"||recordFilters.week!=="all";'));
check("only the newest week renders expanded; older weeks are <details>", render.includes("if(wkIndex===0){") && render.includes('<details class="card record-week record-week-old"'));
check("older-week fold state survives re-renders (recordOpenWeeks)", /const recordOpenWeeks=new Set\(\);/.test(rec) && render.includes("recordOpenWeeks.add(id)"));
check("W/L/P buttons render only while a pick is being edited", render.includes("const editing=recordEditingResults.has(editKey);") && render.includes("?`<span class=\"resgroup\">${mkBtn('W','W')}"));
check("picking a result closes that pick's editor", render.includes("recordEditingResults.delete(`${b.dataset.week}|${b.dataset.entry}|${b.dataset.pick}`)"));
check("setResult() is unchanged: choosing the same result clears it", fnBody("setResult").includes("pk.result=(pk.result===result)?null:result;"));
check("the Why? box-score toggle and restore button are still wired", render.includes("[data-restore]") && render.includes("[data-why]"));
check("Check results now stays a static header button (init.js wiring + message survive re-renders)",
  html.includes('<button class="btn btn-light record-check-btn" id="checkResultsBtn"') && html.includes('id="gradeMsg"') && init.includes('document.getElementById("checkResultsBtn").onclick'));
check("the old big 'Auto-grading' card is gone", !html.includes("<h2>Auto-grading</h2>"));
check("edit links are 44px touch targets on phones", /@media\(max-width:700px\)\{[\s\S]*\.record-edit-link\{min-height:44px/.test(css));
console.log(`\n${total - fail}/${total} checks passed`);
process.exit(fail ? 1 : 0);
