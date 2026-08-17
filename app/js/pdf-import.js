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
//   - `authHeaders()` -- Clerk-JWT auth header helper (main inline
//     script).
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

// --- Team logos ----------------------------------------------------------
// Reuses teamMatch() (above) rather than a second, cruder matcher -- logos
// are cosmetic, but a silently WRONG logo (mismatched team) is worse than no
// logo, so this deliberately shares the same matching rigor as BP/PDF/
// predictions matching instead of a quick smashed-string comparison.
let lastLogoUnmatched=[];
function applyTeamLogos(){
  lastLogoUnmatched=[];
  if(!teamLogos.length||!games.length) return 0;
  let matched=0;
  games.forEach(g=>{
    if(g.awayLogo===undefined){
      const m=teamLogos.find(t=>teamMatch(g.away,t.school));
      g.awayLogo=m?m.logo:null;
      if(m) matched++; else lastLogoUnmatched.push(g.away);
    }
    if(g.homeLogo===undefined){
      const m=teamLogos.find(t=>teamMatch(g.home,t.school));
      g.homeLogo=m?m.logo:null;
      if(m) matched++; else lastLogoUnmatched.push(g.home);
    }
  });
  return matched;
}
// Logos don't change mid-season, so this is a rare fetch (once per ~60 days
// per device), not a per-load call -- unlike predictions/odds, there's no
// "refresh" button for this; it's silent and non-blocking. A failure here
// (bad/missing CFBD key, network hiccup) just means no logos show up -- the
// board works exactly as before, nothing else depends on this succeeding.
async function fetchTeamLogos(force){
  if(!force&&teamLogos.length&&logosMeta&&logosMeta.fetchedAt){
    const ageMs=Date.now()-new Date(logosMeta.fetchedAt).getTime();
    if(ageMs<60*24*60*60*1000) return false;
  }
  try{
    const res=await fetch('/api/fetch_teams',{headers:await authHeaders()});
    const data=await res.json();
    if(!res.ok||!Array.isArray(data.teams)||!data.teams.length){
      console.warn('Team logos: fetch failed or empty —',data.error||data.message||res.status);
      return false;
    }
    teamLogos=data.teams;
    logosMeta={fetchedAt:new Date().toISOString(),count:data.count};
    saveLogosLocal();
    return true;
  }catch(err){
    console.warn('Team logos: fetch error —',err);
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
function applyPredictions(){
  predByKey={}; lastPredUnmatched=[];
  if(!state.predictions||!state.predictions.length) return 0;
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
  if(!games.length) return 0;
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
  return matched;
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
    const res=await fetch('/api/parse_pdf',{method:'POST',headers:await authHeaders(),body:form});
    if(!res.ok) throw new Error('Server error '+res.status);
    const parsed=await res.json();
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
  }catch(err){
    st.style.color='var(--red-text)';
    st.textContent='PDF parse failed: '+err.message;
    console.error(err);
  }
}
