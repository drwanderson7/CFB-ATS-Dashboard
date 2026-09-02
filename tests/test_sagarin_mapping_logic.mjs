import fs from "node:fs";
import vm from "node:vm";

const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const trackerSrc=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");

const failures=[];
let total=0;
function check(name,cond){
  total++;
  console.log(`[${cond?"PASS":"FAIL"}] ${name}`);
  if(!cond) failures.push(name);
}

function extractConstLiteral(src,name,endToken){
  const marker=`const ${name}=`;
  const start=src.indexOf(marker);
  if(start<0) throw new Error(`Could not find ${name}`);
  const valueStart=start+marker.length;
  const end=src.indexOf(endToken,valueStart);
  if(end<0) throw new Error(`Could not find end of ${name}`);
  return src.slice(valueStart,end+endToken.length-1).trim();
}

const systemsLiteral=extractConstLiteral(systemsSrc,"PRED_SYSTEMS","];");
const ranksLiteral=extractConstLiteral(mainSrc,"TOP_SYSTEM_RANKS","};");
const ctx={};
vm.createContext(ctx);
vm.runInContext(`PRED_SYSTEMS=${systemsLiteral}; TOP_SYSTEM_RANKS=${ranksLiteral};`,ctx);

const byCode=Object.fromEntries(ctx.PRED_SYSTEMS.map(s=>[s.code,s.name]));

check("sagpred is the app's Sagarin Predictor code",byCode.sagpred==="Sagarin Predictor");
check("sag is the app's overall Sagarin Rating code",byCode.sag==="Sagarin (Rating)");
check("Sagarin Points / Pure Points is pinned to sagpred as backtest rank #1",
  ctx.TOP_SYSTEM_RANKS.sagpred?.rank===1);
check("Sagarin Ratings is pinned to sag as backtest rank #2",
  ctx.TOP_SYSTEM_RANKS.sag?.rank===2);
check("Golden Mean is not accidentally given the #1/#2 star",
  ctx.TOP_SYSTEM_RANKS.saggm==null);
check("Recent is not accidentally given the #1/#2 star",
  ctx.TOP_SYSTEM_RANKS.sagr==null);
check("sagpred/sag now carry real backtest composite scores, not guessed placeholders",
  ctx.TOP_SYSTEM_RANKS.sagpred?.composite===8.82 && ctx.TOP_SYSTEM_RANKS.sag?.composite===11.62);
check("cfbdsp (SP+) carries the Top 7 badge per Drew's Sept 2 request, with composite left null since it was never in the real backtest",
  ctx.TOP_SYSTEM_RANKS.cfbdsp?.rank===7 && ctx.TOP_SYSTEM_RANKS.cfbdsp?.composite===null);
check("TOP_SYSTEM_RANKS carries exactly the 7 systems Drew named, no more",
  Object.keys(ctx.TOP_SYSTEM_RANKS).sort().join(",")==="cfbdsp,dokter,fpi,sag,sagpred,teamrank,wayward");
check("the current \"★ Top 7\" badge is rendered beside system choices again",
  trackerSrc.includes("★ Top 7"));

if(failures.length){
  console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
