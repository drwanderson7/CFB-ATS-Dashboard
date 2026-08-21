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
const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

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
    "const TABS_WITHOUT_SHARED_WIDGETS=new Set([\"tab-pools\",\"tab-picks\",\"tab-record\"]);",
    extractFunction("sharedWidgetsHiddenOnCurrentTab", boardSrc),
    extractFunction("renderPoolSetupCta", boardSrc),
  ].join("\n"), ctx);
  return ctx;
}

// --- Core visibility logic --------------------------------------------
{
  const ctx = makeCtx({ activePanelId: "tab-snapshot", pool: null, poolsEverCreated: false });
  ctx.renderPoolSetupCta();
  check("shows on Snapshot when viewing Overall board and no pool has ever been created", ctx._cta.style.display === "flex");
  check("includes the 'How to set up a pool' label", ctx._cta.innerHTML.includes("How to set up a pool"));
  check("includes a clear 'Go to Pools' arrow/label", ctx._cta.innerHTML.includes("Go to Pools"));
}
{
  const ctx = makeCtx({ activePanelId: "tab-board", pool: null, poolsEverCreated: false });
  ctx.renderPoolSetupCta();
  check("ALSO shows on Edge Board under the same conditions (both tabs share this one element/function)", ctx._cta.style.display === "flex");
}
{
  const ctx = makeCtx({ activePanelId: "tab-snapshot", pool: { id: "p1", name: "Test Pool" }, poolsEverCreated: true });
  ctx.renderPoolSetupCta();
  check("hides while actively VIEWING a pool -- the CTA is about getting into a pool, not needed once already there", ctx._cta.style.display === "none");
}
{
  const ctx = makeCtx({ activePanelId: "tab-snapshot", pool: null, poolsEverCreated: true });
  ctx.renderPoolSetupCta();
  check("hides permanently once the person has EVER created a pool, even back on Overall board -- self-limiting, no explicit dismiss needed", ctx._cta.style.display === "none");
}
{
  const ctx = makeCtx({ activePanelId: "tab-pools", pool: null, poolsEverCreated: false });
  ctx.renderPoolSetupCta();
  check("hides on the Pools tab itself (already there -- redundant to suggest going somewhere you already are)", ctx._cta.style.display === "none");
}
{
  const ctx = makeCtx({ activePanelId: "tab-picks", pool: null, poolsEverCreated: false });
  ctx.renderPoolSetupCta();
  check("hides on My Picks (a TABS_WITHOUT_SHARED_WIDGETS tab, same set setupNotice/contextBar already use)", ctx._cta.style.display === "none");
}

// --- Click wiring --------------------------------------------------------
// The entire element is the button (real <button id="poolSetupCta"> in
// app/index.html, not a div wrapping a nested button) -- so the click
// handler is wired directly to el.onclick, not a child element.
{
  const ctx = makeCtx({ activePanelId: "tab-snapshot", pool: null, poolsEverCreated: false });
  ctx.renderPoolSetupCta();
  check("the whole element (not a nested child) gets the click handler -- clicking anywhere on the banner works, not just a small button inside it", typeof ctx._cta.onclick === "function");
  ctx._cta.onclick();
  check("clicking the banner calls goToSetupItem() targeting the Pools tab", ctx._goToSetupItemCalls.length === 1 && ctx._goToSetupItemCalls[0].tab === "pools");
  check("the click target highlights the real Upload-PDF control on the Pools tab (poolsTopImportLabel), not a vague/no-op scroll", ctx._goToSetupItemCalls[0].highlight === "poolsTopImportLabel");
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
