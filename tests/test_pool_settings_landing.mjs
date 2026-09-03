// Structural regression tests for Pick Board > Pool Settings task-oriented
// landing page (Sep 3, 2026). The mature pool list/import/wizard behavior
// remains underneath; the landing simply makes the three common jobs clear.
import fs from "node:fs";

const ROOT=new URL("../",import.meta.url);
const html=fs.readFileSync(new URL("app/index.html",ROOT),"utf8");
const pools=fs.readFileSync(new URL("app/js/pool-contexts.js",ROOT),"utf8");
const init=fs.readFileSync(new URL("app/js/init.js",ROOT),"utf8");
const css=fs.readFileSync(new URL("app/css/app.css",ROOT),"utf8");

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

check("Pool Settings has task-oriented landing",html.includes('class="pool-settings-landing"'));
check("Create pool is a primary task",html.includes('id="poolSettingsCreateBtn"')&&html.includes('>Create pool<'));
check("Weekly setup/update is a primary task",html.includes('id="poolSettingsWeekBtn"')&&html.includes('id="poolSettingsWeekTitle"'));
check("Manage entries is a primary task",html.includes('id="poolSettingsEntriesBtn"')&&html.includes('>Manage entries<'));
check("weekly task owns a hidden PDF input",/id="poolSettingsWeekFile"[^>]*accept="application\/pdf"/.test(html));
check("active pool summary exists",html.includes('id="poolSettingsActiveSummary"'));
check("task status element exists",html.includes('id="poolSettingsTaskStatus"'));
check("quick import is demoted to a collapsed secondary area",/<details class="card pool-settings-secondary"[^>]*id="poolSettingsQuickImport">/.test(html));
check("legacy first-import PDF input remains available",html.includes('id="poolsTopImportFile"'));
check("legacy ESPN paste input remains available",html.includes('id="poolsTopPasteText"')&&html.includes('id="poolsTopPasteBtn"'));
check("existing pools list remains intact",html.includes('id="poolsList"')&&html.includes('id="poolsNewBtn"'));

check("Pool Settings renderer is context aware",/function renderPoolSettingsLanding\(\)/.test(pools)&&/const pool=currentPool\(\)/.test(pools));
check("active pool summary shows name/week/entry count",/poolSettingsActiveSummary/.test(pools)&&/pool\.weekLabel/.test(pools)&&/pool\.entries/.test(pools));
check("weekly update disables without an active pool",/weekBtn\.disabled=!pool/.test(pools));
check("weekly task copy adapts for manual-line pools",/manualLines[\s\S]*Set this week's games & lines/.test(pools));
check("every-game pools avoid exposing the 999 sentinel in pool rows",/p\.weeklyPickMode==="all"\?"every game"/.test(pools));
check("entries task disables without an active pool",/entriesBtn\.disabled=!pool/.test(pools));
check("context changes refresh Pool Settings task state",/renderContextAll\(\)[\s\S]*renderPoolSettingsLanding\(\)/.test(pools));
check("renderPoolsPage refreshes landing",/function renderPoolsPage\(\)[\s\S]*renderPoolSettingsLanding\(\)/.test(pools));

check("Create task starts existing ATS wizard",/poolSettingsCreateBtn[\s\S]*onclick=atsStartPoolWizard/.test(init));
check("weekly task updates the current pool rather than creating a new one",/importPool\(f,p\.id,"poolSettingsTaskStatus"\)/.test(init));
check("weekly task refuses to act with Overall context",/poolSettingsWeekBtn\.onclick=\(\)=>\{[\s\S]*if\(!p\) return;/.test(init));
check("manual-line pools route weekly setup to manual game selection",/if\(p\.lineSource==="manual"\)\{[\s\S]*togglePoolManualBox\(p\.id\)/.test(init));
check("Manage entries routes to existing My Picks subview",/poolSettingsEntriesBtn[\s\S]*switchTab\("picks"\)/.test(init));

check("landing has dedicated desktop task-grid styling",/\.pool-settings-task-grid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(css));
check("landing stacks tasks on mobile",/@media\(max-width:760px\)\{[\s\S]*?\.pool-settings-task-grid\{grid-template-columns:1fr;\}/.test(css));
check("disabled tasks have explicit styling",/\.pool-settings-task\.disabled,\.pool-settings-task:disabled/.test(css));

console.log(failures.length?`\n${failures.length} of ${total} checks FAILED:`:`\nAll ${total} checks passed.`);
for(const f of failures) console.log(" -",f);
if(failures.length) process.exit(1);
