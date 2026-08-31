// PickGauge -> Survivor shared-data adapter.
// Uses PickGauge's already-loaded canonical CFBD season schedule, ratings and
// scoreboard. It does NOT call the standalone Survivor API and does not own a
// second CFBD cache/fetch pipeline.

const PG_SURVIVOR_EXPECTED_GAMES={sec:106,bigten:122,kelly:321};
const PG_SURVIVOR_HFA=2.6;        // align with PickGauge's existing CFBD-derived home-field convention
const PG_SURVIVOR_MARGIN_SD=16.0; // preserve current Survivor behavior during merge

// Rare, verified upstream-source omissions. These do NOT change the
// authoritative Splash schedule; they only keep a real listed game in the
// merged board when PickGauge's canonical CFBD season payload is missing it.
// A real CFBD game always wins automatically if it later appears.
const PG_SURVIVOR_UPSTREAM_SCHEDULE_SUPPLEMENTS=[
  {
    poolId:'bigten',season:2026,week:1,
    awayTeam:'UMass',homeTeam:'Rutgers',
    startDate:'2026-09-03T22:00:00Z',neutralSite:false,
    provenance:'Splash schedule + official Rutgers/UMass schedules; CFBD season game missing as of 2026-08-31'
  }
];
let pgSurvivorCandidateGames=[];

const PG_SURVIVOR_ENRICHMENT_KEY='pickgauge_survivor_enrichment_v1_';
const pgSurvivorEnrichment={year:null,fetchedAt:null,wpByGame:new Map(),lineByGame:new Map(),status:'idle',warning:null};

function pgsFirst(obj,...keys){for(const k of keys){if(obj&&obj[k]!==undefined&&obj[k]!==null)return obj[k];}return null;}
function pgsGameId(row){return pgsFirst(row,'gameId','game_id','id');}
function pgsNormalizeWpRow(row){
  const gameId=pgsGameId(row); if(gameId===null)return null;
  const homeP=pgsFinite(pgsFirst(row,'homeWinProbability','home_win_probability','homeWinProb','home_win_prob'));
  if(homeP===null||homeP<0||homeP>1)return null;
  return {gameId:String(gameId),homeWinProbability:homeP,spread:pgsFinite(pgsFirst(row,'spread')),week:pgsFinite(pgsFirst(row,'week'))};
}
function pgsPreferredLine(lines){
  if(!Array.isArray(lines)||!lines.length)return null;
  const valid=lines.filter(x=>pgsFinite(pgsFirst(x,'spread'))!==null);
  if(!valid.length)return null;
  return valid.find(x=>String(pgsFirst(x,'provider')||'').toLowerCase()==='consensus')||valid[0];
}
function pgsNormalizeLineRow(row){
  const gameId=pgsGameId(row); if(gameId===null)return null;
  const preferred=pgsPreferredLine(Array.isArray(row?.lines)?row.lines:[]);
  const spread=preferred?pgsFinite(pgsFirst(preferred,'spread')):pgsFinite(pgsFirst(row,'spread'));
  if(spread===null)return null;
  return {gameId:String(gameId),homeSpread:spread,provider:String(pgsFirst(preferred,'provider')||pgsFirst(row,'provider')||'CFBD'),week:pgsFinite(pgsFirst(row,'week'))};
}
function pgsReadEnrichmentPayload(payload,year=2026){
  const wpRows=payload?.pregame||payload?.pregameWp||payload?.winProbabilities||payload?.wp||[];
  const lineRows=payload?.lines||payload?.bettingLines||[];
  const wpByGame=new Map(),lineByGame=new Map();
  (Array.isArray(wpRows)?wpRows:[]).map(pgsNormalizeWpRow).filter(Boolean).forEach(r=>wpByGame.set(r.gameId,r));
  (Array.isArray(lineRows)?lineRows:[]).map(pgsNormalizeLineRow).filter(Boolean).forEach(r=>lineByGame.set(r.gameId,r));
  pgSurvivorEnrichment.year=Number(payload?.year)||Number(year)||2026;
  pgSurvivorEnrichment.fetchedAt=payload?.fetchedAt||payload?.generatedAt||new Date().toISOString();
  pgSurvivorEnrichment.wpByGame=wpByGame;pgSurvivorEnrichment.lineByGame=lineByGame;
  const unavailable=Array.isArray(payload?.unavailable)?payload.unavailable.filter(Boolean):[];
  pgSurvivorEnrichment.status=unavailable.length?'degraded':'ready';
  pgSurvivorEnrichment.warning=unavailable.length?`CFBD ${unavailable.join(' + ')} enrichment unavailable; using remaining sources.`:null;
  return pgSurvivorEnrichment;
}
function pgsLoadEnrichmentLocal(year=2026){
  try{
    const raw=JSON.parse(localStorage.getItem(PG_SURVIVOR_ENRICHMENT_KEY+year)||'null');
    if(!raw||typeof raw!=='object')return false;
    pgsReadEnrichmentPayload(raw,year); return true;
  }catch(e){return false;}
}
function pgsSaveEnrichmentLocal(payload,year=2026){try{localStorage.setItem(PG_SURVIVOR_ENRICHMENT_KEY+year,JSON.stringify(payload));}catch(e){}}
async function pgsEnsureSeasonEnrichment(year=2026,force=false){
  year=Number(year)||2026;
  if(!force&&pgSurvivorEnrichment.status==='ready'&&pgSurvivorEnrichment.year===year)return pgSurvivorEnrichment;
  if(!force&&pgsLoadEnrichmentLocal(year)){
    const age=Date.now()-Date.parse(pgSurvivorEnrichment.fetchedAt||'');
    if(Number.isFinite(age)&&age<30*60*1000)return pgSurvivorEnrichment;
  }
  pgSurvivorEnrichment.status='loading';
  try{
    if(typeof apiFetch!=='function')throw new Error('PickGauge API client unavailable.');
    const result=await apiFetch(`/api/fetch_cfbd?view=survivor&year=${encodeURIComponent(year)}${force?'&force=1':''}`,{});
    if(!result?.ok)throw new Error(result?.error||`Survivor enrichment unavailable (${result?.status||'request failed'}).`);
    const payload=result.body||{}; pgsReadEnrichmentPayload(payload,year); pgsSaveEnrichmentLocal(payload,year); return pgSurvivorEnrichment;
  }catch(err){
    pgSurvivorEnrichment.status='degraded';pgSurvivorEnrichment.warning=err?.message||String(err);
    return pgSurvivorEnrichment;
  }
}
function pgsDirectWpForCanonical(cg){return cg?pgSurvivorEnrichment.wpByGame.get(String(cg.id))||null:null;}
function pgsSeasonLineForCanonical(cg){return cg?pgSurvivorEnrichment.lineByGame.get(String(cg.id))||null:null;}

function pgsFinite(v){
  if(v===null||v===undefined||v===''||typeof v==='boolean') return null;
  const n=Number(v); return Number.isFinite(n)?n:null;
}
function pgsClamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function pgsErf(x){
  const sign=x<0?-1:1, a=Math.abs(x);
  const t=1/(1+0.3275911*a);
  const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-0.284496736)*t+0.254829592)*t*Math.exp(-a*a);
  return sign*y;
}
function pgsNormalCdf(z){return 0.5*(1+pgsErf(z/Math.SQRT2));}
function pgsSpreadText(v){
  const n=pgsFinite(v); if(n===null) return '—';
  if(Math.abs(n)<0.05) return 'PK';
  const r=Math.round(n*2)/2;
  return `${r>0?'+':''}${Number.isInteger(r)?r:r.toFixed(1)}`;
}
function pgsSpProbabilityForSide(teamRating,oppRating,isHome,isNeutral){
  const tr=pgsFinite(teamRating), or=pgsFinite(oppRating);
  if(tr===null||or===null) return null;
  const hfa=isNeutral?0:(isHome?PG_SURVIVOR_HFA:-PG_SURVIVOR_HFA);
  const projectedMargin=(tr-or)+hfa;
  return pgsClamp(pgsNormalCdf(projectedMargin/PG_SURVIVOR_MARGIN_SD),0.01,0.99);
}
function pgsSyntheticGameId(s){
  const slug=v=>String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return `splash-${slug(s.poolId)}-${Number(s.season)||2026}-w${Number(s.week)||0}-${slug(s.awayTeam)}-${slug(s.homeTeam)}`;
}
function pgsHasCanonicalPair(poolId,s){
  return (cfbdGames||[]).some(g=>Number(g.season)===Number(s.season) && Number(g.week)===Number(s.week) &&
    teamMatch(g.awayTeam,s.awayTeam) && teamMatch(g.homeTeam,s.homeTeam));
}
function pgsSupplementCanonicalGame(s){
  const awayRow=typeof cfbdTeamForName==='function'?cfbdTeamForName(s.awayTeam):null;
  const homeRow=typeof cfbdTeamForName==='function'?cfbdTeamForName(s.homeTeam):null;
  return {
    id:pgsSyntheticGameId(s),season:Number(s.season)||2026,week:Number(s.week),seasonType:'regular',
    startDate:s.startDate||null,neutralSite:s.neutralSite===true,completed:false,
    awayId:awayRow?.id??null,homeId:homeRow?.id??null,
    awayTeam:s.awayTeam,homeTeam:s.homeTeam,
    awayConference:awayRow?.conference||null,homeConference:homeRow?.conference||null,
    awayClassification:awayRow?.classification||null,homeClassification:homeRow?.classification||null,
    homePoints:null,awayPoints:null,
    syntheticScheduleFallback:true,canonicalCfbdMatched:false,provenance:s.provenance||'Authoritative schedule fallback'
  };
}
function pgsCandidateCanonicalGames(poolId,season=2026){
  const real=(cfbdGames||[]).filter(g=>Number(g.season)===Number(season));
  const extras=PG_SURVIVOR_UPSTREAM_SCHEDULE_SUPPLEMENTS
    .filter(s=>s.poolId===poolId&&Number(s.season)===Number(season)&&!pgsHasCanonicalPair(poolId,s))
    .map(pgsSupplementCanonicalGame);
  pgSurvivorCandidateGames=[...real,...extras];
  return pgSurvivorCandidateGames;
}
function pgsCanonicalGameToCfbd(cg){
  if(!cg) return null;
  return {
    id:cg.id, season:cg.season, week:cg.week,
    season_type:cg.seasonType||'regular', seasonType:cg.seasonType||'regular',
    start_date:cg.startDate||null, startDate:cg.startDate||null,
    home_id:cg.homeId, homeId:cg.homeId,
    away_id:cg.awayId, awayId:cg.awayId,
    home_team:cg.homeTeam, homeTeam:cg.homeTeam,
    away_team:cg.awayTeam, awayTeam:cg.awayTeam,
    home_conference:cg.homeConference||null, homeConference:cg.homeConference||null,
    away_conference:cg.awayConference||null, awayConference:cg.awayConference||null,
    home_classification:cg.homeClassification||null, homeClassification:cg.homeClassification||null,
    away_classification:cg.awayClassification||null, awayClassification:cg.awayClassification||null,
    neutral_site:cg.neutralSite===true, neutralSite:cg.neutralSite===true,
    completed:cg.completed===true,
    home_points:pgsFinite(cg.homePoints), homePoints:pgsFinite(cg.homePoints),
    away_points:pgsFinite(cg.awayPoints), awayPoints:pgsFinite(cg.awayPoints),
    syntheticScheduleFallback:cg.syntheticScheduleFallback===true,
    canonicalCfbdMatched:cg.syntheticScheduleFallback===true?false:true,
    provenance:cg.provenance||null,
  };
}
function pgsScheduleModule(poolId){return window.PickGaugeSurvivorCore?.schedules?.[poolId]||null;}
function pgsScheduleManifest(poolId){return window.PickGaugeSurvivorCore?.manifest?.schedules?.[poolId]||null;}
function pgsApplyAuthoritativeSchedule(poolId,candidates,season=2026){
  const mod=pgsScheduleModule(poolId), meta=pgsScheduleManifest(poolId);
  if(!mod||!meta) throw new Error('Survivor core schedule module is not ready.');
  const fn=meta.applyExport&&mod[meta.applyExport];
  if(typeof fn!=='function') throw new Error(`Authoritative ${poolId} schedule applicator is unavailable.`);
  // The real applyXPoolSchedule(games, year) functions require the year to
  // resolve the pool's schedule; without it they treat the schedule as
  // unavailable and silently pass every candidate game through unfiltered
  // (authoritative:false). Always pass the season explicitly.
  const result=fn(candidates,season);
  if(Array.isArray(result)) return {games:result,missing:[]};
  if(!result||typeof result!=='object') throw new Error(`Authoritative ${poolId} matcher returned an unsupported shape.`);
  if(result.authoritative===false) throw new Error(`Authoritative ${poolId} schedule for ${season} is unavailable.`);
  const games=result.games||result.matchedGames||result.eligibleGames||result.matched||result.schedule||[];
  const missing=result.missing||result.unmatched||result.missingGames||[];
  if(!Array.isArray(games)) throw new Error(`Authoritative ${poolId} matcher did not return a game array.`);
  return {games,missing:Array.isArray(missing)?missing:[]};
}
function pgsGameField(g,...keys){for(const k of keys){if(g&&g[k]!==undefined&&g[k]!==null)return g[k];}return null;}
function pgsFindCanonicalGame(g){
  const source=pgSurvivorCandidateGames.length?pgSurvivorCandidateGames:(cfbdGames||[]);
  const id=pgsGameField(g,'id','gameId','game_id');
  if(id!==null){const exact=source.find(c=>String(c.id)===String(id));if(exact)return exact;}
  const home=pgsGameField(g,'homeTeam','home_team','home'), away=pgsGameField(g,'awayTeam','away_team','away');
  if(!home||!away) return null;
  const week=pgsFinite(pgsGameField(g,'week','cfbdWeek'));
  const candidates=source.filter(c=>teamMatch(home,c.homeTeam)&&teamMatch(away,c.awayTeam));
  if(candidates.length===1)return candidates[0];
  if(week!==null){const same=candidates.filter(c=>Number(c.week)===week);if(same.length===1)return same[0];}
  return null;
}
function pgsScoreboardGame(cg){
  if(!cg) return null;
  if(typeof cfbdScoreboardGameFor==='function') return cfbdScoreboardGameFor({cfbdGameId:cg.syntheticScheduleFallback?null:cg.id,away:cg.awayTeam,home:cg.homeTeam});
  return (cfbdScoreboard||[]).find(g=>
    (!cg.syntheticScheduleFallback&&String(g.id)===String(cg.id)) ||
    (g?.awayTeam?.name&&g?.homeTeam?.name&&teamMatch(g.awayTeam.name,cg.awayTeam)&&teamMatch(g.homeTeam.name,cg.homeTeam))
  )||null;
}
function pgsRating(teamName,teamId){
  if(typeof cfbdRatingForTeam==='function') return cfbdRatingForTeam(teamName,teamId);
  return (cfbdRatings||[]).find(r=>r&&r.team&&teamMatch(teamName,r.team))||null;
}
function pgsLiveLineForCanonical(cg){
  if(!cg||typeof games==='undefined'||!Array.isArray(games)) return null;
  const bg=games.find(g=>String(g.cfbdGameId||'')===String(cg.id)) || games.find(g=>teamMatch(g.away,cg.awayTeam)&&teamMatch(g.home,cg.homeTeam));
  if(!bg||pgsFinite(bg.vegas)===null) return null;
  return pgsFinite(bg.vegas); // home-team perspective, matching PickGauge convention
}
function pgsSelectableSide(cg,listedWeek,teamIsHome,poolId){
  const team=teamIsHome?cg.homeTeam:cg.awayTeam;
  const opponent=teamIsHome?cg.awayTeam:cg.homeTeam;
  const teamId=teamIsHome?cg.homeId:cg.awayId;
  const oppId=teamIsHome?cg.awayId:cg.homeId;
  const tr=pgsRating(team,teamId), or=pgsRating(opponent,oppId);
  const spTeam=tr?.sp?.rating, spOpp=or?.sp?.rating;
  const spP=pgsSpProbabilityForSide(spTeam,spOpp,teamIsHome,cg.neutralSite===true);
  const direct=pgsDirectWpForCanonical(cg);
  const directP=direct?pgsClamp(teamIsHome?direct.homeWinProbability:1-direct.homeWinProbability,0.01,0.99):null;
  const seasonLine=pgsSeasonLineForCanonical(cg);
  const enrichedHomeLine=seasonLine?seasonLine.homeSpread:null;
  const liveHomeLine=pgsLiveLineForCanonical(cg);
  const homeLine=enrichedHomeLine!==null&&enrichedHomeLine!==undefined?enrichedHomeLine:liveHomeLine;
  const sideLine=homeLine===null?null:(teamIsHome?homeLine:-homeLine);
  const lineP=sideLine===null?null:pgsClamp(pgsNormalCdf((-sideLine)/PG_SURVIVOR_MARGIN_SD),0.01,0.99);
  const p=directP!==null?directP:spP!==null?spP:lineP;
  const sourceShort=directP!==null?'WP':spP!==null?'SP+':lineP!==null?'Line':'—';
  const source=directP!==null?'CFBD Pregame WP via PickGauge shared CFBD':spP!==null?'SP+ derived from PickGauge shared ratings':lineP!==null?'Line-derived from PickGauge shared CFBD/odds':null;
  const live=pgsScoreboardGame(cg);
  const hp=pgsFinite(live?.homeTeam?.points ?? cg.homePoints), ap=pgsFinite(live?.awayTeam?.points ?? cg.awayPoints);
  const completed=(live?.status==='completed')||cg.completed===true;
  const teamPts=teamIsHome?hp:ap, oppPts=teamIsHome?ap:hp;
  const conf=poolId==='sec'?'SEC':poolId==='bigten'?'Big Ten':null;
  const teamConference=teamIsHome?cg.homeConference:cg.awayConference;
  return {
    gameId:cg.id, season:cg.season, week:Number(listedWeek),
    team, opponent, isHome:teamIsHome, isNeutral:cg.neutralSite===true,
    isConferenceMember:conf?String(teamConference||'').toLowerCase().replace(/[^a-z0-9]/g,'').includes(conf.toLowerCase().replace(/[^a-z0-9]/g,'')):null,
    startDate:cg.startDate||null, completed,
    teamPoints:teamPts, opponentPoints:oppPts,
    winProbability:p,
    probabilitySource:source,
    probabilitySourceShort:sourceShort,
    spreadValue:sideLine,
    spread:pgsSpreadText(sideLine),
    cfbdHomeTeamId:cg.homeId, cfbdAwayTeamId:cg.awayId,
    cfbdTeamId:teamId, cfbdOpponentId:oppId,
    canonicalCfbdMatched:cg.syntheticScheduleFallback!==true,
    scheduleFallback:cg.syntheticScheduleFallback===true,
    scheduleProvenance:cg.provenance||null,
  };
}
function pgsListedWeek(g,cg){
  const w=pgsFinite(pgsGameField(g,'poolWeek','pool_week','week'));
  return w===null?Number(cg.week):Number(w);
}
function refreshPickGaugeSurvivorResults(data){
  if(!data||!Array.isArray(data.matchups)) return data;
  for(const m of data.matchups){
    const source=pgSurvivorCandidateGames.length?pgSurvivorCandidateGames:(cfbdGames||[]);
    const cg=source.find(g=>String(g.id)===String(m.gameId));
    if(!cg) continue;
    const live=pgsScoreboardGame(cg);
    const hp=pgsFinite(live?.homeTeam?.points ?? cg.homePoints), ap=pgsFinite(live?.awayTeam?.points ?? cg.awayPoints);
    m.completed=(live?.status==='completed')||cg.completed===true;
    m.teamPoints=m.isHome?hp:ap;
    m.opponentPoints=m.isHome?ap:hp;
  }
  return data;
}

function buildPickGaugeSurvivorData(poolId){
  if(!window.PickGaugeSurvivorCore) throw new Error('Survivor core is still loading.');
  if(typeof cfbdGames==='undefined'||!Array.isArray(cfbdGames)||!cfbdGames.length) throw new Error('PickGauge season schedule is still loading.');
  if(typeof cfbdRatings==='undefined'||!Array.isArray(cfbdRatings)||!cfbdRatings.length) throw new Error('PickGauge SP+ ratings are still loading.');
  const candidateCanonicals=pgsCandidateCanonicalGames(poolId,2026);
  const candidates=candidateCanonicals.map(pgsCanonicalGameToCfbd).filter(Boolean);
  const applied=pgsApplyAuthoritativeSchedule(poolId,candidates,2026);
  const seen=new Set(), matchups=[], canonicalGames=[];
  for(const listed of applied.games){
    const cg=pgsFindCanonicalGame(listed); if(!cg) continue;
    const week=pgsListedWeek(listed,cg);
    const k=String(cg.id); if(seen.has(k)) continue; seen.add(k); canonicalGames.push({cg,week});
    matchups.push(pgsSelectableSide(cg,week,false,poolId),pgsSelectableSide(cg,week,true,poolId));
  }
  const expected=PG_SURVIVOR_EXPECTED_GAMES[poolId]||canonicalGames.length;
  const authoritativeMatched=canonicalGames.length;
  const fallbackGames=canonicalGames.filter(({cg})=>cg.syntheticScheduleFallback===true);
  const canonicalMatched=canonicalGames.length-fallbackGames.length;
  const modeled=matchups.filter(m=>m.winProbability!==null).length;
  const bySource={WP:0,'SP+':0,Line:0,Missing:0};
  matchups.forEach(m=>{const k=m.probabilitySourceShort||'—';if(k==='WP')bySource.WP++;else if(k==='SP+')bySource['SP+']++;else if(k==='Line')bySource.Line++;else bySource.Missing++;});
  const lineGames=canonicalGames.filter(({cg})=>!!pgsSeasonLineForCanonical(cg)||pgsLiveLineForCanonical(cg)!==null).length;
  const weeks=[...new Set(matchups.map(m=>m.week))].sort((a,b)=>a-b);
  return {
    poolId, season:2026, weeks, matchups,
    schedule:{
      matched:authoritativeMatched,expected,missing:applied.missing,
      authoritativeComplete:authoritativeMatched===expected&&applied.missing.length===0,
      canonicalMatched,canonicalExpected:expected,
      upstreamFallbackCount:fallbackGames.length,
      upstreamFallbacks:fallbackGames.map(({cg,week})=>({gameId:cg.id,week,awayTeam:cg.awayTeam,homeTeam:cg.homeTeam,provenance:cg.provenance||null}))
    },
    probability:{modeled,total:matchups.length,bySource},
    bettingLines:{gamesWithLine:lineGames,totalGames:canonicalGames.length},
    enrichment:{status:pgSurvivorEnrichment.status,warning:pgSurvivorEnrichment.warning,fetchedAt:pgSurvivorEnrichment.fetchedAt},
    generatedAt:new Date().toISOString(),
    dataSource:'PickGauge shared CFBD identity + Pregame WP + ratings + lines + scoreboard',
  };
}
