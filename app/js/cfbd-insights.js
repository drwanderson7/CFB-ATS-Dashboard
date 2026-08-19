// --- CFBD live scores + power-rating context -----------------------------
// Shared reference data only; never written into private PickGauge state.
// Uses canonical cfbdGameId/team IDs when available and falls back to the
// existing team matcher solely for legacy/unresolved rows.
const CFBD_SCOREBOARD_LOCAL_KEY="pickgauge_cfbd_scoreboard_v1";
const CFBD_RATINGS_LOCAL_PREFIX="pickgauge_cfbd_ratings_v1_";
const CFBD_ADVANCED_LOCAL_PREFIX="pickgauge_cfbd_advanced_v1_";
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
  if(document.getElementById("picksDetail")) renderPicksDetail();
  if(document.getElementById("tab-snapshot")) renderSnapshot();
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
// Matchup Intelligence v1 -- same fetch/cache shape as fetchCfbdRatings()
// (season-level, 6h server cache, fetched once at startup/season change,
// not on the 90s scoreboard-refresh cadence). See api/fetch_cfbd.py's
// module docstring for the live-verification caveat on the underlying
// field names.
async function fetchCfbdAdvanced(year=currentCfbdSeason(),force=false){
  year=Number(year)||currentCfbdSeason();
  const url=`/api/fetch_cfbd?view=advanced&year=${encodeURIComponent(year)}${force?"&force=1":""}`;
  const result=await apiFetch(url,{});
  if(!result.ok) return false;
  const body=result.body||{};
  if(!Array.isArray(body.teams)) return false;
  cfbdAdvanced=body.teams;
  cfbdAdvancedMeta={year,fetchedAt:body.fetchedAt||new Date().toISOString(),source:body.source||null};
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
  const body=rows.map(r=>{
    const an=_ratingNum(r.a), hn=_ratingNum(r.h);
    const ac=an!=null&&hn!=null&&an>hn?" stronger":"";
    const hc=an!=null&&hn!=null&&hn>an?" stronger":"";
    const ad=`${_ratingDisplay(r.a,r.digits??1)}${r.ar?` <small>#${r.ar}</small>`:""}`;
    const hd=`${_ratingDisplay(r.h,r.digits??1)}${r.hr?` <small>#${r.hr}</small>`:""}`;
    return `<div class="cfbd-rating-row"><span class="system">${r.label}</span><span class="teamval${ac}">${ad}</span><span class="teamval${hc}">${hd}</span></div>`;
  }).join("");
  return `<div class="cfbd-ratings-panel">
    <div class="cfbd-ratings-head"><div><b>CFBD power ratings</b><span class="cfbd-context-note">Context only — not part of Model #${through}</span></div></div>
    <div class="cfbd-rating-row header"><span>System</span><span>${esc(g.away)}</span><span>${esc(g.home)}</span></div>
    ${body}
  </div>`;
}

// --- Matchup Intelligence v1 -----------------------------------------------
// Offense-vs-defense context for the two teams in a specific matchup, built
// from CFBD's season advanced team stats (api/fetch_cfbd.py?view=advanced).
// Context only, same treatment as the ratings panel above -- does NOT feed
// Model #, Edge, Cover %, EV, or Model Agreement. See that endpoint's own
// module docstring for the live-verification caveat on CFBD's exact field
// names (no live CFBD access to confirm the /stats/season/advanced shape
// in this environment).
function cfbdAdvancedForTeam(name,id){
  const canonical=_cfbdCanonicalName(name,id);
  return (cfbdAdvanced||[]).find(t=>t&&t.team&&teamMatch(canonical,t.team))||null;
}
// Which comparisons to show, and where each metric lives within an
// offense/defense block. `path`+`field` for a nested split (e.g.
// rushingPlays.successRate); omit both for a top-level field (ppa,
// successRate, explosiveness). `pct` controls display as a percentage vs
// a plain decimal; `digits` controls precision.
const CFBD_MATCHUP_METRICS=[
  {key:"ppa",label:"PPA/play",digits:2,pct:false},
  {key:"successRate",label:"Success rate",digits:1,pct:true},
  {key:"explosiveness",label:"Explosiveness",digits:2,pct:false},
  {key:"rushSuccessRate",label:"Rushing success",path:"rushingPlays",field:"successRate",digits:1,pct:true},
  {key:"passSuccessRate",label:"Passing success",path:"passingPlays",field:"successRate",digits:1,pct:true},
];
function _cfbdAdvField(block,metric){
  if(!block) return null;
  const sub=metric.path?block[metric.path]:block;
  if(!sub) return null;
  return _ratingNum(sub[metric.field||metric.key]);
}
// Pure comparison math -- kept separate from the HTML builders below so
// it's independently testable, same split as edgeOf()/
// probabilityCoverForGame() vs their own HTML renderers in app/js/board.js.
// `diff = offVal - defVal`: for successRate/explosiveness/ppa, a team's
// offense.X is "how well this offense normally performs on this metric"
// and the opponent's defense.X is "what this defense normally ALLOWS
// opponents to do on this metric" -- so a positive diff means this
// offense's typical output exceeds what this defense typically allows
// (an offensive edge), and a negative diff means this defense typically
// holds opponents below this offense's normal output (a defensive edge).
// A small, real-but-noise-level difference isn't worth calling an
// "advantage" in either direction -- thresholds are scaled per metric
// family (percentage-rate metrics use a coarser cutoff than PPA/
// explosiveness's own smaller natural scale).
function cfbdMatchupAdvantage(offTeam,defTeam){
  const off=offTeam&&offTeam.offense, def=defTeam&&defTeam.defense;
  if(!off||!def) return [];
  return CFBD_MATCHUP_METRICS.map(m=>{
    const offVal=_cfbdAdvField(off,m);
    const defVal=_cfbdAdvField(def,m);
    let favors=null;
    if(offVal!=null&&defVal!=null){
      const diff=offVal-defVal;
      const threshold=m.pct?0.03:0.15;
      favors=Math.abs(diff)<threshold?"even":(diff>0?"offense":"defense");
    }
    return {...m,offVal,defVal,diff:(offVal!=null&&defVal!=null)?offVal-defVal:null,favors};
  }).filter(r=>r.offVal!=null||r.defVal!=null);
}
function _cfbdAdvDisplay(v,pct,digits){
  if(v==null) return "—";
  return pct?`${(v*100).toFixed(digits)}%`:v.toFixed(digits);
}
function cfbdMatchupPairHTML(offName,offTeam,defName,defTeam){
  const rows=cfbdMatchupAdvantage(offTeam,defTeam);
  if(!rows.length) return "";
  const body=rows.map(r=>{
    const oc=r.favors==="offense"?" stronger":"";
    const dc=r.favors==="defense"?" stronger":"";
    const edgeLabel=r.favors==="offense"?`${offName} edge`:r.favors==="defense"?`${defName} edge`:(r.favors==="even"?"Even":"");
    return `<div class="cfbd-matchup-row">
      <span class="metric">${esc(r.label)}</span>
      <span class="val${oc}">${_cfbdAdvDisplay(r.offVal,r.pct,r.digits)}</span>
      <span class="val${dc}">${_cfbdAdvDisplay(r.defVal,r.pct,r.digits)}</span>
      <span class="edge-label">${esc(edgeLabel)}</span>
    </div>`;
  }).join("");
  return `<div class="cfbd-matchup-pair">
    <div class="cfbd-matchup-pair-hdr">${esc(offName)} offense <span class="vs">vs</span> ${esc(defName)} defense</div>
    <div class="cfbd-matchup-row header"><span>Metric</span><span>${esc(offName)}</span><span>${esc(defName)}</span><span>Edge</span></div>
    ${body}
  </div>`;
}
// Havoc isn't an offense-vs-defense metric (offense has no havoc stat of
// its own) -- it's compared directly between the two teams' DEFENSES: a
// higher havoc rate means a more disruptive defense, which is bad news for
// the OTHER team's offense, so this is shown as its own standalone row
// rather than folded into either cfbdMatchupPairHTML() call above.
function cfbdHavocRowHTML(awayName,awayTeam,homeName,homeTeam){
  const a=_ratingNum(awayTeam&&awayTeam.defense&&awayTeam.defense.havoc&&awayTeam.defense.havoc.total);
  const h=_ratingNum(homeTeam&&homeTeam.defense&&homeTeam.defense.havoc&&homeTeam.defense.havoc.total);
  if(a==null&&h==null) return "";
  const ac=(a!=null&&h!=null&&a>h)?" stronger":"";
  const hc=(a!=null&&h!=null&&h>a)?" stronger":"";
  let label="";
  if(a!=null&&h!=null){
    const diff=a-h;
    label=Math.abs(diff)<0.02?"Even":(diff>0?`${awayName} defensive edge`:`${homeName} defensive edge`);
  }
  return `<div class="cfbd-matchup-row cfbd-matchup-havoc">
    <span class="metric">Havoc rate (defense)</span>
    <span class="val${ac}">${_cfbdAdvDisplay(a,true,1)}</span>
    <span class="val${hc}">${_cfbdAdvDisplay(h,true,1)}</span>
    <span class="edge-label">${esc(label)}</span>
  </div>`;
}
function cfbdMatchupPanelHTML(g){
  if(!g) return "";
  if(!cfbdAdvanced.length){
    // Distinguish "never actually fetched yet" (cfbdAdvancedMeta is null --
    // stay silent, same as ratings before their own first load) from
    // "fetched successfully, CFBD genuinely has nothing yet" (say so).
    // Staying silent in the SECOND case is exactly what caused real
    // confusion: a real preseason request (year=2026, August, zero games
    // played) returns 200 with an empty list, not an error --
    // /stats/season/advanced computes CUMULATIVE season stats from games
    // actually played, and there's nothing to aggregate yet. See
    // api/fetch_cfbd.py's _handle_advanced() for the full story and the
    // matching server-side fix (an empty result used to be misread as an
    // upstream failure and thrown as a 502).
    if(!cfbdAdvancedMeta) return "";
    return `<div class="cfbd-matchup-panel">
      <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Context only — not part of Model #</span></div></div>
      <div class="cfbd-matchup-empty-note">Not available yet this season — CFBD computes these from games actually played, and none have been played yet.</div>
    </div>`;
  }
  const away=cfbdAdvancedForTeam(g.cfbdAwaySchool||g.away,g.cfbdAwayTeamId);
  const home=cfbdAdvancedForTeam(g.cfbdHomeSchool||g.home,g.cfbdHomeTeamId);
  if(!away&&!home) return "";
  const pair1=(away&&home)?cfbdMatchupPairHTML(g.away,away,g.home,home):"";
  const pair2=(away&&home)?cfbdMatchupPairHTML(g.home,home,g.away,away):"";
  const havocRow=(away&&home)?cfbdHavocRowHTML(g.away,away,g.home,home):"";
  if(!pair1&&!pair2&&!havocRow) return "";
  return `<div class="cfbd-matchup-panel">
    <div class="cfbd-ratings-head"><div><b>Matchup Intelligence</b><span class="cfbd-context-note">Context only — not part of Model #</span></div></div>
    ${pair1}${pair2}${havocRow}
  </div>`;
}
