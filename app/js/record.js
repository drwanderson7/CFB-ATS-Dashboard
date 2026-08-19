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
function recordFilterOptions(hist,filters){
  const rows=recordRows(hist);
  const seasons=[...new Set(rows.map(r=>r.season).filter(v=>v!=null))].sort((a,b)=>b-a);
  const selectedSeason=filters&&filters.season&&filters.season!=="all"?String(filters.season):"all";
  const weekRows=selectedSeason==="all"?rows:rows.filter(r=>String(r.season)===selectedSeason);
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
function recordFilterBarHTML(hist){
  const opts=recordFilterOptions(hist,recordFilters);
  if(recordFilters.season!=="all"&&!opts.seasons.some(v=>String(v)===String(recordFilters.season))) recordFilters.season="all";
  const refreshed=recordFilterOptions(hist,recordFilters);
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
  const coverage=a.gradedCount?`${a.edgeEligible}/${a.gradedCount} graded picks carry frozen Edge · ${a.agreementEligible}/${a.gradedCount} Agreement · ${a.coverEligible}/${a.gradedCount} Cover % · ${a.clvEligible}/${a.gradedCount} true closing lines`:`Grade picks to start building the learning dataset.`;
  return `<div class="card record-analytics">
    <h2>PickGauge analytics</h2>
    <p class="sub">Uses the market/model snapshot frozen when each pick was made. Legacy rows missing a field still count in the ATS record but are excluded from that specific analysis rather than reconstructed with today's model.</p>
    <div class="record-metrics">
      ${metric("ATS record",`${a.W}-${a.L}-${a.P}`,a.winPct==null?'No decisions yet':pct(a.winPct)+' win rate')}
      ${metric("Avg pick edge",signed(a.avgPickedEdge),`${a.edgeEligible} graded pick${a.edgeEligible===1?'':'s'} with frozen Edge`)}
      ${metric("Avg CLV",signed(a.avgClv),a.positiveClvPct==null?'No true closing lines yet':`${pct(a.positiveClvPct)} positive CLV`)}
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
  if(!hist.length){
    wrap.innerHTML=pool
      ?`<div class="card"><h2>Results — ${esc(pool.name)}</h2><p class="note">No closed weeks yet for this pool. Import next week's sheet (or use <b>Archive picks &amp; start new week</b> in My Picks) to send this week's picks here for grading.</p></div>`
      :`<div class="card"><h2>Results</h2><p class="note">No closed weeks yet. Make your picks in <b>My Picks</b>, then use <b>Archive picks &amp; start new week</b> to send them here for grading.</p></div>`;
    return;
  }

  // Build the filter bar first because it normalizes stale filter selections
  // when switching pools (for example a pool that has 2025 history -> one
  // that only has 2026). Everything below uses the normalized view state.
  const filterHTML=recordFilterBarHTML(hist);
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
        const edgeNum=recordNumber(p.pickedEdgeAtPick);
        const coverNum=recordNumber(p.coverProbabilityAtPick);
        const detailBits=[];
        if(edgeNum!=null) detailBits.push(`Edge ${fmt(edgeNum)}`);
        if(coverNum!=null) detailBits.push(`Cover ${(coverNum*100).toFixed(1)}%`);
        if(p.modelAgreementAtPick&&recordNumber(p.modelAgreementAtPick.pct)!=null) detailBits.push(`Agree ${p.modelAgreementAtPick.agree}/${p.modelAgreementAtPick.total}`);
        const frozenHTML=detailBits.length?`<span class="record-pick-snapshot">${esc(detailBits.join(" · "))}</span>`:"";
        return `<div class="pl-row record-pick-row">
          <div class="record-pick-main"><div><span class="pl-team">${esc(p.team||"")} ${p.line!=null?fmt(p.line):""}</span><span class="pl-meta" style="margin-left:8px;">${esc(p.matchup)}</span>${clvHTML}</div>${frozenHTML}</div>
          <span class="resgroup">${mkBtn('W','W')}${mkBtn('L','L')}${mkBtn('P','P')}</span>
        </div>`;
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
  wrap.innerHTML=`${filterHTML}${recordAnalyticsHTML(hist,recordFilters)}<div class="card"><h2>Running record${pool?" — "+esc(pool.name):""}</h2><div class="picklist">${tallyRows}</div></div>${noMatches}${weeksHtml}`;
  const seasonSel=wrap.querySelector("#recordSeasonFilter");
  const weekSel=wrap.querySelector("#recordWeekFilter");
  if(seasonSel) seasonSel.onchange=()=>setRecordFilter("season",seasonSel.value);
  if(weekSel) weekSel.onchange=()=>setRecordFilter("week",weekSel.value);
  wrap.querySelectorAll(".resbtn").forEach(b=>b.onclick=()=>setResult(b.dataset.week,b.dataset.entry,b.dataset.pick,b.dataset.res));
  wrap.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>restoreWeek(b.dataset.restore));
}
