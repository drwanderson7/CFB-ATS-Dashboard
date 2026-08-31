// --- Record / history ---------------------------------------------------
// Split out of app/index.html as part of the JS-splitting pass. Covers:
// archiving the current week's picks into history for grading
// (closeWeek()), undoing that (restoreWeek() -- puts a closed week back
// on the board for editing, added after archiving was originally a one-
// way trip), manual W/L/P grading (setResult()), and the Record tab's
// own render (renderRecord() -- running tally + per-week breakdown).
// sideOfArchived() is a small helper for restoreWeek(): older archived
// weeks didn't store `side` directly, so it's worked out from the
// matchup string on restore.
//
// Loaded as a plain <script src="/app/js/record.js"> tag, same as the
// other split files -- an ordinary global scope, not a module. Real
// external references this file makes that are NOT self-contained (all
// resolved lazily inside function bodies, never at top-level, so script
// load order relative to the rest of the page doesn't matter for
// correctness -- same reasoning as the other split files' header
// comments):
//   - `state`, `games` -- global app state and the current week's game
//     list (main inline script).
//   - `currentPool()`/`activeEntries()`/`activeHistory()` -- pool/entry
//     context accessors (main inline script).
//   - `teamMatch()`/`clvOf()` -- team-name matching and the shared
//     forPick CLV math (main inline script / app/js/model.js).
//   - `preKickRecordForPick()`/`resolvePreKickRecordLine()` -- the
//     server-captured last-pre-kick market history (app/js/odds.js).
//   - `uid()`/`esc()`/`fmt()` -- general utilities (main inline script).
//   - `save()`/`syncAll()` -- persistence (main inline script).
//   - `switchTab()` -- tab navigation (main inline script).
//   - `buildGames()`/`migrateGameKeys()`/`sortGames()` -- game-list
//     reconstruction after a restore (app/js/board.js / main inline
//     script).
//   - `fetchCfbdBoxScore()`/`cfbdPostgamePanelHTML()` -- the postgame
//     "why did this pick win or lose" box score (app/js/cfbd-insights.js).

// Which graded picks currently have their box-score panel expanded --
// keyed by "weekId|entryId|pickKey", kept OUTSIDE renderRecord() itself
// so a re-render (which fully rebuilds wrap.innerHTML) doesn't collapse
// panels the person just opened. Session-only by design, same as
// cfbdBoxScores' own in-memory cache -- there's no reason this needs to
// survive a page reload.
let recordExpandedBoxScores=new Set();

async function closeWeek(){
  const pool=currentPool();
  const ents=activeEntries();
  const hasPicks=ents.some(e=>Object.keys(e.picks).length);
  if(!hasPicks){
    await pgAlert({title:"Nothing to archive",message:"No picks yet this week — nothing to close out."});
    return;
  }
  const defLabel=pool?(pool.weekLabel||("Week "+(activeHistory().length+1))):("Week "+(state.history.length+1));
  const label=await pgPrompt({
    title:"Archive picks & start new week",
    message:"Choose the label that will appear in Results.",
    label:"Week label",
    value:defLabel,
    placeholder:'Week 9',
    confirmText:"Archive picks"
  });
  if(label===null) return;
  const snapshot=ents.map(e=>({
    entryId:e.id, name:e.name,
    picks:Object.entries(e.picks).map(([k,p])=>{
      const live=games.find(x=>x.key===k);
      const providerGameId=(live&&live.providerGameId)?live.providerGameId:(p.providerGameId||null);
      // `line` is what grading actually uses -- both the manual W/L/P
      // review in Results below AND api/grade_picks.py's automatic
      // grader (_grade_history() reads pk.get("line") directly) read
      // this field. It must ALWAYS be the line the person actually
      // picked against, never today's current market line. This used to
      // read liveLineFor(live,p.side) whenever a live-matched game still
      // existed, which silently corrupted BOTH the displayed number and
      // the automatic W/L/P grade whenever the market moved between
      // picking and archiving -- on Overall always (there's no locked
      // reference there), and even in a pool for a pick made PRE-LOCK,
      // whose provisional live-matched number gets replaced by the real
      // locked line by archive time (g.vegas becomes pg.line once
      // locked -- see buildGames()'s pool branch). Always using p.line
      // fixes both cases with one change, since p.line is exactly what
      // pickTeam() stored at the moment of the pick either way.
      //
      // closingLine/clv are research fields only -- grading NEVER reads
      // them. Crucially, closingLine now comes from the server-maintained
      // LAST PRE-KICK observation, not whatever the market happens to show
      // when the person presses Archive. Games can disappear from /odds
      // after kickoff, so preKickRecordForPick() looks in the separate
      // retained shared history and can still resolve the close even when
      // `live` is null. Use the same book/consensus preference that was
      // active when the pick was made (bookAtPick), so changing Settings
      // later cannot create fake CLV by comparing two different books.
      let closingLine=null, clv=null, closingLineBook=null, closingLineObservedAt=null;
      const preKick=preKickRecordForPick({...p,providerGameId},live);
      const closeMarket=resolvePreKickRecordLine(preKick,p.bookAtPick||state.book||"consensus");
      if(closeMarket && p.line!=null && p.side){
        const closingHomeLine=closeMarket.line;
        closingLine=p.side==="home"?closingHomeLine:-closingHomeLine;
        closingLineBook=closeMarket.book||null;
        closingLineObservedAt=closeMarket.observedAt||null;
        // Reuse the same tested forPick math the rest of the app already
        // trusts rather than re-deriving the sign convention here.
        const fakeG={lockedLine:(p.side==="home"?p.line:-p.line), liveVegas:closingHomeLine};
        const c=clvOf(fakeG,p.side);
        clv=c?c.forPick:null;
      }
      // Preserve every pick-time snapshot field verbatim. Only archive-time
      // research fields are added here. Null is deliberate if no real
      // pre-kick observation exists -- better unknown than fake precision.
      const identity=(live&&typeof cfbdPickIdentity==="function")?cfbdPickIdentity(live,p.side):{};
      return{ ...p, ...identity, key:k, matchup:p.matchup||k, team:p.team||"", side:p.side||null, line:p.line, closingLine, closingLineBook, closingLineObservedAt, clv, result:null, providerGameId };
    })
  }));
  const rec={ id:uid(), label:(label.trim()||defLabel), closedAt:new Date().toISOString(), entries:snapshot };
  if(pool) pool.history.unshift(rec); else state.history.unshift(rec);
  ents.forEach(e=>{ e.picks={}; delete e.submittedAt; });
  save();
  syncAll(); renderRecord();
  switchTab("record");
}
// Archived weeks lack `side` if they were closed by an older build; work it
// out from the matchup so restores still land on the right team.
function sideOfArchived(p){
  if(p.side) return p.side;
  const m=String(p.matchup||"");
  if(m.includes(" @ ")){
    const [away,home]=m.split(" @ ");
    if(p.team&&teamMatch(p.team,home)) return "home";
    if(p.team&&teamMatch(p.team,away)) return "away";
  }
  return "home";
}
// Undo for "Archive picks & start new week" -- pulls a closed week back onto
// the board. Previously archiving was one confirmation away from clearing every
// pick with no way back.
async function restoreWeek(weekId){
  const pool=currentPool();
  const hist=activeHistory();
  const wk=hist.find(w=>w.id===weekId); if(!wk) return;
  const ents=activeEntries();
  const liveCount=ents.reduce((n,e)=>n+Object.keys(e.picks).length,0);
  const warn=liveCount
    ? `This replaces the ${liveCount} pick(s) currently on the board with "${wk.label}".\n\nContinue?`
    : `Put "${wk.label}" back on the board for editing?\n\nIt will be removed from Results.`;
  if(!await pgConfirm({
    title:"Restore archived week?",
    message:warn,
    confirmText:"Restore week",
    danger:liveCount>0
  })) return;
  wk.entries.forEach(se=>{
    let ent=ents.find(e=>e.id===se.entryId) || ents.find(e=>e.name===se.name);
    if(!ent){ ent={id:se.entryId||uid(),name:se.name||"Restored entry",picks:{}}; ents.push(ent); }
    ent.picks={};
    delete ent.submittedAt; // restoring means "back to editing", never silently re-lock it
    (se.picks||[]).forEach(p=>{
      // Restore the original decision snapshot too; archiving/restoring a
      // week must not silently replace historical pick-time analytics with
      // whatever the model happens to say today. Archive-only fields are
      // intentionally discarded until the week is closed again.
      const {result,closingLine,closingLineBook,closingLineObservedAt,clv,key,...pickTime}=p;
      ent.picks[p.key]={...pickTime,side:sideOfArchived(p),team:p.team,line:p.line,matchup:p.matchup};
    });
  });
  if(pool){ pool.history=pool.history.filter(w=>w.id!==weekId); if(wk.label) pool.weekLabel=wk.label; }
  else { state.history=state.history.filter(w=>w.id!==weekId); }
  save();
  buildGames(); applyTeamLogos(); migrateGameKeys(); sortGames();
  syncAll(); renderRecord();
  switchTab("picks");
}
function setResult(weekId,entryId,pickKey,result){
  const wk=activeHistory().find(w=>w.id===weekId); if(!wk) return;
  const ent=wk.entries.find(e=>e.entryId===entryId); if(!ent) return;
  const pk=ent.picks.find(p=>p.key===pickKey); if(!pk) return;
  pk.result=(pk.result===result)?null:result;
  save();
  renderRecord();
}

// --- Full-slate model performance ----------------------------------------
// Results pick history only contains games the person actually selected. That
// is useful for evaluating THEIR decisions, but it is selection-biased and
// cannot honestly answer "how did Sagarin / FPI / PickGauge Model # perform?"
// The compact state.modelPerformanceHistory dataset below solves that going
// forward: whenever PickGauge has both a pre-kick market line and model
// projections, capture every available game before kickoff. The nightly/manual
// grader fills each system's ATS result later from canonical CFBD finals.
//
// Important methodology choice: a model is graded against the MARKET LINE
// FROZEN WITH ITS SNAPSHOT, not reconstructed against today's line and not
// restricted to games the user picked. Repeated refreshes before kickoff update
// the same game, so the last snapshot this account actually observed wins;
// after kickoff the record is immutable to prevent hindsight contamination.
const MODEL_PERF_PICKGAUGE_CODE="pickgauge";

function modelPerformanceSystemName(code){
  if(code===MODEL_PERF_PICKGAUGE_CODE) return "PickGauge Model #";
  if(typeof PRED_NAME!=="undefined"&&PRED_NAME&&PRED_NAME[code]) return PRED_NAME[code];
  if(typeof PRED_SYSTEMS!=="undefined"){
    const row=PRED_SYSTEMS.find(s=>s.code===code); if(row&&row.name) return row.name;
  }
  return code||"Unknown model";
}
function modelPerformanceTrackedCodes(){
  const enabled=new Set((typeof state!=="undefined"&&Array.isArray(state.enabledSystems))?state.enabledSystems:[]);
  const featured=(typeof FEATURED_SYSTEM_CODES!=="undefined"&&FEATURED_SYSTEM_CODES)?FEATURED_SYSTEM_CODES:null;
  const codes=(typeof PRED_SYSTEMS!=="undefined"?PRED_SYSTEMS:[])
    .map(s=>s.code).filter(code=>!featured||featured.has(code)||enabled.has(code));
  return [MODEL_PERF_PICKGAUGE_CODE,...codes.filter(c=>c!==MODEL_PERF_PICKGAUGE_CODE)];
}
function modelPerformancePickGaugeNumber(systems,marketHomeLine){
  if(!systems||marketHomeLine==null||!Number.isFinite(Number(marketHomeLine))||typeof PICKGAUGE_MODEL_PRESET==="undefined") return null;
  const available=PICKGAUGE_MODEL_PRESET.systems.filter(code=>recordNumber(systems[code])!=null);
  if(available.length<3) return null;
  const vegasWeight=Number(PICKGAUGE_MODEL_PRESET.weights.vegas)||0;
  const modelTarget=100-vegasWeight;
  const availableWeight=available.reduce((sum,code)=>sum+(Number(PICKGAUGE_MODEL_PRESET.weights[code])||0),0);
  if(availableWeight<=0) return null;
  let num=Number(marketHomeLine)*vegasWeight;
  available.forEach(code=>{
    const base=Number(PICKGAUGE_MODEL_PRESET.weights[code])||0;
    num+=Number(systems[code])*modelTarget*(base/availableWeight);
  });
  return num/100;
}
function _modelPerfPredictionRowForOddsGame(og){
  if(!og||!Array.isArray(state.predictions)) return null;
  return state.predictions.find(p=>{
    const away=(typeof normTracker==="function")?normTracker(p.road):String(p.road||"");
    const home=(typeof normTracker==="function")?normTracker(p.home):String(p.home||"");
    return teamMatchTrunc(away,og.away)&&teamMatchTrunc(home,og.home);
  })||null;
}
function _modelPerfDerivedSystems(temp,base){
  const out={...(base||{})};
  if(typeof cfbdRatingForTeam!=="function"||typeof cfbdDerivedSpread!=="function") return out;
  const away=cfbdRatingForTeam(temp.cfbdAwaySchool||temp.away,temp.cfbdAwayTeamId);
  const home=cfbdRatingForTeam(temp.cfbdHomeSchool||temp.home,temp.cfbdHomeTeamId);
  const neutral=temp.cfbdNeutralSite===true;
  const sp=cfbdDerivedSpread(away&&away.sp&&away.sp.rating,home&&home.sp&&home.sp.rating,neutral);
  const core=cfbdDerivedSpread(away&&away.core&&away.core.overall,home&&home.core&&home.core.overall,neutral);
  if(sp!=null) out.cfbdsp=sp;
  if(core!=null) out.cfbdcore=core;
  return out;
}
function captureModelPerformanceSnapshot(nowMs=Date.now()){
  if(typeof state==="undefined"||!Array.isArray(state.lastGames)||!state.lastGames.length||!Array.isArray(state.predictions)||!state.predictions.length) return 0;
  state.modelPerformanceHistory=Array.isArray(state.modelPerformanceHistory)?state.modelPerformanceHistory:[];
  const tracked=new Set(modelPerformanceTrackedCodes());
  let changed=0;
  state.lastGames.forEach(og=>{
    const prow=_modelPerfPredictionRowForOddsGame(og); if(!prow) return;
    const market=(typeof resolveVegasLine==="function")?resolveVegasLine(og,state.book||"consensus"):(og.vegas!=null?{line:og.vegas,book:og.book||"consensus"}:null);
    if(!market||recordNumber(market.line)==null) return;
    const temp={...og,key:(typeof mkey==="function"?mkey(og.away,og.home):`${og.away}@${og.home}`),providerGameId:og.id||og.providerGameId||null};
    if(typeof applyCfbdIdentityToGame==="function") applyCfbdIdentityToGame(temp);
    const kickoff=temp.cfbdStartDate||temp.commence||og.commence||null;
    const kickMs=Date.parse(kickoff||"");
    // Never create or rewrite a model snapshot after kickoff. If identity is
    // too weak to tell when kickoff is, skip it rather than risk hindsight.
    if(!Number.isFinite(kickMs)||kickMs<=Number(nowMs)) return;
    const season=recordNumber(temp.cfbdSeason), week=recordNumber(temp.cfbdWeek);
    if(season==null||week==null) return;
    let systems=_modelPerfDerivedSystems(temp,prow.systems||{});
    const pg=modelPerformancePickGaugeNumber(systems,market.line);
    if(pg!=null) systems[MODEL_PERF_PICKGAUGE_CODE]=pg;
    const compact={};
    Object.entries(systems).forEach(([code,v])=>{ const n=recordNumber(v); if(tracked.has(code)&&n!=null) compact[code]=n; });
    if(!Object.keys(compact).length) return;

    let wk=state.modelPerformanceHistory.find(x=>Number(x.season)===Number(season)&&Number(x.week)===Number(week));
    if(!wk){ wk={season:Number(season),week:Number(week),capturedAt:new Date(Number(nowMs)).toISOString(),games:[]}; state.modelPerformanceHistory.push(wk); changed++; }
    wk.games=Array.isArray(wk.games)?wk.games:[];
    const gameId=temp.cfbdGameId!=null?String(temp.cfbdGameId):null;
    const providerId=temp.providerGameId||null;
    let existing=wk.games.find(g=>(gameId&&g.cfbdGameId!=null&&String(g.cfbdGameId)===gameId)||(providerId&&g.providerGameId===providerId)||(!gameId&&!providerId&&teamMatchTrunc(g.away,temp.away)&&teamMatchTrunc(g.home,temp.home)));
    const next={
      cfbdGameId:temp.cfbdGameId!=null?temp.cfbdGameId:null,
      providerGameId:providerId,
      away:temp.cfbdAwaySchool||temp.away,
      home:temp.cfbdHomeSchool||temp.home,
      matchup:`${temp.cfbdAwaySchool||temp.away} @ ${temp.cfbdHomeSchool||temp.home}`,
      startDate:kickoff,
      marketHomeLine:Number(market.line),
      marketBook:market.book||state.book||"consensus",
      marketObservedAt:state.lastRefresh||null,
      predictionObservedAt:(state.predMeta&&state.predMeta.fetchedAt)||null,
      snapshotAt:new Date(Number(nowMs)).toISOString(),
      systems:compact,
      systemResults:existing&&existing.systemResults&&typeof existing.systemResults==="object"?existing.systemResults:{},
    };
    if(existing){
      // Keep the latest available value for each model before kickoff. A model
      // disappearing from one refresh does not erase its earlier valid forecast.
      next.systems={...(existing.systems||{}),...compact};
      if(JSON.stringify(existing)!==JSON.stringify(next)){ Object.assign(existing,next); changed++; }
    }else{ wk.games.push(next); changed++; }
    wk.capturedAt=new Date(Number(nowMs)).toISOString();
  });
  state.modelPerformanceHistory.sort((a,b)=>(Number(b.season)-Number(a.season))||(Number(b.week)-Number(a.week)));
  if(changed&&typeof save==="function") save();
  return changed;
}
function modelPerformanceRows(history,filters){
  const f=filters||{}; const rows=[];
  (history||[]).forEach(wk=>{
    if(f.season&&f.season!=="all"&&String(wk.season)!==String(f.season)) return;
    if(f.week&&f.week!=="all"&&String(wk.week)!==String(f.week)) return;
    (wk.games||[]).forEach(g=>{
      const market=recordNumber(g.marketHomeLine); if(market==null) return;
      Object.entries(g.systems||{}).forEach(([code,predRaw])=>{
        const pred=recordNumber(predRaw); if(pred==null) return;
        const result=(g.systemResults||{})[code]||null;
        const side=pred<market?"home":pred>market?"away":"none";
        const pickedLine=side==="home"?market:side==="away"?-market:null;
        rows.push({wk,g,code,pred,market,result,side,pickedLine,edge:Math.abs(pred-market)});
      });
    });
  });
  return rows;
}
function modelPerformanceAnalytics(history,filters){
  const rows=modelPerformanceRows(history,filters);
  const graded=rows.filter(r=>r.result==="W"||r.result==="L"||r.result==="P"||r.result==="N");
  const mean=vals=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const bySystem={};
  graded.forEach(r=>{
    if(!bySystem[r.code]) bySystem[r.code]={code:r.code,name:modelPerformanceSystemName(r.code),W:0,L:0,P:0,N:0,edges:[]};
    const s=bySystem[r.code]; s[r.result]=(s[r.result]||0)+1; if(r.result!=="N") s.edges.push(r.edge);
  });
  const systems=Object.values(bySystem).map(s=>{
    const decisions=s.W+s.L, n=s.W+s.L+s.P;
    return {...s,n,winPct:decisions?s.W/decisions:null,avgEdge:mean(s.edges)};
  }).sort((a,b)=>a.code===MODEL_PERF_PICKGAUGE_CODE?-1:b.code===MODEL_PERF_PICKGAUGE_CODE?1:(b.n-a.n)||((b.winPct||0)-(a.winPct||0))||a.name.localeCompare(b.name));
  const pgRows=graded.filter(r=>r.code===MODEL_PERF_PICKGAUGE_CODE&&(r.result==="W"||r.result==="L"||r.result==="P"));
  function bucket(defs,valueFn){
    return defs.map(d=>{
      const rs=pgRows.filter(r=>{const v=valueFn(r);return v!=null&&d.test(v);});
      const W=rs.filter(r=>r.result==="W").length,L=rs.filter(r=>r.result==="L").length,P=rs.filter(r=>r.result==="P").length;
      return {label:d.label,W,L,P,n:rs.length,pct:(W+L)?W/(W+L):null};
    });
  }
  const pgEdgeBuckets=bucket([
    {label:"0.1–1.4",test:v=>v>0&&v<1.5},{label:"1.5–2.9",test:v=>v>=1.5&&v<3},{label:"3.0–4.9",test:v=>v>=3&&v<5},{label:"5.0+",test:v=>v>=5},
  ],r=>r.edge);
  const pgFavoriteDogBuckets=bucket([
    {label:"Favorites",test:v=>v<0},{label:"Underdogs",test:v=>v>0},{label:"Pick'em",test:v=>v===0},
  ],r=>r.pickedLine);
  const pgHomeAwayBuckets=bucket([{label:"Home",test:v=>v==="home"},{label:"Away",test:v=>v==="away"}],r=>r.side);
  return {
    capturedGames:new Set(rows.map(r=>`${r.wk.season}:${r.wk.week}:${r.g.cfbdGameId||r.g.providerGameId||r.g.matchup}`)).size,
    gradedDecisions:graded.filter(r=>r.result!=="N").length,
    systems,
    pickgauge:systems.find(s=>s.code===MODEL_PERF_PICKGAUGE_CODE)||null,
    pgEdgeBuckets,pgFavoriteDogBuckets,pgHomeAwayBuckets,
  };
}
function recordModelPerformanceHTML(history,filters){
  const a=modelPerformanceAnalytics(history,filters);
  if(!history||!history.length) return `<div class="card record-model-performance"><h2>Model performance</h2><p class="sub">Full-slate tracking starts once PickGauge captures model predictions and a market line before kickoff. It grades hypothetical model picks across every captured game — not only games you selected.</p><div class="record-coverage">No full-slate model snapshots yet. Load lines + model predictions before kickoff to begin the dataset.</div></div>`;
  const systems=a.systems.filter(s=>s.n>0);
  const table=systems.length?`<div class="model-perf-table"><div class="model-perf-head"><span>Model</span><span>ATS</span><span>Win %</span><span>Avg edge</span><span>n</span></div>${systems.map(s=>`<div class="model-perf-row${s.code===MODEL_PERF_PICKGAUGE_CODE?' model-perf-pg':''}"><span class="model-perf-name">${esc(s.name)}${s.n<20?'<small class="record-small-n">small n</small>':''}</span><span class="mono-sm">${s.W}-${s.L}-${s.P}</span><span>${s.winPct==null?'—':(s.winPct*100).toFixed(1)+'%'}</span><span>${s.avgEdge==null?'—':fmt(s.avgEdge)}</span><span class="record-n">n=${s.n}</span></div>`).join("")}</div>`:`<p class="note" style="margin:8px 0 0;">Snapshots exist, but no captured model decisions have final scores yet.</p>`;
  const pg=a.pickgauge;
  const pgHero=pg?`<div class="record-metrics model-perf-metrics"><div class="record-metric"><div class="record-metric-label">PickGauge Model # ATS</div><div class="record-metric-value">${pg.W}-${pg.L}-${pg.P}</div><div class="record-metric-sub">${pg.winPct==null?'No decisions yet':(pg.winPct*100).toFixed(1)+'% win rate'} · n=${pg.n}</div></div><div class="record-metric"><div class="record-metric-label">Captured games</div><div class="record-metric-value">${a.capturedGames}</div><div class="record-metric-sub">All games with a pre-kick market + model snapshot</div></div><div class="record-metric"><div class="record-metric-label">Graded model decisions</div><div class="record-metric-value">${a.gradedDecisions}</div><div class="record-metric-sub">Across tracked prediction systems</div></div></div>`:"";
  return `<div class="card record-model-performance">
    <h2>Model performance</h2>
    <p class="sub">Hypothetical ATS picks across every captured game, graded against the market line frozen with the last pre-kick snapshot this account observed. This is separate from <b>Your pick performance</b> below, so the model records are not selection-biased by which games you chose.</p>
    ${pgHero}${table}
    ${pg?`<div class="record-breakdowns model-perf-breakdowns">${recordBucketTable("PickGauge Model # by edge size",a.pgEdgeBuckets,"Edge is the absolute gap between PickGauge Model # and the frozen market line.")}${recordBucketTable("PickGauge Model # — favorites vs. underdogs",a.pgFavoriteDogBuckets)}${recordBucketTable("PickGauge Model # — home vs. away",a.pgHomeAwayBuckets)}</div>`:""}
    <div class="record-table-note">Pushes are excluded from win-rate denominators. Exact model=market ties are stored as no-lean observations and excluded from ATS records. Small samples are labeled rather than over-interpreted.</div>
  </div>`;
}

// Results filters are view-only UI state. They intentionally are not persisted
// into the account payload: changing a Results filter is not user data and
// should never create a cross-device sync revision.
let recordFilters={season:"all",week:"all"};

function recordSeasonOf(wk,p){
  const direct=Number(p&&p.cfbdSeason);
  if(Number.isInteger(direct)&&direct>=1900&&direct<=2100) return direct;
  // Older archived rows may predate CFBD identity. If the user explicitly put
  // a season in the archive label ("2025 Week 8"), that is safe historical
  // metadata to use. Do NOT infer from today's date/model.
  const m=String((wk&&wk.label)||"").match(/\b(20\d{2})\b/);
  return m?Number(m[1]):null;
}
function recordWeekOf(wk,p){
  const direct=Number(p&&p.cfbdWeek);
  if(Number.isInteger(direct)&&direct>=0&&direct<=30) return direct;
  const m=String((wk&&wk.label)||"").match(/(?:week|wk)\s*#?\s*(\d{1,2})\b/i);
  return m?Number(m[1]):null;
}
function recordNumber(v){
  if(v===null||v===undefined||v==="") return null;
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}
function recordPickMatches(wk,p,filters){
  const f=filters||{};
  const season=recordSeasonOf(wk,p), week=recordWeekOf(wk,p);
  if(f.season&&f.season!=="all"&&String(season)!==String(f.season)) return false;
  if(f.week&&f.week!=="all"&&String(week)!==String(f.week)) return false;
  return true;
}
function recordRows(hist){
  const rows=[];
  (hist||[]).forEach(wk=>(wk.entries||[]).forEach(e=>(e.picks||[]).forEach(p=>{
    rows.push({wk,e,p,season:recordSeasonOf(wk,p),week:recordWeekOf(wk,p)});
  })));
  return rows;
}
function recordFilteredRows(hist,filters){
  const f=filters||{};
  return recordRows(hist).filter(r=>recordPickMatches(r.wk,r.p,f));
}
function recordFilterOptions(hist,filters,modelHist){
  const rows=recordRows(hist);
  const modelRows=(modelHist||[]).map(w=>({season:recordNumber(w&&w.season),week:recordNumber(w&&w.week)}));
  const allRows=[...rows,...modelRows];
  const seasons=[...new Set(allRows.map(r=>r.season).filter(v=>v!=null))].sort((a,b)=>b-a);
  const selectedSeason=filters&&filters.season&&filters.season!=="all"?String(filters.season):"all";
  const weekRows=selectedSeason==="all"?allRows:allRows.filter(r=>String(r.season)===selectedSeason);
  const weeks=[...new Set(weekRows.map(r=>r.week).filter(v=>v!=null))].sort((a,b)=>a-b);
  return {seasons,weeks,unknownSeason:rows.filter(r=>r.season==null).length,unknownWeek:rows.filter(r=>r.week==null).length};
}
function recordFilteredHistory(hist,filters){
  if((!filters||filters.season==="all"||!filters.season)&&(!filters||filters.week==="all"||!filters.week)) return hist||[];
  const matchingWeekIds=new Set(recordFilteredRows(hist,filters).map(r=>r.wk.id));
  return (hist||[]).filter(wk=>matchingWeekIds.has(wk.id));
}
function setRecordFilter(kind,value){
  if(kind!=="season"&&kind!=="week") return;
  recordFilters[kind]=value||"all";
  if(kind==="season") recordFilters.week="all";
  renderRecord();
}
function recordFilterBarHTML(hist,modelHist){
  const opts=recordFilterOptions(hist,recordFilters,modelHist);
  if(recordFilters.season!=="all"&&!opts.seasons.some(v=>String(v)===String(recordFilters.season))) recordFilters.season="all";
  const refreshed=recordFilterOptions(hist,recordFilters,modelHist);
  if(recordFilters.week!=="all"&&!refreshed.weeks.some(v=>String(v)===String(recordFilters.week))) recordFilters.week="all";
  const seasonOptions=[`<option value="all">All seasons</option>`,...refreshed.seasons.map(v=>`<option value="${v}" ${String(recordFilters.season)===String(v)?"selected":""}>${v}</option>`)].join("");
  const weekOptions=[`<option value="all">All weeks</option>`,...refreshed.weeks.map(v=>`<option value="${v}" ${String(recordFilters.week)===String(v)?"selected":""}>Week ${v}</option>`)].join("");
  const legacy=[];
  if(refreshed.unknownSeason) legacy.push(`${refreshed.unknownSeason} pick${refreshed.unknownSeason===1?"":"s"} without season metadata`);
  if(refreshed.unknownWeek) legacy.push(`${refreshed.unknownWeek} without week metadata`);
  return `<div class="record-filterbar">
    <div class="record-filter-copy"><b>Historical view</b><span>Filter analytics without changing or re-saving archived data.</span></div>
    <label>Season<select id="recordSeasonFilter">${seasonOptions}</select></label>
    <label>Week<select id="recordWeekFilter">${weekOptions}</select></label>
    ${legacy.length?`<span class="record-filter-legacy" title="Legacy picks still count when filters are set to All.">${esc(legacy.join(" · "))}</span>`:""}
  </div>`;
}

function recordAnalytics(hist,filters){
  const rows=recordFilteredRows(hist,filters);
  const picks=rows.map(r=>r.p);
  const graded=picks.filter(p=>p.result==="W"||p.result==="L"||p.result==="P");
  const W=graded.filter(p=>p.result==="W").length;
  const L=graded.filter(p=>p.result==="L").length;
  const P=graded.filter(p=>p.result==="P").length;
  const decision=W+L;
  const mean=(vals)=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  const pickedEdges=graded.map(p=>recordNumber(p.pickedEdgeAtPick)).filter(v=>v!=null);
  const clvs=graded.map(p=>recordNumber(p.clv)).filter(v=>v!=null);
  const coverRows=graded.filter(p=>recordNumber(p.coverProbabilityAtPick)!=null);
  const coverProbs=coverRows.map(p=>recordNumber(p.coverProbabilityAtPick)).filter(v=>v!=null);
  const observedCovers=coverRows.filter(p=>p.result==="W").length;

  function summarizeBuckets(defs,valueFn){
    return defs.map(d=>{
      const bucketRows=graded.filter(p=>{ const v=valueFn(p); return v!==null&&v!==undefined&&d.test(v); });
      const w=bucketRows.filter(p=>p.result==="W").length;
      const l=bucketRows.filter(p=>p.result==="L").length;
      const push=bucketRows.filter(p=>p.result==="P").length;
      const dec=w+l;
      return {label:d.label,W:w,L:l,P:push,n:bucketRows.length,pct:dec?w/dec:null};
    });
  }
  const edgeBuckets=summarizeBuckets([
    {label:"≤ 0 pts",test:v=>Number.isFinite(v)&&v<=0},
    {label:"0.1–1.4",test:v=>Number.isFinite(v)&&v>0&&v<1.5},
    {label:"1.5–2.9",test:v=>Number.isFinite(v)&&v>=1.5&&v<3},
    {label:"3.0–4.9",test:v=>Number.isFinite(v)&&v>=3&&v<5},
    {label:"5.0+",test:v=>Number.isFinite(v)&&v>=5},
  ],p=>recordNumber(p.pickedEdgeAtPick));
  const agreementBuckets=summarizeBuckets([
    {label:"< 60%",test:v=>Number.isFinite(v)&&v<0.60},
    {label:"60–74%",test:v=>Number.isFinite(v)&&v>=0.60&&v<0.75},
    {label:"75%+",test:v=>Number.isFinite(v)&&v>=0.75},
  ],p=>p.modelAgreementAtPick?recordNumber(p.modelAgreementAtPick.pct):null);
  const favoriteDogBuckets=summarizeBuckets([
    {label:"Favorites",test:v=>Number.isFinite(v)&&v<0},
    {label:"Underdogs",test:v=>Number.isFinite(v)&&v>0},
    {label:"Pick'em",test:v=>Number.isFinite(v)&&v===0},
  ],p=>recordNumber(p.line));
  const homeAwayBuckets=summarizeBuckets([
    {label:"Home",test:v=>v==="home"},
    {label:"Away",test:v=>v==="away"},
  ],p=>p.side||null);
  const spreadBuckets=summarizeBuckets([
    {label:"PK–2.5",test:v=>Number.isFinite(v)&&v>=0&&v<3},
    {label:"3–6.5",test:v=>Number.isFinite(v)&&v>=3&&v<7},
    {label:"7–10",test:v=>Number.isFinite(v)&&v>=7&&v<=10},
    {label:"10.5–14",test:v=>Number.isFinite(v)&&v>10&&v<=14},
    {label:"14.5+",test:v=>Number.isFinite(v)&&v>14},
  ],p=>{const v=recordNumber(p.line);return v==null?null:Math.abs(v);});
  const keyTierBuckets=summarizeBuckets([
    {label:"No key involvement",test:v=>v==="none"},
    {label:"Minor",test:v=>v==="minor"},
    {label:"Moderate",test:v=>v==="moderate"},
    {label:"Major",test:v=>v==="major"},
  ],p=>["none","minor","moderate","major"].includes(p.keyTierAtPick)?p.keyTierAtPick:null);
  const clvBuckets=summarizeBuckets([
    {label:"Negative CLV",test:v=>Number.isFinite(v)&&v<0},
    {label:"Flat CLV",test:v=>Number.isFinite(v)&&v===0},
    {label:"Positive CLV",test:v=>Number.isFinite(v)&&v>0},
  ],p=>recordNumber(p.clv));

  const calibrationDefs=[
    {label:"< 50%",test:v=>v<0.50},
    {label:"50–54.9%",test:v=>v>=0.50&&v<0.55},
    {label:"55–59.9%",test:v=>v>=0.55&&v<0.60},
    {label:"60–64.9%",test:v=>v>=0.60&&v<0.65},
    {label:"65%+",test:v=>v>=0.65},
  ];
  const calibrationBuckets=calibrationDefs.map(d=>{
    const bucket=coverRows.filter(p=>{const v=recordNumber(p.coverProbabilityAtPick);return v!=null&&d.test(v);});
    const w=bucket.filter(p=>p.result==="W").length;
    const l=bucket.filter(p=>p.result==="L").length;
    const push=bucket.filter(p=>p.result==="P").length;
    const avgPred=mean(bucket.map(p=>recordNumber(p.coverProbabilityAtPick)).filter(v=>v!=null));
    // coverProbabilityAtPick is P(cover), not conditional P(win | no push),
    // so observed calibration correctly uses W / all outcomes INCLUDING pushes.
    const observed=bucket.length?w/bucket.length:null;
    return {label:d.label,W:w,L:l,P:push,n:bucket.length,avgPred,observed,gap:(avgPred!=null&&observed!=null)?observed-avgPred:null};
  });

  const agreementEligible=graded.filter(p=>p.modelAgreementAtPick&&recordNumber(p.modelAgreementAtPick.pct)!=null).length;
  const keyTierEligible=graded.filter(p=>["none","minor","moderate","major"].includes(p.keyTierAtPick)).length;
  const sideEligible=graded.filter(p=>p.side==="home"||p.side==="away").length;
  const spreadEligible=graded.filter(p=>recordNumber(p.line)!=null).length;
  const avgCoverProbability=mean(coverProbs);
  const observedCoverRate=coverRows.length?observedCovers/coverRows.length:null;
  return {
    totalArchived:picks.length, gradedCount:graded.length, W,L,P,
    winPct:decision?W/decision:null,
    avgPickedEdge:mean(pickedEdges), edgeEligible:pickedEdges.length,
    avgClv:mean(clvs), clvEligible:clvs.length,
    positiveClvPct:clvs.length?clvs.filter(v=>v>0).length/clvs.length:null,
    avgCoverProbability, observedCoverRate,
    calibrationGap:(avgCoverProbability!=null&&observedCoverRate!=null)?observedCoverRate-avgCoverProbability:null,
    coverEligible:coverRows.length,
    agreementEligible,keyTierEligible,sideEligible,spreadEligible,
    edgeBuckets,agreementBuckets,favoriteDogBuckets,homeAwayBuckets,spreadBuckets,keyTierBuckets,clvBuckets,calibrationBuckets,
  };
}
function recordBucketTable(title,rows,footnote=""){
  const populated=(rows||[]).filter(r=>r.n>0);
  if(!populated.length) return `<div class="record-breakdown"><div class="record-breakdown-title">${esc(title)}</div><p class="note" style="margin:6px 0 0;">Not enough frozen historical data yet.</p></div>`;
  return `<div class="record-breakdown"><div class="record-breakdown-title">${esc(title)}</div><div class="record-table">${populated.map(r=>`<div class="record-table-row"><span>${esc(r.label)}${r.n<10?'<small class="record-small-n">small n</small>':''}</span><span class="mono-sm">${r.W}-${r.L}-${r.P}</span><span class="record-pct">${r.pct==null?'—':(r.pct*100).toFixed(1)+'%'}</span><span class="record-n">n=${r.n}</span></div>`).join("")}</div>${footnote?`<div class="record-table-note">${esc(footnote)}</div>`:""}</div>`;
}
function recordCalibrationTable(rows){
  const populated=(rows||[]).filter(r=>r.n>0);
  if(!populated.length) return `<div class="record-breakdown record-calibration"><div class="record-breakdown-title">Cover % calibration</div><p class="note" style="margin:6px 0 0;">No graded picks with frozen Cover % yet.</p></div>`;
  return `<div class="record-breakdown record-calibration"><div class="record-breakdown-title">Cover % calibration</div><div class="record-cal-head"><span>PickGauge</span><span>Avg predicted</span><span>Observed covers</span><span>Gap</span><span>n</span></div><div class="record-table">${populated.map(r=>`<div class="record-cal-row"><span>${esc(r.label)}${r.n<20?'<small class="record-small-n">small n</small>':''}</span><span>${r.avgPred==null?'—':(r.avgPred*100).toFixed(1)+'%'}</span><span>${r.observed==null?'—':(r.observed*100).toFixed(1)+'%'}</span><span class="${r.gap==null?'':Math.abs(r.gap)<=0.03?'cal-ok':'cal-watch'}">${r.gap==null?'—':(r.gap>=0?'+':'')+(r.gap*100).toFixed(1)+' pp'}</span><span class="record-n">n=${r.n}</span></div>`).join("")}</div><div class="record-table-note">Observed covers use W ÷ (W+L+P), because frozen Cover % estimates the probability of a cover and a push is not a cover.</div></div>`;
}
function recordAnalyticsHTML(hist,filters){
  const a=recordAnalytics(hist,filters);
  const signed=(v)=>v==null?'—':fmt(v);
  const pct=(v)=>v==null?'—':(v*100).toFixed(1)+'%';
  const pp=(v)=>v==null?'—':`${v>=0?'+':''}${(v*100).toFixed(1)} pp`;
  const metric=(label,value,sub)=>`<div class="record-metric"><div class="record-metric-label">${label}</div><div class="record-metric-value">${value}</div><div class="record-metric-sub">${sub}</div></div>`;
  const coverage=a.gradedCount?`${a.edgeEligible}/${a.gradedCount} graded picks carry frozen Edge · ${a.agreementEligible}/${a.gradedCount} Agreement · ${a.coverEligible}/${a.gradedCount} Cover % · ${a.clvEligible}/${a.gradedCount} last observed pre-kick lines`:`Grade picks to start building the learning dataset.`;
  return `<div class="card record-analytics">
    <h2>Your pick performance</h2>
    <p class="sub">Uses the market/model snapshot frozen when each pick was made. Legacy rows missing a field still count in the ATS record but are excluded from that specific analysis rather than reconstructed with today's model.</p>
    <div class="record-metrics">
      ${metric("ATS record",`${a.W}-${a.L}-${a.P}`,a.winPct==null?'No decisions yet':pct(a.winPct)+' win rate')}
      ${metric("Avg pick edge",signed(a.avgPickedEdge),`${a.edgeEligible} graded pick${a.edgeEligible===1?'':'s'} with frozen Edge`)}
      ${metric("Avg CLV",signed(a.avgClv),a.positiveClvPct==null?'No last observed pre-kick lines yet':`${pct(a.positiveClvPct)} positive CLV`)}
      ${metric("Cover calibration",pp(a.calibrationGap),a.coverEligible?`${pct(a.avgCoverProbability)} predicted · ${pct(a.observedCoverRate)} observed`:'No frozen Cover % yet')}
    </div>
    <div class="record-coverage">${coverage}</div>
    <div class="record-breakdowns record-breakdowns-wide">
      ${recordBucketTable("ATS by picked-side Edge",a.edgeBuckets)}
      ${recordBucketTable("ATS by Model Agreement",a.agreementBuckets)}
      ${recordBucketTable("Favorites vs. underdogs",a.favoriteDogBuckets)}
      ${recordBucketTable("Home vs. away",a.homeAwayBuckets)}
      ${recordBucketTable("ATS by spread range",a.spreadBuckets,"Spread range uses the picked team's frozen market line.")}
      ${recordBucketTable("ATS by key-number involvement",a.keyTierBuckets,"Uses the key-number tier frozen when the pick was made.")}
      ${recordBucketTable("ATS by closing-line value",a.clvBuckets,"Positive CLV means the picked number beat the last observed pre-kick line.")}
      ${recordCalibrationTable(a.calibrationBuckets)}
    </div>
  </div>`;
}

function renderRecord(){
  const wrap=document.getElementById("recordBody");
  if(!wrap) return;
  const pool=currentPool();
  const hist=activeHistory();
  const modelHist=Array.isArray(state.modelPerformanceHistory)?state.modelPerformanceHistory:[];
  if(!hist.length&&!modelHist.length){
    wrap.innerHTML=pool
      ?`<div class="card"><h2>Results — ${esc(pool.name)}</h2><p class="note">No closed weeks yet for this pool. Import next week's sheet (or use <b>Archive picks &amp; start new week</b> in My Picks) to send this week's picks here for grading.</p></div>`
      :`<div class="card"><h2>Results</h2><p class="note">No closed weeks yet. Make your picks in <b>My Picks</b>, then use <b>Archive picks &amp; start new week</b> to send them here for grading.</p></div>`;
    return;
  }

  // Build the filter bar first because it normalizes stale filter selections
  // when switching pools (for example a pool that has 2025 history -> one
  // that only has 2026). Everything below uses the normalized view state.
  const filterHTML=recordFilterBarHTML(hist,modelHist);
  const visibleRows=recordFilteredRows(hist,recordFilters);
  const tally={};
  visibleRows.forEach(({e,p})=>{
    const entryKey=e.entryId||e.id||e.name;
    if(!tally[entryKey]) tally[entryKey]={name:e.name,W:0,L:0,P:0};
    if(p.result==='W') tally[entryKey].W++;
    else if(p.result==='L') tally[entryKey].L++;
    else if(p.result==='P') tally[entryKey].P++;
  });
  const tallyVals=Object.values(tally);
  const tallyRows=tallyVals.length?tallyVals.map(t=>{
    const dec=t.W+t.L;
    const pct=dec?Math.round((t.W/dec)*1000)/10:null;
    return `<div class="pl-row"><span class="pl-team">${esc(t.name)}</span><span class="pl-meta">${t.W}-${t.L}-${t.P}${pct!=null?` · ${pct}%`:''}</span></div>`;
  }).join(""):'<p class="note" style="margin:0;">No graded picks match the current filters.</p>';

  const visibleWeeks=hist.map(wk=>{
    const entries=(wk.entries||[]).map(e=>({
      ...e,
      picks:(e.picks||[]).filter(p=>recordPickMatches(wk,p,recordFilters))
    })).filter(e=>e.picks.length);
    return {...wk,entries};
  }).filter(wk=>wk.entries.length);

  const weeksHtml=visibleWeeks.map(wk=>{
    const entriesHtml=wk.entries.map(e=>{
      const picksHtml=e.picks.map(p=>{
        const mkBtn=(r,label)=>`<button class="resbtn ${p.result===r?'active-'+r:''}" data-week="${wk.id}" data-entry="${e.entryId}" data-pick="${p.key}" data-res="${r}">${label}</button>`;
        const clvNum=recordNumber(p.clv);
        const clvHTML=clvNum!=null?`<span class="pr-clv ${clvNum>0?'clv-good':clvNum<0?'clv-bad':'clv-even'}" style="margin-left:8px;">CLV ${fmt(clvNum)}</span>`:"";
        // Real gap fix: closingLineObservedAt/closingLineBook were already
        // being frozen at archive time (closeWeek() above) but never shown
        // anywhere -- a retained close looked equally trustworthy whether
        // it was captured 8 minutes or 6 hours before kickoff. Compact,
        // always-visible badge here; the fuller freshness note lives in
        // the "Why?" panel's line-check comparison below.
        const closeFreshness=(p.closingLine!=null&&typeof closingLineFreshness==="function")
          ?closingLineFreshness(p.closingLineObservedAt,p.cfbdStartDate):null;
        const closeBits=[p.closingLine!=null?`Close ${fmt(p.closingLine)}`:null,p.closingLineBook||null,closeFreshness?closeFreshness.tier:null].filter(Boolean);
        const closeHTML=closeBits.length?`<span class="pr-close" style="margin-left:8px;" title="Last observed pre-kick line">${esc(closeBits.join(" · "))}</span>`:"";
        const edgeNum=recordNumber(p.pickedEdgeAtPick);
        const coverNum=recordNumber(p.coverProbabilityAtPick);
        const detailBits=[];
        if(edgeNum!=null) detailBits.push(`Edge ${fmt(edgeNum)}`);
        if(coverNum!=null) detailBits.push(`Cover ${(coverNum*100).toFixed(1)}%`);
        if(p.modelAgreementAtPick&&recordNumber(p.modelAgreementAtPick.pct)!=null) detailBits.push(`Agree ${p.modelAgreementAtPick.agree}/${p.modelAgreementAtPick.total}`);
        const frozenHTML=detailBits.length?`<span class="record-pick-snapshot">${esc(detailBits.join(" · "))}</span>`:"";
        // "Why?" only makes sense for a graded pick (result set) whose
        // GAME has a canonical CFBD id frozen on it -- older archived
        // picks (before the identity layer existed) or picks whose game
        // never resolved to a canonical id have neither, and get no
        // button rather than one that would just error when clicked.
        const whyKey=`${wk.id}|${e.entryId}|${p.key}`;
        const canShowWhy=!!(p.result && p.cfbdGameId!=null && p.cfbdAwaySchool && p.cfbdHomeSchool);
        const whyOpen=recordExpandedBoxScores.has(whyKey);
        const whyToggleHTML=canShowWhy
          ?`<button class="record-why-toggle${whyOpen?' open':''}" data-why="${esc(whyKey)}" data-gameid="${esc(p.cfbdGameId)}" data-away="${esc(p.cfbdAwaySchool)}" data-home="${esc(p.cfbdHomeSchool)}" data-pickedteam="${esc(p.team||'')}" data-pickline="${p.line!=null?p.line:''}" data-result="${esc(p.result||'')}" data-side="${esc(p.side||'')}" data-closingline="${p.closingLine!=null?p.closingLine:''}" data-closingbook="${esc(p.closingLineBook||'')}" data-closingobserved="${esc(p.closingLineObservedAt||'')}" data-kickoff="${esc(p.cfbdStartDate||'')}">${whyOpen?'Hide':'Why?'}</button>`
          :"";
        const whyPanelHTML=(canShowWhy&&whyOpen)
          ?`<div class="record-why-panel" data-why-panel="${esc(whyKey)}"><div class="record-why-loading">Loading box score…</div></div>`
          :"";
        return `<div class="pl-row record-pick-row">
          <div class="record-pick-main"><div><span class="pl-team">${esc(p.team||"")} ${p.line!=null?fmt(p.line):""}</span><span class="pl-meta" style="margin-left:8px;">${esc(p.matchup)}</span>${clvHTML}${closeHTML}${whyToggleHTML}</div>${frozenHTML}</div>
          <span class="resgroup">${mkBtn('W','W')}${mkBtn('L','L')}${mkBtn('P','P')}</span>
        </div>${whyPanelHTML}`;
      }).join("");
      return `<div style="margin-bottom:10px;"><div class="wk-entry-name">${esc(e.name)}</div>${picksHtml}</div>`;
    }).join("");
    return `<div class="card">
      <h2>${esc(wk.label)} <span class="mono-sm" style="font-weight:400;">${new Date(wk.closedAt).toLocaleDateString()}</span>
        <button class="iconbtn restore-wk" data-restore="${wk.id}" title="Put this entire archived week's picks back on the board">↩ restore to board</button>
      </h2>
      ${entriesHtml}
    </div>`;
  }).join("");

  const noMatches=!visibleRows.length?`<div class="card"><p class="note" style="margin:0;">No archived picks match this season/week filter. Choose <b>All seasons</b> or <b>All weeks</b> to widen the view.</p></div>`:"";
  const pickAnalytics=hist.length?recordAnalyticsHTML(hist,recordFilters):`<div class="card"><h2>Your pick performance</h2><p class="note" style="margin:0;">No archived picks yet. Model performance can still build independently from full-slate pre-kick snapshots.</p></div>`;
  wrap.innerHTML=`${filterHTML}${recordModelPerformanceHTML(modelHist,recordFilters)}${pickAnalytics}<div class="card"><h2>Running record${pool?" — "+esc(pool.name):""}</h2><div class="picklist">${tallyRows}</div></div>${noMatches}${weeksHtml}`;
  const seasonSel=wrap.querySelector("#recordSeasonFilter");
  const weekSel=wrap.querySelector("#recordWeekFilter");
  if(seasonSel) seasonSel.onchange=()=>setRecordFilter("season",seasonSel.value);
  if(weekSel) weekSel.onchange=()=>setRecordFilter("week",weekSel.value);
  wrap.querySelectorAll(".resbtn").forEach(b=>b.onclick=()=>setResult(b.dataset.week,b.dataset.entry,b.dataset.pick,b.dataset.res));
  wrap.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>restoreWeek(b.dataset.restore));
  // "Why?" toggle: collapse is synchronous (no fetch needed, just drop the
  // key and re-render). Expand shows a loading placeholder immediately via
  // a synchronous re-render, THEN patches just that one panel's innerHTML
  // once the (possibly slow, possibly cached) fetch resolves -- deliberately
  // NOT a second full renderRecord() after the fetch, since another action
  // (grading a different pick, changing filters) could have happened in the
  // meantime and a blind full re-render would stomp on that. Patching only
  // the specific panel this click opened is correct either way: if the panel
  // no longer exists (collapsed again, or the filtered view changed under
  // it), the querySelector simply finds nothing and this is a safe no-op.
  wrap.querySelectorAll("[data-why]").forEach(b=>b.onclick=async()=>{
    const whyKey=b.dataset.why;
    if(recordExpandedBoxScores.has(whyKey)){
      recordExpandedBoxScores.delete(whyKey);
      renderRecord();
      return;
    }
    recordExpandedBoxScores.add(whyKey);
    renderRecord();
    // Box score and historical-line check are independent CFBD calls --
    // fetched in parallel (Promise.all), not sequentially, so a slow
    // /lines lookup doesn't hold up the (usually more useful) box score
    // from appearing, and vice versa.
    const [box,lines]=await Promise.all([
      (typeof fetchCfbdBoxScore==="function")?fetchCfbdBoxScore(b.dataset.gameid):Promise.resolve(null),
      (typeof fetchCfbdHistoricalLines==="function")?fetchCfbdHistoricalLines(b.dataset.gameid):Promise.resolve(null),
    ]);
    const panel=wrap.querySelector(`[data-why-panel="${CSS.escape(whyKey)}"]`);
    if(!panel) return; // collapsed or re-rendered away before the fetch finished
    const ourClosingLine=b.dataset.closingline===""?null:Number(b.dataset.closingline);
    const closeMeta={
      book:b.dataset.closingbook||null,
      observedAt:b.dataset.closingobserved||null,
      kickoff:b.dataset.kickoff||null,
    };
    const lineHtml=lines&&typeof cfbdLineComparisonHTML==="function"
      ?cfbdLineComparisonHTML(lines,ourClosingLine,b.dataset.side,closeMeta):"";
    const boxHtml=box&&typeof cfbdPostgamePanelHTML==="function"
      ?cfbdPostgamePanelHTML(box,b.dataset.away,b.dataset.home,{
        pickedTeam:b.dataset.pickedteam||null,
        pickLine:b.dataset.pickline===""?null:Number(b.dataset.pickline),
        result:b.dataset.result||null,
        side:b.dataset.side||null,
      }):"";
    const combined=lineHtml+boxHtml;
    panel.innerHTML=combined||'<div class="record-why-loading">No CFBD data available for this game.</div>';
  });
}
