// --- App init: event wiring, bootstrap, error boundary --------------------
// Split out of app/index.html as part of the JS-splitting pass -- the
// LAST section split, and handled differently from every one before it.
//
// IMPORTANT -- read before touching this file or its call sites:
// Every other split-out file (model.js, board.js, picks.js, etc.) moved
// 100% of its code with nothing left behind, because everything in them
// was lazily-called function bodies with no immediate top-level
// execution -- load order relative to the main script genuinely didn't
// matter. This file is different: two of its functions
// (initErrorBoundary() and bootstrap()) are also IMMEDIATELY INVOKED at
// specific, order-critical points -- the very first and very last
// statements of the whole app. Those two invocations were deliberately
// NOT moved here -- they still live in app/index.html itself, exactly
// where they were:
//
//   <script src="/app/js/init.js"></script>   <- this file (defines
//                                                 initErrorBoundary,
//                                                 bootstrap, init,
//                                                 rehydrateAfterSync,
//                                                 clearColumn -- but
//                                                 calls none of them)
//   <script>
//     initErrorBoundary();   <- FIRST statement of the main inline
//                                script, unchanged from before. Must run
//                                before anything else so it can catch an
//                                error anywhere below it, including
//                                during the main script's own early
//                                setup. Works correctly split out this
//                                way because by the time this line
//                                executes, every <script src> tag above
//                                it (including this file) has already
//                                loaded, so initErrorBoundary is already
//                                a defined global -- same reasoning as
//                                every other split file, just for a
//                                function that happens to be called
//                                immediately instead of later.
//     ... rest of the main inline script (all the still-inline setup,
//     state normalization, DEMO data, utility functions) ...
//     bootstrap();            <- LAST statement of the main inline
//                                script, unchanged from before. The
//                                actual entry point -- waits for Clerk,
//                                then calls init() (defined in THIS
//                                file). Deliberately still the very last
//                                line so everything above it (all still-
//                                inline setup) has already run by the
//                                time the app actually boots.
//   </script>
//
// If either invocation is ever accidentally moved into this file, or
// this file's <script> tag is ever moved to AFTER the main inline
// script, the error boundary would no longer be registered before the
// main script's own early setup runs, defeating the entire point of
// "registered first" -- verify this ordering is still intact after any
// future edit here, not just that the code still parses.
//
// Function bodies in this file, briefly:
//   - clearColumn() -- the granular "clear BP/Comp/PDF/predictions"
//     control in Settings.
//   - init() -- all DOM event-listener wiring (every button/select/input
//     onclick/onchange in the app gets bound here) plus the first full
//     render pass. Only ever called once, from bootstrap(), after Clerk
//     auth resolves -- by then the DOM is fully parsed and every other
//     script has loaded, so the heavy use of document.getElementById()
//     throughout is safe.
//   - rehydrateAfterSync() -- re-renders everything + re-syncs a few DOM
//     inputs (API key field, book select, thresholds) after a state
//     swap from cross-device sync -- a lighter-weight sibling of init(),
//     no event-listener rebinding (those are already bound).
//   - initErrorBoundary() -- registers the global error boundary
//     (window 'error' + 'unhandledrejection' listeners). See its own
//     detailed comment below for the two failure modes it catches and
//     why it's a dismissible banner, not a full-page takeover.
//   - bootstrap() -- waits for Clerk to load, shows either the sign-in
//     gate or the app, and calls init() the first time a signed-in user
//     is seen (both at initial load and after a live sign-in event).
//
// Loaded as a plain <script src="/app/js/init.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies -- except the two invocations
// explicitly called out above, which don't live in this file at all):
//   - `state`, `KEY` -- global app state and its localStorage key (main
//     inline script).
//   - Every renderX()/fetchX()/applyX() function from every other split
//     file (board.js, picks.js, odds.js, settings.js, record.js,
//     tabs.js, sync.js, pdf-import.js, pool-contexts.js,
//     prediction-tracker.js) -- init()/rehydrateAfterSync() are the
//     functions that tie every other split file together into one app,
//     which is exactly why they're the last to be split and need the
//     most care.
//   - `save()`/`saveLocal()`/`load()` -- persistence (main inline
//     script).
// Granular clear. None of these touch picks, entries, or the Results tab
// (tab label renamed from "Record" -- internal id/file name unchanged,
// see app/index.html's tab-button comment for why).
//  bp/comp: blank that column everywhere, and stop it re-filling from a stored PDF.
//  pdf:     drop imported PDF data (leaves any values already in the columns).
//  pred:    drop loaded prediction data + its columns.
//  all:     BP + Comp + imported PDF.
async function clearColumn(which){
  const msg={
    bp:"Clear the BP column for every game?",
    comp:"Clear the Comp column for every game?",
    pdf:"Remove imported Powers PDF data?",
    pred:"Remove loaded prediction data?",
    all:"Clear BP, Comp, and imported PDF data for every game?"
  }[which];
  if(!msg||!await pgConfirm({
    title:"Clear data?",
    message:msg+"\n\nThis does NOT affect your picks, entries, or results.",
    confirmText:"Clear",
    danger:true
  })) return;
  if(which==="bp"||which==="comp"){
    const idx=which==="bp"?0:1;
    Object.keys(state.inputs).forEach(k=>{ if(Array.isArray(state.inputs[k])) state.inputs[k][idx]=null; });
    (state.pdfGames||[]).forEach(g=>{ g[which]=null; }); // don't let it re-fill on next apply
  }else if(which==="pdf"){
    state.pdfGames=null;
    const ps=document.getElementById("pdfStatus"); if(ps) ps.textContent="";
  }else if(which==="pred"){
    state.predictions=null; state.predMeta=null; predByKey={};
    const ps=document.getElementById("predStatus"); if(ps) ps.textContent="";
    renderSystemsSettings();
  }else if(which==="all"){
    state.pdfGames=null; state.inputs={};
    const ps=document.getElementById("pdfStatus"); if(ps) ps.textContent="";
  }
  // "pred" used to also clear the SHARED predictions cache for every
  // signed-in user via action=clear_predictions -- that endpoint let any
  // one person wipe predictions for everyone else and has been removed
  // server-side (see api/state.py). This now behaves like every other
  // branch here: local-only, stops showing predictions on THIS
  // device/account without touching the shared cache anyone else reads.
  save();
  buildGames(); applyPdfData(); applyPredictions(); applyTeamLogos(); migrateGameKeys(); sortGames(); renderBoard();
}
async function init(){
  // Self-hosted worker, matching the self-hosted pdf.min.js load in
  // app/index.html -- see that script tag's comment for why cdnjs was
  // dropped entirely rather than pinned+SRI'd.
  if(window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc="/app/vendor/pdfjs/pdf.worker.min.js";
  // #pdfFile's onchange is NOT bound here anymore -- the element now lives
  // inside the JS-rendered prediction-systems grid (see
  // renderSystemsSettings() in app/js/prediction-tracker.js, called later
  // in this same function), which doesn't exist in the DOM yet at this
  // point and gets destroyed/recreated on every re-render anyway. Binding
  // here would either throw (element not created yet) or immediately go
  // stale (element replaced moments later) -- renderSystemsSettings()
  // rebinds it itself every time it renders, same pattern already used
  // there for [data-sys]/.sys-weight.
  document.querySelectorAll("nav.tabs button").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  document.querySelectorAll(".icon-nav-btn").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  initNavTabsScrollHint();
  initNavHamburger();
  initPickBoardNav();
  // Sort & filter panel (Edge Board): open by default on desktop (matches
  // its old always-visible layout), collapsed by default on mobile (the
  // actual fix for the real screenshot -- 4 stacked full-width rows eating
  // over half a phone screen before a single game was visible). Set ONCE
  // here at startup from the current viewport width, deliberately NOT on
  // every resize -- re-checking on resize would silently re-close a panel
  // someone had deliberately opened, just because their window happened to
  // cross the breakpoint (e.g. rotating a tablet). A person can always
  // toggle it themselves afterward; this only sets the sensible starting
  // point.
  const sfPanel=document.getElementById("boardSortFilterPanel");
  if(sfPanel) sfPanel.open=(window.innerWidth>720);
  initContextBar();
  initPoolMenus();
  if(typeof initMyNumbers==="function") initMyNumbers();
  if(typeof initBetaFeedback==="function") initBetaFeedback();
  document.querySelectorAll("#scoreToggle .toggle-btn").forEach(b=>{
    b.onclick=()=>{ state.snapRankByCover=(b.dataset.score==="1"); save(); renderSnapshot(); };
  });
  document.querySelectorAll("#snapFilterPills .pill-btn").forEach(b=>{
    b.onclick=()=>{ state.snapFilter=b.dataset.filter; save(); renderSnapshot(); };
  });
  const snapFullBoardBtn=document.getElementById("snapFullBoardBtn");
  if(snapFullBoardBtn) snapFullBoardBtn.onclick=()=>switchTab("board");
  const snapSeeAllBtn=document.getElementById("snapSeeAllBtn");
  if(snapSeeAllBtn) snapSeeAllBtn.onclick=()=>switchTab("board");
  document.getElementById("refreshBtn").onclick=refreshLines;
  document.getElementById("resortBtn").onclick=()=>{ sortGames(); renderBoard(); };
  if(typeof initBoardExport==="function") initBoardExport();
  const mSel=document.getElementById("mobileSortSel");
  if(mSel) mSel.onchange=()=>setSort(mSel.value);
  const mDirBtn=document.getElementById("mobileSortDirBtn");
  if(mDirBtn) mDirBtn.onclick=()=>{
    state.sortDir=(state.sortDir==="asc"?"desc":"asc");
    save();
    sortGamesBy(state.sortKey,state.sortDir);
    renderBoard();
  };
  const headRow=document.getElementById("boardHeadRow");
  if(headRow) headRow.addEventListener("click",e=>{
    const th=e.target.closest("th.sortable");
    if(th && th.dataset.sortkey) setSort(th.dataset.sortkey);
  });
  // contextSel's onchange is now bound inside renderContextSelect() itself,
  // for every element with class="ctx-select" (board + snapshot tabs both
  // have one) -- not just this single element.
  // poolFile/removePoolBtn/sharePoolBtn's toolbar wiring lived here --
  // removed along with those buttons once the Pools tab's per-pool import
  // sheet/archive/delete/template-publishing actions covered the same
  // ground with real mileage behind them (see the Pools tab build-out).
  // removeActivePool()/pushPoolToShared() themselves are untouched --
  // still called from app/js/pool-contexts.js's wirePoolRowActions().
  const newPoolBtn=document.getElementById("poolsNewBtn"); if(newPoolBtn) newPoolBtn.onclick=atsStartPoolWizard;
  const poolSettingsCreateBtn=document.getElementById("poolSettingsCreateBtn");
  if(poolSettingsCreateBtn) poolSettingsCreateBtn.onclick=atsStartPoolWizard;
  const poolSettingsWeekBtn=document.getElementById("poolSettingsWeekBtn");
  const poolSettingsWeekFile=document.getElementById("poolSettingsWeekFile");
  if(poolSettingsWeekBtn&&poolSettingsWeekFile){
    poolSettingsWeekBtn.onclick=()=>{
      const p=currentPool();
      if(!p) return;
      if(p.lineSource==="manual"){
        togglePoolManualBox(p.id);
        requestAnimationFrame(()=>document.getElementById("poolManualBox_"+p.id)?.scrollIntoView({behavior:"smooth",block:"center"}));
        return;
      }
      poolSettingsWeekFile.click();
    };
    poolSettingsWeekFile.onchange=()=>{
      const f=poolSettingsWeekFile.files&&poolSettingsWeekFile.files[0];
      const p=currentPool();
      if(f&&p) importPool(f,p.id,"poolSettingsTaskStatus");
      poolSettingsWeekFile.value="";
    };
  }
  const poolSettingsEntriesBtn=document.getElementById("poolSettingsEntriesBtn");
  if(poolSettingsEntriesBtn) poolSettingsEntriesBtn.onclick=()=>{ if(currentPool()) switchTab("picks"); };
  // Top-level "Import a pool sheet" card (Pools tab) -- creates a NEW pool
  // directly from a first import, no targetPoolId, same code path
  // applyParsedPoolData() already had for this (see its own comment) but
  // that previously had no reachable UI entry point: the only import
  // controls lived per-pool-row, which meant a first-time user had to
  // already know to click "+ New pool" and answer two prompts before any
  // import option even appeared. This is that missing first step.
  const topImportFile=document.getElementById("poolsTopImportFile");
  if(topImportFile) topImportFile.onchange=()=>{
    const f=topImportFile.files&&topImportFile.files[0];
    if(f) importPool(f, null, "poolsTopImportStatus");
    topImportFile.value="";
  };
  const topPasteBtn=document.getElementById("poolsTopPasteBtn");
  if(topPasteBtn) topPasteBtn.onclick=async()=>{
    const ta=document.getElementById("poolsTopPasteText");
    const text=ta?ta.value:"";
    const orig=topPasteBtn.textContent;
    topPasteBtn.disabled=true; topPasteBtn.textContent="importing…";
    await importPoolFromText(text, null, "poolsTopImportStatus");
    topPasteBtn.disabled=false; topPasteBtn.textContent=orig;
    if(ta) ta.value="";
  };
  const csel=document.getElementById("clearSel"); if(csel) csel.onchange=()=>{ const v=csel.value; csel.value=""; if(v) clearColumn(v); };
  const afChk2=document.getElementById("alignFilterChk"); if(afChk2) afChk2.onchange=()=>{ state.boardFilter=afChk2.checked?"aligned":"all"; save(); renderBoard(); };
  const sfChk2=document.getElementById("shortlistFilterChk"); if(sfChk2) sfChk2.onchange=()=>{ state.boardShortlistOnly=sfChk2.checked; save(); renderBoard(); };
  // #loadPredsBtn is NOT bound here -- it now lives inside #loadPredsControl,
  // dynamically (re)created by renderLoadPredsControl() (app/js/board.js) on
  // every renderBoard() call, same reason and same fix already applied
  // once this session to the Prediction Systems grid's #pdfFile: binding a
  // one-time handler to an element that doesn't exist yet at this point in
  // init() (and gets replaced moments later anyway) would either throw or
  // go stale immediately. renderLoadPredsControl() rebinds it itself, every
  // render.
  const wp=document.getElementById("weekPrev"); if(wp) wp.onclick=()=>shiftWeek(-1);
  const wn=document.getElementById("weekNext"); if(wn) wn.onclick=()=>shiftWeek(1);
  const wall=document.getElementById("weekAll"); if(wall) wall.onclick=()=>setWeekAnchor(state.weekAnchor==="ALL"?null:"ALL");
  const wj=document.getElementById("weekJump"); if(wj) wj.onchange=()=>{ if(wj.value){ const i=weekIndexOf(wj.value+"T12:00:00"); if(i!=null) setWeekAnchor(i); } };
  const lp2=document.getElementById("loadPredsBtn2"); if(lp2) lp2.onclick=fetchPredictions;
  const pgModelBtn=document.getElementById("pickGaugeModelBtn"); if(pgModelBtn) pgModelBtn.onchange=applyPickGaugeModelPreset;
  const sysClr=document.getElementById("sysClear");
  if(sysClr) sysClr.onclick=()=>{
    state.pickGaugeModelEnabled=false;
    state.enabledSystems=[];
    state.weights={};
    save(); renderSystemsSettings(); renderBoard(); updateSystemsCount();
  };
  const rw=document.getElementById("resetWeights");
  if(rw) rw.onclick=()=>{
    // Can't just clear state.weights anymore -- defaults aren't uniform
    // (see weightOf()): "pickgauge" defaults to 3, not 1, so clearing
    // its stored weight would silently jump it back to 3, not equalize
    // it with everything else. Explicitly write 1 for every input that's
    // actually in play (BP, Comp, Vegas -- Vegas now defaults to 1 like
    // everything else as of Sept 2, 2026, but is still spelled out here
    // rather than relying on the default, in case that ever changes --
    // and every currently-enabled prediction system) instead.
    const w={};
    ["bp","comp","vegas",...enabledSystemsOrdered()].forEach(k=>{ w[k]=1; });
    state.weights=w; save(); renderSystemsSettings(); renderBoard();
  };
  // activeEntrySel's onchange is now bound inside renderEntrySelect()
  // itself, for every element with class="entry-select".
  document.getElementById("addEntryBtn").onclick=()=>{
    const nm=document.getElementById("newEntryName").value.trim()||("Entry "+(activeEntries().length+1));
    const ne={id:uid(),name:nm,picks:{}};
    const _p=currentPool(); if(_p) _p.entries.push(ne); else state.entries.push(ne); setCtxActiveEntryId(ne.id); save();
    document.getElementById("newEntryName").value="";
    syncAll();
  };
  document.getElementById("closeWeekBtn").onclick=closeWeek;
  document.getElementById("checkResultsBtn").onclick=async()=>{
    const btn=document.getElementById("checkResultsBtn");
    const m=document.getElementById("gradeMsg");
    btn.disabled=true; btn.textContent="↻ Checking…";
    m.className="note"; m.textContent="";
    try{
      const result=await apiFetch("/api/grade_picks",{});
      if(!result.ok){ m.className="err"; m.textContent=result.error||"Couldn't check results."; }
      else{
        const data=result.body||{};
        m.className=data.graded>0?"ok":"note";
        m.textContent=data.message||"Checked.";
        if(data.graded>0){
          // Pull the freshly-graded state back down so this device reflects it immediately
          await pullState(true);
          rehydrateAfterSync();
        }
      }
    }catch(e){
      // apiFetch itself never throws (a genuinely offline device comes
      // back as kind:"offline" above, handled by the !result.ok branch)
      // -- this only catches a real bug in the success-path code.
      m.className="err"; m.textContent="Couldn't reach the grading service.";
    }finally{
      btn.disabled=false; btn.textContent="↻ Check results now";
    }
  };
  document.getElementById("saveKeyBtn").onclick=()=>{
    state.apiKey=document.getElementById("apiKeyInput").value.trim(); save();
    const m=document.getElementById("keyMsg");
    m.className="ok"; m.textContent=state.apiKey?"Key saved. Hit Refresh lines up top.":"Key cleared.";
  };
  document.getElementById("bookSel").onchange=e=>{
    state.book=e.target.value; save();
    resolveBookLines(state.lastGames);
    buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos();
    if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot();
    sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
  };
  document.getElementById("goodThresh").onchange=e=>{ state.goodThresh=Number(e.target.value); save(); renderBoard(); };
  document.getElementById("strongThresh").onchange=e=>{ state.strongThresh=Number(e.target.value); save(); renderBoard(); };
  document.getElementById("exportBtn").onclick=exportBackup;
  document.getElementById("importFile").onchange=e=>{ if(e.target.files[0]) importBackup(e.target.files[0]); };
  const deleteAccountBtn=document.getElementById("deleteAccountBtn"); if(deleteAccountBtn) deleteAccountBtn.onclick=deleteAccountData;
  document.getElementById("resetBtn").onclick=async()=>{
    const ok=await pgConfirm({
      title:"Reset this browser?",
      eyebrow:"Local data only",
      message:"Erase all picks, entries, inputs and the API key from THIS BROWSER?\n\nThis does not delete your synced account data. If you're signed in, synced data can pull back down the next time this browser syncs.",
      confirmText:"Reset browser",
      danger:true
    });
    if(!ok) return;
    localStorage.removeItem(KEY);
    state=load();
    document.getElementById("apiKeyInput").value="";
    syncAll();
    renderRecord();
    refreshMeta();
    document.getElementById("ioMsg").className="ok";
    document.getElementById("ioMsg").textContent="This browser's local data was cleared. Your synced account data (if signed in) is untouched.";
  };
  document.getElementById("signOutBtn").onclick=async()=>{
    if(window.Clerk) await window.Clerk.signOut();
    location.reload();
  };
  // Clerk's own hosted UserProfile modal -- full-featured email/password/
  // security management for free, no custom form to build or maintain
  // here. Settings previously had no path to any of that at all besides
  // signing out entirely; this is Clerk's own vanilla-JS SDK method
  // (window.Clerk.openUserProfile()), same Clerk instance this app
  // already loads for sign-in -- no new script, no new auth wiring.
  document.getElementById("manageAccountBtn").onclick=()=>{
    if(window.Clerk && window.Clerk.openUserProfile) window.Clerk.openUserProfile();
  };
  document.getElementById("pullNowBtn").onclick=async()=>{
    const m=document.getElementById("syncMsg");
    m.className="note"; m.textContent="pulling…";
    const ok=await pullState(true);
    if(ok){ rehydrateAfterSync(); m.className="ok"; m.textContent="Pulled latest from sync."; }
    else{ m.className="err"; m.textContent="Nothing to pull, or sync isn't reachable."; }
  };
  document.getElementById("pushNowBtn").onclick=async()=>{
    const m=document.getElementById("syncMsg");
    m.className="note"; m.textContent="pushing…";
    await pushState("private"); // shared data is server-owned now (see api/state.py) -- nothing to push there
    m.className="ok"; m.textContent="Pushed this device's data.";
  };

  document.getElementById("apiKeyInput").value=state.apiKey;
  updateAccountDisplay();
  if(typeof renderBetaAdminPanel==="function") renderBetaAdminPanel(false);
  document.getElementById("bookSel").value=state.book;
  document.getElementById("goodThresh").value=state.goodThresh;
  document.getElementById("strongThresh").value=state.strongThresh;
  // Pull FIRST, before anything local touches updatedAt. Previously init()
  // called save() twice up front, which stamped this device as "newest" and
  // meant the freshness check could never favour the remote copy -- so the
  // automatic pull never fired, and the debounced push then overwrote a newer
  // remote with whatever stale data this device happened to hold.
  await pullState(false);
  // If the previous page was refreshed or signed out before the 1.5s private
  // debounce completed, sync.js left an account-bound local marker. A normal
  // equal-revision pull deliberately preserves that local edit; finish its
  // interrupted cloud push now so another device can see it too.
  if(typeof resumePendingPrivateSync==="function") await resumePendingPrivateSync();
  if(typeof startBetaAnalytics==="function") startBetaAnalytics();
  if(typeof renderBetaAdminPanel==="function") renderBetaAdminPanel(false);

  loadLogosLocal();
  buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos();
  if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot();
  saveLocal(); sortGames();
  renderContextSelect(); renderEntrySelect(); renderBoard(); renderEntries(); renderPicksDetail(); renderRecord();
  populateBooks(); refreshMeta(); renderSystemsSettings();
  // CFBD scoreboard/ratings are reference context only and never block the
  // first paint. The server handles shared caching, while this client keeps
  // a 90-second visible-page scoreboard refresh for Saturday use.
  if(typeof initCfbdInsights==="function") initCfbdInsights();
  // Non-blocking: first paint doesn't wait on this. If the identity cache was
  // empty or stale, fetch canonical teams/games, then re-request ratings for
  // the resolved season in case the first CFBD insights call had to guess it.
  fetchTeamLogos().then(fetched=>{
    if(fetched){
      renderBoard();
      if(typeof fetchCfbdRatings==="function") fetchCfbdRatings(currentCfbdSeason(),false);
    }
  });
}
function rehydrateAfterSync(){
  buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos();
  if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot();
  sortGames();
  renderContextSelect(); renderEntrySelect(); renderBoard(); renderEntries(); renderPicksDetail(); renderRecord();
  refreshMeta(); populateBooks(); renderSystemsSettings();
  document.getElementById("apiKeyInput").value=state.apiKey;
  updateAccountDisplay();
  document.getElementById("bookSel").value=state.book;
  document.getElementById("goodThresh").value=state.goodThresh;
  document.getElementById("strongThresh").value=state.strongThresh;
}
// Global error boundary. Catches two distinct failure modes:
//  - window 'error' (bubble phase, no capture): fires for genuine thrown
//    script errors. Deliberately registered WITHOUT capture:true -- that's
//    what keeps this from also firing on resource-load failures (a blocked
//    font, a flaky CDN image, pdf.js's worker script failing to fetch),
//    which dispatch a plain Event at the failing element and don't bubble
//    to window on the default (non-capturing) phase. Those are already
//    handled locally where they matter (see the pdf.js failure messaging,
//    tests/test_pdf_error_handling.mjs) and showing this banner for one
//    would be a false alarm, not a real "something broke" moment.
//  - 'unhandledrejection': a genuinely uncaught promise rejection --
//    something that slipped past every existing local try/catch in this
//    file (refreshLines, importPool, fetchPredictions, etc. all already
//    catch their own errors and show an inline message; this is the net
//    UNDER that net, for whatever a future bug misses).
// Deliberately a dismissible banner, not a full-page takeover: most errors
// this catches are recoverable, the rest of the page may still be
// perfectly usable, and blocking someone from their own picks over a
// cosmetic rendering bug elsewhere would be worse than the bug itself.
// Shows at most once per page load (see shown flag) -- a bug that throws
// repeatedly (e.g. inside a render loop) would otherwise spam the same
// banner update over and over with no benefit.
function initErrorBoundary(){
  let shown=false;
  let lastDetail="";
  function show(detail){
    lastDetail=detail;
    console.error("[PickGauge error boundary]", detail);
    if(shown) return;
    shown=true;
    const el=document.getElementById("errorBoundary");
    if(el) el.style.display="block";
  }
  window.addEventListener("error", (e)=>{
    // Resource-load failures (img/link/script tags) dispatch a plain Event
    // here too if a listener is ever added with capture -- this one isn't,
    // but e.message is the reliable discriminator regardless: it's only
    // populated for actual script errors, never for a failed resource load.
    if(!e || !e.message) return;
    show(`${e.message}\n${e.filename||""}:${e.lineno||"?"}:${e.colno||"?"}\n${(e.error&&e.error.stack)||""}`.trim());
  });
  window.addEventListener("unhandledrejection", (e)=>{
    const reason=e&&e.reason;
    const detail=(reason&&reason.stack)?reason.stack:String(reason);
    show(detail);
  });
  const reloadBtn=document.getElementById("errorReloadBtn");
  if(reloadBtn) reloadBtn.onclick=()=>location.reload();
  const dismissBtn=document.getElementById("errorDismissBtn");
  if(dismissBtn) dismissBtn.onclick=()=>{
    const el=document.getElementById("errorBoundary");
    if(el) el.style.display="none";
    shown=false; // a later, different error should still be able to show again
  };
  const copyBtn=document.getElementById("errorCopyBtn");
  if(copyBtn) copyBtn.onclick=async()=>{
    const text=`PickGauge error\n${new Date().toISOString()}\n${location.href}\n\n${lastDetail}`;
    const original=copyBtn.textContent;
    try{
      await navigator.clipboard.writeText(text);
      copyBtn.textContent="Copied!";
    }catch(err){
      // Clipboard API needs a secure context/permission that isn't
      // guaranteed -- the error is already in the console either way
      // (see show() above), so fall back to saying so rather than
      // silently doing nothing.
      copyBtn.textContent="See console";
    }
    setTimeout(()=>{ copyBtn.textContent=original; }, 2000);
  };
}
// __pgInited tracks whether the REAL signed-in init() (below) has ever
// actually run -- NOT the same thing as "#appRoot is visible," which is
// now true in guest mode too (see initGuestSnapshot(), app/js/
// guest-snapshot.js). The old version of this function used
// root.style.display as its own signed-in/signed-out signal; that breaks
// the moment a logged-out visitor can see #appRoot at all.
let __pgInited=false;
async function bootstrap(){
  // Clerk's script tags load async/defer; window.Clerk isn't guaranteed to
  // exist the instant this script runs, so wait for it rather than racing
  // it. Also wait for window.__internal_ClerkUICtor specifically -- a REAL
  // production bug, found via an actual incognito-window test, not
  // theoretical: Clerk's current SDK splits UI components (<SignIn> etc.)
  // into a separate bundle (see the new @clerk/ui script tag above this
  // one in app/index.html) that loads independently from clerk.browser.js
  // itself. window.Clerk can exist and even finish window.Clerk.load()
  // before that separate UI bundle has actually finished loading -- on a
  // warm cache (a repeat visitor) that chunk is already cached and the
  // race is invisible; on a cold cache (a genuine first-time visitor) it
  // isn't, and mountSignIn() throws "Clerk was not loaded with Ui
  // components". Waiting for BOTH globals before calling .load() closes
  // that race regardless of which of the two Clerk scripts happens to
  // finish loading first.
  let tries=0;
  while((!window.Clerk||!window.__internal_ClerkUICtor) && tries<100){ await new Promise(r=>setTimeout(r,50)); tries++; }
  if(!window.Clerk||!window.__internal_ClerkUICtor){
    // Clerk itself failed to load at all -- the guest preview's own
    // "sign in" path (guestRequireSignIn(), app/js/guest-snapshot.js)
    // needs a working window.Clerk just as much as the real signed-in
    // flow does, so this stays the same hard failure state it always was
    // rather than pretending guest mode is a usable fallback here.
    document.getElementById("signInGate").style.display="block";
    document.getElementById("clerk-signin").innerHTML='<p class="note">Couldn\'t load the sign-in system. Check your connection and reload.</p>';
    return;
  }
  await window.Clerk.load({
    ui:{ClerkUI:window.__internal_ClerkUICtor},
    // Keep the embedded auth UI branded as PickGauge even if the Clerk
    // dashboard application name is ever stale or changed independently.
    // Clerk's default string is "Sign in to {{applicationName}}".
    localization:{
      signIn:{
        start:{title:"Sign in to PickGauge"}
      }
    }
  });
  if(window.Clerk.user){
    document.getElementById("appRoot").style.display="block";
    __pgInited=true;
    init();
  }else{
    // Logged-out visitors now land in the real Snapshot tab (live lines,
    // real SP+-derived model numbers) instead of an immediate sign-in
    // wall -- see app/js/guest-snapshot.js's own header comment for the
    // full reasoning and safety notes. Falls back to the classic blocking
    // gate if that file somehow failed to load, rather than showing a
    // blank/broken #appRoot with nothing wired to it.
    if(typeof initGuestSnapshot==="function"){
      document.getElementById("appRoot").style.display="block";
      initGuestSnapshot();
    }else{
      document.getElementById("signInGate").style.display="block";
      window.Clerk.mountSignIn(document.getElementById("clerk-signin"));
    }
  }
  // Covers both directions: someone completing sign-in (guest/gate -> app,
  // needs a fresh init() since none of the board's event listeners exist
  // yet) and someone signing out from within the app (app -> guest
  // preview, not the old hard gate -- see the !user branch below). Clerk
  // fires this on both, not just once at load.
  window.Clerk.addListener(({user})=>{
    const gate=document.getElementById("signInGate"), root=document.getElementById("appRoot");
    if(user && !__pgInited){
      // A real sign-in just happened, whether from the classic gate or
      // from guest mode's "sign in" prompt (guestRequireSignIn()) --
      // undo every in-memory-only guest tweak BEFORE init() runs, so a
      // genuinely new account still gets this app's real new-account
      // defaults rather than inheriting the guest preview's narrower
      // SP+-only composite. No-ops harmlessly if guest mode was never
      // active (e.g. Clerk's own UI was used directly from the classic
      // gate).
      if(typeof guestTeardown==="function") guestTeardown();
      gate.style.display="none"; root.style.display="block";
      __pgInited=true;
      Promise.resolve(init()).then(()=>{
        if(typeof guestConsumePendingTab==="function"){
          const pending=guestConsumePendingTab();
          if(pending&&typeof switchTab==="function") switchTab(pending);
        }
      });
    }else if(!user && __pgInited){
      // Signing out from within the app now returns to the guest
      // Snapshot preview (consistent with how every logged-out visitor
      // now lands), not the old hard-blocking gate -- falls back to that
      // gate only if guest-snapshot.js somehow isn't available.
      __pgInited=false;
      if(typeof initGuestSnapshot==="function"){
        gate.style.display="none"; root.style.display="block";
        initGuestSnapshot();
      }else{
        root.style.display="none"; gate.style.display="block";
        window.Clerk.mountSignIn(document.getElementById("clerk-signin"));
      }
    }
  });
}
