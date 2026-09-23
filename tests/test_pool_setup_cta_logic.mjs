// Runtime tests for renderPoolSetupCta() (app/js/board.js) -- the pool-
// setup discovery CTA shown on Snapshot/Edge Board when someone is on the
// Overall board and has never created a pool. Real gap this fixes: before
// this, the ONLY pool-setup messaging anywhere lived in the "you're
// looking at demo data" banner, which itself disappeared the moment real
// Vegas lines loaded -- meaning a live, real-data Overall-board session
// had zero path to discovering pools exist at all.
//
// Extracts the REAL function from app/js/board.js (not a hand-copied
// reimplementation), same convention as test_weekly_setup_logic.mjs.
// Run with:
//     node tests/test_pool_setup_cta_logic.mjs
import fs from "node:fs";
import vm from "node:vm";

const boardSrc = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8")
  // CSS moved out of index.html into app/css/app.css (Aug 28, pure file-
  // split) -- appended here the same way this codebase already handles
  // every other file split out of index.html.
  + fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

function extractFunction(name, source) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

function makeEl() {
  return { style: {}, innerHTML: "" };
}

function makeCtx({ activePanelId, pool, poolsEverCreated }) {
  const cta = makeEl();
  cta.onclick = null;
  const goToSetupItemCalls = [];
  const ctx = {
    document: {
      getElementById: (id) => (id === "poolSetupCta" ? cta : null),
      querySelector: (sel) => (sel === ".panel.active" ? { id: activePanelId } : null),
    },
    state: { pools: poolsEverCreated ? [{ id: "p1" }] : [] },
    currentPool: () => pool,
    goToSetupItem: (target) => goToSetupItemCalls.push(target),
  };
  ctx._cta = cta;
  ctx._goToSetupItemCalls = goToSetupItemCalls;
  vm.createContext(ctx);
  vm.runInContext([
    boardSrc.match(/const TABS_WITHOUT_SHARED_WIDGETS=new Set\(\[[^\]]*\]\);/)[0],
    extractFunction("sharedWidgetsHiddenOnCurrentTab", boardSrc),
    extractFunction("renderPoolSetupCta", boardSrc),
  ].join("\n"), ctx);
  return ctx;
}

// --- Core visibility logic (Sept 23, 2026: banner retired) --------------
// All Games showed THREE pool prompts at once (this banner, the Market view
// card, the Viewing bar). The banner is now hide-only in every state;
// discovery lives in the Market view card, tested below.
for (const [panel, pool, ever] of [
  ["tab-snapshot", null, false], ["tab-board", null, false], ["tab-board", null, true],
  ["tab-board", { id: "p1" }, true], ["tab-pools", null, false], ["tab-picks", null, false],
  ["tab-confidence", null, false], ["tab-survivor", null, false],
]) {
  const ctx = makeCtx({ activePanelId: panel, pool, poolsEverCreated: ever });
  ctx._cta.style.display = "flex"; // prove a stale visible copy gets hidden
  ctx.renderPoolSetupCta();
  check(`retired banner is hidden on ${panel} (pool=${!!pool}, everHadPool=${ever})`, ctx._cta.style.display === "none");
  check(`retired banner never wires a click handler on ${panel}`, ctx._cta.onclick == null);
}

// --- Confidence/Survivor no longer get ATS shared widgets -----------------
for (const panel of ["tab-confidence", "tab-survivor", "tab-pools", "tab-picks", "tab-record"]) {
  const ctx = makeCtx({ activePanelId: panel, pool: null, poolsEverCreated: false });
  check(`sharedWidgetsHiddenOnCurrentTab() is true on ${panel} (ATS Viewing bar / setup notice hidden there)`, ctx.sharedWidgetsHiddenOnCurrentTab() === true);
}
for (const panel of ["tab-snapshot", "tab-board"]) {
  const ctx = makeCtx({ activePanelId: panel, pool: null, poolsEverCreated: false });
  check(`sharedWidgetsHiddenOnCurrentTab() stays false on ${panel}`, ctx.sharedWidgetsHiddenOnCurrentTab() === false);
}

// --- Discovery now lives in the All Games Market view card ---------------
{
  const tabsSrc = fs.readFileSync(new URL("../app/js/tabs.js", import.meta.url), "utf8");
  function workflowCtx({ pool, pools }) {
    const el = { style: {}, innerHTML: "", className: "", querySelector: () => null };
    const ctx = {
      document: { getElementById: (id) => (id === "pickBoardWorkflow" ? el : null) },
      pickBoardView: "board",
      state: { pools },
      currentPool: () => pool,
      activeEntry: () => ({ picks: {} }),
      pickLimit: () => 7,
      esc: (x) => String(x),
      switchPickBoardView: () => {},
    };
    vm.createContext(ctx);
    vm.runInContext(extractFunction("renderPickBoardWorkflow", tabsSrc), ctx);
    ctx.renderPickBoardWorkflow();
    return el;
  }
  const first = workflowCtx({ pool: null, pools: [] });
  check("Market view card carries first-time pool discovery when no pool was ever created", first.innerHTML.includes("Playing in a pool?") && first.innerHTML.includes("Set up a pool →"));
  check("first-time discovery action routes to the Pools subview", first.innerHTML.includes('data-pickboard-next="pools"'));
  const returning = workflowCtx({ pool: null, pools: [{ id: "p1" }] });
  check("with pools already created but none selected, the card keeps the plain 'Use pool lines' copy", returning.innerHTML.includes("No pool selected.") && returning.innerHTML.includes("Use pool lines →") && !returning.innerHTML.includes("Playing in a pool?"));
}

// --- Structural: renderSetupStatus() actually calls this on every path ---
check("renderSetupStatus() calls renderPoolSetupCta() unconditionally at its own top, BEFORE any of its own early returns -- so the CTA updates on every render path (hidden/demo/complete/checklist), not just the one that reaches the bottom of that function",
  /function renderSetupStatus\(\)\{\s*\n\s*renderPoolSetupCta\(\);/.test(boardSrc));

// --- Structural: the demo-mode banner no longer duplicates pool messaging
check("the demo-mode banner text no longer mentions pool-sheet import itself (the dedicated CTA now owns that message consistently across demo AND live states, avoiding two different pool pitches on screen at once)",
  !/You're looking at demo data\.<\/b>[\s\S]{0,300}pool sheet/.test(boardSrc));

// --- Structural: index.html wiring ---------------------------------------
check("app/index.html defines #poolSetupCta OUTSIDE .top-widgets-row (that row is a fixed 2-up flex layout for the context bar + setup notice; a third flex child there fights both for space instead of getting its own row -- the actual bug hit and fixed this session)",
  (() => {
    const rowEnd = htmlSrc.indexOf("</div>", htmlSrc.indexOf('id="setupNotice"'));
    const ctaIdx = htmlSrc.indexOf('id="poolSetupCta"');
    return rowEnd !== -1 && ctaIdx > rowEnd;
  })());
check("#poolSetupCta is a real <button>, not a div wrapping a nested button -- the whole element is clickable, keyboard/AT accessible as one control, not ambiguous about what to click",
  /<button type="button" id="poolSetupCta" class="pool-setup-banner"/.test(htmlSrc));
check("#poolSetupCta starts hidden (display:none) in the static markup -- JS decides visibility on first render, never a flash of unstyled content",
  /<button type="button" id="poolSetupCta" class="pool-setup-banner" style="display:none;">/.test(htmlSrc));
check(".pool-setup-banner defines its own distinct style (not reusing .full-board-cta) -- a simpler single-clickable-banner pattern, deliberately different from the card+separate-button pattern that read as ambiguous",
  /\.pool-setup-banner\{display:none;width:100%;align-items:center;justify-content:space-between;/.test(htmlSrc));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
