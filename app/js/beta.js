// --- First-party beta analytics + in-app feedback -----------------------
// Privacy-light by design: the browser sends only allowlisted product-event
// names plus coarse context. The server stores aggregate counts and
// pseudonymous HyperLogLog uniques -- never a raw analytics clickstream.
// Feedback is an explicit submission and can include a little more coarse
// diagnostic context (season/week, opening surface, recent product action),
// but never screenshots, picks, model numbers, pool names, email addresses,
// or imported-file contents.
let betaAnalyticsStarted=false;
let betaAdminLoaded=false;
let betaFeedbackSource='header';
let betaLastAction=null;

const BETA_PASSIVE_EVENTS=new Set([
  'app_open','signup','tab_view','pool_ready','predictions_ready','pick_ready','snapshot_view','feedback_submitted'
]);
const BETA_ACTION_LABELS={
  odds_refresh:'Refresh lines',predictions_load:'Load predictions',powers_pdf_import:'Import Powers PDF',
  pool_import:'Import pool',my_numbers_manual:'Edit My Numbers',my_numbers_csv_import:'Import My Numbers CSV',
  snapshot_export:'Export Snapshot',pick_set:'Make a pick',entry_submitted:'Submit entry'
};
const BETA_CATEGORY_LABELS={bug:'Bug',confusing:'Confusing',feature:'Feature request',idea:'Feature request',other:'Other'};

function betaActiveTab(){
  const active=document.querySelector('.panel.active');
  return active&&active.id&&active.id.startsWith('tab-')?active.id.slice(4):'snapshot';
}
function betaDevice(){ return window.innerWidth<=720?'mobile':'desktop'; }
function betaContext(){ return (typeof currentPool==='function'&&currentPool())?'pool':'overall'; }
function betaSeason(){
  try{ const n=(typeof seasonYear==='function')?Number(seasonYear()):NaN; return Number.isInteger(n)?n:null; }
  catch(e){ return null; }
}
function betaWeek(){
  try{
    const p=(typeof currentPool==='function')?currentPool():null;
    const m=p&&String(p.weekLabel||'').match(/week\s*(\d+)/i);
    if(m) return Number(m[1]);
    const n=(typeof currentWeekIndex==='function')?Number(currentWeekIndex()):NaN;
    return Number.isInteger(n)&&n>=0&&n<=25?n:null;
  }catch(e){ return null; }
}
function betaBaseProps(extra){
  const base={tab:betaActiveTab(),device:betaDevice(),context:betaContext(),season:betaSeason(),week:betaWeek()};
  Object.keys(base).forEach(k=>{ if(base[k]==null) delete base[k]; });
  return Object.assign(base,extra||{});
}
function betaRememberAction(event,properties){
  if(!event||BETA_PASSIVE_EVENTS.has(event)) return;
  betaLastAction={event,source:properties&&properties.source||null,at:Date.now()};
}
function trackBetaEvent(event,properties){
  betaRememberAction(event,properties);
  if(!event||!window.Clerk||!window.Clerk.session||typeof apiFetch!=='function') return;
  Promise.resolve(apiFetch('/api/beta',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:'event',event,properties:betaBaseProps(properties)})
  })).catch(()=>{});
}
function betaHasPool(){ return !!(typeof state!=='undefined'&&Array.isArray(state.pools)&&state.pools.some(p=>p&&!p.archived)); }
function betaHasPredictions(){ return !!(typeof state!=='undefined'&&Array.isArray(state.predictions)&&state.predictions.length); }
function betaHasPick(){
  if(typeof state==='undefined') return false;
  const entries=[];
  if(Array.isArray(state.entries)) entries.push(...state.entries);
  (state.pools||[]).forEach(p=>{ if(p&&Array.isArray(p.entries)) entries.push(...p.entries); });
  return entries.some(e=>e&&e.picks&&Object.keys(e.picks).length>0);
}
function trackBetaMilestones(){
  if(betaHasPool()) trackBetaEvent('pool_ready');
  if(betaHasPredictions()) trackBetaEvent('predictions_ready');
  if(betaHasPick()) trackBetaEvent('pick_ready');
}
function trackBetaSignupIfNew(){
  try{
    const created=window.Clerk&&window.Clerk.user&&window.Clerk.user.createdAt;
    const ms=created?new Date(created).getTime():NaN;
    if(Number.isFinite(ms)&&Date.now()-ms>=0&&Date.now()-ms<=24*60*60*1000) trackBetaEvent('signup');
  }catch(e){}
}
function startBetaAnalytics(){
  if(betaAnalyticsStarted) return;
  betaAnalyticsStarted=true;
  trackBetaEvent('app_open');
  trackBetaSignupIfNew();
  trackBetaMilestones();
}
function trackBetaSnapshotView(){ trackBetaEvent('snapshot_view',{source:'button'}); }

function betaFeedbackContextText(props){
  const bits=[];
  if(props.tab) bits.push(props.tab.charAt(0).toUpperCase()+props.tab.slice(1));
  bits.push(props.context==='pool'?'Pool view':'Overall view');
  if(props.season!=null&&props.week!=null) bits.push(`${props.season} Week ${props.week}`);
  bits.push(props.device==='mobile'?'Mobile':'Desktop');
  if(props.lastAction){ bits.push(`Recent action: ${BETA_ACTION_LABELS[props.lastAction]||props.lastAction}`); }
  return bits.join(' · ');
}
function openBetaFeedback(source){
  const modal=document.getElementById('betaFeedbackModal');
  if(!modal) return;
  betaFeedbackSource=(typeof source==='string'&&source)?source:'header';
  const msg=document.getElementById('betaFeedbackMessage');
  const status=document.getElementById('betaFeedbackStatus');
  const context=document.getElementById('betaFeedbackContext');
  if(status){ status.className='note'; status.textContent=''; }
  const props=betaBaseProps({
    source:betaFeedbackSource,
    lastAction:betaLastAction&&betaLastAction.event||undefined,
    lastActionSource:betaLastAction&&betaLastAction.source||undefined,
  });
  if(context) context.textContent=betaFeedbackContextText(props);
  modal.style.display='flex';
  modal.setAttribute('aria-hidden','false');
  if(msg) setTimeout(()=>msg.focus(),0);
}
function closeBetaFeedback(){
  const modal=document.getElementById('betaFeedbackModal');
  if(!modal) return;
  modal.style.display='none';
  modal.setAttribute('aria-hidden','true');
}
async function submitBetaFeedback(){
  const category=document.getElementById('betaFeedbackCategory');
  const message=document.getElementById('betaFeedbackMessage');
  const status=document.getElementById('betaFeedbackStatus');
  const submit=document.getElementById('betaFeedbackSubmit');
  const text=(message&&message.value||'').trim();
  if(text.length<3){
    if(status){ status.className='err'; status.textContent='Tell me a little more before sending.'; }
    if(message) message.focus();
    return;
  }
  if(submit){ submit.disabled=true; submit.textContent='Sending…'; }
  if(status){ status.className='note'; status.textContent='Sending…'; }
  try{
    const context=betaBaseProps({
      source:betaFeedbackSource,
      lastAction:betaLastAction&&betaLastAction.event||undefined,
      lastActionSource:betaLastAction&&betaLastAction.source||undefined,
    });
    const result=await apiFetch('/api/beta',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({type:'feedback',category:category?category.value:'other',message:text,...context})
    });
    if(!result.ok) throw new Error(result.error||'Could not send feedback.');
    if(status){ status.className='ok'; status.textContent='Thanks — feedback received.'; }
    if(message) message.value='';
    setTimeout(closeBetaFeedback,650);
    betaAdminLoaded=false;
  }catch(err){
    if(status){ status.className='err'; status.textContent=err&&err.message?err.message:'Could not send feedback.'; }
  }finally{
    if(submit){ submit.disabled=false; submit.textContent='Send feedback'; }
  }
}

function betaMetricCount(totals,event){ return Number((totals&&totals['event:'+event])||0); }
function betaUniqueCount(data,event){ return Number((data&&data.uniqueByEvent&&data.uniqueByEvent[event])||0); }
function betaPct(n,d){ return d>0?Math.round((n/d)*100):0; }
function betaDimensionCount(data,event,key,value){
  return (data&&data.days||[]).reduce((sum,row)=>sum+Number((row.counts||{})[`event:${event}|${key}:${value}`]||0),0);
}
function renderBetaSummary(data){
  const stats=document.getElementById('betaAnalyticsStats');
  if(!stats) return;
  const totals=data&&data.totals||{};
  const metrics=[
    ['Active users',Number(data&&data.uniqueUsers||0)],
    ['New accounts',betaUniqueCount(data,'signup')],
    ['App opens',betaMetricCount(totals,'app_open')],
    ['Entry submits',betaMetricCount(totals,'entry_submitted')],
    ['Snapshot exports',betaMetricCount(totals,'snapshot_export')],
    ['Feedback',betaMetricCount(totals,'feedback_submitted')],
  ];
  stats.innerHTML=metrics.map(([label,value])=>`<div class="beta-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
}
function renderBetaFunnel(data){
  const wrap=document.getElementById('betaAnalyticsFunnel');
  if(!wrap) return;
  const active=Number(data&&data.uniqueUsers||0);
  const steps=[
    ['Opened app','app_open',active],
    ['Has a pool','pool_ready',betaUniqueCount(data,'pool_ready')],
    ['Predictions ready','predictions_ready',betaUniqueCount(data,'predictions_ready')],
    ['Made a pick','pick_ready',betaUniqueCount(data,'pick_ready')],
    ['Viewed Snapshot','snapshot_view',betaUniqueCount(data,'snapshot_view')],
    ['Submitted entry','entry_submitted',betaUniqueCount(data,'entry_submitted')],
  ];
  wrap.innerHTML=steps.map(([label,event,count])=>{
    const pct=betaPct(count,active);
    return `<div class="beta-funnel-row" data-event="${esc(event)}"><span class="beta-funnel-label">${esc(label)}</span><b>${esc(count)}</b><span>${esc(pct)}% of active</span><div class="beta-funnel-track" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,pct))}%"></i></div></div>`;
  }).join('');
}
function renderBetaFeatureActivity(data){
  const wrap=document.getElementById('betaFeatureActivity');
  if(!wrap) return;
  const totals=data&&data.totals||{};
  const metrics=[
    ['Pool imports',betaMetricCount(totals,'pool_import')],
    ['Predictions loads',betaMetricCount(totals,'predictions_load')],
    ['Powers imports',betaMetricCount(totals,'powers_pdf_import')],
    ['My Numbers edits',betaMetricCount(totals,'my_numbers_manual')],
    ['My Numbers CSVs',betaMetricCount(totals,'my_numbers_csv_import')],
    ['Picks made',betaMetricCount(totals,'pick_set')],
    ['Odds refreshes',betaMetricCount(totals,'odds_refresh')],
    ['Snapshot exports',betaMetricCount(totals,'snapshot_export')],
  ];
  wrap.innerHTML=metrics.map(([label,value])=>`<div class="beta-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
  const device=document.getElementById('betaDeviceMix');
  if(device){
    const mobile=betaDimensionCount(data,'app_open','device','mobile');
    const desktop=betaDimensionCount(data,'app_open','device','desktop');
    const total=mobile+desktop;
    device.textContent=total?`App opens: ${mobile} mobile (${betaPct(mobile,total)}%) · ${desktop} desktop (${betaPct(desktop,total)}%)`:'No device activity yet.';
  }
}
function renderBetaDaily(data){
  const wrap=document.getElementById('betaDailyActivity');
  if(!wrap) return;
  const rows=(data&&data.days||[]).slice(0,7);
  if(!rows.length){ wrap.innerHTML='<p class="note">No activity yet.</p>'; return; }
  wrap.innerHTML=`<div class="beta-daily-head"><span>Date</span><span>Users</span><span>Opens</span><span>Picks</span><span>Feedback</span></div>`+
    rows.map(row=>`<div class="beta-daily-row"><span>${esc(row.date)}</span><b>${esc(row.uniqueUsers||0)}</b><span>${esc(Number((row.counts||{})['event:app_open']||0))}</span><span>${esc(Number((row.counts||{})['event:pick_set']||0))}</span><span>${esc(Number((row.counts||{})['event:feedback_submitted']||0))}</span></div>`).join('');
}
function renderBetaFeedbackList(items){
  const wrap=document.getElementById('betaAdminFeedbackList');
  if(!wrap) return;
  if(!items||!items.length){ wrap.innerHTML='<p class="note">No beta feedback yet.</p>'; return; }
  wrap.innerHTML=items.slice(0,30).map(item=>{
    const when=item.createdAt?new Date(item.createdAt).toLocaleString():'';
    const parts=[BETA_CATEGORY_LABELS[item.category]||item.category,item.tab,item.context,item.device];
    if(item.season!=null&&item.week!=null) parts.push(`${item.season} W${item.week}`);
    if(item.lastAction) parts.push(`after ${BETA_ACTION_LABELS[item.lastAction]||item.lastAction}`);
    if(item.source) parts.push(`via ${item.source}`);
    if(when) parts.push(when);
    return `<div class="beta-feedback-item"><div class="beta-feedback-meta">${esc(parts.filter(Boolean).join(' · '))}</div><div>${esc(item.message||'')}</div></div>`;
  }).join('');
}
async function renderBetaAdminPanel(force){
  const card=document.getElementById('betaAdminCard');
  if(!card) return;
  if(typeof isAdminUser==='undefined'||!isAdminUser){ card.style.display='none'; return; }
  card.style.display='block';
  if(betaAdminLoaded&&!force) return;
  betaAdminLoaded=true;
  const stats=document.getElementById('betaAnalyticsStats');
  const funnel=document.getElementById('betaAnalyticsFunnel');
  const list=document.getElementById('betaAdminFeedbackList');
  if(stats) stats.innerHTML='<span class="note">Loading 30-day summary…</span>';
  if(funnel) funnel.innerHTML='<span class="note">Loading activation funnel…</span>';
  if(list) list.innerHTML='<span class="note">Loading feedback…</span>';
  const [summary,feedback]=await Promise.all([
    apiFetch('/api/beta?view=summary&days=30',{}),
    apiFetch('/api/beta?view=feedback&days=30&limit=100',{}),
  ]);
  if(summary.ok){
    const data=summary.body||{};
    renderBetaSummary(data); renderBetaFunnel(data); renderBetaFeatureActivity(data); renderBetaDaily(data);
    const note=document.getElementById('betaFunnelNote');
    if(note) note.textContent=`Unique signed-in users observed in the last 30 days. Funnel milestone uniques are available from ${data.funnelSince||'the current beta build'} forward; public marketing visits are intentionally not tracked.`;
  }else{
    if(stats) stats.innerHTML=`<span class="err">${esc(summary.error||'Could not load analytics.')}</span>`;
    if(funnel) funnel.innerHTML='';
  }
  if(feedback.ok) renderBetaFeedbackList((feedback.body&&feedback.body.feedback)||[]);
  else if(list) list.innerHTML=`<span class="err">${esc(feedback.error||'Could not load feedback.')}</span>`;
}

function initBetaFeedback(){
  const header=document.getElementById('feedbackBtn'); if(header) header.onclick=()=>openBetaFeedback('header');
  const help=document.getElementById('helpFeedbackBtn'); if(help) help.onclick=()=>openBetaFeedback('help');
  const close=document.getElementById('betaFeedbackClose'); if(close) close.onclick=closeBetaFeedback;
  const cancel=document.getElementById('betaFeedbackCancel'); if(cancel) cancel.onclick=closeBetaFeedback;
  const submit=document.getElementById('betaFeedbackSubmit'); if(submit) submit.onclick=submitBetaFeedback;
  const modal=document.getElementById('betaFeedbackModal');
  if(modal){
    modal.addEventListener('click',e=>{ if(e.target===modal) closeBetaFeedback(); });
    modal.addEventListener('keydown',e=>{ if(e.key==='Escape') closeBetaFeedback(); });
  }
  const refresh=document.getElementById('betaAdminRefresh'); if(refresh) refresh.onclick=()=>renderBetaAdminPanel(true);
}
