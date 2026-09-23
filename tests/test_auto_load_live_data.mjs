// Regression tests for automatic lines + model loading (Sept 23, 2026).
//
// Before this, init() only PULLED the shared tier; if nobody had refreshed
// recently, a signed-in person landed on stale/empty data and had to press
// Refresh lines, then Load models. liveDataStaleness()/autoLoadLiveData()
// (app/js/odds.js) now do that automatically through the SAME
// refreshLines()/fetchPredictions() paths (so the existing client and
// server freshness gates still decide whether a real upstream call happens).
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

function makeCtx({ state, signedIn = true, refreshImpl, predImpl }) {
  const calls = { refresh: [], preds: [], archive: 0, render: 0 };
  const ctx = {
    window: { Clerk: signedIn ? { user: { id: "u" } } : {} },
    state,
    SHARED_FRESH_MINUTES: 30,
    Date: class extends Date { static now() { return NOW; } },
    console,
    refreshLines: async (opts) => { calls.refresh.push(opts); if (refreshImpl) await refreshImpl(ctx); },
    fetchPredictions: async (opts) => { calls.preds.push(opts); if (predImpl) await predImpl(ctx); },
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

// --- autoLoadLiveData orchestration --------------------------------------------
{
  const state = { lastGames: [], predictions: [] };
  const ctx = makeCtx({ state });
  await ctx.autoLoadLiveData("startup");
  check("stale startup calls refreshLines with {auto:true}", ctx.__calls.refresh.length === 1 && ctx.__calls.refresh[0].auto === true);
  check("stale startup calls fetchPredictions with {auto:true}", ctx.__calls.preds.length === 1 && ctx.__calls.preds[0].auto === true);
  check("finished auto-load runs the weekly auto-archive sweep", ctx.__calls.archive === 1);
  check("finished auto-load re-renders so no loading state can outlive the fetch", ctx.__calls.render === 1);
  check("in-flight flag is cleared afterwards", ctx.__inFlight() === null);
}
{
  const state = { lastGames: [], predictions: [] };
  // The lines refresh re-pulls the shared tier, which brings fresh
  // predictions with it -- the second fetch must be skipped.
  const ctx = makeCtx({ state, refreshImpl: (c) => { c.state.lastGames = freshGames; c.state.lastRefresh = ago(0); c.state.predictions = [{}]; c.state.predMeta = { fetchedAt: ago(0) }; } });
  await ctx.autoLoadLiveData("startup");
  check("predictions fetch is skipped when the lines refresh already brought fresh predictions", ctx.__calls.refresh.length === 1 && ctx.__calls.preds.length === 0);
}
{
  const state = { lastGames: freshGames, lastRefresh: ago(2), predictions: [{}], predMeta: { fetchedAt: ago(2) } };
  const ctx = makeCtx({ state });
  const r = await ctx.autoLoadLiveData("resume");
  check("fresh data -> no network calls at all", r === false && ctx.__calls.refresh.length === 0 && ctx.__calls.preds.length === 0);
  check("fresh data still runs the auto-archive sweep (a week can end without new data)", ctx.__calls.archive === 1);
}
{
  const ctx = makeCtx({ state: {}, signedIn: false });
  await ctx.autoLoadLiveData("startup");
  check("guest / signed-out sessions never auto-load through the signed-in paths", ctx.__calls.refresh.length === 0 && ctx.__calls.preds.length === 0);
}
{
  let release;
  const gate = new Promise((r) => { release = r; });
  const ctx = makeCtx({ state: {}, refreshImpl: () => gate });
  const a = ctx.autoLoadLiveData("startup");
  const b = ctx.autoLoadLiveData("resume");
  check("a second trigger while one is in flight does not start another refresh", ctx.__calls.refresh.length === 1);
  release(); await Promise.all([a, b]);
  check("...and only one lines refresh actually ran", ctx.__calls.refresh.length === 1);
}
{
  const ctx = makeCtx({ state: {}, refreshImpl: () => { throw new Error("boom"); } });
  const origErr = console.error; console.error = () => {};
  await ctx.autoLoadLiveData("startup");
  console.error = origErr;
  check("a thrown refresh error is contained (no unhandled rejection) and the flag clears", ctx.__inFlight() === null && ctx.__calls.render === 1);
}

// --- Structural wiring -----------------------------------------------------------
const refreshSrc = extractFunction("refreshLines", oddsSrc);
check("refreshLines() accepts an opts object and treats only {auto:true} as automatic (a click's DOM event never is)",
  refreshSrc.startsWith("async function refreshLines(opts)") && refreshSrc.includes("const auto=!!(opts&&opts.auto===true);"));
check("an automatic refresh never navigates to Settings on a missing key", refreshSrc.includes('if(result.kind==="missing_key"&&!auto){ goSettings(result.error); return; }'));
check("fetchPredictions() uses the same {auto:true} convention", extractFunction("fetchPredictions", predSrc).includes("const auto=!!(opts&&opts.auto===true);"));
check("init() starts the auto-load after first paint", initSrc.includes('autoLoadLiveData("startup");'));
check("init() re-checks when a tab becomes visible again, bound only once", initSrc.includes('document.addEventListener("visibilitychange"') && initSrc.includes("window.__pgAutoLoadResumeBound"));
check("This Week shows a loading state (not a 'Load models' button) during the auto-load", snapSrc.includes("function snapshotAutoLoading()") && snapSrc.includes("Loading this week's lines and models…"));
check("header Refresh is a secondary control now, not the green primary button",
  htmlSrc.includes('<button class="btn header-refresh" id="refreshBtn"') && !htmlSrc.includes('class="btn btn-go" id="refreshBtn"') && cssSrc.includes("header.app #refreshBtn.header-refresh{"));

if (failures.length) {
  console.log(`\n${failures.length} of ${total} FAILURE(S):`, failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
