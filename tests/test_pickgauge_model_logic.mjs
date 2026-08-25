// Regression coverage for standalone PickGauge Model # mode.
// Protects the exact internal recipe, standalone state semantics, current-
// Vegas-in-pool behavior, hidden component columns/weights, and the ability to
// turn individual systems back on separately as comparison columns.
import fs from "node:fs";
import vm from "node:vm";

const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
const modelSrc=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");
const trackerSrc=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");
const boardSrc=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const picksSrc=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
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

// Internal recipe contract remains fixed and sums to 100.
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
check("internal recipe contains exactly five non-market prediction models",JSON.stringify(preset.systems)==='["sag","sagpred","dokter","cfbdsp","big200"]');

// Standalone model math/state semantics.
const state={pickGaugeModelEnabled:true,enabledSystems:[],weights:{}};
const pred={sag:-4,sagpred:-6,dokter:-5,cfbdsp:-3,big200:-7};
const ctx={
  PICKGAUGE_MODEL_PRESET:preset,
  state,
  predsFor:()=>({...pred}),
  inputsFor:()=>[99,99],
  enabledSystemsOrdered:()=>[...state.enabledSystems],
  games:[],
  round1:n=>Math.round(n*10)/10,
  esc:x=>String(x),
};
vm.createContext(ctx);
for(const fn of ["isPickGaugeModelActive","pickGaugeModelMarketLine","pickGaugeModelValues","pickGaugeModelMissingInputs","pickGaugeModelNumber","weightOf","weightedModel","myNumber"]){
  vm.runInContext(extractFunction(fn,modelSrc),ctx);
}
check("standalone PickGauge boolean activates the model",ctx.isPickGaugeModelActive()===true);
state.enabledSystems=["fpi"];
check("manually enabling a comparison system does not deactivate PickGauge Model #",ctx.isPickGaugeModelActive()===true);
state.weights.fpi=7;
check("custom/comparison weights do not alter PickGauge active state",ctx.isPickGaugeModelActive()===true);

const lockedGame={key:"away@home",vegas:-3,lockedLine:-3,liveVegas:-5,poolLocked:true};
const expected=(-4*.13)+(-6*.13)+(-5*.22)+(-3*.20)+(-5*.22)+(-7*.10);
check("locked-pool PickGauge Model # uses current live Vegas, not locked pool line",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expected)<1e-9);
check("myNumber uses the standalone PickGauge formula even when comparison systems are enabled",
  ctx.myNumber(lockedGame)===Math.round(expected*10)/10);

const oldPred=ctx.predsFor;
ctx.predsFor=()=>({sag:-4,sagpred:-6,dokter:-5,cfbdsp:-3,big200:null});
check("PickGauge Model # stays blank instead of re-normalizing when one required input is missing",
  ctx.pickGaugeModelNumber(lockedGame)===null && ctx.weightedModel(lockedGame,true)===null);
ctx.predsFor=oldPred;
const lockedNoLive={...lockedGame,liveVegas:null};
check("locked pool with no current live line is incomplete rather than substituting stale locked line",
  ctx.pickGaugeModelNumber(lockedNoLive)===null);

// One-click mode: start clean visually, but do not inject the five internals
// into enabledSystems or write the proprietary recipe into user state.
const applyCtx={
  state:{pickGaugeModelEnabled:false,enabledSystems:["bp","comp","fpi"],weights:{bp:3,comp:2,fpi:7,vegas:0}},
  save:()=>{}, renderSystemsSettings:()=>{}, renderBoard:()=>{}, updateSystemsCount:()=>{},
};
applyCtx.isPickGaugeModelActive=()=>!!applyCtx.state.pickGaugeModelEnabled;
vm.createContext(applyCtx);
vm.runInContext(extractFunction("applyPickGaugeModelPreset",trackerSrc),applyCtx);
applyCtx.applyPickGaugeModelPreset();
check("one click enables standalone PickGauge Model #",applyCtx.state.pickGaugeModelEnabled===true);
check("one click clears prior visible/custom systems so the board starts with PickGauge only",applyCtx.state.enabledSystems.length===0);
check("enabling PickGauge does not write the proprietary preset weights into state",
  JSON.stringify(applyCtx.state.weights)==='{"bp":3,"comp":2,"fpi":7,"vegas":0}');
applyCtx.state.enabledSystems=["sag"];
applyCtx.applyPickGaugeModelPreset();
check("clicking the active PickGauge button turns it off",applyCtx.state.pickGaugeModelEnabled===false);
check("turning PickGauge off preserves any comparison system manually enabled afterward",JSON.stringify(applyCtx.state.enabledSystems)==='["sag"]');

// Model Agreement still works in standalone mode using the five model inputs,
// while excluding Vegas from the count.
const agreeCtx={
  PICKGAUGE_MODEL_PRESET:preset,
  state:{pickGaugeModelEnabled:true,enabledSystems:[]},
  predsFor:()=>({sag:-4,sagpred:-6,dokter:-5,cfbdsp:-3,big200:-7}),
  pickGaugeModelMarketLine:()=>-5,
  myNumber:()=>-5.1,
};
vm.createContext(agreeCtx);
for(const fn of ["isPickGaugeModelActive","pickGaugeModelValues","modelAgreement"]){
  vm.runInContext(extractFunction(fn,modelSrc),agreeCtx);
}
const ag=agreeCtx.modelAgreement({key:"away@home",vegas:-5},"home");
check("PickGauge agreement counts five predictive model ingredients, not Vegas",ag&&ag.total===5);

// UI/wiring contract.
const buttonMatches=[...html.matchAll(/id="pickGaugeModelBtn"/g)];
check("Prediction Systems contains exactly one PickGauge Model # button",buttonMatches.length===1 && html.includes('>PickGauge Model #</button>'));
check("PickGauge Model # button is wired to standalone toggle action",initSrc.includes('pgModelBtn.onclick=applyPickGaugeModelPreset'));
check("button exposes pressed-state semantics",html.includes('aria-pressed="false"') && trackerSrc.includes('pgBtn.setAttribute("aria-pressed"'));
check("Prediction Systems explains that PickGauge appears as one standalone model",html.includes('appears on the board as one standalone model'));
check("Prediction Systems says internal components are not automatically shown as columns",html.includes('component systems are not automatically shown as columns'));
check("board renames the aggregate column to PickGauge Model # while active",boardSrc.includes('const modelLabel=pgActive?"PickGauge Model #":"Model #"'));
check("Snapshot detail hides internal component lines while PickGauge is active",boardSrc.includes('Internal component lines stay behind the scenes'));
check("individual systems remain separate comparison columns while PickGauge is active",trackerSrc.includes('separate comparison column without changing the PickGauge calculation'));
check("active PickGauge Model # hides core numeric custom weight controls",trackerSrc.includes('coreWeights.style.display=pgActive?"none":""'));
check("active PickGauge Model # hides per-system custom weight controls",trackerSrc.includes('const wbox=(on&&!pgActive)?'));
check("checkbox edits no longer deactivate PickGauge Model #",!trackerSrc.includes('if(pgActive) state.weights={}'));
check("Clear all disables standalone PickGauge mode",initSrc.includes('state.pickGaugeModelEnabled=false'));
check("old preset-shaped saved state has a one-time migration into standalone mode",mainSrc.includes('_pickGaugeStandaloneMigrated') && mainSrc.includes('s.pickGaugeModelEnabled=true'));
check("premature Pro/Premium marketing line was removed from pricing",!pricing.includes('<b>PickGauge Model #</b>'));
check("PickGauge pick snapshots tag the model preset",picksSrc.includes('modelPresetAtPick:') && picksSrc.includes('?"pickgauge":null'));
check("PickGauge pick snapshots do not copy proprietary numeric weights into user-exportable pick state",
  picksSrc.includes('do not copy the proprietary numeric recipe into user-exportable pick'));

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
