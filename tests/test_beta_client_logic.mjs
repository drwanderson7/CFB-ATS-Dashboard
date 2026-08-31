// Focused client test: analytics payloads remain coarse, milestones are unique-friendly,
// and feedback captures safe diagnostic context without account/pick/model data.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'..');
const src=fs.readFileSync(path.join(ROOT,'app/js/beta.js'),'utf8');
const calls=[];
const now=Date.now();
const elements=new Map();
function el(id,extra={}){ const v={id,value:'',textContent:'',className:'',style:{},disabled:false,setAttribute(){},focus(){},addEventListener(){},...extra}; elements.set(id,v); return v; }
el('betaFeedbackModal',{style:{},setAttribute(){},addEventListener(){}});
el('betaFeedbackMessage',{value:'A useful bug report',focus(){}});
el('betaFeedbackStatus'); el('betaFeedbackSubmit',{textContent:'Send feedback'});
el('betaFeedbackCategory',{value:'bug'}); el('betaFeedbackContext');
const ctx={
  console,Promise,Date,Math,Number,Object,Set,String,
  setTimeout:(fn)=>{ fn(); return 1; }, clearTimeout:()=>{},
  window:{innerWidth:600,Clerk:{session:{},user:{createdAt:new Date(now-60_000)}}},
  state:{
    pools:[{id:'pool1',archived:false,weekLabel:'Week 1',entries:[{picks:{'a@b':{side:'home'}}}]}],
    activeContext:'pool1',predictions:[{home:'A',road:'B'}],entries:[],lastGames:[]
  },
  currentPool(){ return ctx.state.pools[0]; },
  seasonYear:()=>2026, currentWeekIndex:()=>1,
  apiFetch:async(url,opts)=>{ calls.push({url,opts}); return {ok:true,status:200,body:{ok:true}}; },
  document:{
    querySelector:(sel)=>sel==='.panel.active'?{id:'tab-board'}:null,
    getElementById:(id)=>elements.get(id)||null,
  },
  esc:(s)=>String(s), isAdminUser:false,
};
ctx.window.window=ctx.window;
vm.createContext(ctx);
vm.runInContext(src,ctx,{filename:'beta.js'});

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures.push(name); }
check('betaActiveTab resolves current panel',ctx.betaActiveTab()==='board');
check('betaDevice buckets 600px viewport as mobile',ctx.betaDevice()==='mobile');
check('betaContext buckets active pool as pool',ctx.betaContext()==='pool');
check('betaBaseProps adds safe season/week context',JSON.stringify(ctx.betaBaseProps())===JSON.stringify({tab:'board',device:'mobile',context:'pool',season:2026,week:1}));
ctx.trackBetaEvent('odds_refresh',{source:'server',madeUp:'secret'});
await new Promise(r=>setImmediate(r));
check('trackBetaEvent calls first-party /api/beta',calls.length===1&&calls[0].url==='/api/beta');
const body=JSON.parse(calls[0].opts.body);
check('event payload identifies event',body.type==='event'&&body.event==='odds_refresh');
check('event payload carries coarse context supplied by client helper',body.properties.tab==='board'&&body.properties.device==='mobile'&&body.properties.context==='pool'&&body.properties.source==='server'&&body.properties.season===2026&&body.properties.week===1);
check('event payload does not contain user id/email/picks/model numbers',!('user' in body)&&!('email' in body)&&!('picks' in body)&&!('model' in body));

calls.length=0;
ctx.startBetaAnalytics();
ctx.startBetaAnalytics();
await new Promise(r=>setImmediate(r));
const events=calls.map(c=>JSON.parse(c.opts.body).event);
check('app_open is emitted at most once per page session',events.filter(e=>e==='app_open').length===1);
check('new Clerk account emits signup milestone',events.includes('signup'));
check('existing synced pool emits pool-ready milestone',events.includes('pool_ready'));
check('existing synced predictions emit predictions-ready milestone',events.includes('predictions_ready'));
check('existing synced pick emits pick-ready milestone',events.includes('pick_ready'));

ctx.openBetaFeedback('help');
check('feedback modal previews attached coarse context and recent action',elements.get('betaFeedbackContext').textContent.includes('Board')&&elements.get('betaFeedbackContext').textContent.includes('2026 Week 1')&&elements.get('betaFeedbackContext').textContent.includes('Mobile')&&elements.get('betaFeedbackContext').textContent.includes('Refresh lines'));

calls.length=0;
await ctx.submitBetaFeedback();
const feedbackCall=calls.find(c=>JSON.parse(c.opts.body).type==='feedback');
const feedback=feedbackCall&&JSON.parse(feedbackCall.opts.body);
check('feedback payload includes category/message and coarse diagnostics',feedback&&feedback.category==='bug'&&feedback.source==='help'&&feedback.season===2026&&feedback.week===1&&feedback.lastAction==='odds_refresh'&&feedback.lastActionSource==='server');
check('feedback payload still excludes account/pick/model/pool-name data',feedback&&!('email' in feedback)&&!('picks' in feedback)&&!('model' in feedback)&&!('poolName' in feedback));

const funnelData={uniqueUsers:10,uniqueByEvent:{pool_ready:8,predictions_ready:7,pick_ready:6,snapshot_view:5,entry_submitted:4},days:[],totals:{}};
check('funnel percentage helper uses unique users as denominator',ctx.betaPct(6,10)===60);
check('zero-denominator funnel percentage is safe',ctx.betaPct(3,0)===0);

if(failures.length){ console.log(`\n${failures.length} of ${total} failure(s):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
