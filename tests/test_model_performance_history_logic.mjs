// Full-slate model-performance snapshot + analytics regression coverage.
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/record.js",import.meta.url),"utf8");

const state={
  book:"consensus",enabledSystems:[],modelPerformanceHistory:[],
  lastGames:[{id:"odds-1",away:"Away",home:"Home",commence:"2026-09-05T16:00:00Z",books:{bookA:-3,bookB:-4}}],
  predictions:[{road:"Away",home:"Home",systems:{sag:-6,sagpred:-5,teamrank:-4,cfbdsp:-5,wayward:-7,fpi:-2}}],
};
let saves=0;
const ctx={
  console,state,
  PRED_SYSTEMS:[{code:"sag",name:"Sagarin"},{code:"sagpred",name:"Sagarin Predictor"},{code:"teamrank",name:"Team Rankings"},{code:"cfbdsp",name:"SP+"},{code:"wayward",name:"Waywardtrends"},{code:"fpi",name:"ESPN FPI"}],
  PRED_NAME:{sag:"Sagarin",sagpred:"Sagarin Predictor",teamrank:"Team Rankings",cfbdsp:"SP+",wayward:"Waywardtrends",fpi:"ESPN FPI"},
  FEATURED_SYSTEM_CODES:new Set(["sag","sagpred","teamrank","cfbdsp","wayward","fpi"]),
  PICKGAUGE_MODEL_PRESET:{systems:["teamrank","sagpred","cfbdsp","wayward","sag"],weights:{teamrank:20,vegas:19,sagpred:18,cfbdsp:16,wayward:15,sag:12}},
  resolveVegasLine:()=>({line:-3.5,book:"consensus"}),
  normTracker:x=>x,
  teamMatchTrunc:(a,b)=>String(a).toLowerCase()===String(b).toLowerCase(),
  mkey:(a,h)=>`${a}@${h}`,
  applyCfbdIdentityToGame:g=>Object.assign(g,{cfbdGameId:101,cfbdSeason:2026,cfbdWeek:1,cfbdStartDate:"2026-09-05T16:00:00Z",cfbdAwaySchool:"Away",cfbdHomeSchool:"Home"}),
  save:()=>{saves++;},
  esc:x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  fmt:n=>{ if(n==null||isNaN(n)) return "—"; const r=Math.round(n*10)/10; return (r>0?"+":"")+r.toFixed(1); },
  // Derived functions aren't needed here because cfbdsp already exists in
  // the raw systems object; returning null leaves that source untouched.
  cfbdRatingForTeam:()=>null,
  cfbdDerivedSpread:()=>null,
  // record.js calls round1() at runtime; in production it's defined by
  // app/js/main.js, which loads after record.js on the page (function
  // declarations resolve by the time anything actually calls them).
  round1:n=>Math.round(n*10)/10,
};
vm.createContext(ctx);vm.runInContext(src,ctx);

const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}
const before=Date.parse("2026-08-30T12:00:00Z");
const captured=ctx.captureModelPerformanceSnapshot(before);
check("captures a full-slate game before kickoff",captured>0&&state.modelPerformanceHistory.length===1&&state.modelPerformanceHistory[0].games.length===1);
const gm=state.modelPerformanceHistory[0].games[0];
check("freezes market line and canonical identity",gm.marketHomeLine===-3.5&&gm.cfbdGameId===101&&gm.startDate==="2026-09-05T16:00:00Z");
check("captures featured source predictions",gm.systems.sag===-6&&gm.systems.fpi===-2);
check("calculates PickGauge Model # independently of UI mode",Number.isFinite(gm.systems.pickgauge));
check("capture persists private history",saves===1);

// A later pre-kick refresh should update values while preserving already-known
// result keys (normally empty pre-kick, but preservation matters under sync).
gm.systemResults={sag:"W"};
state.predictions[0].systems.sag=-7;
ctx.resolveVegasLine=()=>({line:-4,book:"consensus"});
ctx.captureModelPerformanceSnapshot(Date.parse("2026-09-04T12:00:00Z"));
check("later pre-kick refresh updates the same game instead of duplicating it",state.modelPerformanceHistory[0].games.length===1&&gm.systems.sag===-7&&gm.marketHomeLine===-4);
check("pre-kick refresh preserves existing grading keys",gm.systemResults.sag==="W");

const frozen=JSON.stringify(gm);
ctx.resolveVegasLine=()=>({line:-1,book:"consensus"});
state.predictions[0].systems.sag=-20;
const post=ctx.captureModelPerformanceSnapshot(Date.parse("2026-09-05T18:00:00Z"));
check("post-kick refresh cannot rewrite historical model snapshot",post===0&&JSON.stringify(gm)===frozen);

const hist=[{season:2026,week:1,games:[
  {cfbdGameId:1,marketHomeLine:-3,systems:{pickgauge:-2,sag:-2},systemResults:{pickgauge:"W",sag:"L"}},
  {cfbdGameId:2,marketHomeLine:7,systems:{pickgauge:8,sag:8},systemResults:{pickgauge:"L",sag:"W"}},
  {cfbdGameId:3,marketHomeLine:0,systems:{pickgauge:-5,sag:0},systemResults:{pickgauge:"P",sag:"N"}},
]}];
const a=ctx.modelPerformanceAnalytics(hist,{season:"2026",week:"1"});
check("PickGauge is surfaced first in the model leaderboard",a.systems[0].code==="pickgauge");
check("ATS win rate excludes pushes",a.pickgauge.W===1&&a.pickgauge.L===1&&a.pickgauge.P===1&&Math.abs(a.pickgauge.winPct-.5)<1e-9);
check("exact model=market observations are no-leans, not ATS decisions",a.systems.find(s=>s.code==="sag").N===1&&a.systems.find(s=>s.code==="sag").n===2);
check("PickGauge edge buckets use model-vs-market gap",a.pgEdgeBuckets.find(x=>x.label==="5.0+").n===1);
check("PickGauge favorite/underdog split uses hypothetical picked-side line",a.pgFavoriteDogBuckets.find(x=>x.label==="Favorites").n===1&&a.pgFavoriteDogBuckets.find(x=>x.label==="Underdogs").n===1);
check("PickGauge home/away split follows model lean direction",a.pgHomeAwayBuckets.find(x=>x.label==="Home").n===1&&a.pgHomeAwayBuckets.find(x=>x.label==="Away").n===2);

// ---------------------------------------------------------------------------
// BUG FIXED Sept 3, 2026 (Drew's explicit request to see "Sagarin Ratings
// went 24-18 this week" on Results): modelPerformanceRows() used to always
// read g.marketHomeLine -- the line frozen at THIS account's own last
// pre-kick snapshot -- even after grade_picks.py's _grade_model_
// performance() (Sept 2, 2026) started grading g.systemResults against the
// real, shared closing line (g.closingHomeLine) whenever one was resolved.
// That meant the displayed side/edge/pickedLine (and every breakdown built
// on them) could describe a DIFFERENT number than the one that actually
// produced each system's W/L/P record. Now prefers g.closingHomeLine,
// falling back to g.marketHomeLine only when no closing line was resolved
// -- the same fallback grading itself already uses.
// ---------------------------------------------------------------------------
{
  // sag predicted -6 (home leans big favorite). The STALE captured line was
  // -3 (would show "leaning home, edge 3"). The REAL closing line was -8
  // (home was actually a BIGGER favorite than sag predicted) -- so against
  // the real close, sag's -6 is actually the AWAY-leaning side (pred > market).
  // The stored systemResults reflects grading against the real close ("L");
  // the DISPLAY must now agree with that, not describe the stale line's
  // "home, edge 3" instead.
  const closingLineHist=[{season:2026,week:2,games:[
    {cfbdGameId:10,marketHomeLine:-3,closingHomeLine:-8,systems:{sag:-6},systemResults:{sag:"L"}},
  ]}];
  const rows=ctx.modelPerformanceRows(closingLineHist,{season:"all",week:"all"});
  check("modelPerformanceRows(): prefers the real closing line (-8) over the stale captured line (-3) when both are present",
    rows[0].market===-8);
  check("modelPerformanceRows(): side is computed consistently with the closing line, not the stale one (pred -6 vs close -8 -> pred>market -> away)",
    rows[0].side==="away");

  // No closing line resolved for this game (e.g. no shared preKickLines
  // record existed) -- must fall back to marketHomeLine exactly as before,
  // not silently drop the row.
  const noClosingLineHist=[{season:2026,week:2,games:[
    {cfbdGameId:11,marketHomeLine:-3,closingHomeLine:null,systems:{sag:-6},systemResults:{sag:"W"}},
  ]}];
  const rowsFallback=ctx.modelPerformanceRows(noClosingLineHist,{season:"all",week:"all"});
  check("modelPerformanceRows(): falls back to marketHomeLine when no closing line was resolved for that game",
    rowsFallback[0].market===-3);
}

// ---------------------------------------------------------------------------
// WIDENED Sept 8, 2026 (Drew's explicit follow-up call): modelPerformanceRows()'s
// side computation now uses the same +/-0.1 MODEL_TIE_TOLERANCE as
// api/grade_picks.py's grading, not exact/near-exact equality. Keeping these
// in sync matters -- a game grade_picks.py graded "N" (no lean) but this file
// still computed a real home/away side for would display a contradictory row
// (e.g. "leaning home +3" next to a result of "—"), the exact class of bug
// the Sept 3, 2026 closing-line fix above was written to prevent.
// ---------------------------------------------------------------------------
{
  // 0.06 off the market -- inside the widened 0.1 tolerance even though it
  // rounds to a DIFFERENT displayed number than the market (-27.9 vs -28.0,
  // i.e. this would show Edge +0.1 on screen, not 0.0).
  const withinTenthHist=[{season:2026,week:3,games:[
    {cfbdGameId:20,marketHomeLine:-28,systems:{sag:-27.94},systemResults:{sag:"N"}},
  ]}];
  const withinTenthRows=ctx.modelPerformanceRows(withinTenthHist,{season:"all",week:"all"});
  check("modelPerformanceRows(): a prediction 0.06 off the market (a DIFFERENT displayed number, Edge +0.1) still reports side 'none', matching grade_picks.py's widened 0.1 tolerance",
    withinTenthRows[0].side==="none");

  // Just past the boundary -- a real side, not a no-lean.
  const pastTenthHist=[{season:2026,week:3,games:[
    {cfbdGameId:21,marketHomeLine:-28,systems:{sag:-27.85},systemResults:{sag:"L"}},
  ]}];
  const pastTenthRows=ctx.modelPerformanceRows(pastTenthHist,{season:"all",week:"all"});
  check("modelPerformanceRows(): a prediction 0.15 off the market (past the 0.1 window) still reports a real side, not 'none'",
    pastTenthRows[0].side==="away");
}

// ---------------------------------------------------------------------------
// BUG FIXED Sept 7, 2026 (Drew's report: East Carolina @ Alabama graded "L"
// for PickGauge Model # even though Model # and the market both displayed
// as -28.0). The composite is a weighted-average float that can carry tiny
// residue (e.g. -27.983...) without ever being bit-exactly equal to a clean
// market line, even though it rounds to the identical displayed number.
// captureModelPerformanceSnapshot() must round1() it away at capture time so
// storage matches what the UI already shows everywhere else.
// ---------------------------------------------------------------------------
{
  // teamrank/sagpred/cfbdsp/wayward/sag weighted 20/18/16/15/12 against a
  // vegasWeight of 19 chosen so the blend lands a hair off -28 exactly --
  // this reproduces the float residue, not a contrived round number.
  state.predictions[0].systems={sag:-28,sagpred:-28,teamrank:-28,cfbdsp:-27.9,wayward:-28,fpi:-2};
  ctx.resolveVegasLine=()=>({line:-28,book:"consensus"});
  state.modelPerformanceHistory=[];
  ctx.captureModelPerformanceSnapshot(Date.parse("2026-09-04T12:00:00Z"));
  const tieGame=state.modelPerformanceHistory[0].games[0];
  check("composite Model # is rounded to one decimal at capture, matching every other display of it",
    tieGame.systems.pickgauge===Math.round(tieGame.systems.pickgauge*10)/10);
  check("a near-tie composite that rounds to the market line is stored as an exact tie (-28)",
    tieGame.systems.pickgauge===-28);

  // Even if a game's stored value predates this fix (float residue still on
  // disk), modelPerformanceRows() should read it as an ordinary row -- the
  // authoritative tie/no-tie call is grade_picks.py's rounded comparison
  // (covered in Python tests), not a client-side re-derivation here.
  const residueHist=[{season:2026,week:3,games:[
    {cfbdGameId:20,marketHomeLine:-28,systems:{pickgauge:-27.983},systemResults:{pickgauge:"N"}},
  ]}];
  const residueRows=ctx.modelPerformanceRows(residueHist,{season:"all",week:"all"});
  check("a pre-fix unrounded snapshot that grade_picks.py already resolved to N still reports as a no-lean, not a graded decision",
    residueRows[0].result==="N");
}

// ---------------------------------------------------------------------------
// recordModelPerformanceScopeLabel() / heading -- the actual "this week"
// framing Drew asked for. The underlying filter+aggregation already worked;
// this makes the scope explicit in the UI instead of only implicit in the
// filter bar's current selection.
// ---------------------------------------------------------------------------
{
  check("scope label: a specific week + season reads 'Week N, YYYY'",
    ctx.recordModelPerformanceScopeLabel({season:"2026",week:"3"})==="Week 3, 2026");
  check("scope label: a specific week with season='all' reads 'Week N' alone",
    ctx.recordModelPerformanceScopeLabel({season:"all",week:"3"})==="Week 3");
  check("scope label: a specific season with week='all' reads 'YYYY season'",
    ctx.recordModelPerformanceScopeLabel({season:"2026",week:"all"})==="2026 season");
  check("scope label: both 'all' reads 'All weeks'",
    ctx.recordModelPerformanceScopeLabel({season:"all",week:"all"})==="All weeks");
  check("scope label: missing/undefined filters defaults to 'All weeks', doesn't throw",
    ctx.recordModelPerformanceScopeLabel(undefined)==="All weeks");

  const weekHtml=ctx.recordModelPerformanceHTML(hist,{season:"2026",week:"1"});
  check("recordModelPerformanceHTML(): heading names the active week explicitly ('Model performance — Week 1, 2026')",
    weekHtml.includes("Model performance — Week 1, 2026"));
  const allHtml=ctx.recordModelPerformanceHTML(hist,{season:"all",week:"all"});
  check("recordModelPerformanceHTML(): heading reads 'All weeks' when no week filter is active",
    allHtml.includes("Model performance — All weeks"));
}

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
