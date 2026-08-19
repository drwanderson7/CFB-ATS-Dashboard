import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../app/js/sync.js",import.meta.url),"utf8");
function extractAsyncFunction(name,source){
  const marker=`async function ${name}(`;
  const start=source.indexOf(marker);
  if(start===-1) throw new Error(`Could not find async function ${name}()`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){i++;break;} }
  }
  return source.slice(start,i);
}
const failures=[];let total=0;
function check(name,cond){total++;console.log(`[${cond?"PASS":"FAIL"}] ${name}`);if(!cond)failures.push(name);}

async function runCase({local,remote,revision,force=false}){
  const writes=[];
  const ctx={
    state:{...local},
    window:{Clerk:{user:{id:"u1"}}},
    apiFetch:async()=>({ok:true,body:{state:{...remote},revision,isAdmin:false}}),
    stateEndpoint:()=>"/api/state?scope=user",
    SHARED_FIELDS:["lastGames","sharedUpdatedAt"],
    pickFields:(obj,fields)=>Object.fromEntries(fields.filter(f=>obj[f]!==undefined).map(f=>[f,obj[f]])),
    normalizeState:(x)=>({...x}),
    mergeSharedPoolsIntoLocal:()=>{}, resolveBookLines:()=>{},
    clearTimeout:()=>{}, syncTimerPrivate:null,
    localStorage:{setItem:(k,v)=>writes.push([k,v])}, KEY:"k",
    isAdminUser:false, setSyncStatus:()=>{},
  };
  vm.createContext(ctx);
  vm.runInContext(extractAsyncFunction("pullTier",src),ctx);
  const changed=await ctx.pullTier("private",force);
  return {ctx,changed,writes};
}

{
  const {ctx,changed}=await runCase({
    local:{_rev:2,privateUpdatedAt:"2099-01-01T00:00:00Z",marker:"local",apiKey:"secret",lastGames:[1]},
    remote:{_rev:3,privateUpdatedAt:"2020-01-01T00:00:00Z",marker:"remote"},revision:3,
  });
  check("newer server revision wins even when the local device clock is far ahead",changed===true&&ctx.state.marker==="remote");
  check("adopting newer private state preserves device-local apiKey",ctx.state.apiKey==="secret");
  check("adopting newer private state preserves current shared-tier fields",Array.isArray(ctx.state.lastGames)&&ctx.state.lastGames[0]===1);
  check("adopting newer private state records the server revision",ctx.state._rev===3);
}

{
  const {ctx,changed}=await runCase({
    local:{_rev:3,privateUpdatedAt:"2020-01-01T00:00:00Z",marker:"local"},
    remote:{_rev:2,privateUpdatedAt:"2099-01-01T00:00:00Z",marker:"remote"},revision:2,
  });
  check("older server revision is rejected even when its browser timestamp looks newer",changed===false&&ctx.state.marker==="local");
}

{
  const {ctx,changed}=await runCase({
    local:{_rev:5,privateUpdatedAt:"2099-01-01T00:00:00Z",marker:"unsynced-local"},
    remote:{_rev:5,privateUpdatedAt:"2020-01-01T00:00:00Z",marker:"server"},revision:5,
  });
  check("equal revision preserves an unsynced local edit on a normal non-force pull",changed===false&&ctx.state.marker==="unsynced-local");
}

check("sync.js no longer uses privateUpdatedAt as its private-tier freshness comparison",!src.includes('const remoteTime=remote.privateUpdatedAt'));
check("sync.js compares remoteRev to localRev for private pulls",src.includes('if(!force&&remoteRev<=localRev) return false'));

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}
console.log(`\nAll ${total} checks passed.`);
