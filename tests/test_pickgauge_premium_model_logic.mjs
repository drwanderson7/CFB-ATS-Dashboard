// Regression coverage for the one-click PickGauge Premium Model # recipe.
// Protects the exact 100% weights, active-state integrity, live-Vegas-in-pool
// semantics, strict all-six-input requirement, and the single UI button.
import fs from "node:fs";
import vm from "node:vm";

const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
const modelSrc=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");
const trackerSrc=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");
const initSrc=fs.readFileSync(new URL("../app/js/init.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const pricing=fs.readFileSync(new URL("../pricing.html",import.meta.url),"utf8");

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }
function extractFunction(name, source){
  const marker=`function ${name}(`, start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){i++;break;} }
  }
  return source.slice(start,i);
}

// Static preset contract.
const presetCtx={};
vm.createContext(presetCtx);
vm.runInContext(`${systemsSrc}\nglobalThis.__preset=PICKGAUGE_MODEL_PRESET;`,presetCtx);
const preset=JSON.parse(JSON.stringify(presetCtx.__preset));
const sum=Object.values(preset.weights).reduce((a,b)=>a+b,0);
check("PickGauge Model # weights sum to exactly 100%",sum===100);
check("Sagarin Ratings weight is 13%",preset.weights.sag===13);
check("Sagarin Predictor weight is 13%",preset.weights.sagpred===13);
check("Dokter Entropy weight is 22%",preset.weights.dokter===22);
check("SP+ weight is 20%",preset.weights.cfbdsp===20);
check("updated Vegas line weight is 22%",preset.weights.vegas===22);
check("Big 200 weight is 10%",preset.weights.big200===10);
check("the preset enables exactly the five non-market systems",JSON.stringify(preset.systems)==='["sag","sagpred","dokter","cfbdsp","big200"]');

// Exercise model math and active-config detection directly.
const state={enabledSystems:[...preset.systems],weights:{...preset.weights}};
const pred={sag:-4,sagpred:-6,dokter:-5,cfbdsp:-3,big200:-7};
const ctx={
  PICKGAUGE_MODEL_PRESET:preset,
  state,
  predsFor:()=>({...pred}),
  inputsFor:()=>[99,99],
  enabledSystemsOrdered:()=>[...preset.systems],
  games:[],
  round1:n=>Math.round(n*10)/10,
  esc:x=>String(x),
};
vm.createContext(ctx);
for(const fn of ["isPickGaugeModelActive","pickGaugeModelMarketLine","pickGaugeModelValues","pickGaugeModelMissingInputs","pickGaugeModelNumber","weightOf","weightedModel","myNumber"]){
  vm.runInContext(extractFunction(fn,modelSrc),ctx);
}
check("exact preset config is recognized as PickGauge Model #",ctx.isPickGaugeModelActive()===true);
state.enabledSystems=[...preset.systems,"fpi"];
check("adding another model input immediately deactivates the branded preset",ctx.isPickGaugeModelActive()===false);
state.enabledSystems=[...preset.systems]; state.weights.dokter=21;
check("changing one published weight immediately deactivates the branded preset",ctx.isPickGaugeModelActive()===false);
state.weights.dokter=22;

const lockedGame={key:"away@home",vegas:-3,lockedLine:-3,liveVegas:-5,poolLocked:true};
const expected=(-4*.13)+(-6*.13)+(-5*.22)+(-3*.20)+(-5*.22)+(-7*.10);
check("locked-pool PickGauge Model # uses the current live Vegas line, not the locked pool line",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expected)<1e-9);
check("myNumber rounds the fixed 100% recipe normally",ctx.myNumber(lockedGame)===Math.round(expected*10)/10);

const oldPred=ctx.predsFor;
ctx.predsFor=()=>({sag:-4,sagpred:-6,dokter:-5,cfbdsp:-3,big200:null});
check("PickGauge Model # stays blank instead of re-normalizing when one of six inputs is missing",
  ctx.pickGaugeModelNumber(lockedGame)===null && ctx.weightedModel(lockedGame,true)===null);
ctx.predsFor=oldPred;
const lockedNoLive={...lockedGame,liveVegas:null};
check("a locked pool with no current live line is incomplete rather than substituting the stale locked line",
  ctx.pickGaugeModelNumber(lockedNoLive)===null);

// One-click application must replace BP/Comp/custom systems and write exact weights.
const applyCtx={
  PICKGAUGE_MODEL_PRESET:preset,
  state:{enabledSystems:["bp","comp","fpi"],weights:{bp:3,comp:2,fpi:7,vegas:0}},
  save:()=>{}, renderSystemsSettings:()=>{}, renderBoard:()=>{}, updateSystemsCount:()=>{},
};
vm.createContext(applyCtx);
vm.runInContext(extractFunction("applyPickGaugeModelPreset",trackerSrc),applyCtx);
applyCtx.applyPickGaugeModelPreset();
check("one click replaces the prior model selection with only the PickGauge recipe systems",
  JSON.stringify(applyCtx.state.enabledSystems)===JSON.stringify(preset.systems));
check("one click writes exactly the six published weights and removes old custom weights",
  JSON.stringify(applyCtx.state.weights)===JSON.stringify(preset.weights));

// UI/wiring/product copy contract.
const buttonMatches=[...html.matchAll(/id="pickGaugeModelBtn"/g)];
check("Prediction Systems contains exactly one PickGauge Model # button",buttonMatches.length===1 && html.includes('>PickGauge Model #</button>'));
check("PickGauge Model # button is wired to the one-click preset action",initSrc.includes('pgModelBtn.onclick=applyPickGaugeModelPreset'));
check("the button exposes pressed-state semantics for active/inactive UI",html.includes('aria-pressed="false"') && trackerSrc.includes('pgBtn.setAttribute("aria-pressed"'));
check("the draft Premium tier lists PickGauge Model # as a Pro differentiator",pricing.includes('<b>PickGauge Model #</b>') && pricing.includes('Sagarin Ratings 13%'));

const picksSrc=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
check("pick snapshots explicitly tag branded PickGauge Model # decisions for later analytics",
  picksSrc.includes('modelPresetAtPick:') && picksSrc.includes('?"pickgauge":null'));
check("pick snapshots preserve the updated Vegas ingredient separately from the pool locked edge reference",
  picksSrc.includes('modelInputs.vegas=') && picksSrc.includes('pickGaugeModelMarketLine(g):V'));

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
