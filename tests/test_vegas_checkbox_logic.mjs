// Regression coverage for the Sept 2, 2026 "Vegas as a real checkbox"
// feature (Drew's explicit request: "I still don't see functionality for
// anyone to incorporate the live vegas line as part of their model #").
//
// Before this change, Vegas structurally always participated in a custom
// Model # (weightedModel()'s `includeVegas` path), gated only by its own
// weight -- which defaulted to 0 -- with no checkbox anywhere to turn it
// on/off, and no way at all to add it to My Blend once PickGauge Model #
// was active. Now: (a) `vegas` is a real entry in state.enabledSystems,
// exactly like bp/comp/every comparison system; (b) weightOf("vegas")
// defaults to 1 like everything else, since inclusion is now gated by an
// explicit checkbox, not an easy-to-miss weight box; (c) checking it adds
// Vegas to BOTH the fully-custom Model # (weightedModel()) and My Blend
// (myBlendNumber()); (d) a one-time migration (`_vegasCheckboxMigrated`,
// app/js/main.js) preserves a pre-existing account's behavior if they'd
// already set a real nonzero Vegas weight under the old mechanic.
import fs from "node:fs";
import vm from "node:vm";

const modelSrc=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const trackerSrc=fs.readFileSync(new URL("../app/js/prediction-tracker.js",import.meta.url),"utf8");
const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

function extractFunction(name, source){
  const marker=`function ${name}(`, start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name} in source`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){i++;break;} }
  }
  return source.slice(start,i);
}

// ---------------------------------------------------------------------------
// weightOf() / weightedModel() / myBlendActive() / myBlendNumber() -- real
// implementations from model.js, run in a sandboxed vm context with the
// minimal external globals model.js expects (state, inputsFor, predsFor,
// enabledSystemsOrdered, games, round1).
// ---------------------------------------------------------------------------
function makeModelCtx(state, {games=[], inputs={}, preds={}}={}){
  const ctx={
    console, JSON, Array, Object, Number, Math, Set, isNaN,
    state,
    games,
    inputsFor:(key)=>inputs[key]||[null,null],
    predsFor:(key)=>preds[key]||{},
    round1:(n)=>Math.round(n*10)/10,
    PICKGAUGE_MODEL_PRESET:{
      systems:["teamrank","sagpred","cfbdsp","wayward","sag"],
      weights:{teamrank:20,vegas:19,sagpred:18,cfbdsp:16,wayward:15,sag:12},
    },
  };
  vm.createContext(ctx);
  // enabledSystemsOrdered() lives in main.js, not model.js -- pull the real
  // one in too so the vegas/bp/comp exclusion is exercised for real, not
  // stubbed.
  vm.runInContext(extractFunction("enabledSystemsOrdered", mainSrc), ctx);
  const PRED_ORDER_MATCH=mainSrc.match(/const PRED_ORDER=\[[^\]]*\];/);
  if(PRED_ORDER_MATCH) vm.runInContext(PRED_ORDER_MATCH[0], ctx);
  else ctx.PRED_ORDER=[];
  vm.runInContext(modelSrc, ctx);
  return ctx;
}

{
  const state={enabledSystems:["vegas"], weights:{}, pickGaugeModelEnabled:false};
  const ctx=makeModelCtx(state);
  check("weightOf('vegas') now defaults to 1 (like every other input), not 0",
    ctx.weightOf("vegas")===1);
}

{
  // DIY custom Model #, Vegas checked (default weight 1), one other
  // system checked too -- Vegas must actually be counted.
  const state={enabledSystems:["vegas","fpi"], weights:{}, pickGaugeModelEnabled:false};
  const g={key:"a@b", vegas:-7};
  const ctx=makeModelCtx(state,{games:[g], preds:{"a@b":{fpi:-3}}});
  const m=ctx.weightedModel(g,true);
  check("DIY custom Model #: checking Vegas actually includes it in weightedModel() (equal-weight average of -7 and -3)",
    m!==null && Math.abs(m-(-5))<1e-9);
}

{
  // DIY custom Model #, Vegas NOT checked -- must be excluded even though
  // game.vegas exists, matching every other system's checkbox gate.
  const state={enabledSystems:["fpi"], weights:{}, pickGaugeModelEnabled:false};
  const g={key:"a@b", vegas:-7};
  const ctx=makeModelCtx(state,{games:[g], preds:{"a@b":{fpi:-3}}});
  const m=ctx.weightedModel(g,true);
  check("DIY custom Model #: Vegas is excluded when its checkbox is off, even with a real market line present",
    m!==null && Math.abs(m-(-3))<1e-9);
}

{
  // My Blend (PickGauge active): Vegas checked must contribute as an
  // extra blend term alongside the pure PickGauge number.
  const state={enabledSystems:["vegas"], weights:{}, pickGaugeModelEnabled:true};
  const g={key:"a@b", vegas:-10, poolLocked:false};
  const preds={"a@b":{teamrank:-10,sagpred:-10,cfbdsp:-10,wayward:-10,sag:-10}};
  const ctx=makeModelCtx(state,{games:[g], preds});
  const active=ctx.myBlendActive();
  const blend=ctx.myBlendNumber(g);
  check("My Blend: checking only Vegas (no comparison system) still activates the blend",
    active===true);
  check("My Blend: pure PickGauge (-10) blended with Vegas (-10) at equal-ish inputs stays close to -10",
    blend!==null && Math.abs(blend-(-10))<1e-6);
}

{
  // My Blend: Vegas unchecked must NOT silently appear in the blend.
  const state={enabledSystems:[], weights:{}, pickGaugeModelEnabled:true};
  const g={key:"a@b", vegas:-10, poolLocked:false};
  const preds={"a@b":{teamrank:-10,sagpred:-10,cfbdsp:-10,wayward:-10,sag:-10}};
  const ctx=makeModelCtx(state,{games:[g], preds});
  check("My Blend: with nothing checked (Vegas included), myBlendActive() is false -- pure PickGauge only",
    ctx.myBlendActive()===false);
}

// ---------------------------------------------------------------------------
// The UI itself: a real "vegas" checkbox item exists in the systems grid,
// and the old always-visible standalone Vegas weight box is gone.
// ---------------------------------------------------------------------------
check("renderSystemsSettings() now includes a real 'vegas' grid entry (Vegas (live line))",
  trackerSrc.includes('{code:"vegas",name:"Vegas (live line)"}'));
check("setWeight()'s default calc no longer special-cases vegas to 0",
  trackerSrc.includes('const dflt=(key==="pickgauge")?3:1;'));

const htmlSrc=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
check("the old standalone, always-visible cwVegas weight box element is removed from index.html",
  !/<label[^>]*id="cwVegas"/.test(htmlSrc));

// ---------------------------------------------------------------------------
// Migration: normalizeState()'s _vegasCheckboxMigrated block.
// ---------------------------------------------------------------------------
function makeStateCtx(){
  const ctx={ console, JSON, Array, Object, Number, Set, uid:()=>"test-uid" };
  vm.createContext(ctx);
  vm.runInContext(systemsSrc, ctx);
  vm.runInContext(extractFunction("normalizeState", mainSrc), ctx);
  return ctx;
}

{
  const ctx=makeStateCtx();
  const s=ctx.normalizeState(null);
  check("brand-new account: Vegas checkbox is NOT auto-enabled",
    !s.enabledSystems.includes("vegas"));
  check("brand-new account: vegas migration flag still gets set",
    s._vegasCheckboxMigrated===true);
}
{
  // Pre-existing account that had already set a real nonzero Vegas
  // weight under the old always-included mechanic -- must be preserved.
  const ctx=makeStateCtx();
  const s=ctx.normalizeState({weights:{vegas:2}, enabledSystems:["sag"]});
  check("pre-existing account with a real saved Vegas weight: Vegas checkbox auto-enabled so behavior doesn't silently change",
    s.enabledSystems.includes("vegas"));
}
{
  // Pre-existing account whose Vegas weight was left at its old default
  // (never actually stored, since setWeight() didn't persist a value
  // matching the default) -- must NOT be auto-enabled, since 0 weight
  // meant "not contributing" before too.
  const ctx=makeStateCtx();
  const s=ctx.normalizeState({weights:{sag:2}, enabledSystems:["sag"]});
  check("pre-existing account that never touched the old Vegas weight box: Vegas checkbox stays off",
    !s.enabledSystems.includes("vegas"));
}
{
  // Pre-existing account whose Vegas weight was explicitly saved as 0 --
  // same as above, must stay off.
  const ctx=makeStateCtx();
  const s=ctx.normalizeState({weights:{vegas:0,sag:2}, enabledSystems:["sag"]});
  check("pre-existing account with Vegas weight explicitly 0: Vegas checkbox stays off",
    !s.enabledSystems.includes("vegas"));
}
{
  // Already-migrated account (flag already true from a prior session) is
  // left alone even if it now has a nonzero weights.vegas for some other
  // reason (e.g. the user explicitly typed a value into the new grid
  // weight box for an already-checked system) -- migration must not
  // re-run and stomp on later user edits.
  const ctx=makeStateCtx();
  const s=ctx.normalizeState({_vegasCheckboxMigrated:true, weights:{vegas:5}, enabledSystems:["sag"]});
  check("account that already ran the vegas migration: is left alone, not re-migrated",
    !s.enabledSystems.includes("vegas"));
}

console.log("");
console.log(`${total-failures.length}/${total} checks passed`);
if(failures.length){ console.log("FAILED:"); failures.forEach(f=>console.log(`  - ${f}`)); process.exit(1); }
process.exit(0);
