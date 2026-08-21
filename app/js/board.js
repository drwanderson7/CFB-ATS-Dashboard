// --- Board tab + Snapshot tab rendering -----------------------------------
// Split out of app/index.html as part of the JS-splitting pass. NOTE: despite
// the name (matching the "board" section banner this file used to live
// under, /* ---------- board ---------- */), this file contains BOTH the
// full Edge Board table (renderBoard()) AND the entire Snapshot tab
// (renderSnapshot() and everything it calls) -- they were never actually
// separate sections in the source, and genuinely share real rendering
// helpers (edgeExtrasHTML/probCellHTML/mktModelHTML get called by both
// renderBoard() and renderSnapshot()/renderSnapDetailRow()). Splitting them
// into two files would mean either duplicating those shared helpers or
// introducing a third shared.js -- bigger scope than this pass. If that
// finer split is ever wanted, this is the file to start from.
//
// Also contains the CFB week calendar (buildGames(), week index math),
// column sorting for the full board, and the Weekly Setup checklist card
// (computeWeeklySetup()/renderSetupStatus()) -- all genuinely shared
// between what's rendered on Board and what's rendered on Snapshot.
//
// Loaded as a plain <script src="/app/js/board.js"> tag, same as
// model.js -- an ordinary global scope, not a module. Real external
// references this file makes that are NOT self-contained (all resolved
// lazily inside function bodies, never at top-level, so script load order
// relative to the rest of the page doesn't matter for correctness -- same
// reasoning as model.js's own header comment):
//   - `state` -- the global app state object (main inline script).
//   - `myNumber()`/`edgeOf()`/`edgeClass()`/`clvOf()`/`clvAlignment()`/
//     `probabilityCoverForGame()`/`weightOf()` -- the composite probability
//     model, now in app/js/model.js.
//   - `activeEntry()`/`activeEntries()`/`currentPool()`/`ctxActiveEntryId()`/
//     `pickLimit()` -- pool/entry context accessors (main inline script).
//   - `esc()`/`fmt()`/`round1()`/`norm()`/`mkey()` -- general string/number
//     utilities (main inline script).
//   - `inputsFor()`/`predsFor()`/`weightOf()` -- BP/Comp/prediction-tracker
//     input accessors (main inline script / model.js).
//   - `teamMatch()`/`resolveVegasLine()` -- team-name and odds resolution
//     (main inline script).
//   - `save()`/`saveLocal()`/`scheduleSync()` -- persistence (main inline
//     script).
const WEEK_MS=7*24*60*60*1000;
// --- CFB week calendar --------------------------------------------------
// Real CFB weeks run Tuesday -> Monday. Week 1 is anchored to its Tuesday;
// everything else is derived by counting 7-day blocks from there. Week 0 (the
// kickoff weekend, e.g. Aug 29 2026) falls out naturally as index 0 -- the
// Tue-Mon block just before Week 1. To roll to a new season, update this one
// date to that season's Week 1 Tuesday.
const SEASON_WEEK1_TUESDAY="2026-09-01";   // Tue Sep 1 2026 = start of Week 1
function week1StartMs(){ const [y,m,d]=SEASON_WEEK1_TUESDAY.split("-").map(Number); return new Date(y,m-1,d,0,0,0,0).getTime(); }
function localMidnight(ms){ const d=new Date(ms); d.setHours(0,0,0,0); return d.getTime(); }
// Which CFB week number a kickoff time falls in (…,0=Week 0,1=Week 1,2,…).
function weekIndexOf(commence){
  if(!commence) return null;
  const t=Date.parse(commence); if(isNaN(t)) return null;
  return Math.floor((localMidnight(t)-week1StartMs())/WEEK_MS)+1;
}
// [from,to) for a given week index.
function windowForWeek(idx){
  const from=week1StartMs()+(idx-1)*WEEK_MS;
  return {from, to:from+WEEK_MS, idx};
}
// Default week to show: the one containing the earliest posted game.
function autoWeekIndex(){
  const gs=state.lastGames||[];
  const idxs=gs.map(g=>weekIndexOf(g.commence)).filter(i=>i!=null);
  return idxs.length?Math.min(...idxs):weekIndexOf(new Date().toISOString());
}
function currentWeekIndex(){
  return (typeof state.weekAnchor==="number")?state.weekAnchor:autoWeekIndex();
}
function weekLabel(idx){ return idx<=0?"Week 0":("Week "+idx); }
function weekWindow(){ return windowForWeek(currentWeekIndex()); }
function inWeek(commence, win){
  if(!win) return true;
  if(!commence) return false;
  const t=Date.parse(commence);
  return !isNaN(t) && localMidnight(t)>=win.from && localMidnight(t)<win.to;
}

function buildGames(){
  const pool=currentPool();
  if(pool){
    // Pool context: the board IS the pool's imported slate. Reference line is the
    // locked pool spread; until that's set (pre-lock), fall back to a live-odds
    // match as a provisional number so edges still compute. Keys come from the
    // pool's own names so picks stay stable whether or not odds are loaded.
    isDemo=false; demoInputs={};
    games=(pool.games||[]).map(pg=>{
      let vegas=(pg.line!=null?pg.line:null), book="locked", locked=(pg.line!=null);
      let away=pg.away, home=pg.home;
      // Always look up a live-odds match -- used pre-lock as the provisional
      // reference line, and post-lock purely for CLV (how far the market has
      // moved since the pool's line locked). lockedLine stays the real locked
      // number regardless of what `vegas` shows, so CLV always has both values.
      const lg=(state.lastGames||[]).find(x=>teamMatchTrunc(pg.away,x.away)&&teamMatchTrunc(pg.home,x.home));
      const liveVegas=lg?lg.vegas:null;
      // The Odds API's own stable event id, carried through only when this
      // pool game has actually matched a live odds entry -- null otherwise
      // (a pool game that's never matched a live event has no ID to trust,
      // grading falls back to team-name matching for it, same as before
      // this existed).
      const providerGameId=lg?(lg.id||null):null;
      if(vegas==null){
        if(lg){ vegas=lg.vegas; book="live*"; away=lg.away; home=lg.home; } // de-truncate display from odds
        else book="";
      }
      return {key:mkey(pg.away,pg.home), away, home, commence:(pg.commence||(lg&&lg.commence)||null), vegas, book,
              poolLocked:locked, liveVegas, lockedLine:(pg.line!=null?pg.line:null), providerGameId};
    });
    return;
  }
  if(state.lastGames && state.lastGames.length){
    isDemo=false; demoInputs={};
    const win=(state.weekAnchor==="ALL")?null:weekWindow();
    const src=win?state.lastGames.filter(g=>inWeek(g.commence,win)):state.lastGames;
    // The shared cache's own `id` field (from The Odds API via
    // fetch_odds.py) becomes providerGameId here -- kept as a distinct
    // name from the start so it reads clearly as "the provider's ID for
    // this game," not just any generic "id."
    games=src.map(g=>({...g,key:mkey(g.away,g.home),providerGameId:g.id||null}));
  } else {
    isDemo=true; demoInputs={};
    games=DEMO.map(d=>{
      const key=mkey(d.away,d.home);
      demoInputs[key]=d.inputs.slice();   // display only -- never saved
      return {key,away:d.away,home:d.home,commence:d.commence,vegas:d.vegas,book:"demo"};
    });
  }
}
// Step weeks without refetching (re-slices the already-fetched set).
function shiftWeek(deltaWeeks){ setWeekAnchor(currentWeekIndex()+deltaWeeks); }
function setWeekAnchor(val){ // val: week index (number), "ALL", or null(auto)
  state.weekAnchor=val; save(); buildGames(); applyPdfData(); applyPredictions(); applyTeamLogos(); migrateGameKeys(); sortGames(); renderBoard();
}
// A game's key is derived from its team names, but the SAME game is named
// differently depending on where the board came from (PDF: "Wisconsin @ Oregon"
// -> wisconsin@oregon; Odds API: "Wisconsin Badgers @ Oregon Ducks" ->
// wisconsinbadgers@oregonducks). Rebuilding the board from a different source
// therefore used to orphan every stored input and pick: the board showed
// nothing picked while the counter still read 7/7 and every button was
// disabled, with no way to un-pick. This re-homes stored data onto whatever
// keys the current board is using.
function migrateGameKeys(){
  if(!games.length) return 0;
  const boardKeys=new Set(games.map(g=>g.key));
  const resolve=(oldKey,pick)=>{
    if(boardKeys.has(oldKey)) return null;      // already points at a live game
    // Stable CFBD game ID is the safest possible re-home for a saved pick.
    // Fall back to the legacy name matcher for older picks/inputs that predate
    // the canonical identity layer.
    if(pick&&pick.cfbdGameId!=null){
      const byId=games.find(x=>x.cfbdGameId!=null&&String(x.cfbdGameId)===String(pick.cfbdGameId));
      if(byId) return byId.key;
    }
    const parts=String(oldKey).split("@");
    if(parts.length!==2) return null;
    const g=games.find(x=>teamMatch(parts[0],x.away)&&teamMatch(parts[1],x.home));
    return g?g.key:null;
  };
  let moved=0;
  // BP/Comp inputs are the Overall board's; only remap them there. In a pool
  // context the keys come from the pool's own names and are already stable.
  if(!currentPool()){
    Object.keys(state.inputs).forEach(k=>{
      const nk=resolve(k); if(!nk||nk===k) return;
      const oldArr=Array.isArray(state.inputs[k])?state.inputs[k]:[];
      const curArr=Array.isArray(state.inputs[nk])?state.inputs[nk]:[];
      // keep anything already on the new key; fill blanks from the old one
      state.inputs[nk]=[0,1,2].map(i=>(curArr[i]!=null&&curArr[i]!=="")?curArr[i]:(oldArr[i]!=null?oldArr[i]:null));
      delete state.inputs[k]; moved++;
    });
  }
  activeEntries().forEach(e=>{
    Object.keys(e.picks).forEach(k=>{
      const nk=resolve(k,e.picks[k]); if(!nk||nk===k) return;
      if(!e.picks[nk]) e.picks[nk]=e.picks[k];
      delete e.picks[k]; moved++;
    });
  });
  return moved;
}
// --- Sorting -----------------------------------------------------------
// Column headers are clickable: click sets that column as the active sort
// key (toggles direction if it's already active). Sorting only happens on
// an explicit action -- a header click or the Re-sort button -- not on
// every keystroke, so rows don't jump around while you're typing input
// values. Sort state persists in `state` like everything else, so it
// syncs across devices.
const SORT_LABELS={game:"game",bp:"BP",comp:"Comp",vegas:"Vegas",myn:"Model #",cover:"Cover %",edge:"edge",clv:"CLV"};
const SORT_DEFAULT_DIR={game:"asc",bp:"desc",comp:"desc",vegas:"desc",myn:"desc",cover:"desc",edge:"desc",clv:"desc"};
function sortValue(key,g){
  switch(key){
    case "game": return (g.home||"").toLowerCase();
    case "bp": return inputsFor(g.key)[0];
    case "comp": return inputsFor(g.key)[1];
    case "vegas": return currentPool()?g.liveVegas:g.vegas;
    case "myn": return myNumber(g);
    case "cover": { const e=edgeOf(g); return (e&&e.prob&&e.prob.side)?e.prob.probEdge:null; }
    case "edge": { const e=edgeOf(g); return e?e.pts:null; }
    case "clv": {
      if(!currentPool()) return null;
      const ent=activeEntry();
      const pickedSide=ent.picks[g.key]?ent.picks[g.key].side:null;
      const c=clvOf(g,pickedSide);
      return c?(c.forPick!=null?c.forPick:c.raw):null;
    }
    default: return null;
  }
}
function sortGamesBy(key,dir){
  const mul=dir==="asc"?1:-1;
  games.sort((a,b)=>{
    const va=sortValue(key,a), vb=sortValue(key,b);
    const aEmpty=(va==null||va===""||(typeof va==="number"&&isNaN(va)));
    const bEmpty=(vb==null||vb===""||(typeof vb==="number"&&isNaN(vb)));
    if(aEmpty&&bEmpty) return 0;
    if(aEmpty) return 1;   // missing values always sort last, either direction
    if(bEmpty) return -1;
    if(typeof va==="string"||typeof vb==="string") return mul*String(va).localeCompare(String(vb));
    return mul*(va-vb);
  });
}
// setSort: click handler for a header. Same column clicked again flips
// direction; a new column starts at its sensible default direction.
function setSort(key){
  if(state.sortKey===key){ state.sortDir=(state.sortDir==="asc"?"desc":"asc"); }
  else{ state.sortKey=key; state.sortDir=SORT_DEFAULT_DIR[key]||"desc"; }
  save();
  sortGamesBy(state.sortKey,state.sortDir);
  renderBoard();
}
function sortGames(){ sortGamesBy(state.sortKey||"edge", state.sortDir||"desc"); }
// Small arrow + active styling for whichever header matches state.sortKey.
function sortHeaderHTML(key,label,opts){
  opts=opts||{};
  const active=state.sortKey===key;
  const arrow=active?(state.sortDir==="asc"?" ▲":" ▼"):"";
  const cls=`sortable${active?" sort-active":""}${opts.extraClass?" "+opts.extraClass:""}`;
  const titleAttr=opts.title?` title="${opts.title}"`:"";
  return `<th class="${cls}" data-sortkey="${key}"${titleAttr}>${label}${arrow}</th>`;
}
function kickStr(c){
  if(!c) return "";
  try{ const d=new Date(c); return d.toLocaleString(undefined,{weekday:"short",hour:"numeric",minute:"2-digit",timeZoneName:"short"}); }catch(e){ return ""; }
}
function fmtDate(ms){ return new Date(ms).toLocaleDateString(undefined,{month:"short",day:"numeric"}); }
function renderWeekBar(){
  const bar=document.getElementById("weekBar");
  if(!bar) return;
  // Only relevant for an odds-built board; PDF/predictions/demo are single-week.
  const hasOdds=!isDemo && state.lastGames && state.lastGames.length;
  if(!hasOdds || currentPool()){ bar.style.display="none"; return; }
  bar.style.display="flex";
  const showAll=(state.weekAnchor==="ALL");
  const label=document.getElementById("weekLabel");
  const count=document.getElementById("weekCount");
  const total=state.lastGames.length;
  if(showAll){
    label.textContent="All weeks";
    count.textContent=`· ${total} games`;
  }else{
    const idx=currentWeekIndex();
    const win=windowForWeek(idx);
    label.innerHTML=`<b>${weekLabel(idx)}</b> <span class="week-range">${fmtDate(win.from)} – ${fmtDate(win.to-1)}</span>`;
    count.textContent=`· ${games.length} of ${total} games`;
    const jump=document.getElementById("weekJump");
    if(jump && !jump.value) jump.value=new Date(win.from).toISOString().slice(0,10);
  }
}
// Per-column (BP or Comp, idx 0/1) coverage across this week's board --
// how many games are missing that specific input. Reading directly off
// inputsFor() (the same source Model # itself reads) rather than off
// state.pdfGames means this stays correct even if the board's game list
// has changed since the PDF was imported (different week, re-matched
// keys, etc) -- it measures what's actually on the board right now, not
// what the import step claimed to have found.
function computeInputColumnCoverage(idx){
  if(!games.length) return {total:0, missing:0};
  let missing=0;
  games.forEach(g=>{ const v=inputsFor(g.key)[idx]; if(v==null||v==="") missing++; });
  return {total:games.length, missing};
}
// Full "Weekly Setup" checklist: one pass/fail item per data-entry path
// this app has, plus freeform warnings for things that are a matter of
// degree rather than pass/fail (staleness, partial coverage). Each item
// mirrors a real, independently-checkable piece of state -- nothing here
// is inferred from a derived number like Model # (see the note that used
// to live on computeModelInputCoverage: Model # can't tell you "no inputs
// loaded" because it silently equals Vegas in that case).
function computeWeeklySetup(){
  const items=[];
  const pool=currentPool();
  const enabledCore=new Set(state.enabledSystems);
  const sysCols=enabledSystemsOrdered();

  // Vegas lines and Entry selected are always meaningful regardless of
  // context or which inputs you've chosen to use -- never "not applicable".
  const hasLiveLines=!isDemo && !!(state.lastGames && state.lastGames.length);
  items.push({key:"vegas", status:hasLiveLines?"ok":"bad", label:"Vegas lines updated",
    fix:"Hit Refresh lines (top right) to pull this week's live spreads.",
    target:{highlight:"refreshBtn"}}); // header button, visible on every tab -- no tab switch needed

  // Powers PDF (BP/Comp) -- only "required" if you've actually toggled BP
  // and/or Comp on below. If you've turned both off, you've told this app
  // you're not using them this week; treating that as a standing warning
  // was exactly the false-positive this whole redesign exists to fix.
  const bpOn=enabledCore.has("bp"), compOn=enabledCore.has("comp");
  if(!bpOn && !compOn){
    items.push({key:"pdf", status:"na", label:"Powers PDF imported",
      detail:"BP/Comp not enabled this week"});
  }else{
    const bpCov=computeInputColumnCoverage(0);
    const compCov=computeInputColumnCoverage(1);
    const parts=[];
    if(bpOn && bpCov.missing>0) parts.push(`BP missing for ${bpCov.missing} of ${bpCov.total} games`);
    if(compOn && compCov.missing>0) parts.push(`Comp missing for ${compCov.missing} of ${compCov.total} games`);
    const ok=games.length>0 && parts.length===0;
    items.push({key:"pdf", status:ok?"ok":"bad", label:"Powers PDF imported",
      detail:parts.length?parts.join(" · "):null,
      fix:"Import this week's Powers PDF on the Edge Board.",
      target:{tab:"board", openPanel:"predPanel", highlight:"pdfImportLabel"}});
  }

  // Prediction systems -- only "required" if at least one is actually
  // toggled on in the checklist below. Not applicable if this week is
  // BP/Comp/Vegas only, by choice.
  if(sysCols.length===0){
    items.push({key:"preds", status:"na", label:"Prediction systems loaded",
      detail:"None enabled this week"});
  }else{
    const predsLoadedAt=state.predMeta&&state.predMeta.fetchedAt;
    items.push({key:"preds", status:predsLoadedAt?"ok":"bad", label:"Prediction systems loaded",
      fix:"Hit Load model predictions on the Edge Board.",
      target:{tab:"board", openPanel:"predPanel", highlight:"loadPredsBtn2"}});
  }

  // Pool lines -- only "required" while you're actually viewing a pool's
  // context. On Overall board there's no pool for this item to mean
  // anything about, so it shouldn't read as a standing warning there.
  if(!pool){
    items.push({key:"pool", status:"na", label:"Pool lines imported",
      detail:"Viewing Overall board"});
  }else{
    const ok=!!(pool.games && pool.games.length);
    items.push({key:"pool", status:ok?"ok":"bad", label:"Pool lines imported",
      detail:ok?null:`${pool.name||"This pool"} has no games loaded yet`,
      fix:"Import this pool's sheet on the Pools tab.",
      target:{tab:"pools", highlight:"poolImportLabel_"+pool.id}});
  }

  const entryOk=!!activeEntry();
  items.push({key:"entry", status:entryOk?"ok":"bad", label:"Entry selected",
    fix:"Add an entry in My Picks, then pick it from \"Picking for.\"",
    target:{tab:"picks", highlight:"newEntryName"}});

  const warnings=[];
  if(hasLiveLines){
    const age=minsAgo(state.lastRefresh);
    if(age!=null && age>=180){
      const hrs=Math.round(age/60*10)/10;
      warnings.push(`Vegas lines are ${hrs}h old -- hit Refresh lines to get the latest before picking.`);
    }
  }

  // "na" items don't count toward the required total or the completion
  // ratio shown in the summary line -- a week deliberately run BP/Comp-only
  // with no pool should be able to show "3 of 3 complete", not "3 of 5"
  // implying two unaddressed problems that were never really problems.
  const required=items.filter(i=>i.status!=="na");
  return {
    items, warnings,
    allOk: required.every(i=>i.status==="ok"),
    requiredCount: required.length,
    okCount: required.filter(i=>i.status==="ok").length,
  };
}
// Single source of truth for the persistent setup card (see #setupNotice
// in the markup, shared across every tab).
function computeSetupDisplay(){
  const pool=currentPool();
  if(isDemo && !pool){
    return {mode:"demo"};
  }
  if(isDemo) return {mode:"hidden"}; // demo + a pool: the pool's own empty/setup states already cover it
  // "No games loaded" hides the card -- but ONLY when there's also no pool
  // context to explain why. An empty pool (0 games, because its sheet
  // hasn't been imported yet) is EXACTLY the case "Pool lines imported"
  // exists to catch -- in pool context, buildGames() makes `games` mirror
  // pool.games directly, so an unimported pool means games.length===0 too.
  // Hiding the card there would mask the one signal most worth showing.
  if(!games.length && !pool) return {mode:"hidden"}; // no board loaded at all, outside a pool -- other empty states already say this
  const setup=computeWeeklySetup();
  // "Complete" means every REQUIRED item is actually done (okCount===
  // requiredCount) -- NOT "done AND no warnings," which used to force the
  // full itemized checklist card back onto screen even at, say, 4-of-4,
  // purely because of an unrelated soft warning (odds staleness, most
  // commonly). Confirmed against a real screenshot: a genuinely 4/4-done
  // pool was still rendering the big card instead of the compact summary,
  // for exactly this reason. Every warning computeWeeklySetup() can
  // produce already duplicates something computeContextSummary()'s own
  // line2 shows (odds freshness, pick count, lock status) -- so showing
  // the whole card again to repeat a warning wastes real mobile screen
  // space for no new information once nothing is actually actionable.
  if(setup.okCount===setup.requiredCount) return {mode:"complete", setup};
  return {mode:"checklist", setup};
}
// Tabs where the shared, tab-independent Context Bar and Weekly Setup
// card are deliberately hidden -- Pools (a list-of-everything page, not
// a scoped "here's what you're working on" view), My Picks and Results
// (both already have their own pool/entry/week context baked into what
// they show -- entry selector, per-entry breakdown -- so a second,
// separate "VIEWING: X" summary and a setup checklist with no action to
// take from either tab is redundant chrome, not useful orientation).
const TABS_WITHOUT_SHARED_WIDGETS=new Set(["tab-pools","tab-picks","tab-record"]);
function sharedWidgetsHiddenOnCurrentTab(){
  return TABS_WITHOUT_SHARED_WIDGETS.has(document.querySelector(".panel.active")?.id);
}
function renderSetupStatus(){
  renderPoolSetupCta(); // fully independent of setupNotice's own early returns below
  const el=document.getElementById("setupNotice");
  if(!el) return;
  // Force-hidden rather than skipped entirely so a stale visible copy
  // can't survive a tab switch from wherever this was last rendered
  // (renderContextAll() calls this unconditionally from several
  // Pools/My Picks/Results actions, not just switchTab() itself).
  if(sharedWidgetsHiddenOnCurrentTab()){ el.style.display="none"; return; }
  const display=computeSetupDisplay();
  if(display.mode==="hidden"){ el.style.display="none"; return; }
  el.style.display="block";
  if(display.mode==="demo"){
    el.className="card setup-notice setup-notice-info";
    el.innerHTML=`<p class="note" style="margin:0;"><b>You're looking at demo data.</b> This tool tracks against-the-spread picks: hit <b>Refresh lines</b> above for live Vegas lines — PickGauge's shared connection covers everyone signed in automatically, no key of your own needed.</p>`;
    return;
  }
  if(display.mode==="complete"){
    // Once every required item is genuinely done, this card disappears
    // entirely rather than shrinking to a one-line card -- "Setup ✓"
    // instead lives in the Context Bar's own summary line
    // (computeContextSummary(), app/js/pool-contexts.js), so a fully-set-up
    // week costs zero extra vertical space, not one card's worth of
    // border/padding for a single sentence.
    el.style.display="none";
    return;
  }
  const {items,warnings,allOk,requiredCount,okCount}=display.setup;
  el.className="card setup-notice "+(allOk?"setup-notice-info":"setup-notice-warn");
  const rows=items.map(i=>{
    const icon=i.status==="ok"?"✓":i.status==="na"?"—":"⚠";
    // Only "bad" (actionable) rows with a known target become clickable --
    // "ok" rows have nothing left to do, "na" rows are informational, and
    // a target-less "bad" row shouldn't silently pretend it goes somewhere.
    const clickable=i.status==="bad" && i.target;
    const inner=`<span class="setup-check ${i.status}">${icon}</span>
      <span class="setup-label">${esc(i.label)}</span>
      ${i.detail?`<span class="setup-detail">${esc(i.detail)}</span>`:''}
      ${clickable?`<span class="setup-row-arrow">Go →</span>`:''}`;
    if(clickable){
      return `<button type="button" class="setup-row setup-row-action" data-setup-key="${esc(i.key)}" title="${esc(i.fix||'')}">${inner}</button>`;
    }
    return `<div class="setup-row${i.status==="na"?" setup-row-na":""}">${inner}</div>`;
  }).join("");
  const warnRows=warnings.map(w=>`<div class="setup-warn-line">⚠ ${esc(w)}</div>`).join("");
  const summaryHTML=`<span class="setup-check ${allOk?'ok':'bad'}">${allOk?'✓':'⚠'}</span>
    <span class="setup-summary-title">${esc(weekLabel(currentWeekIndex()).toUpperCase())} SETUP</span>
    <span class="setup-summary-count">${okCount} of ${requiredCount} complete</span>`;
  const bodyHTML=`<div class="setup-list">${rows}</div>
    ${warnRows?`<div class="setup-warns">${warnRows}</div>`:''}
    <button class="btn btn-secondary setup-finish-btn" id="setupFinishBtn" type="button">Finish Setup →</button>`;
  // Reuse an existing <details> node if this card was ALREADY in checklist
  // mode last render, rather than rebuilding it from scratch -- a fresh
  // element always starts collapsed, which would silently re-close it out
  // from under someone who just expanded it, every time anything else on
  // the board changes (a checkbox toggle, a pick, a refresh -- all of
  // which call this). Collapsed is only the right DEFAULT for a node that
  // didn't exist before; it's not something to keep re-imposing.
  let details=el.querySelector(":scope > details.setup-details");
  if(!details){
    el.innerHTML=`<details class="setup-details"><summary class="setup-summary"></summary><div class="setup-body"></div></details>`;
    details=el.querySelector(":scope > details.setup-details");
  }
  details.querySelector(".setup-summary").innerHTML=summaryHTML;
  details.querySelector(".setup-body").innerHTML=bodyHTML;
  const finBtn=document.getElementById("setupFinishBtn");
  if(finBtn){
    // "Finish Setup" should mean "take me to whatever's actually still
    // incomplete" -- NOT a blanket apiKey-based guess at board vs.
    // settings. That old check was stale besides: refreshLines() no
    // longer requires a personal apiKey at all (the server's own
    // ODDS_API_KEY covers everyone by default), so it could send someone
    // to Settings for a key they don't need while the REAL blocker --
    // say, prediction systems not loaded -- sat untouched on Edge Board.
    const firstBad=items.find(i=>i.status==="bad" && i.target);
    finBtn.onclick=firstBad?()=>goToSetupItem(firstBad.target):()=>switchTab("board");
  }
  // Wire each clickable row to its own target rather than the generic
  // Finish Setup button -- a new user missing prediction systems should
  // land ON the prediction systems panel, not just "somewhere on Edge
  // Board" with no further clue.
  details.querySelectorAll(".setup-row-action").forEach(btn=>{
    const item=items.find(i=>i.key===btn.dataset.setupKey);
    if(item && item.target) btn.onclick=()=>goToSetupItem(item.target);
  });
}
// Real gap fix: Snapshot and Edge Board previously had NO path at all to
// discover pool setup once someone was past the "you're looking at demo
// data" state (that banner used to mention pool import, but only while
// still in demo mode -- the moment real Vegas lines loaded on the
// Overall board, every trace of "you can track a real pool" disappeared,
// even though the pool-import controls themselves only live on the
// Pools tab, never on Snapshot/Edge Board). This is a SEPARATE element
// from #setupNotice (not folded into its demo/checklist/complete modes)
// because it answers a genuinely different question -- not "is THIS
// week's setup complete" but "do you know pools exist at all" -- and the
// two can be true independently (someone can have a fully-complete
// Overall-board setup and still never have tried a pool).
// Self-limiting instead of needing an explicit dismiss: once the person
// has created even one pool, ever, this permanently stops showing (see
// the condition below) -- an experienced user never sees it again, with
// no separate "dismissed" state to track or lose on a device switch.
function renderPoolSetupCta(){
  const el=document.getElementById("poolSetupCta");
  if(!el) return;
  const pool=currentPool();
  const everHadAPool=!!(state.pools && state.pools.length);
  if(sharedWidgetsHiddenOnCurrentTab() || pool || everHadAPool){
    el.style.display="none";
    return;
  }
  el.style.display="flex";
  // The WHOLE element is the button (see .pool-setup-banner's own
  // comment) -- one bold label, one short line of context, one arrow.
  // No separate nested <button> to wire up.
  el.innerHTML=`<span>
      <span class="psb-title">❓ How to set up a pool</span>
      <span class="psb-sub">Import your pool's picks sheet to track this week against its locked lines instead of the live market shown here.</span>
    </span>
    <span class="psb-arrow">Go to Pools →</span>`;
  el.onclick=()=>goToSetupItem({tab:"pools", highlight:"poolsTopImportLabel"});
}
// Jumps the user to wherever a given setup item's fix actually lives:
// switches tab if needed, opens the containing <details> panel if the
// control is tucked inside one (Prediction systems panel starts
// collapsed), then scrolls the control into view and gives it a brief
// highlight pulse so the landing spot is obvious even on an unfamiliar
// tab. All best-effort -- a missing element (renamed id, etc.) just
// no-ops rather than throwing.
function goToSetupItem(target){
  if(target.tab) switchTab(target.tab);
  const run=()=>{
    if(target.openPanel){
      const panel=document.getElementById(target.openPanel);
      if(panel && "open" in panel) panel.open=true;
    }
    if(!target.highlight) return;
    const el=document.getElementById(target.highlight);
    if(!el) return;
    el.scrollIntoView({behavior:"smooth", block:"center"});
    if(typeof el.focus==="function") el.focus({preventScroll:true});
    el.classList.add("setup-highlight-pulse");
    setTimeout(()=>el.classList.remove("setup-highlight-pulse"), 2000);
  };
  // Give switchTab's re-render a tick to land before we go looking for
  // elements that only exist once the target panel is actually showing.
  if(target.tab) setTimeout(run, 30); else run();
}
// Combines the Edge Board's two independent row filters -- ⚡ CLV+Model#
// alignment (pool-only, requires clvAlignment(g) to be truthy) and ⚑
// Shortlist-only (works in any context) -- with AND logic: a game must
// pass BOTH active filters to show, either alone if only one is on, or
// unfiltered if neither is. Kept separate from clvAlignment() itself
// (that's the per-game predicate; this is the combination policy) so a
// third independent filter could be added here later without touching
// clvAlignment().
function boardVisibleGames(allGames,alignFilterOn,shortlistFilterOn,shortlist){
  return allGames.filter(g=>(!alignFilterOn||clvAlignment(g))&&(!shortlistFilterOn||shortlist.includes(g.key)));
}
// Which Board rows currently have their matchup breakdown (ratings +
// Matchup Intelligence) dropdown expanded. Ephemeral UI state, same
// reasoning as snapExpandedKeys below -- not part of `state`/saved, not
// synced.
// Two states, not one static button: prominent "Load model predictions"
// when nothing's loaded yet this session (the genuinely actionable
// case), collapsing to a small "predictions loaded ✓ · reload" text link
// once state.predMeta.fetchedAt is set (same signal
// computeWeeklySetup()'s own "Prediction systems loaded" checklist item
// already uses) -- removes a persistent full-width row once there's
// nothing left to do, matching the Setup card's own "go quiet once done"
// treatment. #loadPredsBtn/#predStatus keep the SAME ids in BOTH states
// specifically so fetchPredictions() (app/js/prediction-tracker.js) keeps
// working completely unchanged -- it already null-safely looks up both
// by id and updates them mid-fetch, regardless of which visual state was
// showing when it was clicked.
//
// Rebinds the button's onclick every render, same fix as
// renderSystemsSettings()'s own #pdfFile rebinding earlier this session:
// the element is destroyed and recreated on every render (innerHTML=),
// so a one-time binding at page load (like init.js used to do for this
// exact button) would either throw (element doesn't exist yet on first
// load) or go stale (element replaced moments later).
function renderLoadPredsControl(){
  const wrap=document.getElementById("loadPredsControl");
  if(!wrap) return;
  const loadedAt=state.predMeta&&state.predMeta.fetchedAt;
  wrap.innerHTML=loadedAt
    ? `<button class="btn-link-sm" id="loadPredsBtn" title="Pull the latest lines from thepredictiontracker.com for every system you've toggled on below">predictions loaded ✓ · reload</button><span id="predStatus" class="mono-sm"></span>`
    : `<button class="btn btn-secondary" id="loadPredsBtn" title="Pull the latest lines from thepredictiontracker.com for every system you've toggled on below">⬇ Load model predictions</button><span id="predStatus" class="mono-sm"></span>`;
  const btn=document.getElementById("loadPredsBtn");
  if(btn) btn.onclick=fetchPredictions;
}
const boardExpandedKeys=new Set();
function renderBoard(){
  applyTeamLogos(); // cheap no-op once resolved; catches every buildGames() call site
  renderWeekBar();
  renderContextBar();
  const tb=document.getElementById("boardBody");
  const empty=document.getElementById("boardEmpty");
  const noOdds=(!state.lastGames||!state.lastGames.length);
  const pool=currentPool();
  const isPdf=!isDemo&&noOdds&&state.pdfGames&&state.pdfGames.length;
  const isPred=!isDemo&&noOdds&&!isPdf&&state.predictions&&state.predictions.length;
  const badge=document.getElementById("dataBadge");
  if(pool){
    badge.textContent=`${pool.weekLabel||"pool"} · pick ${pool.pickLimit}`;
    badge.className="badge badge-demo";
  }else{
    badge.textContent=isDemo?"demo data":isPdf?"PDF":isPred?"predictions":"live";
    badge.className="badge "+((isDemo||isPdf||isPred)?"badge-demo":"badge-live");
  }
  renderSetupStatus();
  renderLoadPredsControl();
  // The ⚡ filter only makes sense in a pool (CLV needs a locked line). Hide it
  // entirely outside a pool rather than leave a dead control on screen.
  const afWrap=document.getElementById("alignFilterWrap");
  const afChk=document.getElementById("alignFilterChk");
  if(afWrap) afWrap.style.display=pool?"":"none";
  if(!pool && state.boardFilter==="aligned"){ state.boardFilter="all"; } // don't get stuck filtered outside a pool
  if(afChk) afChk.checked=(pool && state.boardFilter==="aligned");
  // Shortlist filter -- unlike the ⚡ alignment filter above, this is
  // independent of it (both can be on at once, AND'd together) and works
  // in any context (Overall or a pool), since shortlisting a game to look
  // at more closely isn't a pool-only concept the way CLV is.
  const sfChk=document.getElementById("shortlistFilterChk");
  const shortlistFilterOn=!!state.boardShortlistOnly;
  if(sfChk) sfChk.checked=shortlistFilterOn;
  // Filter which games RENDER, without touching the underlying `games` array --
  // sorting, My#, picking-by-key, and everything else still operate on the full
  // list; this only trims what's shown when the toggle is on. Extracted as
  // its own pure function (rather than left inline) so the AND-combination
  // of the two independent filters is directly unit-testable, same reasoning
  // as snapshotFilterRows() elsewhere in this file.
  const filterOn=pool && state.boardFilter==="aligned";
  const sl=currentShortlist();
  const visibleGames=boardVisibleGames(games,filterOn,shortlistFilterOn,sl);
  const afCount=document.getElementById("alignFilterCount");
  if(afCount) afCount.textContent=pool?`(${games.filter(g=>clvAlignment(g)).length} of ${games.length})`:"";
  const sfCount=document.getElementById("shortlistFilterCount");
  if(sfCount) sfCount.textContent=`(${sl.length})`;

  if(!visibleGames.length){
    tb.innerHTML="";
    empty.style.display="block";
    empty.innerHTML=(filterOn&&shortlistFilterOn)
      ? `<span class="osw">No matches</span> No shortlisted games currently show CLV + Model # alignment. Turn off one of the filters above to see more.`
      : filterOn
      ? `<span class="osw">No aligned games</span> No games currently show CLV + Model # alignment. Turn off <b>⚡ CLV + Model # aligned</b> to see the full board.`
      : shortlistFilterOn
      ? `<span class="osw">Nothing shortlisted yet</span> Flag a game with the ⚑ button next to its matchup to add it here. Turn off <b>⚑ Shortlist only</b> to see the full board.`
      : `<span class="osw">No games loaded</span> Hit <b>Refresh lines</b> above to see live Vegas lines — PickGauge's shared connection works automatically once you're signed in, no key needed — or import your <b>Splash Sports, ESPN, or OFP pool sheet</b> above to track picks against your pool's locked lines instead. Until then you're looking at demo data.`;
    updatePickCount();
    return;
  }
  empty.style.display="none";
  const ent=activeEntry();
  const pickedCount=Object.keys(ent.picks).length;
  // Enabled prediction systems become their own columns (between Comp and Vegas),
  // so matched values are visible instead of only folded into Model #.
  const sysCols=enabledSystemsOrdered();
  const headRow=document.getElementById("boardHeadRow");
  const resortBtn=document.getElementById("resortBtn");
  if(resortBtn) resortBtn.textContent="⇅ Re-sort by "+(SORT_LABELS[state.sortKey]||"edge");
  const mSel=document.getElementById("mobileSortSel");
  if(mSel && mSel.value!==state.sortKey) mSel.value=state.sortKey;
  const mDirBtn=document.getElementById("mobileSortDirBtn");
  if(mDirBtn) mDirBtn.textContent=state.sortDir==="asc"?"↑ Asc":"↓ Desc";
  // Collapsed-state summary for the Sort & filter panel -- so collapsing
  // it (see the <details> in app/index.html) doesn't hide WHICH sort/
  // filters are active, just the controls themselves.
  const sfSummary=document.getElementById("sortFilterSummary");
  if(sfSummary){
    const activeFilterCount=[pool&&state.boardFilter==="aligned", !!state.boardShortlistOnly].filter(Boolean).length;
    sfSummary.textContent=`${SORT_LABELS[state.sortKey]||"Edge"} · ${state.sortDir==="asc"?"Asc":"Desc"}`
      +(activeFilterCount?` · ${activeFilterCount} filter${activeFilterCount>1?"s":""} on`:"");
  }
  if(headRow){
    const sysTh=sysCols.map(c=>`<th class="hide sys-col" title="${esc(predName(c))} — thepredictiontracker.com">${esc(predShort(c))}</th>`).join("");
    const clvTh=pool?sortHeaderHTML("clv","CLV",{title:"Closing Line Value — how far the live market has moved since this pool's line locked. Once you've picked a side, shown from your pick's perspective: green/positive = you beat the market (favorable), red/negative = the market moved away from your number. Click to sort."}):"";
    const refTh=pool
      ?sortHeaderHTML("vegas","Vegas ●",{title:"Live Vegas line — for reference. Model # and Edge are computed against the pool's LOCKED spread, shown on each team's pick button, not this live number. Click to sort."})
      :sortHeaderHTML("vegas","Vegas ●",{title:"Live Vegas line — shown for reference, but defaults to weight 0 (excluded from Model #) unless you give it a positive weight in the Prediction systems panel. Click to sort."});
    const coreEnabled=new Set(state.enabledSystems);
    const bpTh=coreEnabled.has("bp")?sortHeaderHTML("bp","BP",{extraClass:"hide",title:"Brad Powers line (auto from Powers PDF). Click to sort."}):"";
    const compTh=coreEnabled.has("comp")?sortHeaderHTML("comp","Comp",{extraClass:"hide",title:"Computer projected line (auto from Powers PDF). Click to sort."}):"";
    headRow.innerHTML=
      `<th class="logo-th" aria-label="Away team logo"></th>`+
      sortHeaderHTML("game","Game",{extraClass:"l"})+
      `<th class="logo-th" aria-label="Home team logo"></th>`+
      `<th class="logo-th" aria-label="Matchup breakdown"></th>`+
      bpTh+
      compTh+
      sysTh+
      refTh+
      clvTh+
      sortHeaderHTML("myn","Model #",{title:"Click to sort."})+
      sortHeaderHTML("cover","Cover %",{title:"Modeled probability your side covers, fitted from 5,705 real FBS-vs-FBS games (2018-2025), bucketed by spread size. Green = above the -110 breakeven (52.38%), red = below it. Click to sort."})+
      sortHeaderHTML("edge","Edge — pick",{title:"Click to sort."});
  }
  tb.innerHTML="";
  const totalCols=headRow?headRow.children.length:13; // exact current column count (varies with BP/Comp/sys-columns/CLV visibility) -- headRow was just (re)built above, so this reflects THIS render's real layout, not a guess
  visibleGames.forEach(g=>{
    const inp=inputsFor(g.key);
    const e=edgeOf(g);
    const picked=!!ent.picks[g.key];
    const shortlisted=isShortlisted(g.key);
    const tr=document.createElement("tr");
    tr.dataset.key=g.key;
    if(picked) tr.classList.add("picked");
    if(pool) tr.classList.add("pool-row");
    const coreEnabledRow=new Set(state.enabledSystems);
    const cells=inp.map((v,i)=>{
      const code=i===0?"bp":"comp";
      if(!coreEnabledRow.has(code)) return "";
      return `<td class="hide" data-label="${["BP","Comp"][i]}">${(i===0&&g.bpSuspect&&v==null)?'<span class="bp-flag" title="The PDF gave a BP number wildly out of line with Comp, so it was dropped. Check the newsletter and enter it by hand.">⚠ check PDF</span>':''}<input class="inp num" type="number" inputmode="decimal" step="0.5" data-k="${g.key}" data-i="${i}" value="${v==null?"":v}" placeholder="—"></td>`;
    }).join("");
    const preds=predsFor(g.key);
    const sysCells=sysCols.map(c=>{
      const v=preds[c];
      const has=(v!=null&&v!==""&&!isNaN(v));
      return `<td class="hide sys-col num" data-label="${esc(predShort(c))}">${has?fmt(Number(v)):'<span class="faint">—</span>'}</td>`;
    }).join("");
    const myn=myNumber(g);
    const edgeStrengthClass=e?edgeClass(e.pts):"";
    const edgeHTML=e?`<span class="pick-side">${e.team?esc(e.team)+" "+fmt(e.line):"no lean"}</span><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts).replace("+","+").replace("-","")}</span>${edgeExtrasHTML(e,g)}`:edgeEmptyHTML(g);
    const pickedSide=picked?ent.picks[g.key].side:null;
    const boardExpanded=boardExpandedKeys.has(g.key);
    // The number on each team's pick button is what you're actually picking
    // against: the pool's LOCKED line once it's set (falling back to the
    // provisional live match pre-lock, same as before); in Overall there's no
    // locked concept, so it's just the live line as always.
    const buttonHomeLine=pool?(g.lockedLine!=null?g.lockedLine:g.vegas):g.vegas;
    const homeLine=buttonHomeLine, awayLine=buttonHomeLine!=null?-buttonHomeLine:null;
    const capReached=entryIsLocked(ent)||(!picked&&pickedCount>=pickLimit());
    const awayLogoHTML=g.awayLogo?`<img class="teampick-logo" src="${esc(g.awayLogo)}" alt="" loading="lazy">`:"";
    const homeLogoHTML=g.homeLogo?`<img class="teampick-logo" src="${esc(g.homeLogo)}" alt="" loading="lazy">`:"";
    const awayBtn=`<button class="teampick ${pickedSide==='away'?'active':''}" data-pickteam="${g.key}" data-side="away" ${capReached?"disabled":""}>${awayLogoHTML}${esc(g.away)}<span class="tp-line">${awayLine==null?"—":fmt(awayLine)}</span></button>`;
    const homeBtn=`<button class="teampick ${pickedSide==='home'?'active':''}" data-pickteam="${g.key}" data-side="home" ${capReached?"disabled":""}>${homeLogoHTML}${esc(g.home)}<span class="tp-line">${homeLine==null?"—":fmt(homeLine)}</span></button>`;
    let clvHTML="", aligned=0;
    if(pool){
      aligned=clvAlignment(g)||0;
      const alignBadge=aligned?` <span class="clv-align" title="Market movement since lock AND the model's remaining disagreement with the current line both point the same direction — the market's been sliding this way, and the model still sees more room to go.">⚡</span>`:"";
      const c=clvOf(g,pickedSide);
      if(!c) clvHTML=`<td class="clv-cell" data-label="CLV"><span class="faint">—</span></td>`;
      else if(c.forPick==null) clvHTML=`<td class="clv-cell" data-label="CLV" title="No pick yet — raw market move since lock, home-team perspective."><span class="clv-raw">${fmt(c.raw)}</span>${alignBadge}</td>`;
      else{
        const cls=c.forPick>0?"clv-good":c.forPick<0?"clv-bad":"clv-even";
        clvHTML=`<td class="clv-cell" data-label="CLV" title="Locked ${fmt(g.lockedLine)} · live ${fmt(g.liveVegas)} (home persp.)"><span class="${cls}">${fmt(c.forPick)}</span>${alignBadge}</td>`;
      }
      if(aligned) tr.classList.add("clv-aligned-row");
    }
    // Logo alt text: these two <td> cells are standalone -- no visible team
    // name lives in the SAME cell the way it does in a pick button or a
    // Snapshot card (there, the logo sits directly next to the team name
    // in one element, so alt="" is the right call, genuinely decorative).
    // Here a screen reader landing on this cell alone has nothing else to
    // go on, so these get real alt text instead. Don't blanket-apply
    // alt="" (or this pattern) without checking whether the team name is
    // actually adjacent in the same element first.
    // Two copies of the same toggle, shown responsively (never both at
    // once -- see the CSS rules right above .board-cfbd-toggle-cell's own
    // comment in app/index.html for why this needs to be two elements
    // rather than one CSS-repositioned element): the ORIGINAL dedicated
    // <td> stays for mobile (a real mobile bug fix from Aug 20 needs it
    // to be a direct <tr> child for CSS grid-row repositioning to work,
    // see that CSS rule's comment), and a second inline copy sits right
    // next to the shortlist flag for desktop specifically, per Aug 21
    // feedback that the far-right column read as disconnected. Both
    // share the same data-board-expand key, so document.querySelectorAll
    // ("[data-board-expand]") (below) binds a click handler to whichever
    // copy is actually visible at the current viewport width -- and to
    // the other, invisible one too, harmlessly, since only one is ever
    // shown by CSS at a time.
    const boardToggleLabel=boardExpanded?'▴ Hide matchup breakdown':'▾ Matchup breakdown';
    const boardToggleAttrs=`data-board-expand="${esc(g.key)}" aria-expanded="${boardExpanded?'true':'false'}"`;
    tr.innerHTML=`
      <td class="away-logo">${g.awayLogo?`<span class="logo-badge"><img src="${esc(g.awayLogo)}" alt="${esc(g.away)} logo" loading="lazy"></span>`:""}</td>
      <td class="game"><div class="matchup-picks">${awayBtn}<span class="vs">@</span>${homeBtn}<button class="shortlist-toggle ${shortlisted?'active':''}" data-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist — flag for a closer look before picking'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button><button class="board-cfbd-toggle board-cfbd-toggle-inline${boardExpanded?' open':''}" ${boardToggleAttrs}>${boardToggleLabel}</button></div><div class="kick">${kickStr(g.commence)}</div></td>
      <td class="home-logo">${g.homeLogo?`<span class="logo-badge"><img src="${esc(g.homeLogo)}" alt="${esc(g.home)} logo" loading="lazy"></span>`:""}</td>
      <td class="board-cfbd-toggle-cell"><button class="board-cfbd-toggle${boardExpanded?' open':''}" ${boardToggleAttrs}>${boardToggleLabel}</button></td>
      ${cells}${sysCells}
      <td class="veg-cell" data-label="Vegas"><span class="veg">${(pool?g.liveVegas:g.vegas)==null?"—":fmt(pool?g.liveVegas:g.vegas)}<span class="bk">${pool?(g.liveVegas!=null?"live":""):(g.book||"")}</span></span></td>
      ${clvHTML}
      <td class="myn-cell" data-label="Model #"><span class="myn" data-myn="${g.key}">${myn==null?"—":fmt(myn)}</span></td>
      <td class="prob-cell" data-label="Cover %" data-prob="${g.key}">${probCellHTML(e)}</td>
      <td class="edge ${edgeStrengthClass}" data-edge="${g.key}">${edgeHTML}</td>`;
    tb.appendChild(tr);
    // Matchup breakdown dropdown -- scoped specifically to ratings + Matchup
    // Intelligence (cfbdRatingsPanelHTML()/cfbdMatchupPanelHTML(), both
    // pure functions of `g` alone, already built for Snapshot's detail
    // row). Deliberately NOT the full renderSnapDetailRow(): that also
    // needs percentile ranks computed against Snapshot's own
    // opportunity-filtered row set (snapshotRows(), pts>0 games only) and
    // a Pick Score toggle state that's Snapshot-specific UI -- neither
    // applies cleanly to the full Board, which shows every game
    // (including "no lean" ones Snapshot excludes) and already shows
    // model/market/edge numbers directly in the row's own cells, so a
    // redundant "Your model"/"Market" breakdown panel would add nothing
    // here the way it does in Snapshot's more condensed view.
    if(boardExpanded){
      const ratingsHTML=(typeof cfbdRatingsPanelHTML==="function")?cfbdRatingsPanelHTML(g):"";
      const matchupHTML=(typeof cfbdMatchupPanelHTML==="function")?cfbdMatchupPanelHTML(g):"";
      const detailTr=document.createElement("tr");
      detailTr.className="board-detail-row";
      detailTr.dataset.boardDetailFor=g.key;
      detailTr.innerHTML=`<td colspan="${totalCols}">${ratingsHTML||matchupHTML?`${ratingsHTML}${matchupHTML}`:'<div class="cfbd-matchup-empty-note">No matchup breakdown available for this game yet.</div>'}</td>`;
      tb.appendChild(detailTr);
    }
  });
  bindRowInputs();
  updatePickCount();
  renderSnapshot();
}

/* ---------- Snapshot tab ----------
   Quick-scan summary view: Top Opportunities, a Week Snapshot stat panel,
   and a condensed Full Slate table, all computed from the SAME `games`/
   `state` data and the SAME real functions (myNumber/edgeOf/clvOf/
   probabilityCoverForGame/keyNumberScore) the full Edge Board uses --
   nothing here is a separate data source or a reimplementation that could
   drift from the real board. "View full board" just switches to the
   existing board tab, unchanged. */

// This tab is a quick scan, not a second full board -- always cap the
// condensed table at this many rows (regardless of which filter pill is
// active), with a "See full slate ->" link to the real board for
// everything past that. Games analyzed / Strong / Good / key-crossing
// counts in the Week Snapshot panel are NOT capped -- those reflect the
// whole week, only the row list itself is trimmed.
const SNAPSHOT_ROW_LIMIT=8;

// Which games currently have their detail row expanded. Ephemeral UI
// state only -- intentionally NOT part of `state`/saved, since which rows
// happen to be expanded isn't something worth persisting across reloads
// or syncing across devices.
const snapExpandedKeys=new Set();

// Percentile rank of `val` within `arr`, 0-100. Ties share the same rank
// (games with an identical value are treated identically, not arbitrarily
// ordered against each other).
function percentileRank(arr,val){
  if(arr.length<=1) return 50;
  const sorted=[...arr].sort((a,b)=>a-b);
  const below=sorted.filter(v=>v<val).length;
  return (below/(sorted.length-1))*100;
}

// Pick Score: an EQUAL-WEIGHTED percentile rank across three signals the
// app already computes with real, fitted methodology (Raw Edge magnitude,
// modeled Cover % from probabilityCoverForGame, and key-number proximity
// from keyNumberScore) -- ranked relative to just this week's own slate.
// No per-signal weight is hand-tuned. This is a SORTING CONVENIENCE, not a
// new probability estimate, and unlike Cover % it is NOT calibrated
// against historical outcomes -- see the methodology note rendered below
// the table, which says this in the UI itself rather than only in a code
// comment. Off by default (state.snapShowScore); Raw Edge alone is the
// fallback ranking, same metric the app has always used.
// Pick Score: an EQUAL-WEIGHTED percentile rank across three signals the
// app already computes with real, fitted methodology (Raw Edge magnitude,
// modeled Cover % from probabilityCoverForGame, and key-number proximity
// from keyNumberScore) -- ranked relative to just this week's own slate.
// No per-signal weight is hand-tuned. This is a SORTING CONVENIENCE, not a
// new probability estimate, and unlike Cover % it is NOT calibrated
// against historical outcomes -- see the methodology note rendered below
// the table, which says this in the UI itself rather than only in a code
// comment. Off by default (state.snapShowScore); Raw Edge alone is the
// fallback ranking, same metric the app has always used.
//
// Also stores the three individual percentile ranks (edgeRank/coverRank/
// keyRank) on each row even when the combined score itself isn't shown --
// the row-expand detail panel displays these three signals on their own
// regardless of the Pick Score toggle, since they're useful context
// either way, not just when the blended score is visible.
function computeSnapshotScores(rows){
  const edges=rows.map(r=>r.e.pts);
  const covers=rows.map(r=>r.e.prob?r.e.prob.pCover:0);
  const keys=rows.map(r=>r.e.keyScore||0);
  rows.forEach(r=>{
    const eR=percentileRank(edges,r.e.pts);
    const cR=percentileRank(covers,r.e.prob?r.e.prob.pCover:0);
    const kR=percentileRank(keys,r.e.keyScore||0);
    r.edgeRank=eR; r.coverRank=cR; r.keyRank=kR;
    r.pickScore=Math.round((eR+cR+kR)/3);
  });
}

// Renders the expandable detail panel for one row -- "why is this ranked
// where it is." The three signal percentiles show regardless of the Pick
// Score toggle (Drew's call: useful context either way, not just when the
// blended score is visible); the combined score itself only shows when
// Pick Score is on, since showing a number that isn't currently being
// used to rank anything would be confusing.
function renderSnapDetailRow(r,scoreOn,stats){
  const {g,e}=r;
  const colspan=7+(stats.pool?1:0)+(scoreOn?1:0);
  const scoreHTML=scoreOn?`<div class="detail-score-row">
      <span class="big-score num">${r.pickScore}</span>
      <span class="note" style="margin:0;">Pick Score — equal-weighted average of the three signals in this panel, ranked against this week's own slate.</span>
    </div>`:"";

  // YOUR MODEL -- real individual inputs (inputsFor/predsFor), nothing
  // fabricated. Only shows systems actually toggled on and actually
  // matched for this game.
  const inp=inputsFor(g.key);
  const modelRows=[];
  if(state.enabledSystems.includes("bp") && inp[0]!=null && inp[0]!=="") modelRows.push(["BP", Number(inp[0])]);
  if(state.enabledSystems.includes("comp") && inp[1]!=null && inp[1]!=="") modelRows.push(["Comp", Number(inp[1])]);
  const preds=predsFor(g.key);
  enabledSystemsOrdered().forEach(code=>{
    const v=preds[code];
    if(v!=null){
      const sysName=(PRED_SYSTEMS.find(s=>s.code===code)||{}).name||code;
      modelRows.push([sysName, Number(v)]);
    }
  });
  const myn=myNumber(g);
  const modelHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Your model</div>
    ${modelRows.length?modelRows.map(([lbl,v])=>`<div class="detail-line"><span>${esc(lbl)}</span><span class="num">${fmt(v)}</span></div>`).join(""):'<div class="detail-empty">No individual inputs loaded yet.</div>'}
    <div class="detail-line detail-line-total"><span>Model #</span><span class="num">${myn==null?'—':fmt(myn)}</span></div>
  </div>`;

  // MARKET -- pool line vs current market when in a pool (the real
  // comparison that matters for CLV), otherwise the resolved live line.
  // Always home-team perspective (g.lockedLine/g.liveVegas/g.vegas all
  // are, same as myNumber() and every row in the "Your model" column
  // above) -- this used to fall back to e.line in the non-pool branch,
  // which is picked-side perspective (flipped for an away pick, see
  // edgeOf()). That silently mismatched the home-perspective Model #
  // total right next to it whenever the pick was away -- same bug
  // family as the Snapshot condensed row's Market->Model cell, just
  // here it was the Market side that had the wrong convention instead
  // of the Model side. board's own Vegas column already does it this
  // way (`pool?g.liveVegas:g.vegas`, see renderBoard()) -- matching
  // that instead of inventing a third convention.
  const marketRows=[];
  if(stats.pool && g.lockedLine!=null){
    marketRows.push(["Pool line", g.lockedLine]);
    marketRows.push(["Current market", g.liveVegas]);
  }else{
    const marketLabel=(g.book&&g.book!=="consensus"&&g.book!=="demo")?g.book:"Consensus";
    const marketVal=stats.pool?g.liveVegas:g.vegas;
    marketRows.push([marketLabel, marketVal]);
  }
  const marketHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Market</div>
    ${marketRows.map(([lbl,v])=>`<div class="detail-line"><span>${esc(lbl)}</span><span class="num">${v==null?'—':fmt(v)}</span></div>`).join("")}
  </div>`;

  // SIGNALS -- real key-number/CLV facts, plus the three percentile ranks
  // (kept here, not removed by this redesign -- shown regardless of the
  // Pick Score toggle, same as before).
  const sigLines=[];
  if(e.keyNumbers&&e.keyNumbers.length){
    sigLines.push(`✓ Crosses key number${e.keyNumbers.length>1?'s':''} ${e.keyNumbers.join(', ')} (${e.keyTier})`);
  }
  const agreement=modelAgreement(g,e.side);
  if(agreement&&agreement.total){
    sigLines.push(`${agreement.agree}/${agreement.total} models favor ${e.team||"this side"} (${Math.round(agreement.pct*100)}% agreement)`);
  }
  if(stats.pool && g.lockedLine!=null){
    const ent=activeEntry();
    const picked=ent.picks[g.key];
    const c=clvOf(g, picked?picked.side:e.side);
    if(c&&c.forPick!=null){
      // Wording differs for an actual pick ("you beat the market") vs. just
      // the model's current lean on an unpicked game ("this side would beat
      // the market") -- both use the same forPick math, but claiming past
      // tense for a game nobody's picked yet would overstate it.
      if(picked){
        sigLines.push(c.forPick>0?`✓ CLV ${fmt(c.forPick)} — you beat the market`:c.forPick<0?`⚠ CLV ${fmt(c.forPick)} — market moved away`:`– CLV flat since lock`);
      }else{
        sigLines.push(c.forPick>0?`✓ CLV ${fmt(c.forPick)} if picked — this side beat the market`:c.forPick<0?`⚠ CLV ${fmt(c.forPick)} if picked — market moved away`:`– CLV flat since lock`);
      }
      // Same ⚡ alignment signal as the Board tab and Quick Look column --
      // market movement since lock AND the model's remaining disagreement
      // both point the same direction. Detail panel previously computed CLV
      // but never surfaced this specific compound signal.
      if(clvAlignment(g)){
        sigLines.push(`⚡ Market's still sliding this way — model agrees there's more room`);
      }
    }
  }
  const miniBar=(label,rank)=>`<div class="detail-sig-lbl">${label} <b>${Math.round(rank)}${ordinalSuffix(Math.round(rank))} pctile</b></div><div class="detail-bar-track"><div class="detail-bar-fill" style="width:${Math.max(2,rank)}%;"></div></div>`;
  const signalsHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Signals</div>
    ${sigLines.map(s=>`<div class="detail-sig">${s}</div>`).join("")}
    ${miniBar("Raw edge",r.edgeRank)}
    ${miniBar("Cover %",r.coverRank)}
    ${miniBar("Key-number proximity",r.keyRank)}
  </div>`;

  const ratingsHTML=(typeof cfbdRatingsPanelHTML==="function")?cfbdRatingsPanelHTML(g):"";
  const matchupHTML=(typeof cfbdMatchupPanelHTML==="function")?cfbdMatchupPanelHTML(g):"";
  return `<tr class="detail-row" data-detail-for="${esc(g.key)}"><td colspan="${colspan}">
    ${scoreHTML}
    <div class="detail-cols">${modelHTML}${marketHTML}${signalsHTML}</div>
    ${ratingsHTML}
    ${matchupHTML}
    <div class="detail-foot"><button class="btn btn-light" data-snap-jump="${esc(g.key)}" style="padding:6px 12px;font-size:12px;">Open on full board →</button></div>
  </td></tr>`;
}
function ordinalSuffix(n){
  const v=n%100;
  if(v>=11&&v<=13) return "th";
  switch(n%10){case 1:return "st";case 2:return "nd";case 3:return "rd";default:return "th";}
}

function computeWeekStats(rows){
  const pool=currentPool();
  const ent=activeEntry();
  let strong=0,good=0,keyCrossings=0;
  rows.forEach(r=>{
    const cls=edgeClass(r.e.pts);
    if(cls==="gd") strong++; else if(cls==="g") good++;
    if(r.e.keyNumbers&&r.e.keyNumbers.length) keyCrossings++;
  });
  const pickedKeys=Object.keys(ent.picks);
  let edgeSum=0,edgeCount=0,clvPos=0,clvEligible=0;
  pickedKeys.forEach(key=>{
    const g=games.find(x=>x.key===key);
    if(!g) return;
    const p=ent.picks[key];
    const e=edgeOf(g);
    if(e&&e.pts>0){ edgeSum+=e.pts; edgeCount++; }
    if(pool){
      const c=clvOf(g,p.side);
      if(c&&c.forPick!=null){ clvEligible++; if(c.forPick>0) clvPos++; }
    }
  });
  return {
    gamesAnalyzed:rows.length, strong, good, keyCrossings,
    avgPickEdge:edgeCount?edgeSum/edgeCount:null,
    clvPos, clvEligible, pool:!!pool, pickedCount:pickedKeys.length,
  };
}

function snapshotRows(){
  // Every game with a real lean (pts>0) -- "no lean" games have nothing to
  // rank or recommend, same exclusion the full board already applies.
  return games.map(g=>({g,e:edgeOf(g)})).filter(r=>r.e&&r.e.pts>0);
}

function snapshotFilterRows(rows,filter){
  const ent=activeEntry();
  switch(filter){
    case "strong": return rows.filter(r=>edgeClass(r.e.pts)==="gd");
    case "dog": return rows.filter(r=>r.e.side==="away");
    case "key": return rows.filter(r=>r.e.keyTier&&r.e.keyTier!=="none");
    case "mine": return rows.filter(r=>ent.picks[r.g.key]);
    case "shortlist": return rows.filter(r=>isShortlisted(r.g.key));
    default: return rows;
  }
}

function renderSnapshot(){
  const pool=currentPool();
  const ent=activeEntry();
  const scoreOn=!!state.snapShowScore;
  document.querySelectorAll("#scoreToggle .toggle-btn").forEach(b=>{
    b.classList.toggle("active",(b.dataset.score==="1")===scoreOn);
  });
  renderSetupStatus();
  renderContextBar();  const allRows=snapshotRows();
  computeSnapshotScores(allRows);
  const stats=computeWeekStats(allRows);

  // Pick count now lives in the global context bar's summary line (see
  // renderContextBar()) rather than a Snapshot-specific element -- this
  // used to write into a #snapPickCount span that existed only here,
  // duplicating what Board's own #pickCount showed with a different id.

  document.getElementById("snapRankNote").textContent=scoreOn
    ? "Ranked by Pick Score · market line shown"
    : "Ranked by Raw Edge · market line shown";

  const ranked=[...allRows].sort((a,b)=>scoreOn?b.pickScore-a.pickScore:b.e.pts-a.e.pts);

  // ---- Top Opportunities (top 3) ----
  document.getElementById("snapOppGrid").innerHTML=ranked.slice(0,3).map((r,idx)=>{
    const {g,e}=r;
    const cls=edgeClass(e.pts);
    const tierLabel=cls==="gd"?"Strong":cls==="g"?"Good":"Slim";
    const picked=!!ent.picks[g.key];
    const shortlisted=isShortlisted(g.key);
    const logo=e.side==="home"?g.homeLogo:g.awayLogo;
    const logoHTML=logo?`<img class="teampick-logo" src="${esc(logo)}" alt="" loading="lazy">`:"";
    // Only the #1 card gets the green "primary action" treatment -- #2/#3
    // used to render their own independent btn-go, meaning up to THREE
    // simultaneously-visible green "Add pick" buttons competed for the
    // same attention with no visual reason to click one over another.
    // btn-secondary (bold dark outline) still reads as a real, clickable
    // action for #2/#3 -- just not the one thing this screen is telling
    // you to do first. "Already picked" collapses to the same quiet
    // btn-light regardless of rank either way -- nothing left to
    // emphasize once it's done.
    const primaryAction=idx===0;
    return `<div class="opp-card${idx===0?' rank-1':''}">
      <div class="opp-tier ${cls}">${tierLabel.toUpperCase()}</div>
      <div class="opp-team">${logoHTML}${esc(e.team)} ${fmt(e.line)}</div>
      <div class="opp-stats ${scoreOn?'has-score':''}">
        <div><div class="opp-stat-lbl">Raw edge</div><div class="opp-stat-val edge-hero num">${fmt(e.pts)}</div><div class="edge-bar-track"><div class="edge-bar-fill" style="width:${Math.min(100,e.pts/12*100)}%;"></div></div></div>
        <div><div class="opp-stat-lbl">Cover est.</div><div class="opp-stat-val num">${e.prob&&e.prob.side?(e.prob.pCover*100).toFixed(1)+'%':'—'}</div></div>
        ${scoreOn?`<div><div class="opp-stat-lbl">Pick score</div><div class="opp-stat-val num">${r.pickScore}</div></div>`:''}
      </div>
      <div class="opp-actions">
        <button class="btn ${picked?'btn-light':(primaryAction?'btn-go':'btn-secondary')}" data-snap-pick="${esc(g.key)}" data-snap-side="${esc(e.side)}">${picked?'✓ Picked':'★ Add pick'}</button>
        <button class="shortlist-toggle ${shortlisted?'active':''}" data-snap-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist — flag for a closer look before picking'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button>
        <button class="btn btn-light" data-snap-jump="${esc(g.key)}">Details</button>
      </div>
    </div>`;
  }).join("") || `<p class="note">No games with a live lean yet — refresh lines or load model predictions.</p>`;

  // ---- Week Snapshot stat panel ----
  const statRows=[
    [`Games analyzed`, stats.gamesAnalyzed],
    [`Strong edges`, stats.strong],
    [`Good edges`, stats.good],
    [`Key-number crossings`, stats.keyCrossings],
    [`Your average pick edge`, stats.avgPickEdge==null?"—":fmt(stats.avgPickEdge)+" pts"],
    [`Shortlisted`, currentShortlist().length],
  ];
  if(stats.pool) statRows.push([`Picked games with +CLV`, stats.clvEligible?`${stats.clvPos} / ${stats.clvEligible}`:"—"]);
  document.getElementById("snapStatsList").innerHTML=statRows.map(([lbl,val])=>
    `<div class="snap-tile"><div class="snap-lbl">${lbl}</div><div class="snap-val num">${val}</div></div>`
  ).join("");

  // ---- Full Slate (condensed) ----
  const filter=state.snapFilter||"all";
  document.querySelectorAll("#snapFilterPills .pill-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===filter));
  const filteredAll=snapshotFilterRows(ranked,filter);
  const filtered=filteredAll.slice(0,SNAPSHOT_ROW_LIMIT);

  const scoreTh=scoreOn?'<th>Score</th>':'';
  document.getElementById("snapTableHead").innerHTML=
    `<th></th><th class="l">Recommended bet / matchup</th><th>Market → Model</th><th>Raw edge</th><th>Cover %</th>${stats.pool?'<th>CLV</th>':''}<th class="signal-th">Signal</th>${scoreTh}<th>Action</th>`;

  const tbody=document.getElementById("snapTableBody");
  const empty=document.getElementById("snapEmpty");
  if(!filtered.length){
    tbody.innerHTML="";
    empty.style.display="block";
    empty.textContent="No games match this filter.";
  }else{
    empty.style.display="none";
    tbody.innerHTML=filtered.map(r=>{
      const {g,e}=r;
      const picked=!!ent.picks[g.key];
      const shortlisted=isShortlisted(g.key);
      const myn=myNumber(g);
      let clvTd="";
      if(stats.pool){
        const cell=snapClvCellData(g,picked?ent.picks[g.key].side:null,e.side);
        // Same ⚡ signal the full Board tab already shows (clvAlignment()) --
        // market movement since lock AND the model's remaining disagreement
        // both pointing the same way. Previously Board-only; added here so
        // Snapshot users see it without switching tabs.
        const aligned=clvAlignment(g)||0;
        const alignBadge=aligned?` <span class="clv-align" title="Market movement since lock AND the model's remaining disagreement with the current line both point the same direction — the market's been sliding this way, and the model still sees more room to go.">⚡</span>`:"";
        if(cell.kind==="none"){
          clvTd=`<td data-label="CLV"><span class="faint">—</span></td>`;
        }else if(cell.kind==="raw"){
          // No pick AND no model lean either (model===market exactly) --
          // nothing to orient the move to, so show the raw home-perspective
          // market move instead of a blank dash.
          clvTd=`<td data-label="CLV" title="No pick or lean yet — raw market move since lock, home-team perspective."><span class="clv-raw num">${fmt(cell.value)}</span></td>`;
        }else{
          const title=cell.kind==="recommended"
            ? `Recommended pick — locked ${fmt(g.lockedLine)} · live ${fmt(g.liveVegas)} (home persp.)`
            : `Locked ${fmt(g.lockedLine)} · live ${fmt(g.liveVegas)} (home persp.)`;
          clvTd=`<td data-label="CLV" title="${title}"><span class="${cell.value>0?'clv-good':cell.value<0?'clv-bad':'clv-even'} num">${fmt(cell.value)}</span>${alignBadge}</td>`;
        }
      }
      const scoreTd=scoreOn?`<td data-label="Score"><span class="snap-score-cell num"><i class="dot g"></i>${r.pickScore}</span></td>`:'';
      const logo=e.side==="home"?g.homeLogo:g.awayLogo;
      // Own class (not the shared .teampick-logo used by Board's compact
      // pill buttons and the Top Opportunities cards above) -- Quick
      // Look's rows have real room for a bigger, more identifiable logo;
      // reusing .teampick-logo here would also bump it everywhere else
      // .teampick-logo is used, which wasn't part of this fix.
      const logoHTML=logo?`<img class="bet-logo" src="${esc(logo)}" alt="" loading="lazy">`:"";
      const isOpen=snapExpandedKeys.has(g.key);
      const mainRow=`<tr class="${picked?'picked':''}" data-key="${esc(g.key)}">
        <td><button class="expand-btn ${isOpen?'open':''}" data-snap-expand="${esc(g.key)}" aria-label="Show detail">▸</button></td>
        <td class="l" data-label="Bet"><div class="bet-block">${logoHTML}<div class="bet-text"><div class="bet-line">${esc(e.team)} ${fmt(e.line)}</div><div class="matchup-sub">${esc(g.away)} @ ${esc(g.home)}</div></div></div></td>
        <td data-label="Market → Model">${mktModelHTML(e,myn)}</td>
        <td data-label="Raw edge"><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts)}</span></td>
        <td data-label="Cover %">${probCellHTML(e)}</td>
        ${clvTd}
        <td data-label="Signal" class="signal-td">${edgeExtrasHTML(e,g)||'<span class="faint">—</span>'}</td>
        ${scoreTd}
        <td data-label="Pick"><button class="btn btn-light" data-snap-pick="${esc(g.key)}" data-snap-side="${esc(e.side)}" style="padding:5px 10px;font-size:12px;">${picked?'✓':'★'}</button><button class="shortlist-toggle ${shortlisted?'active':''}" data-snap-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button></td>
      </tr>`;
      const detailRow=isOpen?renderSnapDetailRow(r,scoreOn,stats):"";
      return mainRow+detailRow;
    }).join("");
  }

  const moreRow=document.getElementById("snapMoreRow");
  if(filteredAll.length>filtered.length){
    moreRow.style.display="flex";
    document.getElementById("snapMoreNote").textContent=
      `Showing top ${filtered.length} of ${filteredAll.length} games`;
  }else{
    moreRow.style.display="none";
  }

  document.getElementById("snapMethodology").innerHTML=scoreOn
    ? `<b>Pick Score, honestly:</b> equal-weighted percentile rank across this week's own Raw Edge, Cover %, and key-number proximity — three signals this app already computes with real fitted methodology. It's a sorting convenience for scanning the slate fast, not a new probability estimate, and it isn't calibrated against historical outcomes the way Cover % is. Switch to Raw Edge any time to rank by that alone.`
    : `<b>Ranked by Raw Edge</b> — the model-vs-market disagreement in points, the same metric the Edge Board has always used. Try Pick Score above to rank by a blend of Edge, Cover %, and key-number proximity instead.`;

  document.querySelectorAll("[data-snap-pick]").forEach(btn=>{
    btn.onclick=()=>{ pickTeam(btn.dataset.snapPick,btn.dataset.snapSide); };
  });
  document.querySelectorAll("[data-snap-shortlist]").forEach(btn=>{
    btn.onclick=()=>{ toggleShortlist(btn.dataset.snapShortlist); };
  });
  document.querySelectorAll("[data-snap-jump]").forEach(btn=>{
    btn.onclick=()=>{ switchTab("board"); setTimeout(()=>{ const row=document.querySelector(`tr[data-key="${CSS.escape(btn.dataset.snapJump)}"]`); if(row) row.scrollIntoView({behavior:"smooth",block:"center"}); },50); };
  });
  document.querySelectorAll("[data-snap-expand]").forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.snapExpand;
      if(snapExpandedKeys.has(key)) snapExpandedKeys.delete(key); else snapExpandedKeys.add(key);
      renderSnapshot(); // re-render Snapshot only -- expand/collapse doesn't touch board data
    };
  });
}
function bindRowInputs(){
  document.querySelectorAll("input.inp").forEach(el=>{
    el.addEventListener("input",()=>{
      const k=el.dataset.k, i=+el.dataset.i;
      const arr=inputsFor(k);
      arr[i]=el.value===""?null:Number(el.value);
      state.inputs[k]=arr; save();
      updateRowCalc(k);
    });
  });
  document.querySelectorAll("[data-pickteam]").forEach(btn=>{
    btn.addEventListener("click",()=>pickTeam(btn.dataset.pickteam,btn.dataset.side));
  });
  document.querySelectorAll("[data-shortlist]").forEach(btn=>{
    btn.addEventListener("click",()=>toggleShortlist(btn.dataset.shortlist));
  });
  // "▾ Matchup breakdown" toggle -- deliberately obvious (visible text label +
  // chevron, not a bare icon) per the request this was built for: the
  // matchup-details dropdown on the full Board needed to actually be
  // noticed, not just technically present the way a tiny icon might be
  // missed in a table this dense.
  document.querySelectorAll("[data-board-expand]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const key=btn.dataset.boardExpand;
      if(boardExpandedKeys.has(key)) boardExpandedKeys.delete(key); else boardExpandedKeys.add(key);
      renderBoard();
    });
  });
}
// Shared markup for the two edge add-on indicators, used by both the full
// render and the live-typing update path so they can never drift apart.
function edgeExtrasHTML(e,g){
  if(!e||e.pts<=0) return "";
  const badges=[];
  if(e.keyNumbers&&e.keyNumbers.length){
    const list=e.keyNumbers.join(", ");
    const tierLabel={major:"major",moderate:"moderate",minor:"minor"}[e.keyTier]||"";
    const title=`Near key number${e.keyNumbers.length>1?'s':''} ${list} — NCAAF final margins cluster heavily at these (3=FG, 7=TD dominate), so this edge is worth more than its raw point value alone suggests, whether it lands exactly on that number or just close to it. Weights fitted to 5,705 real FBS-vs-FBS games, 2018-2025.`;
    badges.push(`<span class="edge-key edge-key-${e.keyTier}" title="${title}">🔑 key #${e.keyNumbers.slice(0,2).join(",")} · ${tierLabel}</span>`);
  }
  const a=modelAgreement(g,e.side);
  if(a&&a.total){
    const pct=Math.round(a.pct*100);
    const cls=pct>=75?"strong":pct>=60?"good":"mixed";
    const title=`${a.agree} of ${a.total} enabled, positively weighted model inputs favor ${e.team||"this side"} against this line${a.neutral?`; ${a.neutral} sit exactly on the market`:""}. Vegas itself is not counted as a model.`;
    badges.push(`<span class="edge-agree edge-agree-${cls}" title="${title}">${a.agree}/${a.total} agree</span>`);
  }
  return badges.length?`<div class="edge-extras">${badges.join("")}</div>`:"";
}
// Cover % column: modeled P(cover) plus edge vs. the -110 breakeven, from
// probabilityCoverForGame() (see app/js/model.js for that and
// BUCKETED_COVER_TABLE). Shared by the full render and the live-typing
// update path.
function probCellHTML(e){
  if(!e||!e.prob||!e.prob.side) return '<span class="faint">—</span>';
  const pct=(e.prob.pCover*100).toFixed(1);
  const edgePct=e.prob.probEdge*100;
  const sign=edgePct>=0?"+":"";
  const cls=edgePct>0?"g":"r";
  const [lo,hi]=e.prob.bucketRange;
  const title=`P(cover)=${pct}% vs ${(BREAKEVEN_WINPCT*100).toFixed(1)}% breakeven at -110 (EV ${(e.prob.ev*100).toFixed(1)}% per $1 risked). Bucket: |line| ${lo}-${hi===999?'+':hi}. Fitted from 5,705 real FBS-vs-FBS games, 2018-2025 — measures how much your model's disagreement with the market shifts the real historical cover-margin distribution, not a track record of your model specifically.`;
  return `<span class="cover-val ${cls}" title="${title}">${pct}%</span><div class="raw-edge">${sign}${edgePct.toFixed(1)}% vs breakeven</div>`;
}
// Market -> Model cell (Snapshot condensed row): myNumber() is always
// expressed in home-team-spread convention (see "edge from home-line
// convention" comment on myNumber() in app/js/model.js) -- it never flips
// for which side actually got picked. e.line, by contrast, IS already
// flipped to the picked side's own line (see edgeOf() in app/js/model.js:
// line=-V for an away pick).
// Showing raw myn next to e.line silently mixed two different
// perspectives whenever the pick was the away team: e.g. a home-team
// model number of -32.2 rendered next to an away market line of +40.5,
// which reads as an ~73pt swing when the real edge two cells over says
// 8.3. Flip myn to match e.line's perspective so the arrow shows an
// apples-to-apples move and agrees with Raw Edge. (The full board's
// "Model #" column and the detail panel's "Your model" breakdown are
// deliberately NOT touched by this -- both are self-consistent, always
// home-perspective columns on their own, not paired arrow-to-arrow
// against a picked-side line the way this cell is.)
function mktModelHTML(e,myn){
  const mdl=myn==null?null:(e.side==="away"?-myn:myn);
  return `<span class="mkt-model num"><span class="mkt">${fmt(e.line)}</span><span class="arrow">→</span><span class="mdl">${mdl==null?'—':fmt(mdl)}</span></span>`;
}
function updateRowCalc(key){
  const g=games.find(x=>x.key===key); if(!g) return;
  const myn=myNumber(g);
  const mynEl=document.querySelector(`[data-myn="${CSS.escape(key)}"]`);
  if(mynEl) mynEl.textContent=myn==null?"—":fmt(myn);
  const e=edgeOf(g);
  const probEl=document.querySelector(`[data-prob="${CSS.escape(key)}"]`);
  if(probEl) probEl.innerHTML=probCellHTML(e);
  const edgeEl=document.querySelector(`[data-edge="${CSS.escape(key)}"]`);
  if(edgeEl){
    edgeEl.className="edge "+(e?edgeClass(e.pts):"");
    edgeEl.innerHTML=e?`<span class="pick-side">${e.team?esc(e.team)+" "+fmt(e.line):"no lean"}</span><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts).replace("-","")}</span>${edgeExtrasHTML(e,g)}`:edgeEmptyHTML(g);
  }
}
function updatePickCount(){
  const ent=activeEntry();
  const el=document.getElementById("pickCount");
  if(el) el.textContent=Object.keys(ent.picks).length+"/"+pickLimit();
  renderContextBar(); // pick count now lives in the global context bar's summary line
  renderPickSummary();
}
function renderPickSummary(){
  const wrap=document.getElementById("pickSummary");
  if(!wrap) return;
  const ent=activeEntry();
  const keys=Object.keys(ent.picks);
  if(!keys.length){ wrap.style.display="none"; wrap.innerHTML=""; return; }
  wrap.style.display="flex";
  wrap.innerHTML=keys.map(k=>{
    const p=ent.picks[k];
    return `<span class="pick-chip" data-jump="${esc(k)}">${esc(p.team)} ${fmt(p.line)}<span class="pc-x" data-remove="${esc(k)}" data-side="${esc(p.side)}" title="Remove pick">✕</span></span>`;
  }).join("");
  wrap.querySelectorAll("[data-jump]").forEach(chip=>{
    chip.onclick=(ev)=>{
      if(ev.target.closest("[data-remove]")) return; // the x handles its own click below
      const row=document.querySelector(`tr[data-key="${CSS.escape(chip.dataset.jump)}"]`);
      if(row) row.scrollIntoView({behavior:"smooth",block:"center"});
    };
  });
  wrap.querySelectorAll("[data-remove]").forEach(x=>{
    x.onclick=(ev)=>{
      ev.stopPropagation();
      pickTeam(x.dataset.remove,x.dataset.side);
      renderBoard(); updatePickCount();
    };
  });
}
