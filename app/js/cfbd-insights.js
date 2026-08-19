// --- CFBD live scores + power-rating context -----------------------------
// Shared reference data only; never written into private PickGauge state.
// Uses canonical cfbdGameId/team IDs when available and falls back to the
// existing team matcher solely for legacy/unresolved rows.
const CFBD_SCOREBOARD_LOCAL_KEY="pickgauge_cfbd_scoreboard_v1";
const CFBD_RATINGS_LOCAL_PREFIX="pickgauge_cfbd_ratings_v1_";
let cfbdScoreboard=[];
let cfbdScoreboardMeta=null;
let cfbdRatings=[];
let cfbdRatingsMeta=null;
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
function initCfbdInsights(){
  loadCfbdInsightsLocal();
  // First paint never waits on CFBD. Scoreboard refreshes often; ratings are
  // server-cached for six hours and fetched only at startup/season change.
  fetchCfbdScoreboard(false);
  fetchCfbdRatings(currentCfbdSeason(),false);
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
