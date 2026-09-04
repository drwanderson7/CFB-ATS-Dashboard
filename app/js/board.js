// --- Board tab rendering ---------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Historically
// this file also contained the entire Snapshot tab (renderSnapshot() and
// everything it calls) -- extracted out to app/js/snapshot-export.js
// (Sept 1, 2026, TODO #24) to keep this file focused on Board and to give
// Snapshot/social-export room to keep growing on its own. Three real
// cell-rendering helpers stayed here rather than moving or being duplicated,
// because both renderBoard() (this file) and renderSnapshot() (the new
// file) genuinely call them: edgeExtrasHTML()/probCellHTML()/mktModelHTML().
// Same for bindRowInputs()/updateRowCalc()/updatePickCount()/
// renderPickSummary() -- Board-row-input plumbing that renderBoard() itself
// needs directly, and that Snapshot's own re-render path depends on
// indirectly (renderBoard() cascades into renderSnapshot() at its own end).
// If an even finer split of those shared helpers is ever wanted, this is
// the file to start from.
//
// Also contains the CFB week calendar (buildGames(), week index math),
// column sorting for the full board, and the Weekly Setup checklist card
// (computeWeeklySetup()/renderSetupStatus()) -- these are Board-specific,
// not shared with Snapshot.
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
//   - `renderSnapshot()` -- called at the end of renderBoard() to keep
//     Snapshot in sync (app/js/snapshot-export.js).
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
      // Rotation numbers are useful beyond PDF matching: preserve them on
      // pool-context runtime games too so the Edge Board can be sorted in the
      // familiar sportsbook/handicapper rotation order.  Missing values remain
      // missing and sort last.
      const awayRotation=pg.awayRotation!=null?pg.awayRotation:(lg&&lg.awayRotation!=null?lg.awayRotation:null);
      const homeRotation=pg.homeRotation!=null?pg.homeRotation:(lg&&lg.homeRotation!=null?lg.homeRotation:null);
      if(vegas==null){
        if(lg){ vegas=lg.vegas; book="live*"; away=lg.away; home=lg.home; } // de-truncate display from odds
        else book="";
      }
      return {key:mkey(pg.away,pg.home), away, home, commence:(pg.commence||(lg&&lg.commence)||null), vegas, book,
              poolLocked:locked, liveVegas, lockedLine:(pg.line!=null?pg.line:null), providerGameId,
              ...(awayRotation!=null?{awayRotation}:{}), ...(homeRotation!=null?{homeRotation}:{})};
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
  state.weekAnchor=val; save(); buildGames(); applyPdfData(); applyPredictions(); applyTeamLogos(); migrateGameKeys();
  if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot();
  sortGames(); renderBoard();
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
const SORT_LABELS={game:"Game",kickoff:"Game time",rotation:"Rotation #",bp:"BP",comp:"Comp",vegas:"Vegas",usernum:"My Numbers",myn:"Model #",myblend:"My Blend",cover:"Cover %",edge:"Edge",clv:"CLV"};
const SORT_DEFAULT_DIR={game:"asc",kickoff:"asc",rotation:"asc",bp:"desc",comp:"desc",vegas:"desc",usernum:"desc",myn:"desc",myblend:"desc",cover:"desc",edge:"desc",clv:"desc"};
function kickoffSortValue(g){
  const t=Date.parse((g&&g.commence)||"");
  return Number.isFinite(t)?t:null;
}
function rotationSortValue(g){
  if(!g) return null;
  const a=Number(g.awayRotation), h=Number(g.homeRotation);
  const vals=[];
  if(Number.isFinite(a)&&a>0) vals.push(a);
  if(Number.isFinite(h)&&h>0) vals.push(h);
  return vals.length?Math.min(...vals):null;
}
function rotationStr(g){
  if(!g) return "";
  const a=(g.awayRotation!=null&&Number.isFinite(Number(g.awayRotation)))?Number(g.awayRotation):null;
  const h=(g.homeRotation!=null&&Number.isFinite(Number(g.homeRotation)))?Number(g.homeRotation):null;
  if(a!=null&&h!=null) return `Rot ${a}–${h}`;
  if(a!=null) return `Rot ${a}`;
  if(h!=null) return `Rot ${h}`;
  return "";
}
function gameMetaStr(g){
  const bits=[];
  const kick=kickStr(g&&g.commence);
  const rot=rotationStr(g);
  if(kick) bits.push(kick);
  if(rot) bits.push(rot);
  return bits.join(" · ");
}
function sortValue(key,g){
  switch(key){
    case "game": return (g.home||"").toLowerCase();
    case "kickoff": return kickoffSortValue(g);
    case "rotation": return rotationSortValue(g);
    case "bp": return inputsFor(g.key)[0];
    case "comp": return inputsFor(g.key)[1];
    case "vegas": return currentPool()?g.liveVegas:g.vegas;
    case "usernum": return userNumberFor(g);
    // Sorts by whatever the Model # COLUMN actually displays -- the pure
    // PickGauge number while it's active, never the blend -- so "sort by
    // Model #" can never disagree with what that column shows. Sort by the
    // separate "My Blend" column (below) to sort by the blended number
    // instead.
    case "myn": return modelColumnDisplayNumber(g);
    case "myblend": return (typeof myBlendActive==="function"&&myBlendActive())?myNumber(g):null;
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
    let primary;
    if(typeof va==="string"||typeof vb==="string") primary=mul*String(va).localeCompare(String(vb));
    else primary=mul*(va-vb);
    if(primary) return primary;
    // Deterministic tie-breakers make simultaneous kickoff windows stable.
    // For Game time, rotation order is the natural secondary key; otherwise
    // fall back to matchup name so equal values do not jump between renders.
    if(key==="kickoff"){
      const ra=rotationSortValue(a), rb=rotationSortValue(b);
      if(ra!=null&&rb!=null&&ra!==rb) return ra-rb;
      if(ra!=null&&rb==null) return -1;
      if(ra==null&&rb!=null) return 1;
    }
    return String(a.home||a.key||"").localeCompare(String(b.home||b.key||""));
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
  const sysCols=enabledSystemsOrdered();
  const pgActive=(typeof isPickGaugeModelActive==="function")&&isPickGaugeModelActive();

  // Vegas lines and Entry selected are always meaningful regardless of
  // context or which inputs you've chosen to use -- never "not applicable".
  const hasLiveLines=!isDemo && !!(state.lastGames && state.lastGames.length);
  items.push({key:"vegas", status:hasLiveLines?"ok":"bad", label:"Vegas lines updated",
    fix:"Hit Refresh lines (top right) to pull this week's live spreads.",
    target:{highlight:"refreshBtn"}}); // header button, visible on every tab -- no tab switch needed

  // Powers PDF (BP/Comp) -- REMOVED from Weekly Setup entirely (Drew's
  // explicit Aug 26 call, tightened same day from an earlier pass that
  // still showed it as a "na"/informational row: "does not need to be
  // part of the weekly setup card at all"). Most users will never touch
  // this feature (it needs a personal Brad Powers newsletter subscription
  // plus a per-user PDF upload), and even an informational row was still
  // one more line of a checklist most people have no reason to see. BP/
  // Comp coverage is still fully visible elsewhere for whoever does use
  // it -- the board's own bp/comp sort-header columns (renderBoard()) and
  // computeInputColumnCoverage() itself (still defined above, just no
  // longer called from here) -- just not as a Weekly Setup line item.

  // Prediction systems -- only "required" if at least one is actually
  // toggled on in the checklist below. Not applicable if this week is
  // BP/Comp/Vegas only, by choice.
  if(sysCols.length===0&&!pgActive){
    // Real gap fix: this "na" (dash, not a warning) status is correct --
    // someone running a genuine Vegas/BP/Comp-only week by choice
    // shouldn't get nagged. But it previously had no target at all, so a
    // brand-new person who's simply never discovered prediction systems
    // exist got the exact same static, non-clickable row as someone who
    // deliberately opted out -- no path from "None enabled this week" to
    // actually seeing what's available. Adding a target (and making "na"
    // rows with a target clickable, see the clickable check below) fixes
    // that discovery gap without turning this into a recurring nag: it's
    // still a dash, not a warning triangle, and still doesn't count
    // against requiredCount/okCount.
    items.push({key:"preds", status:"na", label:"Prediction systems loaded",
      detail:"None enabled this week", fix:"Enable PickGauge Model # or browse individual prediction systems in Pick Board → This Week.",
      target:{tab:"board", openPanel:"predPanel", highlight:"predPanel"}});
  }else{
    const predsLoadedAt=state.predMeta&&state.predMeta.fetchedAt;
    items.push({key:"preds", status:predsLoadedAt?"ok":"bad", label:"Prediction systems loaded",
      fix:"Hit Load model predictions in Pick Board → This Week.",
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
      fix:"Import this pool's sheet in Pick Board → Pool Settings.",
      target:{tab:"pools", highlight:"poolImportLabel_"+pool.id}});
  }

  const entryOk=!!activeEntry();
  items.push({key:"entry", status:entryOk?"ok":"bad", label:"Entry selected",
    fix:"Add an entry in My Picks, then select that pool and entry from the Viewing bar.",
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
    // "bad" (actionable) rows always get a Go-> link when they have a
    // target. "na" rows are informational by design -- correct for
    // someone who's deliberately opted out of something -- but a "na"
    // row can ALSO carry a target for the "never discovered this exists"
    // case (see the prediction-systems item above): still a dash, not a
    // warning triangle, and still excluded from requiredCount/okCount,
    // but now clickable so there's an actual path to finding it.
    const clickable=!!i.target && (i.status==="bad" || i.status==="na");
    const inner=`<span class="setup-check ${i.status}">${icon}</span>
      <span class="setup-label">${esc(i.label)}</span>
      ${i.detail?`<span class="setup-detail">${esc(i.detail)}</span>`:''}
      ${clickable?`<span class="setup-row-arrow">${i.status==="na"?"Explore →":"Go →"}</span>`:''}`;
    if(clickable){
      return `<button type="button" class="setup-row setup-row-action${i.status==="na"?" setup-row-na":""}" data-setup-key="${esc(i.key)}" title="${esc(i.fix||'')}">${inner}</button>`;
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
    <span class="psb-arrow">Open Pool Settings →</span>`;
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
    ? `<button class="btn-link-sm" id="loadPredsBtn" title="Pull the latest lines for every system you've toggled on below">predictions loaded ✓ · reload</button><span id="predStatus" class="mono-sm" role="status" aria-live="polite"></span>`
    : `<button class="btn btn-secondary" id="loadPredsBtn" title="Pull the latest lines for every system you've toggled on below">⬇ Load model predictions</button><span id="predStatus" class="mono-sm" role="status" aria-live="polite"></span>`;
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
  if(typeof renderMyNumbersControls==="function") renderMyNumbersControls();
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
  const pgActive=isPickGaugeModelActive();
  const blendActive=(typeof myBlendActive==="function")&&myBlendActive();
  const modelLabel=pgActive?"PickGauge Model #":"Model #";
  const headRow=document.getElementById("boardHeadRow");
  const resortBtn=document.getElementById("resortBtn");
  if(resortBtn) resortBtn.textContent="⇅ Re-sort by "+(state.sortKey==="myn"?modelLabel:(SORT_LABELS[state.sortKey]||"edge"));
  const mSel=document.getElementById("mobileSortSel");
  if(mSel && mSel.value!==state.sortKey) mSel.value=state.sortKey;
  const mDirBtn=document.getElementById("mobileSortDirBtn");
  if(mDirBtn) mDirBtn.textContent=state.sortDir==="asc"?"↑ Asc":"↓ Desc";
  // Sort is always visible above the collapsible panel now. The summary
  // only needs to tell the user whether optional filters are active.
  const sfSummary=document.getElementById("sortFilterSummary");
  if(sfSummary){
    const activeFilterCount=[pool&&state.boardFilter==="aligned", !!state.boardShortlistOnly].filter(Boolean).length;
    sfSummary.textContent=activeFilterCount?`${activeFilterCount} filter${activeFilterCount>1?"s":""} on`:"Optional";
  }
  if(headRow){
    const sysTh=sysCols.map(c=>`<th class="hide sys-col" title="${esc(predName(c))}">${esc(predShort(c))}</th>`).join("");
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
      sortHeaderHTML("usernum","My Numbers",{title:"Your personal projected spread, saved to your account by season/week. Click to sort.",extraClass:"usernum-cell"})+
      sortHeaderHTML("myn",modelLabel,{title:pgActive?"PickGauge Model # — click to sort.":"Click to sort."})+
      sortHeaderHTML("myblend","My Blend",{title:"PickGauge Model # blended with your enabled comparison system(s), at their own weights. Edge/Cover %/pick recommendations use this while a blend is active. Click to sort.",extraClass:"myblend-cell"})+
      sortHeaderHTML("cover","Cover %",{title:"Modeled probability your side covers, fitted from 5,705 real FBS-vs-FBS games (2018-2025), bucketed by spread size. Green = above the -110 breakeven (52.38%), red = below it. Click to sort."})+
      sortHeaderHTML("edge","Edge — lean",{title:"Click to sort."});
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
    const myn=modelColumnDisplayNumber(g);
    const blendVal=blendActive?myNumber(g):null;
    const pgCoverage=(pgActive&&typeof pickGaugeModelCoverage==="function")?pickGaugeModelCoverage(g):null;
    const pgCoverageHTML=(pgCoverage&&myn!=null&&pgCoverage.modelCount<pgCoverage.totalModels)
      ?`<span class="pg-model-coverage" title="One or more PickGauge model sources are not available yet; the available predictive-model weights are proportionally rebalanced while Vegas keeps its intended influence.">${pgCoverage.modelCount}/${pgCoverage.totalModels} models</span>`:"";
    const edgeStrengthClass=e?edgeClass(e.pts):"";
    // Tier word ("Strong"/"Good"/"Slim") sits above the team name so the
    // strength of the lean is stated, not just color-coded -- see
    // edgeTierLabel() in model.js for why. Suppressed on a genuine "no
    // lean" (model agrees with the market), where there's no pick to rate.
    const edgeTierHTML=(e&&e.team)?`<span class="edge-tier ${edgeClass(e.pts)}">${edgeTierLabel(e.pts)}</span>`:"";
    const edgeHTML=e?`${edgeTierHTML}<span class="pick-side">${e.team?esc(e.team)+" "+fmt(e.line):"no lean"}</span><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts).replace("+","+").replace("-","")}</span>${edgeExtrasHTML(e,g)}`:edgeEmptyHTML(g);
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
      <td class="game"><div class="matchup-picks">${awayBtn}<span class="vs">@</span>${homeBtn}<button class="shortlist-toggle ${shortlisted?'active':''}" data-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist — flag for a closer look before picking'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button><button class="board-cfbd-toggle board-cfbd-toggle-inline${boardExpanded?' open':''}" ${boardToggleAttrs}>${boardToggleLabel}</button></div><div class="kick">${gameMetaStr(g)}</div></td>
      <td class="home-logo">${g.homeLogo?`<span class="logo-badge"><img src="${esc(g.homeLogo)}" alt="${esc(g.home)} logo" loading="lazy"></span>`:""}</td>
      <td class="board-cfbd-toggle-cell"><button class="board-cfbd-toggle${boardExpanded?' open':''}" ${boardToggleAttrs}>${boardToggleLabel}</button></td>
      ${cells}${sysCells}
      <td class="veg-cell" data-label="Vegas"><span class="veg">${(pool?g.liveVegas:g.vegas)==null?"—":fmt(pool?g.liveVegas:g.vegas)}<span class="bk">${pool?(g.liveVegas!=null?"live":""):(g.book||"")}</span></span></td>
      ${clvHTML}
      <td class="usernum-cell" data-label="My Numbers" data-my-number-cell="${esc(g.key)}">${myNumbersCellHTML(g)}</td>
      <td class="myn-cell" data-label="${esc(modelLabel)}"><span class="myn" data-myn="${g.key}">${myn==null?"—":fmt(myn)}</span>${pgCoverageHTML}</td>
      <td class="myblend-cell" data-label="My Blend" title="PickGauge Model # blended with your enabled comparison system(s) at their own weights. This is what Edge/Cover %/pick recommendations below actually use while a blend is active -- the pure PickGauge Model # number to the left never changes.">${blendActive?`<span class="myblend" data-myblend="${g.key}">${blendVal==null?"—":fmt(blendVal)}</span>`:""}</td>
      <td class="prob-cell" data-label="Cover %" data-prob="${g.key}">${probCellHTML(e)}</td>
      <td class="edge ${edgeStrengthClass}" data-edge="${g.key}">${edgeHTML}</td>`;
    tb.appendChild(tr);
    // Matchup breakdown dropdown -- scoped specifically to ratings + Matchup
    // Intelligence (cfbdRatingsPanelHTML()/cfbdMatchupPanelHTML(), both
    // pure functions of `g` alone, already built for Snapshot's detail
    // row). Deliberately NOT the full renderSnapDetailRow(): that also
    // needs percentile ranks computed against Snapshot's own
    // opportunity-filtered row set (snapshotRows(), pts>0 games only) and
    // a Cover %-ranking toggle state that's Snapshot-specific UI --
    // neither
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
  if(typeof bindMyNumbersRowInputs==="function") bindMyNumbersRowInputs(document);
  // "My Blend" column: hidden unless a blend is genuinely active (PickGauge
  // on AND at least one comparison system carries positive weight) --
  // otherwise it'd just be a second copy of the Model # column, identical
  // clutter to the always-on My Numbers column this same pattern already
  // fixed (see .board.hide-usernum, app/css/app.css).
  const boardEl=document.querySelector(".board");
  if(boardEl) boardEl.classList.toggle("hide-myblend",!blendActive);
  updatePickCount();
  renderSnapshot();
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
  const myn=modelColumnDisplayNumber(g);
  const mynEl=document.querySelector(`[data-myn="${CSS.escape(key)}"]`);
  if(mynEl) mynEl.textContent=myn==null?"—":fmt(myn);
  // My Blend mirrors the same value Edge/Cover % below now key off, kept in
  // sync on every My Numbers / manual line edit the same as everything
  // else in this function -- omitting it here would leave it showing a
  // stale number after exactly the kind of edit most likely to change it.
  const blendActive=(typeof myBlendActive==="function")&&myBlendActive();
  const blendEl=document.querySelector(`[data-myblend="${CSS.escape(key)}"]`);
  if(blendEl) blendEl.textContent=blendActive?(()=>{ const v=myNumber(g); return v==null?"—":fmt(v); })():"—";
  const e=edgeOf(g);
  const probEl=document.querySelector(`[data-prob="${CSS.escape(key)}"]`);
  if(probEl) probEl.innerHTML=probCellHTML(e);
  const edgeEl=document.querySelector(`[data-edge="${CSS.escape(key)}"]`);
  if(edgeEl){
    edgeEl.className="edge "+(e?edgeClass(e.pts):"");
    // Must mirror renderBoard()'s own edgeHTML exactly -- this live-update
    // path runs on every My Numbers / manual line edit, so omitting the tier
    // label here would silently strip it from any row the user touched.
    const tierHTML=(e&&e.team)?`<span class="edge-tier ${edgeClass(e.pts)}">${edgeTierLabel(e.pts)}</span>`:"";
    edgeEl.innerHTML=e?`${tierHTML}<span class="pick-side">${e.team?esc(e.team)+" "+fmt(e.line):"no lean"}</span><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts).replace("-","")}</span>${edgeExtrasHTML(e,g)}`:edgeEmptyHTML(g);
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
