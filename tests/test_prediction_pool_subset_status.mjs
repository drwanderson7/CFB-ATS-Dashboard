// Runtime regression for the status shown when a pool board is only a subset of
// the weekly PredictionTracker feed. A successful 25/25 Madwood-style match
// must not say that the 18 off-pool rows are errors.
import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");
function makeEl(){ return {style:{},textContent:"",disabled:false}; }
const predStatus=makeEl(), loadBtn=makeEl();
const systemsList={innerHTML:"",querySelectorAll:()=>[],querySelector:()=>({onclick:undefined})};
const rows=Array.from({length:43},(_,i)=>({road:`A${i}`,home:`H${i}`,systems:{},homeVegas:0}));
const ctx={
  document:{
    getElementById:id=>id==="predStatus"?predStatus:id==="loadPredsBtn"?loadBtn:id==="systemsList"?systemsList:null,
    querySelectorAll:()=>[],
  },
  console:{warn:()=>{},error:()=>{},log:()=>{}},
  state:{predictions:null,predMeta:null,enabledSystems:["sag"],weights:{}},
  games:Array.from({length:25},(_,i)=>({key:`g${i}`})),
  currentPool:()=>({id:"madwood"}),
  PRED_SYSTEMS:[],TOP_SYSTEM_RANKS:{},
  lastPredUnmatched:Array.from({length:18},()=>({})),
  lastBoardPredMissing:[],
  SHARED_FRESH_MINUTES:30,
  minsAgo:()=>null,
  weightOf:()=>1,inputsFor:()=>[null,null],esc:s=>String(s??""),save:()=>{},
  pullTier:async()=>true,
  apiFetch:async()=>({ok:true,body:{games:rows,count:43,fetchedAt:"2026-09-03T12:00:00Z",sharedPersisted:false,warnings:[]}}),
  applyPredictions:()=>25,
  renderBoard:()=>{},
};
vm.createContext(ctx);
vm.runInContext(src,ctx);
await ctx.fetchPredictions();
let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
check("pool status reports full board coverage",predStatus.textContent.includes("25/25 pool games matched"));
check("off-pool weekly rows are not labeled unmatched",!predStatus.textContent.toLowerCase().includes("unmatched"));
check("successful full pool coverage remains green",predStatus.style.color==="var(--green-text)");
if(failures) process.exit(1);
console.log("Prediction pool-subset status regression passed.");
