// Regression coverage for normalizeState()'s BP/Comp-migration-vs-new-
// account-defaults split (app/js/main.js).
//
// Found Aug 26 against a real account (screenshot): a genuinely brand-new
// user was landing with BP + Comp pre-checked and weighted 1 in the
// Prediction Systems panel. The code responsible was never a "default" in
// the normal sense -- it was a one-time migration meant to preserve an
// EXISTING account's pre-toggle behavior (BP/Comp used to always count
// toward My# unconditionally) -- but its trigger condition
// (`!s._bpCompMigrated`) is equally true for an account that has simply
// never existed before, since neither case has the flag set yet. Fixed by
// computing `_hadPriorState` (several independent real-usage signals) at
// the very top of normalizeState(), before any migration in this same
// function could set a flag that would erase the account's real age, and
// branching the migration on it: a genuine pre-existing account still gets
// BP/Comp preserved exactly as before; a genuinely brand-new account gets
// Drew's explicit Aug 26 call instead -- Sagarin (Rating) + SP+ ("sag" /
// "cfbdsp") on by default, nothing else.
import fs from "node:fs";
import vm from "node:vm";

const systemsSrc=fs.readFileSync(new URL("../app/data/pred-systems.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");

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

function makeCtx(){
  const ctx={ console, JSON, Array, Object, Number, Set, uid:()=>"test-uid" };
  vm.createContext(ctx);
  // Real dependency normalizeState() actually reads at runtime -- load the
  // real pred-systems.js, same as app/index.html's own script order, so
  // this exercises the exact same PICKGAUGE_MODEL_PRESET code path
  // normalizeState() hits in production, not a stubbed-out approximation.
  vm.runInContext(systemsSrc, ctx);
  vm.runInContext(extractFunction("normalizeState", mainSrc), ctx);
  return ctx;
}

// ---------------------------------------------------------------------------
// Brand-new account: normalizeState(null) is exactly what load() passes
// when localStorage has nothing at all (app/js/main.js's own load()).
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const s=ctx.normalizeState(null);
  check("brand-new account (normalizeState(null)): Sagarin (Rating) is on by default",
    s.enabledSystems.includes("sag"));
  check("brand-new account (normalizeState(null)): SP+ is on by default",
    s.enabledSystems.includes("cfbdsp"));
  check("brand-new account (normalizeState(null)): BP is NOT on by default",
    !s.enabledSystems.includes("bp"));
  check("brand-new account (normalizeState(null)): Comp is NOT on by default",
    !s.enabledSystems.includes("comp"));
  check("brand-new account (normalizeState(null)): exactly two systems enabled, nothing extra",
    s.enabledSystems.length===2);
  check("brand-new account: migration flag still gets set (so this doesn't re-run every load)",
    s._bpCompMigrated===true);
}

// Same real-world case as above, but via `{}` -- what sync.js's own
// `{...remote, ...sharedNow}` spread produces for a server GET that came
// back with no saved private state at all (spreading null/undefined still
// yields `{}`, not `null`, so this is the actual shape that call site sees
// for a brand-new account, not normalizeState(null) directly).
{
  const ctx=makeCtx();
  const s=ctx.normalizeState({});
  check("brand-new account via {} (sync.js's real shape for a fresh server GET): Sagarin (Rating) on",
    s.enabledSystems.includes("sag"));
  check("brand-new account via {} (sync.js's real shape for a fresh server GET): SP+ on",
    s.enabledSystems.includes("cfbdsp"));
  check("brand-new account via {}: BP/Comp NOT auto-added",
    !s.enabledSystems.includes("bp") && !s.enabledSystems.includes("comp"));
}

// ---------------------------------------------------------------------------
// Genuine pre-existing account (has real prior usage signals, just hasn't
// run this exact migration yet) -- must still get BP/Comp preserved,
// unchanged from before this fix. Several independent real-account shapes,
// since _hadPriorState checks multiple signals and any one should be
// sufficient on its own.
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const s=ctx.normalizeState({enabledSystems:["sag"]}); // had manually enabled something already
  check("pre-existing account (had an enabled system already): BP auto-added",
    s.enabledSystems.includes("bp"));
  check("pre-existing account (had an enabled system already): Comp auto-added",
    s.enabledSystems.includes("comp"));
  check("pre-existing account (had an enabled system already): their real prior choice (sag) untouched",
    s.enabledSystems.includes("sag"));
}
{
  const ctx=makeCtx();
  const s=ctx.normalizeState({weights:{sag:2}}); // had a real custom weight saved
  check("pre-existing account (had a custom weight saved): BP/Comp both auto-added",
    s.enabledSystems.includes("bp") && s.enabledSystems.includes("comp"));
}
{
  const ctx=makeCtx();
  const s=ctx.normalizeState({pools:[{key:"p1",games:[]}]}); // had a real pool
  check("pre-existing account (had a real saved pool): BP/Comp both auto-added",
    s.enabledSystems.includes("bp") && s.enabledSystems.includes("comp"));
}
{
  const ctx=makeCtx();
  // The exact real shape a pre-fix account already carries: this fix's own
  // _bpCompMigrated flag from a PREVIOUS session, already true.
  const s=ctx.normalizeState({_bpCompMigrated:true, enabledSystems:["dokter"]});
  check("account that already ran the OLD migration in a prior session: is left alone, not re-migrated",
    s.enabledSystems.length===1 && s.enabledSystems[0]==="dokter");
}

console.log("");
console.log(`${total-failures.length}/${total} checks passed`);
if(failures.length){ console.log("FAILED:"); failures.forEach(f=>console.log(`  - ${f}`)); process.exit(1); }
process.exit(0);
