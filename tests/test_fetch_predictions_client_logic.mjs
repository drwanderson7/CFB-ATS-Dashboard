// Runtime tests for fetchPredictions() (app/js/prediction-tracker.js)'s
// handling of api/fetch_predictions.py's new reliability-fix response
// fields: `usingStaleFallback`/`message` (stale-if-error) and `warnings`
// (schema-drift alarms). Before this fix, the client had no idea either
// field could exist -- a stale fallback would have rendered as an
// ordinary green "all good" success, and warnings would have been
// silently dropped on the floor.
//
// Runs the REAL fetchPredictions() via vm (not a regex/structural check)
// against a minimal fake DOM + mocked apiFetch/pullTier, same convention
// tests/test_prediction_tracker_logic.mjs already established for this
// file. Run with:
//     node tests/test_fetch_predictions_client_logic.mjs
import fs from "node:fs";
import vm from "node:vm";

const src = fs.readFileSync(new URL("../app/js/prediction-tracker.js", import.meta.url), "utf8");

const failures = [];
let total = 0;
function check(name, cond) {
  total++;
  console.log(`[${cond ? "PASS" : "FAIL"}] ${name}`);
  if (!cond) failures.push(name);
}

// A minimal fake element: just enough for fetchPredictions()'s own
// st.style.color / st.textContent / btn.disabled writes.
function makeEl() {
  return { style: {}, textContent: "", disabled: false };
}

// fetchPredictions() also calls the REAL renderSystemsSettings() (both
// live in this same source file, so it can't be stubbed out the way an
// externally-defined function could) -- give it just enough of a fake DOM
// to run without throwing, same minimal-stub convention
// tests/test_prediction_tracker_logic.mjs already established for this
// exact function.
function makeFakeSystemsGrid() {
  const el = { innerHTML: "", querySelectorAll: () => [], querySelector: () => ({ onclick: undefined }) };
  return el;
}

function makeCtx({ apiResult, sharedPredictionsAfterPull }) {
  const predStatus = makeEl();
  const loadBtn = makeEl();
  const systemsList = makeFakeSystemsGrid();
  const consoleWarnCalls = [];
  const ctx = {
    document: {
      getElementById: (id) => {
        if (id === "predStatus") return predStatus;
        if (id === "loadPredsBtn") return loadBtn;
        if (id === "systemsList") return systemsList;
        return null; // cwBp/cwComp/systemsCount/predMetaLine/pdfFile -- all optional-checked (`if(el)`) in the real source
      },
      querySelectorAll: () => [], // .core-weights .weight-inp -- none in this fake DOM
    },
    console: { warn: (...args) => consoleWarnCalls.push(args), error: () => {}, log: () => {} },
    state: { predictions: null, predMeta: null, enabledSystems: ["sag"], weights: {} },
    games: [],
    PRED_SYSTEMS: [],
    TOP_SYSTEM_RANKS: {},
    lastPredUnmatched: [],
    SHARED_FRESH_MINUTES: 30,
    minsAgo: () => null, // no recent local copy -- always falls through to a real fetch in these tests
    weightOf: () => 1,
    inputsFor: () => [null, null],
    esc: (s) => String(s ?? ""),
    save: () => {},
    pullTier: async (tier, force) => {
      // Simulates the shared-tier pull picking up whatever the server
      // wrote (or, for the stale-fallback case, whatever was ALREADY
      // there, since do_GET() deliberately does not overwrite the shared
      // cache when serving a stale fallback).
      if (sharedPredictionsAfterPull) {
        ctx.state.predictions = sharedPredictionsAfterPull.games;
        ctx.state.predMeta = { fetchedAt: sharedPredictionsAfterPull.fetchedAt, count: sharedPredictionsAfterPull.games.length };
        return true;
      }
      return true;
    },
    apiFetch: async () => apiResult,
    applyPredictions: () => 3, // pretend 3 games matched to the board
    renderBoard: () => {},
  };
  ctx._predStatus = predStatus;
  ctx._loadBtn = loadBtn;
  ctx._consoleWarnCalls = consoleWarnCalls;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx;
}

const sampleGames = [{ home: "Alabama", road: "Auburn", systems: { sag: -3.5 }, homeVegas: -3 }];

// --- Normal success path (no warnings, no stale fallback) ------------------
{
  const ctx = makeCtx({
    apiResult: { ok: true, body: { games: sampleGames, systems: ["sag"], count: 1, fetchedAt: "2026-09-05T12:00:00Z", sharedPersisted: true, warnings: [] } },
    sharedPredictionsAfterPull: { games: sampleGames, fetchedAt: "2026-09-05T12:00:00Z" },
  });
  await ctx.fetchPredictions();
  check("normal success: status text reports the loaded game count and matched count", ctx._predStatus.textContent.includes("loaded 1 games") && ctx._predStatus.textContent.includes("3 matched to board"));
  check("normal success: no stale-fallback wording leaks into an ordinary successful load", !ctx._predStatus.textContent.includes("Using last successful"));
  check("normal success: status color is green (matched>0, no warnings) -- the genuinely-good case still looks good, not diluted to amber by the new logic", ctx._predStatus.style.color === "var(--green-text)");
  check("normal success: no console.warn calls fire when there are no warnings and no stale fallback", ctx._consoleWarnCalls.length === 0);
}

// --- Stale-if-error fallback path -------------------------------------------
{
  const staleMessage = "Prediction source temporarily unavailable. Using the last successful predictions from 3 hours ago.";
  const ctx = makeCtx({
    apiResult: {
      ok: true,
      body: {
        games: sampleGames, systems: ["sag"], count: 1,
        fetchedAt: "2026-09-05T09:00:00Z", // the ORIGINAL fetch time, not "now"
        sharedPersisted: true,
        usingStaleFallback: true,
        staleAgeMinutes: 180,
        message: staleMessage,
      },
    },
    sharedPredictionsAfterPull: { games: sampleGames, fetchedAt: "2026-09-05T09:00:00Z" },
  });
  await ctx.fetchPredictions();
  check("stale fallback: the server's own human-readable message is surfaced verbatim in the status line, not a generic success message", ctx._predStatus.textContent.includes(staleMessage));
  check("stale fallback: status color is amber (a real, if degraded, success) -- neither the normal green 'all good' NOR the red 'failed' path", ctx._predStatus.style.color === "var(--amber)");
  check("stale fallback: still reports how many games matched the board despite being stale data", ctx._predStatus.textContent.includes("3 matched to board"));
  check("stale fallback: logs a console.warn so it's discoverable in devtools even though it's not treated as a hard failure", ctx._consoleWarnCalls.some((args) => String(args[0]).includes("stale fallback")));
}

// --- Schema-drift warnings path (successful, but with warnings) ------------
{
  const driftWarnings = ["Game count dropped sharply: 40 \u2192 3. This may be a genuinely light week, or a broken upstream fetch -- worth a manual check."];
  const ctx = makeCtx({
    apiResult: { ok: true, body: { games: sampleGames, systems: ["sag"], count: 1, fetchedAt: "2026-09-05T12:00:00Z", sharedPersisted: true, warnings: driftWarnings } },
    sharedPredictionsAfterPull: { games: sampleGames, fetchedAt: "2026-09-05T12:00:00Z" },
  });
  await ctx.fetchPredictions();
  check("data-quality warnings: status text names how many warnings exist and points to the console, without dumping the full warning text inline", ctx._predStatus.textContent.includes("1 data-quality warning"));
  check("data-quality warnings: status color downgrades to amber even though matched>0 -- a real data-quality concern shouldn't look identical to a clean success", ctx._predStatus.style.color === "var(--amber)");
  check("data-quality warnings: each warning is individually logged to console.warn with its full text, not just a count", ctx._consoleWarnCalls.some((args) => String(args[1] ?? args[0]).includes("Game count dropped sharply")));
}

// --- Plural wording check (2+ warnings) -------------------------------------
{
  const ctx = makeCtx({
    apiResult: { ok: true, body: { games: sampleGames, systems: ["sag"], count: 1, fetchedAt: "2026-09-05T12:00:00Z", sharedPersisted: true, warnings: ["w1", "w2"] } },
    sharedPredictionsAfterPull: { games: sampleGames, fetchedAt: "2026-09-05T12:00:00Z" },
  });
  await ctx.fetchPredictions();
  check("data-quality warnings: pluralizes correctly for 2+ warnings ('2 data-quality warnings', not '2 data-quality warning')", ctx._predStatus.textContent.includes("2 data-quality warnings"));
}

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
