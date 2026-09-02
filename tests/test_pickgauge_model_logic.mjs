// Regression coverage for standalone PickGauge Model # mode.
// Protects the exact internal recipe, standalone state semantics, current-
// Vegas-in-pool behavior, hidden component columns/weights, and the ability to
// turn individual systems back on separately as comparison columns.
import fs from "node:fs";
import vm from "node:vm";

const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
const modelSrc=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");
const trackerSrc=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");
const boardSrc=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8")
  // renderSnapDetailRow() and everything Snapshot-specific moved to its own
  // file (Sept 1, 2026, TODO #24) -- concatenated here under the same
  // boardSrc variable so every check below keeps working unchanged
  // regardless of which of the two files a given string now actually lives in.
  +"\n"+fs.readFileSync(new URL("../app/js/snapshot-export.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const picksSrc=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
const initSrc=fs.readFileSync(new URL("../app/js/init.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8")
  // CSS moved out of index.html into app/css/app.css (Aug 28, pure file-
  // split) -- appended here the same way this codebase already handles
  // every other file split out of index.html.
  + fs.readFileSync(new URL("../app/css/app.css",import.meta.url),"utf8");
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
check("TeamRankings.com weight is 20%",preset.weights.teamrank===20);
check("Vegas Live # weight is 19%",preset.weights.vegas===19);
check("Sagarin Points weight is 18%",preset.weights.sagpred===18);
check("SP+ weight is 16%",preset.weights.cfbdsp===16);
check("Waywardtrends weight is 15%",preset.weights.wayward===15);
check("Sagarin Ratings weight is 12%",preset.weights.sag===12);
check("internal recipe contains exactly five non-market prediction models",JSON.stringify(preset.systems)==='["teamrank","sagpred","cfbdsp","wayward","sag"]');

// Standalone model math/state semantics.
const state={pickGaugeModelEnabled:true,enabledSystems:[],weights:{}};
const pred={teamrank:-4,sagpred:-6,cfbdsp:-3,wayward:-7,sag:-5};
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
for(const fn of ["isPickGaugeModelActive","pickGaugeModelMarketLine","pickGaugeModelValues","pickGaugeModelMissingInputs","pickGaugeModelCoverage","pickGaugeModelNumber","weightOf","weightedModel","myNumber","myBlendActive","myBlendNumber","modelColumnDisplayNumber"]){
  vm.runInContext(extractFunction(fn,modelSrc),ctx);
}
check("standalone PickGauge boolean activates the model",ctx.isPickGaugeModelActive()===true);
state.enabledSystems=["fpi"];
check("manually enabling a comparison system does not deactivate PickGauge Model #",ctx.isPickGaugeModelActive()===true);
state.weights.fpi=7;
check("custom/comparison weights do not alter PickGauge active state",ctx.isPickGaugeModelActive()===true);
// Reset before the pure-recipe pinning tests below -- those specifically
// test PickGauge Model # with NO blend active; leaving "fpi" enabled would
// make myNumber() take the myBlendActive() branch instead (fpi has no
// value in `pred`, so it happens to contribute nothing and the numbers
// would still match by coincidence -- explicit reset instead of relying
// on that).
state.enabledSystems=[];
delete state.weights.fpi;
check("resetting to no comparison systems deactivates any blend (sanity check for the tests below)",ctx.myBlendActive()===false);

const lockedGame={key:"away@home",vegas:-3,lockedLine:-3,liveVegas:-5,poolLocked:true};
const expected=(-4*.20)+(-5*.19)+(-6*.18)+(-3*.16)+(-7*.15)+(-5*.12);
check("locked-pool PickGauge Model # uses current live Vegas, not locked pool line",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expected)<1e-9);
check("myNumber uses the standalone PickGauge formula even when comparison systems are enabled",
  ctx.myNumber(lockedGame)===Math.round(expected*10)/10);

const oldPred=ctx.predsFor;
ctx.predsFor=()=>({teamrank:-4,sagpred:-6,cfbdsp:-3,wayward:-7,sag:null});
const oneMissingCoverage=ctx.pickGaugeModelCoverage(lockedGame);
const baseWithoutSag=20+18+16+15;
const expectedWithoutSag=(-5*.19)+(-4*(.81*20/baseWithoutSag))+(-6*(.81*18/baseWithoutSag))+(-3*(.81*16/baseWithoutSag))+(-7*(.81*15/baseWithoutSag));
check("PickGauge Model # still calculates with exactly one predictive model missing",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expectedWithoutSag)<1e-9 && ctx.weightedModel(lockedGame,true)!==null);
check("one-missing fallback reports 4/5 predictive models available",
  oneMissingCoverage.modelCount===4 && oneMissingCoverage.missingModels.length===1 && oneMissingCoverage.missingModels[0]==="sag");
check("one-missing fallback keeps Vegas at its fixed 19% rather than reweighting the market",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expectedWithoutSag)<1e-9);
ctx.predsFor=()=>({teamrank:-4,sagpred:-6,cfbdsp:-3,wayward:null,sag:null});
const twoMissingCoverage=ctx.pickGaugeModelCoverage(lockedGame);
const baseThreeModels=20+18+16;
const expectedThreeModels=(-5*.19)+(-4*(.81*20/baseThreeModels))+(-6*(.81*18/baseThreeModels))+(-3*(.81*16/baseThreeModels));
check("PickGauge Model # still calculates with exactly two predictive models missing",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expectedThreeModels)<1e-9 && ctx.weightedModel(lockedGame,true)!==null);
check("two-missing fallback reports 3/5 predictive models available",
  twoMissingCoverage.modelCount===3 && twoMissingCoverage.missingModels.length===2);
check("3/5 fallback dynamically rebalances based on which model weights remain while Vegas stays fixed",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expectedThreeModels)<1e-9);
ctx.predsFor=()=>({teamrank:-4,sagpred:null,cfbdsp:null,wayward:-3,sag:-7});
const alternateThreeBase=20+15+12;
const expectedAlternateThree=(-5*.19)+(-4*(.81*20/alternateThreeBase))+(-3*(.81*15/alternateThreeBase))+(-7*(.81*12/alternateThreeBase));
check("3/5 dynamic weights depend on the specific models that are available",
  Math.abs(ctx.pickGaugeModelNumber(lockedGame)-expectedAlternateThree)<1e-9);
ctx.predsFor=()=>({teamrank:-4,sagpred:-6,cfbdsp:null,wayward:null,sag:null});
check("PickGauge Model # stays incomplete with only two predictive models available",
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
  predsFor:()=>({teamrank:-4,sagpred:-6,cfbdsp:-3,wayward:-7,sag:-5}),
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
check("board shows a compact model-coverage note when PickGauge falls back to 3/5 or 4/5 models",boardSrc.includes('pg-model-coverage')&&boardSrc.includes('${pgCoverage.modelCount}/${pgCoverage.totalModels} models'));
check("PickGauge fallback coverage note is styled in the app UI",html.includes('.pg-model-coverage'));
check("model version is bumped for changed 3/5 missing-input semantics AND for My Blend (v4, Sept 1 2026)",modelSrc.includes('const MODEL_VERSION=4;'));
const checkboxMatches=[...html.matchAll(/id="pickGaugeModelBtn"/g)];
check("Prediction Systems contains exactly one PickGauge Model # control",checkboxMatches.length===1 && html.includes('<input type="checkbox" id="pickGaugeModelBtn">'));
check("PickGauge Model # is a real checkbox, not a button (Drew's call, Aug 28 -- a checked/unchecked control reads as more obviously on/off than a background-color swap)",html.includes('class="pickgauge-model-check"') && !html.includes('pickgauge-model-btn"'));
check("PickGauge Model # checkbox is wired to standalone toggle action",initSrc.includes('pgModelBtn.onchange=applyPickGaugeModelPreset'));
check("checkbox's checked state is the on/off indicator (set from real app state every render, not a separate active-class/aria-pressed signal duplicating the same thing)",trackerSrc.includes('pgBtn.checked=pgActive') && !trackerSrc.includes('setAttribute("aria-pressed"'));
check("Prediction Systems explains that PickGauge appears as one standalone model",html.includes('appears on the board as one standalone model'));
check("Prediction Systems says internal components are not automatically shown as columns",html.includes('component systems are not automatically shown as columns'));
check("board renames the aggregate column to PickGauge Model # while active",boardSrc.includes('const modelLabel=pgActive?"PickGauge Model #":"Model #"'));
check("Snapshot detail hides internal component lines while PickGauge is active",boardSrc.includes('Internal component lines stay behind the scenes'));
check("individual systems remain separate comparison columns while PickGauge is active, and blend in too once weighted",html.includes("comparison column only, unless you also give it a weight"));
check("active PickGauge Model # hides core numeric custom weight controls",trackerSrc.includes('coreWeights.style.display=pgActive?"none":""'));
check("per-system custom weight controls stay visible while PickGauge is active (Option 2: they now control My Blend contribution)",
  trackerSrc.includes('const wbox=on?') && !trackerSrc.includes('const wbox=(on&&!pgActive)?'));
check("checkbox edits no longer deactivate PickGauge Model #",!trackerSrc.includes('if(pgActive) state.weights={}'));
check("Clear all disables standalone PickGauge mode",initSrc.includes('state.pickGaugeModelEnabled=false'));
check("old preset-shaped saved state has a one-time migration into standalone mode",mainSrc.includes('_pickGaugeStandaloneMigrated') && mainSrc.includes('s.pickGaugeModelEnabled=true'));
check("premature Pro/Premium marketing line was removed from pricing",!pricing.includes('<b>PickGauge Model #</b>'));
check("PickGauge pick snapshots tag the model preset",picksSrc.includes('modelPresetAtPick:') && picksSrc.includes('?"pickgauge":null'));
check("PickGauge pick snapshots do not copy proprietary numeric weights into user-exportable pick state",
  picksSrc.includes('do not copy the proprietary numeric recipe into user-exportable pick'));

// --- My Blend (Option 2, Sept 1 2026) --------------------------------------
// Real problem this feature solves: with PickGauge active, a manually-
// enabled comparison system used to be strictly read-only -- it could
// never influence Edge/Cover %/CLV/the pick recommendation, no matter its
// weight. myNumber() now blends when there's genuinely something to blend;
// the PICKGAUGE MODEL # COLUMN ITSELF must never change regardless.
{
  const blendCtx={
    PICKGAUGE_MODEL_PRESET:preset,
    state:{pickGaugeModelEnabled:true,enabledSystems:[],weights:{}},
    predsFor:()=>({teamrank:-4,sagpred:-6,cfbdsp:-3,wayward:-7,sag:-5,fpi:-2}),
    inputsFor:()=>[99,99],
    enabledSystemsOrdered:()=>[...blendCtx.state.enabledSystems],
    games:[],
    round1:n=>Math.round(n*10)/10,
    esc:x=>String(x),
  };
  vm.createContext(blendCtx);
  for(const fn of ["isPickGaugeModelActive","pickGaugeModelMarketLine","pickGaugeModelValues","pickGaugeModelMissingInputs","pickGaugeModelCoverage","pickGaugeModelNumber","weightOf","weightedModel","myNumber","myBlendActive","myBlendNumber","modelColumnDisplayNumber"]){
    vm.runInContext(extractFunction(fn,modelSrc),blendCtx);
  }
  const bGame={key:"away@home",vegas:-3,liveVegas:-3};
  const purePg=blendCtx.pickGaugeModelNumber(bGame);

  check("myBlendActive: false with PickGauge on but no comparison systems enabled",blendCtx.myBlendActive()===false);
  check("with no blend active, myNumber() equals the pure PickGauge number, byte for byte -- the common-case no-regression guarantee",
    blendCtx.myNumber(bGame)===Math.round(purePg*10)/10);

  blendCtx.state.enabledSystems=["fpi"];
  check("myBlendActive: false while the enabled system's weight is explicitly 0",
    (blendCtx.state.weights.fpi=0, blendCtx.myBlendActive()===false));
  blendCtx.state.weights.fpi=2;
  check("myBlendActive: true once PickGauge is on AND a comparison system carries positive weight",blendCtx.myBlendActive()===true);

  check("weightOf('pickgauge') defaults to 3, not the general default of 1 (heavier so one new system tilts rather than dilutes 50/50)",
    blendCtx.weightOf("pickgauge")===3);

  // pgWeight (default 3) * purePg + fpiWeight (2) * -2, over den 5.
  const expectedBlend=(3*purePg+2*(-2))/5;
  check("myBlendNumber(): weighted average of the pure PickGauge number (its own weight) and the enabled system's raw value (its own weight)",
    Math.abs(blendCtx.myBlendNumber(bGame)-expectedBlend)<1e-9);
  check("myNumber() returns the blend (rounded) once a blend is active -- this is what Edge/Cover %/CLV/sort actually key off",
    blendCtx.myNumber(bGame)===Math.round(expectedBlend*10)/10);

  check("modelColumnDisplayNumber(): ALWAYS the pure PickGauge number while active, even though myNumber() just changed to the blend -- the one guarantee Option 2 exists to keep",
    blendCtx.modelColumnDisplayNumber(bGame)===Math.round(purePg*10)/10
    && blendCtx.modelColumnDisplayNumber(bGame)!==blendCtx.myNumber(bGame));

  // A user-set PickGauge weight of exactly 1 must not be silently treated
  // as "unset" and reverted to the real default of 3 -- the setWeight()
  // bug this feature's own weightOf() change could have reintroduced (see
  // setWeight()'s own comment in prediction-tracker.js).
  blendCtx.state.weights.pickgauge=1;
  const expectedTilted=(1*purePg+2*(-2))/3;
  check("an explicit PickGauge weight of 1 (not the default 3) is genuinely honored in the blend math",
    Math.abs(blendCtx.myBlendNumber(bGame)-expectedTilted)<1e-9);

  // Disabling the last weighted comparison system collapses back to pure.
  blendCtx.state.weights.fpi=0;
  check("myBlendActive() turns back off once every comparison system's weight returns to 0",blendCtx.myBlendActive()===false);
  check("myNumber() falls back to the pure PickGauge number again once the blend deactivates",
    blendCtx.myNumber(bGame)===Math.round(purePg*10)/10);
}
check("setWeight()'s own default-comparison knows about pickgauge's real default (3), not just vegas's (0) -- otherwise an explicit weight of 1 for pickgauge gets silently deleted and reverts to 3",
  trackerSrc.includes('const dflt=(key==="vegas")?0:(key==="pickgauge"?3:1);'));
check("board.js keeps a separate 'My Blend' column/sort key distinct from 'myn', so sorting by Model # can never silently sort by the blend instead",
  boardSrc.includes('case "myn": return modelColumnDisplayNumber(g);') && boardSrc.includes('case "myblend":'));
check("the My Blend column is hidden by default and only shown via a dedicated visibility class, same pattern as the My Numbers column",
  boardSrc.includes('classList.toggle("hide-myblend"'));
check("the My Blend column's own cell carries an explicit tooltip explaining it drives Edge/Cover %, not the PickGauge column next to it",
  boardSrc.includes("This is what Edge/Cover %/pick recommendations below actually use while a blend is active"));

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
