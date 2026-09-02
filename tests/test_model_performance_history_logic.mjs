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
  // Derived functions aren't needed here because cfbdsp already exists in
  // the raw systems object; returning null leaves that source untouched.
  cfbdRatingForTeam:()=>null,
  cfbdDerivedSpread:()=>null,
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

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
