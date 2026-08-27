// --- Team-name matching, logos, PDF import, predictions merge ------------
// Split out of app/index.html as part of the JS-splitting pass. NOTE: like
// board.js, this file is broader than its banner name ("Powers PDF
// import") suggests -- it also contains teamMatch() itself, the core
// token-based team-name matcher used throughout the app (grading, logo
// matching, prediction-tracker matching, PDF matching all share this ONE
// matcher rather than each having their own cruder comparison), plus team
// logo fetching/matching. They were never actually separate sections in
// the source. Covers:
//   - teamMatch() and its helpers (teamTokens/aliasOf/prefixOk/
//     SIGNIFICANT_TOKENS/findBoardGame) -- token-based matching so
//     "Wisconsin" (Powers PDF) correctly matches "Wisconsin Badgers" (The
//     Odds API) without a hand-maintained, inevitably-incomplete mascot
//     list.
//   - Team logos (applyTeamLogos()/fetchTeamLogos()) -- reuses teamMatch()
//     rather than a second, cruder matcher, since a silently WRONG logo is
//     worse than no logo.
//   - applyPdfData() -- merges parsed Powers newsletter numbers (BP/Comp/
//     home Vegas line) onto the current board by team match.
//   - applyPredictions() -- same idea for thepredictiontracker.com rows,
//     rebuilt on every board change so it never goes stale when an odds
//     refresh renames the board's keys.
//   - renderUnmatched() -- surfaces PDF rows that didn't match any board
//     game, rather than silently dropping them.
//   - importPowers() -- the actual PDF upload -> parse -> merge flow (POSTs
//     to /api/parse_pdf, a Vercel Python function running pdfplumber,
//     since the newsletter's subset-embedded Impact font is unreadable by
//     pdf.js in-browser).
//
// IMPORTANT: api/grade_picks.py keeps its OWN separate Python copy of team
// matching (its own TEAM_ALIAS + team_match()), manually kept in sync with
// THIS file's teamMatch()/TEAM_ALIAS -- no automated drift check exists
// for that pairing (unlike the api/*.py auth-code duplication, which does
// have one via tests/test_auth_sync.py). If you change matching behavior
// here, check api/grade_picks.py too.
//
// Loaded as a plain <script src="/app/js/pdf-import.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `TEAM_ALIAS` -- app/data/team-alias.js.
//   - `state`, `games`, `isDemo`, `demoInputs`, `teamLogos`, `logosMeta`,
//     `predByKey` -- global app state and module-level variables (main
//     inline script).
//   - `mkey()`/`esc()`/`fmt()`/`round1()`/`normTracker()` -- general
//     utilities (main inline script).
//   - `inputsFor()` -- BP/Comp input accessor (main inline script).
//   - `teamMatchTrunc()` -- truncated-name matching for the prediction
//     tracker's own naming dialect (main inline script).
//   - `apiFetch()` -- classified fetch wrapper (app/js/api-client.js).
//   - `save()`/`saveLogosLocal()` -- persistence (main inline script).
//   - `sortGames()`/`renderBoard()` -- app/js/board.js.
// PDF is sent to /api/parse-pdf (Vercel serverless function running pdfplumber).
// The Powers newsletter uses subset-embedded Impact font — unreadable by pdf.js
// in-browser, so we parse server-side and return clean JSON.

// Team-name matching. Two data sources name teams differently ("Wisconsin"
// from the Powers PDF vs "Wisconsin Badgers" from The Odds API), so matching
// works on TOKENS rather than a smashed string plus a hand-maintained mascot
// list (that list could never be complete -- "Kent State Golden Flashes" broke
// it). Rule: one name's tokens must prefix the other's, and whatever is left
// over must not contain a token that changes school identity.
// TEAM_ALIAS now lives in app/data/team-alias.js (loaded via <script> above) -- see that file for the full alias table and the sync note with api/grade_picks.py.
// If any of these survive in the leftover tokens it's a DIFFERENT school
// (Ohio vs Ohio State, Louisiana vs Louisiana Tech), not just a mascot.
const SIGNIFICANT_TOKENS=new Set(['state','st','tech','am','southern','northern','eastern','western','central','international','atlantic','ohio','oh','monroe','lafayette','birmingham',
  // Found via collision-testing against real CFBD alternateNames data: without
  // these, "Texas" wrongly matched "Texas-El Paso"/"Texas-San Antonio"/"Texas
  // Christian", "Nevada" wrongly matched "Nevada-Las Vegas", and "Florida"
  // wrongly matched "Florida Intl" -- all real CFBD-documented alt names, not
  // hypothetical inputs.
  'christian','intl','las','vegas','el','paso','san','antonio']);

function teamTokens(s){
  return (s||'').toLowerCase().replace(/&/g,'').replace(/[^a-z0-9]+/g,' ')
    .trim().split(/\s+/).filter(Boolean);
}
function aliasOf(toks){ return TEAM_ALIAS[toks.join('')]||null; }
// Compare one name's smashed form against progressive leading runs of the
// other's tokens. This covers exact equality, token-prefix ("Wisconsin" vs
// "Wisconsin Badgers"), AND already-smashed stored keys ("kentstate" vs
// "Kent State Golden Flashes") -- game keys have spaces stripped, so token
// boundaries are gone on one side.
function prefixOk(whole,toks){
  const w=whole.join('');
  for(let i=1;i<=toks.length;i++){
    if(toks.slice(0,i).join('')===w)
      return !toks.slice(i).some(t=>SIGNIFICANT_TOKENS.has(t));
  }
  return false;
}
function teamMatch(a,b){
  const A=teamTokens(a), B=teamTokens(b);
  if(!A.length||!B.length) return false;
  const aa=aliasOf(A), ba=aliasOf(B);
  if(aa&&ba) return aa===ba;
  if(aa||ba){
    const target=aa||ba, other=aa?B:A;
    for(let i=1;i<=other.length;i++){
      const pre=other.slice(0,i);
      if((aliasOf(pre)||pre.join(''))===target)
        return !other.slice(i).some(t=>SIGNIFICANT_TOKENS.has(t));
    }
    return false;
  }
  return prefixOk(A,B)||prefixOk(B,A);
}
function findBoardGame(away,home){
  // BOTH teams must match. A home-only fallback used to live here, but it let a
  // stale PDF game bleed its BP/Comp onto a different opponent that shared the
  // same home team (e.g. a Week 9 "California @ Virginia Tech" filling a Week 1
  // "VMI @ Virginia Tech"). Same home team is NOT the same game.
  return games.find(g=>teamMatch(away,g.away)&&teamMatch(home,g.home)) || null;
}

// --- CFBD canonical identity + team logos -------------------------------
// The old logo-only fetch has grown into PickGauge's canonical identity
// layer. Names still remain the display/fallback path because external pool,
// prediction and odds feeds do not carry CFBD IDs, but once a runtime game is
// resolved here every downstream pick can store stable CFBD identifiers.
function cfbdTeamForName(name){
  if(!name||!teamLogos.length) return null;
  return teamLogos.find(t=>{
    if(!t||!t.school) return false;
    if(teamMatchTrunc(name,t.school)) return true;
    if(t.abbreviation&&teamMatchTrunc(name,t.abbreviation)) return true;
    return (t.alternateNames||[]).some(a=>a&&teamMatchTrunc(name,a));
  })||null;
}
function _cfbdGameNameMatch(g,c){
  return !!(g&&c&&teamMatchTrunc(g.away,c.awayTeam)&&teamMatchTrunc(g.home,c.homeTeam));
}
function findCfbdGame(g){
  if(!g||!cfbdGames.length) return null;
  if(g.cfbdGameId!=null){
    const exact=cfbdGames.find(c=>String(c.id)===String(g.cfbdGameId));
    if(exact) return exact;
  }

  let candidates=[];
  if(g.cfbdHomeTeamId!=null&&g.cfbdAwayTeamId!=null){
    candidates=cfbdGames.filter(c=>String(c.homeId)===String(g.cfbdHomeTeamId)&&String(c.awayId)===String(g.cfbdAwayTeamId));
  }
  if(!candidates.length) candidates=cfbdGames.filter(c=>_cfbdGameNameMatch(g,c));
  if(!candidates.length) return null;
  if(candidates.length===1) return candidates[0];

  // Rematches in one season are uncommon but possible. A kickoff timestamp is
  // the strongest discriminator; if there isn't one, prefer the current CFB
  // week only when that leaves a single candidate. Never guess between two
  // unresolved same-team games just to populate an ID.
  if(g.commence){
    const t=Date.parse(g.commence);
    if(!isNaN(t)){
      const ranked=candidates.map(c=>({c,d:Math.abs(Date.parse(c.startDate||"")-t)}))
        .filter(x=>!isNaN(x.d)).sort((a,b)=>a.d-b.d);
      if(ranked.length&&ranked[0].d<=4*24*60*60*1000) return ranked[0].c;
    }
  }
  const wi=(typeof currentWeekIndex==="function")?currentWeekIndex():null;
  if(wi!=null){
    const sameWeek=candidates.filter(c=>Number(c.week)===Number(wi));
    if(sameWeek.length===1) return sameWeek[0];
  }
  return null;
}
function applyCfbdIdentityToGame(g){
  if(!g) return false;
  let changed=false;
  const homeTeam=cfbdTeamForName(g.home), awayTeam=cfbdTeamForName(g.away);
  if(homeTeam&&g.cfbdHomeTeamId==null){ g.cfbdHomeTeamId=homeTeam.id; changed=true; }
  if(awayTeam&&g.cfbdAwayTeamId==null){ g.cfbdAwayTeamId=awayTeam.id; changed=true; }

  const cg=findCfbdGame(g);
  if(cg){
    const values={
      cfbdGameId:cg.id,
      cfbdSeason:cg.season,
      cfbdWeek:cg.week,
      cfbdSeasonType:cg.seasonType||null,
      cfbdStartDate:cg.startDate||null,
      cfbdHomeTeamId:cg.homeId,
      cfbdAwayTeamId:cg.awayId,
      cfbdHomeSchool:cg.homeTeam,
      cfbdAwaySchool:cg.awayTeam,
      cfbdHomeConference:cg.homeConference||null,
      cfbdAwayConference:cg.awayConference||null,
      cfbdHomeClassification:cg.homeClassification||null,
      cfbdAwayClassification:cg.awayClassification||null,
      // Real HFA bug fix: only a matched canonical CFBD game actually carries
      // a trustworthy neutralSite flag. If findCfbdGame() can't match this
      // game at all (see the `else` branch below), cfbdNeutralSite is
      // deliberately left unset -- cfbdDerivedSpread() treats that as "true
      // home game" (current 2.6 behavior), the same safe default it always
      // had, rather than guessing.
      cfbdNeutralSite:!!cg.neutralSite,
    };
    Object.entries(values).forEach(([k,v])=>{ if(g[k]!==v){ g[k]=v; changed=true; } });
  }else{
    if(homeTeam){
      if(!g.cfbdHomeSchool){ g.cfbdHomeSchool=homeTeam.school; changed=true; }
      if(g.cfbdHomeConference==null&&homeTeam.conference!=null){ g.cfbdHomeConference=homeTeam.conference; changed=true; }
    }
    if(awayTeam){
      if(!g.cfbdAwaySchool){ g.cfbdAwaySchool=awayTeam.school; changed=true; }
      if(g.cfbdAwayConference==null&&awayTeam.conference!=null){ g.cfbdAwayConference=awayTeam.conference; changed=true; }
    }
  }

  // Logos stay cosmetic and are sourced from the team directory rather than
  // the schedule, which intentionally keeps only identity/schedule fields.
  const homeLogoRow=homeTeam||(g.cfbdHomeTeamId!=null?teamLogos.find(t=>String(t.id)===String(g.cfbdHomeTeamId)):null);
  const awayLogoRow=awayTeam||(g.cfbdAwayTeamId!=null?teamLogos.find(t=>String(t.id)===String(g.cfbdAwayTeamId)):null);
  if(g.homeLogo===undefined) g.homeLogo=homeLogoRow&&homeLogoRow.logo?homeLogoRow.logo:null;
  if(g.awayLogo===undefined) g.awayLogo=awayLogoRow&&awayLogoRow.logo?awayLogoRow.logo:null;
  return changed;
}
function cfbdPickIdentity(g,side){
  if(!g) return {};
  applyCfbdIdentityToGame(g);
  return {
    cfbdGameId:g.cfbdGameId!=null?g.cfbdGameId:null,
    cfbdSeason:g.cfbdSeason!=null?g.cfbdSeason:null,
    cfbdWeek:g.cfbdWeek!=null?g.cfbdWeek:null,
    cfbdSeasonType:g.cfbdSeasonType||null,
    cfbdStartDate:g.cfbdStartDate||null,
    cfbdHomeTeamId:g.cfbdHomeTeamId!=null?g.cfbdHomeTeamId:null,
    cfbdAwayTeamId:g.cfbdAwayTeamId!=null?g.cfbdAwayTeamId:null,
    cfbdPickedTeamId:side==="home"?(g.cfbdHomeTeamId!=null?g.cfbdHomeTeamId:null):(g.cfbdAwayTeamId!=null?g.cfbdAwayTeamId:null),
    cfbdHomeSchool:g.cfbdHomeSchool||null,
    cfbdAwaySchool:g.cfbdAwaySchool||null,
    cfbdHomeConference:g.cfbdHomeConference||null,
    cfbdAwayConference:g.cfbdAwayConference||null,
    // Frozen at pick time so a later re-match/rescheduled game (or the flag
    // simply not having existed on an older stored pick) can never retroactively
    // change which HFA a graded pick's SP+/CORE numbers were actually computed
    // with. See cfbdDerivedSpread() in cfbd-insights.js.
    cfbdNeutralSite:g.cfbdNeutralSite===true,
  };
}
function backfillActivePickIdentity(){
  let changed=0;
  const entryGroups=[state.entries||[],...(state.pools||[]).map(p=>p.entries||[])];
  entryGroups.forEach(entries=>entries.forEach(ent=>Object.values(ent.picks||{}).forEach(p=>{
    if(!p||p.cfbdGameId!=null||!p.matchup||!p.side) return;
    const parts=String(p.matchup).split(/\s+@\s+/); if(parts.length!==2) return;
    const tmp={away:parts[0],home:parts[1],commence:p.commence||null};
    applyCfbdIdentityToGame(tmp);
    if(tmp.cfbdGameId==null) return;
    Object.assign(p,cfbdPickIdentity(tmp,p.side)); changed++;
  })));
  return changed;
}

let lastLogoUnmatched=[];
function applyTeamLogos(){
  lastLogoUnmatched=[];
  if((!teamLogos.length&&!cfbdGames.length)||!games.length) return 0;
  let matched=0;
  games.forEach(g=>{
    applyCfbdIdentityToGame(g);
    if(g.awayLogo) matched++; else lastLogoUnmatched.push(g.away);
    if(g.homeLogo) matched++; else lastLogoUnmatched.push(g.home);
  });
  return matched;
}
// Identity is refreshed locally every 12 hours because kickoff times/week data
// can change; the server endpoint itself maintains a shared six-hour Redis
// cache, so many signed-in devices still cost only a small number of CFBD calls.
async function fetchTeamLogos(force){
  if(!force&&teamLogos.length&&cfbdGames.length&&logosMeta&&logosMeta.fetchedAt){
    const ageMs=Date.now()-new Date(logosMeta.fetchedAt).getTime();
    if(ageMs<12*60*60*1000) return false;
  }
  try{
    const result=await apiFetch('/api/fetch_teams?year='+encodeURIComponent(seasonYear()),{});
    const body=result.body||{};
    if(!result.ok||!Array.isArray(body.teams)||!body.teams.length||!Array.isArray(body.games)||!body.games.length){
      console.warn('CFBD identity: fetch failed or empty —',result.error||result.status);
      return false;
    }
    teamLogos=body.teams;
    cfbdGames=body.games;
    logosMeta={fetchedAt:body.fetchedAt||new Date().toISOString(),count:body.count,gameCount:body.gameCount,season:body.season,source:body.source||null};
    saveLogosLocal();
    applyTeamLogos();
    const backfilled=backfillActivePickIdentity();
    if(backfilled) save();
    return true;
  }catch(err){
    console.warn('CFBD identity: fetch error —',err);
    return false;
  }
}

let lastPdfUnmatched=[];
function applyPdfData(){
  lastPdfUnmatched=[];
  if(!state.pdfGames||!state.pdfGames.length) return 0;
  if(!state.lastGames||!state.lastGames.length){
    const built=state.pdfGames
      .filter(g=>g.homeVegas!=null||g.bp!=null||g.comp!=null)
      .map(g=>({away:g.away,home:g.home,commence:null,vegas:g.homeVegas,book:'PDF'}));
    if(built.length){ isDemo=false; games=built.map(g=>({...g,key:mkey(g.away,g.home)})); }
  }
  if(!games.length) return 0;
  let filled=0;
  state.pdfGames.forEach(g=>{
    if(g.bp==null&&g.comp==null&&g.homeVegas==null) return;
    let bg=games.find(x=>x.key===mkey(g.away,g.home))||findBoardGame(g.away,g.home);
    if(!bg){ lastPdfUnmatched.push(g); return; }
    if(bg.vegas==null&&g.homeVegas!=null) bg.vegas=g.homeVegas;
    if(g.bpSuspect) bg.bpSuspect=true;
    const arr=inputsFor(bg.key);
    if(g.bp!=null)   arr[0]=g.bp;
    if(g.comp!=null) arr[1]=g.comp;
    state.inputs[bg.key]=arr; filled++;
  });
  return filled;
}
// Match the raw tracker rows onto whatever keys the current board uses, exactly
// as applyPdfData does for the PDF. Rebuilt on every board change, so it never
// goes stale when an odds refresh renames the board's keys. Unmatched rows are
// counted + logged (same treatment as unmatched PDF games) rather than dropped.
let lastPredUnmatched=[];
// Recomputes predByKey["cfbdsp"]/["cfbdcore"] (if cfbd-insights.js and its
// ratings data are ready) and returns `matchedCount` unchanged -- the
// single exit point applyPredictions() below routes BOTH of its early
// returns and its normal completion through, so SP+/CORE stay in sync
// with the current board on every call site that already calls
// applyPredictions() (there are many -- week switches, pool switches, PDF
// imports, odds refreshes -- see that function's own callers), with zero
// risk of a call site forgetting to also call the CFBD-derived step
// separately. Also called on its own from _cfbdRenderConsumers()
// (app/js/cfbd-insights.js) for the case ratings arrive AFTER this
// already ran once.
function _finishApplyPredictions(matchedCount){
  if(typeof applyCfbdDerivedPredictions==="function") applyCfbdDerivedPredictions();
  return matchedCount;
}
function applyPredictions(){
  predByKey={}; lastPredUnmatched=[];
  if(!state.predictions||!state.predictions.length) return _finishApplyPredictions(0);
  // If no real board exists yet (no odds pull, no PDF board -> still on demo),
  // seed the board straight from the prediction feed. It carries home/road and
  // a market line, so it can stand up a full week on its own. Names are run
  // through normTracker so keys and the overlay below use one consistent form.
  if(isDemo){
    const built=state.predictions
      .filter(p=>p.homeVegas!=null||(p.systems&&Object.keys(p.systems).length))
      .map(p=>({away:normTracker(p.road),home:normTracker(p.home),commence:null,
                vegas:(p.homeVegas!=null?round1(p.homeVegas):null),book:"PRED"}));
    if(built.length){ isDemo=false; demoInputs={}; games=built.map(g=>({...g,key:mkey(g.away,g.home)})); }
  }
  if(!games.length) return _finishApplyPredictions(0);
  let matched=0;
  state.predictions.forEach(p=>{
    const road=normTracker(p.road), home=normTracker(p.home);
    const bg=games.find(x=>teamMatchTrunc(road,x.away)&&teamMatchTrunc(home,x.home))
          || games.find(x=>teamMatchTrunc(home,x.home)&&teamMatchTrunc(road,x.away));
    if(!bg){ lastPredUnmatched.push(p); return; }
    predByKey[bg.key]=p.systems||{};
    matched++;
  });
  if(lastPredUnmatched.length) console.warn("Prediction rows not matched to board:",lastPredUnmatched.map(p=>p.road+" @ "+p.home));
  return _finishApplyPredictions(matched);
}
function renderUnmatched(){
  const panel=document.getElementById("unmatchedPanel");
  const list=document.getElementById("unmatchedList");
  if(!panel||!list) return;
  if(!lastPdfUnmatched.length){ panel.style.display="none"; list.innerHTML=""; return; }
  panel.style.display="block";
  list.innerHTML=lastPdfUnmatched.map(g=>{
    const parts=[];
    if(g.bp!=null) parts.push(`BP ${fmt(g.bp)}`);
    if(g.comp!=null) parts.push(`Comp ${fmt(g.comp)}`);
    if(g.homeVegas!=null) parts.push(`Vegas ${fmt(g.homeVegas)}`);
    return `<div class="pl-row"><span class="pl-team">${esc(g.away)} @ ${esc(g.home)}</span><span class="pl-meta">${parts.join(" · ")||"no numbers parsed"}</span></div>`;
  }).join("");
}

async function importPowers(file){
  const st=document.getElementById('pdfStatus');
  st.style.color='var(--muted)'; st.textContent='parsing PDF…';
  try{
    const form=new FormData();
    form.append('pdf', file);
    const result=await apiFetch('/api/parse_pdf',{method:'POST',body:form});
    if(!result.ok) throw new Error(result.error);
    const parsed=result.body;
    if(!Array.isArray(parsed)||!parsed.length) throw new Error('No games returned');
    state.pdfGames=parsed; save();
    const filled=applyPdfData()||0;
    applyPredictions();
    save(); sortGames(); renderBoard();
    renderUnmatched();
    // Update header week label from first game's context (just show count)
    const wk=document.getElementById('wkLabel');
    if(wk) wk.textContent='CFB ATS';
    st.style.color=filled>0?'var(--green-text)':'var(--amber)';
    st.textContent=filled>0
      ? `loaded ${parsed.length} games · BP+Comp filled`
      : `parsed ${parsed.length} games — hit Refresh lines to see board`;
    if(typeof trackBetaEvent==='function') trackBetaEvent('powers_pdf_import',{source:'pdf'});
  }catch(err){
    st.style.color='var(--red-text)';
    st.textContent='PDF parse failed: '+err.message;
    console.error(err);
  }
}
