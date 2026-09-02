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
check("Sagarin Points / Pure Points is pinned to sagpred as historical backtest rank #1",
  ctx.TOP_SYSTEM_RANKS.sagpred?.rank===1);
check("Sagarin Ratings is pinned to sag as historical backtest rank #2",
  ctx.TOP_SYSTEM_RANKS.sag?.rank===2);
check("Golden Mean is not accidentally given the #1/#2 star",
  ctx.TOP_SYSTEM_RANKS.saggm==null);
check("Recent is not accidentally given the #1/#2 star",
  ctx.TOP_SYSTEM_RANKS.sagr==null);
check("Missing #1/#2 composite scores remain null instead of being guessed",
  ctx.TOP_SYSTEM_RANKS.sagpred?.composite===null && ctx.TOP_SYSTEM_RANKS.sag?.composite===null);
check("stale two-year Top-10 ranking is no longer rendered beside current system choices",
  !trackerSrc.includes("★ Top 10") && !trackerSrc.includes("top.composite==null"));

if(failures.length){
  console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);
  process.exit(1);
}
console.log(`\nAll ${total} checks passed.`);
