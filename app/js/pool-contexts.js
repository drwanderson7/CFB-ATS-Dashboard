// --- Pool contexts: Context Bar + Splash/OFP pool sheet import -----------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
//   - The Context Bar itself (renderContextBar()/computeContextSummary()/
//     renderContextSwitcherContent()/openContextSwitcher()/
//     closeContextSwitcher()/initContextBar()) -- one persistent "Pool ·
//     Entry · Week" summary + a 3-column switcher, replacing what used to
//     be two separate DOM copies of the same controls (Snapshot and Board
//     each had their own). initContextBar()'s click-outside-to-close
//     logic deliberately uses composedPath() rather than
//     bar.contains(e.target) -- a real bug (the switcher closing on its
//     OWN navigation clicks, because a week-control click re-renders and
//     detaches itself from the DOM before the bubble-phase listener runs)
//     that composedPath() fixes and bar.contains() doesn't. Confirmed via
//     real clicks in a past session's Playwright verification, not just
//     reasoned through -- see the in-function comment for the full
//     mechanism.
//   - switchContext()/renderContextAll() -- switching which pool/board is
//     active and the full cross-tab re-render that follows.
//   - Splash/OFP pool sheet import (importPool() and its helpers
//     extractPdfTextLines()/poolWeekIndex()/mergePoolLines()/
//     archivePoolCurrentWeek()) -- client-side pdf.js text extraction
//     (NOT server-side like the Powers newsletter -- a Splash export can
//     be ~23MB with jersey-icon images, well over Vercel's 4.5MB
//     serverless body cap, so extracting just the text client-side and
//     sending that instead is the actual fix, not a stylistic choice),
//     then either creating a new pool, merging a same-week re-export in
//     place, or archiving the current week and loading a new one.
//   - removeActivePool().
//
// Loaded as a plain <script src="/app/js/pool-contexts.js"> tag, same as
// the other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `state`, `games`, `isDemo` -- global app state (main inline
//     script).
//   - `currentPool()`/`activeEntries()`/`activeEntry()`/
//     `ctxActiveEntryId()`/`setCtxActiveEntryId()`/`pickLimit()` -- pool/
//     entry context accessors (main inline script).
//   - `buildGames()`/`migrateGameKeys()`/`sortGames()`/`renderBoard()` --
//     app/js/board.js.
//   - `applyPdfData()`/`applyPredictions()` -- app/js/pdf-import.js.
//   - `renderEntrySelect()`/`renderEntries()`/`renderPicksDetail()` --
//     app/js/picks.js.
//   - `renderRecord()` -- app/js/record.js.
//   - `syncAll()` -- app/js/tabs.js.
//   - `weekIndexOf()`/`weekLabel()`/`currentWeekIndex()`/
//     `windowForWeek()`/`shiftWeek()`/`setWeekAnchor()` -- CFB week
//     calendar (app/js/board.js).
//   - `minsAgo()`/`esc()`/`uid()`/`seasonYear()` -- general utilities
//     (main inline script).
//   - `teamMatchTrunc()` -- truncated-name matching (main inline
//     script).
//   - `authHeaders()` -- Clerk-JWT auth header helper (main inline
//     script).
//   - `save()` -- persistence (main inline script).
function renderContextSelect(){
  const opts=[`<option value="overall" ${state.activeContext==="overall"?"selected":""}>Overall board</option>`]
    .concat((state.pools||[]).map(p=>`<option value="${p.id}" ${state.activeContext===p.id?"selected":""}>${esc(p.name)}${p.weekLabel?" · "+esc(p.weekLabel):""} · pick ${p.pickLimit||7}</option>`));
  document.querySelectorAll(".ctx-select").forEach(sel=>{ sel.innerHTML=opts.join(""); sel.onchange=()=>switchContext(sel.value); });
  const rm=document.getElementById("removePoolBtn");
  if(rm) rm.style.display=currentPool()?"":"none";
  const sh=document.getElementById("sharePoolBtn");
  if(sh) sh.style.display=currentPool()?"":"none";
}
function renderContextAll(){
  buildGames(); migrateGameKeys(); applyPdfData(); applyPredictions(); sortGames();
  renderContextSelect(); renderEntrySelect(); renderContextBar(); renderBoard(); renderEntries(); renderPicksDetail(); renderRecord();
}
function switchContext(id){
  state.activeContext=id; save(); renderContextAll();
}
// ---------------------------------------------------------------------
// Global context bar -- see #contextBar markup for the full rationale.
// One persistent summary line + a compact 3-column switcher (Viewing /
// Entry / Week), replacing what used to be two separate DOM copies of
// a Context dropdown and an entry dropdown (Snapshot and Board each had
// their own), plus filling a gap neither of them covered: Snapshot had
// no week indicator anywhere.
// ---------------------------------------------------------------------
function computeContextSummary(){
  const pool=currentPool();
  const ent=activeEntry();
  const limit=pickLimit();
  const pickedCount=ent?Object.keys(ent.picks||{}).length:0;
  const poolLabel=pool?pool.name:"Overall board";
  const entryLabel=ent?ent.name:"—";
  let weekLbl;
  if(pool){
    weekLbl=pool.weekLabel||"Week not set";
  }else if(state.weekAnchor==="ALL"){
    weekLbl="All weeks";
  }else{
    weekLbl=weekLabel(currentWeekIndex());
  }
  const line1=`${poolLabel} · ${entryLabel} · ${weekLbl}`;

  const parts=[`${pickedCount}/${limit} picks`];
  if(pool){
    // Pool weeks aren't a calendar index -- lock status is per-game
    // (whichever games the imported sheet already has a line for), so
    // report it as a count rather than a single locked/not verdict when
    // it's a genuine mix rather than all-or-nothing.
    const gs=pool.games||[];
    const lockedCount=gs.filter(g=>g.line!=null).length;
    if(gs.length===0) parts.push("no games imported yet");
    else if(lockedCount===gs.length) parts.push("lines locked");
    else if(lockedCount===0) parts.push("lines provisional");
    else parts.push(`${lockedCount}/${gs.length} lines locked`);
  }
  if(isDemo){
    parts.push("demo data");
  }else{
    const age=minsAgo(state.lastRefresh);
    if(age==null) parts.push("odds not refreshed yet");
    else if(age<60) parts.push(`odds updated ${age}m ago`);
    else parts.push(`odds updated ${Math.round(age/60*10)/10}h ago`);
  }
  return {line1, line2:parts.join(" · "), pool, ent};
}
function renderContextBar(){
  const l1=document.getElementById("ctxLine1"), l2=document.getElementById("ctxLine2");
  if(!l1||!l2) return;
  const summary=computeContextSummary();
  l1.textContent=summary.line1;
  l2.textContent=summary.line2;
  const sw=document.getElementById("contextSwitcher");
  if(sw && sw.style.display!=="none") renderContextSwitcherContent();
}
function renderContextSwitcherContent(){
  const pool=currentPool();

  const viewingEl=document.getElementById("ctxViewingList");
  const viewRows=[{id:"overall",label:"Overall board"}].concat((state.pools||[]).map(p=>({id:p.id,label:p.name})));
  viewingEl.innerHTML=viewRows.map(r=>{
    const active=(r.id==="overall")?(!pool):(pool&&pool.id===r.id);
    return `<div class="ctx-row ${active?'active':''}" data-ctx-view="${esc(r.id)}"><span class="ctx-check">${active?'✓':''}</span>${esc(r.label)}</div>`;
  }).join("");
  viewingEl.querySelectorAll("[data-ctx-view]").forEach(row=>{
    row.onclick=()=>{ switchContext(row.dataset.ctxView); closeContextSwitcher(); };
  });

  const entryEl=document.getElementById("ctxEntryList");
  entryEl.innerHTML=activeEntries().map(e=>{
    const active=e.id===ctxActiveEntryId();
    return `<div class="ctx-row ${active?'active':''}" data-ctx-entry="${esc(e.id)}"><span class="ctx-check">${active?'✓':''}</span>${esc(e.name)}</div>`;
  }).join("");
  entryEl.querySelectorAll("[data-ctx-entry]").forEach(row=>{
    row.onclick=()=>{ setCtxActiveEntryId(row.dataset.ctxEntry); save(); syncAll(); closeContextSwitcher(); }; // syncAll() -> renderBoard() already refreshes the bar
  });

  const weekEl=document.getElementById("ctxWeekBody");
  if(pool){
    // A pool's week isn't calendar-navigable the way Overall's is -- it's
    // whatever the last imported sheet set. Prev/next here would imply a
    // control that doesn't actually do anything, so this shows status
    // instead of controls.
    weekEl.innerHTML=`<div class="ctx-week-static">Set by <b>${esc(pool.name)}</b>'s imported sheet${pool.weekLabel?` — currently <b>${esc(pool.weekLabel)}</b>`:''}. Re-import that pool's sheet to move to a new week.</div>`;
  }else{
    const showAll=(state.weekAnchor==="ALL");
    const idx=currentWeekIndex();
    const label=showAll?"All weeks":weekLabel(idx);
    weekEl.innerHTML=`
      <div class="ctx-week-nav">
        <button type="button" id="ctxWeekPrev" ${showAll?'disabled':''} title="Previous week">‹</button>
        <span class="ctx-week-label">${esc(label)}</span>
        <button type="button" id="ctxWeekNext" ${showAll?'disabled':''} title="Next week">›</button>
      </div>
      <div class="ctx-week-jump">
        <input type="date" id="ctxWeekJump" title="Jump to a specific date">
        <button type="button" class="iconbtn" id="ctxWeekAll">${showAll?'Show current week':'Show all weeks'}</button>
      </div>`;
    const jump=document.getElementById("ctxWeekJump");
    if(jump){
      if(!showAll){ const win=windowForWeek(idx); jump.value=new Date(win.from).toISOString().slice(0,10); }
      // setWeekAnchor() already cascades through renderBoard() -> renderContextBar()
      // -> (switcher open) renderContextSwitcherContent() on its own -- calling
      // any of those again here would rebuild this same subtree a second (or
      // third) time in one synchronous pass for no benefit, and repeatedly
      // replacing #ctxWeekPrev/#ctxWeekNext/etc mid-interaction is exactly the
      // kind of DOM churn that can yank an element out from under a click that's
      // still landing on it.
      jump.onchange=()=>{ if(jump.value){ const i=weekIndexOf(jump.value+"T12:00:00"); if(i!=null) setWeekAnchor(i); } };
    }
    const prevBtn=document.getElementById("ctxWeekPrev");
    if(prevBtn) prevBtn.onclick=()=>shiftWeek(-1);
    const nextBtn=document.getElementById("ctxWeekNext");
    if(nextBtn) nextBtn.onclick=()=>shiftWeek(1);
    const allBtn=document.getElementById("ctxWeekAll");
    if(allBtn) allBtn.onclick=()=>setWeekAnchor(showAll?null:"ALL");
  }
}
function openContextSwitcher(){
  const sw=document.getElementById("contextSwitcher");
  const bar=document.getElementById("contextBar");
  if(!sw||!bar) return;
  sw.style.display="grid";
  bar.classList.add("open");
  renderContextSwitcherContent();
}
function closeContextSwitcher(){
  const sw=document.getElementById("contextSwitcher");
  const bar=document.getElementById("contextBar");
  if(sw) sw.style.display="none";
  if(bar) bar.classList.remove("open");
}
function initContextBar(){
  const toggle=document.getElementById("contextBarToggle");
  if(toggle) toggle.onclick=(e)=>{
    e.stopPropagation();
    const sw=document.getElementById("contextSwitcher");
    if(!sw) return;
    if(sw.style.display==="none") openContextSwitcher(); else closeContextSwitcher();
  };
  // Click-outside-to-close -- registered once, checks on every click
  // whether it landed inside the bar (toggle button OR the open switcher
  // panel, both are descendants of #contextBar) rather than needing a
  // listener per row.
  //
  // Deliberately uses composedPath(), NOT bar.contains(e.target). The week
  // controls re-render their own subtree synchronously in response to their
  // own click (shiftWeek() -> ... -> renderContextBar() -> switcher's still
  // open -> renderContextSwitcherContent() replaces weekEl.innerHTML) --
  // which detaches the ORIGINAL button (the one currently mid-click) from
  // the document as a side effect of handling its own click. bar.contains()
  // does a LIVE tree walk when called: by the time this bubble-phase
  // listener runs, that original button is no longer attached to anything,
  // so contains() reports "not inside the bar" and this was closing the
  // switcher on its own navigation clicks. composedPath() instead returns
  // the dispatch path captured at the START of the event, before any
  // handler had a chance to mutate the DOM -- so a since-detached node
  // still correctly shows up as having been inside the bar when the click
  // actually happened. Confirmed via real clicks after this fix (see the
  // week-controls test), not just reasoned through.
  document.addEventListener("click",(e)=>{
    const bar=document.getElementById("contextBar");
    if(!bar) return;
    const path=(typeof e.composedPath==="function")?e.composedPath():null;
    const inside=path?path.includes(bar):bar.contains(e.target);
    if(!inside) closeContextSwitcher();
  });
}
// Extract text lines from a PDF entirely in the browser (pdf.js), in the same
// top-to-bottom reading order pdfplumber gave server-side. This is the whole
// fix for large pick-sheet PDFs: a Splash export is ~230 lines of real text
// plus dozens of jersey-icon images that routinely push the file past 20MB,
// and Vercel's serverless functions hard-cap request bodies at 4.5MB on every
// plan (an AWS platform limit, not something raisable in vercel.json). Sending
// bytes-on-the-wire text instead of the raw file shrinks the request from
// ~23MB to a few KB -- comfortably under the limit -- rather than trying to
// squeeze a file that can't fit.
async function extractPdfTextLines(file){
  if(!window.pdfjsLib) throw new Error("PDF reader didn't load — check your connection and try again.");
  const buf=await file.arrayBuffer();
  let pdf;
  try{
    pdf=await pdfjsLib.getDocument({data:buf}).promise;
  }catch(err){
    // getDocument() spawns a Web Worker pointed at pdf.worker.min.js (set in
    // init(), still in app/index.html's own "init" section -- not yet
    // split out) -- a SEPARATE network request from the main library,
    // with no <script> tag of our own to attach an onerror handler to. If
    // that worker fails to load (CDN hiccup, ad-blocker, flaky connection),
    // this is where it actually surfaces -- the !window.pdfjsLib check above
    // only catches the main library never loading at all, not this. Without
    // this catch, whatever raw pdf.js/worker error message came back would
    // just surface verbatim in the UI (e.g. "Failed to fetch dynamically
    // imported module" or similar), which isn't self-explanatory to someone
    // just trying to import a pool sheet.
    const msg=String((err&&err.message)||err||"");
    const looksLikeLoadFailure=/worker|fetch|network|script|import|load/i.test(msg) || !msg;
    if(looksLikeLoadFailure){
      throw new Error("The PDF reader failed to load (network or ad-blocker issue) — check your connection and try again.");
    }
    // Otherwise this is pdf.js successfully loading but rejecting the file
    // itself -- corrupt, password-protected, or not actually a PDF. A
    // different problem from "the reader didn't load," worth saying so
    // rather than pointing someone at their network connection for a file
    // problem.
    throw new Error("Couldn't read that PDF — it may be corrupted, password-protected, or not a valid PDF file.");
  }
  const lines=[];
  const TOL=4; // px tolerance for "same visual row" -- exact-pixel matching splits
               // a team name from its adjacent "(spread)" when they sit at a
               // slightly different baseline (verified against a real export).
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const content=await page.getTextContent();
    // Keep space-only items: pdf.js reports inter-word spaces as their own
    // items, and dropping them (an easy trim()==="" filter mistake) glues
    // adjacent words together ("Thu,Sep3" instead of "Thu, Sep3"). Only drop
    // items that are truly empty strings.
    const items=content.items.map(it=>({x:it.transform[4], y:it.transform[5], s:it.str})).filter(it=>it.s!=="");
    items.sort((a,b)=> b.y-a.y || a.x-b.x); // top of page first, then left to right
    const rows=[];
    items.forEach(it=>{
      let row=rows.find(r=>Math.abs(r.y-it.y)<=TOL);
      if(!row){ row={y:it.y, items:[]}; rows.push(row); }
      row.items.push(it);
    });
    rows.forEach(r=>{
      r.items.sort((a,b)=>a.x-b.x);
      const text=r.items.map(it=>it.s).join("").replace(/\s+/g," ").trim();
      if(text) lines.push(text);
    });
  }
  return lines;
}
// Does an existing pool's CURRENTLY LOADED week match the week this new sheet
// covers? (Not "has this pool ever had this week" -- pools only track one live
// week at a time, same as the Overall board; past weeks live in pool.history.)
function poolWeekIndex(pool){
  const g=pool.games&&pool.games[0];
  return g&&g.commence?weekIndexOf(g.commence):null;
}
// Merge freshly-parsed lines into a pool's current week, matching each new row
// to the pool's STORED game by team name and updating only its `line`.
// Deliberately never rewrites away/home on the stored game -- board keys (and
// therefore every existing pick) are derived from those exact strings, so
// leaving them untouched is what keeps picks linked across a same-week re-import.
function mergePoolLines(pool, newGames){
  let updated=0, added=0;
  (newGames||[]).forEach(ng=>{
    const eg=(pool.games||[]).find(pg=>teamMatchTrunc(ng.away,pg.away)&&teamMatchTrunc(ng.home,pg.home));
    if(eg){
      if(ng.line!=null && ng.line!==eg.line){ eg.line=ng.line; updated++; }
    }else{
      pool.games.push({away:ng.away,home:ng.home,commence:ng.commence,line:(ng.line!=null?ng.line:null)});
      added++;
    }
  });
  return {updated, added};
}
// Archive a pool's current week into its own history (mirrors closeWeek, but
// scoped to one pool and without switching tabs) -- used when importing a NEW
// week's sheet for a pool that still has picks sitting on its current week.
function archivePoolCurrentWeek(pool){
  const snapshot=pool.entries.map(e=>({
    entryId:e.id, name:e.name,
    picks:Object.entries(e.picks).map(([k,p])=>{
      const live=games.find(x=>x.key===k);
      const providerGameId=(live&&live.providerGameId)?live.providerGameId:(p.providerGameId||null);
      return{ key:k, matchup:p.matchup||k, team:p.team||"", side:p.side||null, line:p.line, result:null, providerGameId };
    })
  }));
  pool.history.unshift({
    id:uid(), label:pool.weekLabel||("Week "+(pool.history.length+1)),
    closedAt:new Date().toISOString(), entries:snapshot
  });
  pool.entries.forEach(e=>e.picks={});
}
async function importPool(file){
  const st=document.getElementById("poolStatus");
  if(st){ st.style.color="var(--muted)"; st.textContent="reading sheet…"; }
  try{
    const lines=await extractPdfTextLines(file);
    if(!lines.length) throw new Error("Couldn't read any text from that PDF");
    const res=await fetch("/api/parse_pool",{
      method:"POST", headers:{...(await authHeaders()),"Content-Type":"application/json"},
      body:JSON.stringify({lines, year:seasonYear()})
    });
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||("Server error "+res.status));
    if(!Array.isArray(data.games)||!data.games.length) throw new Error("No games found in that sheet");
    const src=(data.source||"pool");
    const newWeekIdx=data.games[0]&&data.games[0].commence?weekIndexOf(data.games[0].commence):null;
    const newWeekLbl=newWeekIdx!=null?weekLabel(newWeekIdx):"";

    // Always ask which pool this belongs to -- a source alone ("splash") isn't
    // a unique contest if the user is ever in more than one Splash pool at once.
    const candidates=(state.pools||[]).filter(p=>p.source===src);
    let target=null;
    if(candidates.length){
      const list=candidates.map((p,i)=>`${i+1}) ${p.name}  — currently ${p.weekLabel||"no week loaded"}, ${p.history.length} week(s) in Record`).join("\n");
      const ans=prompt(`Which pool is this sheet for?\n\n${list}\n\n0) Create a NEW pool\n\nEnter a number:`, "1");
      if(ans===null){ if(st) st.textContent="import cancelled"; return; }
      const idx=parseInt(ans,10);
      if(!isNaN(idx)&&idx>=1&&idx<=candidates.length) target=candidates[idx-1];
      // else (0, blank, invalid) falls through to create a new pool below
    }

    if(target){
      const curWeekIdx=poolWeekIndex(target);
      if(curWeekIdx!=null && newWeekIdx!=null && curWeekIdx===newWeekIdx){
        // Same week already loaded -> this is a re-export (e.g. after Wed lock).
        // Update lines in place; picks are untouched.
        const {updated,added}=mergePoolLines(target, data.games);
        if(data.pickLimit) target.pickLimit=data.pickLimit;
        target.weekLabel=newWeekLbl;
        state.activeContext=target.id;
        save(); renderContextAll();
        if(st){ st.style.color="var(--green-text)"; st.textContent=`updated "${target.name}" · ${updated} line(s) set${added?` · ${added} new game(s)`:""}`; }
        return;
      }
      // A different week for this pool. If picks exist on its current week,
      // archive them to Record first so nothing is silently lost or overwritten.
      const hasPicks=target.entries.some(e=>Object.keys(e.picks).length);
      if(hasPicks){
        const ok=confirm(`"${target.name}" has picks on its current week (${target.weekLabel||"previous week"}).\n\nArchive that week to Record and load ${newWeekLbl||"the new week"} from this sheet?`);
        if(!ok){ if(st) st.textContent="import cancelled"; return; }
        archivePoolCurrentWeek(target);
      }
      target.games=data.games.map(g=>({away:g.away,home:g.home,commence:g.commence,line:(g.line!=null?g.line:null)}));
      target.weekLabel=newWeekLbl;
      if(data.pickLimit) target.pickLimit=data.pickLimit;
      target.importedAt=new Date().toISOString();
      state.activeContext=target.id;
      save(); renderContextAll();
      if(st){ st.style.color="var(--green-text)"; st.textContent=`loaded ${newWeekLbl||"new week"} into "${target.name}" · ${data.count} games · pick ${target.pickLimit}`; }
      return;
    }

    // Create a new, persistent pool. This name covers the whole season/contest,
    // not just this one week -- future imports will ask to attach to it by name.
    const defName=(src.charAt(0).toUpperCase()+src.slice(1))+" pool";
    const name=(prompt("Name this pool (covers the whole contest, not just this week):", defName)||defName).trim();
    // Pick limit is read from the sheet's own "N/M picks made" footer -- it is
    // NEVER assumed to be 7. Not every pool is pick-7; if the footer wording
    // doesn't match (a different pool type, or a phrasing this parser hasn't
    // seen yet), data.pickLimit comes back null and we ask rather than guess.
    let limit=data.pickLimit;
    if(!limit){
      const entered=prompt(
        `Couldn't detect this pool's pick limit from the sheet (its "X/Y picks made" line wasn't found or didn't match).\n\n`+
        `How many picks does this pool allow per entry?`, "7"
      );
      limit=parseInt(entered,10);
      if(!limit||limit<1){ if(st){ st.style.color="var(--red-text)"; st.textContent="import cancelled — pick limit needed to create the pool"; } return; }
    }
    const pool={
      id:uid(), name, source:src, pickLimit:limit,
      importedAt:new Date().toISOString(),
      games:data.games.map(g=>({away:g.away,home:g.home,commence:g.commence,line:(g.line!=null?g.line:null)})),
      weekLabel:newWeekLbl,
      entries:[{id:uid(),name:"Entry 1",picks:{}}], activeEntryId:null,
      history:[]
    };
    pool.activeEntryId=pool.entries[0].id;
    state.pools.push(pool);
    state.activeContext=pool.id;
    save();
    renderContextAll();
    if(st){ st.style.color="var(--green-text)"; st.textContent=`created "${name}" · ${data.count} games · pick ${pool.pickLimit}`; }
  }catch(err){
    if(st){ st.style.color="var(--red-text)"; st.textContent="import failed: "+err.message; }
    console.error(err);
  }
}
function removeActivePool(){
  const p=currentPool(); if(!p) return;
  if(!confirm(`Remove the pool "${p.name}" and its picks? This can't be undone.`)) return;
  state.pools=state.pools.filter(x=>x.id!==p.id);
  state.activeContext="overall"; save(); renderContextAll();
  const st=document.getElementById("poolStatus"); if(st) st.textContent="";
}
