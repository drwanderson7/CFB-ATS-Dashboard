// Regression coverage for app/js/api-client.js's one-time Clerk token refresh.
// A real auth-shaped 401 gets exactly one skipCache retry; unrelated 401s
// (feature-key problems) do not. This is the browser-side half of the live
// Aug 25 production failure where every protected endpoint returned 401.
import fs from 'fs';
import vm from 'vm';

const src=fs.readFileSync(new URL('../app/js/api-client.js',import.meta.url),'utf8');
let failures=0, total=0;
function check(name,cond){ total++; console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
function response(status,body){
  return {ok:status>=200&&status<300,status,headers:{get:(k)=>k==='content-type'?'application/json':''},json:async()=>body};
}
function makeCtx(fetchImpl){
  const headerCalls=[];
  const ctx={console,window:{Clerk:{session:{}}},fetch:fetchImpl,authHeaders:async(extra,forceFresh)=>{headerCalls.push(!!forceFresh); return {Authorization:'Bearer test'};}};
  vm.createContext(ctx); vm.runInContext(src,ctx);
  ctx.headerCalls=headerCalls; return ctx;
}

{
  let n=0;
  const ctx=makeCtx(async()=>{ n++; return n===1?response(401,{error:'Unauthorized — please sign in again.'}):response(200,{ok:true}); });
  const r=await ctx.apiFetch('/api/state',{});
  check('auth 401 retries once and succeeds',r.ok===true&&n===2);
  check('auth retry requests a fresh Clerk token only on second attempt',JSON.stringify(ctx.headerCalls)===JSON.stringify([false,true]));
}
{
  let n=0;
  const ctx=makeCtx(async()=>{ n++; return response(401,{message:'No API key provided'}); });
  const r=await ctx.apiFetch('/api/fetch_odds',{});
  check('feature-key 401 is not retried as Clerk auth',r.ok===false&&r.kind==='missing_key'&&n===1);
  check('feature-key 401 never asks Clerk for skipCache token',JSON.stringify(ctx.headerCalls)===JSON.stringify([false]));
}
{
  let n=0;
  const ctx=makeCtx(async()=>{ n++; return response(401,{error:'Unauthorized — please sign in again.'}); });
  const r=await ctx.apiFetch('/api/state',{});
  check('persistent auth 401 stops after one retry (no loop)',r.ok===false&&r.kind==='auth'&&n===2);
}


const mainSrc=fs.readFileSync(new URL('../app/js/main.js',import.meta.url),'utf8');
check('authHeaders(forceFresh) uses Clerk getToken({skipCache:true}) on the forced retry path',
  /getToken\(forceFresh\?\{skipCache:true\}:undefined\)/.test(mainSrc));

console.log(`\n${total-failures}/${total} checks passed`);
if(failures) process.exit(1);
