// --- Guest (logged-out) Snapshot preview -----------------------------------
// Lets a visitor who has never signed in see the real Snapshot tab --
// real live lines, real SP+-derived model numbers, real Cover % -- before
// ever hitting Clerk's sign-in wall. Drew's explicit call on the shape of
// this: Option 1 from the marketing conversation (a separate guest-only
// path, NOT a rework of bootstrap()'s real signed-in entry flow), fixed
// default composite is SP+ ONLY (not Sagarin+SP+ -- narrower than this
// app's own real new-account default on purpose, since it's a teaser, not
// the full product), and every "I want more" moment (another tab, a
// locked/capped row, a pick attempt, the Prediction Systems-adjacent
// controls) routes straight to Clerk sign-in rather than doing anything
// itself.
//
// HOW THIS STAYS SAFE TO BOLT ONTO A LIVE PRODUCTION AUTH FLOW: it never
// calls save() and never touches localStorage. It reuses the SAME global
// `state`/`games`/`predByKey`/`cfbdRatings` objects and the SAME
// renderSnapshot()/buildGames()/applyCfbdDerivedPredictions() functions
// the real signed-in app already uses (see app/js/board.js,
// app/js/cfbd-insights.js, app/js/model.js) -- deliberately NOT a
// duplicated parallel rendering path, so a guest sees the exact same
// board a signed-in user would, with the exact same real methodology.
// The one thing it mutates in memory is `state.enabledSystems`
// (temporarily forced to `["cfbdsp"]`), and guestTeardown() below
// restores whatever was there before the instant a REAL sign-in is
// detected, before init() (app/js/init.js) ever runs -- so a genuinely
// new account still gets this app's real new-account defaults (Sagarin +
// SP+, see CURRENT_STATE.md's "New-account default systems" entry)
// rather than silently inheriting the guest preview's narrower composite.
//
// Loaded as a plain <script src="/app/js/guest-snapshot.js"> tag, same as
// every other split file -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, so load order doesn't matter,
// same reasoning as every other split file's header comment):
//   - `state`, `games`, `predByKey`, `cfbdRatings`, `cfbdRatingsMeta` --
//     main inline script / app/js/main.js / app/js/cfbd-insights.js.
//   - `buildGames()`/`resolveBookLines()`/`migrateGameKeys()`/
//     `renderSnapshot()`/`sortGames()` -- app/js/board.js / app/js/odds.js.
//   - `applyCfbdDerivedPredictions()` -- app/js/cfbd-insights.js.
//   - `switchTab()` -- app/js/tabs.js.
//   - `seasonYear()` -- app/js/main.js.

let _guestActive = false;
let _guestOriginalEnabledSystems = null;

// Bare `fetch()`, not apiFetch() (app/js/api-client.js) -- apiFetch()
// always attaches a Clerk bearer token and treats a 401 as an auth
// failure, neither of which applies here: /api/public_snapshot takes no
// Authorization header at all and a real guest 429 isn't an auth problem.
async function _guestFetchJson(url){
  try{
    const res=await fetch(url,{method:"GET"});
    let body=null;
    try{ body=await res.json(); }catch(e){}
    return {ok:res.ok,status:res.status,body};
  }catch(e){
    return {ok:false,status:0,body:null};
  }
}

// Shows the classic pre-signup gate (#signInGate) and mounts Clerk's own
// sign-in UI -- the exact same markup/call bootstrap() (app/js/init.js)
// already uses for a first-time visitor, just triggered on demand instead
// of unconditionally at load. Every guest-mode interaction that implies
// "I want to do something real" funnels through this one function.
function guestRequireSignIn(){
  const gate=document.getElementById("signInGate"), root=document.getElementById("appRoot");
  if(root) root.style.display="none";
  if(gate) gate.style.display="block";
  if(window.Clerk && typeof window.Clerk.mountSignIn==="function"){
    window.Clerk.mountSignIn(document.getElementById("clerk-signin"));
  }
}

// Nav wiring for guest mode -- deliberately NOT the same binding init()
// (app/js/init.js) uses (`b.onclick=()=>switchTab(b.dataset.tab)` for
// every tab unconditionally). Only the Snapshot tab is real content while
// logged out; every other tab -- Edge board, My picks, Pools, Survivor,
// Results, Account, Settings -- has nothing to show a guest and instead
// opens sign-in. Re-run on every guestRenderSnapshot() pass for the same
// reason renderSnapshot() itself rebinds its own row buttons every
// render: elements this touches can be replaced by innerHTML writes
// elsewhere, and a stale closure over a detached button is a silent no-op
// bug, not a crash, so it's cheap insurance to just rebind every time.
function _guestWireNav(){
  document.querySelectorAll("nav.tabs button, .icon-nav-btn").forEach(b=>{
    b.onclick=()=>{
      if(b.dataset.tab==="snapshot"){ switchTab("snapshot"); return; }
      guestRequireSignIn();
    };
  });
  // Header chrome OUTSIDE nav.tabs/.icon-nav-btn that init() (app/js/init.js)
  // normally wires and guest mode was silently leaving dead -- clicking
  // either did nothing at all, which is what actually prompted this fix
  // (reported as the page "locking up": a big green "Refresh lines"
  // button and the "Overall board · Entry 1 · Week 0" row both sitting
  // there looking clickable with no handler bound).
  const ctxToggle=document.getElementById("contextBarToggle");
  if(ctxToggle) ctxToggle.onclick=()=>guestRequireSignIn(); // pool/entry/week switching is account-specific
  const refreshBtn=document.getElementById("refreshBtn");
  if(refreshBtn) refreshBtn.onclick=()=>_guestRefreshClick(refreshBtn);
  // Mobile hamburger open/close + the edge-fade scroll hint are pure UI
  // wiring with no account dependency -- safe to init here even though
  // the buttons inside route to sign-in anyway (see above), so mobile
  // visitors can actually open the tab menu in the first place.
  if(typeof initNavHamburger==="function") initNavHamburger();
  if(typeof initNavTabsScrollHint==="function") initNavTabsScrollHint();
}

// Guest-mode "Refresh lines" -- re-runs the same public-data load rather
// than routing to sign-in. Re-checking whether the public preview has
// fresher data yet is a harmless, accountless action (unlike the real
// refreshLines() in app/js/odds.js, this never spends any of Drew's paid
// Odds API quota -- it only re-reads api/public_snapshot.py's own
// read-only cache), so gating it behind sign-in like every other control
// would be an unnecessary dead end for someone who landed here while the
// shared cache genuinely was mid-warm-up.
async function _guestRefreshClick(btn){
  const orig=btn.textContent;
  btn.disabled=true; btn.textContent="↻ Loading…";
  try{
    await _guestLoadData();
  } finally {
    btn.disabled=false; btn.textContent=orig;
  }
}

// Every "I want more" control renderSnapshot() itself wires up for a real
// signed-in user -- adding a pick, shortlisting, exporting the graphic,
// jumping to the full Edge Board, seeing every row past the visible cap
// -- gets its onclick REPLACED (not removed; the button still looks and
// feels clickable, which is the point) with guestRequireSignIn() instead.
// Must run AFTER every renderSnapshot() call, since renderSnapshot()
// assigns its own onclick handlers fresh on every render (see that
// function's own tail in app/js/board.js) -- running this first would
// just get overwritten.
function _guestLockInteractions(){
  document.querySelectorAll(
    "[data-snap-pick],[data-snap-shortlist],[data-snap-jump],"+
    "#snapExportBtn,#snapFullBoardBtn,#snapSeeAllBtn,"+
    "#scoreToggle .toggle-btn,#snapFilterPills .pill-btn"
  ).forEach(el=>{ el.onclick=(e)=>{ if(e&&e.preventDefault) e.preventDefault(); guestRequireSignIn(); }; });
  // Expanding a row's detail (data-snap-expand) is deliberately LEFT
  // ALONE -- it's pure display (re-renders Snapshot with that row's
  // detail panel open), touches no account state, and costs nothing to
  // let a guest actually explore. Same reasoning as leaving the
  // logged-out Snapshot's real data itself fully browsable: the more of
  // the real product a guest can genuinely poke at before signing up, the
  // better the pitch.
}

// The setup checklist / pool-import CTA cards (app/js/board.js's
// renderSetupStatus()/renderPoolSetupCta()) are written for a signed-in
// account mid-setup ("import a pool", "load predictions") -- none of that
// is actionable for a guest, and showing it would just read as broken/
// confusing chrome around an otherwise-working preview.
function _guestHideAccountChrome(){
  const setup=document.getElementById("setupNotice"); if(setup) setup.style.display="none";
  const poolCta=document.getElementById("poolSetupCta"); if(poolCta) poolCta.style.display="none";
}

// Honest "not ready yet" state -- called when the shared caches
// /api/public_snapshot reads from haven't been populated by real
// signed-in usage recently enough (see api/public_snapshot.py's
// MAX_AGE_MINUTES). Deliberately does NOT fall back to buildGames()'s own
// demo-data path (an empty state.lastGames there seeds fake DEMO games)
// -- a logged-out visitor seeing fabricated numbers is exactly the wrong
// first impression for a tool whose whole pitch is real model-vs-market
// edges.
function _guestShowNotReady(){
  const tbody=document.getElementById("snapTableBody");
  if(tbody) tbody.innerHTML="";
  const empty=document.getElementById("snapEmpty");
  if(empty){
    empty.style.display="block";
    empty.innerHTML="Live data is warming up for the public preview — check back in a few minutes, or sign in for the full board.";
  }
  const oppGrid=document.getElementById("snapOppGrid");
  if(oppGrid) oppGrid.innerHTML=`<p class="note">Live data is warming up for the public preview — check back shortly.</p>`;
  const statsList=document.getElementById("snapStatsList");
  if(statsList) statsList.innerHTML="";
  _guestHideAccountChrome();
}

function _guestRenderSnapshot(){
  renderSnapshot();
  _guestLockInteractions();
  _guestHideAccountChrome();
}

async function _guestLoadData(){
  const year=(typeof seasonYear==="function")?seasonYear():new Date().getFullYear();
  const [oddsRes,ratingsRes]=await Promise.all([
    _guestFetchJson("/api/public_snapshot?view=odds"),
    _guestFetchJson(`/api/public_snapshot?view=ratings&year=${encodeURIComponent(year)}`),
  ]);
  const oddsReady=oddsRes.ok&&oddsRes.body&&oddsRes.body.ready===true&&Array.isArray(oddsRes.body.games)&&oddsRes.body.games.length;
  const ratingsReady=ratingsRes.ok&&ratingsRes.body&&ratingsRes.body.ready===true&&Array.isArray(ratingsRes.body.ratings)&&ratingsRes.body.ratings.length;
  if(!oddsReady||!ratingsReady){
    _guestShowNotReady();
    return;
  }
  // In-memory only, exactly like the real refreshLines()/fetchCfbdRatings()
  // paths this mirrors -- the difference is those also persist to
  // localStorage/the account's shared/private tiers; this deliberately
  // never does, since there is no account yet.
  state.lastGames=oddsRes.body.games;
  state.lastRefresh=oddsRes.body.lastRefresh||new Date().toISOString();
  cfbdRatings=ratingsRes.body.ratings;
  cfbdRatingsMeta={year,fetchedAt:null,source:"public"};
  buildGames();
  resolveBookLines(games);
  if(typeof migrateGameKeys==="function") migrateGameKeys();
  applyCfbdDerivedPredictions();
  if(typeof sortGames==="function") sortGames();
  if(typeof refreshMeta==="function") refreshMeta(); // updates the header's "updated H:MM" / calls-left text -- was previously left stuck on "not refreshed yet" forever, even after a real successful load
  _guestRenderSnapshot();
}

// Entry point -- called from bootstrap() (app/js/init.js) whenever Clerk
// reports no signed-in user, instead of immediately showing the classic
// blocking gate.
async function initGuestSnapshot(){
  _guestActive=true;
  document.body.classList.add("guest-mode");
  // Fixed default composite for the logged-out preview: SP+ ONLY (Drew's
  // explicit call -- narrower than the real new-account default on
  // purpose). Snapshotted here so guestTeardown() can put back whatever
  // was really there (a genuinely fresh browser's own new-account
  // default, OR a returning-but-currently-signed-out user's real saved
  // selection) the instant a real sign-in happens.
  _guestOriginalEnabledSystems=Array.isArray(state.enabledSystems)?state.enabledSystems.slice():[];
  state.enabledSystems=["cfbdsp"];
  state.snapRankByCover=true; // Cover % is the more intuitive "who does the model like" framing for a first-time, no-context visitor
  _guestWireNav();
  if(typeof switchTab==="function") switchTab("snapshot");
  await _guestLoadData();
}

// Called from bootstrap()'s Clerk listener the instant a REAL sign-in is
// detected while guest mode was active, BEFORE init() runs. Undoes every
// in-memory-only tweak initGuestSnapshot() made above. Nothing here
// touches localStorage, because nothing in initGuestSnapshot() ever wrote
// to it either -- this is purely putting the shared `state` object back
// the way a real signed-in boot expects to find it.
function guestTeardown(){
  if(!_guestActive) return;
  _guestActive=false;
  document.body.classList.remove("guest-mode");
  if(_guestOriginalEnabledSystems!=null) state.enabledSystems=_guestOriginalEnabledSystems;
  _guestOriginalEnabledSystems=null;
}
