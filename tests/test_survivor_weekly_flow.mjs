// Fast guards for the Sept 23, 2026 Survivor weekly-flow batch (real
// extracted functions): snapshot "Use" button rules, phone default view,
// compact setup wiring. Browser proof: tests/test_e2e_survivor_weekly_flow.py
//
// Run with:  node tests/test_survivor_weekly_flow.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/survivor-integration.js", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../app/css/survivor-integration.css", import.meta.url), "utf8");
function fn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`missing ${name}()`);
  let i = src.indexOf("{", start), d = 0;
  for (; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { i++; break; } } }
  return src.slice(start, i);
}
let fail = 0, total = 0;
const check = (n, c) => { total++; console.log(`[${c ? "PASS" : "FAIL"}] ${n}`); if (!c) fail++; };

// --- Use button rules
const ctx = { esc: (x) => String(x), Date };
vm.createContext(ctx);
vm.runInContext(fn("pgSurvivorSummaryUseButtonsHTML"), ctx);
const future = new Date(Date.now() + 864e5).toISOString(), past = new Date(Date.now() - 36e5).toISOString();
const rec = (team, gameId, startDate = future, extra = {}) => ({ team, matchup: { gameId, startDate, completed: false, ...extra } });
const H = (s) => ctx.pgSurvivorSummaryUseButtonsHTML(s);
let h = H({ required: 1, pickRows: [], recommendations: [rec("Ole Miss", 55)], matchesBest: false });
check("single pick, none saved -> 'Use Ole Miss' with the pick data attributes", h.includes(">Use Ole Miss<") && h.includes('data-survivor-pick-game="55"') && h.includes('data-survivor-pick-team="Ole Miss"'));
h = H({ required: 1, pickRows: [{ team: "Texas" }], recommendations: [rec("Ole Miss", 55)], matchesBest: false });
check("single pick, different team saved -> 'Switch to Ole Miss'", h.includes(">Switch to Ole Miss<"));
check("already matches best path -> no button", H({ required: 1, pickRows: [{ team: "Ole Miss" }], recommendations: [rec("Ole Miss", 55)], matchesBest: true }) === "");
check("kicked-off game -> no button", H({ required: 1, pickRows: [], recommendations: [rec("Ole Miss", 55, past)], matchesBest: false }) === "");
check("completed game -> no button", H({ required: 1, pickRows: [], recommendations: [rec("Ole Miss", 55, future, { completed: true })], matchesBest: false }) === "");
check("no matchup/gameId -> no button", H({ required: 1, pickRows: [], recommendations: [{ team: "X", matchup: null }], matchesBest: false }) === "");
h = H({ required: 2, pickRows: [], recommendations: [rec("Georgia", 1), rec("Texas", 2)], matchesBest: false });
check("two-pick pool, none saved -> one Use button per recommended team", (h.match(/survivor-summary-use"/g) || []).length === 2 && h.includes(">Use Georgia<") && h.includes(">Use Texas<"));
h = H({ required: 2, pickRows: [{ team: "Georgia" }], recommendations: [rec("Georgia", 1), rec("Texas", 2)], matchesBest: false });
check("two-pick pool, one saved -> only the missing team offered", h.includes(">Use Texas<") && !h.includes("Use Georgia"));
check("two-pick pool already full -> no button (change picks in Rankings)", H({ required: 2, pickRows: [{ team: "A" }, { team: "B" }], recommendations: [rec("Georgia", 1), rec("Texas", 2)], matchesBest: false }) === "");
check("team names are escaped through esc()", src.includes('data-survivor-pick-team="${esc(rec.team)}">${esc(label)}</button>'));

// --- Phone default view
const vctx = {};
vm.createContext(vctx);
vm.runInContext(fn("pgSurvivorDefaultView"), vctx);
vctx.pgSurvivorIsPhone = () => true;
check("phone, no explicit choice -> rankings (even if 'board' was stored by default)", vctx.pgSurvivorDefaultView({ view: "board" }) === "rankings");
check("phone, explicit choice -> that view", vctx.pgSurvivorDefaultView({ view: "board", viewChosen: true }) === "board");
vctx.pgSurvivorIsPhone = () => false;
check("desktop, no choice -> stored view or board", vctx.pgSurvivorDefaultView({}) === "board" && vctx.pgSurvivorDefaultView({ view: "plan" }) === "plan");
check("invalid stored view falls back safely", vctx.pgSurvivorDefaultView({ view: "nope", viewChosen: true }) === "board");
check("clicking a sub-tab records the explicit choice", src.includes("ui.view=viewBtn.dataset.survivorView;ui.viewChosen=true;"));
check("viewChosen is normalized/persisted with the survivor UI", src.includes("viewChosen:raw.viewChosen===true,"));

// --- Compact setup wiring
const journey = fn("pgSurvivorRenderJourney");
check("wizard hidden once schedule loaded and the entry has any pick", journey.includes("if(hasData&&anyPick){el.innerHTML='';return;}"));
const health = fn("pgSurvivorRenderHealth");
check("healthy status uses a Details toggle, not an always-present <details> block", health.includes("data-survivor-health-toggle") && health.includes('id="survivorHealthDetail"'));
check("Details toggle handler wired", src.includes("if(e.target.closest('[data-survivor-health-toggle]')){pgSurvivorRuntime.healthOpen=!pgSurvivorRuntime.healthOpen;pgSurvivorRenderHealth();return;}"));
check("Pool settings [hidden] beats .btn display", css.includes("#survivorPoolSettingsBtn[hidden]{display:none!important}"));
check("Weekly Snapshot renders the Use buttons", fn("pgSurvivorRenderWeeklySummary").includes("${pgSurvivorSummaryUseButtonsHTML(s)}"));

console.log(`\n${total - fail}/${total} checks passed`);
if (fail) process.exit(1);
