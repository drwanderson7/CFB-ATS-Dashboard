// Integration regression for the exact PredictionTracker rows that were live
// Sept 2, 2026 while PickGauge showed "PickGauge Model # incomplete".
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
const ctx={console,round1:n=>Math.round(Number(n)*10)/10,mkey:(a,h)=>`${a}@${h}`};
vm.createContext(ctx);
vm.runInContext(extractConst("TEAM_ALIAS",aliasSrc),ctx);
vm.runInContext(extractConst("SIGNIFICANT_TOKENS",pdfSrc),ctx);
for(const f of ["teamTokens","aliasOf","prefixOk","teamMatch"]) vm.runInContext(extractFunction(f,pdfSrc),ctx);
vm.runInContext(extractConst("TRACKER_TEAM_ALIASES",mainSrc),ctx);
vm.runInContext(extractFunction("normTracker",mainSrc),ctx);
// No source row here is ellipsis-truncated; this isolates the real live-source
// normalization + matching behavior used by applyPredictions().
ctx.teamMatchTrunc=(a,b)=>ctx.teamMatch(a,b);
ctx.applyCfbdDerivedPredictions=()=>{};
ctx.isDemo=false; ctx.demoInputs={};
ctx.games=[
  {key:"niu@iowa",away:"Northern Illinois",home:"Iowa"},
  {key:"kent@sc",away:"Kent State",home:"South Carolina"},
  {key:"coastal@wv",away:"Coastal Carolina",home:"West Virginia"},
  {key:"fiu@usf",away:"Florida International",home:"South Florida"},
  {key:"shsu@troy",away:"Sam Houston",home:"Troy"},
  {key:"sjsu@emu",away:"San Jose State",home:"Eastern Michigan"},
];
const systems={teamrank:1,sagpred:2,wayward:3,sag:4};
ctx.state={predictions:[
  {road:"Northern Ill.",home:"Iowa",systems:{...systems}},
  {road:"Kent",home:"South Carolina",systems:{...systems}},
  {road:"Coastal Carolina",home:"West Va.",systems:{...systems}},
  {road:"Florida Intl.",home:"South Florida",systems:{...systems}},
  {road:"Sam Houston St.",home:"Troy St.",systems:{...systems}},
  {road:"San Jose St.",home:"Eastern Mich.",systems:{...systems}},
]};
vm.runInContext('let predByKey={}; let lastPredUnmatched=[]; let lastBoardPredMissing=[];',ctx);
vm.runInContext(extractFunction("_finishApplyPredictions",pdfSrc),ctx);
vm.runInContext(extractFunction("applyPredictions",pdfSrc),ctx);
const matched=ctx.applyPredictions();
const predByKey=vm.runInContext('predByKey',ctx);
const unmatched=vm.runInContext('lastPredUnmatched',ctx);
let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
check("all six real-dialect rows match their board game",matched===6);
check("no real-dialect rows remain unmatched",unmatched.length===0);
for(const g of ctx.games){
  check(`${g.away} @ ${g.home} receives the tracker model object`,predByKey[g.key]&&Object.keys(predByKey[g.key]).length===4);
}
check("affected rows now provide four PredictionTracker recipe feeds before SP+ is added",ctx.games.slice(0,5).every(g=>["teamrank","sagpred","wayward","sag"].every(k=>Number.isFinite(predByKey[g.key][k]))));
if(failures) process.exit(1);
console.log("All live-matchup PredictionTracker integration checks passed.");
