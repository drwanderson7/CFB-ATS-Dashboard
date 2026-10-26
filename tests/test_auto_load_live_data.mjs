// Regression tests for automatic data loading.
//
// Oct 26, 2026: lines come from The Odds API ONLY when someone clicks
// Refresh lines. autoLoadLiveData() (app/js/odds.js), run on startup and on
// tab resume, must never call refreshLines(); it still loads model
// predictions automatically (fetchPredictions() spends no Odds API quota) and,
// on resume, re-pulls the SHARED state (our own Redis read) so a long-open
// tab still sees lines someone else refreshed. The header and context bar say
// when the shared lines were last updated ("Lines updated Sat 9:14 AM").
//
// Run with:
//     node tests/test_auto_load_live_data.mjs
import fs from "node:fs";
import vm from "node:vm";

const oddsSrc = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");
const predSrc = fs.readFileSync(new URL("../app/js/prediction-tracker.js", import.meta.url), "utf8");
const initSrc = fs.readFileSync(new URL("../app/js/init.js", import.meta.url), "utf8");
const snapSrc = fs.readFileSync(new URL("../app/js/snapshot-export.js", import.meta.url), "utf8");
const htmlSrc = fs.readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const cssSrc = fs.readFileSync(new URL("../app/css/app.css", import.meta.url), "utf8");

function extractFunction(name, source) {
  let start = source.indexOf(`async function ${name}(`);
  if (start === -1) start = source.indexOf(`function ${name}(`);
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

const NOW = Date.parse("2026-09-23T15:00:00Z");
const ago = (min) => new Date(NOW - min * 60000).toISOString();
const inFuture = (min) => new Date(NOW + min * 60000).toISOString();

function makeCtx({ state, signedIn = true, refreshImpl, predImpl, pullImpl }) {
  const calls = { refresh: [], preds: [], archive: 0, render: 0, pulls: [], rehydrate: 0 };
  const ctx = {
    window: { Clerk: signedIn ? { user: { id: "u" } } : {} },
    state,
    SHARED_FRESH_MINUTES: 30,
    Date: class extends Date { static now() { return NOW; } },
    console,
    refreshLines: async (opts) => { calls.refresh.push(opts); if (refreshImpl) await refreshImpl(ctx); },
    fetchPredictions: async (opts) => { calls.preds.push(opts); if (predImpl) await predImpl(ctx); },
    pullTier: async (scope, force) => { calls.pulls.push([scope, force]); return pullImpl ? pullImpl(ctx) : false; },
    rehydrateAfterSync: () => { calls.rehydrate++; },
    autoArchiveFinishedWeeks: () => { calls.archive++; },
    renderBoard: () => { calls.render++; },
  };
  vm.createContext(ctx);
  vm.runInContext([
    extractFunction("oddsFreshMinutes", oddsSrc),
    extractFunction("liveDataStaleness", oddsSrc),
    "let autoLoadInFlight=null;",
    extractFunction("autoLoadLiveData", oddsSrc),
    "this.__inFlight=()=>autoLoadInFlight;",
  ].join("\n"), ctx);
  ctx.__calls = calls;
  return ctx;
}

const freshGames = [{ away: "A", home: "B", commence: inFuture(3 * 24 * 60) }];

// --- Staleness decision --------------------------------------------------------
{
  const ctx = makeCtx({ state: {} });
  const s = ctx.liveDataStaleness(NOW);
  check("no cached lines or predictions -> both stale", s.lines === true && s.predictions === true);
}
{
  const ctx = makeCtx({ state: { lastGames: freshGames, lastRefresh: ago(5), predictions: [{}], predMeta: { fetchedAt: ago(5) } } });
  const s = ctx.liveDataStaleness(NOW);
  check("5-minute-old data with kickoffs days away -> nothing stale", s.lines === false && s.predictions === false);
}
{
  const ctx = makeCtx({ state: { lastGames: freshGames, lastRefresh: ago(45), predictions: [{}], predMeta: { fetchedAt: ago(10) } } });
  const s = ctx.liveDataStaleness(NOW);
  check("45-minute-old lines are stale, 10-minute-old predictions are not", s.lines === true && s.predictions === false);
}
{
  // Near kickoff the odds window tightens to 5 minutes (oddsFreshMinutes()).
  const soon = [{ away: "A", home: "B", commence: inFuture(30) }];
  const ctx = makeCtx({ state: { lastGames: soon, lastRefresh: ago(7), predictions: [{}], predMeta: { fetchedAt: ago(7) } } });
  check("within an hour of kickoff, 7-minute-old lines count as stale (shares oddsFreshMinutes())", ctx.liveDataStaleness(NOW).lines === true);
}
{
  const ctx = makeCtx({ state: { lastGames: freshGames, lastRefresh: "not a date", predictions: [], predMeta: null } });
  const s = ctx.liveDataStaleness(NOW);
  check("unparseable refresh time / empty predictions are treated as stale, never as fresh", s.lines === true && s.predictions === true);
}

// --- autoLoadLiveData orchestration: never refreshes lines ----------------------
{
  const state = { lastGames: [], predictions: [] };   // nothing at all cached
  const ctx = makeCtx({ state });
  await ctx.autoLoadLiveData("startup");
  check("startup with no lines cached does NOT call refreshLines (no Odds API call)", ctx.__calls.refresh.length === 0);
  check("startup still loads model predictions automatically ({auto:true})", ctx.__calls.preds.length === 1 && ctx.__calls.preds[0].auto === true);
  check("startup doesn't re-pull the shared tier (init() already did)", ctx.__calls.pulls.length === 0);
  check("finished auto-load runs the weekly auto-archive sweep", ctx.__calls.archive === 1);
  check("finished auto-load re-renders so no loading state can outlive the fetch", ctx.__calls.render === 1);
  check("in-flight flag is cleared afterwards", ctx.__inFlight() === null);
}
{
  // Hours-old lines: before Oct 26 this triggered an automatic refresh.
  const state = { lastGames: freshGames, lastRefresh: ago(600), predictions: [{}], predMeta: { fetchedAt: ago(2) } };
  const ctx = makeCtx({ state });
  const r = await ctx.autoLoadLiveData("startup");
  check("stale lines + fresh predictions on startup -> no network calls at all", r === false && ctx.__calls.refresh.length === 0 && ctx.__calls.preds.length === 0);
  check("...and the auto-archive sweep still runs", ctx.__calls.archive === 1);
}
{
  const state = { lastGames: freshGames, lastRefresh: ago(600), predictions: [{}], predMeta: { fetchedAt: ago(2) } };
  const ctx = makeCtx({ state, pullImpl: () => true });
  await ctx.autoLoadLiveData("resume");
  check("tab resume never calls refreshLines", ctx.__calls.refresh.length === 0);
  check("tab resume re-pulls the SHARED state (no Odds API) so lines someone else refreshed show up",
    ctx.__calls.pulls.length === 1 && ctx.__calls.pulls[0][0] === "shared");
  check("...and re-renders everything when that pull brought newer shared data", ctx.__calls.rehydrate === 1);
  check("resume with fresh predictions doesn't refetch them", ctx.__calls.preds.length === 0);
}
{
  const ctx = makeCtx({ state: { lastGames: freshGames, lastRefresh: ago(2), predictions: [{}], predMeta: { fetchedAt: ago(2) } }, pullImpl: () => false });
  await ctx.autoLoadLiveData("resume");
  check("resume with nothing new in the shared tier skips the re-render", ctx.__calls.rehydrate === 0 && ctx.__calls.refresh.length === 0);
}
{
  const ctx = makeCtx({ state: {}, signedIn: false });
  await ctx.autoLoadLiveData("startup");
  check("guest / signed-out sessions never auto-load through the signed-in paths", ctx.__calls.refresh.length === 0 && ctx.__calls.preds.length === 0);
}
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = makeCtx({ state: {}, predImpl: () => gate });
  const a = ctx.autoLoadLiveData("startup");
  const b = ctx.autoLoadLiveData("resume");
  check("a second trigger while one is in flight does not start another load", ctx.__calls.preds.length === 1);
  release(); await Promise.all([a, b]);
  check("...and only one predictions load actually ran", ctx.__calls.preds.length === 1);
}
{
  const ctx = makeCtx({ state: {}, predImpl: () => { throw new Error("boom"); } });
  const origErr = console.error; console.error = () => {};
  await ctx.autoLoadLiveData("startup");
  console.error = origErr;
  check("a thrown load error is contained (no unhandled rejection) and the flag clears", ctx.__inFlight() === null && ctx.__calls.render === 1);
}

// --- "Lines updated ..." label ---------------------------------------------------
{
  const lctx = {};
  vm.createContext(lctx);
  vm.runInContext([extractFunction("linesWhen", oddsSrc), extractFunction("linesUpdatedLabel", oddsSrc), "this.L=linesUpdatedLabel;"].join("\n"), lctx);
  const sat = new Date(2026, 9, 24, 9, 14);      // Sat Oct 24, 9:14 AM local
  const satEve = new Date(2026, 9, 24, 21, 0).getTime();
  const tue = new Date(2026, 9, 27, 12, 0).getTime();
  const later = new Date(2026, 10, 3, 12, 0).getTime();
  const t = sat.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  check(`same day: time only ("Lines updated ${t}")`, lctx.L(sat.toISOString(), satEve) === `Lines updated ${t}`);
  check("earlier this week: weekday + time (\"Lines updated Sat 9:14 AM\")",
    lctx.L(sat.toISOString(), tue) === `Lines updated ${sat.toLocaleDateString(undefined, { weekday: "short" })} ${t}`);
  check("older than six days: month/day + time (a weekday alone would be ambiguous)",
    lctx.L(sat.toISOString(), later) === `Lines updated ${sat.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${t}`);
  check("never refreshed / unparseable -> 'Lines not loaded yet'", lctx.L(null, tue) === "Lines not loaded yet" && lctx.L("nope", tue) === "Lines not loaded yet");
}

// --- Structural wiring -----------------------------------------------------------
const refreshSrc = extractFunction("refreshLines", oddsSrc);
const autoSrc = extractFunction("autoLoadLiveData", oddsSrc);
check("autoLoadLiveData() never references refreshLines()", !autoSrc.includes("refreshLines"));
check("refreshLines() has no 'auto' mode any more (only the button calls it)", refreshSrc.startsWith("async function refreshLines()") && !refreshSrc.includes("auto"));
check("the only refreshLines() caller is the Refresh lines button",
  initSrc.includes('document.getElementById("refreshBtn").onclick=refreshLines;')
  && !/refreshLines\(/.test(initSrc.replace('onclick=refreshLines;', '')));
check("fetchPredictions() keeps the {auto:true} convention", extractFunction("fetchPredictions", predSrc).includes("const auto=!!(opts&&opts.auto===true);"));
check("init() starts the predictions auto-load after first paint", initSrc.includes('autoLoadLiveData("startup");'));
check("init() re-checks when a tab becomes visible again, bound only once", initSrc.includes('document.addEventListener("visibilitychange"') && initSrc.includes("window.__pgAutoLoadResumeBound"));
check("This Week's old 'loading lines' auto-load state is gone; only a models-loading state remains",
  !snapSrc.includes("snapshotAutoLoading") && !snapSrc.includes("Loading this week's lines and models") && snapSrc.includes("function snapshotModelsAutoLoading()"));
check("no copy claims PickGauge refreshes stale lines automatically", !snapSrc.includes("refreshes stale data automatically") && !htmlSrc.includes("Lines and models load automatically"));
check("refreshMeta() shows 'Lines updated ...' in the header", extractFunction("refreshMeta", oddsSrc).includes("linesUpdatedLabel(state.lastRefresh)"));
check("a refresh status note (failure / paused) is written after refreshMeta(), so it isn't wiped",
  /refreshMeta\(\);[^\n]*\n\s*if\(statusMsg\) document\.getElementById\("refreshTime"\)\.textContent=statusMsg;/.test(refreshSrc));
check("a paused response tells the clicker plainly, with the time of the lines shown",
  refreshSrc.includes("if(data.paused){") && refreshSrc.includes("Showing lines from ${when||\"the last refresh\"}.") && refreshSrc.includes('pgAlert({title:"Live lines paused"'));
check("header Refresh is a secondary control, not the green primary button",
  htmlSrc.includes('<button class="btn header-refresh" id="refreshBtn"') && !htmlSrc.includes('class="btn btn-go" id="refreshBtn"') && cssSrc.includes("header.app #refreshBtn.header-refresh{"));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
