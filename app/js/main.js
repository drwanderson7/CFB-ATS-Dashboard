// app/js/main.js — the last remaining top-level app logic that used to
// live as an inline <script> block at the bottom of app/index.html.
// Externalized so CSP's script-src can drop 'unsafe-inline' entirely
// (see vercel.json's Content-Security-Policy header) — an inline
// <script> block with real page content can only be allowed under CSP
// via 'unsafe-inline' (defeats the point) or a per-response nonce/hash
// (extra moving parts for a static file with no server-side templating).
// A plain external file needs neither.
//
// Loaded via <script src="/app/js/main.js"></script> at the exact same
// position in app/index.html this content used to occupy inline — after
// every other app/js/*.js file and right before </body>, so load order
// and global-scope wiring are unchanged. Same reasoning as every other
// file in this directory: no bundler, no modules, plain global-scope
// script relying on document order (see app/index.html's own comment
// block above the <script src> list for the full file-order rationale).
//
// initErrorBoundary() and bootstrap() are invoked at the very start and
// very end of this file respectively — see app/js/init.js's header for
// why those two invocations deliberately live here instead of in
// init.js itself alongside their definitions.

// Registered first, before anything else in this script runs, so it can
// catch a genuine error anywhere below it -- including one during this
// file's own early setup, not just once the app is fully booted.
initErrorBoundary();

const SPORT="americanfootball_ncaaf";
const KEY="cfb_edge_state_v1";

// Prediction Tracker systems (thepredictiontracker.com CSV). Key = the CSV
// column name with "line" stripped; value = display name. Toggling any of these
// on in the Prediction Systems panel (Edge Board tab) folds that system's number into Model # for every game it covers.
// Codes not listed here still work if the CSV has them -- they just show by
// their raw code until named. Market lines and site aggregates are intentionally
// excluded server-side (see api/fetch_predictions.py META_COLUMNS).
// PRED_SYSTEMS now lives in app/data/pred-systems.js (loaded via <script> above) -- see that file for the full list and why it was split out.
const PRED_NAME=Object.fromEntries(PRED_SYSTEMS.map(s=>[s.code,s.name]));
function predName(code){ return PRED_NAME[code]||code; }
// Top-7 ATS performers, per Drew's explicit Sept 2, 2026 list (replacing
// the earlier "Top 10" version below). Keyed by this app's PRED_SYSTEMS
// code. Composite scores below are read directly from Drew's own 2-year
// backtest table (40% ATS% / 30% MAE / 30% |Bias|, rank-weighted average,
// lower composite = better), re-ranked to skip thepredictiontracker.com's
// own non-togglable aggregate/market rows ("System Median", "System
// Average", "Line (opening)", "Line (updated)", "Computer Adjusted Line")
// since none of those map to a real checklist system here.
// Sagarin mapping resolved Aug 25 and reconfirmed here: Sagarin's own
// documentation says PREDICTOR is also known as PURE_POINTS, so the
// backtest's "Sagarin Points" row maps to `sagpred`; the backtest's
// separately-listed "Sagarin Ratings" row maps to `sag` (overall Rating).
// `cfbdsp` (SP+) is the one deliberate exception: it was never actually a
// row in this backtest (it's CFBD-derived, not a thepredictiontracker.com
// column -- see the Sept 2 note beside its PRED_SYSTEMS entry in
// app/data/pred-systems.js), so it carries composite:null rather than a
// backtest-sourced number. Drew explicitly asked for it to carry the
// badge anyway.
const TOP_SYSTEM_RANKS={
  sagpred:  {rank:1, composite:8.82},
  sag:      {rank:2, composite:11.62},
  wayward:  {rank:3, composite:12.30},
  teamrank: {rank:4, composite:12.50},
  fpi:      {rank:5, composite:13.05},
  dokter:   {rank:6, composite:15.55},
  cfbdsp:   {rank:7, composite:null},
};
// Short uppercase tag for a system's board column header (full name on hover).
const PRED_SHORT={sag:"SAG",sagpred:"SAGP",saggm:"SAGM",sagr:"SAGR",fpi:"FPI",
  cfbdsp:"SP+",cfbdcore:"CORE",
  donchess:"DON",dokter:"DOKT",big200:"BIG2",massey:"MAS",cons:"MASC",fei:"FEI",
  teamrank:"TRNK",piratings:"PI",pimean:"PIM",pibias:"PIB",talis:"TAL",moore:"MOOR",
  dunk:"DUNK",laz:"LAZ",rwp:"RWP",elo:"ELO",kam:"KAM"};
function predShort(code){ return PRED_SHORT[code]||code.toUpperCase().slice(0,4); }
const PRED_ORDER=PRED_SYSTEMS.map(s=>s.code);
// Enabled systems in a stable column order.
function enabledSystemsOrdered(){
  // "bp"/"comp"/"vegas" live in the same state.enabledSystems array (so
  // they can share the Prediction Systems checklist UI) but are NOT
  // predictiontracker system codes -- bp/comp are handled by their own
  // dedicated bpTh/compTh header cells and their own line in
  // weightedModel(); vegas (checkbox added Sept 2, 2026, Drew's explicit
  // request) is handled by its own dedicated line in weightedModel() and
  // myBlendNumber(), reading the live market line rather than
  // predsFor()'s system-code map (predsFor() has no "vegas" entry --
  // there's no such column in the prediction-tracker CSV). Without this
  // filter all three would also get treated as generic external systems
  // here, which fed both a real duplicate "Comp" column (confirmed via
  // direct DOM inspection, not just eyeballing a screenshot) and a live
  // double-count risk in the composite average, since this same function
  // backs both.
  return state.enabledSystems.filter(c=>c!=="bp"&&c!=="comp"&&c!=="vegas").slice().sort((a,b)=>{
    const ia=PRED_ORDER.indexOf(a), ib=PRED_ORDER.indexOf(b);
    return (ia<0?999:ia)-(ib<0?999:ib);
  });
}

const DEMO=[
  {away:"Houston",home:"Arizona State",commence:null,vegas:-7.0,inputs:[-7,-10.6]},
  {away:"SMU",home:"Wake Forest",commence:null,vegas:3.0,inputs:[6,6.9]},
  {away:"Baylor",home:"Cincinnati",commence:null,vegas:-4.5,inputs:[-3,-1.5]},
  {away:"Bowling Green",home:"Kent State",commence:null,vegas:7.0,inputs:[10,10.6]},
  {away:"Minnesota",home:"Iowa",commence:null,vegas:-8.5,inputs:[-7,-10.6]},
  {away:"Wisconsin",home:"Oregon",commence:null,vegas:-33.5,inputs:[-34,-30.7]}
];

let state=load();
let games=[];       // runtime board: {key,away,home,commence,vegas,book}
// Demo numbers live here, NOT in state.inputs. The demo rows are real Week 9
// matchups, so persisting their placeholder numbers meant key-migration could
// later carry fake values onto the real board. Kept in memory only.
let demoInputs={};
let isDemo=true;
// Whether the signed-in account is an admin (gates pool-template publishing on
// the Pools tab -- see api/state.py's is_admin()). Deliberately kept OUT of
// `state`, same reasoning as apiKey/teamLogos below: this is a server-
// computed ACCOUNT attribute (from PICKGAUGE_ADMIN_UIDS), not user data --
// it must never be exported in a backup, restored from one, or pushed back
// to the server as if the client could set it. Set from the "isAdmin"
// field on every private-state pull (pullTier("private"), app/js/sync.js);
// defaults to false (fail toward "not admin," same safe default the
// backend itself uses) until that first pull actually confirms otherwise --
// so a not-yet-synced page load never shows the button to someone who
// isn't actually an admin.
let isAdminUser=false;

// CFBD canonical identity reference data (via api/fetch_teams.py). Kept OUT
// of `state` because it is shared reference data, not private user data. The
// team directory drives logos + canonical team IDs; the season schedule gives
// every matched game its stable CFBD game ID, team IDs, week and conferences.
// Provider IDs remain separate (providerGameId = The Odds API; cfbdGameId =
// CollegeFootballData) so IDs from different namespaces can never be confused.
const LOGO_KEY="cfb_edge_logos_v1"; // legacy key retained for one-way cache migration
const CFBD_IDENTITY_KEY="pickgauge_cfbd_identity_v3";
let teamLogos=[];   // richer rows: [{id,school,alternateNames,conference,logo,...}]
let cfbdGames=[];   // [{id,season,week,startDate,homeId,awayId,...}]
let logosMeta=null; // {fetchedAt,count,gameCount,season,source}
function loadLogosLocal(){
  try{
    const raw=localStorage.getItem(CFBD_IDENTITY_KEY)||localStorage.getItem(LOGO_KEY);
    if(!raw) return;
    const parsed=JSON.parse(raw);
    teamLogos=Array.isArray(parsed.teams)?parsed.teams:[];
    cfbdGames=Array.isArray(parsed.games)?parsed.games:[];
    logosMeta=parsed.meta||null;
  }catch(e){ /* corrupt/old cache -- just refetch */ }
}
function saveLogosLocal(){
  try{
    localStorage.setItem(CFBD_IDENTITY_KEY,JSON.stringify({teams:teamLogos,games:cfbdGames,meta:logosMeta}));
    localStorage.removeItem(LOGO_KEY);
  }catch(e){}
}

function normalizeState(s){
  s=s||{};
  // Captured BEFORE any migration below can set a flag (_bpCompMigrated,
  // _pickGaugeStandaloneMigrated) that would otherwise make every account
  // -- brand new or genuinely pre-existing -- look identical by the time
  // the BP/Comp migration below needs to tell them apart. Deliberately
  // generous (checks several independent signals, any one is enough):
  // a real account accumulates SOME trace of use long before it would
  // ever hit this function with none of these set.
  const _hadPriorState=!!(s._bpCompMigrated || s._pickGaugeStandaloneMigrated
    || (Array.isArray(s.enabledSystems)&&s.enabledSystems.length)
    || (s.weights&&typeof s.weights==="object"&&Object.keys(s.weights).length)
    || (Array.isArray(s.pools)&&s.pools.length)
    || (Array.isArray(s.lastGames)&&s.lastGames.length)
    || (Array.isArray(s.pdfGames)&&s.pdfGames.length)
    || (s.inputs&&typeof s.inputs==="object"&&Object.keys(s.inputs).length));
  s.apiKey=s.apiKey||"";
  // appKey/userId are deprecated leftovers from the pre-account passphrase+
  // handle system -- kept only so old localStorage from before the Clerk
  // migration doesn't error out on load. Nothing reads or writes them
  // anymore; identity now comes from the verified Clerk session.
  s.appKey=s.appKey||"";
  s.userId=s.userId||"";
  s.book=s.book||"consensus";
  s.goodThresh=(s.goodThresh!=null)?s.goodThresh:1.5;
  s.strongThresh=(s.strongThresh!=null)?s.strongThresh:3;
  s.inputs=s.inputs||{};          // key -> [bp, comp]  (#4 slot retired)
  // Prediction Tracker: raw CSV rows (matched to the board at render time, like
  // pdfGames), the set of toggled-on system codes, and fetch metadata. enabled
  // systems + predictions both ride the normal sync payload.
  s.predictions=s.predictions||null;     // [{home,road,systems:{code:val}}]
  s.enabledSystems=Array.isArray(s.enabledSystems)?s.enabledSystems:[];
  s.weights=(s.weights&&typeof s.weights==="object")?s.weights:{}; // custom Model # input key -> weight
  // PickGauge Model # is now a standalone model mode, independent from the
  // user's individually enabled comparison/custom systems. Migrate the short-
  // lived Aug 25 preset representation (where its five ingredients were
  // written directly into enabledSystems + exact weights) into the standalone
  // boolean once, then remove those auto-enabled ingredient columns.
  if(!s._pickGaugeStandaloneMigrated){
    const p=(typeof PICKGAUGE_MODEL_PRESET!=="undefined")?PICKGAUGE_MODEL_PRESET:null;
    if(p){
      const actual=s.enabledSystems.filter(c=>c!=="bp"&&c!=="comp");
      const expected=new Set(p.systems);
      const sameSystems=!s.enabledSystems.includes("bp")&&!s.enabledSystems.includes("comp")
        && actual.length===expected.size && actual.every(c=>expected.has(c));
      const sameWeights=Object.entries(p.weights).every(([k,w])=>Number(s.weights[k])===Number(w));
      if(sameSystems&&sameWeights){
        s.pickGaugeModelEnabled=true;
        s.enabledSystems=s.enabledSystems.filter(c=>!expected.has(c));
        Object.keys(p.weights).forEach(k=>delete s.weights[k]);
      }
    }
    s._pickGaugeStandaloneMigrated=true;
  }
  s.pickGaugeModelEnabled=!!s.pickGaugeModelEnabled;
  // BP/Comp used to always count toward My# unconditionally -- now they're
  // toggleable in the Prediction Systems checklist like everything else.
  // Auto-add them once so nobody's already-saved My# numbers silently shift
  // the moment this update ships; a real preference change from here is a
  // deliberate uncheck, not a surprise.
  //
  // BUT that "auto-add once" logic originally fired for ANY account
  // missing _bpCompMigrated -- which includes a genuinely brand-new
  // signup just as much as a real pre-existing account, since neither
  // has the flag set yet. Confirmed against a real account (Aug 26,
  // screenshot): a fresh user was landing with BP + Comp pre-checked,
  // which was never the intent -- there was nothing prior to preserve
  // for them. _hadPriorState (computed above, before any of this
  // function's own migrations could set a flag that would mask the
  // account's real age) distinguishes the two: only a genuine pre-
  // existing account gets BP/Comp auto-added now. A brand-new account
  // gets Drew's explicit Aug 26 call instead -- Sagarin (Rating) + SP+
  // on by default, not BP (needs a personal newsletter subscription and
  // per-user PDF upload a new signup won't have yet) or Comp (no
  // empirical backtested track record in this project's own ranking
  // work) or nothing at all (confusing first-run board with zero Model #
  // inputs and no clear next step).
  if(!s._bpCompMigrated){
    if(_hadPriorState){
      if(!s.enabledSystems.includes("bp")) s.enabledSystems.push("bp");
      if(!s.enabledSystems.includes("comp")) s.enabledSystems.push("comp");
    }else{
      if(!s.enabledSystems.includes("sag")) s.enabledSystems.push("sag");
      if(!s.enabledSystems.includes("cfbdsp")) s.enabledSystems.push("cfbdsp");
    }
    s._bpCompMigrated=true;
  }
  // Vegas used to always structurally contribute to a custom Model #
  // whenever its own weight was raised above 0 -- there was no checkbox,
  // just a permanently-visible weight box (see model.js's weightOf()) --
  // so a pre-existing account could genuinely have Vegas already counting
  // toward their number today. Sept 2, 2026 (Drew's explicit request):
  // Vegas became a real checkbox in the systems grid, gated the same way
  // BP/Comp/every comparison system already is. Same one-time-migration
  // shape as the BP/Comp block above, and for the same reason -- auto-add
  // "vegas" to enabledSystems ONLY for a genuinely pre-existing account
  // that had already set a real nonzero Vegas weight, so their Model #
  // doesn't silently change (weight now ignored because the new checkbox
  // is unchecked) the moment this ships. A brand-new account -- or a
  // pre-existing one that simply never touched the old Vegas weight box
  // (so it was still sitting at its old default of 0, contributing
  // nothing) -- gets the new checkbox unchecked by default, exactly
  // matching what "0 weight" already meant for them.
  if(!s._vegasCheckboxMigrated){
    if(_hadPriorState && Number(s.weights.vegas)>0 && !s.enabledSystems.includes("vegas")){
      s.enabledSystems.push("vegas");
    }
    s._vegasCheckboxMigrated=true;
  }
  s.boardFilter=(s.boardFilter==="aligned")?"aligned":"all"; // "all" or "aligned" (⚡ CLV+My# filter, pool-only)
  s.boardShortlistOnly=!!s.boardShortlistOnly; // ⚑ Shortlist-only filter, independent of boardFilter, works in any context
  s.snapRankByCover=!!s.snapRankByCover; // Cover % ranking toggle on the Snapshot tab (off = Raw Edge, the default)
  const SNAP_FILTERS=["all","strong","dog","key","mine","shortlist"];
  s.snapFilter=SNAP_FILTERS.includes(s.snapFilter)?s.snapFilter:"all";
  s.predMeta=s.predMeta||null;           // {fetchedAt, count}
  // weekAnchor is a week index (number), "ALL", or null(auto). Coerce any legacy
  // ISO-string value from an older build back to auto.
  if(typeof s.weekAnchor==="string" && s.weekAnchor!=="ALL") s.weekAnchor=null;
  else s.weekAnchor=(s.weekAnchor===undefined?null:s.weekAnchor);
  s.entries=s.entries||[{id:uid(),name:"Entry 1",picks:{}}];
  // Survivor pool/entry/pick data is private account state by omission from SHARED_FIELDS.
  s.survivor=(s.survivor&&typeof s.survivor==="object"&&!Array.isArray(s.survivor))?s.survivor:{};
  // Shortlist -- game keys flagged for a closer look before committing a
  // pick, a third state alongside plain ignore/pick. Overall's list lives
  // here; each pool gets its own below (pool keys aren't the same
  // namespace as Overall's).
  s.shortlist=Array.isArray(s.shortlist)?s.shortlist:[];
  // My Numbers: private, season/week-scoped personal projected spreads.
  // Stored separately from Model # inputs so a personal line never silently
  // changes PickGauge Model # or the customizable model blend.
  s.myNumbers=(s.myNumbers&&typeof s.myNumbers==="object"&&!Array.isArray(s.myNumbers))?s.myNumbers:{};
  // Pools: each imported pool sheet is its own context (own slate, pick limit,
  // entries, locked lines). "overall" = the normal Edge Board.
  s.pools=Array.isArray(s.pools)?s.pools:[];
  // Ids of published-template pools this account explicitly deleted rather
  // than archived -- deleting a normal manually-created pool is final, but
  // deleting a pool that originated from a shared template is different:
  // without tracking that decision, mergeSharedPoolsIntoLocal() (below)
  // would see the id missing from s.pools on the very next sync and
  // silently re-add it, since its own guard only checks "does this id
  // already exist locally," not "did this account already decline it
  // once." Private per-account state (not in SHARED_FIELDS, so it syncs
  // like s.pools/s.entries do -- the same decision follows the account
  // across devices, not just this one browser).
  s.declinedSharedPools=Array.isArray(s.declinedSharedPools)?s.declinedSharedPools:[];
  // Pools that any signed-in user can see and pick within, for testing --
  // structure only (games, locked lines, name, pick limit). Never entries or
  // picks; those get created fresh per-person the first time they touch a
  // shared pool locally, so nobody's picks are visible to anyone else.
  s.sharedPools=Array.isArray(s.sharedPools)?s.sharedPools:[];
  // Pools are persistent contests (one per real-world pool you're in), not a
  // new object per week -- a re-import swaps in the new week's slate on the
  // SAME pool. Backfill fields for pools saved by the earlier one-object-per-
  // week model so old data doesn't break: history (archived weeks, mirrors
  // state.history) and weekLabel (display label for the currently-loaded week).
  s.pools.forEach(p=>{
    p.history=Array.isArray(p.history)?p.history:[];
    if(p.weekLabel===undefined) p.weekLabel=null;
    p.shortlist=Array.isArray(p.shortlist)?p.shortlist:[];
  });
  s.activeContext=s.activeContext||"overall";
  s.activeEntryId=s.activeEntryId||s.entries[0].id;
  s.lastGames=s.lastGames||null;  // cached fetched games
  // Server-maintained last pre-kick lines, keyed by Odds API event id. Kept
  // separately from lastGames because an event may disappear from /odds soon
  // after kickoff while its closing snapshot still needs to survive until the
  // user archives the week.
  s.preKickLines=(s.preKickLines&&typeof s.preKickLines==="object")?s.preKickLines:{};
  s.lastRefresh=s.lastRefresh||null;
  s.reqLeft=s.reqLeft||null;
  s.booksSeen=s.booksSeen||[];
  s.pdfGames=s.pdfGames||null;
  s.history=s.history||[];        // archived weeks: [{id,label,closedAt,entries:[{entryId,name,picks:[...]}]}]
  // Model-performance history is a private, compact weekly slate snapshot.
  // Unlike Results pick history, this tracks hypothetical ATS decisions for
  // the visible prediction systems across EVERY market game captured before
  // kickoff, so model records are not selection-biased by which games the
  // person happened to pick. Each game freezes the market line and model
  // projections that existed at the snapshot; api/grade_picks.py later fills
  // systemResults from canonical CFBD finals. Kept private by omission from
  // SHARED_FIELDS so one account cannot mutate another account's history.
  s.modelPerformanceHistory=Array.isArray(s.modelPerformanceHistory)?s.modelPerformanceHistory:[];
  // Two independent clocks: shared-tier data (odds/predictions) and
  // private-tier data (everything else) sync on their own schedules against
  // their own Redis keys, so each needs its own "is the remote copy newer"
  // timestamp rather than one shared updatedAt for the whole blob.
  s.sharedUpdatedAt=s.sharedUpdatedAt||null;
  s.privateUpdatedAt=s.privateUpdatedAt||s.updatedAt||null; // migrate legacy single-timestamp saves
  s.updatedAt=undefined; // retired -- use the two above
  // Column sort: which header is active and which direction. Persists like
  // everything else in state, so it syncs across devices.
  s.sortKey=s.sortKey||"edge";
  s.sortDir=s.sortDir||"desc";
  return s;
}
// --- Shared vs private sync tiers -----------------------------------------
// SHARED_FIELDS: same data for everyone -- the Vegas odds pull and
// predictiontracker.com rows, plus their fetch metadata. Nobody manually
// edits these; they're raw external data, expensive/quota-limited to fetch,
// so 20 people reading one cached copy instead of each hitting the upstream
// APIs directly is the whole point of this tier.
//
// Everything else in state is PRIVATE by omission: picks, entries, pools,
// PDF-derived BP/Comp inputs, enabled systems, weights, thresholds, sort
// preference. PDF-derived inputs in particular MUST stay private, not
// shared -- redistributing one person's paid Powers newsletter numbers to
// everyone else would be the licensing problem already flagged in project
// notes, not just a data-modeling choice.
//
// sharedUpdatedAt (added here, v18) is bookkeeping for the tier itself --
// without it in this list, a PRIVATE-tier pull's `{...remote,...sharedNow}`
// rebuild (see pullTier() in app/js/sync.js) would silently drop it, since
// neither the private remote payload nor sharedNow would carry it. Not the
// cause of the sharedUpdatedAt bug fixed in api/state.py (that bug meant
// the server never sent a real value at all), but leaving it out of this
// list would have undermined the fix on the very next private sync after
// a shared one -- found and closed in the same pass.
const SHARED_FIELDS=["lastGames","lastRefresh","reqLeft","booksSeen","preKickLines","predictions","predMeta","sharedPools","sharedUpdatedAt"];
function pickFields(obj,fields){ const out={}; fields.forEach(f=>{ if(obj[f]!==undefined) out[f]=obj[f]; }); return out; }

// --- Shared-tier freshness guard -------------------------------------------
// Up to ~20 people may use this "at various times" (not concurrently), so the
// real risk isn't a write collision (last-write-wins on re-fetched external
// data is harmless) -- it's wasted Odds API / prediction-fetch quota from
// people independently re-pulling data that's still fresh. Before either
// refreshLines() or fetchPredictions() spends a real fetch, they pull the
// current shared tier first and skip the fetch if it's within this window.
// No cron needed (Vercel Hobby only allows once-daily cron anyway, which
// would make lines stale for a whole day -- worse than this).
const SHARED_FRESH_MINUTES=30;
function minsAgo(iso){
  if(!iso) return null;
  const ms=Date.now()-new Date(iso).getTime();
  return ms<0?0:Math.floor(ms/60000);
}

// Earlier builds wrote the demo placeholders straight into saved state. Strip
// them out once, but only where the stored values still exactly match the
// seed (i.e. untouched) and no real board data exists yet.
function purgeSeededDemoInputs(s){
  if(s.lastGames&&s.lastGames.length) return;
  if(s.pdfGames&&s.pdfGames.length) return;
  DEMO.forEach(d=>{
    const k=norm(d.away)+"@"+norm(d.home);
    const cur=s.inputs&&s.inputs[k];
    if(Array.isArray(cur)&&cur.length===d.inputs.length
       &&cur.every((v,i)=>v===d.inputs[i])) delete s.inputs[k];
  });
}
function load(){
  let s=null;
  try{ s=JSON.parse(localStorage.getItem(KEY)); }catch(e){}
  s=normalizeState(s); purgeSeededDemoInputs(s); return s;
}
// save() = a real user-driven PRIVATE change (picks, entries, pools, inputs,
// weights, thresholds, sort, etc.): bump the private clock and push it up.
function save(){ state.privateUpdatedAt=new Date().toISOString(); localStorage.setItem(KEY,JSON.stringify(state)); scheduleSync("private"); }
// saveShared() removed: shared-tier writes are server-owned now (see
// api/state.py's docstring). fetch_odds.py / fetch_predictions.py write
// their own slice of the shared bucket directly; the one remaining
// client-initiated shared write (publish_pool) goes through its own
// narrow, ownership-checked endpoint and re-pulls the shared tier itself
// afterward rather than calling a local save-and-push helper. (A second
// one, clear_predictions, existed briefly and was removed -- it let any
// signed-in user wipe shared predictions for everyone; "clear
// predictions" is local-only now.)
// saveLocal() = housekeeping (normalising, key migration, seeding demo data).
// Deliberately does NOT touch updatedAt or schedule a push -- otherwise merely
// OPENING the app would stamp this device as "newest" and overwrite newer data
// another device had already synced.
function saveLocal(){ localStorage.setItem(KEY,JSON.stringify(state)); }
function uid(){ return Math.random().toString(36).slice(2,9); }
// Entry names and week labels come from the in-app dialog layer; team names come from a PDF
// parse. All of it lands in innerHTML, so a stray quote or angle bracket would
// otherwise break the markup.
function updateAccountDisplay(){
  const el=document.getElementById("accountEmail");
  if(!el) return;
  const user=window.Clerk&&window.Clerk.user;
  el.textContent=user?(user.primaryEmailAddress?user.primaryEmailAddress.emailAddress:user.id):"—";
}
// Sent with every API call. Async now -- Clerk's session token is short-lived
// and auto-refreshed, so it has to be fetched fresh each call rather than
// cached like the old static passphrase was. window.Clerk.session is null
// until Clerk finishes loading and the person is signed in; every caller
// already awaits this, and the API will just 401 if it comes back empty
// (e.g. session expired mid-use), which the existing error handling on each
// call site already surfaces normally.
async function authHeaders(extra, forceFresh){
  const h=Object.assign({},extra||{});
  // Clerk session JWTs are intentionally short-lived (~60s). Most calls can
  // use Clerk's normal token cache; apiFetch() passes forceFresh=true exactly
  // once after a real auth-shaped 401 so a stale cached token can heal without
  // making the person manually sign out/in. Clerk documents skipCache for
  // this exact force-refresh case.
  const session=window.Clerk&&window.Clerk.session;
  const token=session?await session.getToken(forceFresh?{skipCache:true}:undefined):null;
  if(token) h['Authorization']='Bearer '+token;
  return h;
}
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function norm(s){ return (s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function mkey(away,home){ return norm(away)+"@"+norm(home); }
function fmt(n){ if(n==null||isNaN(n)) return "—"; const r=Math.round(n*10)/10; return (r>0?"+":"")+r.toFixed(1); }
function round1(n){ return Math.round(n*10)/10; }

function seasonYear(){ return +SEASON_WEEK1_TUESDAY.slice(0,4); }
// ---- pool contexts -------------------------------------------------------
// A "context" is either the Overall board ("overall") or one imported pool.
// These accessors let the entry/pick/cap code stay the same while pointing at
// whichever context is active.
function currentPool(){
  return (state.activeContext&&state.activeContext!=="overall")
    ? (state.pools||[]).find(p=>p.id===state.activeContext)||null : null;
}
function activeEntries(){ const p=currentPool(); return p?p.entries:state.entries; }
function pickLimit(){ const p=currentPool(); return p?(p.pickLimit||7):7; }
// Shortlist -- a THIRD state alongside Ignore/Pick, for games worth
// investigating before committing one of your limited picks to them.
// Scoped per-context the same way entries/picks already are (a pool's game
// keys come from its own imported sheet, not the Odds API, so Overall and
// a pool never share keys) -- lazily initialized so older saved state
// without this field doesn't need a migration step.
function currentShortlist(){
  const p=currentPool();
  if(p){ if(!p.shortlist) p.shortlist=[]; return p.shortlist; }
  if(!state.shortlist) state.shortlist=[];
  return state.shortlist;
}
function isShortlisted(key){ return currentShortlist().includes(key); }
function toggleShortlist(key){
  const sl=currentShortlist();
  const idx=sl.indexOf(key);
  if(idx>=0) sl.splice(idx,1); else sl.push(key);
  save(); renderBoard(); // renderBoard() already cascades into renderSnapshot() at its own end
}
function ctxActiveEntryId(){ const p=currentPool(); return p?p.activeEntryId:state.activeEntryId; }
function setCtxActiveEntryId(id){ const p=currentPool(); if(p) p.activeEntryId=id; else state.activeEntryId=id; }
function activeEntry(){ const es=activeEntries(); return es.find(e=>e.id===ctxActiveEntryId())||es[0]; }
function activeHistory(){ const p=currentPool(); return p?p.history:state.history; }

// Splash sometimes truncates a name ("Eastern Michig…"). Match those by prefix.
function stripEllipsis(s){ return String(s||"").replace(/[…\u2026.]+$/,"").trim(); }
// A plain prefix check (below) handles most truncations fine -- but it can't
// bridge cases where the SAME team is truncated on one side and spelled via
// a totally different root word on the other (e.g. Splash's "Louisiana-Mon…"
// vs the board's own "UL Monroe" -- neither literally prefixes the other).
// resolveTrunc tries to resolve a truncated fragment through TEAM_ALIAS the
// same way teamMatch does for full names, but tolerating the fragment being
// CUT SHORT of a real alias key/value. Reuses the same SIGNIFICANT_TOKENS
// safety check teamMatch relies on elsewhere -- required, not optional: an
// earlier version of this without that check let "Mississippi St…" (a
// truncated Mississippi State) wrongly resolve to Ole Miss, since "mississippi"
// alone happens to already be an alias key for a DIFFERENT team. Confirmed via
// collision-testing against the real CFBD roster before shipping. Only ever
// called from teamMatchTrunc (Splash import matching) -- never touches
// teamMatch itself, so board-building/predictions/grading are unaffected.
function resolveTrunc(tokens){
  const smash=tokens.join('');
  if(TEAM_ALIAS[smash]) return TEAM_ALIAS[smash];
  const entries=Object.entries(TEAM_ALIAS);
  let best=null;
  entries.forEach(([k,v])=>{ if(k.startsWith(smash)&&(!best||k.length>best[0].length)) best=[k,v]; });
  if(best) return best[1];
  for(let i=1;i<=tokens.length;i++){
    const pre=tokens.slice(0,i).join('');
    if(TEAM_ALIAS[pre] && !tokens.slice(i).some(t=>SIGNIFICANT_TOKENS.has(t))){
      return TEAM_ALIAS[pre];
    }
  }
  return smash;
}
function teamMatchTrunc(a,b){
  if(teamMatch(a,b)) return true;
  if(!/[…\u2026]/.test(a)&&!/[…\u2026]/.test(b)) return false;
  const taToks=teamTokens(stripEllipsis(a)), tbToks=teamTokens(stripEllipsis(b));
  const ta="".concat(...taToks), tb="".concat(...tbToks);
  if(!ta||!tb) return false;
  if(ta.startsWith(tb)||tb.startsWith(ta)) return true;
  return resolveTrunc(taToks)===resolveTrunc(tbToks);
}

function inputsFor(key){
  let a=state.inputs[key];
  // fall back to the in-memory demo numbers only when nothing real is stored
  if(!Array.isArray(a)&&demoInputs[key]) a=demoInputs[key];
  if(!Array.isArray(a)) a=[];
  // 2 slots now: [BP, Comp]. Older saved state had a 3rd (#4); slice drops it.
  a=a.slice(0,2); while(a.length<2) a.push(null);
  return a;
}
// Prediction-tracker numbers for a board key: {code: line} in home perspective.
// Populated by applyPredictions() against whatever key the current board uses.
let predByKey={};
function predsFor(key){ return predByKey[key]||{}; }
// The tracker abbreviates "State" as "St." ("Colorado St."); the board (Odds
// API) spells it out. Expand it before matching. Kept tracker-side only so the
// shared teamMatch (and its Python parity copy) stays untouched.
function normTracker(name){ return String(name||"").replace(/\bSt\.?\b/gi,"State"); }
// Every non-null enabled tracker system for this game, as an array of numbers.
// Per-input weight (default 1, except "vegas" which defaults to 0 -- see
// weightOf() in app/js/model.js for why). Keys: "bp","comp","vegas", and each system code.
// 0 excludes an input entirely. Stored sparsely -- only non-default weights live
// in state.weights, so an all-default model behaves exactly like a plain average.
// weightOf/weightedModel/myNumber/KEY_NUMBER_WEIGHTS/KEY_NUMBERS/KEY_BAND/
// keyNumberScore/keyNumberTier/edgeOf/edgeClass/BREAKEVEN_WINPCT/
// bucketForSpread/probabilityCoverForGame/clvOf/clvAlignment now live in
// app/js/model.js (loaded via <script> above) -- see that file for the full
// composite probability model and why it was split out.
// Live line for whichever side the user actually picked -- never re-derives
// the SIDE itself from the model's current recommendation, only refreshes
// the number if Vegas has moved since the pick was made.
function liveLineFor(game,side){
  if(!game||game.vegas==null) return null;
  return side==="home"?game.vegas:-game.vegas;
}

/* ---------- board ---------- */
// WEEK_MS/SEASON_WEEK1_TUESDAY/week1StartMs/weekIndexOf/buildGames/
// sortGamesBy/renderBoard/percentileRank/computeSnapshotScores/
// renderSnapshot/edgeExtrasHTML/probCellHTML/mktModelHTML/
// computeWeeklySetup/renderSetupStatus/updatePickCount/renderPickSummary
// (and everything else formerly under this banner) now live in
// app/js/board.js (loaded via <script> above) -- see that file's header
// for why it covers BOTH the Board tab and the Snapshot tab.


/* ---------- picks / entries ---------- */
// pickTeam/renderEntries/renderEntrySelect/snapClvCellData/
// pickedSideStats/allContexts/mergeSharedPoolsIntoLocal/
// collectPickRecords/clusterGames/renderCompareTable/movePick/
// renderPicksDetail (and everything else formerly under this banner) now
// live in app/js/picks.js (loaded via <script> above).


/* ---------- odds fetch ---------- */
// refreshLines/resolveVegasLine/resolveBookLines/populateBooks/
// refreshMeta (and everything else formerly under this banner) now live
// in app/js/odds.js (loaded via <script> above).


/* ---------- settings io ---------- */
// goSettings/exportBackup/importBackup now live in app/js/settings.js
// (loaded via <script> above).


/* ---------- record / history ---------- */
// closeWeek/sideOfArchived/restoreWeek/setResult/renderRecord now live
// in app/js/record.js (loaded via <script> above).


/* ---------- tabs / sync ---------- */
// switchTab/updateNavTabsScrollHint/initNavTabsScrollHint/syncAll now
// live in app/js/tabs.js (loaded via <script> above).


/* ---------- cross-device sync ---------- */
// setSyncStatus/scheduleSync/stateEndpoint/pushState/pullTier/
// pullState now live in app/js/sync.js (loaded via <script> above).


/* ---------- Powers PDF import ---------- */
// teamMatch/teamTokens/aliasOf/prefixOk/SIGNIFICANT_TOKENS/
// findBoardGame/applyTeamLogos/fetchTeamLogos/applyPdfData/
// applyPredictions/renderUnmatched/importPowers now live in
// app/js/pdf-import.js (loaded via <script> above) -- see that file's
// header for why it covers more than just PDF import.


/* ---------- pool contexts ---------- */
// renderContextSelect/renderContextAll/switchContext/
// computeContextSummary/renderContextBar/renderContextSwitcherContent/
// openContextSwitcher/closeContextSwitcher/initContextBar/
// extractPdfTextLines/poolWeekIndex/mergePoolLines/
// archivePoolCurrentWeek/importPool/removeActivePool now live in
// app/js/pool-contexts.js (loaded via <script> above).


/* ---------- prediction tracker ---------- */
// fetchPredictions/systemsPresentThisWeek/setWeight/bindWeightInput/
// renderSystemsSettings/updateSystemsCount now live in
// app/js/prediction-tracker.js (loaded via <script> above).


/* ---------- init ---------- */
// clearColumn/init/rehydrateAfterSync/initErrorBoundary/bootstrap's
// DEFINITIONS now live in app/js/init.js (loaded via <script> above) --
// see that file's header for why the initErrorBoundary()/bootstrap()
// INVOCATIONS deliberately stay right here in this file instead (at the
// very start and very end of this script respectively), not in init.js.

bootstrap();
