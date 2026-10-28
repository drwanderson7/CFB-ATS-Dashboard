// --- Odds fetch -------------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// pulling fresh Vegas lines through our own serverless proxy
// (refreshLines(), which talks to api/fetch_odds.py rather than The Odds
// API directly -- see the in-function comments for why: server-owned
// shared cache, no client-side API-key gate, freshness-window reuse
// before spending a real API call), and resolving each device's own
// sportsbook preference out of the shared per-book line cache
// (resolveVegasLine()/resolveBookLines() -- every device stores every
// book's line and resolves its own choice from it live, rather than
// whoever refreshed last baking their book choice in for everyone).
//
// Loaded as a plain <script src="/app/js/odds.js"> tag, same as
// model.js/board.js/picks.js -- an ordinary global scope, not a module.
// Real external references this file makes that are NOT self-contained
// (all resolved lazily inside function bodies, never at top-level, so
// script load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `state` -- the global app state object (main inline script).
//   - `pullTier()` -- cross-device shared-tier sync (main inline script).
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `minsAgo()`/`SHARED_FRESH_MINUTES` -- freshness-window helpers
//     (main inline script).
//   - `buildGames()`/`migrateGameKeys()`/`sortGames()`/`round1()` --
//     game-list construction (app/js/board.js / main inline script).
//   - `applyPdfData()`/`applyPredictions()` -- BP/Comp and prediction-
//     tracker data merge (main inline script).
//   - `renderBoard()` -- app/js/board.js. `renderEntries()`/
//     `renderPicksDetail()` -- app/js/picks.js.
//   - `save()` -- persistence (main inline script).
//   - `goSettings()` -- error-reporting redirect to the Settings tab
//     (main inline script).
//   - `esc()` -- general string utility (main inline script).
function oddsFreshMinutes(games,nowMs){
  const now=(nowMs==null?Date.now():Number(nowMs));
  let nearest=Infinity;
  (games||[]).forEach(g=>{
    if(!g||!g.commence) return;
    const t=Date.parse(g.commence);
    if(isNaN(t)||t<=now) return;
    nearest=Math.min(nearest,(t-now)/60000);
  });
  if(nearest<=60) return 5;
  if(nearest<=6*60) return 10;
  if(nearest<=24*60) return 15;
  return (typeof SHARED_FRESH_MINUTES!=="undefined"?SHARED_FRESH_MINUTES:30);
}

// --- Automatic live-data loading ----------------------------------------
// Oct 26, 2026: market lines come from The Odds API ONLY when someone clicks
// Refresh lines (refreshLines() below). Opening the app or coming back to the
// tab never calls /api/fetch_odds: startup shows the latest SHARED lines from
// the normal shared-state pull, and a tab resume re-pulls that shared state
// (our own Redis read, no Odds API quota). Model predictions still load on
// their own -- fetchPredictions() spends no Odds API quota.
// liveDataStaleness() is the pure decision (which feed is outside its own
// freshness window); `lines` is still reported for the header/setup hints but
// never triggers a fetch.
function liveDataStaleness(nowMs){
  const now=(nowMs==null?Date.now():Number(nowMs));
  const ageMin=iso=>{
    if(!iso) return null;
    const t=Date.parse(iso);
    return isNaN(t)?null:Math.max(0,Math.floor((now-t)/60000));
  };
  const lastGames=Array.isArray(state.lastGames)?state.lastGames:[];
  const linesAge=ageMin(state.lastRefresh);
  const lines=!lastGames.length||linesAge==null||linesAge>=oddsFreshMinutes(lastGames,now);
  const preds=Array.isArray(state.predictions)?state.predictions:[];
  const predAge=ageMin(state.predMeta&&state.predMeta.fetchedAt);
  const predWindow=(typeof SHARED_FRESH_MINUTES!=="undefined"?SHARED_FRESH_MINUTES:30);
  const predictions=!preds.length||predAge==null||predAge>=predWindow;
  return {lines, predictions};
}
let autoLoadInFlight=null;
async function autoLoadLiveData(reason){
  if(autoLoadInFlight) return autoLoadInFlight;
  if(!(window.Clerk&&window.Clerk.user)) return false;
  const resume=reason==="resume";
  if(!resume&&!liveDataStaleness().predictions){
    if(typeof autoArchiveFinishedWeeks==="function") autoArchiveFinishedWeeks();
    return false;
  }
  autoLoadInFlight=(async()=>{
    try{
      // A long-open tab picks up lines someone else refreshed: a plain
      // shared-state read, never an Odds API call.
      if(resume&&typeof pullTier==="function"&&await pullTier("shared",false)&&typeof rehydrateAfterSync==="function") rehydrateAfterSync();
      if(liveDataStaleness().predictions) await fetchPredictions({auto:true,reason:reason||"auto"});
    }catch(err){
      console.error("autoLoadLiveData failed:",err);
    }finally{
      autoLoadInFlight=null;
    }
    // Re-render once the in-flight flag is cleared so no "loading…" empty
    // state can outlive a failed or skipped fetch.
    if(typeof renderBoard==="function") renderBoard();
    // Fresh slate data is exactly when a finished week becomes detectable.
    if(typeof autoArchiveFinishedWeeks==="function") autoArchiveFinishedWeeks();
    return true;
  })();
  return autoLoadInFlight;
}
// "Sat 9:14 AM" style time for when the shared lines were last pulled from
// The Odds API: time only when it's today, weekday + time within the last
// six days, month/day + time beyond that (a weekday alone would be ambiguous).
function linesWhen(iso,nowMs){
  if(!iso) return null;
  const d=new Date(iso);
  if(isNaN(d.getTime())) return null;
  const now=new Date(nowMs==null?Date.now():Number(nowMs));
  const time=d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  if(d.toDateString()===now.toDateString()) return time;
  const days=(now-d)/86400000;
  if(days>0&&days<6) return `${d.toLocaleDateString(undefined,{weekday:"short"})} ${time}`;
  return `${d.toLocaleDateString(undefined,{month:"short",day:"numeric"})} ${time}`;
}
function linesUpdatedLabel(iso,nowMs){
  const when=linesWhen(iso,nowMs);
  return when?`Lines updated ${when}`:"Lines not loaded yet";
}
const LINES_PAUSED_MESSAGE="Live lines are paused — the shared odds budget is nearly used up.";
function mergePreKickLinesLocally(incoming){
  if(!incoming||typeof incoming!=="object") return;
  state.preKickLines=(state.preKickLines&&typeof state.preKickLines==="object")?state.preKickLines:{};
  Object.entries(incoming).forEach(([key,rec])=>{
    if(!rec||typeof rec!=="object") return;
    const old=(state.preKickLines[key]&&typeof state.preKickLines[key]==="object")?state.preKickLines[key]:{};
    state.preKickLines[key]={
      ...old,...rec,
      books:{...(old.books||{}),...(rec.books||{})},
      bookObservedAt:{...(old.bookObservedAt||{}),...(rec.bookObservedAt||{})},
    };
  });
}
function adoptOddsResponseLocally(data){
  if(!data||!Array.isArray(data.games)) return false;
  state.lastGames=data.games;
  state.lastRefresh=data.lastRefresh||new Date().toISOString();
  if(data.reqLeft!=null) state.reqLeft=data.reqLeft;
  state.booksSeen=[...new Set([...(state.booksSeen||[]),...(data.booksSeen||[])])].sort();
  mergePreKickLinesLocally(data.preKickLines);
  return true;
}

// Only ever called from the Refresh lines button (Oct 26, 2026) -- nothing
// refreshes lines on its own any more. `statusMsg` is written to the header
// status line AFTER refreshMeta() (finally block) so a failure or "paused"
// note isn't immediately replaced by the plain "Lines updated ..." label.
async function refreshLines(){
  let statusMsg=null;
  if(typeof betaRememberAction==="function") betaRememberAction("odds_refresh",{source:"button"});
  const btn=document.getElementById("refreshBtn");
  btn.disabled=true; btn.textContent="↻ Loading…";
  // Freshness guard: pull whatever the shared tier currently has BEFORE
  // spending a real Odds API call -- someone else may have refreshed within
  // the freshness window already (see SHARED_FRESH_MINUTES, still in
  // app/index.html's main inline script).
  await pullTier("shared",true);
  const freshAge=minsAgo(state.lastRefresh);
  const freshWindow=oddsFreshMinutes(state.lastGames);
  if(freshAge!=null&&freshAge<freshWindow&&(state.lastGames||[]).length){
    resolveBookLines(state.lastGames);
    buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos(); if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot(); save(); sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
    populateBooks();
    refreshMeta();
    document.getElementById("refreshTime").textContent=`Using recent shared lines from ${freshAge}m ago`;
    rebuildSurvivorForLines();
    if(typeof trackBetaEvent==="function") trackBetaEvent("odds_refresh",{source:"cache"});
    btn.disabled=false; btn.textContent="↻ Refresh lines";
    return;
  }
  // Go through our own serverless proxy (api/fetch_odds) rather than calling
  // The Odds API straight from the browser. The proxy now ALSO writes the
  // shared cache itself (server-owned -- see api/fetch_odds.py and
  // api/state.py's docstring on why the browser no longer POSTs shared
  // data), so after a successful call we re-pull the shared tier to see
  // the server's own persisted copy rather than trusting this response as
  // the local source of truth -- every client converges on the same data
  // that way, including ones that didn't trigger the refresh.
  //
  // No client-side "you need a key" gate anymore: ODDS_API_KEY on the
  // server covers everyone by default (sign in and it just works); a
  // personal per-device key, if set, rides along in a header -- never a
  // URL query string, which can end up in logs/history.
  try{
    const result=await apiFetch('/api/fetch_odds',{
      headers:state.apiKey?{'X-Odds-Api-Key':state.apiKey}:{},
    });
    const left=result.res&&result.res.headers.get("x-requests-remaining");
    if(!result.ok){
      // Only a real key problem belongs on Settings -- a genuinely expired
      // Clerk session or a transient rate-limit/server/network failure
      // doesn't. Before apiFetch, every failure here got treated as "no
      // odds key" (any 401 => that message) and every failure got sent to
      // Settings regardless of kind -- only "missing_key" does that now.
      if(result.kind==="missing_key"){ goSettings(result.error); return; }
      const paused=result.body&&result.body.paused;
      const pausedWhen=paused?linesWhen(state.lastRefresh):null;
      const msg=paused?`${LINES_PAUSED_MESSAGE}${pausedWhen?` Showing lines from ${pausedWhen}.`:""}`
        :result.kind==="auth"?result.error+" Sign back in from the account menu, then try again."
        :result.kind==="rate_limit"?"Refreshed too recently — the shared lines are already current, try again in a bit."
        :result.error;
      statusMsg=paused?msg:"refresh failed: "+msg;
      if(paused&&typeof pgAlert==="function") pgAlert({title:"Live lines paused",message:msg});
      console.error("refreshLines failed:",msg);
      return;
    }
    const data=result.body;
    if(left!=null){ state.reqLeft=left; save(); }
    // Quota floor (api/fetch_odds.py): the server re-checked the real
    // remaining Odds API budget and it's still too low, so it served the
    // latest shared copy instead of spending a call. Say so plainly.
    if(data.paused){
      await pullTier("shared",true);
      if(!(state.lastGames||[]).length) adoptOddsResponseLocally(data);
      resolveBookLines(state.lastGames);
      buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos(); save(); sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
      const when=linesWhen(state.lastRefresh||data.lastRefresh);
      statusMsg=`${LINES_PAUSED_MESSAGE} Showing lines from ${when||"the last refresh"}.`;
      rebuildSurvivorForLines();
      if(typeof pgAlert==="function") pgAlert({title:"Live lines paused",message:statusMsg});
      if(typeof trackBetaEvent==="function") trackBetaEvent("odds_refresh",{source:"paused"});
      return;
    }
    if(!(data.games||[]).length){
      refreshMeta();
      statusMsg="no NCAAF spreads posted yet — use Load model predictions";
      return;
    }
    const sharedPulled=await pullTier("shared",true); // prefer the server's persisted copy
    // A successful upstream fetch must still be usable when Redis/state sync
    // is temporarily unavailable. The endpoint tells us whether its cache
    // write succeeded; a failed follow-up pull is also enough reason to use
    // the fresh response directly on this device. Do NOT advance
    // sharedUpdatedAt here -- that clock belongs to the actual shared cache.
    if(data.sharedPersisted===false || !sharedPulled || state.lastRefresh!==data.lastRefresh){
      adoptOddsResponseLocally(data);
      statusMsg="Fresh lines loaded locally — shared cache unavailable";
    }
    resolveBookLines(state.lastGames);
    state.weekAnchor=null; // land on the earliest posted week after a fresh pull
    save();
    buildGames(); applyTeamLogos(); migrateGameKeys(); applyPdfData(); applyPredictions(); applyTeamLogos(); if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot(); save(); sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
    refreshMeta();
    populateBooks();
    rebuildSurvivorForLines();
    if(typeof trackBetaEvent==="function") trackBetaEvent("odds_refresh",{source:"server"});
  }catch(err){
    // apiFetch itself never throws -- this only catches a genuine bug in
    // the success-path code above (buildGames() etc.), not a request
    // failure, so it stays a generic fallback rather than duplicating the
    // classified handling above.
    statusMsg="refresh failed: "+(err&&err.message?err.message:String(err));
    console.error("refreshLines failed:",err);
  }finally{
    refreshMeta(); // keep calls-left honest even when the try block bailed early
    if(statusMsg) document.getElementById("refreshTime").textContent=statusMsg;
    btn.disabled=false; btn.textContent="↻ Refresh lines";
  }
}
// Resolves ONE game's per-book line dict (g.books, written server-side by
// api/fetch_odds.py) down to a single {line,book} using this device's own
// sportsbook preference. Replaces the old design where whichever person
// triggered the refresh baked THEIR book choice into the shared cache for
// everyone -- the shared cache now stores every book's line, and each
// device resolves its own preference from it, live, every time.
function resolveVegasLine(g,bookPref){
  const books=g&&g.books;
  const keys=books?Object.keys(books):[];
  if(!keys.length){
    // Backward compat: a game cached before this fix shipped (or a
    // demo/manually-entered game) has no per-book dict, only the old
    // single resolved vegas/book fields -- fall back to those rather than
    // losing the line entirely.
    return g&&g.vegas!=null?{line:g.vegas,book:g.book||"consensus"}:null;
  }
  if(bookPref&&bookPref!=="consensus"&&books[bookPref]!=null){
    return {line:books[bookPref],book:bookPref};
  }
  const pts=keys.map(k=>books[k]);
  const avg=pts.reduce((a,c)=>a+c,0)/pts.length;
  return {line:Math.round(avg*2)/2,book:"consensus"};
}
// Re-derives g.vegas/g.book on every game in `games` from g.books + the
// current device's state.book preference. Called after: a fresh odds pull,
// a shared-tier pull from another device's refresh, and any time the
// person changes their book preference in Settings -- so g.vegas always
// reflects THIS device's own choice, never whoever last hit "refresh".
function resolvePreKickRecordLine(rec,bookPref){
  if(!rec||!rec.books||!Object.keys(rec.books).length) return null;
  const r=resolveVegasLine({books:rec.books},bookPref||"consensus");
  if(!r) return null;
  const observedAt=(r.book!=="consensus"&&rec.bookObservedAt&&rec.bookObservedAt[r.book])
    ?rec.bookObservedAt[r.book]:(rec.observedAt||null);
  return {line:r.line,book:r.book,observedAt};
}
// Locate a server-captured pre-kick market snapshot even if the game has
// already disappeared from the current /odds feed. Provider id is preferred;
// team-name matching is only the backward-compatible fallback for older picks.
function preKickRecordForPick(p,live){
  const all=state.preKickLines||{};
  const id=(p&&p.providerGameId)||(live&&live.providerGameId)||(live&&live.id)||null;
  if(id&&all[id]) return all[id];
  let away=live&&live.away, home=live&&live.home;
  if((!away||!home)&&p&&p.matchup){
    const parts=String(p.matchup).split(/\s+@\s+/);
    if(parts.length===2){ away=parts[0]; home=parts[1]; }
  }
  if(!away||!home) return null;
  return Object.values(all).find(rec=>rec&&teamMatchTrunc(away,rec.away)&&teamMatchTrunc(home,rec.home))||null;
}
function resolveBookLines(games){
  (games||[]).forEach(g=>{
    const r=resolveVegasLine(g,state.book);
    if(r){ g.vegas=round1(r.line); g.book=r.book; }
  });
}
// parseOdds()/homeLine()/spreadHome() (client-side extraction of The Odds
// API's raw bookmakers array) were removed here -- api/fetch_odds.py's
// extract_games() does that same extraction server-side now and returns
// pre-shaped {away,home,commence,books} objects directly. Everything the
// board needs from odds data goes through resolveVegasLine()/
// resolveBookLines() above instead.
function populateBooks(){
  const sel=document.getElementById("bookSel");
  const cur=state.book;
  const opts=['<option value="consensus">Consensus (avg of books)</option>'];
  (state.booksSeen||[]).sort().forEach(b=>{ opts.push(`<option value="${esc(b)}">${esc(b)}</option>`); });
  sel.innerHTML=opts.join("");
  sel.value=cur;
}
// Tells other views the shared lines changed (Oct 28, 2026): Survivor prices
// its current pool week from them. notifyLinesRefreshed() lives in tabs.js,
// the one place outside the lazy Survivor files allowed to reach into it.
function rebuildSurvivorForLines(){
  if(typeof notifyLinesRefreshed==="function") notifyLinesRefreshed();
}
function refreshMeta(){
  const reqLeft=document.getElementById("reqLeft");
  if(reqLeft) reqLeft.textContent=state.reqLeft!=null?state.reqLeft:"—";
  const providerLastRefresh=document.getElementById("providerLastRefresh");
  const refreshTime=document.getElementById("refreshTime");
  // "Lines updated Sat 9:14 AM" -- the shared lines' last Odds API pull,
  // with the day when it wasn't today (lines only refresh on a click now).
  const label=linesUpdatedLabel(state.lastRefresh);
  if(refreshTime) refreshTime.textContent=label;
  if(providerLastRefresh) providerLastRefresh.textContent=state.lastRefresh?label:"Not refreshed yet";
}
