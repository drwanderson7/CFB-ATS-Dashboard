// ---------------------------------------------------------------------------
// Confidence pools -- UI layer. Sept 2, 2026, Drew's explicit request.
// Pure logic (points validation, ATS grading math) lives in
// app/js/confidence.js and is unit-tested there in isolation; this file is
// purely rendering + DOM wiring + state mutation, same split every other
// tab in this app already uses (board.js/model.js, picks.js/record.js,
// survivor-integration.js/survivor-core).
//
// CORRECTED same day after seeing Drew's real Splash sheet ("Grundy's
// Gang" Team Pickem, Week 1 2026): this is confidence AGAINST THE SPREAD,
// not straight-up. Every game's `line` is now a REQUIRED, directly
// editable field that drives grading -- not decorative reference text.
// See confidence.js's header comment for the full rationale.
//
// Deliberately built WITHOUT a hardcoded season schedule (unlike Survivor's
// SEC/Big Ten/Kelly pools) -- a confidence pool's game list comes from
// whatever the person adds each week (picked off the live board, or typed
// in by hand), mirroring how an ATS pool's `pool.games` already works
// (see app/js/pool-contexts.js's manual-game-picker, poolManualGamesForWeek()
// etc.).
//
// Weekly Splash PDF import is now the primary setup path, built against a
// real Grundy's Gang Week 1 2026 Team Pickem export: 18 ATS games, frozen
// contest lines, a full-card lock timestamp, and a drop-two-weeks rule.
// Manual game entry remains only as a troubleshooting/fallback path.
// ---------------------------------------------------------------------------

let cpManualCustomGames=[]; // transient, not saved -- games typed in by hand, staged before "Save games for this week"
let cpAddGamesOpen={}; // poolId -> bool. A <details> element's native `open`
// attribute does NOT survive renderConfidenceTab()'s full innerHTML rebuild
// (every mutation -- including "+ add game" itself -- triggers one), so
// without tracking this separately, adding one custom game closes the
// panel right back up before you can add a second. Same pattern
// pool-contexts.js's poolManualState already uses for the equivalent ATS
// pool picker, for the same reason.


let cpWizard=null; // transient one-time pool setup; nothing is saved until Review -> Create pool

function cpStartPoolWizard(existingPool){
  cpWizard={
    step:1,
    editingPoolId:existingPool?existingPool.id:null,
    draft:{
      name:existingPool?existingPool.name:"",
      scoring:existingPool?(existingPool.scoring==="straight_up"?"straight_up":"ats"):null,
      weeklyPickMode:existingPool?(existingPool.weeklyPickMode||((existingPool.pickCount!=null)?"count":"all")):null,
      weeklyPickCount:existingPool?(existingPool.weeklyPickCount||existingPool.pickCount||null):null,
      confidenceMode:existingPool?(existingPool.confidenceMode||"all"):null,
      confidenceCount:existingPool?(existingPool.confidenceCount||null):null,
      dropLowestWeeks:existingPool?(existingPool.dropLowestWeeks||0):null,
      entryCount:existingPool?Math.max(1,(existingPool.entries||[]).length):1,
    }
  };
  renderConfidenceTab();
}
function cpCancelPoolWizard(){ cpWizard=null; renderConfidenceTab(); }
function cpWizardDraft(){ return cpWizard&&cpWizard.draft; }

function cpCreatePoolFromDraft(draft){
  const entryCount=Math.max(1,Math.min(25,Math.floor(Number(draft.entryCount)||1)));
  const weeklyMode=draft.weeklyPickMode==="count"?"count":"all";
  const weeklyCount=weeklyMode==="count"?Math.max(1,Math.floor(Number(draft.weeklyPickCount)||1)):null;
  const confidenceMode=draft.confidenceMode==="top"?"top":"all";
  const confidenceCount=confidenceMode==="top"?Math.max(1,Math.floor(Number(draft.confidenceCount)||1)):null;
  const drop=Math.max(0,Math.floor(Number(draft.dropLowestWeeks)||0));
  const rules={
    name:(draft.name||"").trim()||("Confidence Pool "+(cpPools().length+1)),
    scoring:draft.scoring==="straight_up"?"straight_up":"ats",
    weeklyPickMode:weeklyMode,weeklyPickCount:weeklyCount,
    confidenceMode,confidenceCount,dropLowestWeeks:drop>0?drop:null,
    pickCount:weeklyMode==="count"?weeklyCount:null,
  };
  const editingId=cpWizard&&cpWizard.editingPoolId;
  if(editingId){
    const pool=cpPools().find(p=>p.id===editingId);
    if(pool){
      Object.assign(pool,rules);
      pool.entries=Array.isArray(pool.entries)?pool.entries:[];
      while(pool.entries.length<entryCount) pool.entries.push({id:uid(),name:`Entry ${pool.entries.length+1}`,picks:{},history:[]});
      if(pool.entries.length>entryCount){
        const removable=pool.entries.slice(entryCount).every(e=>!Object.keys(e.picks||{}).length&&!(e.history||[]).length);
        if(removable) pool.entries=pool.entries.slice(0,entryCount);
      }
      state.confidenceActivePoolId=pool.id; save(); return pool;
    }
  }
  const pool={id:uid(),...rules,weekLabel:"Week 1",currentWeekNumber:1,games:[],entries:Array.from({length:entryCount},(_,i)=>({id:uid(),name:`Entry ${i+1}`,picks:{},history:[]})),archived:false,createdAt:new Date().toISOString(),cardLockAt:null,lockMode:null,weekImportMeta:null};
  cpPools().push(pool);state.confidenceActivePoolId=pool.id;save();return pool;
}

// Kept for backward compatibility with old tests/callers. New UI always uses
// the guided draft above.
function cpCreatePool(name,pickCount){
  return cpCreatePoolFromDraft({
    name,
    scoring:"ats",
    weeklyPickMode:(pickCount==null||pickCount==="")?"all":"count",
    weeklyPickCount:(pickCount==null||pickCount==="")?null:pickCount,
    confidenceMode:"all",
    confidenceCount:null,
    dropLowestWeeks:0,
    entryCount:1,
  });
}

function cpScoringLabel(pool){ return cpScoring(pool)==="straight_up"?"Straight up":"Against the spread"; }
function cpWeeklyRuleLabel(pool){
  return cpWeeklyPickMode(pool)==="all"?"Every game":`Pick ${cpWeeklyPickCount(pool)} games`;
}
function cpConfidenceRuleLabel(pool){
  return cpConfidenceMode(pool)==="all"?"All picks":`Top ${cpConfidenceCount(pool)} picks`;
}
function cpDropRuleLabel(pool){
  const n=Math.max(0,Math.floor(Number(pool&&pool.dropLowestWeeks)||0));
  return n?`Drop lowest ${n} week${n===1?"":"s"}`:"Every week counts";
}

function cpWizardCanContinue(){
  if(!cpWizard) return false;
  const d=cpWizard.draft;
  switch(cpWizard.step){
    case 1:return !!(d.name||"").trim();
    case 2:return d.scoring==="ats"||d.scoring==="straight_up";
    case 3:return d.weeklyPickMode==="all"||(d.weeklyPickMode==="count"&&Number(d.weeklyPickCount)>0);
    case 4:{
      if(d.confidenceMode==="all") return true;
      if(d.confidenceMode!=="top"||Number(d.confidenceCount)<=0) return false;
      return d.weeklyPickMode!=="count" || Number(d.confidenceCount)<=Number(d.weeklyPickCount);
    }
    case 5:return d.dropLowestWeeks!=null&&Number(d.dropLowestWeeks)>=0;
    case 6:return Number(d.entryCount)>=1;
    default:return true;
  }
}

function cpWizardChoice(value,title,desc,selected,attr){
  return `<button type="button" class="pg-wizard-choice ${selected?"selected":""}" ${attr}="${esc(value)}">
    <span class="pg-wizard-choice-title">${esc(title)}</span>
    <span class="pg-wizard-choice-desc">${esc(desc)}</span>
  </button>`;
}

function cpRenderWizardStep(){
  const d=cpWizard.draft, step=cpWizard.step;
  if(step===1) return `<div class="pg-wizard-question"><label for="cpWizName">What is the name of your pool?</label><input id="cpWizName" type="text" value="${esc(d.name||"")}" placeholder="e.g. Grundy's Gang" autocomplete="off" autofocus></div>`;
  if(step===2) return `<div class="pg-wizard-question"><div class="pg-wizard-prompt">How are picks scored?</div><div class="pg-wizard-choices">
    ${cpWizardChoice("ats","Against the spread","Pick a side using the pool's locked spread.",d.scoring==="ats","data-cp-wiz-scoring")}
    ${cpWizardChoice("straight_up","Straight up","Pick the team you think will win. Spreads don't affect grading.",d.scoring==="straight_up","data-cp-wiz-scoring")}
  </div></div>`;
  if(step===3) return `<div class="pg-wizard-question"><div class="pg-wizard-prompt">How many games do you pick each week?</div><div class="pg-wizard-choices">
    ${cpWizardChoice("all","Every game","Make a pick on every game included in the pool.",d.weeklyPickMode==="all","data-cp-wiz-weekly")}
    ${cpWizardChoice("count","Pick a set number","Choose only a certain number of games each week.",d.weeklyPickMode==="count","data-cp-wiz-weekly")}
  </div>${d.weeklyPickMode==="count"?`<label class="pg-wizard-number-label">How many games?<input id="cpWizWeeklyCount" type="number" min="1" max="100" step="1" value="${d.weeklyPickCount||""}"></label>`:""}</div>`;
  if(step===4) return `<div class="pg-wizard-question"><div class="pg-wizard-prompt">Which picks receive confidence points?</div><div class="pg-wizard-choices">
    ${cpWizardChoice("all","All of my picks","Rank every submitted pick from highest to lowest confidence.",d.confidenceMode==="all","data-cp-wiz-confidence")}
    ${cpWizardChoice("top","Only my top picks","Submit all required picks, but rank only your strongest picks.",d.confidenceMode==="top","data-cp-wiz-confidence")}
  </div>${d.confidenceMode==="top"?`<label class="pg-wizard-number-label">How many picks get confidence points?<input id="cpWizConfidenceCount" type="number" min="1" max="100" step="1" value="${d.confidenceCount||""}"></label>${d.weeklyPickMode==="count"&&Number(d.confidenceCount)>Number(d.weeklyPickCount)?`<div class="err" style="margin-top:10px;">Top picks cannot exceed your ${Number(d.weeklyPickCount)} weekly picks.</div>`:""}<div class="pg-wizard-example">Example: if you rank your Top 5, those picks receive 5, 4, 3, 2 and 1 points. Your other submitted picks are still valid picks, but worth 0 confidence points.</div>`:""}</div>`;
  if(step===5) return `<div class="pg-wizard-question"><div class="pg-wizard-prompt">Does the pool drop any low-scoring weeks?</div><div class="pg-wizard-choices">
    ${cpWizardChoice("0","No — every week counts","Every completed week counts toward the season total.",Number(d.dropLowestWeeks)===0,"data-cp-wiz-drop")}
    ${cpWizardChoice("yes","Yes — drop my lowest weeks","Exclude a set number of lowest-scoring weeks from the season total.",Number(d.dropLowestWeeks)>0,"data-cp-wiz-drop")}
  </div>${Number(d.dropLowestWeeks)>0?`<label class="pg-wizard-number-label">How many weeks are dropped?<input id="cpWizDropCount" type="number" min="1" max="20" step="1" value="${d.dropLowestWeeks}"></label>`:""}</div>`;
  if(step===6) return `<div class="pg-wizard-question"><div class="pg-wizard-prompt">How many entries do you have in this pool?</div><div class="pg-entry-stepper"><button type="button" data-cp-entry-step="-1" aria-label="Decrease entries">−</button><input id="cpWizEntryCount" type="number" min="1" max="25" step="1" value="${Math.max(1,Number(d.entryCount)||1)}"><button type="button" data-cp-entry-step="1" aria-label="Increase entries">+</button></div><div class="pg-wizard-example">PickGauge will create ${Math.max(1,Number(d.entryCount)||1)} ${Number(d.entryCount)===1?"entry":"entries"} automatically. You can rename them later.</div></div>`;
  return `<div class="pg-wizard-review"><div class="pg-wizard-prompt">Ready to create ${esc(d.name)}?</div><div class="pg-review-rows">
    <button data-cp-wiz-edit="1"><span>Pool name</span><b>${esc(d.name)}</b><em>Edit</em></button>
    <button data-cp-wiz-edit="2"><span>Scoring</span><b>${d.scoring==="straight_up"?"Straight up":"Against the spread"}</b><em>Edit</em></button>
    <button data-cp-wiz-edit="3"><span>Weekly picks</span><b>${d.weeklyPickMode==="all"?"Every game":`Pick ${Number(d.weeklyPickCount)||0} games`}</b><em>Edit</em></button>
    <button data-cp-wiz-edit="4"><span>Confidence points</span><b>${d.confidenceMode==="all"?"All picks":`Top ${Number(d.confidenceCount)||0} picks`}</b><em>Edit</em></button>
    <button data-cp-wiz-edit="5"><span>Dropped weeks</span><b>${Number(d.dropLowestWeeks)>0?`Lowest ${Number(d.dropLowestWeeks)} weeks`:"None"}</b><em>Edit</em></button>
    <button data-cp-wiz-edit="6"><span>Entries</span><b>${Math.max(1,Number(d.entryCount)||1)}</b><em>Edit</em></button>
  </div></div>`;
}

function renderConfidencePoolWizard(mount){
  const step=cpWizard.step, review=step===7;
  mount.innerHTML=`<div class="card pg-wizard-card">
    <div class="pg-wizard-head"><div><div class="pg-wizard-kicker">${cpWizard.editingPoolId?"Edit confidence pool":"Create confidence pool"}</div><h2>${review?"Review your pool":`Step ${step} of 6`}</h2></div><button class="iconbtn" id="cpWizCancel" aria-label="Cancel pool setup">✕</button></div>
    <div class="pg-wizard-progress" aria-label="Setup progress">${Array.from({length:6},(_,i)=>`<span class="${i<Math.min(step,6)?"done":""} ${i===step-1&&!review?"current":""}"></span>`).join("")}</div>
    ${cpRenderWizardStep()}
    <div class="pg-wizard-actions">${step>1?`<button class="btn btn-light" id="cpWizBack">← Back</button>`:`<span></span>`}<button class="btn" id="cpWizNext" ${!review&&!cpWizardCanContinue()?"disabled":""}>${review?(cpWizard.editingPoolId?"Save pool settings →":"Create confidence pool →"):"Continue →"}</button></div>
  </div>`;
  wireConfidencePoolWizard();
}

function wireConfidencePoolWizard(){
  if(!cpWizard) return;
  const d=cpWizard.draft;
  document.getElementById("cpWizCancel")?.addEventListener("click",cpCancelPoolWizard);
  document.getElementById("cpWizName")?.addEventListener("input",e=>{d.name=e.target.value; const n=document.getElementById("cpWizNext"); if(n)n.disabled=!cpWizardCanContinue();});
  document.querySelectorAll("[data-cp-wiz-scoring]").forEach(b=>b.onclick=()=>{d.scoring=b.dataset.cpWizScoring;renderConfidenceTab();});
  document.querySelectorAll("[data-cp-wiz-weekly]").forEach(b=>b.onclick=()=>{d.weeklyPickMode=b.dataset.cpWizWeekly;if(d.weeklyPickMode==="count"&&!d.weeklyPickCount)d.weeklyPickCount=10;renderConfidenceTab();});
  document.getElementById("cpWizWeeklyCount")?.addEventListener("input",e=>{d.weeklyPickCount=e.target.value; const n=document.getElementById("cpWizNext"); if(n)n.disabled=!cpWizardCanContinue();});
  document.querySelectorAll("[data-cp-wiz-confidence]").forEach(b=>b.onclick=()=>{d.confidenceMode=b.dataset.cpWizConfidence;if(d.confidenceMode==="top"&&!d.confidenceCount)d.confidenceCount=5;renderConfidenceTab();});
  document.getElementById("cpWizConfidenceCount")?.addEventListener("input",e=>{d.confidenceCount=e.target.value; const n=document.getElementById("cpWizNext"); if(n)n.disabled=!cpWizardCanContinue();});
  document.querySelectorAll("[data-cp-wiz-drop]").forEach(b=>b.onclick=()=>{d.dropLowestWeeks=b.dataset.cpWizDrop==="0"?0:(Number(d.dropLowestWeeks)>0?Number(d.dropLowestWeeks):1);renderConfidenceTab();});
  document.getElementById("cpWizDropCount")?.addEventListener("input",e=>{d.dropLowestWeeks=e.target.value; const n=document.getElementById("cpWizNext"); if(n)n.disabled=!cpWizardCanContinue();});
  document.querySelectorAll("[data-cp-entry-step]").forEach(b=>b.onclick=()=>{d.entryCount=Math.max(1,Math.min(25,(Number(d.entryCount)||1)+Number(b.dataset.cpEntryStep)));renderConfidenceTab();});
  document.getElementById("cpWizEntryCount")?.addEventListener("input",e=>{d.entryCount=Math.max(1,Math.min(25,Number(e.target.value)||1)); const n=document.getElementById("cpWizNext"); if(n)n.disabled=!cpWizardCanContinue();});
  document.querySelectorAll("[data-cp-wiz-edit]").forEach(b=>b.onclick=()=>{cpWizard.step=Number(b.dataset.cpWizEdit);renderConfidenceTab();});
  document.getElementById("cpWizBack")?.addEventListener("click",()=>{cpWizard.step=Math.max(1,cpWizard.step-1);renderConfidenceTab();});
  document.getElementById("cpWizNext")?.addEventListener("click",()=>{
    // Capture number fields before leaving the step.
    if(cpWizard.step===3){ const el=document.getElementById("cpWizWeeklyCount"); if(el)d.weeklyPickCount=el.value; }
    if(cpWizard.step===4){ const el=document.getElementById("cpWizConfidenceCount"); if(el)d.confidenceCount=el.value; }
    if(cpWizard.step===5){ const el=document.getElementById("cpWizDropCount"); if(el)d.dropLowestWeeks=el.value; }
    if(cpWizard.step===6){ const el=document.getElementById("cpWizEntryCount"); if(el)d.entryCount=el.value; }
    if(cpWizard.step<7){ if(!cpWizardCanContinue())return; cpWizard.step++; renderConfidenceTab(); return; }
    cpCreatePoolFromDraft(d); cpWizard=null; renderConfidenceTab();
  });
}

function cpPools(){ return state.confidencePools; }
function cpActivePool(){
  const id=state.confidenceActivePoolId;
  const pools=cpPools();
  if(id){ const p=pools.find(x=>x.id===id&&!x.archived); if(p) return p; }
  return pools.find(x=>!x.archived)||null;
}
function cpSetActivePool(id){ state.confidenceActivePoolId=id; save(); renderConfidenceTab(); }
function cpActiveEntry(pool){
  if(!pool||!pool.entries||!pool.entries.length) return null;
  const uiKey="cpActiveEntry_"+pool.id;
  let id=null;
  try{ id=localStorage.getItem(uiKey); }catch(e){}
  return pool.entries.find(e=>e.id===id)||pool.entries[0];
}
function cpSetActiveEntry(pool,entryId){
  try{ localStorage.setItem("cpActiveEntry_"+pool.id,entryId); }catch(e){}
  renderConfidenceTab();
}
function cpSubview(pool){
  let v="this_week";
  try{ v=localStorage.getItem("cpSubview_"+pool.id)||v; }catch(e){}
  return ["this_week","results","settings"].includes(v)?v:"this_week";
}
function cpSetSubview(pool,v){
  try{ localStorage.setItem("cpSubview_"+pool.id,v); }catch(e){}
  renderConfidenceTab();
}

function cpAddEntry(pool,name,picks){
  const nm=(name||"").trim()||("Entry "+(pool.entries.length+1));
  const e={id:uid(),name:nm,picks:picks?JSON.parse(JSON.stringify(picks)):{},history:[]};
  pool.entries.push(e); save(); cpSetActiveEntry(pool,e.id); return e;
}
function cpDuplicateEntry(pool,entry){
  return cpAddEntry(pool,`Entry ${pool.entries.length+1}`,entry&&entry.picks||{});
}
function cpRenameEntry(pool,entry,name){
  const nm=(name||"").trim(); if(!entry||!nm)return false; entry.name=nm; save(); return true;
}

function cpBoardGamesForAdd(){
  return (state.lastGames||[]).slice().sort((a,b)=>(Date.parse(a.commence)||0)-(Date.parse(b.commence)||0));
}
function cpFindLiveGame(g){
  return (state.lastGames||[]).find(x=>teamMatchTrunc(g.away,x.away)&&teamMatchTrunc(g.home,x.home))||null;
}
function cpFindPredictionRow(g){
  return (state.predictions||[]).find(p=>{
    const away=typeof normTracker==="function"?normTracker(p.road):p.road;
    const home=typeof normTracker==="function"?normTracker(p.home):p.home;
    return teamMatchTrunc(away,g.away)&&teamMatchTrunc(home,g.home);
  })||null;
}
function cpFindPowersRow(g){
  return (state.pdfGames||[]).find(p=>teamMatchTrunc(p.away,g.away)&&teamMatchTrunc(p.home,g.home))||null;
}
function cpProviderIdFor(g){ const live=cpFindLiveGame(g); return live?(live.id||null):(g.providerGameId||null); }
function cpAddGameToPool(pool,{away,home,commence,providerGameId,line,awayRotation,homeRotation}){
  const key=mkey(away,home);
  if((pool.games||[]).some(g=>g.key===key)) return false;
  const live=cpFindLiveGame({away,home});
  pool.games=pool.games||[];
  pool.games.push({
    key,away,home,commence:commence||(live&&live.commence)||null,
    providerGameId:providerGameId||(live&&live.id)||null,
    line:(line!=null&&line!==""?Number(line):null),
    awayRotation:awayRotation!=null?awayRotation:(live&&live.awayRotation!=null?live.awayRotation:null),
    homeRotation:homeRotation!=null?homeRotation:(live&&live.homeRotation!=null?live.homeRotation:null),
  });
  save(); return true;
}
function cpRemoveGameFromPool(pool,key){
  pool.games=(pool.games||[]).filter(g=>g.key!==key); save();
}
function cpSetGameLine(pool,key,rawValue){
  const g=(pool.games||[]).find(x=>x.key===key); if(!g)return;
  g.line=(rawValue===""||rawValue==null||isNaN(Number(rawValue)))?null:Number(rawValue); save();
}
function cpFormatLine(v){
  if(v==null||v===""||isNaN(Number(v))) return "—";
  const n=Number(v); return n>0?`+${n}`:`${n}`;
}
function cpCardLockMs(pool){ const t=Date.parse(pool&&pool.cardLockAt||""); return Number.isFinite(t)?t:null; }
function cpIsCardLocked(pool,nowMs=Date.now()){ const t=cpCardLockMs(pool); return t!=null&&nowMs>=t; }
function cpLockText(pool){
  if(!pool||!pool.cardLockAt)return "No card lock imported";
  return `Card locks ${kickStr(pool.cardLockAt)}`;
}
function cpCanEditRules(pool){
  // Imported weekly games alone do not lock season-rule editing; actual picks
  // or submitted history do. This lets an import warning (for example the PDF
  // says drop 2 but setup says drop 1) be corrected before the card is built.
  return !(pool.entries||[]).some(e=>Object.keys(e.picks||{}).length||(e.history||[]).length);
}

// ---------- Weekly Splash PDF import -------------------------------------
function cpImportRuleWarnings(pool,data){
  const warnings=[];
  if(data.dropLowestWeeks!=null){
    const expected=Number(pool.dropLowestWeeks)||0, found=Number(data.dropLowestWeeks)||0;
    if(expected!==found) warnings.push(`Sheet says drop ${found} week${found===1?"":"s"}; pool setup says ${expected?`drop ${expected}`:"every week counts"}.`);
  }
  if(cpWeeklyPickMode(pool)==="all" && data.pickLimit!=null && Number(data.pickLimit)!==Number(data.count)){
    warnings.push(`Sheet says ${data.pickLimit} picks but ${data.count} games were parsed.`);
  }
  if(cpWeeklyPickMode(pool)==="count" && data.pickLimit!=null && Number(data.pickLimit)!==cpWeeklyPickCount(pool)){
    warnings.push(`Sheet footer says ${data.pickLimit} picks; pool setup says pick ${cpWeeklyPickCount(pool)}.`);
  }
  return warnings;
}
function cpApplyImportedWeek(pool,data){
  // Splash PDFs show navigation tabs for several weeks, so the first literal
  // "Week N" in the text is not a reliable indicator of the sheet being
  // imported. Prefer the actual kickoff dates when the shared CFB calendar is
  // available, then fall back to parser metadata / the pool's current week.
  const derivedWeeks=(data.games||[])
    .map(g=>(g&&g.commence&&typeof weekIndexOf==="function")?weekIndexOf(g.commence):null)
    .filter(w=>Number.isFinite(w));
  let derivedWeek=null;
  if(derivedWeeks.length){
    const counts=new Map();
    derivedWeeks.forEach(w=>counts.set(w,(counts.get(w)||0)+1));
    derivedWeek=[...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0][0];
  }
  const incomingWeek=Number(derivedWeek)||Number(data.weekNumber)||Number(pool.currentWeekNumber)||1;
  const currentWeek=Number(pool.currentWeekNumber)||1;
  if((pool.games||[]).length && incomingWeek!==currentWeek){
    const missing=(pool.entries||[]).filter(e=>!(e.history||[]).some(w=>Number(w.week)===currentWeek&&w.status==="submitted"));
    if(missing.length) return {ok:false,error:`Submit ${missing.map(e=>e.name).join(", ")} for ${pool.weekLabel||`Week ${currentWeek}`} before importing Week ${incomingWeek}.`};
    (pool.entries||[]).forEach(e=>{e.picks={};});
  }
  const oldPicksByEntry=new Map((pool.entries||[]).map(e=>[e.id,e.picks||{}]));
  const parsed=(data.games||[]).map(pg=>{
    const live=cpFindLiveGame(pg);
    return {
      key:mkey(pg.away,pg.home), away:pg.away, home:pg.home,
      commence:pg.commence||(live&&live.commence)||null,
      line:cpScoring(pool)==="ats"?(pg.line!=null?Number(pg.line):null):null,
      providerGameId:live?(live.id||null):null,
      awayRotation:live&&live.awayRotation!=null?live.awayRotation:null,
      homeRotation:live&&live.homeRotation!=null?live.homeRotation:null,
    };
  });
  pool.games=parsed;
  pool.currentWeekNumber=incomingWeek;
  pool.weekLabel=`Week ${incomingWeek}`;
  pool.cardLockAt=data.picksLockAt||null;
  pool.lockMode=data.lockMode||((data.picksLockAt)?"card":null);
  pool.weekImportMeta={
    source:data.source||"splash", importedAt:new Date().toISOString(),
    pickLimit:data.pickLimit!=null?Number(data.pickLimit):null,
    gameCount:parsed.length, dropLowestWeeks:data.dropLowestWeeks!=null?Number(data.dropLowestWeeks):null,
    warnings:cpImportRuleWarnings(pool,data),
  };
  // Same-week re-import keeps picks that still map to the same game keys.
  if(incomingWeek===currentWeek){
    const valid=new Set(parsed.map(g=>g.key));
    (pool.entries||[]).forEach(e=>{
      const old=oldPicksByEntry.get(e.id)||{}; const keep={};
      Object.keys(old).forEach(k=>{if(valid.has(k))keep[k]=old[k];}); e.picks=keep;
    });
  }
  save(); return {ok:true,count:parsed.length,warnings:pool.weekImportMeta.warnings};
}
async function cpImportWeeklyPdf(pool,file){
  const st=document.getElementById("cpImportStatus");
  if(st){st.className="note";st.textContent="Reading Splash sheet…";}
  try{
    const lines=await extractPdfTextLines(file);
    if(!lines.length) throw new Error("Couldn't read any text from that PDF.");
    const result=await apiFetch("/api/parse_pool",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lines,year:seasonYear()})});
    if(!result.ok) throw new Error(result.error||"Pool sheet import failed.");
    const applied=cpApplyImportedWeek(pool,result.body);
    if(!applied.ok) throw new Error(applied.error);
    if(st){st.className=applied.warnings.length?"warn":"ok";st.textContent=`Imported ${applied.count} games${applied.warnings.length?` · ${applied.warnings.join(" ")}`:" · contest lines locked"}`;}
    renderConfidenceTab();
  }catch(err){ if(st){st.className="err";st.textContent="Import failed: "+err.message;} console.error(err); }
}

// ---------- PickGauge analysis for an imported confidence slate ---------
function cpDerivedSpFor(g){
  if(typeof cfbdRatingForTeam!=="function"||typeof cfbdDerivedSpread!=="function") return null;
  const away=cfbdRatingForTeam(g.away,null), home=cfbdRatingForTeam(g.home,null);
  return cfbdDerivedSpread(away&&away.sp&&away.sp.rating,home&&home.sp&&home.sp.rating,false);
}
// Straight-up confidence pools need a win probability, not an ATS cover
// probability. PickGauge Model # is already expressed as a projected HOME
// spread (negative = home favored), so convert its implied home margin
// (-model) through the historical CFB margin-residual distribution. The
// existing ATS calibration work in model.js documents a residual SD around
// 15.3-15.7 points across spread buckets; 15.5 keeps this conversion tied to
// the same empirical foundation without introducing a second rating model.
const CP_WIN_MARGIN_SD=15.5;
function cpErf(x){
  const sign=x<0?-1:1,a=Math.abs(x),t=1/(1+0.3275911*a);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);
  return sign*y;
}
function cpNormalCdf(z){return 0.5*(1+cpErf(z/Math.SQRT2));}
function cpWinProbabilityFromModel(model){
  if(model==null||model===""||isNaN(model))return null;
  const homeWin=Math.max(.01,Math.min(.99,cpNormalCdf((-Number(model))/CP_WIN_MARGIN_SD)));
  if(Math.abs(homeWin-.5)<1e-12)return {homeWin:.5,awayWin:.5,side:null,pWin:.5};
  return homeWin>.5?{homeWin,awayWin:1-homeWin,side:"home",pWin:homeWin}:{homeWin,awayWin:1-homeWin,side:"away",pWin:1-homeWin};
}
function cpPickGaugeAnalysis(pool,g){
  const live=cpFindLiveGame(g);
  if(typeof PICKGAUGE_MODEL_PRESET==="undefined") return {live,liveVegas:live&&live.vegas!=null?Number(live.vegas):null,model:null,modelInputs:{},availableCount:0,side:null,pCover:null,edge:null};
  const liveVegas=live&&live.vegas!=null&&!isNaN(live.vegas)?Number(live.vegas):null;
  const row=cpFindPredictionRow(g), systems=row&&row.systems||{};
  const cfbdsp=(systems.cfbdsp!=null&&!isNaN(systems.cfbdsp))?Number(systems.cfbdsp):cpDerivedSpFor(g);
  const vals={
    teamrank:systems.teamrank, sagpred:systems.sagpred, cfbdsp,
    wayward:systems.wayward, sag:systems.sag, vegas:liveVegas,
  };
  const available=PICKGAUGE_MODEL_PRESET.systems.filter(c=>vals[c]!=null&&vals[c]!==""&&!isNaN(vals[c]));
  let model=null;
  if(liveVegas!=null&&available.length>=3){
    const vw=Number(PICKGAUGE_MODEL_PRESET.weights.vegas)||0;
    const target=100-vw;
    const base=available.reduce((sum,c)=>sum+(Number(PICKGAUGE_MODEL_PRESET.weights[c])||0),0);
    if(base>0){
      let num=liveVegas*vw;
      available.forEach(c=>{num+=Number(vals[c])*target*((Number(PICKGAUGE_MODEL_PRESET.weights[c])||0)/base);});
      model=num/100;
    }
  }
  const powers=cpFindPowersRow(g);
  const modelInputs={bp:powers&&powers.bp!=null?Number(powers.bp):null,comp:powers&&powers.comp!=null?Number(powers.comp):null,...vals};
  if(cpScoring(pool)!=="ats"){
    const win=cpWinProbabilityFromModel(model);
    return {live,liveVegas,model,modelInputs,availableCount:available.length,side:win&&win.side||null,pCover:null,pWin:win&&win.pWin!=null?win.pWin:null,homeWin:win&&win.homeWin!=null?win.homeWin:null,awayWin:win&&win.awayWin!=null?win.awayWin:null,edge:model!=null&&liveVegas!=null?round1(Math.abs(liveVegas-model)):null,prob:win};
  }
  if(model==null||g.line==null) return {live,liveVegas,model,modelInputs,availableCount:available.length,side:null,pCover:null,pWin:null,edge:null};
  const prob=probabilityCoverForGame(model,Number(g.line));
  const side=model<Number(g.line)?"home":model>Number(g.line)?"away":null;
  return {live,liveVegas,model,modelInputs,availableCount:available.length,side,pCover:prob&&prob.pCover!=null?prob.pCover:null,pWin:null,edge:round1(Math.abs(Number(g.line)-model)),prob};
}
function cpAnalysisSideName(g,side){ return side==="home"?g.home:side==="away"?g.away:null; }
function cpAnalysisSideLine(g,side){ if(g.line==null||!side)return null; return side==="home"?Number(g.line):-Number(g.line); }
function cpAnalysisSummary(a,g,pool){
  if(!a||a.model==null)return "PickGauge Model # incomplete";
  if(cpScoring(pool)==="straight_up"){
    if(a.side==null||a.pWin==null)return "PickGauge sees a virtual toss-up";
    return `${cpAnalysisSideName(g,a.side)} · ${(a.pWin*100).toFixed(1)}% win`;
  }
  if(a.side==null)return "Model matches pool line";
  return `${cpAnalysisSideName(g,a.side)} ${cpFormatLine(cpAnalysisSideLine(g,a.side))}`;
}
function cpInputSummary(a){
  if(!a)return "";
  const names={bp:"BP",comp:"Comp",teamrank:"TeamRank",sagpred:"Sag Pts",cfbdsp:"SP+",wayward:"Wayward",sag:"Sagarin"};
  return Object.keys(names).filter(k=>a.modelInputs&&a.modelInputs[k]!=null&&!isNaN(a.modelInputs[k])).map(k=>`${names[k]} ${round1(Number(a.modelInputs[k]))}`).join(" · ");
}

// ---------- Ranking / card manipulation ---------------------------------
function cpRankedKeys(pool,entry){
  const valid=new Set((pool.games||[]).map(g=>g.key));
  return Object.keys(entry&&entry.picks||{}).filter(k=>valid.has(k)&&Number(entry.picks[k].points)>0).sort((a,b)=>Number(entry.picks[b].points)-Number(entry.picks[a].points));
}
function cpAssignRankOrder(pool,entry,keys){
  const max=cpMaxPoints(pool), valid=[]; const seen=new Set();
  (keys||[]).forEach(k=>{if(!seen.has(k)&&entry.picks[k]&&(entry.picks[k].team==="home"||entry.picks[k].team==="away")){seen.add(k);valid.push(k);}});
  const ranked=valid.slice(0,max);
  Object.keys(entry.picks||{}).forEach(k=>{ if(entry.picks[k]) entry.picks[k].points=0; });
  ranked.forEach((k,i)=>{entry.picks[k].points=max-i;});
  return ranked;
}
function cpMoveRank(pool,entry,key,delta){
  const keys=cpRankedKeys(pool,entry), i=keys.indexOf(key); if(i<0)return false;
  const j=Math.max(0,Math.min(keys.length-1,i+delta)); if(j===i)return false;
  const [m]=keys.splice(i,1); keys.splice(j,0,m); cpAssignRankOrder(pool,entry,keys); save(); return true;
}
function cpMoveRankTo(pool,entry,key,targetKey){
  const keys=cpRankedKeys(pool,entry), i=keys.indexOf(key), j=keys.indexOf(targetKey); if(i<0||j<0||i===j)return false;
  const [m]=keys.splice(i,1); keys.splice(j,0,m); cpAssignRankOrder(pool,entry,keys); save(); return true;
}
function cpToggleTopRank(pool,entry,key){
  if(cpConfidenceMode(pool)!=="top")return false;
  const p=entry.picks[key]; if(!p||!(p.team==="home"||p.team==="away"))return false;
  let keys=cpRankedKeys(pool,entry);
  if(Number(p.points)>0) keys=keys.filter(k=>k!==key);
  else { if(keys.length>=cpMaxPoints(pool)) return false; keys.push(key); }
  cpAssignRankOrder(pool,entry,keys); save(); return true;
}
function cpSelectedCount(pool,entry){
  const valid=new Set((pool.games||[]).map(g=>g.key)); return Object.keys(entry.picks||{}).filter(k=>valid.has(k)&&["home","away"].includes(entry.picks[k]&&entry.picks[k].team)).length;
}
function cpSetPickSide(pool,entry,key,team){
  if(cpIsCardLocked(pool))return {ok:false,error:"This confidence card is locked."};
  const cur=entry.picks[key]||{}; const same=cur.team===team;
  if(!same&&cpWeeklyPickMode(pool)==="count"&&cur.team==null&&cpSelectedCount(pool,entry)>=cpRequiredPickCount(pool)) return {ok:false,error:`This pool allows ${cpRequiredPickCount(pool)} picks. Remove one before adding another.`};
  if(same){ entry.picks[key]={team:null,points:0}; cpAssignRankOrder(pool,entry,cpRankedKeys(pool,entry).filter(k=>k!==key)); }
  else {
    entry.picks[key]={team,points:Number(cur.points)||0};
    if(cpConfidenceMode(pool)==="all"&&Number(entry.picks[key].points)<=0){ const keys=cpRankedKeys(pool,entry); keys.push(key); cpAssignRankOrder(pool,entry,keys); }
  }
  save(); return {ok:true};
}
function cpBuildSuggestedCard(pool,entry){
  const ats=cpScoring(pool)==="ats";
  const rows=(pool.games||[]).map(g=>({g,a:cpPickGaugeAnalysis(pool,g)})).filter(x=>x.a&&x.a.side&&(ats?x.a.pCover!=null:x.a.pWin!=null)).sort((x,y)=>ats?((y.a.pCover-x.a.pCover)||((y.a.edge||0)-(x.a.edge||0))):((y.a.pWin-x.a.pWin)||((y.a.edge||0)-(x.a.edge||0))));
  const required=cpRequiredPickCount(pool);
  const chosen=cpWeeklyPickMode(pool)==="all"?rows:rows.slice(0,required);
  const chosenKeys=new Set(chosen.map(x=>x.g.key));
  (pool.games||[]).forEach(g=>{
    const hit=chosen.find(x=>x.g.key===g.key);
    if(hit) entry.picks[g.key]={team:hit.a.side,points:0};
    else if(cpWeeklyPickMode(pool)==="count") delete entry.picks[g.key];
  });
  const rankKeys=chosen.slice(0,cpRequiredRankedCount(pool)).map(x=>x.g.key);
  cpAssignRankOrder(pool,entry,rankKeys); save();
  return {ok:true,picked:chosen.length,required,missing:Math.max(0,required-chosen.length),ranked:rankKeys.length};
}
function cpOrderedGames(pool,entry){
  return (pool.games||[]).slice().sort((a,b)=>{
    const ap=Number(entry&&entry.picks&&entry.picks[a.key]&&entry.picks[a.key].points)||0;
    const bp=Number(entry&&entry.picks&&entry.picks[b.key]&&entry.picks[b.key].points)||0;
    if(ap!==bp)return bp-ap;
    const at=Date.parse(a.commence||"")||Infinity, bt=Date.parse(b.commence||"")||Infinity;
    return at-bt||String(a.away).localeCompare(String(b.away));
  });
}
function cpReadiness(pool,entry){
  const v=cpValidatePicks(pool,entry,true);
  const ats=cpScoring(pool)==="ats";
  const lineMissing=ats?(pool.games||[]).filter(g=>g.line==null).length:0;
  return {...v,lineMissing,ready:v.valid&&!cpIsCardLocked(pool)};
}

// ---------- Submission snapshots / results ------------------------------
function cpSnapshotGames(pool,entry){
  return (pool.games||[]).filter(g=>["home","away"].includes(entry.picks[g.key]&&entry.picks[g.key].team)).map(g=>{
    const p=entry.picks[g.key]||{};
    const a=cpPickGaugeAnalysis(pool,g);
    return {
      key:g.key,away:g.away,home:g.home,commence:g.commence||null,line:g.line,
      providerGameId:g.providerGameId||cpProviderIdFor(g),cfbdGameId:null,cfbdSeason:null,cfbdHomeTeamId:null,cfbdAwayTeamId:null,
      team:p.team,points:Number(p.points)||0,result:null,pointsEarned:null,
      pickGaugeModelAtSubmit:a&&a.model!=null?round1(a.model):null,
      coverProbabilityAtSubmit:a&&a.pCover!=null?Number(a.pCover):null,
      winProbabilityAtSubmit:a&&a.pWin!=null?Number(a.pWin):null,
      liveHomeLineAtSubmit:a&&a.liveVegas!=null?Number(a.liveVegas):null,
    };
  });
}
function cpMarkCardSubmitted(pool,entry){
  if(cpIsCardLocked(pool)) return {ok:false,errors:["This confidence card is locked and can no longer be submitted or changed."]};
  const v=cpValidatePicks(pool,entry,true); if(!v.valid)return {ok:false,errors:v.errors};
  const now=new Date().toISOString(), wk=Number(pool.currentWeekNumber)||1;
  const snap={week:wk,season:new Date().getFullYear(),weekLabel:pool.weekLabel||`Week ${wk}`,submittedAt:now,archivedAt:now,status:"submitted",games:cpSnapshotGames(pool,entry),totalPoints:null,possiblePoints:null};
  const i=(entry.history||[]).findIndex(w=>Number(w.week)===wk);
  if(i>=0) entry.history[i]=snap; else entry.history.unshift(snap);
  entry.lastSubmittedAt=now; entry.lastSubmittedWeek=wk; save(); return {ok:true,snapshot:snap};
}
function cpSubmittedWeek(entry,pool){ const wk=Number(pool.currentWeekNumber)||1; return (entry.history||[]).find(w=>Number(w.week)===wk&&w.status==="submitted")||null; }
function cpCloseWeek(pool){
  // Legacy/manual rollover helper retained for tests and future explicit use.
  const problems=[]; pool.entries.forEach(e=>{const v=cpValidatePicks(pool,e,true);if(!v.valid)problems.push(`${e.name}: ${v.errors[0]}`);});
  return {problems,apply:()=>{pool.entries.forEach(e=>{if(!cpSubmittedWeek(e,pool))cpMarkCardSubmitted(pool,e);e.picks={};});pool.games=[];pool.currentWeekNumber=(pool.currentWeekNumber||1)+1;pool.weekLabel=`Week ${pool.currentWeekNumber}`;pool.cardLockAt=null;pool.weekImportMeta=null;save();}};
}

// ---------- Export --------------------------------------------------------
function cpCardLines(pool,entry){
  const picked=cpOrderedGames(pool,entry).filter(g=>["home","away"].includes(entry.picks[g.key]&&entry.picks[g.key].team));
  return picked.map(g=>{const p=entry.picks[g.key],rank=Number(p.points)||0;return `${rank>0?rank:"—"} — ${cpSideLabel(pool,g,p.team)}`;});
}
function cpCopyCardText(pool,entry){
  return [`${pool.name} · ${pool.weekLabel||""}`,entry.name,cpLockText(pool),"",...cpCardLines(pool,entry)].join("\n");
}
async function cpCopyCard(pool,entry){
  const txt=cpCopyCardText(pool,entry);
  if(navigator.clipboard&&navigator.clipboard.writeText){await navigator.clipboard.writeText(txt);return true;}
  const ta=document.createElement("textarea");ta.value=txt;document.body.appendChild(ta);ta.select();const ok=document.execCommand("copy");ta.remove();return ok;
}
function cpPrintCard(pool,entry){
  const ats=cpScoring(pool)==="ats",probLabel=ats?"Cover %":"Win %";
  const rows=cpOrderedGames(pool,entry).filter(g=>["home","away"].includes(entry.picks[g.key]&&entry.picks[g.key].team)).map(g=>{
    const p=entry.picks[g.key],a=cpPickGaugeAnalysis(pool,g);const rank=Number(p.points)||0,prob=ats?a&&a.pCover:a&&a.pWin;
    return `<tr><td>${rank||"—"}</td><td>${esc(cpSideLabel(pool,g,p.team))}</td><td>${esc(g.away)} @ ${esc(g.home)}</td><td>${ats&&g.line!=null?esc(cpFormatLine(g.line)):"—"}</td><td>${a&&a.model!=null?esc(cpFormatLine(round1(a.model))):"—"}</td><td>${prob!=null?(prob*100).toFixed(1)+"%":"—"}</td></tr>`;
  }).join("");
  const w=window.open("","_blank"); if(!w)return false;
  w.document.write(`<!doctype html><html><head><title>${esc(pool.name)} ${esc(pool.weekLabel||"")}</title><style>body{font-family:Arial,sans-serif;margin:28px;color:#111}h1{font-size:20px;margin:0 0 4px}.meta{font-size:12px;color:#666;margin-bottom:18px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px;border-bottom:1px solid #ddd;text-align:left}th{font-size:10px;text-transform:uppercase;color:#666}@media print{body{margin:12mm}}</style></head><body><h1>${esc(pool.name)} · ${esc(pool.weekLabel||"")}</h1><div class="meta">${esc(entry.name)} · ${esc(cpLockText(pool))} · Generated ${esc(new Date().toLocaleString())}</div><table><thead><tr><th>Pts</th><th>Pick</th><th>Matchup</th><th>Pool line</th><th>PG Model #</th><th>${probLabel}</th></tr></thead><tbody>${rows}</tbody></table><script>window.onload=()=>setTimeout(()=>window.print(),150);<\/script></body></html>`); w.document.close(); return true;
}
function cpExportCardCsv(pool,entry){
  const ats=cpScoring(pool)==="ats",probLabel=ats?"Cover %":"Win %";
  const q=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`;
  const rows=[["Confidence","Pick","Away","Home","Pool home line","Live home line","PickGauge Model #",probLabel,"Kickoff"]];
  cpOrderedGames(pool,entry).forEach(g=>{const p=entry.picks[g.key]||{};if(!["home","away"].includes(p.team))return;const a=cpPickGaugeAnalysis(pool,g),prob=ats?a.pCover:a.pWin;rows.push([Number(p.points)||0,cpSideLabel(pool,g,p.team),g.away,g.home,ats?g.line:"",a.liveVegas,a.model,prob!=null?prob:"",g.commence||""]);});
  const blob=new Blob([rows.map(r=>r.map(q).join(",")).join("\r\n")],{type:"text/csv;charset=utf-8"});const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`${pool.name}-${pool.weekLabel||"week"}-${entry.name}.csv`.replace(/[^a-z0-9._-]+/gi,"-");document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);
}

// ---------- Rendering ----------------------------------------------------
function cpSideLabel(pool,game,side){
  const name=side==="home"?game.home:game.away;
  if(cpScoring(pool)==="straight_up"||game.line==null)return name;
  const sideLine=side==="home"?Number(game.line):-Number(game.line);
  return `${name} ${cpFormatLine(sideLine)}`;
}
function cpHeaderHTML(pool){
  const pools=cpPools().filter(p=>!p.archived), view=cpSubview(pool);
  return `<div class="card cp-shell-head"><div class="row-f" style="align-items:center;"><select id="cpPoolSelect" class="grow">${pools.map(p=>`<option value="${esc(p.id)}" ${p.id===pool.id?"selected":""}>${esc(p.name)} · ${esc(p.weekLabel||"Week 1")}</option>`).join("")}</select><button class="iconbtn" id="cpNewPoolBtn">+ New pool</button></div><div class="cp-rule-chips"><span>${esc(cpScoringLabel(pool))}</span><span>${esc(cpWeeklyRuleLabel(pool))}</span><span>${esc(cpConfidenceRuleLabel(pool))}</span><span>${esc(cpDropRuleLabel(pool))}</span></div><div class="cp-subnav" role="tablist"><button class="${view==="this_week"?"active":""}" data-cp-view="this_week">This Week</button><button class="${view==="results"?"active":""}" data-cp-view="results">Results</button><button class="${view==="settings"?"active":""}" data-cp-view="settings">Pool Settings</button></div></div>`;
}
function cpImportCardHTML(pool){
  const has=(pool.games||[]).length>0, meta=pool.weekImportMeta||{};
  const warns=(meta.warnings||[]).map(w=>`<div class="warn">${esc(w)}</div>`).join("");
  return `<div class="card cp-week-setup"><div class="cp-section-head"><div><div class="cp-kicker">Weekly setup</div><h2>${has?`${esc(pool.weekLabel)} sheet loaded`:"Import this week's pool sheet"}</h2><p class="sub">${has?`${pool.games.length} games · contest lines frozen from the imported sheet`:`Upload the Splash PDF. PickGauge will extract the slate, exact contest spreads, weekly pick count and card lock.`}</p></div><label class="btn btn-light cp-file-btn">${has?"Re-import sheet":"Import Splash PDF"}<input id="cpWeeklyPdf" type="file" accept="application/pdf,.pdf" hidden></label></div>${has?`<div class="cp-import-meta"><span>✓ ${pool.games.length} games</span><span>✓ ${cpScoring(pool)==="ats"?"pool lines locked":"straight-up slate"}</span><span>${pool.cardLockAt?`🔒 ${esc(cpLockText(pool))}`:"No lock time found"}</span></div>`:""}${warns}<div id="cpImportStatus" class="note"></div>${has?`<details class="cp-review-games"><summary>Review imported games &amp; lines</summary>${cpGamesListHTML(pool)}</details>`:""}<details class="cp-manual-fallback"><summary>Manual setup / troubleshooting</summary><div class="pred-panel-body">${cpAddGamesHTML(pool)}</div></details></div>`;
}
function cpGamesListHTML(pool){
  const games=pool.games||[]; if(!games.length)return `<p class="note">No games added yet.</p>`;
  const locked=cpIsCardLocked(pool),ats=cpScoring(pool)==="ats";
  return `<div class="cp-games-list">${games.map(g=>`<div class="cp-game-row"><span class="cp-game-teams">${esc(g.away)} @ ${esc(g.home)}</span><span class="sub">${g.commence?kickStr(g.commence):""}</span>${ats?`<label class="cp-line-edit sub">Home line <input type="number" step="0.5" class="cp-line-input" data-cp-line-for="${esc(g.key)}" value="${g.line!=null?g.line:""}" ${locked?"disabled":""}></label>`:`<span class="sub">Straight up</span>`}<button class="iconbtn" data-cp-remove-game="${esc(g.key)}" ${locked?"disabled":""}>✕</button></div>`).join("")}</div>`;
}
function cpAddGamesHTML(pool){
  const boardGames=cpBoardGamesForAdd(),existing=new Set((pool.games||[]).map(g=>g.key)),ats=cpScoring(pool)==="ats";
  const rows=boardGames.filter(g=>!existing.has(mkey(g.away,g.home))).map(g=>{
    const key=mkey(g.away,g.home);
    // The checkbox and the "Live +6.5" text are unchanged (Drew's
    // explicit "leave the checkbox and live line" instruction) -- this
    // just ADDS an editable line input alongside them for ATS-scoring
    // pools, prefilled from that same live number, so a real Splash
    // sheet's printed line (which can differ from the live market by
    // the time picks are entered -- exactly what prompted this change,
    // since the PDF parser still isn't reliably succeeding) can be typed
    // in and corrected BEFORE "Save selected games" commits it, instead
    // of only being editable afterward in the already-saved games list
    // (cpGamesListHTML() above still has its own, separate line-edit
    // input for post-save corrections -- this doesn't replace that, it
    // just avoids needing it for a line that was already wrong at
    // save-time).
    const lineField=ats?`<input type="number" step="0.5" class="cp-preadd-line-input" data-cp-line-edit-for="${esc(key)}" value="${g.vegas!=null?g.vegas:""}" placeholder="line" aria-label="Line for ${esc(g.away)} at ${esc(g.home)}">`:"";
    return `<label class="pool-manual-row"><input type="checkbox" data-cp-board-check="1" data-cp-row-key="${esc(key)}" data-cp-away="${esc(g.away)}" data-cp-home="${esc(g.home)}" data-cp-commence="${esc(g.commence||"")}" data-cp-line="${g.vegas!=null?g.vegas:""}" data-cp-provider="${esc(g.id||"")}"><span class="pool-manual-teams">${esc(g.away)} @ ${esc(g.home)}</span><span class="sub">${g.vegas!=null?`Live ${cpFormatLine(g.vegas)}`:"no line"}</span>${lineField}</label>`;
  }).join("");
  return `<p class="sub">PDF import is the normal workflow. Use this only if a sheet can't be parsed.</p><div class="pool-manual-list">${rows||'<div class="pool-manual-empty">No live games loaded.</div>'}</div><div class="pool-manual-custom"><div class="pool-manual-custom-add"><input id="cpCustomAway" placeholder="Away team"><input id="cpCustomHome" placeholder="Home team">${cpScoring(pool)==="ats"?'<input type="number" step="0.5" id="cpCustomLine" placeholder="Home line">':''}<button class="iconbtn" id="cpAddCustomBtn">+ add game</button></div><div class="pool-manual-custom-list">${cpManualCustomGames.map((g,i)=>`<div class="pool-manual-custom-row"><span>${esc(g.away)} @ ${esc(g.home)}</span><button data-cp-remove-custom="${i}">✕</button></div>`).join("")}</div></div><button class="btn btn-light" id="cpSaveGamesBtn">Save selected games</button>`;
}
function cpReadinessHTML(pool,entry){
  const v=cpValidatePicks(pool,entry,true),locked=cpIsCardLocked(pool),submitted=cpSubmittedWeek(entry,pool);
  const picksOk=v.pickedCount===v.required,rankOk=v.rankedCount===v.rankedRequired,linesOk=cpScoring(pool)!=="ats"||(pool.games||[]).every(g=>g.line!=null);
  return `<div class="cp-readiness ${v.valid?"ready":"needs-work"}"><div class="cp-readiness-title">${locked?"🔒 Card locked":v.valid?"✓ Ready to submit":"Card checklist"}</div><div class="cp-readiness-grid"><span class="${picksOk?"ok":""}">${picksOk?"✓":"○"} ${v.pickedCount}/${v.required} picks</span><span class="${rankOk?"ok":""}">${rankOk?"✓":"○"} ${v.rankedCount}/${v.rankedRequired} confidence values</span><span class="${linesOk?"ok":""}">${linesOk?"✓":"○"} ${cpScoring(pool)==="ats"?"Pool lines verified":"Straight-up scoring"}</span></div>${v.errors.length&&!v.valid?`<div class="cp-readiness-error">${esc(v.errors[0])}${v.errors.length>1?` · +${v.errors.length-1} more`:""}</div>`:""}${submitted?`<div class="cp-submitted-note">Submitted ${new Date(submitted.submittedAt).toLocaleString()}${locked?"":" · edits can be re-submitted until lock"}</div>`:""}</div>`;
}
function cpBoardRowHTML(pool,entry,g){
  const ats=cpScoring(pool)==="ats";
  const p=entry.picks[g.key]||{},a=cpPickGaugeAnalysis(pool,g),rank=Number(p.points)||0,locked=cpIsCardLocked(pool),ranked=rank>0;
  const pickedCount=cpSelectedCount(pool,entry),pickCap=cpRequiredPickCount(pool),canAdd=cpWeeklyPickMode(pool)!=="count"||p.team!=null||pickedCount<pickCap;
  const rankKeys=cpRankedKeys(pool,entry),idx=rankKeys.indexOf(g.key);
  const inputSummary=cpInputSummary(a);
  return `<div class="cp-board-row ${ranked?"ranked":""}" data-cp-rank-row="${esc(g.key)}" ${ranked&&!locked?'draggable="true"':''}>
    <div class="cp-rank-cell"><div class="cp-rank-num">${rank||"—"}</div>${ranked&&!locked?`<div class="cp-rank-move"><button data-cp-move="-1" data-key="${esc(g.key)}" ${idx<=0?"disabled":""}>↑</button><button data-cp-move="1" data-key="${esc(g.key)}" ${idx<0||idx>=rankKeys.length-1?"disabled":""}>↓</button></div>`:""}</div>
    <div class="cp-match-cell"><div class="cp-kick">${g.commence?kickStr(g.commence):"Kickoff TBD"}</div><div class="cp-side-buttons"><button class="cp-team-btn ${p.team==="away"?"active":""}" data-cp-pick-team="${esc(g.key)}" data-team="away" ${locked||(!canAdd&&p.team!=="away")?"disabled":""}>${esc(cpSideLabel(pool,g,"away"))}</button><span>@</span><button class="cp-team-btn ${p.team==="home"?"active":""}" data-cp-pick-team="${esc(g.key)}" data-team="home" ${locked||(!canAdd&&p.team!=="home")?"disabled":""}>${esc(cpSideLabel(pool,g,"home"))}</button></div><div class="cp-model-inputs">${esc(inputSummary||"Model inputs not loaded")}</div></div>
    <div class="cp-metric"><span>Live</span><b>${a.liveVegas!=null?cpFormatLine(a.liveVegas):"—"}</b></div>
    <div class="cp-metric"><span>PG Model #</span><b>${a.model!=null?cpFormatLine(round1(a.model)):"—"}</b></div>
    <div class="cp-metric"><span>${ats?"Edge":"Vs market"}</span><b>${a.edge!=null?`${a.edge.toFixed(1)} pts`:"—"}</b></div>
    <div class="cp-metric"><span>${ats?"Cover":"Win"}</span><b>${(ats?a.pCover:a.pWin)!=null?((ats?a.pCover:a.pWin)*100).toFixed(1)+"%":"—"}</b></div>
    <div class="cp-row-action"><div class="cp-lean">${esc(cpAnalysisSummary(a,g,pool))}</div>${cpConfidenceMode(pool)==="top"&&p.team?`<button class="chip-btn ${ranked?"active":""}" data-cp-toggle-rank="${esc(g.key)}" ${locked?"disabled":""}>${ranked?"Remove rank":`Add to Top ${cpMaxPoints(pool)}`}</button>`:""}</div>
  </div>`;
}
function cpThisWeekHTML(pool,entry){
  const has=(pool.games||[]).length>0,locked=cpIsCardLocked(pool);
  const entries=`<div class="card cp-entry-card"><div class="cp-section-head"><div><div class="cp-kicker">Entry</div><h2>${esc(entry.name)}</h2></div><div class="cp-entry-actions"><div class="cp-entry-tabs">${pool.entries.map(e=>`<button class="chip-btn ${e.id===entry.id?"active":""}" data-cp-entry="${esc(e.id)}">${esc(e.name)}</button>`).join("")}</div><button class="btn btn-light" id="cpDuplicateEntryBtn">Duplicate entry</button></div></div></div>`;
  if(!has)return `${cpImportCardHTML(pool)}${entries}`;
  const ordered=cpOrderedGames(pool,entry);
  const ats=cpScoring(pool)==="ats",rankingCopy=ats?"Cover % against the exact imported pool line":"PickGauge Win % derived from the projected game margin";
  return `${cpImportCardHTML(pool)}${entries}<div class="card cp-confidence-board"><div class="cp-section-head"><div><div class="cp-kicker">Confidence board</div><h2>${esc(pool.weekLabel)} · ${esc(entry.name)}</h2><p class="sub">Pick the side, then order the card from highest to lowest confidence. PickGauge's suggestion uses ${rankingCopy}.</p></div><div class="cp-board-actions"><button class="btn" id="cpBuildRankingBtn" ${locked?"disabled":""}>✨ Build PickGauge ranking</button><details class="cp-export-menu"><summary class="btn btn-light">Export card ▾</summary><button data-cp-export="print">Print / PDF</button><button data-cp-export="copy">Copy picks</button><button data-cp-export="csv">CSV</button></details></div></div>${cpReadinessHTML(pool,entry)}<div class="cp-board-head"><span>Pts</span><span>Matchup / pick</span><span>Live</span><span>PG Model</span><span>${ats?"Edge":"Vs market"}</span><span>${ats?"Cover %":"Win %"}</span><span>Ranking</span></div><div class="cp-board-list">${ordered.map(g=>cpBoardRowHTML(pool,entry,g)).join("")}</div><div class="cp-submit-bar"><div><b>${cpLockText(pool)}</b><div class="sub">${locked?"The imported Splash card lock has passed.":"You can re-submit edits until the card locks."}</div></div><button class="btn" id="cpSubmitCardBtn" ${locked||!cpValidatePicks(pool,entry,true).valid?"disabled":""}>✓ Mark card submitted</button></div></div>`;
}
function cpResultsHTML(pool){
  const drop=Number(pool.dropLowestWeeks)||0;
  const standings=(pool.entries||[]).map(e=>({e,...cpSeasonTotal(e,drop)})).sort((a,b)=>b.points-a.points);
  const cards=(pool.entries||[]).map(e=>`<div class="cp-result-entry"><h3>${esc(e.name)}</h3>${!(e.history||[]).length?'<p class="note">No submitted cards yet.</p>':(e.history||[]).map(w=>`<details class="cp-result-week"><summary><span>${esc(w.weekLabel||`Week ${w.week}`)}</span><span>${w.totalPoints!=null?`${w.totalPoints}/${w.possiblePoints||0} pts`:w.status==="submitted"?"Submitted · awaiting results":"Awaiting results"}</span></summary><div class="cp-result-games">${(w.games||[]).sort((a,b)=>(Number(b.points)||0)-(Number(a.points)||0)).map(g=>`<div><b>${Number(g.points)||"—"}</b><span>${esc(g.team==="home"?g.home:g.away)} ${cpScoring(pool)==="ats"?esc(cpFormatLine(g.team==="home"?g.line:-g.line)):""}</span><span class="${g.result==="W"?"ok":g.result==="L"?"err":""}">${g.result||"—"}${g.pointsEarned!=null?` · +${g.pointsEarned}`:""}</span></div>`).join("")}</div></details>`).join("")}</div>`).join("");
  return `<div class="card"><div class="cp-kicker">Season</div><h2>My Entries</h2><p class="sub">This compares only your own PickGauge entries, not the live Splash leaderboard.</p><table class="cp-standings-table"><thead><tr><th>Entry</th><th>Points</th><th>Possible</th><th>Graded weeks</th>${drop?"<th>Dropped</th>":""}</tr></thead><tbody>${standings.map(r=>`<tr><td>${esc(r.e.name)}</td><td><b>${r.points}</b></td><td>${r.possible}</td><td>${r.weeksGraded}</td>${drop?`<td>${r.weeksDropped}</td>`:""}</tr>`).join("")}</tbody></table></div><div class="card"><h2>Submitted cards</h2>${cards}</div>`;
}
function cpSettingsHTML(pool,entry){
  const editable=cpCanEditRules(pool);
  return `<div class="card"><div class="cp-section-head"><div><div class="cp-kicker">Pool settings</div><h2>${esc(pool.name)}</h2></div><button class="btn btn-light" id="cpEditRulesBtn" ${editable?"":"disabled"}>Edit pool rules</button></div><div class="cp-settings-grid"><div><span>Scoring</span><b>${esc(cpScoringLabel(pool))}</b></div><div><span>Weekly picks</span><b>${esc(cpWeeklyRuleLabel(pool))}</b></div><div><span>Confidence</span><b>${esc(cpConfidenceRuleLabel(pool))}</b></div><div><span>Dropped weeks</span><b>${esc(cpDropRuleLabel(pool))}</b></div><div><span>Lock mode</span><b>${pool.lockMode==="card"?"Full card":"From weekly sheet"}</b></div></div>${!editable?'<p class="note">Season rules are locked once a weekly slate/pick history exists. Create a new pool if the contest rules materially change.</p>':''}</div><div class="card"><h2>Entries</h2>${(pool.entries||[]).map(e=>`<div class="cp-setting-entry"><input value="${esc(e.name)}" data-cp-rename="${esc(e.id)}"><span class="sub">${(e.history||[]).length} submitted week${(e.history||[]).length===1?"":"s"}</span></div>`).join("")}<div class="row-f"><input id="cpNewEntryName" class="grow" placeholder="New entry name"><button class="btn btn-light" id="cpAddEntryBtn">+ Add entry</button></div></div><div class="card danger"><h2>Pool management</h2><button class="btn btn-danger" id="cpDeletePoolBtn">Delete confidence pool</button></div>`;
}
function renderConfidenceTab(){
  const mount=document.getElementById("confidenceMount"); if(!mount)return;
  if(cpWizard){renderConfidencePoolWizard(mount);return;}
  const pools=cpPools().filter(p=>!p.archived);
  if(!pools.length){mount.innerHTML=`<div class="card cp-confidence-empty"><div class="cp-empty-icon">🎯</div><h2>Confidence pools</h2><p class="sub">Set the contest rules once, import each week's sheet, then let PickGauge help build and rank the card.</p><button class="btn" id="cpStartWizardBtn">+ Create confidence pool</button></div>`;document.getElementById("cpStartWizardBtn").onclick=()=>cpStartPoolWizard();return;}
  const pool=cpActivePool(),entry=cpActiveEntry(pool),view=cpSubview(pool);
  mount.innerHTML=cpHeaderHTML(pool)+(view==="results"?cpResultsHTML(pool):view==="settings"?cpSettingsHTML(pool,entry):cpThisWeekHTML(pool,entry));
  wireConfidenceTab(pool,entry,view);
}

function wireConfidenceTab(pool,entry,view){
  document.getElementById("cpPoolSelect")?.addEventListener("change",e=>cpSetActivePool(e.target.value));
  document.getElementById("cpNewPoolBtn")?.addEventListener("click",()=>cpStartPoolWizard());
  document.querySelectorAll("[data-cp-view]").forEach(b=>b.onclick=()=>cpSetSubview(pool,b.dataset.cpView));
  const file=document.getElementById("cpWeeklyPdf"); if(file)file.onchange=()=>{if(file.files&&file.files[0])cpImportWeeklyPdf(pool,file.files[0]);};
  document.querySelectorAll("[data-cp-remove-game]").forEach(b=>b.onclick=()=>{if(cpIsCardLocked(pool))return;cpRemoveGameFromPool(pool,b.dataset.cpRemoveGame);renderConfidenceTab();});
  document.querySelectorAll("[data-cp-line-for]").forEach(inp=>inp.onchange=()=>{if(cpIsCardLocked(pool))return;cpSetGameLine(pool,inp.dataset.cpLineFor,inp.value);renderConfidenceTab();});
  const saveGames=document.getElementById("cpSaveGamesBtn");if(saveGames)saveGames.onclick=()=>{document.querySelectorAll("[data-cp-board-check]:checked").forEach(cb=>{
    // Read the line from the editable pre-add input if the person typed
    // a correction into it (matching the real Splash sheet's printed
    // number, which can differ from the live market) -- fall back to the
    // checkbox's own original live-line dataset only if no edit field
    // exists for this row (non-ATS pools) or it was left untouched.
    const rowKey=cb.dataset.cpRowKey;
    const lineInput=rowKey?document.querySelector(`[data-cp-line-edit-for="${CSS.escape(rowKey)}"]`):null;
    const line=lineInput?(lineInput.value!==""?Number(lineInput.value):null):(cb.dataset.cpLine!==""?Number(cb.dataset.cpLine):null);
    cpAddGameToPool(pool,{away:cb.dataset.cpAway,home:cb.dataset.cpHome,commence:cb.dataset.cpCommence||null,providerGameId:cb.dataset.cpProvider||null,line});
  });cpManualCustomGames.forEach(g=>cpAddGameToPool(pool,g));cpManualCustomGames=[];renderConfidenceTab();};
  const addCustom=document.getElementById("cpAddCustomBtn");if(addCustom)addCustom.onclick=async()=>{const away=(document.getElementById("cpCustomAway").value||"").trim(),home=(document.getElementById("cpCustomHome").value||"").trim(),lineEl=document.getElementById("cpCustomLine"),raw=lineEl?lineEl.value:"";if(!away||!home){await pgAlert({title:"Missing team names",message:"Enter both teams."});return;}cpManualCustomGames.push({away,home,line:raw===""?null:Number(raw)});renderConfidenceTab();};
  document.querySelectorAll("[data-cp-remove-custom]").forEach(b=>b.onclick=()=>{cpManualCustomGames.splice(Number(b.dataset.cpRemoveCustom),1);renderConfidenceTab();});
  document.querySelectorAll("[data-cp-entry]").forEach(b=>b.onclick=()=>cpSetActiveEntry(pool,b.dataset.cpEntry));
  document.getElementById("cpDuplicateEntryBtn")?.addEventListener("click",async()=>{const ok=await pgConfirm({title:"Duplicate this entry?",message:`Create a new entry with ${entry.name}'s current-week picks and rankings? Season history will not be copied.`});if(ok)cpDuplicateEntry(pool,entry);});
  if(entry){
    document.querySelectorAll("[data-cp-pick-team]").forEach(b=>b.onclick=async()=>{const r=cpSetPickSide(pool,entry,b.dataset.cpPickTeam,b.dataset.team);if(!r.ok)await pgAlert({title:"Can't change this pick",message:r.error});renderConfidenceTab();});
    document.querySelectorAll("[data-cp-move]").forEach(b=>b.onclick=()=>{cpMoveRank(pool,entry,b.dataset.key,Number(b.dataset.cpMove));renderConfidenceTab();});
    document.querySelectorAll("[data-cp-toggle-rank]").forEach(b=>b.onclick=async()=>{if(!cpToggleTopRank(pool,entry,b.dataset.cpToggleRank))await pgAlert({title:"Top confidence slots are full",message:`Remove another ranked pick before adding this one to your Top ${cpMaxPoints(pool)}.`});renderConfidenceTab();});
    let dragKey=null;document.querySelectorAll("[data-cp-rank-row][draggable=true]").forEach(r=>{r.ondragstart=e=>{dragKey=r.dataset.cpRankRow;e.dataTransfer.effectAllowed="move";};r.ondragover=e=>e.preventDefault();r.ondrop=e=>{e.preventDefault();if(dragKey&&dragKey!==r.dataset.cpRankRow){cpMoveRankTo(pool,entry,dragKey,r.dataset.cpRankRow);renderConfidenceTab();}};});
    document.getElementById("cpBuildRankingBtn")?.addEventListener("click",async()=>{const has=Object.values(entry.picks||{}).some(p=>p&&p.team);if(has){const ok=await pgConfirm({title:"Replace this card with PickGauge's suggestion?",message:"This will replace the current week's selected sides and confidence order for this entry. You can adjust everything afterward."});if(!ok)return;}const r=cpBuildSuggestedCard(pool,entry);if(!r.ok){await pgAlert({title:"Suggested ranking unavailable",message:r.error});return;}if(r.missing)await pgAlert({title:"Ranking partially built",message:`PickGauge filled ${r.picked} of ${r.required} required picks. ${r.missing} game(s) need a manual choice because the model is incomplete.`});renderConfidenceTab();});
    document.getElementById("cpSubmitCardBtn")?.addEventListener("click",async()=>{const ok=await pgConfirm({title:`Submit ${entry.name}'s ${pool.weekLabel}?`,message:`PickGauge will save a dated snapshot of this card. You can re-submit edits until ${pool.cardLockAt?kickStr(pool.cardLockAt):"the contest locks"}.`});if(!ok)return;const r=cpMarkCardSubmitted(pool,entry);if(!r.ok){await pgAlert({title:"Card isn't ready",message:r.errors.join("\n")});return;}renderConfidenceTab();});
    document.querySelectorAll("[data-cp-export]").forEach(b=>b.onclick=async()=>{const t=b.dataset.cpExport;if(t==="print")cpPrintCard(pool,entry);if(t==="copy"){await cpCopyCard(pool,entry);await pgAlert({title:"Copied",message:"Confidence card copied to your clipboard."});}if(t==="csv")cpExportCardCsv(pool,entry);});
  }
  document.getElementById("cpEditRulesBtn")?.addEventListener("click",()=>{if(cpCanEditRules(pool))cpStartPoolWizard(pool);});
  document.querySelectorAll("[data-cp-rename]").forEach(inp=>inp.onchange=()=>{const e=pool.entries.find(x=>x.id===inp.dataset.cpRename);if(e){cpRenameEntry(pool,e,inp.value);renderConfidenceTab();}});
  document.getElementById("cpAddEntryBtn")?.addEventListener("click",()=>{const el=document.getElementById("cpNewEntryName");cpAddEntry(pool,el&&el.value);});
  document.getElementById("cpDeletePoolBtn")?.addEventListener("click",async()=>{const ok=await pgConfirm({title:"Delete this confidence pool?",message:`${pool.name} and all confidence history will be permanently deleted.`});if(ok){state.confidencePools=state.confidencePools.filter(p=>p.id!==pool.id);if(state.confidenceActivePoolId===pool.id)state.confidenceActivePoolId=null;save();renderConfidenceTab();}});
}
