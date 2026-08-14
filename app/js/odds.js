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
//   - `pullTier()`/`authHeaders()` -- cross-device shared-tier sync (main
//     inline script).
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
async function refreshLines(){
  const btn=document.getElementById("refreshBtn");
  btn.disabled=true; btn.textContent="↻ Loading…";
  // Freshness guard: pull whatever the shared tier currently has BEFORE
  // spending a real Odds API call -- someone else may have refreshed within
  // the freshness window already (see SHARED_FRESH_MINUTES, still in
  // app/index.html's main inline script).
  await pullTier("shared",true);
  const freshAge=minsAgo(state.lastRefresh);
  if(freshAge!=null&&freshAge<SHARED_FRESH_MINUTES&&(state.lastGames||[]).length){
    resolveBookLines(state.lastGames);
    buildGames(); migrateGameKeys(); applyPdfData(); applyPredictions(); save(); sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
    populateBooks();
    refreshMeta();
    document.getElementById("refreshTime").textContent=`Using recent data from ${freshAge}m ago`;
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
    const res=await fetch('/api/fetch_odds',{
      headers:await authHeaders(state.apiKey?{'X-Odds-Api-Key':state.apiKey}:{}),
    });
    const left=res.headers.get("x-requests-remaining");
    if(res.status===401){ throw new Error("No odds key available (401). Add a personal key in Settings, or ask the admin to set ODDS_API_KEY."); }
    if(res.status===429){ throw new Error("Out of free calls for now (429)."); }
    if(!res.ok){ throw new Error("Couldn't reach the odds service ("+res.status+")."); }
    const data=await res.json();
    if(left!=null){ state.reqLeft=left; save(); }
    if(!(data.games||[]).length){
      refreshMeta();
      document.getElementById("refreshTime").textContent="no NCAAF spreads posted yet — use ⬇ Load model predictions";
      return;
    }
    await pullTier("shared",true); // adopt the server's own persisted copy
    resolveBookLines(state.lastGames);
    state.weekAnchor=null; // land on the earliest posted week after a fresh pull
    save();
    buildGames(); migrateGameKeys(); applyPdfData(); applyPredictions(); save(); sortGames(); renderBoard(); renderEntries(); renderPicksDetail();
    refreshMeta();
    populateBooks();
  }catch(err){
    document.getElementById("refreshTime").textContent="refresh failed";
    goSettings(err.message);
  }finally{
    refreshMeta(); // keep calls-left honest even when the try block bailed early
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
function refreshMeta(){
  document.getElementById("reqLeft").textContent=state.reqLeft!=null?state.reqLeft:"—";
  if(state.lastRefresh){
    const d=new Date(state.lastRefresh);
    document.getElementById("refreshTime").textContent="updated "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"});
  }
}
