// --- First-party beta analytics + in-app feedback -----------------------
// Privacy-light by design: the browser only sends a small allowlisted event
// name plus coarse context (active tab, mobile/desktop, overall/pool, source).
// The server stores aggregate daily counts -- not a raw clickstream. Feedback
// is a separate explicit form submission. Both require the existing Clerk
// session; failure here is always silent for product analytics and surfaced
// only when a person intentionally submits feedback.
let betaAnalyticsStarted=false;
let betaAdminLoaded=false;

function betaActiveTab(){
  const active=document.querySelector('.panel.active');
  return active&&active.id&&active.id.startsWith('tab-')?active.id.slice(4):'snapshot';
}
function betaDevice(){ return window.innerWidth<=720?'mobile':'desktop'; }
function betaContext(){ return (typeof currentPool==='function'&&currentPool())?'pool':'overall'; }
function betaBaseProps(extra){
  return Object.assign({tab:betaActiveTab(),device:betaDevice(),context:betaContext()},extra||{});
}
function trackBetaEvent(event,properties){
  if(!event||!window.Clerk||!window.Clerk.session||typeof apiFetch!=='function') return;
  // Analytics must never block or throw into the app. apiFetch() already
  // resolves network/server errors into an object; the trailing catch is just
  // a final safety net for an unexpected client bug (e.g. Clerk token call).
  Promise.resolve(apiFetch('/api/beta',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({type:'event',event,properties:betaBaseProps(properties)})
  })).catch(()=>{});
}
function startBetaAnalytics(){
  if(betaAnalyticsStarted) return;
  betaAnalyticsStarted=true;
  trackBetaEvent('app_open');
}

function openBetaFeedback(){
  const modal=document.getElementById('betaFeedbackModal');
  if(!modal) return;
  const msg=document.getElementById('betaFeedbackMessage');
  const status=document.getElementById('betaFeedbackStatus');
  if(status){ status.className='note'; status.textContent=''; }
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
    const result=await apiFetch('/api/beta',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        type:'feedback',
        category:category?category.value:'other',
        message:text,
        ...betaBaseProps(),
      })
    });
    if(!result.ok) throw new Error(result.error||'Could not send feedback.');
    if(status){ status.className='ok'; status.textContent='Thanks — feedback received.'; }
    if(message) message.value='';
    setTimeout(closeBetaFeedback,650);
    betaAdminLoaded=false; // admin can refresh and see the new item immediately
  }catch(err){
    if(status){ status.className='err'; status.textContent=err&&err.message?err.message:'Could not send feedback.'; }
  }finally{
    if(submit){ submit.disabled=false; submit.textContent='Send feedback'; }
  }
}

function betaMetricCount(totals,event){ return Number((totals&&totals['event:'+event])||0); }
function renderBetaSummary(data){
  const stats=document.getElementById('betaAnalyticsStats');
  if(!stats) return;
  const totals=data&&data.totals||{};
  const metrics=[
    ['Users',Number(data&&data.uniqueUsers||0)],
    ['App opens',betaMetricCount(totals,'app_open')],
    ['Odds refreshes',betaMetricCount(totals,'odds_refresh')],
    ['Predictions loads',betaMetricCount(totals,'predictions_load')],
    ['Powers imports',betaMetricCount(totals,'powers_pdf_import')],
    ['Pool imports',betaMetricCount(totals,'pool_import')],
    ['My Numbers edits',betaMetricCount(totals,'my_numbers_manual')],
    ['My Numbers CSVs',betaMetricCount(totals,'my_numbers_csv_import')],
    ['Picks made',betaMetricCount(totals,'pick_set')],
    ['Entries submitted',betaMetricCount(totals,'entry_submitted')],
    ['Snapshot exports',betaMetricCount(totals,'snapshot_export')],
    ['Feedback',betaMetricCount(totals,'feedback_submitted')],
  ];
  stats.innerHTML=metrics.map(([label,value])=>`<div class="beta-stat"><span>${esc(label)}</span><b>${esc(value)}</b></div>`).join('');
}
function renderBetaFeedbackList(items){
  const wrap=document.getElementById('betaAdminFeedbackList');
  if(!wrap) return;
  if(!items||!items.length){ wrap.innerHTML='<p class="note">No beta feedback yet.</p>'; return; }
  wrap.innerHTML=items.slice(0,20).map(item=>{
    const when=item.createdAt?new Date(item.createdAt).toLocaleString():'';
    const meta=[item.category,item.tab,item.device,when].filter(Boolean).join(' · ');
    return `<div class="beta-feedback-item"><div class="beta-feedback-meta">${esc(meta)}</div><div>${esc(item.message||'')}</div></div>`;
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
  const list=document.getElementById('betaAdminFeedbackList');
  if(stats) stats.innerHTML='<span class="note">Loading 30-day summary…</span>';
  if(list) list.innerHTML='<span class="note">Loading feedback…</span>';
  const [summary,feedback]=await Promise.all([
    apiFetch('/api/beta?view=summary&days=30',{}),
    apiFetch('/api/beta?view=feedback&days=30&limit=50',{}),
  ]);
  if(summary.ok) renderBetaSummary(summary.body);
  else if(stats) stats.innerHTML=`<span class="err">${esc(summary.error||'Could not load analytics.')}</span>`;
  if(feedback.ok) renderBetaFeedbackList((feedback.body&&feedback.body.feedback)||[]);
  else if(list) list.innerHTML=`<span class="err">${esc(feedback.error||'Could not load feedback.')}</span>`;
}

function initBetaFeedback(){
  const openers=[document.getElementById('feedbackBtn'),document.getElementById('helpFeedbackBtn')].filter(Boolean);
  openers.forEach(btn=>{ btn.onclick=openBetaFeedback; });
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
