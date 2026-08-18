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
//   - `uid()`/`esc()`/`fmt()` -- general utilities (main inline script).
//   - `save()`/`syncAll()` -- persistence (main inline script).
//   - `switchTab()` -- tab navigation (main inline script).
//   - `buildGames()`/`migrateGameKeys()`/`sortGames()` -- game-list
//     reconstruction after a restore (app/js/board.js / main inline
//     script).
function closeWeek(){
  const pool=currentPool();
  const ents=activeEntries();
  const hasPicks=ents.some(e=>Object.keys(e.picks).length);
  if(!hasPicks){ alert("No picks yet this week — nothing to close out."); return; }
  const defLabel=pool?(pool.weekLabel||("Week "+(activeHistory().length+1))):("Week "+(state.history.length+1));
  const label=prompt('Label this week (e.g. "Week 9")', defLabel);
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
      // closingLine/clv are captured SEPARATELY, purely as research
      // value (what did the market do after you picked?) -- grading
      // code must never read either of these two fields.
      let closingLine=null, clv=null;
      if(live && live.vegas!=null && p.line!=null && p.side){
        closingLine=p.side==="home"?live.vegas:-live.vegas;
        // Reuse the same tested forPick math the rest of the app already
        // trusts (clvOf()/g.lockedLine/g.liveVegas), rather than
        // re-deriving the sign convention by hand here and risking a
        // second, different bug while fixing the first one.
        const fakeG={lockedLine:(p.side==="home"?p.line:-p.line), liveVegas:live.vegas};
        const c=clvOf(fakeG,p.side);
        clv=c?c.forPick:null;
      }
      return{ key:k, matchup:p.matchup||k, team:p.team||"", side:p.side||null, line:p.line, closingLine, clv, result:null, providerGameId };
    })
  }));
  const rec={ id:uid(), label:(label.trim()||defLabel), closedAt:new Date().toISOString(), entries:snapshot };
  if(pool) pool.history.unshift(rec); else state.history.unshift(rec);
  ents.forEach(e=>e.picks={});
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
// the board. Previously archiving was one prompt away from clearing every
// pick with no way back.
function restoreWeek(weekId){
  const pool=currentPool();
  const hist=activeHistory();
  const wk=hist.find(w=>w.id===weekId); if(!wk) return;
  const ents=activeEntries();
  const liveCount=ents.reduce((n,e)=>n+Object.keys(e.picks).length,0);
  const warn=liveCount
    ? `This replaces the ${liveCount} pick(s) currently on the board with "${wk.label}".\n\nContinue?`
    : `Put "${wk.label}" back on the board for editing?\n\nIt will be removed from Results.`;
  if(!confirm(warn)) return;
  wk.entries.forEach(se=>{
    let ent=ents.find(e=>e.id===se.entryId) || ents.find(e=>e.name===se.name);
    if(!ent){ ent={id:se.entryId||uid(),name:se.name||"Restored entry",picks:{}}; ents.push(ent); }
    ent.picks={};
    (se.picks||[]).forEach(p=>{
      ent.picks[p.key]={side:sideOfArchived(p),team:p.team,line:p.line,matchup:p.matchup};
    });
  });
  if(pool){ pool.history=pool.history.filter(w=>w.id!==weekId); if(wk.label) pool.weekLabel=wk.label; }
  else { state.history=state.history.filter(w=>w.id!==weekId); }
  save();
  buildGames(); migrateGameKeys(); sortGames();
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
  const tally={};
  hist.forEach(wk=>wk.entries.forEach(e=>{
    if(!tally[e.entryId]) tally[e.entryId]={name:e.name,W:0,L:0,P:0};
    e.picks.forEach(p=>{
      if(p.result==='W') tally[e.entryId].W++;
      else if(p.result==='L') tally[e.entryId].L++;
      else if(p.result==='P') tally[e.entryId].P++;
    });
  }));
  const tallyVals=Object.values(tally);
  const tallyRows=tallyVals.length?tallyVals.map(t=>{
    const dec=t.W+t.L;
    const pct=dec?Math.round((t.W/dec)*1000)/10:null;
    return `<div class="pl-row"><span class="pl-team">${esc(t.name)}</span><span class="pl-meta">${t.W}-${t.L}-${t.P}${pct!=null?` · ${pct}%`:''}</span></div>`;
  }).join(""):'<p class="note" style="margin:0;">No graded picks yet — mark W/L/P below.</p>';

  const weeksHtml=hist.map(wk=>{
    const entriesHtml=wk.entries.filter(e=>e.picks.length).map(e=>{
      const picksHtml=e.picks.map(p=>{
        const mkBtn=(r,label)=>`<button class="resbtn ${p.result===r?'active-'+r:''}" data-week="${wk.id}" data-entry="${e.entryId}" data-pick="${p.key}" data-res="${r}">${label}</button>`;
        // clv is only present on weeks archived after the pick-line fix
        // (older archived picks simply won't have it -- nothing to show,
        // not an error) -- same .pr-clv styling My Picks already uses for
        // this, so it reads as the same concept in both places.
        const clvHTML=p.clv!=null?`<span class="pr-clv ${p.clv>0?'clv-good':p.clv<0?'clv-bad':'clv-even'}" style="margin-left:8px;">CLV ${fmt(p.clv)}</span>`:"";
        return `<div class="pl-row">
          <div><span class="pl-team">${esc(p.team||"")} ${p.line!=null?fmt(p.line):""}</span><span class="pl-meta" style="margin-left:8px;">${esc(p.matchup)}</span>${clvHTML}</div>
          <span class="resgroup">${mkBtn('W','W')}${mkBtn('L','L')}${mkBtn('P','P')}</span>
        </div>`;
      }).join("");
      return `<div style="margin-bottom:10px;"><div class="wk-entry-name">${esc(e.name)}</div>${picksHtml}</div>`;
    }).join("");
    return `<div class="card">
      <h2>${esc(wk.label)} <span class="mono-sm" style="font-weight:400;">${new Date(wk.closedAt).toLocaleDateString()}</span>
        <button class="iconbtn restore-wk" data-restore="${wk.id}" title="Put this week's picks back on the board">↩ restore to board</button>
      </h2>
      ${entriesHtml||'<p class="note">No picks in this archived week.</p>'}
    </div>`;
  }).join("");

  wrap.innerHTML=`<div class="card"><h2>Running record${pool?" — "+esc(pool.name):""}</h2><div class="picklist">${tallyRows}</div></div>${weeksHtml}`;
  wrap.querySelectorAll(".resbtn").forEach(b=>b.onclick=()=>setResult(b.dataset.week,b.dataset.entry,b.dataset.pick,b.dataset.res));
  wrap.querySelectorAll("[data-restore]").forEach(b=>b.onclick=()=>restoreWeek(b.dataset.restore));
}
