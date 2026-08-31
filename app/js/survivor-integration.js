// Native PickGauge Survivor UI + persistence coordinator.
// Durable pool/entry/pick data lives in state.survivor and therefore uses
// PickGauge's existing authenticated private-state sync. Navigation state
// remains device-local so browsing on one device does not move another.

const PG_SURVIVOR_UI_KEY='pickgauge_survivor_ui_v1';
const PG_SURVIVOR_POOLS={
  sec:{id:'sec',name:'SEC Survivor',short:'SEC',picksPerWeek:1,expected:106},
  bigten:{id:'bigten',name:'Big Ten Survivor',short:'B1G',picksPerWeek:1,expected:122},
  kelly:{id:'kelly',name:'KellyInVegas Championship',short:'KELLY',picksPerWeek:2,expected:321},
};
let pgSurvivorRuntime={dataByPool:{},loadingByPool:{},errorByPool:{},plan:null,recommendationPlan:null,whyOpenByPool:{},compareByPoolWeek:{}};

function pgSurvivorDefaultEntry(name='My Entry'){return {id:uid(),name,picks:{}};}
function pgSurvivorNormalizeDurable(raw){
  const s=(raw&&typeof raw==='object'&&!Array.isArray(raw))?raw:{};
  s.version=2;
  s.pools=(s.pools&&typeof s.pools==='object'&&!Array.isArray(s.pools))?s.pools:{};
  Object.keys(PG_SURVIVOR_POOLS).forEach(poolId=>{
    const p=(s.pools[poolId]&&typeof s.pools[poolId]==='object')?s.pools[poolId]:{};
    p.season=2026;
    p.entries=Array.isArray(p.entries)&&p.entries.length?p.entries:[pgSurvivorDefaultEntry()];
    const seen=new Set();
    p.entries=p.entries.map((entry,index)=>{
      let id=entry?.id?String(entry.id):uid(); if(seen.has(id))id=uid(); seen.add(id);
      const name=String(entry?.name||'').trim()||`Entry ${index+1}`;
      const picks=(entry?.picks&&typeof entry.picks==='object'&&!Array.isArray(entry.picks))?entry.picks:{};
      return {id,name,picks};
    });
    s.pools[poolId]=p;
  });
  // v1 shell stored navigation inside synced state. Preserve the user's last
  // choices during migration, then stop syncing them going forward.
  if(s.activePoolId||s.activeEntryIdByPool||s.currentWeekByPool){
    const ui=pgSurvivorLoadUi();
    if(PG_SURVIVOR_POOLS[s.activePoolId]) ui.poolId=s.activePoolId;
    if(s.activeEntryIdByPool&&typeof s.activeEntryIdByPool==='object') ui.entryByPool={...ui.entryByPool,...s.activeEntryIdByPool};
    if(s.currentWeekByPool&&typeof s.currentWeekByPool==='object') ui.weekByPool={...ui.weekByPool,...s.currentWeekByPool};
    pgSurvivorSaveUi(ui);
    delete s.activePoolId; delete s.activeEntryIdByPool; delete s.currentWeekByPool;
  }
  return s;
}
function pgSurvivorLoadUi(){
  let raw={}; try{raw=JSON.parse(localStorage.getItem(PG_SURVIVOR_UI_KEY)||'{}')||{};}catch(e){}
  const ui={
    poolId:PG_SURVIVOR_POOLS[raw.poolId]?raw.poolId:'sec',
    entryByPool:(raw.entryByPool&&typeof raw.entryByPool==='object')?raw.entryByPool:{},
    weekByPool:(raw.weekByPool&&typeof raw.weekByPool==='object')?raw.weekByPool:{},
    view:['board','rankings','plan','picks'].includes(raw.view)?raw.view:'board',
  };
  return ui;
}
function pgSurvivorSaveUi(ui){try{localStorage.setItem(PG_SURVIVOR_UI_KEY,JSON.stringify(ui));}catch(e){}}
function pgSurvivorState(){state.survivor=pgSurvivorNormalizeDurable(state.survivor);return state.survivor;}
function pgSurvivorUi(){return pgSurvivorLoadUi();}
function pgSurvivorPoolId(){return pgSurvivorUi().poolId;}
function pgSurvivorPoolDef(){return PG_SURVIVOR_POOLS[pgSurvivorPoolId()]||PG_SURVIVOR_POOLS.sec;}
function pgSurvivorPoolState(){return pgSurvivorState().pools[pgSurvivorPoolId()];}
function pgSurvivorActiveEntry(){
  const ui=pgSurvivorUi(),p=pgSurvivorPoolState();
  const wanted=ui.entryByPool[ui.poolId];
  return p.entries.find(e=>e.id===wanted)||p.entries[0];
}
function pgSurvivorPersist(){save();}
function pgSurvivorSelectedPicks(week){
  const v=pgSurvivorActiveEntry().picks[String(week)] ?? pgSurvivorActiveEntry().picks[week];
  return (Array.isArray(v)?v:[v]).filter(Boolean);
}
function pgSurvivorUsedTeams(excludeWeek=null){
  const out=new Set();
  Object.entries(pgSurvivorActiveEntry().picks||{}).forEach(([week,value])=>{
    if(excludeWeek!==null&&Number(week)===Number(excludeWeek))return;
    (Array.isArray(value)?value:[value]).filter(Boolean).forEach(team=>out.add(team));
  });
  return out;
}
function pgSurvivorData(){return pgSurvivorRuntime.dataByPool[pgSurvivorPoolId()]||null;}
function pgSurvivorFocusWeek(){
  const ui=pgSurvivorUi(), data=pgSurvivorData();
  const raw=Number(ui.weekByPool[ui.poolId]);
  if(data?.weeks?.includes(raw))return raw;
  return data?.weeks?.[0]||1;
}
function pgSurvivorFmtPct(p,d=0){return p===null||p===undefined||!Number.isFinite(Number(p))?'—':`${(Number(p)*100).toFixed(d)}%`;}
function pgSurvivorMatchLabel(m){return m.isNeutral?`vs ${m.opponent} · neutral`:`${m.isHome?'vs':'@'} ${m.opponent}`;}
function pgSurvivorResult(m){
  if(!m?.completed||m.teamPoints===null||m.opponentPoints===null)return null;
  return {won:m.teamPoints>m.opponentPoints,label:`${m.teamPoints>m.opponentPoints?'W':'L'} ${m.teamPoints}–${m.opponentPoints}`};
}
function pgSurvivorCoreReady(){return !!(window.PickGaugeSurvivorCore?.score?.buildSeasonPlan&&window.PickGaugeSurvivorCore?.score?.buildStrategicRecommendation);}
async function pgSurvivorWaitForCore(timeout=5000){
  if(pgSurvivorCoreReady())return true;
  return new Promise(resolve=>{
    let done=false; const finish=v=>{if(done)return;done=true;clearTimeout(timer);resolve(v);};
    const timer=setTimeout(()=>finish(pgSurvivorCoreReady()),timeout);
    window.addEventListener('pickgauge-survivor-core-ready',()=>finish(true),{once:true});
  });
}
async function pgSurvivorEnsureSharedData(force=false){
  const poolId=pgSurvivorPoolId();
  if(pgSurvivorRuntime.loadingByPool[poolId])return pgSurvivorRuntime.loadingByPool[poolId];
  if(!force&&pgSurvivorRuntime.dataByPool[poolId])return pgSurvivorRuntime.dataByPool[poolId];
  const promise=(async()=>{
    try{
      pgSurvivorRuntime.errorByPool[poolId]=null;
      if(!await pgSurvivorWaitForCore())throw new Error('Survivor optimizer core did not load.');
      if((typeof cfbdGames==='undefined'||!cfbdGames.length)&&typeof fetchTeamLogos==='function')await fetchTeamLogos(false);
      if((typeof cfbdRatings==='undefined'||!cfbdRatings.length)&&typeof fetchCfbdRatings==='function')await fetchCfbdRatings(2026,false);
      if((typeof cfbdScoreboard==='undefined'||!cfbdScoreboard.length)&&typeof fetchCfbdScoreboard==='function')await fetchCfbdScoreboard(false);
      // Season-level shared enrichment completes Survivor's intended source
      // hierarchy. A temporary failure degrades to already-loaded SP+/current
      // line data rather than blanking the board.
      if(typeof pgsEnsureSeasonEnrichment==='function')await pgsEnsureSeasonEnrichment(2026,force);
      const data=buildPickGaugeSurvivorData(poolId);
      pgSurvivorRuntime.dataByPool[poolId]=data;
      const ui=pgSurvivorUi();
      if(!data.weeks.includes(Number(ui.weekByPool[poolId]))){
        const derive=window.PickGaugeSurvivorCore?.results?.deriveCurrentPoolWeek;
        const natural=typeof derive==='function'?derive(data.matchups,data.weeks,Date.now()):data.weeks[0];
        ui.weekByPool[poolId]=data.weeks.includes(Number(natural))?Number(natural):data.weeks[0]; pgSurvivorSaveUi(ui);
      }else{
        const derive=window.PickGaugeSurvivorCore?.results?.deriveCurrentPoolWeek;
        const natural=typeof derive==='function'?Number(derive(data.matchups,data.weeks,Date.now())):null;
        if(data.weeks.includes(natural)&&Number(ui.weekByPool[poolId])<natural){ui.weekByPool[poolId]=natural;pgSurvivorSaveUi(ui);}
      }
      pgSurvivorComputePlans();
      return data;
    }catch(err){
      pgSurvivorRuntime.errorByPool[poolId]=err?.message||String(err);
      throw err;
    }finally{delete pgSurvivorRuntime.loadingByPool[poolId];renderSurvivorShell();}
  })();
  pgSurvivorRuntime.loadingByPool[poolId]=promise;
  return promise;
}
function pgSurvivorPlanInputs(ignoreFocusLock=false){
  const data=pgSurvivorData(), focus=pgSurvivorFocusWeek(); if(!data)return null;
  const weeks=data.weeks.filter(w=>Number(w)>=Number(focus));
  const priorUsed=new Set(), locked={};
  Object.entries(pgSurvivorActiveEntry().picks||{}).forEach(([week,value])=>{
    const w=Number(week),teams=(Array.isArray(value)?value:[value]).filter(Boolean);
    if(w<focus)teams.forEach(t=>priorUsed.add(t));
    else if(!(ignoreFocusLock&&w===focus)&&teams.length)locked[String(w)]=PG_SURVIVOR_POOLS[pgSurvivorPoolId()].picksPerWeek===1?teams[0]:teams;
  });
  return {weeks,priorUsed,locked};
}
function pgSurvivorComputePlans(){
  const data=pgSurvivorData(); if(!data||!pgSurvivorCoreReady()){pgSurvivorRuntime.plan=null;pgSurvivorRuntime.recommendationPlan=null;return;}
  const score=window.PickGaugeSurvivorCore.score, required=pgSurvivorPoolDef().picksPerWeek;
  const normal=pgSurvivorPlanInputs(false), rec=pgSurvivorPlanInputs(true);
  try{pgSurvivorRuntime.plan=score.buildSeasonPlan(data.matchups,normal.weeks,normal.priorUsed,normal.locked,required);}catch(e){console.error('Survivor plan failed',e);pgSurvivorRuntime.plan=null;}
  try{pgSurvivorRuntime.recommendationPlan=score.buildStrategicRecommendation(data.matchups,rec.weeks,rec.priorUsed,pgSurvivorFocusWeek(),rec.locked,required);}catch(e){console.error('Survivor recommendation failed',e);pgSurvivorRuntime.recommendationPlan=null;}
}
function pgSurvivorActualWeek(){
  const data=pgSurvivorData();if(!data)return pgSurvivorFocusWeek();
  const fn=window.PickGaugeSurvivorCore?.results?.deriveCurrentPoolWeek;
  if(typeof fn==='function'){try{const w=Number(fn(data.matchups,data.weeks,Date.now()));if(data.weeks.includes(w))return w;}catch(e){}}
  return data.weeks[0]||1;
}
function pgSurvivorEntryStatus(){
  const data=pgSurvivorData();if(!data)return null;
  const fn=window.PickGaugeSurvivorCore?.results?.evaluateEntryStatus;if(typeof fn!=='function')return null;
  try{return fn(data.matchups,pgSurvivorActiveEntry().picks,data.weeks,pgSurvivorActualWeek(),Date.now(),30,pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorScoreFor(m){
  const fn=window.PickGaugeSurvivorCore?.score?.survivorScore;if(typeof fn!=='function')return m?.winProbability==null?null:m.winProbability*100;
  try{return fn(m,pgSurvivorData().matchups,pgSurvivorUsedTeams(m.week),pgSurvivorPoolDef().picksPerWeek);}catch(e){return m?.winProbability==null?null:m.winProbability*100;}
}
function pgSurvivorFutureRating(team){
  const fn=window.PickGaugeSurvivorCore?.score?.teamFutureValueRating;if(typeof fn!=='function')return null;
  try{return fn(team,pgSurvivorActualWeek(),pgSurvivorData().matchups,pgSurvivorUsedTeams(),pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorStars(team){
  const r=pgSurvivorFutureRating(team);if(r===null||r===undefined)return '';
  const value=typeof r==='number'?r:Number(r.rating??r.stars??r.value);if(!Number.isFinite(value))return '';
  const half=Math.round(value*2)/2,full=Math.floor(half),hasHalf=half-full>=.5;return `<span class="survivor-fv" title="Future Value ${half.toFixed(1)} of 5">${'★'.repeat(full)}${hasHalf?'½':''}</span>`;
}
function pgSurvivorRecommendations(){
  const p=pgSurvivorRuntime.recommendationPlan;
  return (p?.recommendations||[p?.recommendation]).filter(Boolean);
}
function pgSurvivorCompareKey(){return `${pgSurvivorPoolId()}|${pgSurvivorFocusWeek()}`;}
function pgSurvivorCompareSet(){
  const key=pgSurvivorCompareKey();
  if(!(pgSurvivorRuntime.compareByPoolWeek[key] instanceof Set))pgSurvivorRuntime.compareByPoolWeek[key]=new Set();
  return pgSurvivorRuntime.compareByPoolWeek[key];
}
function pgSurvivorWhyOpen(){return !!pgSurvivorRuntime.whyOpenByPool[pgSurvivorPoolId()];}
function pgSurvivorBuildExplanation(m){
  const fn=window.PickGaugeSurvivorCore?.score?.buildPickExplanation;
  if(typeof fn!=='function'||!m)return null;
  try{return fn(m,pgSurvivorData().matchups,pgSurvivorData().weeks,pgSurvivorUsedTeams(m.week),pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorScarcity(){
  const fn=window.PickGaugeSurvivorCore?.score?.seasonScarcity,data=pgSurvivorData();
  if(typeof fn!=='function'||!data)return [];
  const weeks=data.weeks.filter(w=>Number(w)>=Number(pgSurvivorFocusWeek()));
  try{return fn(data.matchups,weeks,pgSurvivorUsedTeams(),0.9,pgSurvivorPoolDef().picksPerWeek)||[];}catch(e){return [];}
}
function pgSurvivorWhatIf(){
  const fn=window.PickGaugeSurvivorCore?.score?.compareWhatIf,data=pgSurvivorData(),teams=[...pgSurvivorCompareSet()];
  if(typeof fn!=='function'||!data||teams.length<2)return [];
  try{return fn(data.matchups,data.weeks,pgSurvivorUsedTeams(pgSurvivorFocusWeek()),pgSurvivorFocusWeek(),teams,pgSurvivorPoolDef().picksPerWeek)||[];}catch(e){return [];}
}
function pgSurvivorMemberTeams(){
  const corePools=window.PickGaugeSurvivorCore?.pools;
  const poolId=pgSurvivorPoolId();
  const data=pgSurvivorData(); if(!data)return [];
  if(poolId==='kelly')return [...new Set(data.matchups.map(m=>m.team))].sort((a,b)=>a.localeCompare(b));
  const def=corePools?.POOL_DEFINITIONS?.[poolId]||corePools?.getPoolDefinition?.(poolId)||null;
  if(Array.isArray(def?.teams))return def.teams;
  return [...new Set(data.matchups.filter(m=>m.isConferenceMember).map(m=>m.team))].sort((a,b)=>a.localeCompare(b));
}
function pgSurvivorFindMatchup(team,week){return pgSurvivorData()?.matchups.find(m=>m.team===team&&Number(m.week)===Number(week))||null;}
function pgSurvivorAddPick(m){
  if(!m)return;
  const entry=pgSurvivorActiveEntry(), required=pgSurvivorPoolDef().picksPerWeek, selected=pgSurvivorSelectedPicks(m.week), used=pgSurvivorUsedTeams(m.week);
  if(used.has(m.team)){pgSurvivorToast(`${m.team} is already used in this entry.`,'error');return;}
  if(selected.includes(m.team))return;
  if(required>1){
    if(selected.length>=required){pgSurvivorToast(`Week ${m.week} already has ${required} picks.`,'error');return;}
    const sameGame=selected.some(team=>pgSurvivorFindMatchup(team,m.week)?.gameId===m.gameId);
    if(sameGame){pgSurvivorToast('Kelly picks cannot be opposite sides of the same game.','error');return;}
    entry.picks[String(m.week)]=[...selected,m.team];
  }else entry.picks[String(m.week)]=m.team;
  pgSurvivorPersist(); pgSurvivorComputePlans(); renderSurvivorShell();
}
function pgSurvivorRemovePick(week,team=null){
  const entry=pgSurvivorActiveEntry(), required=pgSurvivorPoolDef().picksPerWeek;
  if(required>1&&team){const left=pgSurvivorSelectedPicks(week).filter(t=>t!==team);if(left.length)entry.picks[String(week)]=left;else delete entry.picks[String(week)];}
  else delete entry.picks[String(week)];
  pgSurvivorPersist();pgSurvivorComputePlans();renderSurvivorShell();
}
function pgSurvivorToast(message,type=''){
  const el=document.getElementById('survivorStatus');if(!el)return;
  el.className=`survivor-status ${type||'info'}`;el.textContent=message;el.hidden=false;
  clearTimeout(pgSurvivorToast._t);pgSurvivorToast._t=setTimeout(()=>{el.hidden=true;},4500);
}
function pgSurvivorShellHTML(){
  return `<section id="survivorStatus" class="survivor-status" hidden></section>
  <div class="survivor-context-card">
    <div class="survivor-context-field"><label>Survivor pool</label><select id="survivorPoolSelect"><option value="sec">SEC Survivor</option><option value="bigten">Big Ten Survivor</option><option value="kelly">KellyInVegas Championship</option></select><small id="survivorPoolRule"></small></div>
    <div class="survivor-context-field"><label>Entry</label><select id="survivorEntrySelect"></select></div>
    <div class="survivor-context-field"><label>Viewing week</label><select id="survivorWeekSelect"></select></div>
    <button type="button" class="btn btn-light" id="survivorAddEntryBtn">+ Add entry</button>
  </div>
  <div id="survivorHealth"></div><div id="survivorHero"></div>
  <div id="survivorWhy"></div>
  <nav class="survivor-subnav" id="survivorSubnav"><button data-survivor-view="board">Season Board</button><button data-survivor-view="rankings">Week Rankings</button><button data-survivor-view="plan">Season Plan</button><button data-survivor-view="picks">My Picks</button></nav>
  <div class="survivor-view" id="survivor-view-board"></div><div class="survivor-view" id="survivor-view-rankings"></div><div class="survivor-view" id="survivor-view-plan"></div><div class="survivor-view" id="survivor-view-picks"></div>`;
}
function pgSurvivorEnsureMounted(){
  const host=document.getElementById('survivorMount');if(!host)return false;
  if(!host.dataset.mounted){host.innerHTML=pgSurvivorShellHTML();host.dataset.mounted='1';pgSurvivorBindEvents();}
  return true;
}
function pgSurvivorRenderControls(){
  const ui=pgSurvivorUi(), pool=pgSurvivorPoolDef(), p=pgSurvivorPoolState(), active=pgSurvivorActiveEntry(), data=pgSurvivorData();
  const ps=document.getElementById('survivorPoolSelect');if(ps)ps.value=ui.poolId;
  const es=document.getElementById('survivorEntrySelect');if(es)es.innerHTML=p.entries.map(e=>`<option value="${esc(e.id)}"${e.id===active.id?' selected':''}>${esc(e.name)}</option>`).join('');
  const ws=document.getElementById('survivorWeekSelect');if(ws){const weeks=data?.weeks||Array.from({length:13},(_,i)=>i+1);ws.innerHTML=weeks.map(w=>`<option value="${w}"${w===pgSurvivorFocusWeek()?' selected':''}>Week ${w}</option>`).join('');}
  const rules={sec:'Listed SEC games · either team · straight up · use once',bigten:'Listed Big Ten games · either team · straight up · use once',kelly:'2 picks/week · both must win · no reuse · no opposite sides'};
  const rule=document.getElementById('survivorPoolRule');if(rule)rule.textContent=rules[ui.poolId];
  document.querySelectorAll('#survivorSubnav [data-survivor-view]').forEach(b=>b.classList.toggle('active',b.dataset.survivorView===ui.view));
  document.querySelectorAll('#tab-survivor .survivor-view').forEach(v=>v.classList.toggle('active',v.id===`survivor-view-${ui.view}`));
}
function pgSurvivorRenderHealth(){
  const el=document.getElementById('survivorHealth');if(!el)return;
  const poolId=pgSurvivorPoolId(),data=pgSurvivorData(),err=pgSurvivorRuntime.errorByPool[poolId],loading=pgSurvivorRuntime.loadingByPool[poolId];
  if(err){el.innerHTML=`<div class="survivor-health-strip error"><b>Data issue</b><span>${esc(err)}</span><button class="btn-link-sm" data-survivor-retry>Retry</button></div>`;return;}
  if(!data||loading){el.innerHTML='<div class="survivor-health-strip"><b>Data health</b><span>Loading PickGauge shared CFBD schedule + WP + SP+ + lines…</span></div>';return;}
  const ok=data.schedule.authoritativeComplete??(data.schedule.matched===data.schedule.expected), coverage=data.probability.total?Math.round(data.probability.modeled/data.probability.total*100):0;
  const src=data.probability.bySource||{}, lineCount=data.bettingLines?.gamesWithLine??0, lineTotal=data.bettingLines?.totalGames??0;
  const canonicalMatched=data.schedule.canonicalMatched??data.schedule.matched, canonicalExpected=data.schedule.canonicalExpected??data.schedule.expected;
  const fallbackCount=data.schedule.upstreamFallbackCount||0, degraded=data.enrichment?.status==='degraded';
  const identityNote=fallbackCount?`<span class="survivor-health-warn">CFBD IDs <strong>${canonicalMatched}/${canonicalExpected}</strong> · ${fallbackCount} upstream schedule fallback${fallbackCount===1?'':'s'}</span>`:`<span>CFBD IDs <strong>${canonicalMatched}/${canonicalExpected}</strong></span>`;
  el.innerHTML=`<div class="survivor-health-strip${ok&&!degraded&&!fallbackCount?'':' warning'}"><b>Data health</b><span>Schedule <strong>${data.schedule.matched}/${data.schedule.expected}${ok?' ✓':' ⚠'}</strong></span>${identityNote}<span>Probabilities <strong>${coverage}%</strong> <small>WP ${src.WP||0} · SP+ ${src['SP+']||0} · Line ${src.Line||0} · Missing ${src.Missing||0}</small></span><span>Lines <strong>${lineCount}/${lineTotal}</strong></span><span>Results <strong>PickGauge CFBD</strong></span>${degraded?`<span class="survivor-health-warn">Enrichment fallback · ${esc(data.enrichment.warning||'WP/season lines unavailable')}</span>`:''}</div>`;
}
function pgSurvivorRenderHero(){
  const el=document.getElementById('survivorHero');if(!el)return;
  const data=pgSurvivorData(),pool=pgSurvivorPoolDef();
  if(!data){el.innerHTML='<div class="survivor-decision-card"><div class="survivor-decision-main"><div class="eyebrow">Survivor</div><h2>Loading shared season model…</h2></div></div>';return;}
  const recs=pgSurvivorRecommendations();
  const title=pool.picksPerWeek===2?'Best pair this week':'Best play this week';
  const names=recs.length?recs.map(r=>r.team).join(' + '):'No complete recommendation yet';
  const probs=recs.length?recs.map(r=>pgSurvivorFmtPct(r.p,0)).join(' · '):'—';
  const plan=pgSurvivorRuntime.recommendationPlan,entryStatus=pgSurvivorEntryStatus();
  const survival=entryStatus?.status==='eliminated'?'0%':plan?.coverageComplete?pgSurvivorFmtPct(plan.survivalProbability,1):'—';
  const available=data.matchups.filter(m=>m.week===pgSurvivorFocusWeek()&&!pgSurvivorUsedTeams(pgSurvivorFocusWeek()).has(m.team)).length;
  el.innerHTML=`<section class="survivor-decision-card"><div class="survivor-decision-main"><div class="eyebrow">${title}</div><h2>${esc(names)}</h2><p>${esc(probs)} · exact remaining-season optimizer${entryStatus?.status==='eliminated'?' · research only — entry eliminated':''}${plan&&!plan.coverageComplete?' · partial model coverage':''}</p>${recs.length?`<button type="button" class="btn-link-sm survivor-why-toggle" data-survivor-why-toggle>${pgSurvivorWhyOpen()?'Hide why':pool.picksPerWeek===2?'Why this pair?':'Why this pick?'}</button>`:''}</div><div class="survivor-metric"><span>Week</span><strong>${pgSurvivorFocusWeek()}</strong><small>focused</small></div><div class="survivor-metric"><span>Available</span><strong>${available}</strong><small>unused sides</small></div><div class="survivor-metric"><span>Plan survival</span><strong>${survival}</strong><small>exact path</small></div></section>`;
}
function pgSurvivorRenderWhy(){
  const el=document.getElementById('survivorWhy');if(!el)return;
  const recs=pgSurvivorRecommendations();
  if(!pgSurvivorWhyOpen()||!recs.length){el.innerHTML='';return;}
  const cards=recs.map((rec,index)=>{
    const m=pgSurvivorFindMatchup(rec.team,pgSurvivorFocusWeek()),x=pgSurvivorBuildExplanation(m),b=x?.scoreBreakdown;
    if(!m)return'';
    const future=x?.futureBestSpot?`Best future spot: W${x.futureBestSpot.week} ${pgSurvivorFmtPct(x.futureBestSpot.p)}`:'No stronger modeled future spot';
    const scarcity=x?.scoreBreakdown?.scarcity?.criticalWeek;
    return `<div class="survivor-why-card"><div class="survivor-why-title"><span>${pgSurvivorPoolDef().picksPerWeek>1?`Pick ${index+1}`:'Best path'}</span><b>${esc(m.team)}</b></div><div class="survivor-why-facts"><span><small>Safety</small><b>${pgSurvivorFmtPct(m.winProbability)}${x?.safetyRank?` · #${x.safetyRank}/${x.optionCount}`:''}</b></span><span><small>Survivor Score</small><b>${x?.score==null?'—':Number(x.score).toFixed(1)}</b></span><span><small>Future value</small><b>${esc(future)}</b></span><span><small>Scarcity</small><b>${scarcity?`Save for W${scarcity.week} · ${esc(scarcity.label||'scarce')}`:'No critical 90%+ spot'}</b></span></div>${b?`<div class="survivor-score-points"><span>Safety ${Number(b.safetyPoints||0).toFixed(1)}</span><span>Preservation ${Number(b.preservationPoints||0).toFixed(1)}</span><span>Scarcity ${Number(b.scarcityPoints||0).toFixed(1)}</span></div>`:''}</div>`;
  }).join('');
  el.innerHTML=`<section class="survivor-why-panel"><div class="eyebrow">Why the exact path starts here</div>${cards}</section>`;
}
function pgSurvivorCellClass(p){if(p===null)return'';return p>=.9?'elite':p>=.8?'strong':p>=.7?'medium':'risky';}
function pgSurvivorRenderBoard(){
  const el=document.getElementById('survivor-view-board'),data=pgSurvivorData();if(!el)return;
  if(!data){el.innerHTML='<div class="card"><p class="sub">Season Board will appear when shared CFBD data finishes loading.</p></div>';return;}
  const weeks=data.weeks, teams=pgSurvivorMemberTeams(),used=pgSurvivorUsedTeams();
  let html=`<div class="survivor-view-head"><div><div class="eyebrow">Full season</div><h2>${esc(pgSurvivorPoolDef().name)} Season Board</h2><p>Click a matchup to use that team. Probabilities reuse PickGauge shared SP+ ratings with current shared lines as a fallback; direct CFBD WP/full-season line enrichment is the next data-source upgrade.</p></div></div><div class="survivor-board"><table><thead><tr><th class="survivor-team-col">Team</th>${weeks.map(w=>`<th>W${w}</th>`).join('')}</tr></thead><tbody>`;
  teams.forEach(team=>{
    html+=`<tr><td class="survivor-team-col"><b>${esc(team)}</b>${pgSurvivorStars(team)}${used.has(team)?'<small>USED</small>':''}</td>`;
    weeks.forEach(w=>{const m=pgSurvivorFindMatchup(team,w);if(!m){html+='<td><span class="survivor-empty">—</span></td>';return;}const selected=pgSurvivorSelectedPicks(w).includes(team),isUsed=used.has(team)&&!selected,r=pgSurvivorResult(m);html+=`<td><button class="survivor-game-cell ${pgSurvivorCellClass(m.winProbability)}${selected?' picked':''}${isUsed?' used':''}" data-survivor-pick-game="${esc(String(m.gameId))}" data-survivor-pick-team="${esc(team)}" ${isUsed?'disabled':''}><span class="survivor-cell-top"><b>${esc(pgSurvivorMatchLabel(m))}</b><strong>${pgSurvivorFmtPct(m.winProbability)}</strong></span><small>${esc(m.spread)} · ${esc(m.probabilitySourceShort)}${r?` · ${r.label}`:''}</small></button></td>`;});
    html+='</tr>';
  });
  html+='</tbody></table></div>';el.innerHTML=html;
}
function pgSurvivorRenderRankings(){
  const el=document.getElementById('survivor-view-rankings'),data=pgSurvivorData();if(!el)return;
  if(!data){el.innerHTML='<div class="card">Loading rankings…</div>';return;}
  const week=pgSurvivorFocusWeek(),used=pgSurvivorUsedTeams(week),selected=pgSurvivorSelectedPicks(week),recTeams=new Set(pgSurvivorRecommendations().map(r=>r.team));
  const rows=data.matchups.filter(m=>m.week===week&&!used.has(m.team)).map(m=>({m,score:pgSurvivorScoreFor(m)})).sort((a,b)=>(recTeams.has(b.m.team)?1:0)-(recTeams.has(a.m.team)?1:0)||(b.score??-1)-(a.score??-1)||(b.m.winProbability??-1)-(a.m.winProbability??-1)||a.m.team.localeCompare(b.m.team));
  const compare=pgSurvivorCompareSet(),whatIf=pgSurvivorWhatIf();
  const comparePanel=compare.size?`<div class="survivor-compare-panel"><div class="survivor-compare-head"><div><b>What-if comparison</b><small>${compare.size<2?'Choose one more team to compare exact remaining paths.':'Exact path if each candidate is forced into this week.'}</small></div><button class="btn-link-sm" data-survivor-compare-clear>Clear</button></div>${whatIf.length?`<div class="survivor-compare-grid">${whatIf.map((r,i)=>{const path=r.coverageComplete?r.survivalProbability:r.modeledSurvivalProbability;return `<span><small>${esc(r.team)}</small><b>${path==null?'—':pgSurvivorFmtPct(path,2)}</b><em>${i===0?'Best':r.deltaFromBest==null?'Partial':`${(r.deltaFromBest*100).toFixed(2)} pp`}</em></span>`;}).join('')}</div>`:''}</div>`:'';
  el.innerHTML=`<div class="survivor-view-head"><div><div class="eyebrow">Decision board</div><h2>Week ${week} Rankings</h2><p>Exact-path recommendation is pinned first; remaining options use the scarcity-aware Survivor Score. Compare locks a candidate into this week and re-solves the exact season path.</p></div></div>${comparePanel}<div class="survivor-ranking-list">${rows.map(({m,score},i)=>`<div class="survivor-rank-row${recTeams.has(m.team)?' best':''}"><span class="survivor-rank-num">${i+1}</span><span class="survivor-rank-team"><b>${esc(m.team)}</b><small>${esc(pgSurvivorMatchLabel(m))} · ${esc(m.spread)} · ${esc(m.probabilitySourceShort)}</small></span><span><small>Win prob</small><b>${pgSurvivorFmtPct(m.winProbability)}</b><small>Score ${score===null?'—':Number(score).toFixed(1)}</small></span><span>${recTeams.has(m.team)?'<span class="survivor-badge best">BEST PATH</span>':selected.includes(m.team)?'<span class="survivor-badge picked">YOUR PICK</span>':''}</span><span class="survivor-rank-actions"><button class="btn btn-light" data-survivor-compare-team="${esc(m.team)}">${compare.has(m.team)?'Compared':'Compare'}</button><button class="btn btn-go" data-survivor-pick-game="${esc(String(m.gameId))}" data-survivor-pick-team="${esc(m.team)}">Use</button></span></div>`).join('')}</div>`;
}
function pgSurvivorRenderPlan(){
  const el=document.getElementById('survivor-view-plan');if(!el)return;
  const plan=pgSurvivorRuntime.plan;
  if(!pgSurvivorData()){el.innerHTML='<div class="card">Loading exact season plan…</div>';return;}
  if(!plan){el.innerHTML='<div class="card"><p class="sub">Exact planner is unavailable until the Survivor core finishes loading.</p></div>';return;}
  const picks=Array.isArray(plan.picks)?plan.picks:[];
  const scarcity=pgSurvivorScarcity();
  const scarcityHtml=scarcity.length?`<div class="survivor-scarcity-strip"><b>Future-week difficulty</b>${scarcity.map(w=>`<span class="${String(w.label||'').toLowerCase().replace(/\s+/g,'-')}"><small>W${w.week}</small><b>${esc(w.label||'—')}</b><em>${w.safeCount} safe${pgSurvivorPoolDef().picksPerWeek>1?` · ${(Number(w.optionsPerRequiredPick)||0).toFixed(1)}/pick`:''}</em></span>`).join('')}</div>`:'';
  el.innerHTML=`<div class="survivor-view-head"><div><div class="eyebrow">Season optimization</div><h2>Best remaining path</h2><p>Exact optimizer · ${plan.modeledPickCount??plan.modeledWeekCount??picks.filter(p=>p.p!==null).length}/${plan.requiredPickCount??plan.requiredWeekCount??picks.length} modeled slots.</p></div></div>${scarcityHtml}<div class="survivor-plan"><div class="survivor-plan-row head"><span>Week</span><span>Pick</span><span>Win probability</span><span>Line</span><span>Status</span></div>${picks.map((p,index)=>`<div class="survivor-plan-row"><b>W${p.week}${pgSurvivorPoolDef().picksPerWeek>1?` · P${(index%pgSurvivorPoolDef().picksPerWeek)+1}`:''}</b><span><b>${esc(p.team||'No modeled pick')}</b>${p.opponent?`<small>${esc(p.opponent)}</small>`:''}</span><b>${pgSurvivorFmtPct(p.p)}</b><span>${esc(p.spread||'—')}</span><span>${p.locked?'Locked':'Optimal path'}</span></div>`).join('')}</div>`;
}
function pgSurvivorRenderPicks(){
  const el=document.getElementById('survivor-view-picks'),data=pgSurvivorData();if(!el)return;
  const entry=pgSurvivorActiveEntry(), weeks=data?.weeks||Array.from({length:13},(_,i)=>i+1),used=pgSurvivorUsedTeams(),status=pgSurvivorEntryStatus();
  el.innerHTML=`<div class="survivor-view-head survivor-picks-head"><div><div class="eyebrow">Entry tracker ${status?.label?`· ${esc(status.label)}`:''}</div><h2>${esc(entry.name)}</h2><p>Picks sync with your PickGauge account; active view/week stays local to this device.</p></div><label>Entry name <input id="survivorEntryName" type="text" maxlength="40" value="${esc(entry.name)}"></label></div><div class="survivor-picks-layout"><div class="card"><h2>Weekly picks</h2>${weeks.map(w=>{const teams=pgSurvivorSelectedPicks(w);return `<div class="survivor-pick-history"><b>Week ${w}</b><span>${teams.length?teams.map(team=>{const m=pgSurvivorFindMatchup(team,w),r=pgSurvivorResult(m);return `<span class="survivor-pick-chip">${esc(team)}${r?` · ${r.label}`:''}<button data-survivor-remove-week="${w}" data-survivor-remove-team="${esc(team)}" aria-label="Remove ${esc(team)}">×</button></span>`;}).join(' '):`<span class="faint">${pgSurvivorPoolDef().picksPerWeek>1?'0 / 2 picks':'No pick'}</span>`}</span></div>`;}).join('')}</div><aside class="card"><h2>Teams burned</h2><div class="survivor-burned">${[...used].sort().map(t=>`<span>${esc(t)}</span>`).join('')||'<span class="faint">None yet</span>'}</div></aside></div>`;
}
function renderSurvivorShell(){
  if(!pgSurvivorEnsureMounted())return;
  pgSurvivorState();if(pgSurvivorData()&&typeof refreshPickGaugeSurvivorResults==='function')refreshPickGaugeSurvivorResults(pgSurvivorData());pgSurvivorComputePlans();pgSurvivorRenderControls();pgSurvivorRenderHealth();pgSurvivorRenderHero();pgSurvivorRenderWhy();pgSurvivorRenderBoard();pgSurvivorRenderRankings();pgSurvivorRenderPlan();pgSurvivorRenderPicks();
  const poolId=pgSurvivorPoolId();if(!pgSurvivorRuntime.dataByPool[poolId]&&!pgSurvivorRuntime.loadingByPool[poolId]&&!pgSurvivorRuntime.errorByPool[poolId])pgSurvivorEnsureSharedData(false).catch(()=>{});
}
function pgSurvivorMatchupFromButton(btn){
  const gameId=btn?.dataset?.survivorPickGame,team=btn?.dataset?.survivorPickTeam;
  return pgSurvivorData()?.matchups.find(m=>String(m.gameId)===String(gameId)&&m.team===team)||null;
}
function pgSurvivorBindEvents(){
  const host=document.getElementById('survivorMount');if(!host)return;
  host.addEventListener('change',e=>{
    const ui=pgSurvivorUi();
    if(e.target.id==='survivorPoolSelect'){ui.poolId=PG_SURVIVOR_POOLS[e.target.value]?e.target.value:'sec';pgSurvivorSaveUi(ui);renderSurvivorShell();}
    else if(e.target.id==='survivorEntrySelect'){ui.entryByPool[ui.poolId]=e.target.value;pgSurvivorSaveUi(ui);pgSurvivorComputePlans();renderSurvivorShell();}
    else if(e.target.id==='survivorWeekSelect'){ui.weekByPool[ui.poolId]=Number(e.target.value)||1;pgSurvivorSaveUi(ui);pgSurvivorComputePlans();renderSurvivorShell();}
    else if(e.target.id==='survivorEntryName'){const entry=pgSurvivorActiveEntry();entry.name=String(e.target.value||'').trim()||entry.name;pgSurvivorPersist();renderSurvivorShell();}
  });
  host.addEventListener('click',e=>{
    const ui=pgSurvivorUi(), viewBtn=e.target.closest('[data-survivor-view]');
    if(viewBtn){ui.view=viewBtn.dataset.survivorView;pgSurvivorSaveUi(ui);renderSurvivorShell();return;}
    if(e.target.closest('#survivorAddEntryBtn')){const p=pgSurvivorPoolState(),entry=pgSurvivorDefaultEntry(`Entry ${p.entries.length+1}`);p.entries.push(entry);ui.entryByPool[ui.poolId]=entry.id;ui.view='picks';pgSurvivorSaveUi(ui);pgSurvivorPersist();renderSurvivorShell();return;}
    if(e.target.closest('[data-survivor-why-toggle]')){pgSurvivorRuntime.whyOpenByPool[pgSurvivorPoolId()]=!pgSurvivorWhyOpen();renderSurvivorShell();return;}
    if(e.target.closest('[data-survivor-compare-clear]')){pgSurvivorCompareSet().clear();renderSurvivorShell();return;}
    const compare=e.target.closest('[data-survivor-compare-team]');if(compare){const set=pgSurvivorCompareSet(),team=compare.dataset.survivorCompareTeam;if(set.has(team))set.delete(team);else if(set.size<4)set.add(team);else pgSurvivorToast('Compare up to four teams at a time.');renderSurvivorShell();return;}
    const retry=e.target.closest('[data-survivor-retry]');if(retry){pgSurvivorRuntime.errorByPool[pgSurvivorPoolId()]=null;pgSurvivorEnsureSharedData(true).catch(()=>{});renderSurvivorShell();return;}
    const remove=e.target.closest('[data-survivor-remove-week]');if(remove){pgSurvivorRemovePick(Number(remove.dataset.survivorRemoveWeek),remove.dataset.survivorRemoveTeam||null);return;}
    const pick=e.target.closest('[data-survivor-pick-game]');if(pick){pgSurvivorAddPick(pgSurvivorMatchupFromButton(pick));return;}
  });
}
window.addEventListener('pickgauge-survivor-core-ready',()=>{if(document.getElementById('tab-survivor')?.classList.contains('active')){pgSurvivorComputePlans();renderSurvivorShell();}});

setInterval(()=>{if(document.visibilityState!=="hidden"&&document.getElementById('tab-survivor')?.classList.contains('active')&&pgSurvivorData())renderSurvivorShell();},90000);
