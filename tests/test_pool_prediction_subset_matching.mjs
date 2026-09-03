// Regression for a pool board that intentionally contains only a subset of the
// full weekly PredictionTracker feed. Off-pool prediction rows must not be
// treated as parsing/matching failures. The actionable mismatch direction is
// pool-board games that did not receive prediction data.
import fs from "node:fs";
import vm from "node:vm";

const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const pdfSrc=fs.readFileSync(new URL("../app/js/pdf-import.js",import.meta.url),"utf8");
const aliasSrc=fs.readFileSync(new URL("../app/data/team-alias.js",import.meta.url),"utf8");

function extractFunction(name,source){
  const marker=`function ${name}(`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){ i++; break; } }
  }
  return source.slice(start,i);
}
function extractConst(name,source){
  const marker=`const ${name}=`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  const semi=source.indexOf(";",start); return source.slice(start,semi+1);
}

const warns=[];
const ctx={
  console:{warn:(...args)=>warns.push(args),log:()=>{},error:()=>{}},
  round1:n=>Math.round(Number(n)*10)/10,
  mkey:(a,h)=>`${a}@${h}`,
};
vm.createContext(ctx);
vm.runInContext(extractConst("TEAM_ALIAS",aliasSrc),ctx);
vm.runInContext(extractConst("SIGNIFICANT_TOKENS",pdfSrc),ctx);
for(const f of ["teamTokens","aliasOf","prefixOk","teamMatch"]) vm.runInContext(extractFunction(f,pdfSrc),ctx);
vm.runInContext(extractConst("TRACKER_TEAM_ALIASES",mainSrc),ctx);
vm.runInContext(extractFunction("normTracker",mainSrc),ctx);
ctx.teamMatchTrunc=(a,b)=>ctx.teamMatch(a,b);
ctx.applyCfbdDerivedPredictions=()=>{};
ctx.isDemo=false; ctx.demoInputs={};
ctx.currentPool=()=>({id:"madwood"});

// 25 intentionally selected pool games. Names are arbitrary but unique and the
// prediction rows below mirror them exactly, which isolates subset semantics.
ctx.games=Array.from({length:25},(_,i)=>({
  key:`Away ${i+1}@Home ${i+1}`,
  away:`Away ${i+1}`,
  home:`Home ${i+1}`,
}));
const onPool=ctx.games.map((g,i)=>({road:g.away,home:g.home,systems:{sag:i+1}}));
const offPool=Array.from({length:18},(_,i)=>({road:`Extra Away ${i+1}`,home:`Extra Home ${i+1}`,systems:{sag:100+i}}));
ctx.state={predictions:[...onPool,...offPool]};
vm.runInContext('let predByKey={}; let lastPredUnmatched=[]; let lastBoardPredMissing=[];',ctx);
vm.runInContext(extractFunction("_finishApplyPredictions",pdfSrc),ctx);
vm.runInContext(extractFunction("applyPredictions",pdfSrc),ctx);

const matched=ctx.applyPredictions();
const offBoard=vm.runInContext('lastPredUnmatched',ctx);
const missing=vm.runInContext('lastBoardPredMissing',ctx);
let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
check("25 pool games all receive predictions",matched===25);
check("18 extra weekly prediction rows remain off-board by design",offBoard.length===18);
check("zero pool games are missing prediction data",missing.length===0);
check("off-pool rows do not emit a warning",warns.length===0);

// Now remove one on-pool prediction. This is the direction that SHOULD warn.
warns.length=0;
ctx.state.predictions=[...onPool.slice(0,24),...offPool];
const matched2=ctx.applyPredictions();
const missing2=vm.runInContext('lastBoardPredMissing',ctx);
check("one missing pool row reduces matched count to 24",matched2===24);
check("one pool game is identified as missing prediction data",missing2.length===1&&missing2[0].away==="Away 25");
check("missing pool data emits exactly one actionable warning",warns.length===1&&String(warns[0][0]).includes("Pool games missing"));

if(failures) process.exit(1);
console.log("Pool prediction subset-matching regression passed.");
