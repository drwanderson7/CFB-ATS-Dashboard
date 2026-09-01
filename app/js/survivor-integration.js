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
let pgSurvivorRuntime={dataByPool:{},loadingByPool:{},errorByPool:{},plan:null,recommendationPlan:null,whyOpenByPool:{},compareByPoolWeek:{},boardSortByPool:{}};

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
      const pickMeta=(entry?.pickMeta&&typeof entry.pickMeta==='object'&&!Array.isArray(entry.pickMeta))?entry.pickMeta:{};
      return {id,name,picks,pickMeta};
    });
    p.recommendationHistory=(p.recommendationHistory&&typeof p.recommendationHistory==='object'&&!Array.isArray(p.recommendationHistory))?p.recommendationHistory:{};
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
    view:['board','rankings','plan','picks','history'].includes(raw.view)?raw.view:'board',
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
function pgSurvivorEntryIndex(entryId=null){
  const p=pgSurvivorPoolState(),id=entryId||pgSurvivorActiveEntry()?.id;
  return p.entries.findIndex(entry=>entry.id===id);
}
function pgSurvivorCopyName(sourceName,entries){
  const root=`${String(sourceName||'Entry').trim()||'Entry'} copy`;
  const names=new Set(entries.map(entry=>String(entry.name||'').toLowerCase()));
  if(!names.has(root.toLowerCase()))return root;
  let n=2;
  while(names.has(`${root} ${n}`.toLowerCase()))n+=1;
  return `${root} ${n}`;
}
function pgSurvivorDuplicateEntry(){
  const p=pgSurvivorPoolState(),source=pgSurvivorActiveEntry();if(!source)return;
  const index=pgSurvivorEntryIndex(source.id);
  const duplicate={id:uid(),name:pgSurvivorCopyName(source.name,p.entries),picks:JSON.parse(JSON.stringify(source.picks||{})),pickMeta:JSON.parse(JSON.stringify(source.pickMeta||{}))};
  p.entries.splice(index+1,0,duplicate);
  const ui=pgSurvivorUi();ui.entryByPool[ui.poolId]=duplicate.id;ui.view='picks';pgSurvivorSaveUi(ui);
  pgSurvivorPersist();pgSurvivorComputePlans();renderSurvivorShell();
  pgSurvivorToast(`Duplicated ${source.name}.`);
}
function pgSurvivorMoveEntry(delta){
  const p=pgSurvivorPoolState(),entry=pgSurvivorActiveEntry();if(!entry)return;
  const from=pgSurvivorEntryIndex(entry.id),to=Math.max(0,Math.min(p.entries.length-1,from+Number(delta||0)));
  if(from<0||to===from)return;
  const [moved]=p.entries.splice(from,1);p.entries.splice(to,0,moved);
  pgSurvivorPersist();renderSurvivorShell();
}
async function pgSurvivorDeleteEntry(){
  const p=pgSurvivorPoolState(),entry=pgSurvivorActiveEntry();if(!entry)return;
  if(p.entries.length<=1){pgSurvivorToast('Keep at least one entry in each Survivor pool.','error');return;}
  const savedPickCount=Object.values(entry.picks||{}).reduce((sum,value)=>sum+(Array.isArray(value)?value:[value]).filter(Boolean).length,0);
  if(typeof pgConfirm!=='function'){pgSurvivorToast('Delete confirmation is unavailable. Refresh PickGauge and try again.','error');return;}
  const confirmed=await pgConfirm({
    eyebrow:'Survivor entry',
    title:`Delete ${entry.name}?`,
    message:`This will permanently remove the entry and its ${savedPickCount} saved pick${savedPickCount===1?'':'s'}. Other entries are not affected.`,
    confirmText:'Delete entry',
    cancelText:'Keep entry',
    danger:true
  });
  if(!confirmed)return;
  const index=pgSurvivorEntryIndex(entry.id);
  p.entries.splice(index,1);
  const replacement=p.entries[Math.min(index,p.entries.length-1)]||p.entries[0];
  const ui=pgSurvivorUi();ui.entryByPool[ui.poolId]=replacement.id;pgSurvivorSaveUi(ui);
  pgSurvivorPersist();pgSurvivorComputePlans();renderSurvivorShell();
  pgSurvivorToast(`${entry.name} deleted.`);
}
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
  try{pgSurvivorMaybeRecordRecommendation();}catch(e){console.warn('Survivor recommendation history capture skipped',e);}
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
function pgSurvivorFutureValueMeaning(value){
  const v=Number(value);
  if(!Number.isFinite(v))return {label:'No model',guidance:'Future usefulness is not modeled yet'};
  if(v>=4.5)return {label:'Elite',guidance:'Very valuable later — save if you can'};
  if(v>=3.5)return {label:'High',guidance:'Strong future value — lean toward saving'};
  if(v>=2.5)return {label:'Medium',guidance:'Useful later, but spendable in the right spot'};
  if(v>=1.5)return {label:'Low',guidance:'Limited future value — easier to use now'};
  return {label:'Minimal',guidance:'Little modeled future value — good candidate to spend now'};
}
function pgSurvivorFutureValueInfo(team){
  const r=pgSurvivorFutureRating(team);
  if(r===null||r===undefined)return null;
  const value=typeof r==='number'?r:Number(r.rating??r.stars??r.value);
  if(!Number.isFinite(value))return null;
  const half=Math.round(value*2)/2;
  const meaning=pgSurvivorFutureValueMeaning(half);
  return {rating:r,value:half,label:r?.label||meaning.label,guidance:meaning.guidance,index:Number.isFinite(r?.index)?Number(r.index):null,best:r?.best??null,criticalWeek:r?.criticalWeek??null};
}
function pgSurvivorStars(team){
  const info=pgSurvivorFutureValueInfo(team);if(!info)return '';
  const full=Math.floor(info.value),hasHalf=info.value-full>=.5;
  const starText=`${'★'.repeat(full)}${hasHalf?'½':''}`;
  const title=`Future Value ${info.value.toFixed(1)}/5 · ${info.label}. ${info.guidance}. Higher stars = more reason to save this team for later.`;
  return `<span class="survivor-fv" title="${esc(title)}" aria-label="${esc(title)}">${starText}</span>`;
}
function pgSurvivorDecisionSummary(m,x,pairMode=false){
  if(!m)return '';
  if(pairMode)return 'Chosen as part of the best two-pick season path — not simply the two highest win probabilities this week.';
  const safety=x?.safetyRank===1?'the safest modeled option this week':x?.safetyRank?`#${x.safetyRank} in this week's win probability`:'a strong current-week option';
  const fv=pgSurvivorFutureValueInfo(m.team);
  let future='without over-spending future value';
  if(fv?.value>=4)future='even though it remains valuable later';
  else if(fv?.value<=2)future='and its limited future value makes this a good spot to use it';
  const edge=Number(x?.pathAdvantageVsAlternative);
  const path=Number.isFinite(edge)&&Math.abs(edge)>=0.0005
    ? `The exact remaining-season path is ${(edge*100).toFixed(2)} percentage points stronger than the next comparable path`
    : 'It fits the strongest complete remaining-season path';
  return `${m.team} is ${safety} ${future}. ${path}.`;
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

function pgSurvivorPickMetaKey(week,team){return `${Number(week)}|${String(team||'')}`;}
function pgSurvivorRecordPickMeta(entry,m){
  if(!entry||!m)return;
  entry.pickMeta=(entry.pickMeta&&typeof entry.pickMeta==='object')?entry.pickMeta:{};
  const key=pgSurvivorPickMetaKey(m.week,m.team);
  if(entry.pickMeta[key])return;
  entry.pickMeta[key]={
    selectedAt:new Date().toISOString(),
    week:Number(m.week),team:m.team,opponent:m.opponent||'',gameId:m.gameId??null,
    winProbability:Number.isFinite(Number(m.winProbability))?Number(m.winProbability):null,
    probabilitySource:m.probabilitySourceShort||m.probabilitySource||'',
    spread:m.spread??null
  };
}
function pgSurvivorDropPickMeta(entry,week,team=null){
  if(!entry?.pickMeta||typeof entry.pickMeta!=='object')return;
  if(team){delete entry.pickMeta[pgSurvivorPickMetaKey(week,team)];return;}
  Object.keys(entry.pickMeta).forEach(key=>{if(Number(key.split('|')[0])===Number(week))delete entry.pickMeta[key];});
}
function pgSurvivorPickMeta(entry,week,team){return entry?.pickMeta?.[pgSurvivorPickMetaKey(week,team)]||null;}
function pgSurvivorRecommendationSignature(rows,planSurvival){
  return JSON.stringify({
    teams:(rows||[]).map(row=>[row.team,Number.isFinite(Number(row.p))?Number(Number(row.p).toFixed(4)):null]),
    plan:Number.isFinite(Number(planSurvival))?Number(Number(planSurvival).toFixed(5)):null
  });
}
function pgSurvivorMaybeRecordRecommendation(){
  const data=pgSurvivorData(),plan=pgSurvivorRuntime.recommendationPlan;if(!data||!plan)return;
  const recs=(plan.recommendations||[plan.recommendation]).filter(Boolean);if(!recs.length)return;
  const pool=pgSurvivorPoolState(),week=pgSurvivorFocusWeek(),actual=pgSurvivorActualWeek();
  pool.recommendationHistory=(pool.recommendationHistory&&typeof pool.recommendationHistory==='object')?pool.recommendationHistory:{};
  const existing=pool.recommendationHistory[String(week)]||null;
  if(existing&&Number(week)<Number(actual))return; // past weeks stay frozen
  const rows=recs.map(rec=>({team:rec.team,p:Number.isFinite(Number(rec.p))?Number(rec.p):null}));
  const planSurvival=plan.coverageComplete?plan.survivalProbability:(plan.modeledSurvivalProbability??null);
  const signature=pgSurvivorRecommendationSignature(rows,planSurvival);
  if(existing?.signature===signature)return;
  const now=new Date().toISOString();
  pool.recommendationHistory[String(week)]={
    firstCapturedAt:existing?.firstCapturedAt||now,
    updatedAt:now,
    recommendations:rows,
    planSurvival:Number.isFinite(Number(planSurvival))?Number(planSurvival):null,
    signature
  };
  pgSurvivorPersist();
}
function pgSurvivorRecordedRecommendation(week){
  return pgSurvivorPoolState()?.recommendationHistory?.[String(week)]||null;
}
function pgSurvivorAddPick(m){
  if(!m)return;
  const entry=pgSurvivorActiveEntry(), required=pgSurvivorPoolDef().picksPerWeek, selected=pgSurvivorSelectedPicks(m.week), used=pgSurvivorUsedTeams(m.week);
  if(selected.includes(m.team)){pgSurvivorRemovePick(m.week,m.team);return;}
  if(used.has(m.team)){pgSurvivorToast(`${m.team} is already used in this entry.`,'error');return;}
  if(required>1){
    if(selected.length>=required){pgSurvivorToast(`Week ${m.week} already has ${required} picks.`,'error');return;}
    const sameGame=selected.some(team=>pgSurvivorFindMatchup(team,m.week)?.gameId===m.gameId);
    if(sameGame){pgSurvivorToast('Kelly picks cannot be opposite sides of the same game.','error');return;}
    entry.picks[String(m.week)]=[...selected,m.team];
  }else entry.picks[String(m.week)]=m.team;
  pgSurvivorRecordPickMeta(entry,m);pgSurvivorPersist(); pgSurvivorComputePlans(); renderSurvivorShell();
}
function pgSurvivorRemovePick(week,team=null){
  const entry=pgSurvivorActiveEntry(), required=pgSurvivorPoolDef().picksPerWeek;
  if(required>1&&team){const left=pgSurvivorSelectedPicks(week).filter(t=>t!==team);if(left.length)entry.picks[String(week)]=left;else delete entry.picks[String(week)];}
  else delete entry.picks[String(week)];
  pgSurvivorDropPickMeta(entry,week,team);pgSurvivorPersist();pgSurvivorComputePlans();renderSurvivorShell();
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
  <div id="survivorWhy"></div><div id="survivorWeeklySummary"></div>
  <nav class="survivor-subnav" id="survivorSubnav"><button data-survivor-view="board">Season Board</button><button data-survivor-view="rankings">Week Rankings</button><button data-survivor-view="plan">Season Plan</button><button data-survivor-view="picks">My Picks</button><button data-survivor-view="history">History</button></nav>
  <div class="survivor-view" id="survivor-view-board"></div><div class="survivor-view" id="survivor-view-rankings"></div><div class="survivor-view" id="survivor-view-plan"></div><div class="survivor-view" id="survivor-view-picks"></div><div class="survivor-view" id="survivor-view-history"></div>`;
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
  if(err){el.innerHTML=`<div class="survivor-health-card error"><div class="survivor-health-strip"><span class="survivor-health-state">Data issue</span><span>Survivor data could not finish loading.</span><button class="btn-link-sm" data-survivor-retry>Retry</button></div><details class="survivor-health-details"><summary>Technical details</summary><div class="survivor-health-detail-body"><p>${esc(err)}</p></div></details></div>`;return;}
  if(!data||loading){el.innerHTML='<div class="survivor-health-card"><div class="survivor-health-strip"><span class="survivor-health-state loading">Loading data…</span><span>Building the Survivor board from PickGauge data.</span></div></div>';return;}
  const ok=data.schedule.authoritativeComplete??(data.schedule.matched===data.schedule.expected);
  const coverage=data.probability.total?Math.round(data.probability.modeled/data.probability.total*100):0;
  const src=data.probability.bySource||{},lineCount=data.bettingLines?.gamesWithLine??0,lineTotal=data.bettingLines?.totalGames??0;
  const canonicalMatched=data.schedule.canonicalMatched??data.schedule.matched,canonicalExpected=data.schedule.canonicalExpected??data.schedule.expected;
  const fallbackCount=data.schedule.upstreamFallbackCount||0,degraded=data.enrichment?.status==='degraded';
  const healthy=ok&&!degraded;
  const state=healthy?'Data ready':ok?'Data ready · fallback estimates':'Data check';
  const summary=healthy
    ? 'Schedule, win probabilities, and results are ready.'
    : ok
      ? 'The board is ready; some win probabilities are using fallback estimates.'
      : 'Some schedule data is incomplete, so recommendations may be partial.';
  const fallbackNote=fallbackCount
    ? `<p class="survivor-health-note">Verified schedule fallback: ${fallbackCount} listed game${fallbackCount===1?' is':'s are'} filled from the pool schedule because a matching CFBD game identity is currently unavailable. The real CFBD game automatically replaces the fallback when it appears.</p>`
    : '';
  const degradedNote=degraded
    ? `<p class="survivor-health-note warning">Direct CFBD enrichment is temporarily limited. PickGauge is automatically using the next-best available source (SP+ or line-derived probability) instead of leaving the board blank.${data.enrichment?.warning?` <span class="survivor-health-tech-warning">${esc(data.enrichment.warning)}</span>`:''}</p>`
    : '';
  el.innerHTML=`<div class="survivor-health-card${healthy?'':' warning'}">
    <div class="survivor-health-strip">
      <span class="survivor-health-state${healthy?' ready':' warning'}">${esc(state)}</span>
      <span class="survivor-health-summary">${esc(summary)}</span>
      <span>Schedule <strong>${ok?'Complete ✓':`${data.schedule.matched}/${data.schedule.expected}`}</strong></span>
      <span>Win probabilities <strong>${coverage}% modeled</strong></span>
      <span>Results <strong>Live</strong></span>
    </div>
    <details class="survivor-health-details">
      <summary>Technical details</summary>
      <div class="survivor-health-detail-body">
        <p>PickGauge automatically uses the best available probability source for each matchup: direct CFBD Pregame WP first, then SP+, then a line-derived fallback.</p>
        <div class="survivor-health-detail-grid">
          <span><small>CFBD game identities</small><b>${canonicalMatched}/${canonicalExpected}</b></span>
          <span><small>Probability sources</small><b>WP ${src.WP||0} · SP+ ${src['SP+']||0} · Line ${src.Line||0} · Missing ${src.Missing||0}</b></span>
          <span><small>Betting lines</small><b>${lineCount}/${lineTotal} games</b></span>
          <span><small>Results source</small><b>PickGauge shared CFBD</b></span>
        </div>
        ${fallbackNote}${degradedNote}
      </div>
    </details>
  </div>`;
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
  const leadMatchup=recs[0]?pgSurvivorFindMatchup(recs[0].team,pgSurvivorFocusWeek()):null;
  const leadExplanation=leadMatchup?pgSurvivorBuildExplanation(leadMatchup):null;
  const reason=recs.length
    ? (pool.picksPerWeek===2
      ? 'Why: the exact optimizer chooses these two together as the strongest full-season path, while preserving future options.'
      : `Why: ${pgSurvivorDecisionSummary(leadMatchup,leadExplanation,false)}`)
    : 'The optimizer needs more modeled data before it can recommend a complete path.';
  el.innerHTML=`<section class="survivor-decision-card"><div class="survivor-decision-main"><div class="eyebrow">${title}</div><h2>${esc(names)}</h2><p class="survivor-decision-reason">${esc(reason)}</p><p class="survivor-decision-meta">${esc(probs)} · exact remaining-season optimizer${entryStatus?.status==='eliminated'?' · research only — entry eliminated':''}${plan&&!plan.coverageComplete?' · partial model coverage':''}</p>${recs.length?`<button type="button" class="btn-link-sm survivor-why-toggle" data-survivor-why-toggle>${pgSurvivorWhyOpen()?'Hide explanation':pool.picksPerWeek===2?'Explain this pair':'Explain this pick'}</button>`:''}</div><div class="survivor-metric"><span>Week</span><strong>${pgSurvivorFocusWeek()}</strong><small>focused</small></div><div class="survivor-metric"><span>Available</span><strong>${available}</strong><small>unused sides</small></div><div class="survivor-metric"><span>Plan survival</span><strong>${survival}</strong><small>exact path</small></div></section>`;
}
function pgSurvivorRenderWhy(){
  const el=document.getElementById('survivorWhy');if(!el)return;
  const recs=pgSurvivorRecommendations(),pool=pgSurvivorPoolDef();
  if(!pgSurvivorWhyOpen()||!recs.length){el.innerHTML='';return;}
  const pairMode=pool.picksPerWeek>1;
  const cards=recs.map((rec,index)=>{
    const m=pgSurvivorFindMatchup(rec.team,pgSurvivorFocusWeek()),x=pgSurvivorBuildExplanation(m),b=x?.scoreBreakdown;
    if(!m)return'';
    const fv=pgSurvivorFutureValueInfo(m.team);
    const futureSpot=x?.futureBestSpot?`Best future spot: W${x.futureBestSpot.week} · ${pgSurvivorFmtPct(x.futureBestSpot.p)}`:'No stronger modeled future spot';
    const scarcity=b?.scarcity?.criticalWeek;
    const scarcityText=scarcity?`W${scarcity.week} · ${scarcity.label||'scarce'}`:'No critical 90%+ future week';
    const pathValue=x?.chosenPath?.coverageComplete?x.chosenPath.survivalProbability:x?.chosenPath?.modeledSurvivalProbability;
    const pathText=pathValue==null?'Partial model':`${pgSurvivorFmtPct(pathValue,2)}${x?.chosenPath?.coverageComplete?'':' modeled'}`;
    const edge=Number(x?.pathAdvantageVsAlternative);
    const edgeText=Number.isFinite(edge)&&Math.abs(edge)>=0.0005?`${edge>=0?'+':''}${(edge*100).toFixed(2)} pp vs next comparable path`:'Best complete-path fit';
    const summary=pgSurvivorDecisionSummary(m,x,pairMode);
    return `<div class="survivor-why-card">
      <div class="survivor-why-title"><span>${pairMode?`Pick ${index+1}`:'Recommended play'}</span><b>${esc(m.team)}</b></div>
      <p class="survivor-why-summary">${esc(summary)}</p>
      <div class="survivor-why-facts">
        <span><small>Win now</small><b>${pgSurvivorFmtPct(m.winProbability)}${x?.safetyRank?` · #${x.safetyRank}/${x.optionCount}`:''}</b><em>Current-week safety</em></span>
        <span><small>Exact season path</small><b>${pathText}</b><em>${esc(edgeText)}</em></span>
        <span><small>Future Value</small><b>${fv?`${fv.value.toFixed(1)}★ · ${fv.label}`:'No model'}</b><em>${esc(futureSpot)}</em></span>
        <span><small>Save pressure</small><b>${esc(scarcityText)}</b><em>${fv?esc(fv.guidance):'Future usefulness unavailable'}</em></span>
      </div>
      ${b?`<div class="survivor-score-points"><span><b>Supporting Survivor Score ${Number(x?.score||0).toFixed(1)}</b> · Safety ${Number(b.safetyPoints||0).toFixed(1)} · Preservation ${Number(b.preservationPoints||0).toFixed(1)} · Scarcity ${Number(b.scarcityPoints||0).toFixed(1)}</span><span class="survivor-score-note">The exact season optimizer drives the recommendation; Survivor Score is supporting context.</span></div>`:''}
    </div>`;
  }).join('');
  const intro=pairMode
    ? 'Both Kelly picks are solved together as one season-path decision. PickGauge is not simply taking the two highest win probabilities on the board.'
    : 'PickGauge solves the remaining season first, then recommends the current-week team that fits that strongest path. That keeps future team value from being ignored.';
  el.innerHTML=`<section class="survivor-why-panel"><div class="eyebrow">Why this exact path</div><p class="survivor-why-intro">${esc(intro)}</p>${cards}</section>`;
}
function pgSurvivorPriorUsedTeams(week){
  const out=new Set();
  Object.entries(pgSurvivorActiveEntry().picks||{}).forEach(([rawWeek,value])=>{
    if(Number(rawWeek)>=Number(week))return;
    (Array.isArray(value)?value:[value]).filter(Boolean).forEach(team=>out.add(team));
  });
  return [...out].sort((a,b)=>a.localeCompare(b));
}
function pgSurvivorWeeklyStatus(week,pickRows,required){
  const entryStatus=pgSurvivorEntryStatus();
  if(entryStatus?.status==='eliminated')return {key:'loss',label:'Entry eliminated',detail:'A prior required pick lost'};
  const rows=Array.isArray(pickRows)?pickRows:[];
  if(rows.some(row=>row.result&&row.result.won===false))return {key:'loss',label:'Entry eliminated',detail:'At least one required pick lost this week'};
  if(rows.length<required){
    const missing=required-rows.length;
    return {key:'needed',label:`${missing} pick${missing===1?'':'s'} needed`,detail:`${rows.length}/${required} selected for Week ${week}`};
  }
  if(rows.length===required&&rows.every(row=>row.result?.won===true))return {key:'won',label:'Week survived',detail:`All ${required} required pick${required===1?'':'s'} won`};
  return {key:'set',label:required>1?'Pair set':'Pick set',detail:'Saved and awaiting final results'};
}
function pgSurvivorWeeklySummaryData(){
  const data=pgSurvivorData();if(!data)return null;
  const pool=pgSurvivorPoolDef(),entry=pgSurvivorActiveEntry(),week=pgSurvivorFocusWeek(),required=pool.picksPerWeek;
  const pickRows=pgSurvivorSelectedPicks(week).map(team=>{
    const matchup=pgSurvivorFindMatchup(team,week),result=pgSurvivorResult(matchup);
    return {team,matchup,result,p:matchup?.winProbability??null,opponent:matchup?.opponent||'',label:matchup?pgSurvivorMatchLabel(matchup):''};
  });
  const recommendations=pgSurvivorRecommendations().slice(0,required).map(rec=>{
    const matchup=pgSurvivorFindMatchup(rec.team,week);
    return {team:rec.team,p:rec.p??matchup?.winProbability??null,matchup,label:matchup?pgSurvivorMatchLabel(matchup):''};
  });
  const selectedSet=new Set(pickRows.map(row=>row.team)),recSet=new Set(recommendations.map(row=>row.team));
  const matchesBest=pickRows.length===required&&recommendations.length===required&&[...selectedSet].every(team=>recSet.has(team));
  const priorUsed=pgSurvivorPriorUsedTeams(week);
  const scarcity=(pgSurvivorScarcity()||[]).filter(row=>Number(row.week)>Number(week)).sort((a,b)=>Number(a.week)-Number(b.week))[0]||null;
  const status=pgSurvivorWeeklyStatus(week,pickRows,required);
  const plan=pgSurvivorRuntime.recommendationPlan;
  const planSurvival=plan?.coverageComplete?plan.survivalProbability:(plan?.modeledSurvivalProbability??null);
  return {pool,entry,week,required,pickRows,recommendations,matchesBest,priorUsed,scarcity,status,planSurvival};
}
function pgSurvivorSummaryPickHTML(row){
  const result=row.result;
  const resultText=result?result.label:(Number(pgSurvivorFocusWeek())>Number(pgSurvivorActualWeek())?'Reserved':'Pending');
  const tone=result?(result.won?' win':' loss'):' pending';
  return `<span class="survivor-summary-pick">${pgSurvivorTeamAvatarHTML(row.team,true)}<span><b>${esc(row.team)}</b><small>${esc(row.label||'Matchup unavailable')} · ${pgSurvivorFmtPct(row.p)}</small></span><em class="${tone.trim()}">${esc(resultText)}</em></span>`;
}
function pgSurvivorRenderWeeklySummary(){
  const el=document.getElementById('survivorWeeklySummary');if(!el)return;
  const s=pgSurvivorWeeklySummaryData();
  if(!s){el.innerHTML='';return;}
  const picks=s.pickRows.length?s.pickRows.map(pgSurvivorSummaryPickHTML).join(''):`<span class="survivor-summary-empty">${s.required===1?'No pick saved yet.':'No picks saved yet.'}</span>`;
  const recNames=s.recommendations.length?s.recommendations.map(row=>row.team).join(' + '):'No complete path yet';
  const recProb=s.recommendations.length?s.recommendations.map(row=>pgSurvivorFmtPct(row.p)).join(' · '):'—';
  const next=s.scarcity;
  const nextLabel=next?`W${next.week} · ${next.label||'Modeled'}`:'No later week modeled';
  const nextDetail=next?`${next.safeCount??0} safe option${Number(next.safeCount)===1?'':'s'}${s.required>1&&Number.isFinite(Number(next.optionsPerRequiredPick))?` · ${Number(next.optionsPerRequiredPick).toFixed(1)}/pick`:''}`:'—';
  const matchNote=s.matchesBest?'<span class="survivor-summary-match">Matches best path ✓</span>':'';
  const shareSupported=typeof navigator!=='undefined'&&typeof navigator.share==='function';
  el.innerHTML=`<section class="survivor-week-summary">
    <div class="survivor-week-summary-head"><div><div class="eyebrow">Weekly snapshot</div><h2>Week ${s.week} · ${esc(s.pool.name)}</h2><p>${esc(s.entry.name)} · ${esc(s.status.detail)}</p></div><span class="survivor-week-status ${esc(s.status.key)}">${esc(s.status.label)}</span></div>
    <div class="survivor-week-summary-grid">
      <div class="survivor-week-summary-picks"><small>Your pick${s.required===1?'':'s'}</small><div>${picks}</div>${matchNote}</div>
      <div class="survivor-week-summary-metric"><small>Best path this week</small><b>${esc(recNames)}</b><em>${esc(recProb)}${s.planSurvival!=null?` · plan ${pgSurvivorFmtPct(s.planSurvival,1)}`:''}</em></div>
      <div class="survivor-week-summary-metric"><small>Used so far</small><b>${s.priorUsed.length} team${s.priorUsed.length===1?'':'s'}</b><em>${s.priorUsed.length?esc(s.priorUsed.slice(-3).join(' · ')):'Nothing burned before this week'}</em></div>
      <div class="survivor-week-summary-metric"><small>Next-week pressure</small><b>${esc(nextLabel)}</b><em>${esc(nextDetail)}</em></div>
    </div>
    <div class="survivor-week-summary-actions"><span>Share card excludes your private entry name.</span><button type="button" class="btn btn-light" data-survivor-export-weekly>Export PNG</button><button type="button" class="btn btn-light" data-survivor-card-options>More cards</button>${shareSupported?'<button type="button" class="btn btn-go" data-survivor-share-weekly>Share</button>':''}</div>
  </section>`;
}
function pgSurvivorCanvasRoundRect(ctx,x,y,w,h,r,fill,stroke=null){
  if(typeof snapshotDrawRoundRect==='function'){snapshotDrawRoundRect(ctx,x,y,w,h,r,fill,stroke);return;}
  const rr=Math.min(r,w/2,h/2);ctx.beginPath();ctx.roundRect?ctx.roundRect(x,y,w,h,rr):ctx.rect(x,y,w,h);
  if(fill){ctx.fillStyle=fill;ctx.fill();}if(stroke){ctx.strokeStyle=stroke;ctx.stroke();}
}
async function pgSurvivorExportImage(url){
  if(!url)return null;
  if(typeof snapshotLoadImage==='function')return snapshotLoadImage(url);
  try{
    const response=await fetch(url);if(!response.ok)return null;
    const blob=await response.blob();
    const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>resolve(null);reader.readAsDataURL(blob);});
    if(!dataUrl)return null;
    return await new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>resolve(null);img.src=dataUrl;});
  }catch(e){return null;}
}
function pgSurvivorDrawTeamLogo(ctx,img,team,x,y,size){
  if(typeof snapshotDrawLogo==='function'){snapshotDrawLogo(ctx,img,team,x,y,size);return;}
  ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);ctx.fillStyle='#ffffff';ctx.fill();ctx.strokeStyle='#d7dfdb';ctx.stroke();
  if(img){ctx.save();ctx.beginPath();ctx.arc(x+size/2,y+size/2,size/2-2,0,Math.PI*2);ctx.clip();ctx.drawImage(img,x+2,y+2,size-4,size-4);ctx.restore();}
  else{ctx.fillStyle='#166534';ctx.font='800 16px Inter,Arial,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(pgSurvivorTeamInitials(team),x+size/2,y+size/2);}
  ctx.restore();
}
function pgSurvivorDrawWrappedText(ctx,text,x,y,maxWidth,lineHeight,maxLines=2){
  const words=String(text||'').split(/\s+/).filter(Boolean);let line='',lines=[];
  words.forEach(word=>{const test=line?`${line} ${word}`:word;if(ctx.measureText(test).width>maxWidth&&line){lines.push(line);line=word;}else line=test;});
  if(line)lines.push(line);
  lines=lines.slice(0,maxLines);
  if(words.length&&lines.length===maxLines){
    while(ctx.measureText(lines[maxLines-1]+'…').width>maxWidth&&lines[maxLines-1].length>2)lines[maxLines-1]=lines[maxLines-1].slice(0,-1);
    if(lines.length<words.length||words.join(' ')!==lines.join(' '))lines[maxLines-1]+='…';
  }
  lines.forEach((ln,i)=>ctx.fillText(ln,x,y+i*lineHeight));return lines.length;
}
async function pgSurvivorBuildWeeklyShareBlob(){
  const s=pgSurvivorWeeklySummaryData();if(!s)throw new Error('Survivor data is not ready yet.');
  if(document.fonts&&document.fonts.ready){try{await document.fonts.ready;}catch(e){}}
  const W=1200,H=675,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas not supported.');
  ctx.fillStyle='#F7FAF8';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#16A34A';ctx.fillRect(0,0,W,8);
  const icon=await pgSurvivorExportImage('/icon-96.png');
  if(typeof snapshotDrawBrand==='function')snapshotDrawBrand(ctx,icon,W);
  else{
    if(icon)ctx.drawImage(icon,58,32,62,62);
    ctx.font='800 34px Inter,Arial,sans-serif';ctx.textAlign='left';ctx.textBaseline='alphabetic';ctx.fillStyle='#111827';ctx.fillText('PICK',136,73);ctx.fillStyle='#16A34A';ctx.fillText('GAUGE',218,73);
  }
  ctx.textAlign='center';ctx.fillStyle='#64748B';ctx.font='800 15px Inter,Arial,sans-serif';ctx.fillText(`SURVIVOR · ${s.pool.short} · WEEK ${s.week}`,W/2,115);
  const tone={won:['#ECFDF3','#166534'],loss:['#FFF1F0','#B42318'],set:['#EFF6FF','#1D4ED8'],needed:['#FFF7E8','#92400E']}[s.status.key]||['#F1F5F9','#475569'];
  ctx.font='800 15px Inter,Arial,sans-serif';const statusW=Math.max(150,ctx.measureText(s.status.label.toUpperCase()).width+34);
  pgSurvivorCanvasRoundRect(ctx,(W-statusW)/2,132,statusW,34,17,tone[0]);
  ctx.fillStyle=tone[1];ctx.textBaseline='middle';ctx.fillText(s.status.label.toUpperCase(),W/2,149);ctx.textBaseline='alphabetic';

  // Left: saved picks.
  const leftX=58,leftY=198,leftW=660,leftH=388;
  pgSurvivorCanvasRoundRect(ctx,leftX,leftY,leftW,leftH,18,'#FFFFFF','#DDE5E0');
  ctx.textAlign='left';ctx.fillStyle='#64748B';ctx.font='800 13px Inter,Arial,sans-serif';ctx.fillText(`MY PICK${s.required===1?'':'S'}`,leftX+28,leftY+36);
  ctx.fillStyle='#111827';ctx.font='800 23px Inter,Arial,sans-serif';
  ctx.fillText(s.pickRows.length?`${s.pickRows.length}/${s.required} SAVED`:'NOT SET',leftX+28,leftY+68);
  const pickRows=s.pickRows.length?s.pickRows:Array.from({length:s.required},()=>null);
  const rowH=s.required>1?120:155;
  const logoPromises=pickRows.map(row=>row?pgSurvivorExportImage(pgSurvivorTeamLogo(row.team)):Promise.resolve(null));
  const logos=await Promise.all(logoPromises);
  pickRows.forEach((row,index)=>{
    const y=leftY+92+index*rowH;
    if(index>0){ctx.strokeStyle='#EEF2F0';ctx.beginPath();ctx.moveTo(leftX+26,y-10);ctx.lineTo(leftX+leftW-26,y-10);ctx.stroke();}
    if(!row){
      pgSurvivorCanvasRoundRect(ctx,leftX+28,y,leftW-56,rowH-20,12,'#F8FAF9','#E5EAE7');
      ctx.fillStyle='#94A3B8';ctx.font='700 18px Inter,Arial,sans-serif';ctx.fillText('Pick not set',leftX+54,y+42);
      ctx.font='500 14px Inter,Arial,sans-serif';ctx.fillText('Choose from the exact-path recommendation in PickGauge.',leftX+54,y+68);
      return;
    }
    pgSurvivorDrawTeamLogo(ctx,logos[index],row.team,leftX+28,y+10,62);
    ctx.fillStyle='#111827';ctx.font='800 24px Inter,Arial,sans-serif';ctx.fillText(row.team,leftX+108,y+36);
    ctx.fillStyle='#64748B';ctx.font='600 14px Inter,Arial,sans-serif';pgSurvivorDrawWrappedText(ctx,row.label,leftX+108,y+61,365,18,2);
    ctx.textAlign='right';ctx.fillStyle='#16A34A';ctx.font='800 28px "JetBrains Mono",monospace';ctx.fillText(pgSurvivorFmtPct(row.p),leftX+leftW-28,y+38);
    const result=row.result?row.result.label:(Number(s.week)>Number(pgSurvivorActualWeek())?'RESERVED':'PENDING');
    ctx.fillStyle=row.result?(row.result.won?'#166534':'#B42318'):'#64748B';ctx.font='800 12px Inter,Arial,sans-serif';ctx.fillText(result,leftX+leftW-28,y+64);
    ctx.textAlign='left';
  });

  // Right: strategy context.
  const rightX=746,rightY=198,rightW=396,rightH=388;
  pgSurvivorCanvasRoundRect(ctx,rightX,rightY,rightW,rightH,18,'#FFFFFF','#DDE5E0');
  const block=(label,value,detail,y)=>{
    ctx.textAlign='left';ctx.fillStyle='#64748B';ctx.font='800 12px Inter,Arial,sans-serif';ctx.fillText(label,rightX+26,y);
    ctx.fillStyle='#111827';ctx.font='800 20px Inter,Arial,sans-serif';pgSurvivorDrawWrappedText(ctx,value,rightX+26,y+29,rightW-52,25,2);
    ctx.fillStyle='#64748B';ctx.font='500 12px Inter,Arial,sans-serif';pgSurvivorDrawWrappedText(ctx,detail,rightX+26,y+78,rightW-52,17,2);
  };
  const recNames=s.recommendations.length?s.recommendations.map(row=>row.team).join(' + '):'No complete path yet';
  const recDetail=s.recommendations.length?`${s.recommendations.map(row=>pgSurvivorFmtPct(row.p)).join(' · ')}${s.matchesBest?' · matches your picks':''}`:'Waiting for more modeled data';
  block('BEST PATH THIS WEEK',recNames,recDetail,rightY+38);
  ctx.strokeStyle='#EEF2F0';ctx.beginPath();ctx.moveTo(rightX+26,rightY+148);ctx.lineTo(rightX+rightW-26,rightY+148);ctx.stroke();
  block('USED SO FAR',`${s.priorUsed.length} team${s.priorUsed.length===1?'':'s'}`,s.priorUsed.length?s.priorUsed.slice(-4).join(' · '):'Nothing burned before this week',rightY+178);
  ctx.strokeStyle='#EEF2F0';ctx.beginPath();ctx.moveTo(rightX+26,rightY+284);ctx.lineTo(rightX+rightW-26,rightY+284);ctx.stroke();
  const next=s.scarcity?`W${s.scarcity.week} · ${s.scarcity.label||'Modeled'}`:'No later week modeled';
  const nextDetail=s.scarcity?`${s.scarcity.safeCount??0} safe option${Number(s.scarcity.safeCount)===1?'':'s'}`:'—';
  block('NEXT-WEEK PRESSURE',next,nextDetail,rightY+314);

  ctx.textAlign='left';ctx.fillStyle='#111827';ctx.font='800 15px Inter,Arial,sans-serif';ctx.fillText('pickgauge.com',58,H-34);
  ctx.textAlign='right';ctx.fillStyle='#64748B';ctx.font='500 12px Inter,Arial,sans-serif';ctx.fillText('Survivor pool strategy · model probabilities are estimates',W-58,H-34);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG export failed.')),'image/png'));
}
function pgSurvivorWeeklyFilename(){
  const pool=pgSurvivorPoolDef(),week=pgSurvivorFocusWeek();
  return `pickgauge_survivor_${pool.id}_week_${week}.png`;
}
function pgSurvivorDownloadBlob(blob,filename){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
async function pgSurvivorExportWeeklyCard(share=false,button=null){
  const original=button?.textContent||'',filename=pgSurvivorWeeklyFilename();
  if(button){button.disabled=true;button.textContent=share?'Preparing…':'Exporting…';}
  try{
    const blob=await pgSurvivorBuildWeeklyShareBlob();
    if(share&&typeof navigator.share==='function'){
      const file=new File([blob],filename,{type:'image/png'});
      if(!navigator.canShare||navigator.canShare({files:[file]})){
        try{await navigator.share({title:`PickGauge Survivor Week ${pgSurvivorFocusWeek()}`,files:[file]});return;}catch(err){if(err?.name==='AbortError')return;}
      }
    }
    pgSurvivorDownloadBlob(blob,filename);
    pgSurvivorToast(share?'Sharing is not supported here, so the PNG was downloaded instead.':'Survivor card exported.');
  }catch(err){console.error('Survivor card export failed',err);pgSurvivorToast(err?.message||'Survivor card export failed.','error');}
  finally{if(button){button.disabled=false;button.textContent=original;}}
}

async function pgSurvivorBuildStrategyShareBlob(kind='recommendation'){
  const s=pgSurvivorWeeklySummaryData?.();if(!s)throw new Error('Survivor data is not ready yet.');
  if(kind==='results'&&!s.pickRows.some(row=>row.result))throw new Error('No completed results are available for this week yet.');
  if(document.fonts&&document.fonts.ready){try{await document.fonts.ready;}catch(e){}}
  const W=1200,H=675,canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Canvas not supported.');
  ctx.fillStyle='#F7FAF8';ctx.fillRect(0,0,W,H);ctx.fillStyle='#16A34A';ctx.fillRect(0,0,W,8);
  const icon=await pgSurvivorExportImage('/icon-96.png');if(typeof snapshotDrawBrand==='function')snapshotDrawBrand(ctx,icon,W);
  else{if(icon)ctx.drawImage(icon,58,32,62,62);ctx.textAlign='left';ctx.fillStyle='#111827';ctx.font='800 34px Inter,Arial,sans-serif';ctx.fillText('PICK',136,73);ctx.fillStyle='#16A34A';ctx.fillText('GAUGE',218,73);}
  const isResults=kind==='results',title=isResults?'WEEK RESULTS':'PICKGAUGE BEST PATH';
  ctx.textAlign='center';ctx.fillStyle='#64748B';ctx.font='800 15px Inter,Arial,sans-serif';ctx.fillText(`SURVIVOR · ${s.pool.short} · WEEK ${s.week}`,W/2,118);
  ctx.fillStyle='#111827';ctx.font='900 32px Inter,Arial,sans-serif';ctx.fillText(title,W/2,162);
  const rows=isResults?s.pickRows:s.recommendations;
  const displayRows=rows.length?rows:Array.from({length:s.required},()=>null);
  const rowTop=205,rowGap=s.required>1?164:210,rowW=930,rowX=(W-rowW)/2;
  const logos=await Promise.all(displayRows.map(row=>row?pgSurvivorExportImage(pgSurvivorTeamLogo(row.team)):Promise.resolve(null)));
  displayRows.forEach((row,index)=>{
    const y=rowTop+index*rowGap;pgSurvivorCanvasRoundRect(ctx,rowX,y,rowW,132,16,'#FFFFFF','#DDE5E0');
    if(!row){ctx.textAlign='center';ctx.fillStyle='#94A3B8';ctx.font='700 19px Inter,Arial,sans-serif';ctx.fillText(isResults?'No saved result':'No complete recommendation yet',W/2,y+70);return;}
    pgSurvivorDrawTeamLogo(ctx,logos[index],row.team,rowX+28,y+30,72);
    ctx.textAlign='left';ctx.fillStyle='#111827';ctx.font='900 27px Inter,Arial,sans-serif';ctx.fillText(row.team,rowX+126,y+58);
    const matchup=row.matchup||pgSurvivorFindMatchup(row.team,s.week),label=matchup?pgSurvivorMatchLabel(matchup):'';
    ctx.fillStyle='#64748B';ctx.font='600 14px Inter,Arial,sans-serif';ctx.fillText(label,rowX+126,y+84);
    ctx.textAlign='right';
    if(isResults){
      const r=row.result;ctx.fillStyle=r?(r.won?'#166534':'#B42318'):'#64748B';ctx.font='900 28px Inter,Arial,sans-serif';ctx.fillText(r?r.label:'Pending',rowX+rowW-30,y+58);
      const meta=pgSurvivorPickMeta(s.entry,s.week,row.team);ctx.fillStyle='#64748B';ctx.font='600 13px Inter,Arial,sans-serif';ctx.fillText(meta?.winProbability!=null?`Selected WP ${pgSurvivorFmtPct(meta.winProbability)}`:'Selection probability not recorded',rowX+rowW-30,y+84);
    }else{
      const strategy=matchup?pgSurvivorStrategyIndicator(matchup):null;ctx.fillStyle='#16A34A';ctx.font='900 30px "JetBrains Mono",monospace';ctx.fillText(pgSurvivorFmtPct(row.p),rowX+rowW-30,y+57);
      ctx.fillStyle='#64748B';ctx.font='800 12px Inter,Arial,sans-serif';ctx.fillText(strategy?.label||'EXACT PATH',rowX+rowW-30,y+84);
    }
  });
  if(!isResults){
    const note=s.scarcity?`Next pressure: W${s.scarcity.week} · ${s.scarcity.label||'modeled'} · ${s.scarcity.safeCount??0} safe options`:'Exact remaining-season optimizer';
    ctx.textAlign='center';ctx.fillStyle='#64748B';ctx.font='600 13px Inter,Arial,sans-serif';ctx.fillText(note,W/2,570);
  }
  ctx.textAlign='left';ctx.fillStyle='#111827';ctx.font='800 15px Inter,Arial,sans-serif';ctx.fillText('pickgauge.com',58,H-34);
  ctx.textAlign='right';ctx.fillStyle='#64748B';ctx.font='500 12px Inter,Arial,sans-serif';ctx.fillText(isResults?'Results from current PickGauge / CFBD data':'Survivor strategy · model probabilities are estimates',W-58,H-34);
  return await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG export failed.')),'image/png'));
}
async function pgSurvivorDeliverShareBlob(blob,filename,share=false){
  if(share&&typeof navigator.share==='function'){
    const file=new File([blob],filename,{type:'image/png'});
    if(!navigator.canShare||navigator.canShare({files:[file]})){try{await navigator.share({title:'PickGauge Survivor',files:[file]});return;}catch(err){if(err?.name==='AbortError')return;}}
  }
  pgSurvivorDownloadBlob(blob,filename);
}
async function pgSurvivorChooseShareCard(share=false){
  if(typeof pgChoice!=='function'){pgSurvivorToast('Card options are unavailable. Refresh PickGauge and try again.','error');return;}
  const s=pgSurvivorWeeklySummaryData?.(),hasResults=!!s?.pickRows?.some(row=>row.result);
  const choices=[
    {value:'picks',label:'My Picks',description:'Your saved selections, probabilities, best path and scarcity context.'},
    {value:'recommendation',label:'PickGauge Best Path',description:'Recommendation-only card — no private picks or entry name.'}
  ];
  if(hasResults)choices.push({value:'results',label:'Week Results',description:'Your completed Survivor picks with W/L results and recorded selection probability.'});
  const kind=await pgChoice({eyebrow:'Survivor share card',title:share?'Share a Survivor card':'Export a Survivor card',message:'Choose what you want the graphic to show.',choices,confirmText:share?'Share':'Export'});
  if(!kind)return;
  try{
    const blob=kind==='picks'?await pgSurvivorBuildWeeklyShareBlob():await pgSurvivorBuildStrategyShareBlob(kind);
    const suffix=kind==='picks'?'my_picks':kind==='results'?'results':'best_path';
    await pgSurvivorDeliverShareBlob(blob,`pickgauge_survivor_${pgSurvivorPoolId()}_week_${pgSurvivorFocusWeek()}_${suffix}.png`,share);
    if(!share)pgSurvivorToast('Survivor card exported.');
  }catch(err){console.error('Survivor share card failed',err);pgSurvivorToast(err?.message||'Survivor card could not be created.','error');}
}
function pgSurvivorCellClass(p){if(p===null)return'';return p>=.9?'elite':p>=.8?'strong':p>=.7?'medium':'risky';}
function pgSurvivorTeamLogo(team){
  if(typeof cfbdTeamForName!=='function')return null;
  try{const row=cfbdTeamForName(team);return row&&row.logo?row.logo:null;}catch(e){return null;}
}
function pgSurvivorTeamInitials(team){
  const words=String(team||'').replace(/[^A-Za-z0-9 &]/g,'').split(/\s+/).filter(Boolean);
  if(!words.length)return '?';
  if(words.length===1)return words[0].slice(0,3).toUpperCase();
  return words.map(w=>w[0]).join('').slice(0,3).toUpperCase();
}
function pgSurvivorTeamAvatarHTML(team,small){
  const logo=pgSurvivorTeamLogo(team);
  const cls=`survivor-team-avatar${small?' small':''}`;
  if(logo)return `<span class="${cls}"><img src="${esc(logo)}" alt="" loading="lazy"></span>`;
  return `<span class="${cls} initials">${esc(pgSurvivorTeamInitials(team))}</span>`;
}
function pgSurvivorCellStateLabel(team,m,week,used){
  const r=pgSurvivorResult(m);
  if(r)return {text:r.label,cls:r.won?'win':'loss'};
  const selectedTeams=pgSurvivorSelectedPicks(week);
  if(selectedTeams.includes(team))return {text:'PICK',cls:'pick'};
  if(selectedTeams.includes(m.opponent))return {text:'OPP PICK',cls:'opp-pick'};
  if(used.has(team))return {text:'USED',cls:'used'};
  return {text:'',cls:''};
}

function pgSurvivorFutureValueForEntry(team,entry){
  const fn=window.PickGaugeSurvivorCore?.score?.teamFutureValueRating,data=pgSurvivorData();if(typeof fn!=='function'||!data)return null;
  const used=new Set();
  Object.values(entry?.picks||{}).forEach(value=>(Array.isArray(value)?value:[value]).filter(Boolean).forEach(t=>used.add(t)));
  try{return fn(team,pgSurvivorActualWeek(),data.matchups,used,pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorFutureValueNumber(team,entry=pgSurvivorActiveEntry()){
  const r=pgSurvivorFutureValueForEntry(team,entry);if(r==null)return null;
  const value=typeof r==='number'?r:Number(r.rating??r.stars??r.value);
  return Number.isFinite(value)?Math.round(value*2)/2:null;
}
function pgSurvivorStrategyIndicator(m){
  if(!m)return null;
  const p=Number(m.winProbability),fv=pgSurvivorFutureValueNumber(m.team),required=pgSurvivorPoolDef().picksPerWeek;
  const recTeams=new Set(pgSurvivorRecommendations().map(rec=>rec.team));
  if(Number(m.week)===Number(pgSurvivorFocusWeek())&&recTeams.has(m.team))return {key:'best',label:'BEST PATH',detail:'Exact optimizer recommendation'};
  const explanation=pgSurvivorBuildExplanation(m),critical=explanation?.scoreBreakdown?.scarcity?.criticalWeek;
  if(fv!=null&&fv>=4.5&&critical?.week)return {key:'save',label:`SAVE FOR W${critical.week}`,detail:'High future value in a scarcer week'};
  if(fv!=null&&fv>=4.5)return {key:'save',label:'SAVE FOR LATER',detail:'High future value'};
  const burnThreshold=required>1?.86:.88;
  if(Number.isFinite(p)&&p>=burnThreshold&&fv!=null&&fv<=2)return {key:'burn',label:'SAFE TO BURN',detail:'Strong win chance with limited future value'};
  if(Number.isFinite(p)&&p>=.8&&fv!=null&&fv<3)return {key:'use',label:required>1?'PAIR FRIENDLY':'GOOD USE',detail:'Solid current safety without spending a premium future asset'};
  if(Number.isFinite(p)&&p<.65)return {key:'risk',label:'RISKY NOW',detail:'Low modeled win probability'};
  return {key:'balanced',label:'BALANCED',detail:'No extreme burn/save signal'};
}
function pgSurvivorStrategyBadgeHTML(m){
  const x=pgSurvivorStrategyIndicator(m);if(!x)return '';
  return `<span class="survivor-strategy-badge ${esc(x.key)}" title="${esc(x.detail)}">${esc(x.label)}</span>`;
}
function pgSurvivorBoardSort(){
  const poolId=pgSurvivorPoolId();
  if(!pgSurvivorRuntime.boardSortByPool[poolId])pgSurvivorRuntime.boardSortByPool[poolId]={mode:'alpha',week:null};
  return pgSurvivorRuntime.boardSortByPool[poolId];
}
function pgSurvivorSetTeamSortMode(mode){
  const s=pgSurvivorBoardSort();
  s.mode=(mode==='future')?'future':'alpha';
  s.week=null;
}
function pgSurvivorToggleWeekSort(week){
  const s=pgSurvivorBoardSort();
  s.week=(s.week===week)?null:week;
}
function pgSurvivorFutureIndex(team){
  const r=pgSurvivorFutureRating(team);
  if(!r||typeof r!=='object')return null;
  return Number.isFinite(r.index)?r.index:null;
}
function pgSurvivorSortedTeams(){
  const teams=pgSurvivorMemberTeams(), data=pgSurvivorData(), sort=pgSurvivorBoardSort();
  if(sort.week){
    const byTeam=new Map();
    (data?.matchups||[]).forEach(m=>{if(m.week===sort.week)byTeam.set(m.team,m.winProbability);});
    return [...teams].sort((a,b)=>{
      const ap=byTeam.has(a)?byTeam.get(a):null, bp=byTeam.has(b)?byTeam.get(b):null;
      if(ap===null&&bp===null)return teams.indexOf(a)-teams.indexOf(b);
      if(ap===null)return 1;
      if(bp===null)return -1;
      if(bp!==ap)return bp-ap;
      return teams.indexOf(a)-teams.indexOf(b);
    });
  }
  if(sort.mode==='future'){
    return [...teams].sort((a,b)=>{
      const av=pgSurvivorFutureIndex(a), bv=pgSurvivorFutureIndex(b);
      if(av===null&&bv===null)return a.localeCompare(b);
      if(av===null)return 1;
      if(bv===null)return -1;
      if(bv!==av)return bv-av;
      return a.localeCompare(b);
    });
  }
  return [...teams].sort((a,b)=>a.localeCompare(b));
}
function pgSurvivorRenderBoard(){
  const el=document.getElementById('survivor-view-board'),data=pgSurvivorData();if(!el)return;
  if(!data){el.innerHTML='<div class="card"><p class="sub">Season Board will appear when shared CFBD data finishes loading.</p></div>';return;}
  const weeks=data.weeks, teams=pgSurvivorSortedTeams(),used=pgSurvivorUsedTeams(),sort=pgSurvivorBoardSort();
  const teamSortTitle=sort.week?null:(sort.mode==='future'?'Teams sorted by Future Value, highest first':'Teams sorted alphabetically A to Z');
  let html=`<div class="survivor-view-head"><div><div class="eyebrow">Full season</div><h2>${esc(pgSurvivorPoolDef().name)} Season Board</h2><p>Win probability drives the cell color. Click a matchup to use that team, click again to remove it. Future Value shows how useful a team is likely to be later — more stars means more reason to save it.</p></div><div class="survivor-board-legends"><div class="survivor-fv-legend" title="Future Value measures later-season usefulness. Higher stars = more reason to save a team for a future week."><span>Future Value</span><b>★★★★★</b><small>= save value later</small></div><div class="survivor-legend"><span class="elite">90%+</span><span class="strong">80–89%</span><span class="medium">70–79%</span><span class="risky">&lt;70%</span></div></div></div><div class="survivor-board"><table><thead><tr><th class="survivor-team-col"><div class="survivor-team-col-head"><span>${esc(pgSurvivorPoolDef().teamColumnLabel||'Team')}</span><span class="survivor-team-sort-controls" role="group" aria-label="Sort teams"><button type="button" class="survivor-sort-btn${(!sort.week&&sort.mode==='alpha')?' active':''}" data-survivor-team-sort="alpha" title="Sort teams A to Z">A–Z</button><button type="button" class="survivor-sort-btn fv${(!sort.week&&sort.mode==='future')?' active':''}" data-survivor-team-sort="future" title="Sort by Future Value, highest first">FV ★</button></span></div></th>${weeks.map(w=>{
    const isSorted=sort.week===w, isFocus=w===pgSurvivorFocusWeek();
    const thCls=[isFocus?'survivor-focus-col':'',isSorted?'survivor-sorted-col':''].filter(Boolean).join(' ');
    const title=isSorted?`Week ${w} sorted high to low — click to reset`:`Sort by Week ${w} win probability`;
    return `<th${thCls?` class="${thCls}"`:''}><button type="button" class="survivor-week-sort-btn${isSorted?' active':''}" data-survivor-week-sort="${w}" title="${esc(title)}">W${w}<span class="survivor-sort-arrow" aria-hidden="true">${isSorted?'↓':'↕'}</span></button></th>`;
  }).join('')}</tr></thead><tbody>`;
  teams.forEach(team=>{
    html+=`<tr><td class="survivor-team-col"><div class="survivor-team-cell">${pgSurvivorTeamAvatarHTML(team,true)}<div class="survivor-team-copy"><span class="survivor-team-name-row"><b>${esc(team)}</b>${pgSurvivorStars(team)}</span><small class="survivor-team-status${used.has(team)?' used':''}">${used.has(team)?'Used':'Available'}</small></div></div></td>`;
    weeks.forEach(w=>{
      const m=pgSurvivorFindMatchup(team,w);
      const focusCls=[w===pgSurvivorFocusWeek()?'survivor-focus-col':'',sort.week===w?'survivor-sorted-col':''].filter(Boolean).join(' ');
      if(!m){html+=`<td${focusCls?` class="${focusCls}"`:''}><div class="survivor-empty-cell">—</div></td>`;return;}
      const selected=pgSurvivorSelectedPicks(w).includes(team),isUsed=used.has(team)&&!selected;
      const state=pgSurvivorCellStateLabel(team,m,w,used);
      html+=`<td${focusCls?` class="${focusCls}"`:''}><button class="survivor-game-cell ${pgSurvivorCellClass(m.winProbability)}${selected?' picked':''}${isUsed?' used':''}" data-survivor-pick-game="${esc(String(m.gameId))}" data-survivor-pick-team="${esc(team)}" ${isUsed?'disabled':''} title="${selected?'Click to remove this pick':''}"><span class="survivor-cell-top"><span class="survivor-cell-opp">${esc(pgSurvivorMatchLabel(m))}</span><span class="survivor-cell-p">${pgSurvivorFmtPct(m.winProbability)}</span></span><span class="survivor-cell-line"><span>${esc(m.spread)} <span class="survivor-cell-source">${esc(m.probabilitySourceShort)}</span></span>${state.text?`<span class="survivor-cell-state ${state.cls}">${esc(state.text)}</span>`:''}</span></button></td>`;
    });
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
  el.innerHTML=`<div class="survivor-view-head"><div><div class="eyebrow">Decision board</div><h2>Week ${week} Rankings</h2><p>Exact-path recommendation is pinned first; remaining options use the scarcity-aware Survivor Score. Compare locks a candidate into this week and re-solves the exact season path.</p></div></div>${comparePanel}<div class="survivor-ranking-list">${rows.map(({m,score},i)=>`<div class="survivor-rank-row${recTeams.has(m.team)?' best':''}"><span class="survivor-rank-num">${i+1}</span><span class="survivor-rank-team"><b>${esc(m.team)}</b>${pgSurvivorStrategyBadgeHTML(m)}<small>${esc(pgSurvivorMatchLabel(m))} · ${esc(m.spread)} · ${esc(m.probabilitySourceShort)}</small></span><span><small>Win prob</small><b>${pgSurvivorFmtPct(m.winProbability)}</b><small>Score ${score===null?'—':Number(score).toFixed(1)}</small></span><span>${recTeams.has(m.team)?'<span class="survivor-badge best">BEST PATH</span>':selected.includes(m.team)?'<span class="survivor-badge picked">YOUR PICK</span>':''}</span><span class="survivor-rank-actions"><button class="btn btn-light" data-survivor-compare-team="${esc(m.team)}">${compare.has(m.team)?'Compared':'Compare'}</button><button class="btn btn-go" data-survivor-pick-game="${esc(String(m.gameId))}" data-survivor-pick-team="${esc(m.team)}">Use</button></span></div>`).join('')}</div>`;
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
  const entry=pgSurvivorActiveEntry(),pool=pgSurvivorPoolDef(),p=pgSurvivorPoolState();
  const weeks=data?.weeks||Array.from({length:13},(_,i)=>i+1),status=pgSurvivorEntryStatus();
  const entryIndex=pgSurvivorEntryIndex(entry.id),savedPickCount=Object.values(entry.picks||{}).reduce((sum,value)=>sum+(Array.isArray(value)?value:[value]).filter(Boolean).length,0);
  const timeline=Object.entries(entry.picks||{}).map(([week,value])=>({week:Number(week),teams:(Array.isArray(value)?value:[value]).filter(Boolean)})).filter(row=>row.teams.length).sort((a,b)=>a.week-b.week);
  const entryTools=`<div class="survivor-entry-editor"><label>Entry name <input id="survivorEntryName" type="text" maxlength="40" value="${esc(entry.name)}"></label><div class="survivor-entry-actions"><button type="button" class="btn btn-light" data-survivor-entry-duplicate>Duplicate</button><button type="button" class="btn btn-light survivor-entry-move" data-survivor-entry-move="-1" ${entryIndex<=0?'disabled':''} title="Move entry up" aria-label="Move entry up">↑</button><button type="button" class="btn btn-light survivor-entry-move" data-survivor-entry-move="1" ${entryIndex>=p.entries.length-1?'disabled':''} title="Move entry down" aria-label="Move entry down">↓</button><button type="button" class="btn btn-light survivor-entry-delete" data-survivor-entry-delete ${p.entries.length<=1?'disabled title="Keep at least one entry"':''}>Delete</button></div></div>`;
  const weekly=weeks.map(w=>{
    const teams=pgSurvivorSelectedPicks(w),required=pool.picksPerWeek;
    const countLabel=required>1?`${teams.length}/${required}`:(teams.length?'1/1':'0/1');
    const chips=teams.length?teams.map(team=>{
      const m=pgSurvivorFindMatchup(team,w),r=pgSurvivorResult(m);
      const resultText=r?` · ${r.label}`:'';
      return `<span class="survivor-pick-chip">${esc(team)}${resultText}<button data-survivor-remove-week="${w}" data-survivor-remove-team="${esc(team)}" aria-label="Remove ${esc(team)}">×</button></span>`;
    }).join(' '):`<span class="faint">No pick${required>1?'s':''}</span>`;
    return `<div class="survivor-pick-history"><span class="survivor-pick-week"><b>Week ${w}</b><small>${countLabel} pick${required===1?'':'s'}</small></span><span>${chips}</span></div>`;
  }).join('');
  const usedTimeline=timeline.length?timeline.map(row=>{
    const chips=row.teams.map(team=>{
      const m=pgSurvivorFindMatchup(team,row.week),r=pgSurvivorResult(m);
      const label=r?r.label:(Number(row.week)>Number(pgSurvivorActualWeek())?'Reserved':'Pending');
      const tone=r?(r.won?' win':' loss'):' pending';
      return `<span class="survivor-used-team">${esc(team)}<em class="survivor-used-result${tone}">${esc(label)}</em></span>`;
    }).join('');
    return `<div class="survivor-used-week"><b>W${row.week}</b><div>${chips}</div></div>`;
  }).join(''):'<p class="faint survivor-used-empty">No teams used or reserved yet.</p>';
  el.innerHTML=`<div class="survivor-view-head survivor-picks-head"><div><div class="eyebrow">Entry tracker ${status?.label?`· ${esc(status.label)}`:''}</div><h2>${esc(entry.name)}</h2><p>Picks and entry order sync with your PickGauge account. You can duplicate an entry to test a second strategy without rebuilding its picks.</p></div>${entryTools}</div>
  <div class="survivor-picks-layout">
    <div class="card survivor-weekly-picks-card"><div class="survivor-card-heading"><div><h2>Weekly picks</h2><p>${savedPickCount} saved pick${savedPickCount===1?'':'s'} · ${pool.picksPerWeek} required per week</p></div></div>${weekly}</div>
    <aside class="card survivor-used-history-card"><div class="survivor-card-heading"><div><h2>Used / reserved teams</h2><p>${savedPickCount} team selection${savedPickCount===1?'':'s'} across ${timeline.length} week${timeline.length===1?'':'s'}</p></div></div><div class="survivor-used-timeline">${usedTimeline}</div><p class="survivor-used-help">A future saved pick is shown as <b>Reserved</b>. Once its game is completed, the result replaces that label. Teams listed here cannot be selected again in this entry.</p></aside>
  </div>`;
}

function pgSurvivorEntryUsedSet(entry){
  const used=new Set();Object.values(entry?.picks||{}).forEach(value=>(Array.isArray(value)?value:[value]).filter(Boolean).forEach(team=>used.add(team)));return used;
}
function pgSurvivorEntryStatusFor(entry){
  const data=pgSurvivorData(),fn=window.PickGaugeSurvivorCore?.results?.evaluateEntryStatus;if(!data||typeof fn!=='function')return null;
  try{return fn(data.matchups,entry?.picks||{},data.weeks,pgSurvivorActualWeek(),Date.now(),30,pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorEntryStats(entry){
  const data=pgSurvivorData(),required=pgSurvivorPoolDef().picksPerWeek;
  let picks=0,wins=0,losses=0,pending=0,recordedProbSum=0,recordedProbCount=0;const completedWeeks=new Set(),lossWeeks=[];
  Object.entries(entry?.picks||{}).forEach(([rawWeek,value])=>{
    const week=Number(rawWeek),teams=(Array.isArray(value)?value:[value]).filter(Boolean);picks+=teams.length;
    let weekResolved=teams.length===required;
    teams.forEach(team=>{
      const m=data?.matchups?.find(row=>row.team===team&&Number(row.week)===week)||null,r=pgSurvivorResult(m),meta=pgSurvivorPickMeta(entry,week,team);
      if(meta&&Number.isFinite(Number(meta.winProbability))){recordedProbSum+=Number(meta.winProbability);recordedProbCount+=1;}
      if(r){if(r.won)wins+=1;else{losses+=1;lossWeeks.push(week);}}else{pending+=1;weekResolved=false;}
    });
    if(weekResolved)completedWeeks.add(week);
  });
  const status=pgSurvivorEntryStatusFor(entry);
  return {picks,wins,losses,pending,completedWeeks:completedWeeks.size,eliminationWeek:lossWeeks.length?Math.min(...lossWeeks):null,avgRecordedProbability:recordedProbCount?recordedProbSum/recordedProbCount:null,status};
}
function pgSurvivorEntryPlanFor(entry){
  const data=pgSurvivorData(),score=window.PickGaugeSurvivorCore?.score;if(!data||typeof score?.buildSeasonPlan!=='function')return null;
  const start=pgSurvivorActualWeek(),weeks=data.weeks.filter(w=>Number(w)>=Number(start)),priorUsed=new Set(),locked={};
  Object.entries(entry?.picks||{}).forEach(([rawWeek,value])=>{
    const week=Number(rawWeek),teams=(Array.isArray(value)?value:[value]).filter(Boolean);
    if(week<start)teams.forEach(team=>priorUsed.add(team));
    else if(teams.length)locked[String(week)]=pgSurvivorPoolDef().picksPerWeek===1?teams[0]:teams;
  });
  try{return score.buildSeasonPlan(data.matchups,weeks,priorUsed,locked,pgSurvivorPoolDef().picksPerWeek);}catch(e){return null;}
}
function pgSurvivorEntryFutureAssets(entry){
  const used=pgSurvivorEntryUsedSet(entry),rows=[];
  pgSurvivorMemberTeams().forEach(team=>{
    if(used.has(team))return;
    const value=pgSurvivorFutureValueNumber(team,entry);if(value!=null)rows.push({team,value});
  });
  rows.sort((a,b)=>b.value-a.value||a.team.localeCompare(b.team));
  return {high:rows.filter(row=>row.value>=4).length,top:rows.slice(0,3)};
}
function pgSurvivorHistoryWeekRows(entry){
  const data=pgSurvivorData(),actual=pgSurvivorActualWeek();if(!data)return [];
  return data.weeks.filter(week=>Number(week)<=Number(actual)).map(week=>{
    const teams=(Array.isArray(entry?.picks?.[String(week)])?entry.picks[String(week)]:[entry?.picks?.[String(week)]]).filter(Boolean);
    const selected=teams.map(team=>{
      const matchup=data.matchups.find(row=>row.team===team&&Number(row.week)===Number(week))||null;
      return {team,matchup,result:pgSurvivorResult(matchup),meta:pgSurvivorPickMeta(entry,week,team)};
    });
    const recorded=pgSurvivorRecordedRecommendation(week),recTeams=(recorded?.recommendations||[]).map(row=>row.team);
    const selectedSet=new Set(teams),match=teams.length&&recTeams.length===teams.length&&recTeams.every(team=>selectedSet.has(team));
    return {week,selected,recorded,match};
  });
}
function pgSurvivorHistoryResultLabel(row){
  if(!row.selected.length)return '<span class="survivor-history-muted">No saved pick</span>';
  return row.selected.map(item=>{
    const r=item.result,label=r?r.label:'Pending',tone=r?(r.won?'win':'loss'):'pending';
    const p=item.meta&&Number.isFinite(Number(item.meta.winProbability))?pgSurvivorFmtPct(item.meta.winProbability):'—';
    return `<span class="survivor-history-pick"><b>${esc(item.team)}</b><small>${esc(label)} · selected WP ${p}</small><em class="${tone}">${r?(r.won?'WIN':'LOSS'):'OPEN'}</em></span>`;
  }).join('');
}
function pgSurvivorPortfolioAnalysis(){
  const data=pgSurvivorData(),pool=pgSurvivorPoolState(),portfolio=window.PickGaugeSurvivorCore?.portfolio,score=window.PickGaugeSurvivorCore?.score;
  if(!data||!pool||typeof portfolio?.buildDiversifiedPortfolio!=='function'||!score)return null;
  const currentWeek=pgSurvivorActualWeek(),required=pgSurvivorPoolDef().picksPerWeek;
  const liveEntries=pool.entries.filter(entry=>{
    const status=pgSurvivorEntryStats(entry)?.status?.status;
    return status!=='eliminated'&&status!=='survived';
  });
  if(liveEntries.length<2)return {entryCount:liveEntries.length,insufficient:true,currentWeek};
  pgSurvivorRuntime.portfolioByPool=pgSurvivorRuntime.portfolioByPool||{};
  const key=JSON.stringify([
    currentWeek,data.generatedAt||'',data.enrichment?.fetchedAt||'',
    liveEntries.map(entry=>[entry.id,entry.picks||{}])
  ]);
  const cached=pgSurvivorRuntime.portfolioByPool[pgSurvivorPoolId()];
  if(cached?.key===key)return cached.value;
  try{
    const weeks=(data.weeks||[]).filter(week=>Number(week)>=Number(currentWeek));
    const value=portfolio.buildDiversifiedPortfolio({
      matchups:data.matchups,weeks,entries:liveEntries,currentWeek,picksPerWeek:required,scoreApi:score,
      maxCandidatesPerEntry:6,beamWidth:80,maxOptimizedEntries:8
    });
    value.currentWeek=currentWeek;
    pgSurvivorRuntime.portfolioByPool[pgSurvivorPoolId()]={key,value};
    return value;
  }catch(err){
    console.warn('Survivor portfolio analysis skipped',err);
    return {entryCount:liveEntries.length,error:err?.message||String(err),currentWeek};
  }
}
function pgSurvivorPortfolioPct(value,digits=1){return Number.isFinite(Number(value))?`${(Number(value)*100).toFixed(digits)}%`:'—';}
function pgSurvivorPortfolioPts(value){
  if(!Number.isFinite(Number(value)))return '—';
  const points=Number(value)*100;
  return `${points>=0?'+':''}${points.toFixed(1)} pts`;
}
function pgSurvivorPortfolioSectionHTML(){
  const pool=pgSurvivorPoolState(),analysis=pgSurvivorPortfolioAnalysis(),required=pgSurvivorPoolDef().picksPerWeek;
  if(!pool||!analysis)return '';
  if(pool.entries.length<2){
    return `<section class="survivor-history-section survivor-portfolio"><div class="survivor-history-section-head"><div><h3>Portfolio strategy</h3><p>Create a second entry to unlock diversification and “at least one survives” analysis.</p></div></div></section>`;
  }
  if(analysis.insufficient){
    return `<section class="survivor-history-section survivor-portfolio"><div class="survivor-history-section-head"><div><h3>Portfolio strategy</h3><p>Only ${analysis.entryCount||0} live entry remains, so there is nothing left to diversify across entries.</p></div></div></section>`;
  }
  if(analysis.error){
    return `<section class="survivor-history-section survivor-portfolio"><div class="survivor-history-section-head"><div><h3>Portfolio strategy</h3><p>Portfolio analysis is temporarily unavailable while the individual entry plans remain usable.</p></div></div></section>`;
  }
  const baseline=analysis.baseline||{},optimized=analysis.optimized||{},gain=analysis.diversificationGain;
  const exact=optimized.method==='exact-inclusion-exclusion';
  const methodLabel=exact?'shared-outcome exact':optimized.method==='seeded-monte-carlo'?'modeled estimate':'unavailable';
  const selections=(optimized.selections||[]).map(selection=>{
    const standalone=selection.standalone||null,option=selection.option||null;
    const changed=!!(standalone&&option&&standalone.signature!==option.signature);
    const saved=(Array.isArray(selection.entry?.picks?.[String(analysis.currentWeek)])?selection.entry.picks[String(analysis.currentWeek)]:[selection.entry?.picks?.[String(analysis.currentWeek)]]).filter(Boolean);
    const recommended=option?.currentPicks||[];
    const recTeams=recommended.map(row=>row.team);
    const savedSig=saved.slice().sort().join('|'),recSig=recTeams.slice().sort().join('|');
    const changesSaved=saved.length>=required&&savedSig!==recSig;
    const role=changed?'DIVERSIFIER':'ANCHOR';
    const individualDelta=Number.isFinite(Number(option?.pathProbability))&&Number.isFinite(Number(standalone?.pathProbability))
      ?Number(option.pathProbability)-Number(standalone.pathProbability):null;
    const picks=recommended.length?recommended.map(row=>`<span><b>${esc(row.team)}</b><small>${row.p==null?'—':pgSurvivorFmtPct(row.p)}${row.opponent?` · vs ${esc(row.opponent)}`:''}</small></span>`).join(''):'<span><b>No complete modeled path</b></span>';
    return `<div class="survivor-portfolio-entry${changed?' diversified':''}">
      <div class="survivor-portfolio-entry-head"><div><b>${esc(selection.entry?.name||'Entry')}</b><span class="${changed?'diversifier':'anchor'}">${role}</span></div><strong>${pgSurvivorPortfolioPct(option?.pathProbability)}</strong></div>
      <div class="survivor-portfolio-picks">${picks}</div>
      <div class="survivor-portfolio-entry-foot">${changed?(individualDelta!==null&&individualDelta< -0.0005?`Gives up ${Math.abs(individualDelta*100).toFixed(1)} pts of individual path strength to reduce shared exposure.`:'Changes the path with essentially no individual survival cost to reduce shared exposure.'):'Keeps this entry on its strongest standalone exact path.'}${changesSaved?' <b>Would change the currently saved pick(s).</b>':''}</div>
    </div>`;
  }).join('');
  const gainPositive=Number.isFinite(Number(gain))&&Number(gain)>0.0005;
  const overlapDelta=(baseline.sharedEventCount??0)-(optimized.sharedEventCount??0);
  return `<section class="survivor-history-section survivor-portfolio">
    <div class="survivor-history-section-head"><div><h3>Portfolio strategy</h3><p>Optimize the entries together for the modeled chance that at least one survives from Week ${analysis.currentWeek} forward.</p></div><span class="survivor-portfolio-method">${esc(methodLabel)}</span></div>
    <div class="survivor-portfolio-hero">
      <div class="survivor-portfolio-main"><small>At least one survives</small><b>${pgSurvivorPortfolioPct(optimized.probability)}</b><em>${gainPositive?`${pgSurvivorPortfolioPts(gain)} vs standalone best paths`:'Standalone paths are already efficiently diversified'}</em></div>
      <div><small>Standalone best paths</small><b>${pgSurvivorPortfolioPct(baseline.probability)}</b><em>Each entry optimized by itself</em></div>
      <div><small>Shared exposure</small><b>${optimized.sharedEventCount??'—'}</b><em>${overlapDelta>0?`${overlapDelta} duplicated outcome${overlapDelta===1?'':'s'} removed`:'No extra overlap removed'}</em></div>
      <div><small>Live entries</small><b>${analysis.entryCount}</b><em>${analysis.optimizationLimited?`First ${analysis.optimizedEntryCount} actively diversified`:'All entries jointly considered'}</em></div>
    </div>
    <div class="survivor-portfolio-entry-grid">${selections}</div>
    <p class="survivor-portfolio-note"><b>How to read this:</b> an Anchor stays on its strongest individual season path. A Diversifier may accept a slightly weaker individual path when that increases the chance that at least one of your entries survives. Same-game/same-team outcomes are shared rather than treated as independent; opposite sides of one game cannot both survive. Different games still use PickGauge's standard independence assumption. Recommendations do not change saved picks automatically.</p>
  </section>`;
}
// --- Entry comparison: real tables, not cards (per Drew's direct feedback:
// "it doesnt show it in table form and it isnt very visual") -------------
// Two tables, both hidden with a one-line nudge when there's only one
// entry (nothing to compare yet):
//   1. Stats table -- one row per metric, one column per entry, so you can
//      scan across a row and see every entry's number at once instead of
//      hunting through separate cards.
//   2. Pick grid -- one row per week, one column per entry, colored the
//      same elite/strong/medium/risky tiers as the Season Board itself
//      (pgSurvivorCellClass) so the visual language matches. A team used
//      by 2+ entries in the SAME week gets a "shared" mark -- this is
//      exactly the overlap Portfolio Strategy above is trying to reduce,
//      made visible at a glance instead of only as an aggregate count.
function pgSurvivorEntryComparisonStatsTableHTML(pool,activeId){
  const entries=pool.entries||[];
  if(entries.length<2) return `<p class="note" style="margin:0;">Add another entry (see <b>+ Add entry</b> above) to compare it against this one.</p>`;
  const perEntry=entries.map(entry=>({entry,x:pgSurvivorEntryStats(entry),plan:pgSurvivorEntryPlanFor(entry),assets:pgSurvivorEntryFutureAssets(entry)}));
  const headerCells=perEntry.map(({entry})=>`<th scope="col" class="${entry.id===activeId?'active':''}">${entry.id===activeId?esc(entry.name):`<button type="button" class="btn-link-sm survivor-compare-switch" data-survivor-history-entry="${esc(entry.id)}" title="View ${esc(entry.name)}'s full history">${esc(entry.name)}</button>`}</th>`).join('');
  const rowsDef=[
    {label:'Status',fn:({x})=>esc(x.status?.label||'Alive')},
    {label:'Record',fn:({x})=>`${x.wins}-${x.losses}${x.pending?` <small>(${x.pending} pending)</small>`:''}`},
    {label:'Teams used',fn:({entry})=>String(pgSurvivorEntryUsedSet(entry).size)},
    {label:'Projected survival',fn:({plan})=>plan?.coverageComplete?pgSurvivorFmtPct(plan.survivalProbability,1):plan?.modeledSurvivalProbability!=null?`${pgSurvivorFmtPct(plan.modeledSurvivalProbability,1)}*`:'—'},
    {label:'4★+ left',fn:({assets})=>String(assets.high)},
    {label:'Best assets',fn:({assets})=>assets.top.length?`<small>${esc(assets.top.map(row=>`${row.team} ${row.value.toFixed(1)}★`).join(' · '))}</small>`:'<small>No future-value data</small>'},
  ];
  const bodyRows=rowsDef.map(row=>`<tr><th scope="row">${esc(row.label)}</th>${perEntry.map(rec=>`<td class="${rec.entry.id===activeId?'active':''}">${row.fn(rec)}</td>`).join('')}</tr>`).join('');
  return `<div class="survivor-compare-table-wrap"><table class="survivor-compare-table"><thead><tr><th scope="col" class="survivor-compare-corner">Entry</th>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></div>`;
}
function pgSurvivorPickGridTableHTML(pool){
  const entries=pool.entries||[];
  if(entries.length<2) return '';
  const data=pgSurvivorData(),actual=pgSurvivorActualWeek();
  if(!data) return '';
  const weeks=data.weeks.filter(week=>Number(week)<=Number(actual));
  if(!weeks.length) return `<p class="note" style="margin:0;">No weeks played yet.</p>`;
  const headerCells=entries.map(entry=>`<th scope="col">${esc(entry.name)}</th>`).join('');
  const rows=weeks.map(week=>{
    const perEntryTeams=entries.map(entry=>{
      const raw=entry?.picks?.[String(week)];
      return (Array.isArray(raw)?raw:[raw]).filter(Boolean);
    });
    const teamCounts={};
    perEntryTeams.forEach(teams=>teams.forEach(team=>{teamCounts[team]=(teamCounts[team]||0)+1;}));
    const anyShared=Object.values(teamCounts).some(n=>n>1);
    const cells=entries.map((entry,i)=>{
      const teams=perEntryTeams[i];
      if(!teams.length) return `<td class="empty">—</td>`;
      const picks=teams.map(team=>{
        const matchup=data.matchups.find(row=>row.team===team&&Number(row.week)===Number(week))||null;
        const result=pgSurvivorResult(matchup);
        const meta=pgSurvivorPickMeta(entry,week,team);
        const pRaw=meta&&Number.isFinite(Number(meta.winProbability))?Number(meta.winProbability):(matchup&&Number.isFinite(Number(matchup.winProbability))?Number(matchup.winProbability):null);
        const tier=pRaw!=null?pgSurvivorCellClass(pRaw):'';
        const tone=result?(result.won?'win':'loss'):'pending';
        const shared=teamCounts[team]>1;
        return `<span class="survivor-grid-pick ${tier}${shared?' shared':''}" title="${esc(team)} · ${pgSurvivorFmtPct(pRaw)}${shared?' · used by multiple entries this week':''}"><b>${esc(team)}</b><em class="${tone}">${result?(result.won?'W':'L'):'—'}</em></span>`;
      }).join('');
      return `<td>${picks}</td>`;
    }).join('');
    return `<tr><td class="week-num${anyShared?' shared-week':''}">W${esc(week)}</td>${cells}</tr>`;
  }).join('');
  return `<div class="survivor-compare-table-wrap"><table class="survivor-pick-grid-table"><thead><tr><th scope="col" class="survivor-compare-corner">Week</th>${headerCells}</tr></thead><tbody>${rows}</tbody></table></div>
  <div class="survivor-legend" style="margin-top:8px;"><span class="elite">90%+</span><span class="strong">80-89%</span><span class="medium">70-79%</span><span class="risky">&lt;70%</span><span class="survivor-shared-mark">◆ same team, 2+ entries that week</span></div>`;
}
function pgSurvivorRenderHistory(){
  const el=document.getElementById('survivor-view-history'),data=pgSurvivorData();if(!el)return;
  if(!data){el.innerHTML='<div class="card"><p class="sub">History will appear when Survivor data finishes loading.</p></div>';return;}
  const active=pgSurvivorActiveEntry(),stats=pgSurvivorEntryStats(active),rows=pgSurvivorHistoryWeekRows(active),pool=pgSurvivorPoolState();
  const recordedWeeks=Object.keys(pool.recommendationHistory||{}).length;
  const avg=stats.avgRecordedProbability==null?'—':pgSurvivorFmtPct(stats.avgRecordedProbability,1);
  const historyRows=rows.map(row=>{
    const rec=row.recorded;
    const recText=rec?.recommendations?.length?rec.recommendations.map(r=>`${esc(r.team)} ${pgSurvivorFmtPct(r.p)}`).join(' + '):'<span class="survivor-history-muted">Not recorded</span>';
    const captured=rec?.firstCapturedAt?new Date(rec.firstCapturedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
    return `<div class="survivor-history-row"><b>W${row.week}</b><div>${pgSurvivorHistoryResultLabel(row)}</div><div class="survivor-history-rec"><span>${recText}</span>${captured?`<small>Recorded ${esc(captured)}</small>`:''}</div><span>${rec?row.match?'<span class="survivor-history-match yes">MATCHED</span>':'<span class="survivor-history-match no">DIFFERENT</span>':'—'}</span></div>`;
  }).join('');
  el.innerHTML=`<div class="survivor-view-head"><div><div class="eyebrow">Results + strategy history</div><h2>${esc(active.name)}</h2><p>Results use live CFBD outcomes. Selection probability is only shown when PickGauge actually recorded it at pick time; older picks remain blank rather than using today's model retroactively.</p></div></div>
  <div class="survivor-history-kpis"><span><small>Picks made</small><b>${stats.picks}</b></span><span><small>Results</small><b>${stats.wins}-${stats.losses}</b><em>${stats.pending} pending</em></span><span><small>Avg selected WP</small><b>${avg}</b><em>recorded picks only</em></span><span><small>Recommendation weeks</small><b>${recordedWeeks}</b><em>tracked going forward</em></span></div>
  ${pgSurvivorPortfolioSectionHTML()}
  <section class="survivor-history-section"><div class="survivor-history-section-head"><div><h3>Entry comparison</h3><p>Every entry's record, burned teams, remaining future assets, and exact-path projection, side by side.</p></div></div>${pgSurvivorEntryComparisonStatsTableHTML(pool,active.id)}</section>
  <section class="survivor-history-section"><div class="survivor-history-section-head"><div><h3>Pick grid</h3><p>What each entry actually picked, week by week. Diamond-marked cells are a team two or more entries used the SAME week -- shared risk, the same overlap Portfolio Strategy above tries to reduce.</p></div></div>${pgSurvivorPickGridTableHTML(pool)}</section>
  <section class="survivor-history-section"><div class="survivor-history-section-head"><div><h3>Week-by-week history</h3><p>Recorded recommendation vs. the entry's actual selection and result.</p></div></div><div class="survivor-history-table"><div class="survivor-history-row head"><span>Week</span><span>Your pick(s)</span><span>Recorded PickGauge path</span><span>Choice</span></div>${historyRows}</div><p class="survivor-history-footnote">“Not recorded” means the week predates this history feature or PickGauge never captured a recommendation for that week. It is intentionally not backfilled with current model data.</p></section>`;
}
function renderSurvivorShell(){
  if(!pgSurvivorEnsureMounted())return;
  pgSurvivorState();if(pgSurvivorData()&&typeof refreshPickGaugeSurvivorResults==='function')refreshPickGaugeSurvivorResults(pgSurvivorData());pgSurvivorComputePlans();pgSurvivorRenderControls();pgSurvivorRenderHealth();pgSurvivorRenderHero();pgSurvivorRenderWhy();pgSurvivorRenderWeeklySummary();pgSurvivorRenderBoard();pgSurvivorRenderRankings();pgSurvivorRenderPlan();pgSurvivorRenderPicks();pgSurvivorRenderHistory();
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

    if(e.target.closest('[data-survivor-entry-duplicate]')){pgSurvivorDuplicateEntry();return;}
    const moveEntry=e.target.closest('[data-survivor-entry-move]');if(moveEntry){pgSurvivorMoveEntry(Number(moveEntry.dataset.survivorEntryMove));return;}
    if(e.target.closest('[data-survivor-entry-delete]')){pgSurvivorDeleteEntry().catch(err=>{console.error('Survivor entry delete failed',err);pgSurvivorToast('Entry could not be deleted.','error');});return;}
    const cardOptions=e.target.closest('[data-survivor-card-options]');if(cardOptions){pgSurvivorChooseShareCard(false);return;}
    const exportWeekly=e.target.closest('[data-survivor-export-weekly]');if(exportWeekly){pgSurvivorExportWeeklyCard(false,exportWeekly);return;}
    const shareWeekly=e.target.closest('[data-survivor-share-weekly]');if(shareWeekly){pgSurvivorExportWeeklyCard(true,shareWeekly);return;}
    const historyEntry=e.target.closest('[data-survivor-history-entry]');if(historyEntry){ui.entryByPool[ui.poolId]=historyEntry.dataset.survivorHistoryEntry;ui.view='history';pgSurvivorSaveUi(ui);pgSurvivorComputePlans();renderSurvivorShell();return;}
    if(e.target.closest('[data-survivor-why-toggle]')){pgSurvivorRuntime.whyOpenByPool[pgSurvivorPoolId()]=!pgSurvivorWhyOpen();renderSurvivorShell();return;}
    if(e.target.closest('[data-survivor-compare-clear]')){pgSurvivorCompareSet().clear();renderSurvivorShell();return;}
    const compare=e.target.closest('[data-survivor-compare-team]');if(compare){const set=pgSurvivorCompareSet(),team=compare.dataset.survivorCompareTeam;if(set.has(team))set.delete(team);else if(set.size<4)set.add(team);else pgSurvivorToast('Compare up to four teams at a time.');renderSurvivorShell();return;}
    const retry=e.target.closest('[data-survivor-retry]');if(retry){pgSurvivorRuntime.errorByPool[pgSurvivorPoolId()]=null;pgSurvivorEnsureSharedData(true).catch(()=>{});renderSurvivorShell();return;}
    const remove=e.target.closest('[data-survivor-remove-week]');if(remove){pgSurvivorRemovePick(Number(remove.dataset.survivorRemoveWeek),remove.dataset.survivorRemoveTeam||null);return;}
    const teamSort=e.target.closest('[data-survivor-team-sort]');if(teamSort){pgSurvivorSetTeamSortMode(teamSort.dataset.survivorTeamSort);pgSurvivorRenderBoard();return;}
    const weekSort=e.target.closest('[data-survivor-week-sort]');if(weekSort){pgSurvivorToggleWeekSort(Number(weekSort.dataset.survivorWeekSort));pgSurvivorRenderBoard();return;}
    const pick=e.target.closest('[data-survivor-pick-game]');if(pick){pgSurvivorAddPick(pgSurvivorMatchupFromButton(pick));return;}
  });
}
window.addEventListener('pickgauge-survivor-core-ready',()=>{if(document.getElementById('tab-survivor')?.classList.contains('active')){pgSurvivorComputePlans();renderSurvivorShell();}});

setInterval(()=>{if(document.visibilityState!=="hidden"&&document.getElementById('tab-survivor')?.classList.contains('active')&&pgSurvivorData())renderSurvivorShell();},90000);
