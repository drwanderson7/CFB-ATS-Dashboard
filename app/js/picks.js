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
function pickTeam(key,side){
  const ent=activeEntry();
  const g=games.find(x=>x.key===key);
  if(!g) return;
  const existing=ent.picks[key];
  if(existing && existing.side===side){
    delete ent.picks[key]; // clicking the already-picked side removes the pick
  }else{
    if(!existing && Object.keys(ent.picks).length>=pickLimit()) return; // only new picks are capped; switching sides is always allowed
    const team=side==="home"?g.home:g.away;
    const line=side==="home"?g.vegas:(g.vegas!=null?-g.vegas:null);
    ent.picks[key]={side,team,line,matchup:g.away+" @ "+g.home,providerGameId:g.providerGameId||null};
  }
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
function renderEntries(){
  const wrap=document.getElementById("entryList");
  wrap.innerHTML=activeEntries().map(e=>{
    const cnt=Object.keys(e.picks).length;
    const act=e.id===ctxActiveEntryId();
    return `<div class="entry ${act?"activeE":""}">
      <span class="nm">${esc(e.name)}</span>
      <span class="cnt">${cnt}/${pickLimit()}</span>
      <button class="iconbtn" data-use="${e.id}">${act?"picking ✓":"pick for this"}</button>
      <button class="iconbtn" data-ren="${e.id}">rename</button>
      <button class="iconbtn" data-del="${e.id}" ${activeEntries().length<=1?"disabled":""}>delete</button>
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-use]").forEach(b=>b.onclick=()=>{setCtxActiveEntryId(b.dataset.use);save();syncAll();});
  wrap.querySelectorAll("[data-ren]").forEach(b=>b.onclick=()=>{
    const e=activeEntries().find(x=>x.id===b.dataset.ren);
    const nm=prompt("Rename entry",e.name); if(nm){e.name=nm.trim()||e.name;save();syncAll();}
  });
  wrap.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
    if(activeEntries().length<=1) return;
    if(!confirm("Delete this entry and its picks?")) return;
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
// Seeds any shared test pool this user doesn't already have locally. Only
// ADDS -- never overwrites an existing local pool with the same id, so if
// someone's already made picks against it, a later shared-pool update from
// Drew can't clobber their entries. Each person gets their own fresh
// Entry 1/picks on first sight of a shared pool, same as a normal import.
function mergeSharedPoolsIntoLocal(){
  let changed=false;
  (state.sharedPools||[]).forEach(sp=>{
    if((state.pools||[]).some(p=>p.id===sp.id)) return;
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
// Publishes a pool's STRUCTURE (games/locked lines/name/settings) to the
// shared tier -- never entries or picks, those never leave this device.
// Test-only affordance; re-running it on the same pool updates the shared
// copy (existing local pools elsewhere are untouched, see the merge guard
// above).
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
function renderCompareTable(){
  const card=document.getElementById("compareCard");
  const table=document.getElementById("compareTable");
  if(!card||!table) return;
  const records=collectPickRecords();
  // Columns: one per context+entry, PERIOD -- not just ones with an existing
  // pick. An entry with zero picks still gets its own column of dashes, so
  // you can watch the comparison fill in as you pick rather than the whole
  // table staying hidden until every entry has at least one pick.
  const cols=[];
  allContexts().forEach(ctx=>{
    ctx.entries.forEach(ent=>{
      cols.push({contextId:ctx.id,contextLabel:ctx.label,entryId:ent.id,entryName:ent.name});
    });
  });
  const entriesPerContext={};
  cols.forEach(c=>{ entriesPerContext[c.contextId]=(entriesPerContext[c.contextId]||0)+1; });

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

// Reorders one entry's picks by rebuilding the object with new key
// insertion order -- picks are stored as {key: {...}}, not an array, but
// JS objects preserve string-key insertion order (ES2015+), and
// Object.entries(e.picks) already relies on that same guarantee
// elsewhere in this file. No new schema field needed to support reorder.
function movePick(entryId,key,dir){
  const ent=activeEntries().find(x=>x.id===entryId);
  if(!ent) return;
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
      return `<div class="pr-row">
        <span class="pr-num">${idx+1}</span>
        <div class="pr-main">
          <div class="pr-team">${esc(p.team||"")} ${line!=null?fmt(line):""}${offBoard?' <span class="offboard">not on board</span>':''}</div>
          <div class="pr-matchup">${esc(p.matchup||k)}</div>
        </div>
        <div class="pr-stats">${statsHTML}${clvHTML}</div>
        <div class="pr-actions">
          <button class="iconbtn" data-move="${idx>0?e.id+'|'+k+'|-1':''}" ${idx===0?'disabled':''} title="Move up">↑</button>
          <button class="iconbtn" data-move="${idx<entries.length-1?e.id+'|'+k+'|1':''}" ${idx===entries.length-1?'disabled':''} title="Move down">↓</button>
          ${live?`<button class="iconbtn" data-openm="${esc(k)}" title="Open on full board">⤢</button>`:''}
          <button class="iconbtn rm" data-rment="${e.id}" data-rmkey="${esc(k)}" title="Remove this pick">✕</button>
        </div>
      </div>`;
    }).join("");

    const rowsOrEmpty=entries.length?rows:`<p class="note" style="margin:6px 0 0;">No picks yet. Star games on the Edge board or Snapshot while this entry is selected.</p>`;

    const reviewHTML=entries.length?`<div class="pr-review">
      <div class="pr-review-hdr">
        <span class="${complete?'pr-check-ok':'pr-check-pending'}">${complete?'✓':'○'} ${entries.length} / ${limit} picks selected</span>
      </div>
      ${warnings.length?`<div class="pr-warnings">${warnings.map(w=>`<div class="pr-warn">⚠ ${esc(w)}</div>`).join("")}</div>`:(complete?`<div class="pr-warn pr-warn-ok">✓ No issues found — every pick has model inputs, a real edge, and no CLV red flags.</div>`:"")}
    </div>`:"";

    return `<div class="card">
      <h2>${esc(e.name)} <span class="cnt" style="font-family:'JetBrains Mono';font-size:13px;color:var(--muted);font-weight:400;">${entries.length}/${limit}</span></h2>
      <div class="picklist pr-list">${rowsOrEmpty}</div>
      ${reviewHTML}
    </div>`;
  }).join("");
  wrap.querySelectorAll("[data-rmkey]").forEach(b=>b.onclick=()=>{
    const ent=activeEntries().find(x=>x.id===b.dataset.rment);
    if(!ent) return;
    delete ent.picks[b.dataset.rmkey];
    save(); renderBoard(); renderEntries(); renderPicksDetail();
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
