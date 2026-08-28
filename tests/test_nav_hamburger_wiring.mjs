// Structural tests for the mobile nav hamburger dropdown that replaced
// nav.tabs' old horizontal-scroll mobile behavior. Run with:
//
//     node tests/test_nav_hamburger_wiring.mjs
//
// Same "structural, not full DOM execution" reasoning already established
// for the Pools-row dropdown wiring (test_pools_page_logic.mjs) and
// explicitly documented in test_context_bar_logic.mjs's own header
// comment: real open/close/click-outside behavior needs a real DOM/
// browser and belongs in tests/test_e2e_ui_behaviors.py (a plain Node vm
// context has nothing to click), NOT a hand-mocked DOM here. What IS
// worth pinning down at this level -- and would catch a real regression --
// is that the pieces actually exist and are actually wired together: the
// HTML ids exist, tabs.js's functions reference them, switchTab() actually
// calls the new label/close functions (not just defines them), init.js
// actually calls initNavHamburger() at startup, and the click-outside
// listener uses composedPath() rather than the .contains() pattern that
// bit the Context Bar's own dropdown before (see its comment).
//
// REMAINING WORK, not done here: a real Playwright check at a mobile
// viewport width (e.g. 390px) confirming the hamburger is actually visible,
// the horizontal nav.tabs row is actually hidden, tapping it actually opens
// the dropdown, and tapping a tab actually closes it and switches panels --
// "structurally wired" is not the same as "visually correct in a real
// browser," same distinction this project draws everywhere else.
import fs from "node:fs";

const ROOT = new URL("../", import.meta.url);
const htmlSrc = fs.readFileSync(new URL("app/index.html", ROOT), "utf8")
  // CSS moved out of index.html into app/css/app.css (Aug 28, pure file-
  // split) -- appended here the same way this codebase already handles
  // every other file split out of index.html.
  + fs.readFileSync(new URL("app/css/app.css", ROOT), "utf8");
const tabsSrc = fs.readFileSync(new URL("app/js/tabs.js", ROOT), "utf8");
const initSrc = fs.readFileSync(new URL("app/js/init.js", ROOT), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// --- HTML structure --------------------------------------------------------
for (const id of ["tabsWrap", "navHamburger", "navHamburgerLabel", "navTabs"]) {
  check(`app/index.html defines #${id}`, htmlSrc.includes(`id="${id}"`));
}
check("the hamburger button is INSIDE #tabsWrap, not a sibling (needed for the .tabs-wrap.open CSS + click-outside logic to find it as one unit)",
  (() => {
    const wrapStart = htmlSrc.indexOf('id="tabsWrap"');
    const wrapOpenTag = htmlSrc.indexOf(">", wrapStart);
    const hamburgerIdx = htmlSrc.indexOf('id="navHamburger"');
    const navTabsIdx = htmlSrc.indexOf('id="navTabs"');
    return wrapOpenTag !== -1 && hamburgerIdx > wrapOpenTag && navTabsIdx > hamburgerIdx;
  })());
check("nav.tabs itself is unchanged (still the single source of truth for the 5 tab buttons -- no separate/duplicated mobile menu markup)",
  (htmlSrc.match(/data-tab="snapshot"/g) || []).length === 1);

// --- tabs.js: functions exist and do the right thing -----------------------
for (const fn of ["updateNavHamburgerLabel", "closeNavHamburger", "initNavHamburger"]) {
  check(`app/js/tabs.js defines ${fn}()`, new RegExp(`function ${fn}\\(`).test(tabsSrc));
}

check("switchTab() actually calls updateNavHamburgerLabel(name) (not just defined, but wired into every tab switch)",
  /function switchTab\(name\)\{[\s\S]{0,400}updateNavHamburgerLabel\(name\)/.test(tabsSrc));
check("switchTab() actually calls closeNavHamburger() (selecting a tab closes the mobile dropdown, doesn't leave it open)",
  /function switchTab\(name\)\{[\s\S]{0,500}closeNavHamburger\(\)/.test(tabsSrc));

check("updateNavHamburgerLabel() checks nav.tabs buttons FIRST (the 5 main tabs), falling back to .icon-nav-btn's title attribute (Account/Settings/Help have no visible text of their own to read)",
  /function updateNavHamburgerLabel\(name\)\{[\s\S]{0,300}nav\.tabs button\[data-tab="\$\{name\}"\][\s\S]{0,300}icon-nav-btn\[data-tab="\$\{name\}"\][\s\S]{0,80}\.title/.test(tabsSrc));

check("closeNavHamburger() removes the 'open' class from #tabsWrap",
  /function closeNavHamburger\(\)\{[\s\S]{0,200}classList\.remove\(["']open["']\)/.test(tabsSrc));
check("closeNavHamburger() resets aria-expanded to \"false\" (accessibility state stays honest, not just the visual state)",
  /function closeNavHamburger\(\)\{[\s\S]{0,300}aria-expanded[\s\S]{0,20}["']false["']/.test(tabsSrc));

check("initNavHamburger() wires the hamburger button's onclick to toggle #tabsWrap's 'open' class",
  /function initNavHamburger\(\)\{[\s\S]{0,600}classList\.add\(["']open["']\)/.test(tabsSrc));
check("initNavHamburger()'s click-outside-to-close listener uses composedPath(), not a plain .contains() check (same DOM-detach bug class the Context Bar's own dropdown had to fix -- see its comment in pool-contexts.js)",
  /function initNavHamburger\(\)\{[\s\S]{0,800}composedPath/.test(tabsSrc));

// --- init.js: actually calls the new init function at startup --------------
// Same "an unwired function is as broken as a missing one" reasoning as
// the Pools-menu wiring tests -- checks it's a real (non-commented) call.
check("init.js actually calls initNavHamburger() once at startup, not just referenced in a comment",
  initSrc.split("\n").some(line => /\binitNavHamburger\(\)/.test(line) && !line.trim().startsWith("//")));

// --- CSS: the mobile media query actually hides the old row and shows the
// hamburger, rather than leaving both visible at once ----------------------
check("the mobile media query shows .nav-hamburger (display:flex)",
  /@media\(max-width:720px\)\{[\s\S]{0,2000}\.nav-hamburger\{display:flex/.test(htmlSrc));
check("the mobile media query hides the old horizontal nav.tabs row by default (display:none)",
  /@media\(max-width:720px\)\{[\s\S]{0,2000}nav\.tabs\{display:none/.test(htmlSrc));
check("the mobile media query restyles nav.tabs into a vertical dropdown specifically when .tabs-wrap carries .open",
  /\.tabs-wrap\.open nav\.tabs\{[\s\S]{0,200}flex-direction:column/.test(htmlSrc));

console.log(failures.length ? `\n${failures.length} of ${total} checks FAILED:` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
