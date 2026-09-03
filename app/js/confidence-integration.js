// ---------------------------------------------------------------------------
// Confidence pools -- UI layer. Sept 2, 2026, Drew's explicit request.
// Pure logic (points validation, ATS grading math) lives in
// app/js/confidence.js and is unit-tested there in isolation; this file is
// purely rendering + DOM wiring + state mutation, same split every other
// tab in this app already uses (board.js/model.js, picks.js/record.js,
// survivor-integration.js/survivor-core).
//
// CORRECTED same day after seeing Drew's real Splash sheet ("Grundy's
// Gang" Team Pickem, Week 1 2026): this is confidence AGAINST THE SPREAD,
// not straight-up. Every game's `line` is now a REQUIRED, directly
// editable field that drives grading -- not decorative reference text.
// See confidence.js's header comment for the full rationale.
//
// Deliberately built WITHOUT a hardcoded season schedule (unlike Survivor's
// SEC/Big Ten/Kelly pools) -- a confidence pool's game list comes from
// whatever the person adds each week (picked off the live board, or typed
// in by hand), mirroring how an ATS pool's `pool.games` already works
// (see app/js/pool-contexts.js's manual-game-picker, poolManualGamesForWeek()
// etc.).
//
// PDF import (a Splash confidence sheet) is intentionally NOT built yet --
// Drew doesn't have a machine-readable sample to build the parser against
// (the one provided was a set of screenshots, not a real data source). The
// manual-entry path below is the full, real way to use this feature today;
// adding a PDF importer later only needs to produce the same
// {away,home,commence,line} shape mergePoolLines()/poolManualGamesForWeek()
// already produce for ATS pools, so it can plug in without changing the
// manual path at all.
// ---------------------------------------------------------------------------

let cpManualCustomGames=[]; // transient, not saved -- games typed in by hand, staged before "Save games for this week"
let cpAddGamesOpen={}; // poolId -> bool. A <details> element's native `open`
// attribute does NOT survive renderConfidenceTab()'s full innerHTML rebuild
// (every mutation -- including "+ add game" itself -- triggers one), so
// without tracking this separately, adding one custom game closes the
// panel right back up before you can add a second. Same pattern
// pool-contexts.js's poolManualState already uses for the equivalent ATS
// pool picker, for the same reason.

function cpPools(){ return state.confidencePools; }
function cpActivePool(){
  const id=state.confidenceActivePoolId;
  const pools=cpPools();
  if(id){ const p=pools.find(x=>x.id===id&&!x.archived); if(p) return p; }
  return pools.find(x=>!x.archived)||null;
}
function cpSetActivePool(id){ state.confidenceActivePoolId=id; save(); renderConfidenceTab(); }
function cpActiveEntry(pool){
  if(!pool||!pool.entries||!pool.entries.length) return null;
  const uiKey="cpActiveEntry_"+pool.id;
  let id=null;
  try{ id=localStorage.getItem(uiKey); }catch(e){}
  return pool.entries.find(e=>e.id===id)||pool.entries[0];
}
function cpSetActiveEntry(pool,entryId){
  try{ localStorage.setItem("cpActiveEntry_"+pool.id,entryId); }catch(e){}
  renderConfidenceTab();
}

function cpCreatePool(name,pickCount){
  const pool={
    id:uid(),
    name:(name||"").trim()||("Confidence Pool "+(cpPools().length+1)),
    pickCount:(pickCount==null||pickCount==="")?null:Math.max(1,Math.floor(Number(pickCount))),
    dropLowestWeeks:null, // Splash's real rule ("Your 2 lowest-scoring weeks
                           // will be dropped") is a per-pool setting -- see
                           // cpEditDropWeeksBtn below. Defaults to no drop.
    weekLabel:"Week 1",
    games:[],
    entries:[{id:uid(),name:"Entry 1",picks:{},history:[]}],
    archived:false,
    createdAt:new Date().toISOString(),
  };
  cpPools().push(pool);
  state.confidenceActivePoolId=pool.id;
  save();
  return pool;
}

function cpAddEntry(pool,name){
  const nm=(name||"").trim()||("Entry "+(pool.entries.length+1));
  const e={id:uid(),name:nm,picks:{},history:[]};
  pool.entries.push(e);
  save();
  cpSetActiveEntry(pool,e.id);
}

function cpBoardGamesForAdd(){
  return (state.lastGames||[]).slice().sort((a,b)=>(Date.parse(a.commence)||0)-(Date.parse(b.commence)||0));
}

// `line` is REQUIRED for grading (see confidence.js) -- prefilled from the
// live board's Vegas number when adding from there, but always editable
// afterward (cpSetGameLine() below) since the real Splash sheet's printed
// number can differ from today's live market by the time picks are made.
function cpAddGameToPool(pool,{away,home,commence,providerGameId,line}){
  const key=mkey(away,home);
  if((pool.games||[]).some(g=>g.key===key)) return false; // already on the slate
  pool.games=pool.games||[];
  pool.games.push({key,away,home,commence:commence||null,providerGameId:providerGameId||null,line:(line!=null&&line!==""?Number(line):null)});
  save();
  return true;
}
function cpRemoveGameFromPool(pool,key){
  pool.games=(pool.games||[]).filter(g=>g.key!==key);
  // Deliberately does NOT touch any entry's picks map here -- a removed
  // game's stray pick is caught and surfaced by cpValidatePicks()'s
  // "no longer on this week's slate" check instead, so the person sees
  // and clears it explicitly rather than it silently vanishing along with
  // whatever point value it was using.
  save();
}
function cpSetGameLine(pool,key,rawValue){
  const g=(pool.games||[]).find(x=>x.key===key);
  if(!g) return;
  g.line=(rawValue===""||rawValue==null||isNaN(Number(rawValue)))?null:Number(rawValue);
  save();
}

// Archives the CURRENT week into every entry's history (result/grading
// fields left null, filled in later by grading -- same "freeze now, grade
// later" pattern closeWeek() already uses for ATS picks), then clears the
// pool's active game list and every entry's current picks for the next
// week. Requires every entry to have a COMPLETE, valid set of picks first
// (which now also requires every game to have a line set -- see
// cpValidatePicks()) -- an entry with incomplete/invalid picks blocks the
// whole pool's week from closing, same as how a Splash sheet works in real
// life (you can't submit a partial confidence sheet).
function cpCloseWeek(pool){
  const problems=[];
  pool.entries.forEach(e=>{
    const v=cpValidatePicks(pool,e,true);
    if(!v.valid) problems.push(`${e.name}: ${v.errors[0]}${v.errors.length>1?` (+${v.errors.length-1} more)`:""}`);
  });
  return {problems, apply:()=>{
    const archivedAt=new Date().toISOString();
    pool.entries.forEach(e=>{
      const games=(pool.games||[]).map(g=>{
        const p=e.picks[g.key]||{};
        return {
          key:g.key, away:g.away, home:g.home, line:g.line,
          providerGameId:g.providerGameId||null,
          cfbdGameId:null, cfbdSeason:null, cfbdHomeTeamId:null, cfbdAwayTeamId:null, // filled server-side at grading time if resolvable
          team:p.team, points:p.points,
          result:null, pointsEarned:null,
        };
      });
      e.history.unshift({week:(pool.currentWeekNumber||1),
        season:new Date().getFullYear(), weekLabel:pool.weekLabel, archivedAt, games,
        totalPoints:null, possiblePoints:null});
      e.picks={};
    });
    pool.games=[];
    const wkNum=(pool.currentWeekNumber||1)+1;
    pool.currentWeekNumber=wkNum;
    pool.weekLabel="Week "+wkNum;
    save();
  }};
}

function cpDeletePool(poolId){
  state.confidencePools=state.confidencePools.filter(p=>p.id!==poolId);
  if(state.confidenceActivePoolId===poolId) state.confidenceActivePoolId=null;
  save();
}

// "Colorado +6.5" / "Georgia Tech -6.5" -- matches the exact convention
// Splash's own sheet uses (see the reference screenshots), so the number
// on each pick button is unambiguous and needs no separate "reference"
// column alongside it.
function cpSideLabel(game,side){
  const name=side==="home"?game.home:game.away;
  if(game.line==null) return name;
  const sideLine=side==="home"?Number(game.line):-Number(game.line);
  const sign=sideLine>0?"+":"";
  return `${name} ${sign}${sideLine}`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderConfidenceTab(){
  const mount=document.getElementById("confidenceMount");
  if(!mount) return;
  const pools=cpPools().filter(p=>!p.archived);
  if(!pools.length){
    mount.innerHTML=`<div class="card">
      <h2>🎯 Confidence pools</h2>
      <p class="sub">Rank every game by how confident you are AGAINST THE SPREAD -- highest points on your most confident pick. Set up your first pool below.</p>
      <div class="row-f" style="margin-top:14px;">
        <input type="text" id="cpNewPoolName" placeholder="Pool name (e.g. Splash Confidence)" class="grow">
        <input type="number" id="cpNewPoolPickCount" placeholder="Pick count (blank = every game)" min="1" style="max-width:220px;">
        <button class="btn btn-light" id="cpCreatePoolBtn">+ Create pool</button>
      </div>
    </div>`;
    document.getElementById("cpCreatePoolBtn").onclick=()=>{
      const name=document.getElementById("cpNewPoolName").value;
      const pickCount=document.getElementById("cpNewPoolPickCount").value;
      cpCreatePool(name,pickCount);
      renderConfidenceTab();
    };
    return;
  }
  const pool=cpActivePool();
  const entry=cpActiveEntry(pool);
  mount.innerHTML=`
    <div class="card">
      <div class="row-f" style="align-items:center;">
        <select id="cpPoolSelect" class="grow">
          ${pools.map(p=>`<option value="${esc(p.id)}" ${p.id===pool.id?"selected":""}>${esc(p.name)} · ${esc(p.weekLabel||"Week 1")}</option>`).join("")}
        </select>
        <button class="iconbtn" id="cpNewPoolBtn" title="Create another confidence pool">+ New pool</button>
        <button class="iconbtn" id="cpDeletePoolBtn" title="Delete this pool">🗑</button>
      </div>
      <p class="sub" style="margin-top:8px;">
        ${pool.pickCount==null?`Pick every game against the spread this week — points run 1-${(pool.games||[]).length||"N"}.`:`Pick exactly ${pool.pickCount} of this week's games against the spread — points run 1-${pool.pickCount}.`}
        <button class="linklike" id="cpEditPickCountBtn" style="margin-left:8px;">edit</button>
      </p>
      <p class="sub" style="margin-top:4px;">
        ${pool.dropLowestWeeks?`Your ${pool.dropLowestWeeks} lowest-scoring week${pool.dropLowestWeeks===1?"":"s"} will be dropped from season standings.`:`No weeks are dropped from season standings.`}
        <button class="linklike" id="cpEditDropWeeksBtn" style="margin-left:8px;">edit</button>
      </p>
    </div>

    <div class="card" id="cpGamesCard">
      <h2>This week's games <span class="sub" style="font-weight:400;">(${(pool.games||[]).length})</span></h2>
      <div id="cpGamesList">${cpGamesListHTML(pool)}</div>
      <details style="margin-top:10px;" ${cpAddGamesOpen[pool.id]?"open":""}>
        <summary class="pred-summary"><span class="pred-summary-title">+ Add games</span></summary>
        <div class="pred-panel-body">${cpAddGamesHTML(pool)}</div>
      </details>
      ${(pool.games||[]).length?`<button class="btn btn-light" id="cpCloseWeekBtn" style="margin-top:12px;">Close week &amp; archive picks</button>`:""}
    </div>

    <div class="card" id="cpEntriesCard">
      <h2>Entries</h2>
      <div class="row-f" style="flex-wrap:wrap;gap:6px;">
        ${pool.entries.map(e=>`<button class="chip-btn ${entry&&e.id===entry.id?"active":""}" data-cp-entry="${esc(e.id)}">${esc(e.name)}</button>`).join("")}
      </div>
      <div class="row-f" style="margin-top:10px;">
        <input type="text" id="cpNewEntryName" placeholder="New entry name" class="grow">
        <button class="btn btn-light" id="cpAddEntryBtn">+ Add entry</button>
      </div>
    </div>

    ${entry?`<div class="card" id="cpPicksCard">
      <h2>${esc(entry.name)}'s picks</h2>
      ${cpPicksHTML(pool,entry)}
    </div>`:""}

    <div class="card" id="cpStandingsCard">
      <h2>Season standings</h2>
      ${cpStandingsHTML(pool)}
    </div>
  `;
  wireConfidenceTab(pool,entry);
}

function cpGamesListHTML(pool){
  const games=pool.games||[];
  if(!games.length) return `<p class="note">No games added yet -- use "+ Add games" below.</p>`;
  return `<div class="cp-games-list">${games.map(g=>`
    <div class="cp-game-row">
      <span class="cp-game-teams">${esc(g.away)} @ ${esc(g.home)}</span>
      <span class="sub">${g.commence?kickStr(g.commence):""}</span>
      <label class="cp-line-edit sub">Line (home)
        <input type="number" step="0.5" class="cp-line-input" data-cp-line-for="${esc(g.key)}" value="${g.line!=null?g.line:""}" placeholder="required">
      </label>
      <button class="iconbtn" data-cp-remove-game="${esc(g.key)}" aria-label="Remove">✕</button>
    </div>`).join("")}</div>`;
}

function cpAddGamesHTML(pool){
  const boardGames=cpBoardGamesForAdd();
  const existingKeys=new Set((pool.games||[]).map(g=>g.key));
  const rows=boardGames.filter(g=>!existingKeys.has(mkey(g.away,g.home))).map(g=>{
    const k=esc(mkey(g.away,g.home));
    return `<label class="pool-manual-row">
      <input type="checkbox" data-cp-board-check="${k}" data-cp-away="${esc(g.away)}" data-cp-home="${esc(g.home)}" data-cp-commence="${esc(g.commence||"")}" data-cp-line="${g.vegas!=null?g.vegas:""}" data-cp-provider="${esc(g.id||"")}">
      <span class="pool-manual-teams">${esc(g.away)} @ ${esc(g.home)}</span>
      <span class="sub">${g.vegas!=null?`Line ${g.vegas>0?"+":""}${g.vegas}`:"no line yet"}</span>
    </label>`;
  }).join("");
  return `
    <p class="sub" style="margin-top:0;">Check games off the live board (starting line prefilled from the live market -- edit it below to match your actual sheet), or add one by hand. No Splash confidence PDF importer yet -- send a sample sheet and it'll plug in here the same way Powers PDF does for the Edge Board.</p>
    <div class="pool-manual-list">${rows||'<div class="pool-manual-empty">No live games loaded -- refresh lines on the Edge Board, or add by hand below.</div>'}</div>
    <div class="pool-manual-custom" style="margin-top:10px;">
      <div style="font-size:11px;color:var(--muted);margin:8px 0 4px;">Game not listed? Add it by hand:</div>
      <div class="pool-manual-custom-add">
        <input type="text" id="cpCustomAway" placeholder="Away team">
        <input type="text" id="cpCustomHome" placeholder="Home team">
        <input type="number" step="0.5" id="cpCustomLine" placeholder="Line (home team)">
        <button class="iconbtn" id="cpAddCustomBtn">+ add game</button>
      </div>
      <div class="pool-manual-custom-list">${cpManualCustomGames.map((g,i)=>`<div class="pool-manual-custom-row"><span>${esc(g.away)} @ ${esc(g.home)} · ${g.line!=null?(g.line>0?"+":"")+g.line:"no line"}</span><button class="pool-manual-remove" data-cp-remove-custom="${i}" aria-label="Remove">✕</button></div>`).join("")}</div>
    </div>
    <button class="btn btn-light" id="cpSaveGamesBtn" style="margin-top:10px;">Save selected games</button>
  `;
}

function cpPicksHTML(pool,entry){
  const games=pool.games||[];
  if(!games.length) return `<p class="note">Add this week's games above before making picks.</p>`;
  const maxPoints=cpMaxPoints(pool);
  const used=new Set(cpUsedPointValues(pool,entry));
  const v=cpValidatePicks(pool,entry,false);
  const rows=games.map(g=>{
    const p=entry.picks[g.key]||{};
    const pointOptions=Array.from({length:maxPoints},(_,i)=>i+1).map(n=>{
      const takenByOther=used.has(n)&&Number(p.points)!==n;
      return `<option value="${n}" ${Number(p.points)===n?"selected":""} ${takenByOther?"disabled":""}>${n}${takenByOther?" (used)":""}</option>`;
    }).join("");
    return `<div class="cp-pick-row">
      <div class="cp-pick-teams">
        <button class="cp-team-btn ${p.team==="away"?"active":""}" data-cp-pick-team="${esc(g.key)}" data-team="away">${esc(cpSideLabel(g,"away"))}</button>
        <span class="sub">@</span>
        <button class="cp-team-btn ${p.team==="home"?"active":""}" data-cp-pick-team="${esc(g.key)}" data-team="home">${esc(cpSideLabel(g,"home"))}</button>
      </div>
      <select class="cp-points-select" data-cp-pick-points="${esc(g.key)}">
        <option value="">pts</option>
        ${pointOptions}
      </select>
    </div>`;
  }).join("");
  const errorsHTML=v.errors.length?`<div class="err" style="margin-top:10px;">${v.errors.map(e=>esc(e)).join("<br>")}</div>`:
    `<div class="ok" style="margin-top:10px;">${v.pickedCount} of ${v.required} picks made — looks good.</div>`;
  return `<div class="cp-picks-list">${rows}</div>${errorsHTML}`;
}

function cpStandingsHTML(pool){
  if(!pool.entries.some(e=>e.history.length)) return `<p class="note">No graded weeks yet — standings appear once a week is closed and results are checked.</p>`;
  const drop=pool.dropLowestWeeks||0;
  const rows=pool.entries.map(e=>{
    const s=cpSeasonTotal(e,drop);
    return {name:e.name, ...s};
  }).sort((a,b)=>b.points-a.points);
  return `<table class="cp-standings-table"><thead><tr><th>Entry</th><th>Points</th><th>Possible</th><th>Weeks</th>${drop?"<th>Dropped</th>":""}</tr></thead><tbody>
    ${rows.map(r=>`<tr><td>${esc(r.name)}</td><td><b>${r.points}</b></td><td>${r.possible}</td><td>${r.weeksGraded}</td>${drop?`<td>${r.weeksDropped}</td>`:""}</tr>`).join("")}
  </tbody></table>`;
}

function wireConfidenceTab(pool,entry){
  const sel=document.getElementById("cpPoolSelect");
  if(sel) sel.onchange=()=>cpSetActivePool(sel.value);
  const newPoolBtn=document.getElementById("cpNewPoolBtn");
  if(newPoolBtn) newPoolBtn.onclick=async()=>{
    const name=await pgPrompt({title:"New confidence pool",message:"Pool name:"});
    if(name==null) return;
    cpCreatePool(name,null);
    renderConfidenceTab();
  };
  const delBtn=document.getElementById("cpDeletePoolBtn");
  if(delBtn) delBtn.onclick=async()=>{
    const ok=await pgConfirm({title:"Delete this confidence pool?",message:`"${pool.name}" and all its entries/history will be permanently deleted.`});
    if(!ok) return;
    cpDeletePool(pool.id);
    renderConfidenceTab();
  };
  const editPickCountBtn=document.getElementById("cpEditPickCountBtn");
  if(editPickCountBtn) editPickCountBtn.onclick=async()=>{
    const raw=await pgPrompt({title:"Pick count",message:"How many games must be picked each week? Leave blank for every game."});
    if(raw===null) return;
    pool.pickCount=(raw.trim()==="")?null:Math.max(1,Math.floor(Number(raw)));
    save(); renderConfidenceTab();
  };
  const editDropWeeksBtn=document.getElementById("cpEditDropWeeksBtn");
  if(editDropWeeksBtn) editDropWeeksBtn.onclick=async()=>{
    const raw=await pgPrompt({title:"Drop lowest weeks",message:"How many of your lowest-scoring weeks should be dropped from season standings? Leave blank or 0 for none (matches a rule like Splash's own \"your 2 lowest-scoring weeks will be dropped\")."});
    if(raw===null) return;
    const n=Math.max(0,Math.floor(Number(raw)||0));
    pool.dropLowestWeeks=n>0?n:null;
    save(); renderConfidenceTab();
  };
  document.querySelectorAll("[data-cp-remove-game]").forEach(b=>{
    b.onclick=()=>{ cpRemoveGameFromPool(pool,b.dataset.cpRemoveGame); renderConfidenceTab(); };
  });
  document.querySelectorAll("[data-cp-line-for]").forEach(inp=>{
    inp.onchange=()=>{ cpSetGameLine(pool,inp.dataset.cpLineFor,inp.value); renderConfidenceTab(); };
  });
  const saveGamesBtn=document.getElementById("cpSaveGamesBtn");
  if(saveGamesBtn) saveGamesBtn.onclick=()=>{
    document.querySelectorAll("[data-cp-board-check]:checked").forEach(cb=>{
      cpAddGameToPool(pool,{
        away:cb.dataset.cpAway, home:cb.dataset.cpHome, commence:cb.dataset.cpCommence||null,
        providerGameId:cb.dataset.cpProvider||null,
        line:cb.dataset.cpLine!==""?Number(cb.dataset.cpLine):null,
      });
    });
    cpManualCustomGames.forEach(g=>cpAddGameToPool(pool,g));
    cpManualCustomGames=[];
    cpAddGamesOpen[pool.id]=false;
    renderConfidenceTab();
  };
  const addCustomBtn=document.getElementById("cpAddCustomBtn");
  if(addCustomBtn) addCustomBtn.onclick=async()=>{
    const away=(document.getElementById("cpCustomAway").value||"").trim();
    const home=(document.getElementById("cpCustomHome").value||"").trim();
    const lineRaw=document.getElementById("cpCustomLine").value;
    if(!away||!home){ await pgAlert({title:"Missing team names",message:"Enter both an away and a home team."}); return; }
    const line=(lineRaw===""||isNaN(Number(lineRaw)))?null:Number(lineRaw);
    cpManualCustomGames.push({away,home,line});
    cpAddGamesOpen[pool.id]=true;
    renderConfidenceTab();
  };
  document.querySelectorAll("[data-cp-remove-custom]").forEach(b=>{
    b.onclick=()=>{ cpManualCustomGames.splice(Number(b.dataset.cpRemoveCustom),1); cpAddGamesOpen[pool.id]=true; renderConfidenceTab(); };
  });
  const addGamesDetails=document.querySelector("#cpGamesCard details");
  if(addGamesDetails) addGamesDetails.addEventListener("toggle",()=>{ cpAddGamesOpen[pool.id]=addGamesDetails.open; });
  const closeWeekBtn=document.getElementById("cpCloseWeekBtn");
  if(closeWeekBtn) closeWeekBtn.onclick=async()=>{
    const result=cpCloseWeek(pool);
    if(result.problems.length){
      await pgAlert({title:"Can't close this week yet",message:result.problems.join("\n")});
      return;
    }
    const ok=await pgConfirm({title:"Close "+esc(pool.weekLabel)+"?",message:"Every entry's picks will be locked in and archived. This week's game list will clear for the next week."});
    if(!ok) return;
    result.apply();
    renderConfidenceTab();
  };
  document.querySelectorAll("[data-cp-entry]").forEach(b=>{
    b.onclick=()=>cpSetActiveEntry(pool,b.dataset.cpEntry);
  });
  const addEntryBtn=document.getElementById("cpAddEntryBtn");
  if(addEntryBtn) addEntryBtn.onclick=()=>{
    const nameEl=document.getElementById("cpNewEntryName");
    cpAddEntry(pool,nameEl.value);
    nameEl.value="";
  };
  if(entry){
    document.querySelectorAll("[data-cp-pick-team]").forEach(b=>{
      b.onclick=()=>{
        const key=b.dataset.cpPickTeam, team=b.dataset.team;
        const cur=entry.picks[key]||{};
        entry.picks[key]={team:(cur.team===team?null:team), points:cur.points!=null?cur.points:null};
        save(); renderConfidenceTab();
      };
    });
    document.querySelectorAll("[data-cp-pick-points]").forEach(sel=>{
      sel.onchange=()=>{
        const key=sel.dataset.cpPickPoints;
        const cur=entry.picks[key]||{};
        const val=sel.value===""?null:Number(sel.value);
        entry.picks[key]={team:cur.team||null, points:val};
        save(); renderConfidenceTab();
      };
    });
  }
}

