// Focused client test: analytics payload is coarse/allowlisted and non-blocking.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'app/js/beta.js'),'utf8');
const calls=[];
const ctx={
  console,
  Promise,
  setTimeout:(fn)=>{ fn(); return 1; },
  clearTimeout:()=>{},
  window:{innerWidth:600,Clerk:{session:{}}},
  currentPool:()=>({id:'pool1'}),
  apiFetch:async(url,opts)=>{ calls.push({url,opts}); return {ok:true,status:200,body:{ok:true}}; },
  document:{
    querySelector:(sel)=>sel==='.panel.active'?{id:'tab-board'}:null,
    getElementById:()=>null,
  },
  esc:(s)=>String(s),
  isAdminUser:false,
};
ctx.window.window=ctx.window;
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'beta.js'});

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures.push(name); }
check('betaActiveTab resolves current panel',ctx.betaActiveTab()==='board');
check('betaDevice buckets 600px viewport as mobile',ctx.betaDevice()==='mobile');
check('betaContext buckets active pool as pool',ctx.betaContext()==='pool');
ctx.trackBetaEvent('odds_refresh',{source:'server',madeUp:'secret'});
await new Promise(r=>setImmediate(r));
check('trackBetaEvent calls first-party /api/beta',calls.length===1&&calls[0].url==='/api/beta');
const body=JSON.parse(calls[0].opts.body);
check('event payload identifies event',body.type==='event'&&body.event==='odds_refresh');
check('event payload carries only coarse context supplied by client helper',body.properties.tab==='board'&&body.properties.device==='mobile'&&body.properties.context==='pool'&&body.properties.source==='server');
check('event payload does not contain user id/email/picks/model numbers',!('user' in body)&&!('email' in body)&&!('picks' in body)&&!('model' in body));
ctx.startBetaAnalytics();
ctx.startBetaAnalytics();
await new Promise(r=>setImmediate(r));
check('app_open is emitted at most once per page session',calls.filter(c=>JSON.parse(c.opts.body).event==='app_open').length===1);
if(failures.length){ console.log(`\n${failures.length} of ${total} failure(s):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
