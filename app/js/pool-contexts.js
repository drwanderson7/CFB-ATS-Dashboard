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
//   - `state`, `games`, `isDemo`, `isAdminUser` -- global app state (main
//     inline script). isAdminUser gates the pool-template publishing controls
//     action (see poolRowHTML()'s own comment) -- kept OUT of `state`
//     itself, same reasoning as `apiKey`, since it's a server-computed
//     account attribute, not user data.
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
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `save()` -- persistence (main inline script).
function renderContextSelect(){
  const opts=[`<option value="overall" ${state.activeContext==="overall"?"selected":""}>Overall board</option>`]
    .concat((state.pools||[]).map(p=>`<option value="${p.id}" ${state.activeContext===p.id?"selected":""}>${esc(p.name)}${p.weekLabel?" · "+esc(p.weekLabel):""} · pick ${p.pickLimit||7}</option>`));
  document.querySelectorAll(".ctx-select").forEach(sel=>{ sel.innerHTML=opts.join(""); sel.onchange=()=>switchContext(sel.value); });
}
function renderContextAll(){
  buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos(); sortGames();
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
// Shared lock-status label for a pool's games -- "no games imported yet",
// "lines locked", "lines provisional", or "N/M lines locked" for a
// genuine mix. Extracted out of computeContextSummary() so the Pools tab
// (which needs this same status per-pool, not just for whichever pool is
// currently active) can use the exact same logic rather than a second,
// possibly-drifting copy of it.
function poolLockStatusLabel(pool){
  const gs=(pool&&pool.games)||[];
  if(gs.length===0) return "no games imported yet";
  const lockedCount=gs.filter(g=>g.line!=null).length;
  if(lockedCount===gs.length) return "lines locked";
  if(lockedCount===0) return "lines provisional";
  return `${lockedCount}/${gs.length} lines locked`;
}
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
    // this can genuinely be a mix, not just all-or-nothing (see
    // poolLockStatusLabel()).
    parts.push(poolLockStatusLabel(pool));
  }
  if(isDemo){
    parts.push("demo data");
  }else{
    const age=minsAgo(state.lastRefresh);
    if(age==null) parts.push("odds not refreshed yet");
    else if(age<60) parts.push(`odds updated ${age}m ago`);
    else parts.push(`odds updated ${Math.round(age/60*10)/10}h ago`);
  }
  // Weekly Setup's own card disappears entirely once every required item
  // is done (renderSetupStatus(), app/js/board.js) -- this is the ONLY
  // remaining trace of that once it happens, so someone doesn't lose the
  // "yes, you're actually set up" confirmation along with the card. Only
  // added once genuinely complete; an in-progress/incomplete setup still
  // shows its own full card, so there's nothing to duplicate here in
  // that case.
  if(typeof computeSetupDisplay==="function"){
    const setupDisplay=computeSetupDisplay();
    if(setupDisplay.mode==="complete") parts.push("setup ✓");
  }
  return {line1, line2:parts.join(" · "), pool, ent};
}
function renderContextBar(){
  const bar=document.getElementById("contextBar");
  // See sharedWidgetsHiddenOnCurrentTab() (app/js/board.js) for which
  // tabs and why.
  if(sharedWidgetsHiddenOnCurrentTab()){
    if(bar) bar.style.display="none";
    closeContextSwitcher();
    return;
  }
  if(bar) bar.style.display="";
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
    const items=content.items.map(it=>({x:it.transform[4], y:it.transform[5], w:(it.width||0), s:it.str})).filter(it=>it.s!=="");
    // Drop anything sitting in a right-hand sidebar column before row-
    // grouping even starts. ESPN's pick sheet renders a "Related Games"/
    // prizes/legal sidebar alongside the picks column on the SAME page --
    // confirmed against a real export: the picks column never extends past
    // ~55% of page width, the sidebar never starts before ~64%. Gap-based
    // clustering (below) already separates a genuine two-column ROW, but
    // can't tell sidebar prose ("Terms of Use", "NFL Pick'em") apart from a
    // real team name by shape alone -- they look identical as text. Cutting
    // by position first, before any text-shape guessing, is what actually
    // fixes that: nothing this far right is ever picks content, regardless
    // of what it says. Splash's export has no sidebar at all, so this never
    // removes anything there.
    const pageWidth=page.view?(page.view[2]-page.view[0]):(page.getViewport({scale:1}).width);
    const SIDEBAR_X=pageWidth*0.6;
    const mainItems=items.filter(it=>it.x<SIDEBAR_X);
    mainItems.sort((a,b)=> b.y-a.y || a.x-b.x); // top of page first, then left to right
    const rows=[];
    mainItems.forEach(it=>{
      let row=rows.find(r=>Math.abs(r.y-it.y)<=TOL);
      if(!row){ row={y:it.y, items:[]}; rows.push(row); }
      row.items.push(it);
    });
    // Split each row into left-to-right clusters wherever a horizontal gap
    // exceeds GAP_PX, and keep only the first two. This is what makes a
    // genuinely two-column layout (ESPN's away/home team cards sitting side
    // by side on the same row) safe to flatten into text: word-to-word gaps
    // within a team name or a sentence are a few px, while the gap between
    // two side-by-side cards (confirmed against a real ESPN export: ~85-190px
    // for most team names) is far larger -- so GAP_PX reliably separates
    // "two real columns of content" from "one column with normal word
    // spacing" in the common case. Splash's layout stacks away/home
    // vertically rather than side by side, so every one of its rows only
    // ever produces a single cluster -- this is a no-op there, identical
    // output to before.
    // KNOWN LIMITATION, not yet solved: an unusually long away team name
    // ("Washington State Cougars") can shrink that gap below GAP_PX and
    // merge both teams onto one line -- confirmed against a real export (a
    // 38px gap, just under the 40px threshold, on that specific matchup). A
    // per-page fixed-column-split alternative was tried and rejected: it
    // fixes the long-name case but incorrectly slices full-width rows
    // (e.g. an "SAT 9/5 • LOCKS @ 11:00 AM" header) in half instead, which
    // is a worse failure since it breaks EVERY game on the page rather than
    // one. Given the ESPN paste-text import path (importPoolFromText(),
    // below) parses the same real export with NO edge cases at all, PDF
    // import for ESPN specifically is a best-effort fallback, not the
    // primary path -- not worth a second complexity pass for a rare edge
    // case when a clean primary path already exists.
    const GAP_PX=40;
    rows.forEach(r=>{
      const clusters=[];
      r.items.forEach(it=>{
        const last=clusters[clusters.length-1];
        if(last && (it.x-last.end)>GAP_PX) clusters.push({items:[],end:0});
        else if(!last) clusters.push({items:[],end:0});
        const c=clusters[clusters.length-1];
        c.items.push(it); c.end=it.x+(it.w||0);
      });
      clusters.slice(0,2).forEach(c=>{
        const text=c.items.map(it=>it.s).join("").replace(/\s+/g," ").trim();
        if(text) lines.push(text);
      });
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
      const identity=(live&&typeof cfbdPickIdentity==="function")?cfbdPickIdentity(live,p.side):{};
      return{ ...p, ...identity, key:k, matchup:p.matchup||k, team:p.team||"", side:p.side||null, line:p.line, result:null, providerGameId };
    })
  }));
  pool.history.unshift({
    id:uid(), label:pool.weekLabel||("Week "+(pool.history.length+1)),
    closedAt:new Date().toISOString(), entries:snapshot
  });
  pool.entries.forEach(e=>e.picks={});
}
// Everything downstream of "we now have parsed {source, pickLimit, games}
// from the server" -- shared by BOTH the PDF-upload flow (importPool()) and
// the plain-text paste flow (importPoolFromText()) below, since neither one
// cares how the lines were obtained, only what came back. Throws on error;
// callers are responsible for catching and updating their own status UI.
async function applyParsedPoolData(data, targetPoolId, st){
  if(!Array.isArray(data.games)||!data.games.length) throw new Error("No games found");
  const src=(data.source||"pool");
  const newWeekIdx=data.games[0]&&data.games[0].commence?weekIndexOf(data.games[0].commence):null;
  const newWeekLbl=newWeekIdx!=null?weekLabel(newWeekIdx):"";

  let target=null;
  if(targetPoolId){
    // Caller (Pools tab's per-pool "import sheet" button) already knows
    // exactly which pool this is for -- no need to guess or ask.
    target=(state.pools||[]).find(p=>p.id===targetPoolId)||null;
  }else{
    // Always ask which pool this belongs to -- a source alone ("splash") isn't
    // a unique contest if the user is ever in more than one Splash pool at once.
    const candidates=(state.pools||[]).filter(p=>p.source===src);
    if(candidates.length){
      const choice=await pgChoice({
        title:"Which pool is this sheet for?",
        message:"Choose an existing contest to update, or create a new pool from this sheet.",
        confirmText:"Use this pool",
        choices:[
          ...candidates.map(p=>({
            value:p.id,
            label:p.name,
            description:`Currently ${p.weekLabel||"no week loaded"} · ${(p.history||[]).length} week(s) in Results`
          })),
          {value:"__new__",label:"Create a new pool",description:"Use this sheet to create a separate contest."}
        ]
      });
      if(choice===null){ if(st) st.textContent="import cancelled"; return; }
      if(choice!=="__new__") target=candidates.find(p=>p.id===choice)||null;
    }
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
      save(); renderContextAll(); renderPoolsPage();
      if(st){ st.style.color="var(--green-text)"; st.textContent=`updated "${target.name}" · ${updated} line(s) set${added?` · ${added} new game(s)`:""}`; }
      return;
    }
    // A different week for this pool. If picks exist on its current week,
    // archive them to Results first so nothing is silently lost or overwritten.
    const hasPicks=target.entries.some(e=>Object.keys(e.picks).length);
    if(hasPicks){
      const ok=await pgConfirm({
        title:"Archive current picks first?",
        message:`"${target.name}" has picks on its current week (${target.weekLabel||"previous week"}).\n\nArchive that week to Results and load ${newWeekLbl||"the new week"} from this sheet?`,
        confirmText:"Archive & load new week"
      });
      if(!ok){ if(st) st.textContent="import cancelled"; return; }
      archivePoolCurrentWeek(target);
    }
    target.games=data.games.map(g=>({away:g.away,home:g.home,commence:g.commence,line:(g.line!=null?g.line:null)}));
    target.weekLabel=newWeekLbl;
    if(data.pickLimit) target.pickLimit=data.pickLimit;
    target.importedAt=new Date().toISOString();
    state.activeContext=target.id;
    save(); renderContextAll(); renderPoolsPage();
    if(st){ st.style.color="var(--green-text)"; st.textContent=`loaded ${newWeekLbl||"new week"} into "${target.name}" · ${data.count} games · pick ${target.pickLimit}`; }
    return;
  }

  // Create a new, persistent pool. This name covers the whole season/contest,
  // not just this one week -- future imports will ask to attach to it by name.
  const defName=(src.charAt(0).toUpperCase()+src.slice(1))+" pool";
  const enteredName=await pgPrompt({
    title:"Create pool from this sheet",
    message:"Name the whole contest, not just this week.",
    label:"Pool name",
    value:defName,
    required:true,
    confirmText:"Continue"
  });
  if(enteredName===null){ if(st) st.textContent="import cancelled"; return; }
  const name=enteredName.trim()||defName;
  // Pick limit is read from the sheet's own "N/M picks made" footer -- it is
  // NEVER assumed to be 7. Not every pool is pick-7; if the footer wording
  // doesn't match (a different pool type, or a phrasing this parser hasn't
  // seen yet), data.pickLimit comes back null and we ask rather than guess.
  let limit=data.pickLimit;
  if(!limit){
    const entered=await pgPrompt({
      title:"Set the pick limit",
      message:`Couldn't detect this pool's pick limit from the sheet (its "X/Y picks made" line wasn't found or didn't match).`,
      label:"Picks per entry",
      value:"7",
      type:"number",
      inputMode:"numeric",
      min:1,
      step:1,
      required:true,
      confirmText:"Create pool",
      validate:value=>{ const n=parseInt(value,10); return n>=1?null:"Enter a whole number of at least 1."; }
    });
    if(entered===null){ if(st){ st.style.color="var(--red-text)"; st.textContent="import cancelled — pick limit needed to create the pool"; } return; }
    limit=parseInt(entered,10);
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
  renderPoolsPage();
  if(st){ st.style.color="var(--green-text)"; st.textContent=`created "${name}" · ${data.count} games · pick ${pool.pickLimit}`; }
}
// statusElId: which status <span> to write feedback into -- defaults to
// "poolStatus" (the per-pool-row import flow's existing element), but the
// Pools tab's own top-level "Import a pool sheet" card (importPool()/
// importPoolFromText() called with no targetPoolId) passes
// "poolsTopImportStatus" instead, so a first-time import shows its result
// right next to the button that triggered it rather than in a separate
// card below.
async function importPool(file, targetPoolId, statusElId){
  const st=document.getElementById(statusElId||"poolStatus");
  if(st){ st.style.color="var(--muted)"; st.textContent="reading sheet…"; }
  try{
    const lines=await extractPdfTextLines(file);
    if(!lines.length) throw new Error("Couldn't read any text from that PDF");
    const result=await apiFetch("/api/parse_pool",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({lines, year:seasonYear()})
    });
    if(!result.ok) throw new Error(result.error);
    await applyParsedPoolData(result.body, targetPoolId, st);
  }catch(err){
    if(st){ st.style.color="var(--red-text)"; st.textContent="import failed: "+err.message; }
    console.error(err);
  }
}
// Plain-text paste import -- for ESPN College Pick'em specifically. ESPN's
// PDF export renders picks as a genuine two-column layout (away/home cards
// side by side, plus an unrelated sidebar), which a PDF text extraction
// flattens into a badly-scrambled row order -- real coordinate wrangling
// was needed to make that reliable. Copy-pasted text from the live ESPN
// page has none of that: the browser's own DOM order gives a clean,
// strictly sequential [team name, spread, record, picked%] block per team,
// away then home, repeating -- confirmed against a real Week 1 2026 paste.
// The one real trade-off: unlike the PDF (which has a "LOCKS @" header per
// game), a plain copy-paste carries NO kickoff date/time at all, so every
// game's commence comes back null. The app already tolerates that
// gracefully elsewhere (e.g. Powers-PDF-only boards) -- it just means the
// week label stays blank instead of showing "Week 1," so the person needs
// to keep track of which week they're importing themselves.
// statusElId: see importPool()'s comment above -- same defaulting behavior.
async function importPoolFromText(text, targetPoolId, statusElId){
  const st=document.getElementById(statusElId||"poolStatus");
  if(st){ st.style.color="var(--muted)"; st.textContent="reading pasted picks…"; }
  try{
    const lines=String(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
    if(!lines.length) throw new Error("Nothing to import — paste the picks text first");
    const result=await apiFetch("/api/parse_pool",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({lines, year:seasonYear(), format:"espn_paste"})
    });
    if(!result.ok) throw new Error(result.error);
    await applyParsedPoolData(result.body, targetPoolId, st);
  }catch(err){
    if(st){ st.style.color="var(--red-text)"; st.textContent="import failed: "+err.message; }
    console.error(err);
  }
}
// --- Select games manually --------------------------------------------
// For a pool that isn't on Splash/ESPN/OFP at all -- a pool run on some
// other site, a paper sheet, a group text -- there was previously NO way
// to give it a game list at all; createEmptyPool()'s own message says
// "you can import its weekly sheet afterward," but nothing existed for
// "there is no sheet to import." This lets someone pick real games
// straight from the already-loaded live odds slate (state.lastGames --
// no retyping team names by hand, no typo/fuzzy-match risk later) and set
// THEIR pool's own locked spread per game (prefilled from the live Vegas
// line as a convenience starting point, since that's often close to or
// the same as what a real sheet would show -- but always editable, since
// a real pool's locked number can differ). A free-text "add a game by
// hand" fallback covers the rare case where a pool includes something the
// live odds feed doesn't track at all (e.g. an FCS opponent, a rivalry
// game the tracked book skipped).
//
// Deliberately reuses applyParsedPoolData() -- the SAME merge/archive/
// pick-limit pipeline the PDF and paste import paths already use and this
// project already tested thoroughly -- rather than inventing a parallel
// pool-mutation path. A "manual" games array is just a third way to
// produce the {source, pickLimit, games} shape that function already
// accepts; nothing about how it gets applied to the pool needed to change.
let poolManualState={}; // poolId -> {weekIdx, customGames:[{away,home,line}]}

function poolManualGamesForWeek(weekIdx){
  const win=windowForWeek(weekIdx);
  return (state.lastGames||[]).filter(g=>inWeek(g.commence,win))
    .slice().sort((a,b)=>(Date.parse(a.commence)||0)-(Date.parse(b.commence)||0));
}
function togglePoolManualBox(poolId){
  const box=document.getElementById("poolManualBox_"+poolId);
  if(!box) return;
  const opening=(box.style.display==="none");
  if(opening){ renderPoolManualBox(poolId); box.style.display="block"; }
  else{ box.style.display="none"; delete poolManualState[poolId]; }
  closeAllPoolMenus();
}
function renderPoolManualBox(poolId){
  const box=document.getElementById("poolManualBox_"+poolId);
  if(!box) return;
  const st=poolManualState[poolId]||(poolManualState[poolId]={weekIdx:currentWeekIndex(),customGames:[]});
  const wkGames=poolManualGamesForWeek(st.weekIdx);
  const rowsHTML=wkGames.length?wkGames.map(g=>{
    const gid=esc(mkey(g.away,g.home));
    const lineVal=(g.vegas!=null)?g.vegas:"";
    return `<label class="pool-manual-row">
      <input type="checkbox" data-manual-check="${gid}" data-manual-away="${esc(g.away)}" data-manual-home="${esc(g.home)}" data-manual-commence="${esc(g.commence||"")}">
      <span class="pool-manual-teams">${esc(g.away)} @ ${esc(g.home)}</span>
      <input type="number" step="0.5" class="pool-manual-line" data-manual-line-for="${gid}" value="${lineVal}" placeholder="spread" inputmode="decimal">
    </label>`;
  }).join(""):`<div class="pool-manual-empty">No live games loaded for ${esc(weekLabel(st.weekIdx))} yet — refresh lines on the Edge Board, or add games by hand below.</div>`;
  const customHTML=st.customGames.map((cg,i)=>
    `<div class="pool-manual-custom-row"><span>${esc(cg.away)} @ ${esc(cg.home)} · ${cg.line==null?"—":fmt(cg.line)}</span><button class="pool-manual-remove" data-manual-remove-custom="${i}" aria-label="Remove">✕</button></div>`
  ).join("");
  box.innerHTML=`
    <div style="font-size:11.5px;color:var(--muted);margin-bottom:8px;">
      Pick which real games belong in this pool and set YOUR pool's locked spread for each — starts from the live market line, but always edit it to match what your actual sheet shows. Works for a pool on any site.
    </div>
    <div class="pool-manual-week-row">
      <button class="iconbtn" data-manual-week-prev="${poolId}" aria-label="Previous week">◀</button>
      <b>${esc(weekLabel(st.weekIdx))}</b>
      <button class="iconbtn" data-manual-week-next="${poolId}" aria-label="Next week">▶</button>
    </div>
    <div class="pool-manual-list">${rowsHTML}</div>
    <div class="pool-manual-custom">
      <div style="font-size:11px;color:var(--muted);margin:8px 0 4px;">Game not listed above? Add it by hand:</div>
      <div class="pool-manual-custom-add">
        <input type="text" id="poolManualCustomAway_${poolId}" placeholder="Away team">
        <input type="text" id="poolManualCustomHome_${poolId}" placeholder="Home team">
        <input type="number" step="0.5" id="poolManualCustomLine_${poolId}" placeholder="Spread (home)" inputmode="decimal">
        <button class="iconbtn" data-manual-add-custom="${poolId}">+ add game</button>
      </div>
      <div class="pool-manual-custom-list">${customHTML}</div>
    </div>
    <div class="pool-manual-actions">
      <button class="iconbtn" data-manual-save="${poolId}">Save selected games</button>
      <button class="iconbtn" data-manual-cancel="${poolId}">cancel</button>
    </div>`;
  wirePoolManualBox(poolId);
}
function wirePoolManualBox(poolId){
  const box=document.getElementById("poolManualBox_"+poolId);
  if(!box) return;
  const prevBtn=box.querySelector(`[data-manual-week-prev="${poolId}"]`);
  if(prevBtn) prevBtn.onclick=()=>{ poolManualState[poolId].weekIdx--; renderPoolManualBox(poolId); };
  const nextBtn=box.querySelector(`[data-manual-week-next="${poolId}"]`);
  if(nextBtn) nextBtn.onclick=()=>{ poolManualState[poolId].weekIdx++; renderPoolManualBox(poolId); };
  const addBtn=box.querySelector(`[data-manual-add-custom="${poolId}"]`);
  if(addBtn) addBtn.onclick=async()=>{
    const awayEl=document.getElementById("poolManualCustomAway_"+poolId);
    const homeEl=document.getElementById("poolManualCustomHome_"+poolId);
    const lineEl=document.getElementById("poolManualCustomLine_"+poolId);
    const away=(awayEl&&awayEl.value||"").trim(), home=(homeEl&&homeEl.value||"").trim();
    if(!away||!home){ await pgAlert({title:"Missing team names",message:"Enter both an away and a home team before adding."}); return; }
    const lineRaw=lineEl?lineEl.value:"";
    const line=(lineRaw===""||isNaN(Number(lineRaw)))?null:Number(lineRaw);
    poolManualState[poolId].customGames.push({away,home,line});
    renderPoolManualBox(poolId);
  };
  box.querySelectorAll("[data-manual-remove-custom]").forEach(b=>{
    b.onclick=()=>{
      poolManualState[poolId].customGames.splice(Number(b.dataset.manualRemoveCustom),1);
      renderPoolManualBox(poolId);
    };
  });
  const saveBtn=box.querySelector(`[data-manual-save="${poolId}"]`);
  if(saveBtn) saveBtn.onclick=async()=>{
    const st=poolManualState[poolId];
    const checked=[];
    box.querySelectorAll("[data-manual-check]:checked").forEach(cb=>{
      const key=cb.dataset.manualCheck;
      const lineInput=box.querySelector(`[data-manual-line-for="${CSS.escape(key)}"]`);
      const lineRaw=lineInput?lineInput.value:"";
      checked.push({
        away:cb.dataset.manualAway, home:cb.dataset.manualHome,
        commence:cb.dataset.manualCommence||null,
        line:(lineRaw===""||isNaN(Number(lineRaw)))?null:Number(lineRaw),
      });
    });
    const custom=(st?st.customGames:[]).map(cg=>({away:cg.away,home:cg.home,commence:null,line:cg.line}));
    const allGames=[...checked,...custom];
    if(!allGames.length){
      await pgAlert({title:"Nothing selected",message:"Check at least one game above, or add one by hand, before saving."});
      return;
    }
    const statusEl=document.getElementById("poolStatus");
    // pickLimit:null -- applyParsedPoolData() only overwrites an existing
    // pool's pickLimit when a real number is given (see its own "if(data.
    // pickLimit)" check), so this correctly leaves whatever pick limit the
    // pool already has untouched, same as re-importing an existing pool's
    // sheet does.
    await applyParsedPoolData({source:"manual", pickLimit:null, games:allGames, count:allGames.length}, poolId, statusEl);
    box.style.display="none";
    delete poolManualState[poolId];
  };
  const cancelBtn=box.querySelector(`[data-manual-cancel="${poolId}"]`);
  if(cancelBtn) cancelBtn.onclick=()=>{ box.style.display="none"; delete poolManualState[poolId]; };
}
async function removeActivePool(){
  const p=currentPool(); if(!p) return;
  await deletePoolById(p.id);
}
// Generalized version of removeActivePool() -- works on any pool id, not
// just whichever one happens to be active, so the Pools tab's per-card
// delete button doesn't need to switch context first just to delete.
// removeActivePool() (used by the Edge Board toolbar's existing ✕ pool
// button) is now a thin wrapper over this.
async function deletePoolById(poolId){
  const p=(state.pools||[]).find(x=>x.id===poolId);
  if(!p) return;
  if(!await pgConfirm({
    title:"Delete pool?",
    eyebrow:"Permanent deletion",
    message:`Permanently delete "${p.name}" and all its picks?\n\nArchived weeks for this pool will also be deleted. This can't be undone.`,
    confirmText:"Delete pool",
    danger:true
  })) return;
  state.pools=(state.pools||[]).filter(x=>x.id!==poolId);
  if(state.activeContext===poolId) state.activeContext="overall";
  save(); renderContextAll();
  const st=document.getElementById("poolStatus"); if(st) st.textContent="";
  renderPoolsPage();
}
// Soft removal -- hides the pool from the normal Pools list and the
// Context Bar's "Viewing" switcher, but keeps every bit of its data
// (games, entries, picks, history) intact and reversible. Unlike
// deletePoolById(), this needs no confirmation -- nothing is actually lost.
function archivePool(poolId){
  const p=(state.pools||[]).find(x=>x.id===poolId);
  if(!p) return;
  p.archived=true;
  if(state.activeContext===poolId) state.activeContext="overall";
  save(); renderContextAll();
  renderPoolsPage();
}
function unarchivePool(poolId){
  const p=(state.pools||[]).find(x=>x.id===poolId);
  if(!p) return;
  delete p.archived;
  save(); renderContextAll();
  renderPoolsPage();
}
// Explicit "create a pool with nothing in it yet" action for the Pools
// tab's "+ New pool" button. Previously a pool could ONLY come into
// existence as a side effect of importing a sheet (see importPool()'s
// own pool-creation branch below, which this mirrors the shape of --
// same fields, just games:[] instead of a real sheet's data) -- that's
// still how pickLimit/games normally get set for real use, but someone
// setting up a pool ahead of a sheet being available now has a place to
// start.
async function createEmptyPool(){
  const values=await pgForm({
    title:"Create a new pool",
    message:"Set up the contest now. You can import its weekly sheet afterward.",
    confirmText:"Create pool",
    fields:[
      {name:"name",label:"Pool name",value:"",placeholder:"Office ATS Pool",required:true},
      {name:"pickLimit",label:"Picks per entry",value:"7",type:"number",inputMode:"numeric",min:1,step:1,required:true}
    ],
    validate:v=>{
      if(!String(v.name||"").trim()) return "Enter a pool name.";
      const n=parseInt(v.pickLimit,10);
      if(!n||n<1) return "Pick limit needs to be a whole number of at least 1.";
      return null;
    }
  });
  if(!values) return;
  const name=String(values.name).trim();
  const limit=parseInt(values.pickLimit,10);
  const pool={
    id:uid(), name, source:"manual", pickLimit:limit,
    importedAt:new Date().toISOString(),
    games:[], weekLabel:"",
    entries:[{id:uid(),name:"Entry 1",picks:{}}], activeEntryId:null,
    history:[]
  };
  pool.activeEntryId=pool.entries[0].id;
  state.pools=state.pools||[];
  state.pools.push(pool);
  state.activeContext=pool.id;
  save(); renderContextAll();
  renderPoolsPage();
}
// Renders the Pools tab: Overall pinned at top (no delete/archive/share --
// it isn't a real pool, just the default analysis context), then every
// non-archived pool as a row, then a collapsed Archived section. Called
// from switchTab("pools") and after any pool-list mutation above.
function renderPoolsPage(){
  const overallCard=document.getElementById("poolsOverallCard");
  if(overallCard){
    const activeNow=!currentPool();
    overallCard.innerHTML=`<div class="pool-overall-card">
      <div>
        <span class="nm">Overall board</span>
        <span class="pool-status">The default analysis context — every game the odds feed covers, not tied to any specific contest.</span>
      </div>
      ${activeNow?'<span class="badge" style="background:#F0FAF3;color:var(--green-text);">currently viewing</span>'
        :'<button class="btn btn-light" data-view-overall>View</button>'}
    </div>`;
    const viewBtn=overallCard.querySelector("[data-view-overall]");
    if(viewBtn) viewBtn.onclick=()=>{ switchContext("overall"); };
  }

  const pools=state.pools||[];
  const active=pools.filter(p=>!p.archived);
  const archived=pools.filter(p=>p.archived);

  const list=document.getElementById("poolsList");
  const empty=document.getElementById("poolsEmpty");
  if(list){
    list.innerHTML=active.map(p=>poolRowHTML(p,false)).join("");
    wirePoolRowActions(list, false);
  }
  if(empty) empty.style.display=active.length?"none":"block";

  const archivedCard=document.getElementById("poolsArchivedCard");
  const archivedList=document.getElementById("poolsArchivedList");
  const archivedCount=document.getElementById("poolsArchivedCount");
  if(archivedCard) archivedCard.style.display=archived.length?"block":"none";
  if(archivedCount) archivedCount.textContent=archived.length;
  if(archivedList){
    archivedList.innerHTML=archived.map(p=>poolRowHTML(p,true)).join("");
    wirePoolRowActions(archivedList, true);
  }
}
function poolRowHTML(p, isArchived){
  const entryCount=(p.entries||[]).length;
  const status=poolLockStatusLabel(p);
  const weekPart=p.weekLabel?p.weekLabel:"no week loaded";
  const history=p.history||[];
  const sharedRec=(typeof state!=="undefined"&&Array.isArray(state.sharedPools))?state.sharedPools.find(sp=>sp&&sp.id===p.id):null;
  const clerkUid=(typeof Clerk!=="undefined"&&Clerk.user&&Clerk.user.id)?Clerk.user.id:null;
  const publishedByMe=!!(sharedRec&&clerkUid&&sharedRec.publishedBy===clerkUid);
  // Tiered action layout, not one flat row of equal-weight buttons: "view"
  // (by far the most frequent tap) and "Import ▾" (a weekly action during
  // an active pool) stay always visible; the rare/admin/destructive ones
  // (edit pick limit, publish/unpublish template, archive, delete) collapse into a
  // "⋮ More" dropdown -- also gets delete a real, if small, extra tap of
  // friction instead of sitting with identical visual weight next to
  // "view". Modeled on .context-switcher's dropdown pattern (see
  // initContextBar()) rather than inventing a second one -- toggle/
  // click-outside-close logic lives in initPoolMenus() below.
  //
  // "paste picks" only works for ESPN's plain-text export shape
  // (importPoolFromText() hardcodes format:"espn_paste" server-side) --
  // hidden specifically when p.source==="splash", a KNOWN mismatch (Splash's
  // sheet glues the spread onto the team name, "Wisconsin(-3.5)", nothing
  // like ESPN's one-value-per-line paste). Deliberately NOT hidden for
  // p.source==="manual" (a brand-new pool from "+ New pool", before its
  // first import ever sets a real source) -- gating on "only show once
  // source is already espn" would make paste unreachable for anyone
  // starting fresh, since nothing else ever sets source to "espn" first.
  //
  // Pool-template publishing is hidden entirely for non-admins (isAdminUser,
  // declared alongside `state` in the main inline script -- see its own
  // comment) rather than shown-and-403'd on click. The backend gate
  // (is_admin() in api/state.py) is unchanged and remains the actual
  // enforcement; this is purely so a non-admin never sees a button that
  // was always going to reject them.
  const row=`<div class="entry pool-row">
    <div class="pool-row-main">
      <span class="nm">${esc(p.name)}</span>
      <span class="pool-status">${esc(weekPart)} · ${esc(status)} · pick ${p.pickLimit||7} · ${entryCount} entr${entryCount===1?"y":"ies"}</span>
    </div>
    <div class="pool-actions">
      ${isArchived?`
        <button class="iconbtn" data-unarchive="${p.id}">unarchive</button>
        <button class="iconbtn" data-delete="${p.id}">delete permanently</button>
      `:`
        <button class="iconbtn" data-view="${p.id}">view</button>
        <div class="pool-menu">
          <button class="pool-menu-trigger" data-pooltrigger="${p.id}_import">Import ▾</button>
          <div class="pool-menu-dropdown" id="poolMenu_${p.id}_import">
            <label class="pool-menu-item" id="poolImportLabel_${p.id}">Upload PDF<input type="file" accept="application/pdf" data-import="${p.id}" style="display:none;"></label>
            ${p.source==="splash"?"":`<button class="pool-menu-item" data-pastetoggle="${p.id}">Paste picks (ESPN)</button>`}
            <button class="pool-menu-item" data-manualtoggle="${p.id}" title="Pick real games from the live slate and set your pool's own locked spread by hand — works for a pool on any site, not just Splash/ESPN/OFP.">Select games manually</button>
          </div>
        </div>
        <div class="pool-menu">
          <button class="pool-menu-trigger" data-pooltrigger="${p.id}_more">⋮ More</button>
          <div class="pool-menu-dropdown" id="poolMenu_${p.id}_more">
            <button class="pool-menu-item" data-editlimit="${p.id}">Edit pick limit</button>
            ${isAdminUser?(publishedByMe
              ?`<button class="pool-menu-item" data-unshare="${p.id}" title="Remove this template from the shared catalog. Existing local copies and picks are untouched.">Unpublish template</button>`
              :sharedRec
                ?`<span class="pool-menu-item" style="color:var(--muted);cursor:default;">Template already published</span>`
                :`<button class="pool-menu-item" data-share="${p.id}" title="Publish this pool structure as a one-time template. Other users' entries and picks stay private.">Publish template</button>`):""}
            <button class="pool-menu-item" data-archive="${p.id}">Archive</button>
            <button class="pool-menu-item danger" data-delete="${p.id}">Delete</button>
          </div>
        </div>
      `}
    </div>
    ${(isArchived||p.source==="splash")?"":`
    <div class="pool-paste-box" id="poolPasteBox_${p.id}" style="display:none;margin-top:8px;">
      <div style="font-size:11.5px;color:var(--muted);margin-bottom:4px;">
        For ESPN College Pick'em: copy the picks list from the live page and paste it here — this reads more reliably than an ESPN PDF export, but carries no kickoff time, so the week label may come back blank.
      </div>
      <textarea id="poolPasteText_${p.id}" rows="6" style="width:100%;font-family:monospace;font-size:12px;" placeholder="Team A&#10;+3.5&#10;0-0&#10;40% Picked&#10;Team B&#10;-3.5&#10;0-0&#10;60% Picked&#10;..."></textarea>
      <div style="margin-top:6px;">
        <button class="iconbtn" data-pastesubmit="${p.id}">import pasted picks</button>
        <button class="iconbtn" data-pastecancel="${p.id}">cancel</button>
      </div>
    </div>`}
    ${isArchived?"":`
    <div class="pool-manual-box" id="poolManualBox_${p.id}" style="display:none;margin-top:8px;"></div>`}
  </div>`;
  // Week history -- only shown when there's actually something to browse,
  // same "don't clutter the empty case" call as the top-level Archived
  // section only appearing once archived.length>0. Read-only summary here
  // (label/date/entry count) rather than duplicating restore/grading --
  // that logic already exists and is well-exercised in Results, so this
  // just gets you to the right pool context and hands off to it, instead
  // of re-implementing restoreWeek()/setResult() a second time on a
  // second page with a second chance to drift from the original.
  const historyBlock=(isArchived||!history.length)?"":`
    <details class="pool-history">
      <summary style="cursor:pointer;color:var(--muted);font-size:12.5px;padding:0 0 8px;">Week history (${history.length})</summary>
      <div class="pool-history-list">
        ${history.map(w=>{
          const dateStr=w.closedAt?new Date(w.closedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):"";
          const entCount=(w.entries||[]).length;
          return `<div class="pool-history-row">
            <span>${esc(w.label||"Week")}${dateStr?` — closed ${esc(dateStr)}`:""} · ${entCount} entr${entCount===1?"y":"ies"}</span>
          </div>`;
        }).join("")}
        <button class="iconbtn" data-viewresults="${p.id}" style="margin-top:6px;">View in Results →</button>
      </div>
    </details>`;
  return row+historyBlock;
}
function wirePoolRowActions(container, isArchived){
  container.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{ switchContext(b.dataset.view); switchTab("board"); });
  container.querySelectorAll("[data-archive]").forEach(b=>b.onclick=()=>archivePool(b.dataset.archive));
  container.querySelectorAll("[data-unarchive]").forEach(b=>b.onclick=()=>unarchivePool(b.dataset.unarchive));
  container.querySelectorAll("[data-delete]").forEach(b=>b.onclick=async()=>{ await deletePoolById(b.dataset.delete); });
  container.querySelectorAll("[data-editlimit]").forEach(b=>b.onclick=async()=>{ await editPoolPickLimit(b.dataset.editlimit); });
  container.querySelectorAll("[data-viewresults]").forEach(b=>b.onclick=()=>{ switchContext(b.dataset.viewresults); switchTab("record"); });
  container.querySelectorAll("[data-share]").forEach(b=>b.onclick=async()=>{
    b.disabled=true; const orig=b.textContent; b.textContent="publishing…";
    const {ok,error}=await pushPoolToShared(b.dataset.share);
    b.textContent=ok?"✓ published":orig; b.disabled=false;
    const st=document.getElementById("poolStatus");
    if(st){
      st.style.color=ok?"var(--green-text)":"#B91C1C";
      st.textContent=ok?"Template published. Existing users' local copies will not be overwritten.":(error||"Couldn't publish that template.");
    }
    if(ok) renderPoolsPage();
  });
  container.querySelectorAll("[data-unshare]").forEach(b=>b.onclick=async()=>{
    b.disabled=true; const orig=b.textContent; b.textContent="removing…";
    const {ok,error}=await unpublishPoolTemplate(b.dataset.unshare);
    b.textContent=orig; b.disabled=false;
    const st=document.getElementById("poolStatus");
    if(st){
      st.style.color=ok?"var(--green-text)":"#B91C1C";
      st.textContent=ok?"Template unpublished. Existing local copies and picks were left untouched.":(error||"Couldn't unpublish that template.");
    }
    if(ok) renderPoolsPage();
  });
  // "⋮ More"/"Import ▾" dropdown triggers -- toggles that ONE menu, closing
  // any other open pool menu first (only one open at a time). The
  // click-outside-to-close half of this lives in initPoolMenus(), called
  // once at app startup (same split as initContextBar()/
  // closeContextSwitcher() for the Context Bar's own dropdown).
  container.querySelectorAll("[data-pooltrigger]").forEach(b=>b.onclick=()=>{
    const dd=document.getElementById("poolMenu_"+b.dataset.pooltrigger);
    if(!dd) return;
    const wasOpen=dd.classList.contains("open");
    closeAllPoolMenus();
    if(!wasOpen) dd.classList.add("open");
  });
  container.querySelectorAll("[data-import]").forEach(inp=>{
    inp.onchange=()=>{
      const f=inp.files&&inp.files[0];
      if(f) importPool(f, inp.dataset.import);
      inp.value="";
    };
  });
  // Paste-picks box stays inline per pool row rather than moving into the
  // shared modal: this is a longer multi-line workspace, not a short dialog,
  // and keeping it beside the pool being updated makes the destination clear.
  container.querySelectorAll("[data-pastetoggle]").forEach(b=>b.onclick=()=>{
    const box=document.getElementById("poolPasteBox_"+b.dataset.pastetoggle);
    if(box) box.style.display=(box.style.display==="none")?"block":"none";
    // Close the "Import ▾" dropdown this button lives in -- otherwise it
    // sits open, absolutely-positioned, right on top of the paste box that
    // just appeared underneath it.
    closeAllPoolMenus();
  });
  // "Select games manually" box: same inline-not-modal reasoning as the
  // paste box above, plus it needs a real scrollable checklist (a whole
  // week's live slate) that the shared pgForm() dialog system was never
  // built to hold.
  container.querySelectorAll("[data-manualtoggle]").forEach(b=>b.onclick=()=>{
    togglePoolManualBox(b.dataset.manualtoggle);
  });
  container.querySelectorAll("[data-pastecancel]").forEach(b=>b.onclick=()=>{
    const id=b.dataset.pastecancel;
    const box=document.getElementById("poolPasteBox_"+id);
    const ta=document.getElementById("poolPasteText_"+id);
    if(ta) ta.value="";
    if(box) box.style.display="none";
  });
  container.querySelectorAll("[data-pastesubmit]").forEach(b=>b.onclick=async()=>{
    const id=b.dataset.pastesubmit;
    const ta=document.getElementById("poolPasteText_"+id);
    const text=ta?ta.value:"";
    const orig=b.textContent;
    b.disabled=true; b.textContent="importing…";
    await importPoolFromText(text, id);
    b.disabled=false; b.textContent=orig;
    // renderPoolsPage() (called inside applyParsedPoolData on success) fully
    // re-renders this row, so no need to manually hide the box or clear the
    // textarea here -- a fresh, empty, closed box is what comes back either
    // way. On failure poolStatus already shows the error.
  });
}
// Closes every open "Import ▾"/"⋮ More" pool-row dropdown -- called both
// when a trigger opens a DIFFERENT menu (only one open at a time) and by
// initPoolMenus()'s click-outside listener below.
function closeAllPoolMenus(){
  document.querySelectorAll(".pool-menu-dropdown.open").forEach(dd=>dd.classList.remove("open"));
}
// One-time setup (called once from init.js, same split as
// initContextBar()/closeContextSwitcher() for the Context Bar's own
// dropdown) -- a single document-level click-outside-to-close listener
// rather than one per dropdown, since renderPoolsPage() rebuilds every pool
// row (and therefore every dropdown) on every action; re-registering a
// document listener on each of those rebuilds would pile up duplicates.
//
// Uses composedPath(), not element.contains(e.target) -- same reasoning as
// initContextBar()'s own comment: a click on a menu item (e.g. "Archive")
// can trigger renderPoolsPage() synchronously as part of handling ITS OWN
// click, detaching the original button from the document before this
// bubble-phase listener runs. composedPath() reports the dispatch path
// captured at the moment the click happened, so a since-detached trigger
// still correctly shows up as "inside a pool-menu."
function initPoolMenus(){
  document.addEventListener("click",(e)=>{
    const path=(typeof e.composedPath==="function")?e.composedPath():null;
    const insideAMenu=path
      ? path.some(el=>el.classList&&el.classList.contains("pool-menu"))
      : !!(e.target.closest&&e.target.closest(".pool-menu"));
    if(!insideAMenu) closeAllPoolMenus();
  });
}
// Lets a pool's pick limit be corrected after the fact -- previously only
// settable at creation time (either typed by hand in createEmptyPool(),
// or parsed/asked for during importPool()) with no way to fix a mistake
// short of re-importing the sheet.
async function editPoolPickLimit(poolId){
  const p=(state.pools||[]).find(x=>x.id===poolId);
  if(!p) return;
  const entered=await pgPrompt({
    title:"Edit pick limit",
    message:`How many picks does "${p.name}" allow per entry?`,
    label:"Picks per entry",
    value:String(p.pickLimit||7),
    type:"number",
    inputMode:"numeric",
    min:1,
    step:1,
    required:true,
    confirmText:"Save limit",
    validate:value=>{ const n=parseInt(value,10); return n>=1?null:"Enter a whole number of at least 1."; }
  });
  if(entered===null) return;
  const limit=parseInt(entered,10);
  // The modal validates this before resolving; keep the guard here too so a
  // future dialog refactor can never write an invalid limit into state.
  if(!limit||limit<1) return;
  p.pickLimit=limit;
  save(); renderContextAll();
  renderPoolsPage();
}
