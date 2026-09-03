// Runtime tests for the new ATS pool setup wizard in app/js/pool-contexts.js
// -- Sept 2, 2026, Drew's explicit request after seeing ChatGPT's proposal
// to bring the Confidence pool wizard's guided-setup pattern to ATS pools.
// Extracts the ACTUAL functions from the real source, not a hand-copied
// reimplementation that could drift (this project's established pattern --
// see test_pools_page_logic.mjs, test_confidence_pool_setup_wizard.mjs).
//
// Run with: node tests/test_ats_pool_setup_wizard.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/pool-contexts.js", import.meta.url), "utf8");
const cssSrc = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

function extractFunction(name, source) {
  const asyncMarker = `async function ${name}(`;
  const plainMarker = `function ${name}(`;
  let start = source.indexOf(asyncMarker);
  if (start === -1) start = source.indexOf(plainMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

function extractConst(name, source) {
  const marker = `const ${name}=`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find const ${name}`);
  const end = source.indexOf(";", start);
  return source.slice(start, end + 1);
}

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

function makeCtx() {
  const ctx = {
    console,
    state: { pools: [], activeContext: "overall" },
    uid: (() => { let n = 0; return () => `id${++n}`; })(),
    save: () => {},
    esc: s => String(s ?? ""),
    // cpWizardChoice() is reused directly from confidence-integration.js --
    // a genuinely generic "render a two-column choice card" helper with
    // zero confidence-specific logic. Stubbed here with the real shape
    // (matches the actual function's output) so atsRenderWizardStep() can
    // be tested without loading the whole confidence-integration.js file.
    cpWizardChoice: (value, title, desc, selected, attr) =>
      `<button class="pg-wizard-choice ${selected ? "selected" : ""}" ${attr}="${value}">${title}|${desc}</button>`,
    renderContextAll: () => {},
    renderPoolsPage: () => {},
    trackBetaEvent: () => {},
    importPool: () => {},
    document: {
      getElementById: () => null,
      createElement: () => ({ click(){}, style:{} }),
      body: { appendChild(){}, removeChild(){} },
      querySelectorAll: () => [],
    },
    Date, Number, Math, Array, Set, Object, String, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(extractConst("ATS_WIZARD_EVERY_GAME_SENTINEL", src), ctx);
  vm.runInContext(extractFunction("atsStartPoolWizard", src), ctx);
  vm.runInContext(extractFunction("atsCancelPoolWizard", src), ctx);
  vm.runInContext(extractFunction("atsWizardCanContinue", src), ctx);
  vm.runInContext(extractFunction("atsCreatePoolFromDraft", src), ctx);
  vm.runInContext(extractFunction("atsRenderWizardStep", src), ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// atsStartPoolWizard() / atsCancelPoolWizard()
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  check("atsWizard starts null (no wizard active) before atsStartPoolWizard() is called",
    ctx.atsWizard === undefined || ctx.atsWizard === null);
  ctx.atsStartPoolWizard();
  check("atsStartPoolWizard() initializes a fresh draft at step 1",
    ctx.atsWizard.step === 1 && ctx.atsWizard.draft.name === "");
  check("atsStartPoolWizard() defaults weeklyPickCount to 7 (matches the old single-form default)",
    ctx.atsWizard.draft.weeklyPickCount === 7);
  ctx.atsCancelPoolWizard();
  check("atsCancelPoolWizard() clears the wizard entirely (no partial pool state survives)",
    ctx.atsWizard === null);
}

// ---------------------------------------------------------------------------
// atsWizardCanContinue() -- gating logic per step
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  ctx.atsStartPoolWizard();

  check("step 1: cannot continue with an empty name", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.name = "  ";
  check("step 1: whitespace-only name still blocks continuing", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.name = "Grundy's ATS Pool";
  check("step 1: a real name allows continuing", ctx.atsWizardCanContinue() === true);

  ctx.atsWizard.step = 2;
  check("step 2: no weeklyPickMode selected yet -> cannot continue", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.weeklyPickMode = "all";
  check("step 2: 'every game' mode alone is enough to continue", ctx.atsWizardCanContinue() === true);
  ctx.atsWizard.draft.weeklyPickMode = "count";
  ctx.atsWizard.draft.weeklyPickCount = 0;
  check("step 2: 'set number' mode with count=0 blocks continuing", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.weeklyPickCount = 7;
  check("step 2: 'set number' mode with a real count allows continuing", ctx.atsWizardCanContinue() === true);

  ctx.atsWizard.step = 3;
  check("step 3: no line source selected yet -> cannot continue", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.lineSource = "import";
  check("step 3: 'import' selected allows continuing", ctx.atsWizardCanContinue() === true);
  ctx.atsWizard.draft.lineSource = "manual";
  check("step 3: 'manual' selected also allows continuing", ctx.atsWizardCanContinue() === true);

  ctx.atsWizard.step = 4;
  ctx.atsWizard.draft.entryCount = 0;
  check("step 4: entryCount of 0 blocks continuing", ctx.atsWizardCanContinue() === false);
  ctx.atsWizard.draft.entryCount = 1;
  check("step 4: entryCount of 1 allows continuing", ctx.atsWizardCanContinue() === true);
}

// ---------------------------------------------------------------------------
// atsCreatePoolFromDraft() -- the actual pool object produced
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  const draft = { name: " Office ATS Pool ", weeklyPickMode: "count", weeklyPickCount: 5, lineSource: "manual", entryCount: 3 };
  const pool = ctx.atsCreatePoolFromDraft(draft);

  check("atsCreatePoolFromDraft(): trims the pool name", pool.name === "Office ATS Pool");
  check("atsCreatePoolFromDraft(): pickLimit matches the chosen weekly count (5)", pool.pickLimit === 5);
  check("atsCreatePoolFromDraft(): weeklyPickMode is stamped for informational reference", pool.weeklyPickMode === "count");
  check("atsCreatePoolFromDraft(): lineSource is stamped ('manual')", pool.lineSource === "manual");
  check("atsCreatePoolFromDraft(): creates exactly 3 auto-numbered entries", pool.entries.length === 3 &&
    pool.entries[0].name === "Entry 1" && pool.entries[2].name === "Entry 3");
  check("atsCreatePoolFromDraft(): activeEntryId points at the first entry", pool.activeEntryId === pool.entries[0].id);
  check("atsCreatePoolFromDraft(): starts with an empty game list (no fake/placeholder games)", pool.games.length === 0);
  check("atsCreatePoolFromDraft(): pool is pushed into state.pools and made the active context",
    ctx.state.pools.includes(pool) && ctx.state.activeContext === pool.id);

  // "Pick every game" -> the documented sentinel, NOT a change to the
  // shared pickLimit() fallback (||7) used at 13 other call sites.
  const everyGameDraft = { name: "Every Game Pool", weeklyPickMode: "all", lineSource: "import", entryCount: 1 };
  const everyGamePool = ctx.atsCreatePoolFromDraft(everyGameDraft);
  check("atsCreatePoolFromDraft(): 'every game' mode uses the documented sentinel (999), not 0/null/Infinity",
    everyGamePool.pickLimit === 999);
  check("atsCreatePoolFromDraft(): 'every game' mode still stamps weeklyPickMode='all' for informational reference",
    everyGamePool.weeklyPickMode === "all");

  // Entry count clamped to a sane range (1-25), matching the Confidence
  // wizard's own clamp -- consistent limits across both wizards even
  // though the implementations are separate.
  const extremeDraft = { name: "Extreme", weeklyPickMode: "all", lineSource: "manual", entryCount: 999 };
  const extremePool = ctx.atsCreatePoolFromDraft(extremeDraft);
  check("atsCreatePoolFromDraft(): entry count is clamped to a max of 25, even if the draft somehow has more",
    extremePool.entries.length === 25);
}

// ---------------------------------------------------------------------------
// atsRenderWizardStep() -- spot-check each step actually renders something
// sane, and the review step reflects the real draft values
// ---------------------------------------------------------------------------
{
  const ctx = makeCtx();
  ctx.atsStartPoolWizard();
  ctx.atsWizard.draft = { name: "Grundy's ATS Pool", weeklyPickMode: "count", weeklyPickCount: 8, lineSource: "import", entryCount: 2 };

  ctx.atsWizard.step = 1;
  check("step 1 renders a name input pre-filled with the draft's current name",
    ctx.atsRenderWizardStep().includes("Grundy's ATS Pool"));

  ctx.atsWizard.step = 2;
  const step2 = ctx.atsRenderWizardStep();
  check("step 2 asks about weekly pick count and shows the count input since 'count' mode is selected",
    step2.includes("How many picks do you make each week?") && step2.includes("atsWizWeeklyCount"));

  ctx.atsWizard.step = 3;
  const step3 = ctx.atsRenderWizardStep();
  check("step 3 asks about pool lines and mentions the PDF prompt since 'import' is selected",
    step3.includes("How does your pool determine the spread?") && step3.includes("right after this pool is created"));
  check("step 3 does NOT offer a 'use live Vegas lines' option -- dropped for v1 per Drew's explicit decision",
    !step3.toLowerCase().includes("live vegas"));

  ctx.atsWizard.step = 4;
  check("step 4 shows the entry stepper reflecting the draft's entryCount (2)",
    ctx.atsRenderWizardStep().includes('value="2"'));

  ctx.atsWizard.step = 5; // review
  const review = ctx.atsRenderWizardStep();
  check("review step shows the pool name", review.includes("Grundy's ATS Pool"));
  check("review step shows 'Pick 8 games' for weekly picks", review.includes("Pick 8 games"));
  check("review step shows 'Imported pool spreads' for lines", review.includes("Imported pool spreads"));
  check("review step shows entry count (2)", review.includes("<b>2</b>"));
  check("review step has an edit link back to every step (1-4)",
    [1,2,3,4].every(n => review.includes(`data-ats-wiz-edit="${n}"`)));
}

// ---------------------------------------------------------------------------
// Shared CSS -- confirms the earlier .cp-wizard-* -> .pg-wizard-* rename
// actually landed cleanly, and the ATS wizard markup uses those same
// shared classes (visual consistency without JS logic sharing, per Drew's
// explicit "standalone now, unify later" decision).
// ---------------------------------------------------------------------------
{
  check("shared .pg-wizard-* CSS classes exist (renamed from the Confidence-only .cp-wizard-* prefix)",
    cssSrc.includes(".pg-wizard-card") && cssSrc.includes(".pg-wizard-choice") && cssSrc.includes(".pg-entry-stepper"));
  check("no leftover .cp-wizard-* references anywhere in app.css (clean rename, not a partial duplicate)",
    !cssSrc.includes(".cp-wizard-"));
  const stepOutput = extractFunction("atsRenderWizardStep", src);
  check("atsRenderWizardStep() actually uses the shared pg-wizard-* classes, not a separate ats-only set",
    stepOutput.includes("pg-wizard-question") && stepOutput.includes("pg-wizard-choices"));
}

console.log("");
console.log(`${total - failures.length}/${total} checks passed`);
if (failures.length) { console.log("FAILED:"); failures.forEach(f => console.log(`  - ${f}`)); process.exit(1); }
process.exit(0);
