// Runtime tests for renderSystemsSettings()'s prediction-systems checklist
// grid -- specifically the "Import Powers PDF" cell, moved into the grid
// (positioned right after BP, before Comp) from a separate static button
// in the INPUT WEIGHTS box. This file didn't exist before that move --
// renderSystemsSettings()/the whole prediction-tracker.js file had no
// test coverage at all.
//
// REAL BUG, caught and fixed while making this move, not just a cosmetic
// change: #pdfFile now lives INSIDE the JS-rendered grid, which means it's
// destroyed and recreated by wrap.innerHTML=... on every single call to
// renderSystemsSettings() (every checkbox toggle, weight change,
// predictions load). The one-time onchange binding init.js used to do at
// app bootstrap ran BEFORE this function's first-ever call within init()
// -- meaning by the time #pdfFile existed in the DOM at all, that binding
// attempt had already either thrown (element not created yet) or bound to
// an element that got replaced moments later, leaving the real button with
// NO working handler. Fixed by moving the binding inside
// renderSystemsSettings() itself, re-run every render -- this file proves
// that rebinding actually happens and actually wires to the real
// importPowers() call, not just that "some function" got assigned.
//
// Run with:
//     node tests/test_prediction_tracker_logic.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/prediction-tracker.js", import.meta.url), "utf8");
const initSrc = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");
const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function extractFunction(name, source) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
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

// A minimal fake DOM: elements are tracked in a flat registry by id.
// Setting wrap.innerHTML re-parses just the `id="..."` occurrences in the
// new string and registers a fresh stub object per id (mimicking innerHTML
// replacement actually destroying/recreating real DOM nodes) -- enough to
// test getElementById()-based rebinding without a full HTML parser/jsdom
// dependency this project doesn't otherwise use.
function makeFakeGrid() {
  const registry = {};
  function reparse(html) {
    // Clear out anything that WAS inside this wrap (simulates the old
    // nodes -- and their handlers -- being destroyed by innerHTML=).
    for (const id of Object.keys(registry)) delete registry[id];
    const re = /id="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) registry[m[1]] = { onchange: undefined, textContent: "", value: "" };
  }
  const wrap = {
    _html: "",
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = v; reparse(v); },
    querySelectorAll(sel) {
      // Only the two selectors renderSystemsSettings() actually uses on
      // this element ([data-sys], .sys-weight) -- both empty in every
      // test here (no systems enabled), so an empty array is correct and
      // sufficient; forEach on it is a safe no-op either way.
      return [];
    },
    querySelector(sel) {
      // Minimal stub -- just enough for renderSystemsSettings()'s own
      // "Show all systems" toggle lookup not to throw. This file doesn't
      // currently assert anything about that toggle's own click behavior
      // (it's a simple boolean flip); extend this if that ever needs
      // real coverage.
      return { onclick: undefined };
    },
  };
  return { wrap, registry };
}

function makeCtx() {
  const { wrap, registry } = makeFakeGrid();
  const coreWeightEls = []; // .core-weights .weight-inp -- empty, no core-weights markup left with a weight box relevant here
  const calls = { importPowers: [] };
  const ctx = {
    document: {
      getElementById: (id) => {
        if (id === "systemsList") return wrap;
        if (id === "cwBp" || id === "cwComp") return { style: {} };
        if (registry[id]) return registry[id];
        return null;
      },
      querySelectorAll: (sel) => (sel === ".core-weights .weight-inp" ? coreWeightEls : []),
    },
    state: { enabledSystems: [], weights: {}, predictions: null, predMeta: null },
    games: [],
    PRED_SYSTEMS: [],
    TOP_SYSTEM_RANKS: {},
    weightOf: (code) => (code === "vegas" ? 0 : 1),
    inputsFor: () => [null, null],
    esc: (s) => String(s ?? ""),
    save: () => {},
    renderBoard: () => {},
    importPowers: (file) => { calls.importPowers.push(file); },
  };
  ctx._registry = registry;
  ctx._calls = calls;
  vm.createContext(ctx);
  // Module-level `let systemsShowAll=false;` sits OUTSIDE
  // renderSystemsSettings() in the real source (same ephemeral-UI-state
  // pattern as boardExpandedKeys/recordExpandedBoxScores elsewhere this
  // session) -- extractFunction() only pulls the function body itself, so
  // this needs injecting separately, same as the other module-level
  // pieces the real file relies on.
  vm.runInContext("let systemsShowAll=false;", ctx);
  vm.runInContext(extractFunction("systemsPresentThisWeek", src), ctx);
  vm.runInContext(extractFunction("setWeight", src), ctx);
  vm.runInContext(extractFunction("bindWeightInput", src), ctx);
  vm.runInContext(extractFunction("renderSystemsSettings", src), ctx);
  vm.runInContext(extractFunction("updateSystemsCount", src), ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// Grid order: Import Powers PDF sits between BP and Comp
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  ctx.renderSystemsSettings();
  const html = ctx.document.getElementById("systemsList").innerHTML;
  const bpIdx = html.indexOf("BP (Brad Powers line)");
  const pdfIdx = html.indexOf("Import Powers PDF");
  const compIdx = html.indexOf("Comp (computer line)");
  check("renderSystemsSettings(): BP, Import Powers PDF, and Comp all actually render",
    bpIdx !== -1 && pdfIdx !== -1 && compIdx !== -1);
  check("renderSystemsSettings(): Import Powers PDF sits between BP and Comp in the grid (to BP's right)",
    bpIdx < pdfIdx && pdfIdx < compIdx);
}

// ---------------------------------------------------------------------------
// The real bug: #pdfFile is destroyed/recreated every render, and its
// handler must be genuinely rebound every time -- not just present once.
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  check("before any render, #pdfFile doesn't exist yet (nothing to bind to -- this is exactly the state that used to crash init.js's old one-time binding)",
    ctx.document.getElementById("pdfFile") === null);

  ctx.renderSystemsSettings();
  const el1 = ctx.document.getElementById("pdfFile");
  check("after the first render, #pdfFile exists and has a real onchange handler bound",
    el1 && typeof el1.onchange === "function");

  // Simulate the file input firing -- the bound handler should call the
  // real importPowers() with the selected file, then clear the input.
  const fakeFile = { name: "powers.pdf" };
  const fakeEvent = { target: { files: [fakeFile], value: "x" } };
  el1.onchange(fakeEvent);
  check("the bound handler actually calls importPowers() with the selected file",
    ctx._calls.importPowers.length === 1 && ctx._calls.importPowers[0] === fakeFile);
  check("the bound handler clears the file input's value after handing off (so picking the SAME file again still fires onchange)",
    fakeEvent.target.value === "");

  // Re-render (simulates a checkbox toggle / weight change / predictions
  // load happening later) -- the OLD element is gone, a NEW one must be
  // bound, not left with a stale/missing handler.
  const firstElRef = el1;
  ctx.renderSystemsSettings();
  const el2 = ctx.document.getElementById("pdfFile");
  check("after a SECOND render, a fresh #pdfFile element exists (old one was destroyed by innerHTML=, same as real DOM behavior)",
    el2 && el2 !== firstElRef);
  check("the fresh element ALSO has a real onchange handler -- this is the actual fix; the old code only ever bound once, at bootstrap, before this element even existed",
    el2 && typeof el2.onchange === "function");
  const fakeFile2 = { name: "powers2.pdf" };
  el2.onchange({ target: { files: [fakeFile2], value: "y" } });
  check("the SECOND render's handler also genuinely works (calls importPowers with the new file)",
    ctx._calls.importPowers.length === 2 && ctx._calls.importPowers[1] === fakeFile2);
}

// ---------------------------------------------------------------------------
// Doesn't throw when the file input's change event carries no file
// (e.g. the user opened the file picker and cancelled).
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  ctx.renderSystemsSettings();
  const el = ctx.document.getElementById("pdfFile");
  let threw = false;
  try { el.onchange({ target: { files: [], value: "" } }); } catch (e) { threw = true; }
  check("cancelling the file picker (no file selected) doesn't throw, and doesn't call importPowers()",
    !threw && ctx._calls.importPowers.length === 0);
}

// ---------------------------------------------------------------------------
// Structural: the static markup is actually gone from index.html (moved,
// not duplicated), and init.js no longer does the hazardous one-time bind.
// ---------------------------------------------------------------------------
{
  const staticMatches = (htmlSrc.match(/id="pdfImportLabel"/g) || []).length;
  check("app/index.html no longer has a static Import Powers PDF button (moved into the JS-rendered grid, not duplicated)",
    staticMatches === 0);
  check("prediction-tracker.js is the only place #pdfImportLabel/#pdfFile/#pdfStatus are defined now",
    (src.match(/id="pdfImportLabel"/g) || []).length === 1 &&
    (src.match(/id="pdfFile"/g) || []).length === 1 &&
    (src.match(/id="pdfStatus"/g) || []).length === 1);
  check("init.js no longer does the old one-time #pdfFile binding (the hazard this whole fix was about)",
    !initSrc.includes('document.getElementById("pdfFile").onchange='));
  check("renderSystemsSettings() itself now does the rebinding, guarded with an existence check (not a bare .onchange= that would throw on null)",
    /const pdfFileEl=document\.getElementById\("pdfFile"\);\s*\n\s*if\(pdfFileEl\) pdfFileEl\.onchange=/.test(src));
}

// ---------------------------------------------------------------------------
// Featured-systems filtering: by default the checklist only shows Drew's
// curated FEATURED_SYSTEM_CODES subset, not everything PRED_SYSTEMS/the
// real sheet can supply -- with two safety nets: a system already ENABLED
// (even if not featured) still shows so it's never an invisible-but-active
// toggle, and "Show all" reveals everything on demand.
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  vm.runInContext(`PRED_SYSTEMS=[
    {code:"aaa",name:"Featured One"},
    {code:"bbb",name:"Not Featured"},
    {code:"ccc",name:"Enabled But Not Featured"}
  ]`, ctx);
  vm.runInContext(`FEATURED_SYSTEM_CODES=new Set(["aaa"])`, ctx);
  vm.runInContext(`state.enabledSystems=["ccc"]`, ctx);
  ctx.renderSystemsSettings();
  const html1 = ctx.document.getElementById("systemsList").innerHTML;
  check("featured filtering: a featured system always shows",
    html1.includes("Featured One"));
  check("featured filtering: a non-featured, non-enabled system is hidden by default",
    !html1.includes("Not Featured") || html1.includes("Enabled But Not Featured"));
  // (the previous check's OR guards against "Not Featured" substring-
  // matching inside "Enabled But Not Featured" -- confirm the TRUE
  // negative directly too)
  check("featured filtering: confirmed directly -- 'bbb' (non-featured, non-enabled) does not appear at all",
    !new RegExp(`data-sys="bbb"`).test(html1));
  check("featured filtering: an ENABLED system still shows even when it isn't in FEATURED_SYSTEM_CODES -- never an invisible-but-active toggle",
    html1.includes("Enabled But Not Featured"));
  check("featured filtering: the 'Show all' toggle reports how many are currently hidden",
    /Show all 3 available systems \(1 more\)/.test(html1));

  vm.runInContext(`systemsShowAll=true`, ctx);
  ctx.renderSystemsSettings();
  const html2 = ctx.document.getElementById("systemsList").innerHTML;
  check("featured filtering: toggling systemsShowAll reveals the previously-hidden system too",
    html2.includes("Not Featured") && new RegExp(`data-sys="bbb"`).test(html2));
  check("featured filtering: the toggle's own label flips to 'show fewer' once everything is showing",
    html2.includes("Show only the curated systems"));
}
{
  // Safety fallback: if FEATURED_SYSTEM_CODES somehow isn't loaded
  // (typeof check in the real code), filtering must be a no-op --
  // everything shows -- rather than silently hiding every single system.
  const ctx = makeCtx();
  vm.runInContext(`PRED_SYSTEMS=[{code:"aaa",name:"Only System"}]`, ctx);
  // Deliberately NOT setting FEATURED_SYSTEM_CODES on ctx at all.
  ctx.renderSystemsSettings();
  const html = ctx.document.getElementById("systemsList").innerHTML;
  check("featured filtering: if FEATURED_SYSTEM_CODES isn't defined at all, nothing gets hidden (fails open, not closed)",
    html.includes("Only System"));
}

console.log(failures.length ? `\n${failures.length} of ${total} FAILURE(S):` : `\nAll ${total} checks passed.`);
for (const f of failures) console.log(" -", f);
if (failures.length) process.exit(1);
