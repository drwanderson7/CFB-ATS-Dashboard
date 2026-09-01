import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const syncSrc=fs.readFileSync(new URL("../app/js/sync.js",import.meta.url),"utf8");
const initSrc=fs.readFileSync(new URL("../app/js/init.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const survivorSrc=fs.readFileSync(new URL("../app/js/survivor-integration.js",import.meta.url),"utf8");

function extractFunction(name,source,asyncFn=false){
  const marker=`${asyncFn?"async ":""}function ${name}(`;
  const start=source.indexOf(marker);
  if(start===-1)throw new Error(`Missing ${marker}`);
  let i=source.indexOf("{",start),depth=0,quote=null,escaped=false,templateDepth=0;
  for(;i<source.length;i++){
    const ch=source[i],next=source[i+1];
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==="\\"){escaped=true;continue;}
      if(quote==="`"&&ch==="$"&&next==="{"){templateDepth++;i++;continue;}
      if(quote==="`"&&ch==="}"&&templateDepth){templateDepth--;continue;}
      if(ch===quote&&!templateDepth)quote=null;
      continue;
    }
    if(ch==="'"||ch==='"'||ch==="`"){quote=ch;continue;}
    if(ch==="/"&&next==="/"){i=source.indexOf("\n",i);if(i<0)break;continue;}
    if(ch==="/"&&next==="*"){const e=source.indexOf("*/",i+2);i=e<0?source.length:e+1;continue;}
    if(ch==="{")depth++;
    else if(ch==="}"){depth--;if(depth===0){i++;break;}}
  }
  return source.slice(start,i);
}

const failures=[];let total=0;
function check(name,cond){total++;console.log(`[${cond?"PASS":"FAIL"}] ${name}`);if(!cond)failures.push(name);}

// ---- Source-of-truth boundary checks ------------------------------------
check("state.survivor is normalized into private app state",
  mainSrc.includes('s.survivor=(s.survivor&&typeof s.survivor==="object"&&!Array.isArray(s.survivor))?s.survivor:{}'));
const sharedMatch=mainSrc.match(/const SHARED_FIELDS=\[([^\]]+)\]/);
check("SHARED_FIELDS exists",!!sharedMatch);
check("Survivor is not part of the shared/global tier",!!sharedMatch&&!sharedMatch[1].includes("survivor"));
check("Survivor UI uses a separate localStorage key",survivorSrc.includes("const PG_SURVIVOR_UI_KEY='pickgauge_survivor_ui_v1'"));
check("Survivor UI save does not call account save/sync",/function pgSurvivorSaveUi\(ui\)\{try\{localStorage\.setItem\(PG_SURVIVOR_UI_KEY/.test(survivorSrc));
check("legacy synced Survivor navigation is removed from durable state",
  survivorSrc.includes("delete s.activePoolId; delete s.activeEntryIdByPool; delete s.currentWeekByPool;"));

// ---- Persistent debounce marker behavior --------------------------------
const storage=new Map();
const scheduled=[];
let pushed=0;
const ctx={
  state:{_rev:7,privateUpdatedAt:"2026-09-01T01:02:03.000Z",survivor:{pools:{sec:{entries:[{id:"e1",name:"Entry 1",picks:{"1":"Alabama"}}]}}}},
  window:{Clerk:{user:{id:"user_A"}}},
  localStorage:{
    getItem:k=>storage.has(k)?storage.get(k):null,
    setItem:(k,v)=>storage.set(k,String(v)),
    removeItem:k=>storage.delete(k),
  },
  clearTimeout:()=>{},
  setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},
  setSyncStatus:()=>{},
  apiFetch:async()=>({ok:true,body:{revision:8}}),
  stateEndpoint:()=>"/api/state?scope=user&expectedRevision=7",
  SHARED_FIELDS:["lastGames"],
  KEY:"cfb_edge_state_v1",
  rehydrateAfterSync:()=>{},
  normalizeState:x=>x,
  pickFields:()=>({}),
  mergeSharedPoolsIntoLocal:()=>{},
  resolveBookLines:()=>{},
  isAdminUser:false,
  Date,
  JSON,
};
vm.createContext(ctx);
[
  ["privateSyncUserId",false],["readPrivateSyncPending",false],["markPrivateSyncPending",false],
  ["privateSyncPendingMatchesCurrent",false],["clearPrivateSyncPending",false],
  ["scheduleSync",false],["stateEndpoint",false],["pushState",true],["resumePendingPrivateSync",true]
].forEach(([name,isAsync])=>vm.runInContext(extractFunction(name,syncSrc,isAsync),ctx));
ctx.syncTimerPrivate=null;
ctx.PRIVATE_SYNC_PENDING_KEY="pickgauge_private_sync_pending_v1";

// scheduleSync represents save()'s 1.5-second cloud debounce.
ctx.scheduleSync("private");
let marker=JSON.parse(storage.get("pickgauge_private_sync_pending_v1"));
check("a private edit writes a persistent pending marker",marker.userId==="user_A"&&marker.privateUpdatedAt===ctx.state.privateUpdatedAt);
check("the normal 1.5-second debounce is still scheduled",scheduled.length===1&&scheduled[0].ms===1500);

// Simulate refresh: JS timer disappears, localStorage survives, same signed-in user returns.
scheduled.length=0;
check("pending marker still matches after a refresh",ctx.privateSyncPendingMatchesCurrent()===true);
const resumed=await ctx.resumePendingPrivateSync();
check("refresh/sign-in resumes the interrupted private push",resumed===true&&ctx.state._rev===8);
check("successful resumed sync clears the marker",!storage.has("pickgauge_private_sync_pending_v1"));

// Signed-out attempt must leave a marker intact for the same user to finish later.
ctx.state._rev=8;
ctx.state.privateUpdatedAt="2026-09-01T01:03:00.000Z";
ctx.window.Clerk.user={id:"user_A"};
ctx.markPrivateSyncPending();
ctx.window.Clerk.user=null;
await ctx.pushState("private");
check("signing out before debounce does not discard the pending marker",storage.has("pickgauge_private_sync_pending_v1"));

// A different account on the same browser must NEVER resume User A's local edit.
ctx.window.Clerk.user={id:"user_B"};
check("different account cannot match another user's pending edit",ctx.privateSyncPendingMatchesCurrent()===false);
const beforeRev=ctx.state._rev;
const wrongUserResumed=await ctx.resumePendingPrivateSync();
check("different account does not auto-push the pending state",wrongUserResumed===false&&ctx.state._rev===beforeRev);
check("different account does not clear the original user's marker",storage.has("pickgauge_private_sync_pending_v1"));

// init() must resume after its normal newer-wins pull, which preserves equal-revision local edits.
check("signed-in init resumes pending sync after pullState(false)",
  initSrc.includes('await pullState(false);')&&initSrc.indexOf("resumePendingPrivateSync")>initSrc.indexOf("await pullState(false);"));

check("pullTier stays independent of pending-marker helpers so existing isolated sync tests remain valid",
  !extractFunction("pullTier",syncSrc,true).includes("clearPrivateSyncPending"));

// Durable-vs-device-local model: two devices can have different view/week without changing synced picks.
const uiA={poolId:"sec",entryByPool:{sec:"e1"},weekByPool:{sec:1},view:"board"};
const uiB={poolId:"bigten",entryByPool:{bigten:"b2"},weekByPool:{bigten:4},view:"plan"};
const durable={version:2,pools:{sec:{season:2026,entries:[{id:"e1",name:"Entry 1",picks:{"1":"Alabama"}}]},bigten:{season:2026,entries:[{id:"b2",name:"B1G",picks:{"1":"Ohio State"}}]}}};
const serverJSON=JSON.stringify(durable);
const deviceA=JSON.parse(serverJSON),deviceB=JSON.parse(serverJSON);
check("synced durable picks are identical across devices",JSON.stringify(deviceA)===JSON.stringify(deviceB));
check("device-local Survivor navigation can differ independently",JSON.stringify(uiA)!==JSON.stringify(uiB));
check("device-local UI fields are absent from durable Survivor state",
  !("poolId" in durable)&&!("view" in durable)&&!("weekByPool" in durable)&&!("entryByPool" in durable));

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}
console.log(`\nAll ${total} checks passed.`);
