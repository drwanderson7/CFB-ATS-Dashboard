// --- CFBD live scores + power-rating context -----------------------------
// Shared reference data only; never written into private PickGauge state.
// Uses canonical cfbdGameId/team IDs when available and falls back to the
// existing team matcher solely for legacy/unresolved rows.
const CFBD_SCOREBOARD_LOCAL_KEY="pickgauge_cfbd_scoreboard_v1";
const CFBD_RATINGS_LOCAL_PREFIX="pickgauge_cfbd_ratings_v1_";
const CFBD_ADVANCED_LOCAL_PREFIX="pickgauge_cfbd_advanced_v2_";
let cfbdScoreboard=[];
let cfbdScoreboardMeta=null;
let cfbdRatings=[];
let cfbdRatingsMeta=null;
let cfbdAdvanced=[];
let cfbdAdvancedMeta=null;
let cfbdRefreshTimer=null;

function _cfbdLoadLocal(key){
  try{ return JSON.parse(localStorage.getItem(key)||"null"); }catch(e){ return null; }
}
function _cfbdSaveLocal(key,obj){ try{ localStorage.setItem(key,JSON.stringify(obj)); }catch(e){} }
function currentCfbdSeason(){
  if(logosMeta&&Number(logosMeta.season)) return Number(logosMeta.season);
  const years=(cfbdGames||[]).map(g=>Number(g.season)).filter(Boolean);
  return years.length?Math.max(...years):new Date().getFullYear();
}
function loadCfbdInsightsLocal(){
  const sb=_cfbdLoadLocal(CFBD_SCOREBOARD_LOCAL_KEY);
  if(sb&&Array.isArray(sb.games)){ cfbdScoreboard=sb.games; cfbdScoreboardMeta=sb.meta||null; }
  const year=currentCfbdSeason();
  const rt=_cfbdLoadLocal(CFBD_RATINGS_LOCAL_PREFIX+year);
  if(rt&&Array.isArray(rt.ratings)){ cfbdRatings=rt.ratings; cfbdRatingsMeta=rt.meta||null; }
  const av=_cfbdLoadLocal(CFBD_ADVANCED_LOCAL_PREFIX+year);
  if(av&&Array.isArray(av.teams)){ cfbdAdvanced=av.teams; cfbdAdvancedMeta=av.meta||null; }
}
function _cfbdRenderConsumers(){
  // Recompute SP+/CORE-derived predictions BEFORE re-rendering anything --
  // ratings arrive asynchronously, after the page's first
  // applyPredictions() call already ran (see that function's own comment
  // in app/js/pdf-import.js), so Model # needs a fresh pass once they do.
  if(typeof applyCfbdDerivedPredictions==="function") applyCfbdDerivedPredictions();
  if(typeof captureModelPerformanceSnapshot==="function") captureModelPerformanceSnapshot();
  // renderBoard() already calls renderSnapshot() itself at the end of its
  // own render -- calling both here would double-render Snapshot on every
  // single CFBD fetch completion. Fall back to a direct renderSnapshot()
  // call ONLY when boardBody doesn't exist (shouldn't happen in the real
  // app, where both tabs' DOM exists simultaneously regardless of which
  // is visible -- but cheap insurance against a future page structure
  // change, or a test harness that only stubs one of the two).
  if(document.getElementById("boardBody")) renderBoard();
  else if(document.getElementById("tab-snapshot")) renderSnapshot();
  if(document.getElementById("picksDetail")) renderPicksDetail();
  if(document.getElementById("recordBody")) renderRecord();
}
async function fetchCfbdScoreboard(force=false){
  const url="/api/fetch_cfbd?view=scoreboard"+(force?"&force=1":"");
  const result=await apiFetch(url,{});
  if(!result.ok) return false;
  const body=result.body||{};
  if(!Array.isArray(body.games)) return false;
  cfbdScoreboard=body.games;
  cfbdScoreboardMeta={fetchedAt:body.fetchedAt||new Date().toISOString(),source:body.source||null};
  _cfbdSaveLocal(CFBD_SCOREBOARD_LOCAL_KEY,{games:cfbdScoreboard,meta:cfbdScoreboardMeta});
  _cfbdRenderConsumers();
  return true;
}
async function fetchCfbdRatings(year=currentCfbdSeason(),force=false){
  year=Number(year)||currentCfbdSeason();
  const url=`/api/fetch_cfbd?view=ratings&year=${encodeURIComponent(year)}${force?"&force=1":""}`;
  const result=await apiFetch(url,{});
  if(!result.ok) return false;
  const body=result.body||{};
  if(!Array.isArray(body.ratings)) return false;
  cfbdRatings=body.ratings;
  cfbdRatingsMeta={year,fetchedAt:body.fetchedAt||new Date().toISOString(),source:body.source||null,unavailable:body.unavailable||[]};
  _cfbdSaveLocal(CFBD_RATINGS_LOCAL_PREFIX+year,{ratings:cfbdRatings,meta:cfbdRatingsMeta});
  _cfbdRenderConsumers();
  return true;
}
// Matchup Intelligence v2 -- same fetch/cache shape as fetchCfbdRatings()
// (season-level, 6h server cache, fetched once at startup/season change,
// not on the 90s scoreboard-refresh cadence). See api/fetch_cfbd.py's
// module docstring for the current documented/live-verified field shape.
async function fetchCfbdAdvanced(year=currentCfbdSeason(),force=false){
  year=Number(year)||currentCfbdSeason();
  const url=`/api/fetch_cfbd?view=advanced&year=${encodeURIComponent(year)}${force?"&force=1":""}`;
  const result=await apiFetch(url,{});
  if(!result.ok) return false;
  const body=result.body||{};
  if(!Array.isArray(body.teams)) return false;
  cfbdAdvanced=body.teams;
  cfbdAdvancedMeta={
    year,
    fetchedAt:body.fetchedAt||new Date().toISOString(),
    source:body.source||null,
    excludeGarbageTime:body.excludeGarbageTime===true,
    classifications:Array.isArray(body.classifications)?body.classifications:[],
    fcsAvailable:body.fcsAvailable!==false,
  };
  _cfbdSaveLocal(CFBD_ADVANCED_LOCAL_PREFIX+year,{teams:cfbdAdvanced,meta:cfbdAdvancedMeta});
  _cfbdRenderConsumers();
  return true;
}
function initCfbdInsights(){
  loadCfbdInsightsLocal();
  // First paint never waits on CFBD. Scoreboard refreshes often; ratings and
  // advanced stats are server-cached for six hours and fetched only at
  // startup/season change.
  fetchCfbdScoreboard(false);
  fetchCfbdRatings(currentCfbdSeason(),false);
  fetchCfbdAdvanced(currentCfbdSeason(),false);
  if(cfbdRefreshTimer) clearInterval(cfbdRefreshTimer);
  cfbdRefreshTimer=setInterval(()=>{
    if(document.visibilityState!=="hidden") fetchCfbdScoreboard(false);
  },90000);
}

function cfbdScoreboardGameFor(ref){
  if(!ref) return null;
  if(ref.cfbdGameId!=null){
    const exact=cfbdScoreboard.find(g=>g&&g.id!=null&&String(g.id)===String(ref.cfbdGameId));
    if(exact) return exact;
  }
  let away=null,home=null;
  if(ref.away&&ref.home){ away=ref.away; home=ref.home; }
  else if(ref.matchup&&String(ref.matchup).includes(" @ ")) [away,home]=String(ref.matchup).split(" @ ",2);
  if(!away||!home) return null;
  return cfbdScoreboard.find(g=>g&&g.awayTeam&&g.homeTeam&&teamMatch(away,g.awayTeam.name)&&teamMatch(home,g.homeTeam.name))||null;
}
function cfbdQuarterLabel(g){
  if(!g) return "";
  if(g.status==="completed") return "Final";
  if(g.status==="scheduled") return kickStr(g.startDate)||"Scheduled";
  const p=Number(g.period);
  const period=p>4?`OT${p>5?" "+(p-4):""}`:(p?`Q${p}`:"Live");
  return [period,g.clock].filter(Boolean).join(" · ");
}
function cfbdPickedOrientation(pick,g){
  if(!pick||!g) return null;
  const pid=pick.cfbdPickedTeamId;
  if(pid!=null){
    if(g.homeTeam&&g.homeTeam.id!=null&&String(pid)===String(g.homeTeam.id)) return "home";
    if(g.awayTeam&&g.awayTeam.id!=null&&String(pid)===String(g.awayTeam.id)) return "away";
  }
  if(pick.team&&g.homeTeam&&teamMatch(pick.team,g.homeTeam.name)) return "home";
  if(pick.team&&g.awayTeam&&teamMatch(pick.team,g.awayTeam.name)) return "away";
  return pick.side||null;
}
function cfbdPickScoreStatus(pick,g){
  if(!pick||!g) return null;
  const side=cfbdPickedOrientation(pick,g);
  const hp=g.homeTeam&&recordNumber(g.homeTeam.points);
  const ap=g.awayTeam&&recordNumber(g.awayTeam.points);
  const line=recordNumber(pick.line);
  const status=g.status||"scheduled";
  if(side!=="home"&&side!=="away") return {status,label:cfbdQuarterLabel(g),result:null,coverMargin:null};
  if(hp==null||ap==null||line==null) return {status,label:cfbdQuarterLabel(g),result:null,coverMargin:null};
  const picked=side==="home"?hp:ap, opp=side==="home"?ap:hp;
  const margin=round1((picked-opp)+line);
  const result=margin>0?"W":margin<0?"L":"P";
  return {status,label:cfbdQuarterLabel(g),result:status==="completed"?result:null,coverMargin:margin,homePoints:hp,awayPoints:ap};
}
function cfbdPickStatusHTML(pick,liveGame){
  // Prefer the pick itself so an exact frozen cfbdGameId wins even if the
  // current board object has not yet been enriched with canonical identity.
  const g=cfbdScoreboardGameFor(pick)||cfbdScoreboardGameFor(liveGame);
  if(!g) return "";
  const s=cfbdPickScoreStatus(pick,g);
  if(!s) return "";
  if(g.status==="scheduled") return `<span class="cfbd-game-status scheduled">${esc(s.label||"Scheduled")}</span>`;
  const score=`${esc(g.awayTeam.name)} ${g.awayTeam.points??"—"} · ${esc(g.homeTeam.name)} ${g.homeTeam.points??"—"}`;
  if(g.status==="completed"){
    const cls=s.result==="W"?"win":s.result==="L"?"loss":"push";
    return `<span class="cfbd-game-status ${cls}"><b>${s.result||"Final"}</b> · ${score} · Final</span>`;
  }
  let ats="";
  if(s.coverMargin!=null){
    const amount=Math.abs(s.coverMargin).toFixed(1).replace(/\.0$/,"");
    ats=s.coverMargin>0?`Covering by ${amount}`:s.coverMargin<0?`Behind ATS by ${amount}`:"On the number";
  }
  return `<span class="cfbd-game-status live"><b>LIVE</b> · ${score} · ${esc(s.label||"")}${ats?` · ${ats}`:""}</span>`;
}

function _cfbdCanonicalName(name,id){
  if(id!=null){
    const t=(teamLogos||[]).find(x=>x&&x.id!=null&&String(x.id)===String(id));
    if(t&&t.school) return t.school;
  }
  const t=typeof cfbdTeamForName==="function"?cfbdTeamForName(name):null;
  return (t&&t.school)||name||"";
}
function cfbdRatingForTeam(name,id){
  const canonical=_cfbdCanonicalName(name,id);
  return (cfbdRatings||[]).find(r=>r&&r.team&&teamMatch(canonical,r.team))||null;
}
function _ratingNum(v){ return (v==null||v===""||!Number.isFinite(Number(v)))?null:Number(v); }
function _ratingDisplay(v,digits=1){ const n=_ratingNum(v); return n==null?"—":n.toFixed(digits).replace(/\.0$/,''); }

// --- SP+/CORE as real Model # inputs ---------------------------------
// Confirmed with Drew before building: these are REAL prediction inputs
// (averaged into Model #/Edge/Cover % like BP/Comp/every predictiontracker
// system), not just context -- a deliberate, explicit exception to every
// OTHER CFBD feature in this app (ratings context, Matchup Intelligence,
// postgame box score), which are all documented everywhere as context-only
// and never touching Model #. See PRED_SYSTEMS' own comment
// (app/data/pred-systems.js) for the full reasoning on the 2.6pt HFA
// constant and its real limitations.
const CFBD_DERIVED_HFA=2.6;
// Home-team-spread convention (negative = home favored), matching every
// other system in this app. Higher rating = better team for both SP+ and
// CORE (confirmed by cfbdRatingsPanelHTML()'s own "stronger" comparison
// logic just below). Predicted home margin = (homeRating-awayRating)+HFA;
// the spread is that margin's negation.
// `neutralSite` param added as a real bug fix: this used to apply
// CFBD_DERIVED_HFA unconditionally, which handed whichever team CFBD calls
// "home" a false 2.6pt edge on every neutral-site game (bowls, Mercedes-Benz
// Stadium/Atlanta-style openers, etc.) even though neither team had a home
// edge to give. Defaults to false (current/historical behavior: full HFA)
// when the flag is missing or not explicitly true, since a truly unknown
// site is far more often a real home game than a neutral one.
function cfbdDerivedSpread(awayRating,homeRating,neutralSite){
  const av=_ratingNum(awayRating), hv=_ratingNum(homeRating);
  if(av==null||hv==null) return null;
  const hfa=neutralSite===true?0:CFBD_DERIVED_HFA;
  return round1(av-hv-hfa);
}
// Populates predByKey["cfbdsp"]/predByKey["cfbdcore"] for every current
// game -- called from applyPredictions() (app/js/pdf-import.js) so it runs
// everywhere that function already does, and again from
// _cfbdRenderConsumers() below, since ratings arrive asynchronously AFTER
// the page's first applyPredictions() call and predictions need
// recomputing once they do. MERGES into whatever's already at
// predByKey[key] rather than replacing it -- applyPredictions() itself
// may have just written real predictiontracker.com systems there for this
// same game, and stomping that object would silently drop them.
function applyCfbdDerivedPredictions(){
  if(!cfbdRatings.length||typeof games==="undefined"||!games||!games.length) return;
  games.forEach(g=>{
    const away=cfbdRatingForTeam(g.cfbdAwaySchool||g.away,g.cfbdAwayTeamId);
    const home=cfbdRatingForTeam(g.cfbdHomeSchool||g.home,g.cfbdHomeTeamId);
    const neutral=g.cfbdNeutralSite===true;
    const sp=cfbdDerivedSpread(away&&away.sp&&away.sp.rating, home&&home.sp&&home.sp.rating, neutral);
    const core=cfbdDerivedSpread(away&&away.core&&away.core.overall, home&&home.core&&home.core.overall, neutral);
    if(sp==null&&core==null) return;
    if(!predByKey[g.key]) predByKey[g.key]={};
    if(sp!=null) predByKey[g.key].cfbdsp=sp; else delete predByKey[g.key].cfbdsp;
    if(core!=null) predByKey[g.key].cfbdcore=core; else delete predByKey[g.key].cfbdcore;
  });
}
function cfbdRatingsPanelHTML(g){
  if(!g||!cfbdRatings.length) return "";
  const away=cfbdRatingForTeam(g.cfbdAwaySchool||g.away,g.cfbdAwayTeamId);
  const home=cfbdRatingForTeam(g.cfbdHomeSchool||g.home,g.cfbdHomeTeamId);
  if(!away&&!home) return "";
  const rows=[
    {label:"CORE", a:away&&away.core&&away.core.overall, h:home&&home.core&&home.core.overall, ar:null, hr:null},
    {label:"SP+", a:away&&away.sp&&away.sp.rating, h:home&&home.sp&&home.sp.rating, ar:away&&away.sp&&away.sp.ranking, hr:home&&home.sp&&home.sp.ranking},
    {label:"FPI", a:away&&away.fpi&&away.fpi.fpi, h:home&&home.fpi&&home.fpi.fpi, ar:null, hr:null},
    {label:"Elo", a:away&&away.elo&&away.elo.elo, h:home&&home.elo&&home.elo.elo, ar:null, hr:null,digits:0},
    {label:"SRS", a:away&&away.srs&&away.srs.rating, h:home&&home.srs&&home.srs.rating, ar:away&&away.srs&&away.srs.ranking, hr:home&&home.srs&&home.srs.ranking},
  ].filter(r=>_ratingNum(r.a)!=null||_ratingNum(r.h)!=null);
  if(!rows.length) return "";
  const coreWeeks=[away&&away.core&&away.core.throughWeek,home&&home.core&&home.core.throughWeek].map(Number).filter(Number.isFinite);
  const through=coreWeeks.length?` · CORE through W${Math.max(...coreWeeks)}`:"";
  // Real wording bug fix: this used to hardcode "Context only — not part of
  // Model #" unconditionally, which became false the moment SP+/CORE were
  // added as real Model # inputs (see the CFBD_DERIVED_HFA block above).
  // Now reflects the person's actual current settings.
  const cfbdModelInputs=((typeof state!=="undefined"&&state&&Array.isArray(state.enabledSystems))?state.enabledSystems:[])
    .filter(c=>c==="cfbdsp"||c==="cfbdcore");
  const contextNote=((typeof isPickGaugeModelActive==="function")&&isPickGaugeModelActive())
    ?"SP+ contributes behind the scenes to PickGauge Model #"
    :(cfbdModelInputs.length
      ?`${cfbdModelInputs.map(c=>c==="cfbdsp"?"SP+":"CORE").join(" + ")} enabled in Model #`
      :"Context only — not part of Model #");
  const body=rows.map(r=>{
    const an=_ratingNum(r.a), hn=_ratingNum(r.h);
    const ac=an!=null&&hn!=null&&an>hn?" stronger":"";
    const hc=an!=null&&hn!=null&&hn>an?" stronger":"";
    const ad=`${_ratingDisplay(r.a,r.digits??1)}${r.ar?` <small>#${r.ar}</small>`:""}`;
    const hd=`${_ratingDisplay(r.h,r.digits??1)}${r.hr?` <small>#${r.hr}</small>`:""}`;
    return `<div class="cfbd-rating-row"><span class="system">${r.label}</span><span class="teamval${ac}">${ad}</span><span class="teamval${hc}">${hd}</span></div>`;
  }).join("");
  return `<div class="cfbd-ratings-panel">
    <div class="cfbd-ratings-head"><div><b>CFBD power ratings</b><span class="cfbd-context-note">${contextNote}${through}</span></div></div>
    <div class="cfbd-rating-row header"><span>System</span><span>${esc(g.away)}</span><span>${esc(g.home)}</span></div>
    ${body}
  </div>`;
}

// --- Matchup Intelligence v2 -----------------------------------------------
// Season-to-date offense-vs-defense context from CFBD. This remains CONTEXT
// ONLY -- it never feeds Model #, Edge, Cover %, EV, or Model Agreement.
// v2 incorporates what real Week 0 data exposed: garbage time is excluded,
// FCS teams are fetched too, offense HAVOC allowed is compared with defense
// HAVOC generated, early-season sample size is disclosed, and completed
// games are hidden so their own outcome cannot leak back into a "pregame"
// comparison after CFBD rolls that game into the season aggregate.
function cfbdAdvancedForTeam(name,id){
  const canonical=_cfbdCanonicalName(name,id);
  return (cfbdAdvanced||[]).find(t=>t&&t.team&&teamMatch(canonical,t.team))||null;
}
function _cfbdTeamShortLabel(name,id){
  if(id!=null){
    const t=(teamLogos||[]).find(x=>x&&x.id!=null&&String(x.id)===String(id));
    if(t&&t.abbreviation) return String(t.abbreviation).toUpperCase();
  }
  return _cfbdCanonicalName(name,id)||name||"Team";
}
function _cfbdIsCompletedMatchup(g){
  if(!g) return false;
  if(g.completed===true||g.status==="completed") return true;
  const live=cfbdScoreboardGameFor(g);
  if(live&&live.status==="completed") return true;
  if(g.cfbdGameId!=null){
    const identity=(cfbdGames||[]).find(x=>x&&x.id!=null&&String(x.id)===String(g.cfbdGameId));
    if(identity&&identity.completed===true) return true;
  }
  return false;
}

// The first five rows compare what the offense produces with what the
// defense allows. HAVOC is intentionally different: offense.havoc is havoc
// ALLOWED/SUFFERED by the offense, while defense.havoc is havoc GENERATED.
// The same diff sign still works for a matchup comparison: offense minus
// defense; positive -> offense lean, negative -> defense lean.
const CFBD_MATCHUP_METRICS=[
  {key:"ppa",label:"PPA/play",digits:2,pct:false,threshold:0.15},
  {key:"successRate",label:"Success rate",digits:1,pct:true,threshold:0.03},
  {key:"explosiveness",label:"Explosiveness",digits:2,pct:false,threshold:0.15},
  {key:"rushSuccessRate",label:"Rushing success",path:"rushingPlays",field:"successRate",digits:1,pct:true,threshold:0.03},
  {key:"passSuccessRate",label:"Passing success",path:"passingPlays",field:"successRate",digits:1,pct:true,threshold:0.03},
  {key:"havoc",label:"Havoc rate*",path:"havoc",field:"total",digits:1,pct:true,threshold:0.02,havoc:true},
];
function _cfbdAdvField(block,metric){
  if(!block) return null;
  const sub=metric.path?block[metric.path]:block;
  if(!sub) return null;
  return _ratingNum(sub[metric.field||metric.key]);
}
function cfbdMatchupAdvantage(offTeam,defTeam){
  const off=offTeam&&offTeam.offense, def=defTeam&&defTeam.defense;
  if(!off||!def) return [];
  return CFBD_MATCHUP_METRICS.map(m=>{
    const offVal=_cfbdAdvField(off,m);
    const defVal=_cfbdAdvField(def,m);
    let favors=null,diff=null;
    if(offVal!=null&&defVal!=null){
      diff=offVal-defVal;
      favors=Math.abs(diff)<m.threshold?"even":(diff>0?"offense":"defense");
    }
    return {...m,offVal,defVal,diff,favors};
  }).filter(r=>r.offVal!=null||r.defVal!=null);
}
function _cfbdAdvDisplay(v,pct,digits){
  if(v==null) return "—";
  return pct?`${(v*100).toFixed(digits)}%`:v.toFixed(digits);
}
function _cfbdAdvDiffDisplay(r){
  if(!r||r.diff==null) return "—";
  const sign=r.diff>0?"+":"";
  return r.pct?`${sign}${(r.diff*100).toFixed(r.digits)} pp`:`${sign}${r.diff.toFixed(r.digits)}`;
}
function _cfbdRankDirection(side,metric){
  // Season advanced offense values are production (higher is better),
  // EXCEPT offensive havoc, which is havoc allowed/suffered (lower is
  // better). Defense values are what that unit ALLOWS (lower is better),
  // EXCEPT defensive havoc, which is disruption generated (higher is
  // better). Keep this centralized so rank/percentile context cannot drift
  // from the matchup semantics used by the table itself.
  if(metric&&metric.havoc) return side==="offense"?"lower":"higher";
  return side==="offense"?"higher":"lower";
}
function _cfbdOrdinal(n){
  n=Math.max(0,Math.round(Number(n)||0));
  const mod100=n%100;
  if(mod100>=11&&mod100<=13) return `${n}th`;
  const mod10=n%10;
  return `${n}${mod10===1?"st":mod10===2?"nd":mod10===3?"rd":"th"}`;
}
function cfbdAdvancedRankContext(team,side,metric){
  if(!team||!metric||(side!=="offense"&&side!=="defense")) return null;
  const target=_cfbdAdvField(team[side],metric);
  if(target==null) return null;
  const cls=String(team.classification||"").trim().toLowerCase();
  const peers=(cfbdAdvanced||[]).filter(t=>{
    if(!t||!t[side]) return false;
    if(cls && String(t.classification||"").trim().toLowerCase()!==cls) return false;
    return _cfbdAdvField(t[side],metric)!=null;
  });
  if(peers.length<2) return null;
  const direction=_cfbdRankDirection(side,metric);
  let better=0;
  peers.forEach(t=>{
    const v=_cfbdAdvField(t[side],metric);
    if(v==null) return;
    if(direction==="higher"?v>target:v<target) better++;
  });
  const rank=better+1;
  const total=peers.length;
  // Percentile is "share of currently ranked peers at or below this rank"
  // so #1 is 100th percentile and the bottom team remains >0 rather than
  // producing a confusing "0th percentile" label.
  const percentile=Math.max(1,Math.min(100,Math.round(((total-rank+1)/total)*100)));
  return {rank,total,percentile,classification:cls||null,direction};
}
function _cfbdRankHTML(team,side,metric){
  const r=cfbdAdvancedRankContext(team,side,metric);
  if(!r) return "";
  const cls=r.classification?` ${r.classification.toUpperCase()}`:"";
  const title=`Rank among ${r.total}${cls} teams with this ${side} metric currently available`;
  return `<small class="cfbd-stat-rank" title="${esc(title)}"><span>#${r.rank}/${r.total}${esc(cls)}</span><span class="cfbd-rank-pct"> · ${_cfbdOrdinal(r.percentile)} pct</span></small>`;
}
function cfbdMatchupPairHTML(offName,offId,offTeam,defName,defId,defTeam){
  const rows=cfbdMatchupAdvantage(offTeam,defTeam);
  if(!rows.length) return "";
  const offFull=_cfbdCanonicalName(offName,offId)||offName;
  const defFull=_cfbdCanonicalName(defName,defId)||defName;
  const offShort=_cfbdTeamShortLabel(offName,offId);
  const defShort=_cfbdTeamShortLabel(defName,defId);
  const body=rows.map(r=>{
    const oc=r.favors==="offense"?" stronger":"";
    const dc=r.favors==="defense"?" stronger":"";
    const lean=r.favors==="offense"?`${offShort} lean`:r.favors==="defense"?`${defShort} lean`:(r.favors==="even"?"Balanced":"");
    const metricTitle=r.havoc?"Offense = havoc allowed/suffered; defense = havoc generated":"Offense production compared with what the defense allows";
    return `<div class="cfbd-matchup-row">
      <span class="metric" title="${esc(metricTitle)}">${esc(r.label)}</span>
      <span class="val${oc}"><span class="cfbd-stat-main">${_cfbdAdvDisplay(r.offVal,r.pct,r.digits)}</span>${_cfbdRankHTML(offTeam,"offense",r)}</span>
      <span class="val${dc}"><span class="cfbd-stat-main">${_cfbdAdvDisplay(r.defVal,r.pct,r.digits)}</span>${_cfbdRankHTML(defTeam,"defense",r)}</span>
      <span class="diff">${esc(_cfbdAdvDiffDisplay(r))}</span>
      <span class="lean-label${r.favors&&r.favors!=="even"?" active":""}">${esc(lean)}</span>
    </div>`;
  }).join("");
  return `<div class="cfbd-matchup-pair">
    <div class="cfbd-matchup-pair-hdr">${esc(offFull)} offense <span class="vs">vs</span> ${esc(defFull)} defense</div>
    <div class="cfbd-matchup-row header">
      <span>Metric</span>
      <span><b>${esc(offShort)} offense</b><small>produced</small></span>
      <span><b>${esc(defShort)} defense</b><small>allowed*</small></span>
      <span class="diff">Diff.</span>
      <span>Matchup lean</span>
    </div>
    ${body}
  </div>`;
}
function _cfbdSampleNote(awayName,awayId,awayTeam,homeName,homeId,homeTeam){
  const a=_ratingNum(awayTeam&&awayTeam.offense&&awayTeam.offense.plays);
  const h=_ratingNum(homeTeam&&homeTeam.offense&&homeTeam.offense.plays);
  const year=cfbdAdvancedMeta&&cfbdAdvancedMeta.year?cfbdAdvancedMeta.year:currentCfbdSeason();
  const garbage=(cfbdAdvancedMeta&&cfbdAdvancedMeta.excludeGarbageTime)?" · Garbage time excluded":"";
  const aShort=_cfbdTeamShortLabel(awayName,awayId),hShort=_cfbdTeamShortLabel(homeName,homeId);
  const counts=[];
  if(a!=null) counts.push(`${aShort} ${Math.round(a)} offensive plays`);
  if(h!=null) counts.push(`${hShort} ${Math.round(h)} offensive plays`);
  const min=[a,h].filter(v=>v!=null).reduce((m,v)=>m==null?v:Math.min(m,v),null);
  const small=min!=null&&min<200;
  const prefix=small?"Small early-season sample":"Season-to-date sample";
  return `${year} season to date${garbage}${counts.length?` · ${prefix}: ${counts.join(" · ")}`:""}`;
}
function _cfbdMissingAdvancedNote(g,away,home){
  const missing=[];
  if(!away) missing.push(_cfbdCanonicalName(g.cfbdAwaySchool||g.away,g.cfbdAwayTeamId)||g.away);
  if(!home) missing.push(_cfbdCanonicalName(g.cfbdHomeSchool||g.home,g.cfbdHomeTeamId)||g.home);
  if(!missing.length) return "";
  const fcsPartial=cfbdAdvancedMeta&&cfbdAdvancedMeta.fcsAvailable===false;
  return `Matchup comparison unavailable because CFBD season advanced stats are not available for ${missing.map(esc).join(" / ")}${fcsPartial?" (FCS coverage is temporarily unavailable)":" yet"}.`;
}
function cfbdMatchupPanelHTML(g){
  if(!g) return "";

  // Once final, CFBD's season aggregate includes THIS game. Comparing it back
  // to the same opponent is hindsight (and in a one-game sample becomes an
  // exact mirror), not pregame intelligence. Results -> Why? owns postgame.
  if(_cfbdIsCompletedMatchup(g)){
    return `<div class="cfbd-matchup-panel">
      <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Pregame context only — not part of Model #</span></div></div>
      <div class="cfbd-matchup-empty-note"><b>Pregame view hidden after final.</b> Season-to-date stats now include this game, so showing them here would mix hindsight into the matchup. Use <b>Results → Why?</b> for the actual postgame performance breakdown.</div>
    </div>`;
  }

  if(!cfbdAdvanced.length){
    if(!cfbdAdvancedMeta) return "";
    return `<div class="cfbd-matchup-panel">
      <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Pregame context only — not part of Model #</span></div></div>
      <div class="cfbd-matchup-empty-note">Not available yet this season — CFBD computes these from games actually played, and there is not enough season data yet.</div>
    </div>`;
  }
  const away=cfbdAdvancedForTeam(g.cfbdAwaySchool||g.away,g.cfbdAwayTeamId);
  const home=cfbdAdvancedForTeam(g.cfbdHomeSchool||g.home,g.cfbdHomeTeamId);
  if(!away||!home){
    const note=_cfbdMissingAdvancedNote(g,away,home);
    return note?`<div class="cfbd-matchup-panel">
      <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Pregame context only — not part of Model #</span></div></div>
      <div class="cfbd-matchup-empty-note">${note}</div>
    </div>`:"";
  }
  const pair1=cfbdMatchupPairHTML(g.away,g.cfbdAwayTeamId,away,g.home,g.cfbdHomeTeamId,home);
  const pair2=cfbdMatchupPairHTML(g.home,g.cfbdHomeTeamId,home,g.away,g.cfbdAwayTeamId,away);
  if(!pair1&&!pair2) return "";
  const sample=_cfbdSampleNote(g.away,g.cfbdAwayTeamId,away,g.home,g.cfbdHomeTeamId,home);
  return `<div class="cfbd-matchup-panel">
    <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Pregame context only — not part of Model #</span><span class="cfbd-context-note cfbd-sample-note">${esc(sample)}</span></div></div>
    ${pair1}${pair2}
    <div class="cfbd-matchup-semantics">Ranks/percentiles are within each team’s classification (FBS/FCS) and only among teams with that metric currently available. *Havoc is the one reversed-semantics row: offense = havoc allowed/suffered; defense = havoc generated.</div>
  </div>`;
}

// --- Advanced postgame box-score analysis -----------------------------
// "Why did this pick win or lose" -- CURRENT_STATE.md's postgame box-score
// item. Lives in Results (app/js/record.js), NOT Snapshot -- this is about
// a GRADED pick's actual completed game, using api/fetch_cfbd.py's
// view=boxscore (see that file's module docstring for the live-doc
// verification this was checked against, meaningfully stronger than
// Matchup Intelligence v1's since /game/box/advanced is keyed by a
// specific finished game, not a season-in-progress aggregate).
//
// Fetched LAZILY, one game at a time, only when a Results row for a
// graded pick with a cfbdGameId is actually expanded -- unlike ratings/
// scoreboard/advanced (fetched eagerly at startup, since Snapshot shows
// every game on the board at once), there's no reason to eagerly fetch a
// box score for every graded pick's game on every app load; most won't
// ever be expanded in a given session.
let cfbdBoxScores={}; // gameId -> {gameInfo,teams,fetchedAt,source} | "loading" | "error"
async function fetchCfbdBoxScore(gameId){
  if(gameId==null) return null;
  const cached=cfbdBoxScores[gameId];
  if(cached && cached!=="error" && cached!=="loading") return cached;
  cfbdBoxScores[gameId]="loading";
  const result=await apiFetch(`/api/fetch_cfbd?view=boxscore&id=${encodeURIComponent(gameId)}`,{});
  if(!result.ok || !result.body || !result.body.teams){
    cfbdBoxScores[gameId]="error";
    return null;
  }
  cfbdBoxScores[gameId]=result.body;
  return result.body;
}
// Same {key,label,pct,digits} metric-row shape as CFBD_MATCHUP_METRICS
// above, but these are plain facts about a FINISHED game (not a
// probabilistic pregame comparison), so there's no "edge"/noise-threshold
// column here -- just the two numbers side by side. "Fewer is better" for
// turnovers only; every other metric here is "more is better," so the
// stronger-value highlight direction is flipped specifically for that row.
const CFBD_POSTGAME_METRICS=[
  // driverScale is a deliberately simple football-scale denominator used
  // ONLY to sort the largest descriptive separators across unlike units.
  // It is not a model weight, significance test, or causal claim.
  {key:"successRate",label:"Success rate",pct:true,digits:1,driverScale:0.05},
  {key:"ppa",label:"PPA/play",pct:false,digits:2,driverScale:0.15},
  {key:"explosiveness",label:"Explosiveness",pct:false,digits:2,driverScale:0.20},
  {key:"scoringOpportunities",label:"Scoring opportunities",pct:false,digits:0,driverScale:1},
  {key:"pointsPerOpportunity",label:"Points per scoring opportunity",pct:false,digits:2,driverScale:0.75},
  {key:"havoc",label:"Havoc rate (defense)",pct:true,digits:1,driverScale:0.03},
  {key:"turnovers",label:"Turnovers",pct:false,digits:0,lowerIsBetter:true,driverScale:1},
];
function _cfbdPostgameTeams(box,awayName,homeName){
  if(!box||!box.teams) return {away:null,home:null};
  let away=box.teams[awayName]||null,home=box.teams[homeName]||null;
  // Canonical archived names should normally match the box score exactly,
  // but use the shared team matcher as a defensive fallback for punctuation
  // or historical naming differences rather than dropping the whole panel.
  if(!away){
    const k=Object.keys(box.teams).find(n=>teamMatch(n,awayName));
    if(k) away=box.teams[k];
  }
  if(!home){
    const k=Object.keys(box.teams).find(n=>teamMatch(n,homeName));
    if(k) home=box.teams[k];
  }
  return {away,home};
}
function _cfbdPostgameGapText(metric,av,hv,side){
  const diff=Math.abs(Number(av)-Number(hv));
  if(metric.lowerIsBetter){
    const n=Math.round(diff);
    return `${n} fewer turnover${n===1?"":"s"}`;
  }
  if(metric.pct) return `+${(diff*100).toFixed(metric.digits)} pp`;
  if(metric.key==="scoringOpportunities"){
    const n=Math.round(diff);
    return `+${n} scoring opportunit${n===1?"y":"ies"}`;
  }
  if(metric.key==="pointsPerOpportunity") return `+${diff.toFixed(metric.digits)} pts/opportunity`;
  if(metric.key==="ppa") return `+${diff.toFixed(metric.digits)} PPA/play`;
  return `+${diff.toFixed(metric.digits)}`;
}
function cfbdPostgameDrivers(box,awayName,homeName){
  const {away,home}=_cfbdPostgameTeams(box,awayName,homeName);
  if(!away&&!home) return {drivers:[],awayWins:0,homeWins:0,ties:0,tracked:0};
  const candidates=[];
  let awayWins=0,homeWins=0,ties=0,tracked=0;
  CFBD_POSTGAME_METRICS.forEach(metric=>{
    const av=_ratingNum(away&&away[metric.key]);
    const hv=_ratingNum(home&&home[metric.key]);
    if(av==null||hv==null) return;
    tracked++;
    if(av===hv){ties++;return;}
    const awayStronger=metric.lowerIsBetter?(av<hv):(av>hv);
    if(awayStronger) awayWins++; else homeWins++;
    const winner=awayStronger?awayName:homeName;
    const scale=Number(metric.driverScale)||1;
    candidates.push({
      ...metric,
      awayVal:av,
      homeVal:hv,
      winner,
      side:awayStronger?"away":"home",
      score:Math.abs(av-hv)/scale,
      gapText:_cfbdPostgameGapText(metric,av,hv,awayStronger?"away":"home"),
    });
  });
  candidates.sort((a,b)=>b.score-a.score || a.label.localeCompare(b.label));
  return {drivers:candidates.slice(0,3),awayWins,homeWins,ties,tracked};
}
function _cfbdSignedNumber(v,digits=1){
  const n=_ratingNum(v);
  if(n==null) return "";
  const out=n.toFixed(digits).replace(/\.0$/,'');
  return n>0?`+${out}`:out;
}
function _cfbdPostgameScoreHTML(box,awayName,homeName){
  const gi=(box&&box.gameInfo)||{};
  const ap=_ratingNum(gi.awayPoints),hp=_ratingNum(gi.homePoints);
  if(ap==null&&hp==null) return "";
  return `<div class="cfbd-postgame-scoreline"><b>Final</b><span>${esc(awayName)} ${ap==null?"—":ap}</span><span class="cfbd-postgame-score-sep">·</span><span>${esc(homeName)} ${hp==null?"—":hp}</span></div>`;
}
function _cfbdPostgamePickHTML(box,awayName,homeName,pickContext){
  const ctx=pickContext||{};
  const line=_ratingNum(ctx.pickLine);
  const result=String(ctx.result||"").toUpperCase();
  const pickedTeam=ctx.pickedTeam||((ctx.side==="home")?homeName:(ctx.side==="away")?awayName:"");
  if(!pickedTeam&&!result&&line==null) return "";
  let side=ctx.side;
  if(side!=="home"&&side!=="away"){
    if(pickedTeam&&teamMatch(pickedTeam,homeName)) side="home";
    else if(pickedTeam&&teamMatch(pickedTeam,awayName)) side="away";
  }
  let ats="";
  const gi=(box&&box.gameInfo)||{};
  const hp=_ratingNum(gi.homePoints),ap=_ratingNum(gi.awayPoints);
  if(line!=null&&hp!=null&&ap!=null&&(side==="home"||side==="away")){
    const picked=side==="home"?hp:ap,opp=side==="home"?ap:hp;
    const coverMargin=(picked-opp)+line;
    const amount=Math.abs(coverMargin).toFixed(1).replace(/\.0$/,'');
    ats=coverMargin>0?`covered by ${amount}`:coverMargin<0?`missed by ${amount}`:"landed on the number";
  }
  const cls=result==="W"?" win":result==="L"?" loss":result==="P"?" push":"";
  const parts=[];
  if(pickedTeam) parts.push(`${esc(pickedTeam)}${line!=null?` ${esc(_cfbdSignedNumber(line,1))}`:""}`);
  if(result) parts.push(`<b class="cfbd-postgame-pick-result${cls}">${esc(result)}</b>`);
  if(ats) parts.push(esc(ats));
  return parts.length?`<div class="cfbd-postgame-pick"><span class="cfbd-postgame-kicker">Your archived pick</span><span>${parts.join(" · ")}</span></div>`:"";
}
function _cfbdPostgameSummaryHTML(box,awayName,homeName){
  const summary=cfbdPostgameDrivers(box,awayName,homeName);
  if(!summary.tracked) return "";
  let leaderText="The tracked advanced metrics were evenly split.";
  if(summary.awayWins!==summary.homeWins){
    const team=summary.awayWins>summary.homeWins?awayName:homeName;
    const wins=Math.max(summary.awayWins,summary.homeWins);
    leaderText=`${team} had the stronger value in ${wins} of ${summary.tracked} tracked categories${summary.ties?` (${summary.ties} tied)`:""}.`;
  }
  const drivers=summary.drivers.map((d,i)=>`<div class="cfbd-postgame-driver">
    <span class="cfbd-postgame-driver-num">${i+1}</span>
    <span class="cfbd-postgame-driver-metric">${esc(d.label)}</span>
    <span class="cfbd-postgame-driver-gap"><b>${esc(d.winner)}</b> ${esc(d.gapText)}</span>
  </div>`).join("");
  return `<div class="cfbd-postgame-summary">
    <div class="cfbd-postgame-read"><b>Overall read:</b> ${esc(leaderText)}</div>
    ${drivers?`<div class="cfbd-postgame-driver-title">Largest statistical separators</div>${drivers}`:""}
    <div class="cfbd-postgame-summary-note">Separators are ranked by simple football-scale differences across unlike metrics. They are descriptive, not a causal model.</div>
  </div>`;
}
function cfbdPostgamePanelHTML(box,awayName,homeName,pickContext=null){
  if(!box||!box.teams) return "";
  const {away,home}=_cfbdPostgameTeams(box,awayName,homeName);
  if(!away&&!home) return "";
  const rows=CFBD_POSTGAME_METRICS.map(m=>{
    const av=_ratingNum(away&&away[m.key]), hv=_ratingNum(home&&home[m.key]);
    if(av==null&&hv==null) return "";
    let awayStronger=null;
    if(av!=null&&hv!=null&&av!==hv){
      awayStronger=m.lowerIsBetter?(av<hv):(av>hv);
    }
    const ac=awayStronger===true?" stronger":"";
    const hc=awayStronger===false?" stronger":"";
    return `<div class="cfbd-matchup-row cols-3">
      <span class="metric">${esc(m.label)}</span>
      <span class="val${ac}">${_cfbdAdvDisplay(av,m.pct,m.digits)}</span>
      <span class="val${hc}">${_cfbdAdvDisplay(hv,m.pct,m.digits)}</span>
    </div>`;
  }).filter(Boolean).join("");
  if(!rows) return "";
  return `<div class="cfbd-matchup-panel cfbd-postgame-panel">
    <div class="cfbd-ratings-head"><div><b>Why this game went the way it did</b><span class="cfbd-context-note">Postgame box score — context only, never affects the grade</span></div></div>
    ${_cfbdPostgameScoreHTML(box,awayName,homeName)}
    ${_cfbdPostgamePickHTML(box,awayName,homeName,pickContext)}
    ${_cfbdPostgameSummaryHTML(box,awayName,homeName)}
    <div class="cfbd-postgame-table-label">Full advanced box-score comparison</div>
    <div class="cfbd-matchup-row header cols-3"><span>Metric</span><span>${esc(awayName)}</span><span>${esc(homeName)}</span></div>
    ${rows}
  </div>`;
}

// --- Closing-line freshness/quality -------------------------------------
// Real gap fix: PickGauge already retains closingLineObservedAt/Book on
// every archived pick (record.js closeWeek()) but never SHOWED them
// anywhere -- a "-7.5" close looked exactly as trustworthy whether it was
// captured 8 minutes before kickoff or 6 hours before, even though only
// the former is a real closing line. There is still no automatic
// recurring odds-capture job (only the daily grading cron exists in
// vercel.json) -- that's a separate, larger infra decision -- so until
// then, being honest about HOW STALE a given retained close actually is
// is the achievable fix. Pure function, no DOM/fetch, same split as every
// other CFBD helper in this file.
function closingLineFreshness(observedAt,kickoff){
  if(!observedAt||!kickoff) return null;
  const obs=Date.parse(observedAt), ko=Date.parse(kickoff);
  if(isNaN(obs)||isNaN(ko)) return null;
  const minutesBefore=(ko-obs)/60000;
  // An observation at/after kickoff is the WORST case (something delayed
  // the capture past the game actually starting), not the best -- must be
  // checked before the tier thresholds below, or a small negative number
  // would otherwise fall through to "Excellent" by minutesBefore<=10.
  let tier;
  if(minutesBefore<0) tier="Low-confidence";
  else if(minutesBefore<=10) tier="Excellent";
  else if(minutesBefore<=30) tier="Good";
  else if(minutesBefore<=60) tier="Stale";
  else tier="Low-confidence";
  return {minutesBefore:Math.round(minutesBefore),tier};
}
function closingLineFreshnessNote(freshness){
  if(!freshness) return "";
  const {minutesBefore,tier}=freshness;
  const when=minutesBefore<0?"captured after kickoff":`observed ${minutesBefore}m before kickoff`;
  return `${tier} · ${when}`;
}

// --- Historical CFBD betting-line integration -------------------------
// "Did our own retained pre-kick line actually match reality" -- lets
// someone check CFBD's OWN independent historical record of the closing
// line against what PickGauge itself captured. Lives alongside the
// postgame box score in Results' "Why?" panel (same graded-pick context),
// via api/fetch_cfbd.py's view=lines. Context/validation only -- never
// writes into the pick's own closingLine/CLV fields (see that endpoint's
// module docstring for why backfilling is explicitly a separate, later
// decision, not bundled into this).
let cfbdHistoricalLines={}; // gameId -> {homeTeam,awayTeam,lines,fetchedAt,source} | "loading" | "error"
async function fetchCfbdHistoricalLines(gameId){
  if(gameId==null) return null;
  const cached=cfbdHistoricalLines[gameId];
  if(cached && cached!=="error" && cached!=="loading") return cached;
  cfbdHistoricalLines[gameId]="loading";
  const result=await apiFetch(`/api/fetch_cfbd?view=lines&id=${encodeURIComponent(gameId)}`,{});
  if(!result.ok || !result.body){
    cfbdHistoricalLines[gameId]="error";
    return null;
  }
  cfbdHistoricalLines[gameId]=result.body;
  return result.body;
}
// Picks which provider's line to actually show: "consensus" if CFBD
// tracked one for this game, else whichever came back first -- same
// fallback a real third-party site documents using against this exact
// CFBD feed (sticktothemodel.com's own odds-history page: "largest
// coverage... falling back to the first listed book").
function _preferredCfbdLine(lines){
  if(!Array.isArray(lines)||!lines.length) return null;
  return lines.find(l=>String(l.provider||"").toLowerCase()==="consensus") || lines[0];
}
// ourClosingLine: the pick's OWN retained pre-kick close, already in
// PICKED-SIDE perspective (record.js's closingLine field -- p.side==="home"
// ? closingHomeLine : -closingHomeLine). CFBD's `spread` is HOME-TEAM
// perspective (confirmed: negative = home favored, matching this app's
// own convention throughout -- verified against a real third-party site
// that explicitly documents pulling from this exact CFBD feed, not
// assumed from the 0-valued schema example alone), so this converts it
// to the SAME picked-side perspective before comparing -- an apples-to-
// apples comparison in the convention Results already uses for this pick,
// not two numbers in different sign conventions that would misleadingly
// look like they disagree.
function cfbdLineComparisonHTML(historicalLines,ourClosingLine,side,closeMeta){
  if(!historicalLines||!Array.isArray(historicalLines.lines)) return "";
  const pref=_preferredCfbdLine(historicalLines.lines);
  if(!pref||pref.spread==null) return "";
  const cfbdHomeSpread=_ratingNum(pref.spread);
  const cfbdPickSideSpread=side==="home"?cfbdHomeSpread:-cfbdHomeSpread;
  let matchLabel="", matchClass="";
  if(ourClosingLine!=null){
    const diff=Math.abs(ourClosingLine-cfbdPickSideSpread);
    // Real books/consensus feeds can genuinely differ by half a point even
    // when "the same" close -- this isn't a bug in either source, it's
    // normal cross-book variance, so a tight but non-zero tolerance avoids
    // flagging every real, ordinary difference as a mismatch worth
    // investigating.
    matchLabel=diff<0.5?"✓ matches our retained line":`⚠ differs from our retained line by ${diff.toFixed(1)}`;
    matchClass=diff<0.5?"cfbd-line-match":"cfbd-line-mismatch";
  }
  const openRow=pref.spreadOpen!=null?`<div class="cfbd-matchup-row cols-3"><span class="metric">Opening line (CFBD, home persp.)</span><span class="val" style="grid-column:2/4;">${_cfbdAdvDisplay(_ratingNum(pref.spreadOpen),false,1)}</span></div>`:"";
  // closeMeta is optional (older callers/tests may omit it entirely) --
  // when present, surfaces WHEN/WHERE our own retained close was actually
  // captured, not just the bare number. See closingLineFreshness() above.
  const freshness=closeMeta?closingLineFreshness(closeMeta.observedAt,closeMeta.kickoff):null;
  const freshnessNote=closingLineFreshnessNote(freshness);
  const bookNote=(closeMeta&&closeMeta.book)?esc(closeMeta.book):"";
  const metaBits=[bookNote,freshnessNote].filter(Boolean).join(" · ");
  const freshnessClass=freshness?`cfbd-line-freshness-${freshness.tier.toLowerCase().replace(/[^a-z]+/g,"-")}`:"";
  const closeMetaRow=(ourClosingLine!=null&&metaBits)
    ?`<div class="cfbd-line-check-note ${freshnessClass}">${metaBits}</div>`:"";
  return `<div class="cfbd-matchup-panel">
    <div class="cfbd-ratings-head"><div><b>Line check — CFBD historical record</b><span class="cfbd-context-note">${esc(pref.provider||"provider")} · context only, never affects Model # or the archived pick</span></div></div>
    <div class="cfbd-matchup-row cols-3">
      <span class="metric">Our retained pre-kick close</span>
      <span class="val" style="grid-column:2/4;">${ourClosingLine==null?"—":_cfbdAdvDisplay(ourClosingLine,false,1)}</span>
    </div>
    ${closeMetaRow}
    <div class="cfbd-matchup-row cols-3">
      <span class="metric">CFBD historical close (picked side)</span>
      <span class="val" style="grid-column:2/4;">${_cfbdAdvDisplay(cfbdPickSideSpread,false,1)}</span>
    </div>
    ${openRow}
    ${matchLabel?`<div class="cfbd-line-check-note ${matchClass}">${esc(matchLabel)}</div>`:""}
  </div>`;
}
