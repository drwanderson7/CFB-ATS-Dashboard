// --- Picks & entries -------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// making/clearing a pick (pickTeam()), the entry list UI (renderEntries(),
// renderEntrySelect()), the Compare view across a pool's entries
// (collectPickRecords()/clusterGames()/renderCompareTable()), and the My
// Picks entry-review workspace (pickedSideStats()/movePick()/
// renderPicksDetail()). Also holds snapClvCellData() -- Snapshot's Quick
// Look CLV column decision logic -- which lives here rather than in
// board.js because it's really about picks (picked vs. recommended side),
// not board/snapshot rendering per se.
//
// Loaded as a plain <script src="/app/js/picks.js"> tag, same as
// model.js/board.js -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as model.js/board.js's own header
// comments):
//   - `state`, `games` -- global app state and the current week's game
//     list (main inline script).
//   - `activeEntry()`/`activeEntries()`/`currentPool()`/`ctxActiveEntryId()`/
//     `setCtxActiveEntryId()`/`pickLimit()`/`allContexts()` -- pool/entry
//     context accessors (this file defines allContexts(), the rest are in
//     the main inline script).
//   - `myNumber()`/`edgeOf()`/`clvOf()`/`probabilityCoverForGame()`/
//     `round1()`/`bucketForSpread()` -- the composite probability model,
//     now in app/js/model.js.
//   - `esc()`/`fmt()`/`uid()`/`mkey()`/`norm()` -- general utilities (main
//     inline script).
//   - `save()`/`saveLocal()` -- persistence (main inline script).
//   - `renderBoard()`/`renderSnapshot()`/`updatePickCount()`/
//     `renderPickSummary()`/`switchTab()` -- cross-tab re-render calls
//     after a pick changes (app/js/board.js / main inline script).
//   - `resolveVegasLine()`/`liveLineFor()`/`teamMatch()` -- odds/matching
//     helpers (main inline script / app/js/model.js).
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
function entryWorkflowStatus(ent){
  const count=Object.keys((ent&&ent.picks)||{}).length;
  const limit=pickLimit();
  if(ent&&ent.submittedAt) return {code:"submitted",label:"Submitted",count,limit,submittedAt:ent.submittedAt};
  if(count>=limit) return {code:"ready",label:"Ready",count,limit,submittedAt:null};
  return {code:"draft",label:"Draft",count,limit,submittedAt:null};
}
function entryIsLocked(ent){ return !!(ent&&ent.submittedAt); }
function setEntrySubmitted(entryId,submitted){
  const ent=activeEntries().find(x=>x.id===entryId);
  if(!ent) return false;
  const status=entryWorkflowStatus(ent);
  if(submitted){
    if(status.count<status.limit) return false;
    ent.submittedAt=new Date().toISOString();
  }else{
    delete ent.submittedAt;
  }
  save();
  renderBoard(); renderEntries(); renderPicksDetail(); updatePickCount();
  if(submitted&&typeof trackBetaEvent==="function") trackBetaEvent("entry_submitted",{source:"button"});
  return true;
}

function pickTeam(key,side){
  const ent=activeEntry();
  const g=games.find(x=>x.key===key);
  if(!g) return;
  if(entryIsLocked(ent)) return;
  const existing=ent.picks[key];
  let madePick=false;
  if(existing && existing.side===side){
    delete ent.picks[key]; // clicking the already-picked side removes the pick
  }else{
    if(!existing && Object.keys(ent.picks).length>=pickLimit()) return; // only new picks are capped; switching sides is always allowed
    const team=side==="home"?g.home:g.away;
    const line=side==="home"?g.vegas:(g.vegas!=null?-g.vegas:null);
    // Freeze the decision context NOW, not when the week is archived. Model
    // inputs, weights, predictions and the market can all change later; a
    // historical Results page must describe what PickGauge knew when the
    // person actually made the pick.
    ent.picks[key]={
      side,team,line,matchup:g.away+" @ "+g.home,providerGameId:g.providerGameId||null,
      // Separate canonical CFBD identity from the Odds API provider ID. The
      // human-readable matchup remains for display/backward compatibility;
      // IDs are what future CFBD data joins should prefer.
      ...(typeof cfbdPickIdentity==="function"?cfbdPickIdentity(g,side):{}),
      ...pickDecisionSnapshot(g,side),
    };
    madePick=true;
  }
  if(madePick&&typeof trackBetaEvent==="function"){ trackBetaEvent("pick_set",{source:"button"}); trackBetaEvent("pick_ready"); }
  save(); renderBoard(); renderEntries(); renderPicksDetail();
}
function renderEntrySelect(){
  const opts=activeEntries().map(e=>`<option value="${e.id}" ${e.id===ctxActiveEntryId()?"selected":""}>${esc(e.name)}</option>`).join("");
  document.querySelectorAll(".entry-select").forEach(sel=>{
    sel.innerHTML=opts;
    sel.onchange=()=>{ setCtxActiveEntryId(sel.value); save(); syncAll(); };
  });
}
// Edge/Cover % from the PICKED side's own perspective -- deliberately NOT
// the same as edgeOf(g)/probabilityCoverForGame(M,V), which always report
// whichever side the model currently favors. If the market moved since a
// pick was made, or someone picked against what the model favors, those
// can silently diverge from what was actually picked. Returns null if the
// game has no live model number (off-board or no inputs).
// Decides what Snapshot's Quick Look CLV column should show for one game
// -- separated from the HTML-building code so this decision is
// independently testable. Returns {kind:"none"|"raw"|"pick"|"recommended",
// value:number|null}.
//
// Three states, in priority order:
//   1. picked -> "pick": pick-specific CLV, oriented to the side actually
//      picked (clvOf's own forPick math, unchanged from before).
//   2. not picked but the model has a lean (recommendedSide) -> "recommended":
//      SAME oriented/colorable math as "pick", just against the side the
//      board is currently recommending instead of one actually taken. This
//      used to fall through to raw home-perspective for every unpicked
//      game, which meant the compact Quick Look column showed a number the
//      user had to mentally re-sign against whichever side they'd consider
//      picking -- while the SAME row's expandable detail panel already did
//      this translation via clvOf(g, e.side). Quick Look now matches what
//      one click away already showed.
//   3. no pick AND no lean at all (e.g. edgeOf() returned side:null because
//      model===market) -> "raw": falls back to the old unsigned
//      home-perspective market move, since there's no side to orient it to.
function snapClvCellData(g,pickedSide,recommendedSide){
  if(pickedSide){
    const c=clvOf(g,pickedSide);
    if(!c) return {kind:"none",value:null};
    return {kind:"pick",value:c.forPick};
  }
  if(recommendedSide){
    const c=clvOf(g,recommendedSide);
    if(!c) return {kind:"none",value:null};
    return {kind:"recommended",value:c.forPick};
  }
  const c=clvOf(g,null);
  if(!c) return {kind:"none",value:null};
  return {kind:"raw",value:c.raw};
}
function pickedSideStats(live,pickedSide){
  if(!live) return null;
  const M=myNumber(live);
  const V=live.vegas;
  if(M==null||V==null) return null;
  const modelSide=M<V?"home":(M>V?"away":null);
  const edgePts=round1(pickedSide==="home"?(V-M):(M-V));
  const prob=probabilityCoverForGame(M,V);
  let coverPct=null;
  if(prob&&modelSide){
    coverPct=(pickedSide===modelSide)?prob.pCover:prob.pLoss;
  }
  return {edgePts,coverPct};
}
// Immutable analytics captured with each pick. All line/model values use the
// app's normal home-line convention internally; pick.line remains the chosen
// team's own spread for grading/display. Old picks simply won't have these
// fields, which is intentional backward compatibility rather than fabricated
// history.
function pickDecisionSnapshot(g,pickedSide){
  const M=myNumber(g);
  const V=g&&g.vegas!=null?Number(g.vegas):null;
  const enabled=Array.isArray(state.enabledSystems)?[...state.enabledSystems]:[];
  const core=inputsFor(g.key)||[];
  const preds=predsFor(g.key)||{};
  const modelInputs={};
  const weights={};

  const pgActive=(typeof isPickGaugeModelActive==="function"&&isPickGaugeModelActive());
  if(pgActive){
    // Freeze the internal source VALUES used by this PickGauge decision, but
    // do not copy the proprietary numeric recipe into user-exportable pick
    // state. modelPresetAtPick + modelVersion identify the formula version.
    const pgVals=pickGaugeModelValues(g)||{};
    PICKGAUGE_MODEL_PRESET.systems.forEach(code=>{
      const v=pgVals[code];
      modelInputs[code]=(v!=null&&v!==""&&!isNaN(v))?Number(v):null;
    });
    modelInputs.vegas=(pgVals.vegas!=null&&!isNaN(pgVals.vegas))?Number(pgVals.vegas):null;
  }else{
    if(enabled.includes("bp")){
      modelInputs.bp=(core[0]!=null&&core[0]!==""&&!isNaN(core[0]))?Number(core[0]):null;
      weights.bp=weightOf("bp");
    }
    if(enabled.includes("comp")){
      modelInputs.comp=(core[1]!=null&&core[1]!==""&&!isNaN(core[1]))?Number(core[1]):null;
      weights.comp=weightOf("comp");
    }
    enabledSystemsOrdered().forEach(code=>{
      const v=preds[code];
      modelInputs[code]=(v!=null&&v!==""&&!isNaN(v))?Number(v):null;
      weights[code]=weightOf(code);
    });
    // Vegas is structurally present in custom weightedModel() even when its
    // weight is 0, so freeze its current effective value and weight.
    modelInputs.vegas=V;
    weights.vegas=weightOf("vegas");
  }

  let rawEdge=null, pickedEdge=null, coverProbability=null, ev=null;
  let recommendedSide=null, recommendedTeam=null, keyNumbers=[], keyTier="none", keyScore=0;
  const agreement=(typeof modelAgreement==="function")?modelAgreement(g,pickedSide):null;
  if(M!=null&&V!=null){
    const e=edgeOf(g);
    rawEdge=e?e.pts:null;
    recommendedSide=e?e.side:null;
    recommendedTeam=e?e.team:null;
    keyNumbers=e&&Array.isArray(e.keyNumbers)?[...e.keyNumbers]:[];
    keyTier=e&&e.keyTier?e.keyTier:"none";
    keyScore=e&&e.keyScore!=null?e.keyScore:0;
    pickedEdge=round1(pickedSide==="home"?(V-M):(M-V));

    const prob=probabilityCoverForGame(M,V);
    if(prob&&recommendedSide){
      const withModel=pickedSide===recommendedSide;
      const pickedCover=withModel?prob.pCover:prob.pLoss;
      const pickedLoss=withModel?prob.pLoss:prob.pCover;
      coverProbability=pickedCover;
      ev=pickedCover*0.9091-pickedLoss; // pushes contribute 0, same convention as model.js
    }
  }

  return {
    pickedAt:new Date().toISOString(),
    modelVersion:(typeof MODEL_VERSION!=="undefined"?MODEL_VERSION:null),
    modelPresetAtPick:(typeof isPickGaugeModelActive==="function"&&isPickGaugeModelActive())?"pickgauge":null,
    // Store the market preference used for this decision so later CLV uses
    // the SAME reference book/consensus even if Settings changes afterward.
    bookAtPick:(state.book||"consensus"),
    marketObservedAtPick:(state.lastRefresh||null),
    marketHomeLineAtPick:V,
    modelNumberAtPick:M,
    rawEdgeAtPick:rawEdge,
    pickedEdgeAtPick:pickedEdge,
    coverProbabilityAtPick:coverProbability,
    evAtPick:ev,
    recommendedSideAtPick:recommendedSide,
    recommendedTeamAtPick:recommendedTeam,
    keyNumbersAtPick:keyNumbers,
    keyTierAtPick:keyTier,
    keyScoreAtPick:keyScore,
    modelAgreementAtPick:agreement?{side:agreement.side,agree:agreement.agree,oppose:agreement.oppose,neutral:agreement.neutral,total:agreement.total,pct:agreement.pct}:null,
    enabledSystemsAtPick:pgActive?["pickgauge"]:enabled,
    modelInputsAtPick:modelInputs,
    modelWeightsAtPick:weights,
  };
}
function renderEntries(){
  const wrap=document.getElementById("entryList");
  wrap.innerHTML=activeEntries().map(e=>{
    const st=entryWorkflowStatus(e);
    const cnt=st.count;
    const act=e.id===ctxActiveEntryId();
    const submitAction=st.code==="submitted"
      ? `<button class="iconbtn entry-unlock" data-unsubmit="${e.id}" title="Unlock this entry to edit its picks again">Unlock</button>`
      : `<button class="iconbtn entry-submit" data-submit="${e.id}" ${st.code!=="ready"?"disabled":""} title="${st.code==="ready"?"Lock this entry after submitting it to your pool":"Fill all required picks before marking submitted"}">Mark submitted</button>`;
    // Same submission timestamp renderPicksDetail() already shows in its
    // fuller entry cards -- this simpler switcher list previously had the
    // Submitted status label with no "when", so it disagreed with the
    // detail view on how much a person could tell at a glance here.
    const submittedMeta=st.code==="submitted"&&st.submittedAt
      ? ` · ${new Date(st.submittedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:"";
    return `<div class="entry ${act?"activeE":""}">
      <span class="nm">${esc(e.name)}</span>
      <span class="entry-status entry-status-${st.code}">${st.label}${submittedMeta}</span>
      <span class="cnt">${cnt}/${st.limit} picks selected</span>
      <button class="iconbtn" data-use="${e.id}">${act?"picking ✓":"pick for this"}</button>
      ${submitAction}
      <button class="iconbtn" data-ren="${e.id}">rename</button>
      <button class="iconbtn" data-del="${e.id}" ${activeEntries().length<=1?"disabled":""}>delete</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>{setCtxActiveEntryId(b.dataset.use);save();syncAll();});
  wrap.querySelectorAll("[data-submit]").forEach(b=>b.onclick=()=>setEntrySubmitted(b.dataset.submit,true));
  wrap.querySelectorAll("[data-unsubmit]").forEach(b=>b.onclick=async()=>{
    if(await pgConfirm({title:"Unlock submitted entry?",message:"You will be able to change its picks again.",confirmText:"Unlock entry"})) setEntrySubmitted(b.dataset.unsubmit,false);
  });
  wrap.querySelectorAll("[data-ren]").forEach(b=>b.onclick=async()=>{
    const e=activeEntries().find(x=>x.id===b.dataset.ren);
    if(!e) return;
    const nm=await pgPrompt({title:"Rename entry",label:"Entry name",value:e.name,confirmText:"Save name"});
    if(nm!==null&&nm.trim()){ e.name=nm.trim(); save(); syncAll(); }
  });
  wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{
    if(activeEntries().length<=1) return;
    if(!await pgConfirm({title:"Delete entry?",message:"Delete this entry and all of its picks? This can't be undone.",confirmText:"Delete entry",danger:true})) return;
    const _f=activeEntries().filter(x=>x.id!==b.dataset.del);
    const _p=currentPool(); if(_p) _p.entries=_f; else state.entries=_f;
    if(ctxActiveEntryId()===b.dataset.del) setCtxActiveEntryId(_f[0].id);
    save();syncAll();
  });
}
// ---- cross-pool pick comparison (My Picks tab) ---------------------------
// Every context (Overall + each pool) derives its game keys from its OWN team
// name spellings (Overall from the Odds API, a pool from its own sheet), so
// the same real-world game has a different key in each context. Rows here are
// grouped by team-name matching (teamMatchTrunc), not key equality.
function allContexts(){
  const list=[{id:"overall",label:"Overall",entries:state.entries}];
  (state.pools||[]).forEach(p=>list.push({id:p.id,label:p.name,entries:p.entries}));
  return list;
}
// Seeds any published pool template this user doesn't already have locally. Only
// ADDS -- never overwrites an existing local pool with the same id, so if
// someone's already made picks against it, a later shared-pool update from
// Drew can't clobber their entries. Each person gets their own fresh
// Entry 1/picks on first sight of a shared pool, same as a normal import.
function mergeSharedPoolsIntoLocal(){
  let changed=false;
  const declined=new Set(state.declinedSharedPools||[]);
  (state.sharedPools||[]).forEach(sp=>{
    if((state.pools||[]).some(p=>p.id===sp.id)) return;
    if(declined.has(sp.id)) return; // this account already deleted it once -- don't bring it back
    state.pools.push({
      id:sp.id, name:sp.name, weekLabel:sp.weekLabel, pickLimit:sp.pickLimit||7,
      games:sp.games||[], activeEntryId:null,
      entries:[{id:uid(),name:"Entry 1",picks:{}}],
      history:[],
    });
    changed=true;
  });
  if(changed) saveLocal();
  return changed;
}
// Publishes a pool's STRUCTURE (games/locked lines/name/settings) as a
// one-time shared template -- never entries or picks. Re-publishing updates
// the catalog copy, but existing local copies elsewhere are intentionally
// untouched (see mergeSharedPoolsIntoLocal's guard above).
// Returns {ok, error} rather than a plain boolean now that a 403 (not an
// admin) is an EXPECTED, common outcome for most users of this feature,
// not just an edge case worth logging and silently reverting the button
// on -- the caller needs the real message to actually show the person
// why nothing happened.
async function pushPoolToShared(poolId){
  const p=(state.pools||[]).find(x=>x.id===poolId);
  if(!p) return {ok:false, error:"That pool couldn't be found."};
  const structure={id:p.id, name:p.name, weekLabel:p.weekLabel, pickLimit:p.pickLimit||7, games:p.games||[], publishedAt:new Date().toISOString()};
  try{
    const result=await apiFetch('/api/state?action=publish_pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(structure)});
    if(!result.ok){
      // A 403 (not an admin, or someone else owns this pool id) and a 409
      // (publish race) are genuinely different problems from an expired
      // session -- still worth telling apart in the console, but now also
      // handed back to the caller so the person actually sees why.
      console.warn('pushPoolToShared failed —',result.kind,result.error);
      return {ok:false, error:result.error};
    }
  }catch(e){ return {ok:false, error:"Couldn't reach the server — check your connection."}; }
  await pullTier("shared",true); // adopt the server's own merged sharedPools list
  return {ok:true, error:null};
}
async function unpublishPoolTemplate(poolId){
  if(!poolId) return {ok:false,error:"That pool couldn't be found."};
  try{
    const result=await apiFetch('/api/state?action=unpublish_pool',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:poolId})});
    if(!result.ok){
      console.warn('unpublishPoolTemplate failed —',result.kind,result.error);
      return {ok:false,error:result.error};
    }
  }catch(e){ return {ok:false,error:"Couldn't reach the server — check your connection."}; }
  await pullTier("shared",true);
  return {ok:true,error:null};
}
function collectPickRecords(){
  const out=[];
  allContexts().forEach(ctx=>{
    ctx.entries.forEach(ent=>{
      Object.entries(ent.picks).forEach(([k,p])=>{
        const m=(p.matchup||k).split(" @ ");
        if(m.length!==2) return;
        out.push({contextId:ctx.id, contextLabel:ctx.label, entryId:ent.id, entryName:ent.name,
                   away:m[0], home:m[1], team:p.team||"", line:p.line, key:k});
      });
    });
  });
  return out;
}
// Group pick records into one row per real-world game.
function clusterGames(records){
  const clusters=[];
  records.forEach(r=>{
    let c=clusters.find(cl=>teamMatchTrunc(r.away,cl.away)&&teamMatchTrunc(r.home,cl.home));
    if(!c){ c={away:r.away,home:r.home,records:[]}; clusters.push(c); }
    c.records.push(r);
  });
  clusters.sort((a,b)=>(a.away+a.home).localeCompare(b.away+b.home));
  return clusters;
}
// Columns for Compare Picks: one per context+entry that actually HAS at
// least one saved pick. An empty entry (a pool/Overall you haven't touched
// yet, or a second entry you created but haven't picked in) is left out
// entirely rather than showing as a dead column of dashes -- both on
// screen and in the exported image/PDF, since they share this same column
// list. entriesPerContext is recomputed AFTER filtering, so a pool that
// had two entries but only one with real picks correctly drops back to a
// single, unlabeled column instead of still showing an "Entry 1" subheader
// for a column that's the only one left in its pool.
function pgCompareColumns(records){
  const cols=[];
  allContexts().forEach(ctx=>{
    ctx.entries.forEach(ent=>{
      const hasPicks=records.some(r=>r.contextId===ctx.id&&r.entryId===ent.id);
      if(!hasPicks) return;
      cols.push({contextId:ctx.id,contextLabel:ctx.label,entryId:ent.id,entryName:ent.name});
    });
  });
  const entriesPerContext={};
  cols.forEach(c=>{ entriesPerContext[c.contextId]=(entriesPerContext[c.contextId]||0)+1; });
  return {cols,entriesPerContext};
}
function renderCompareTable(){
  const card=document.getElementById("compareCard");
  const table=document.getElementById("compareTable");
  if(!card||!table) return;
  const records=collectPickRecords();
  const {cols,entriesPerContext}=pgCompareColumns(records);

  if(cols.length<2){ card.style.display="none"; return; }
  card.style.display="";
  const meta=document.getElementById("compareMetaLine");

  const clusters=clusterGames(records);
  if(meta) meta.textContent=`${clusters.length} game(s) · ${cols.length} entr${cols.length===1?"y":"ies"}`;

  const thead=table.querySelector("thead"), tbody=table.querySelector("tbody");
  thead.innerHTML=`<tr><th class="l">Game</th>`+cols.map(c=>
    `<th>${esc(c.contextLabel)}${entriesPerContext[c.contextId]>1?`<br><span class="mono-sm" style="font-weight:400;color:var(--muted);">${esc(c.entryName)}</span>`:""}</th>`
  ).join("")+`</tr>`;

  tbody.innerHTML=clusters.map(cl=>{
    // Agreement groups within this row: cells whose picked team matches
    // (teamMatchTrunc) get the same highlight so shared picks jump out visually.
    const groups=[]; // [{team, cells:[colIndex,...]}]
    const cellRec=cols.map(c=>cl.records.find(r=>r.contextId===c.contextId&&r.entryId===c.entryId)||null);
    cellRec.forEach((r,i)=>{
      if(!r) return;
      let g=groups.find(gr=>teamMatchTrunc(gr.team,r.team));
      if(!g){ g={team:r.team,cells:[]}; groups.push(g); }
      g.cells.push(i);
    });
    const agreeIdx=new Set(groups.filter(g=>g.cells.length>1).flatMap(g=>g.cells));
    const cells=cellRec.map((r,i)=>{
      if(!r) return `<td class="cmp-empty">—</td>`;
      const cls=agreeIdx.has(i)?"cmp-agree":"";
      return `<td class="${cls}">${esc(r.team)}${r.line!=null?" "+fmt(r.line):""}</td>`;
    }).join("");
    return `<tr><td class="l">${esc(cl.away)} @ ${esc(cl.home)}</td>${cells}</tr>`;
  }).join("");
}

// --- Compare Picks export (image / PDF) ------------------------------------
// A flat, branded snapshot of the current Compare Picks table -- same visual
// language as the Survivor share cards (snapshotDrawBrand/
// snapshotDrawRoundRect/snapshotLoadImage, from snapshot-export.js, loaded
// before this file). Built primarily for phone use: one image (or PDF of
// that same image) a person can save/share without needing the on-screen
// table's horizontal scroll. Column width shrinks as entries are added, with
// a readable floor; past that floor the canvas grows wider instead of the
// text becoming unreadable -- there's still no on-screen scrolling because
// it's a single flat picture, not a live scrollable table.
function pgCompareShortTeam(name){
  return typeof snapshotExportTeamShort==="function" ? snapshotExportTeamShort(name) : String(name||"");
}
function pgCompareFitText(ctx,text,maxWidth){
  if(ctx.measureText(text).width<=maxWidth) return text;
  let t=String(text);
  while(t.length>1 && ctx.measureText(t+"…").width>maxWidth) t=t.slice(0,-1);
  return t+"…";
}
function pgCompareCellLabel(ctx,team,line,maxWidth){
  const full=`${team}${line!=null?" "+fmt(line):""}`;
  if(ctx.measureText(full).width<=maxWidth) return full;
  const short=`${pgCompareShortTeam(team)}${line!=null?" "+fmt(line):""}`;
  if(ctx.measureText(short).width<=maxWidth) return short;
  return pgCompareFitText(ctx,short,maxWidth);
}
function pgCompareGameLabel(ctx,away,home,maxWidth){
  const full=`${away} @ ${home}`;
  if(ctx.measureText(full).width<=maxWidth) return full;
  const short=`${pgCompareShortTeam(away)} @ ${pgCompareShortTeam(home)}`;
  if(ctx.measureText(short).width<=maxWidth) return short;
  return pgCompareFitText(ctx,short,maxWidth);
}
async function pgCompareBuildCardCanvas(){
  const records=collectPickRecords();
  const {cols,entriesPerContext}=pgCompareColumns(records);
  if(cols.length<2) throw new Error("Add at least two entries first — Compare Picks needs two or more to show anything.");
  const clusters=clusterGames(records);
  if(!clusters.length) throw new Error("No picks saved yet — nothing to export.");

  if(document.fonts&&document.fonts.ready){ try{ await document.fonts.ready; }catch(e){} }

  const PAD=40, GAME_COL=220, TARGET_W=1200, MIN_COL=104;
  let colW=(TARGET_W-PAD*2-GAME_COL)/cols.length;
  let W;
  if(colW<MIN_COL){ colW=MIN_COL; W=Math.round(PAD*2+GAME_COL+colW*cols.length); }
  else { W=TARGET_W; }

  const twoLineHeader=cols.some(c=>entriesPerContext[c.contextId]>1);
  const headerH=twoLineHeader?70:52;
  const rowH=44;
  const tableY=176;
  const tableW=W-PAD*2;
  const H=tableY+headerH+rowH*clusters.length+68;

  const canvas=document.createElement("canvas");
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext("2d");
  if(!ctx) throw new Error("Canvas not supported.");

  ctx.fillStyle="#F7FAF8"; ctx.fillRect(0,0,W,H);
  ctx.fillStyle="#16A34A"; ctx.fillRect(0,0,W,8);

  const icon=typeof snapshotLoadImage==="function" ? await snapshotLoadImage("/icon-96.png") : null;
  if(typeof snapshotDrawBrand==="function") snapshotDrawBrand(ctx,icon,W);

  ctx.textAlign="center"; ctx.fillStyle="#111827"; ctx.font="900 27px Inter,Arial,sans-serif";
  ctx.fillText("COMPARE PICKS",W/2,124);
  ctx.fillStyle="#64748B"; ctx.font="700 13px Inter,Arial,sans-serif";
  ctx.fillText(`${clusters.length} game${clusters.length===1?"":"s"} · ${cols.length} entr${cols.length===1?"y":"ies"}`,W/2,146);

  const tableX=PAD;
  if(typeof snapshotDrawRoundRect==="function") snapshotDrawRoundRect(ctx,tableX,tableY,tableW,headerH+rowH*clusters.length,14,"#FFFFFF","#DDE5E0");

  ctx.save();
  ctx.beginPath(); ctx.rect(tableX,tableY,tableW,headerH+rowH*clusters.length); ctx.clip();

  // Header
  ctx.fillStyle="#F1F5F2"; ctx.fillRect(tableX,tableY,tableW,headerH);
  ctx.strokeStyle="#DDE5E0"; ctx.beginPath(); ctx.moveTo(tableX,tableY+headerH); ctx.lineTo(tableX+tableW,tableY+headerH); ctx.stroke();
  ctx.textAlign="left"; ctx.fillStyle="#374151"; ctx.font="800 13px Inter,Arial,sans-serif";
  ctx.fillText("GAME",tableX+16,tableY+headerH/2+5);
  cols.forEach((c,i)=>{
    const cx=tableX+GAME_COL+colW*i;
    ctx.textAlign="center"; ctx.font="800 12px Inter,Arial,sans-serif";
    const label=pgCompareFitText(ctx,c.contextLabel.toUpperCase(),colW-12);
    ctx.fillStyle="#374151";
    ctx.fillText(label,cx+colW/2,tableY+(entriesPerContext[c.contextId]>1?27:headerH/2+5));
    if(entriesPerContext[c.contextId]>1){
      ctx.font="700 11px Inter,Arial,sans-serif"; ctx.fillStyle="#94A3B8";
      ctx.fillText(pgCompareFitText(ctx,c.entryName,colW-12),cx+colW/2,tableY+47);
    }
  });

  // Column separators
  ctx.strokeStyle="#EEF2F0";
  for(let i=0;i<=cols.length;i++){
    const x=tableX+GAME_COL+colW*i;
    ctx.beginPath(); ctx.moveTo(x,tableY); ctx.lineTo(x,tableY+headerH+rowH*clusters.length); ctx.stroke();
  }

  // Rows
  clusters.forEach((cl,rIdx)=>{
    const y=tableY+headerH+rowH*rIdx;
    if(rIdx%2===1){ ctx.fillStyle="#FBFBF8"; ctx.fillRect(tableX,y,tableW,rowH); }
    ctx.strokeStyle="#EEF2F0"; ctx.beginPath(); ctx.moveTo(tableX,y+rowH); ctx.lineTo(tableX+tableW,y+rowH); ctx.stroke();

    const cellRec=cols.map(c=>cl.records.find(r=>r.contextId===c.contextId&&r.entryId===c.entryId)||null);
    const groups=[];
    cellRec.forEach((r,i)=>{
      if(!r) return;
      let g=groups.find(gr=>teamMatchTrunc(gr.team,r.team));
      if(!g){ g={team:r.team,cells:[]}; groups.push(g); }
      g.cells.push(i);
    });
    const agreeIdx=new Set(groups.filter(g=>g.cells.length>1).flatMap(g=>g.cells));

    ctx.textAlign="left"; ctx.fillStyle="#111827"; ctx.font="700 13px Inter,Arial,sans-serif";
    ctx.fillText(pgCompareGameLabel(ctx,cl.away,cl.home,GAME_COL-28),tableX+16,y+rowH/2+5);

    cellRec.forEach((r,i)=>{
      const cx=tableX+GAME_COL+colW*i;
      if(agreeIdx.has(i)){ ctx.fillStyle="#EAF7EE"; ctx.fillRect(cx+2,y+3,colW-4,rowH-6); }
      ctx.textAlign="center";
      if(!r){ ctx.fillStyle="#CBD5E1"; ctx.font="700 15px Inter,Arial,sans-serif"; ctx.fillText("—",cx+colW/2,y+rowH/2+5); return; }
      ctx.font="800 13px Inter,Arial,sans-serif";
      const label=pgCompareCellLabel(ctx,r.team,r.line,colW-10);
      ctx.fillStyle=agreeIdx.has(i)?"#166534":"#111827";
      ctx.fillText(label,cx+colW/2,y+rowH/2+5);
    });
  });
  ctx.restore();

  ctx.textAlign="left"; ctx.fillStyle="#111827"; ctx.font="800 14px Inter,Arial,sans-serif";
  ctx.fillText("pickgauge.com",PAD,H-26);
  ctx.textAlign="right"; ctx.fillStyle="#64748B"; ctx.font="500 12px Inter,Arial,sans-serif";
  ctx.fillText("Highlighted = entries agree · picks may change before lock",W-PAD,H-26);

  return canvas;
}
function pgCompareDownloadBlob(blob,filename){
  const url=URL.createObjectURL(blob), a=document.createElement("a");
  a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function pgCompareFilename(ext){
  const stamp=new Date().toISOString().slice(0,10);
  return `pickgauge_compare_picks_${stamp}.${ext}`;
}
async function pgCompareExportImage(button){
  const original=button?.textContent||"";
  if(button){ button.disabled=true; button.textContent="Preparing…"; }
  try{
    const canvas=await pgCompareBuildCardCanvas();
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("Image export failed.")),"image/png"));
    pgCompareDownloadBlob(blob,pgCompareFilename("png"));
    if(button){ button.textContent="Saved ✓"; button.disabled=false; setTimeout(()=>{ if(button.textContent==="Saved ✓") button.textContent=original; },1500); return; }
  }catch(err){
    console.error("Compare Picks image export failed",err);
    if(typeof pgAlert==="function") await pgAlert({title:"Export failed",message:err?.message||"Compare Picks image could not be created."});
  }
  if(button){ button.disabled=false; button.textContent=original; }
}
// Minimal single-page, single-image PDF -- no external library. Chrome's
// canvas.toBlob('image/jpeg') already produces a standard baseline JPEG, so
// it can be embedded directly as a /DCTDecode XObject stream rather than
// needing a zlib/deflate implementation (which a PNG-based PDF would
// require and this project has no dependency for). This is the same
// technique jsPDF's own addImage('JPEG', ...) uses internally -- just
// written by hand here to avoid pulling in a CDN dependency that the site's
// CSP (script-src 'self' + Clerk only) doesn't currently allow.
async function pgBuildImagePdfBlob(canvas){
  const jpegBlob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error("PDF image export failed.")),"image/jpeg",0.92));
  const jpegBytes=new Uint8Array(await jpegBlob.arrayBuffer());
  const W=canvas.width, H=canvas.height;
  const enc=new TextEncoder();
  const chunks=[]; let offset=0; const objOffsets={};
  function write(part){ const bytes=typeof part==="string"?enc.encode(part):part; chunks.push(bytes); offset+=bytes.length; }
  function beginObj(num){ objOffsets[num]=offset; write(`${num} 0 obj\n`); }

  write("%PDF-1.4\n");
  beginObj(1); write("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  beginObj(2); write("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  beginObj(3); write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`);
  beginObj(4);
  write(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`);
  write(jpegBytes);
  write("\nendstream\nendobj\n");
  const content=`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`;
  beginObj(5); write(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

  const xrefOffset=offset, objCount=6;
  let xref=`xref\n0 ${objCount}\n0000000000 65535 f\r\n`;
  for(let i=1;i<objCount;i++) xref+=`${String(objOffsets[i]).padStart(10,"0")} 00000 n\r\n`;
  write(xref);
  write(`trailer\n<< /Size ${objCount} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return new Blob(chunks,{type:"application/pdf"});
}
async function pgCompareExportPdf(button){
  const original=button?.textContent||"";
  if(button){ button.disabled=true; button.textContent="Preparing…"; }
  try{
    const canvas=await pgCompareBuildCardCanvas();
    const blob=await pgBuildImagePdfBlob(canvas);
    pgCompareDownloadBlob(blob,pgCompareFilename("pdf"));
    if(button){ button.textContent="Saved ✓"; button.disabled=false; setTimeout(()=>{ if(button.textContent==="Saved ✓") button.textContent=original; },1500); return; }
  }catch(err){
    console.error("Compare Picks PDF export failed",err);
    if(typeof pgAlert==="function") await pgAlert({title:"Export failed",message:err?.message||"Compare Picks PDF could not be created."});
  }
  if(button){ button.disabled=false; button.textContent=original; }
}

// Reorders one entry's picks by rebuilding the object with new key
// insertion order -- picks are stored as {key: {...}}, not an array, but
// JS objects preserve string-key insertion order (ES2015+), and
// Object.entries(e.picks) already relies on that same guarantee
// elsewhere in this file. No new schema field needed to support reorder.
function movePick(entryId,key,dir){
  const ent=activeEntries().find(x=>x.id===entryId);
  if(!ent||entryIsLocked(ent)) return;
  const keys=Object.keys(ent.picks);
  const i=keys.indexOf(key);
  const j=i+dir;
  if(i<0||j<0||j>=keys.length) return;
  [keys[i],keys[j]]=[keys[j],keys[i]];
  const reordered={};
  keys.forEach(k=>{ reordered[k]=ent.picks[k]; });
  ent.picks=reordered;
  save(); renderPicksDetail();
}
function renderPicksDetail(){
  const wrap=document.getElementById("picksDetail");
  const pool=currentPool();
  wrap.innerHTML=activeEntries().map(e=>{
    const entries=Object.entries(e.picks);
    const limit=pickLimit();
    const complete=entries.length>=limit;
    const workflow=entryWorkflowStatus(e);
    const submitted=workflow.code==="submitted";

    // Row-level data + entry-wide warnings, computed from real numbers
    // only -- no fabricated heuristics like "too many favorites."
    const warnings=[];
    const rows=entries.map(([k,p],idx)=>{
      const live=games.find(x=>x.key===k);
      const offBoard=!live;
      const line=live?liveLineFor(live,p.side):p.line;
      const stats=pickedSideStats(live,p.side);
      let clvHTML="";
      if(pool&&live&&live.lockedLine!=null){
        const c=clvOf(live,p.side);
        if(c&&c.forPick!=null){
          clvHTML=`<span class="pr-clv ${c.forPick>0?'clv-good':c.forPick<0?'clv-bad':'clv-even'}">CLV ${fmt(c.forPick)}</span>`;
          if(c.forPick<-1) warnings.push(`${p.team} moved ${fmt(Math.abs(c.forPick))} pts against you since the pool line locked`);
        }
      }
      if(offBoard) warnings.push(`${p.team} is no longer on the board (line removed or week changed)`);
      else if(stats==null) warnings.push(`${p.team} has no model inputs loaded yet`);
      else if(stats.edgePts<Number(state.goodThresh)) warnings.push(`${p.team} has only ${fmt(stats.edgePts)} edge`);
      const statsHTML=stats?`<span class="pr-stat">Edge <b class="${stats.edgePts>=0?'pos':'neg'}">${fmt(stats.edgePts)}</b></span><span class="pr-stat">Cover <b>${stats.coverPct!=null?(stats.coverPct*100).toFixed(1)+'%':'—'}</b></span>`:'';
      const gameStatusHTML=(typeof cfbdPickStatusHTML==="function")?cfbdPickStatusHTML(p,live):"";
      return `<div class="pr-row">
        <span class="pr-num">${idx+1}</span>
        <div class="pr-main">
          <div class="pr-team">${esc(p.team||"")} ${line!=null?fmt(line):""}${offBoard?' <span class="offboard">not on board</span>':''}</div>
          <div class="pr-matchup">${esc(p.matchup||k)}</div>
        </div>
        <div class="pr-stats">${statsHTML}${clvHTML}${gameStatusHTML}</div>
        <div class="pr-actions">
          <button class="iconbtn" data-move="${idx>0?e.id+'|'+k+'|-1':''}" ${(submitted||idx===0)?'disabled':''} title="Move up">↑</button>
          <button class="iconbtn" data-move="${idx<entries.length-1?e.id+'|'+k+'|1':''}" ${(submitted||idx===entries.length-1)?'disabled':''} title="Move down">↓</button>
          ${live?`<button class="iconbtn" data-openm="${esc(k)}" title="Open on full board">⤢</button>`:''}
          <button class="iconbtn rm" data-rment="${e.id}" data-rmkey="${esc(k)}" ${submitted?'disabled':''} title="${submitted?'Unlock the entry before removing picks':'Remove this pick'}">✕</button>
        </div>
      </div>`;
    }).join("");

    const rowsOrEmpty=entries.length?rows:`<p class="note" style="margin:6px 0 0;">No picks yet. Select a team from Snapshot or Pick Board → This Week while this entry is active.</p>`;

    const workflowAction=submitted
      ? `<button class="iconbtn entry-unlock" data-unsubmit="${e.id}">Unlock entry</button>`
      : `<button class="iconbtn entry-submit" data-submit="${e.id}" ${complete?'':'disabled'}>Mark submitted</button>`;
    const submittedMeta=submitted&&e.submittedAt
      ? ` · ${new Date(e.submittedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:"";
    const reviewHTML=entries.length?`<div class="pr-review">
      <div class="pr-review-hdr pr-workflow-hdr">
        <span class="entry-status entry-status-${workflow.code}">${workflow.label}${submittedMeta}</span>
        <span class="${complete?'pr-check-ok':'pr-check-pending'}">${complete?'✓':'○'} ${entries.length} / ${limit} picks selected</span>
        ${workflowAction}
      </div>
      ${submitted?`<div class="pr-warn pr-warn-ok">✓ Entry locked after submission. Unlock it before changing, reordering, or removing picks.</div>`:''}
      ${warnings.length?`<div class="pr-warnings">${warnings.map(w=>`<div class="pr-warn">⚠ ${esc(w)}</div>`).join("")}</div>`:(complete&&!submitted?`<div class="pr-warn pr-warn-ok">✓ No issues found — every pick has model inputs, a real edge, and no CLV red flags.</div>`:"")}
    </div>`:"";

    return `<div class="card">
      <h2>${esc(e.name)} <span class="entry-status entry-status-${workflow.code}">${workflow.label}</span> <span class="cnt" style="font-family:'JetBrains Mono';font-size:13px;color:var(--muted);font-weight:400;">${entries.length}/${limit}</span></h2>
      <div class="picklist pr-list">${rowsOrEmpty}</div>
      ${reviewHTML}
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-rmkey]").forEach(b=>b.onclick=()=>{
    const ent=activeEntries().find(x=>x.id===b.dataset.rment);
    if(!ent||entryIsLocked(ent)) return;
    delete ent.picks[b.dataset.rmkey];
    save(); renderBoard(); renderEntries(); renderPicksDetail();
  });
  wrap.querySelectorAll("[data-submit]").forEach(b=>b.onclick=()=>setEntrySubmitted(b.dataset.submit,true));
  wrap.querySelectorAll("[data-unsubmit]").forEach(b=>b.onclick=async()=>{
    if(await pgConfirm({title:"Unlock submitted entry?",message:"You will be able to change its picks again.",confirmText:"Unlock entry"})) setEntrySubmitted(b.dataset.unsubmit,false);
  });
  wrap.querySelectorAll("[data-move]").forEach(b=>b.onclick=()=>{
    if(!b.dataset.move) return;
    const [entryId,key,dir]=b.dataset.move.split("|");
    movePick(entryId,key,Number(dir));
  });
  wrap.querySelectorAll("[data-openm]").forEach(b=>b.onclick=()=>{
    switchTab("board");
    setTimeout(()=>{ const row=document.querySelector(`tr[data-key="${CSS.escape(b.dataset.openm)}"]`); if(row) row.scrollIntoView({behavior:"smooth",block:"center"}); },50);
  });
  renderCompareTable();
}
