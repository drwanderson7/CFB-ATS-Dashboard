// --- My Numbers -----------------------------------------------------------
// Personal projected spreads supplied by the signed-in user. Phase 1 supports
// inline manual entry on the Edge Board plus CSV import/template download.
// These numbers are PRIVATE user state and intentionally do NOT alter the
// branded PickGauge Model # or the customizable Model #. They get their own
// independent edge calculation against the same reference line the current
// board is using (live Vegas on Overall; locked pool line once a pool locks).
//
// Persistence is season/week scoped rather than pool scoped: the user's view
// of Alabama @ Auburn should be the same number whether they are looking at
// Overall or one of several pools containing that game. Records carry stable
// CFBD/Odds ids when available and team names as the fallback identity so they
// can survive provider/name changes and still match older data.

// Also uses `uid()` (main inline script) to give each record a stable id
// for the performance-tracking section below, and `currentWeekIndex()`
// (main inline script) to determine which scope key is "the current week"
// (excluded from grading -- see myNumbersGradableRecords()).
let myNumbersPendingReview=[];

function myNumbersWeekIndexForGame(g){
  if(g&&g.commence){
    const idx=weekIndexOf(g.commence);
    if(idx!=null) return idx;
  }
  const pool=currentPool();
  if(pool&&pool.weekLabel){
    const m=String(pool.weekLabel).match(/(?:week\s*)?(-?\d+)/i);
    if(m) return Number(m[1]);
  }
  const idx=currentWeekIndex();
  return (typeof idx==="number"&&!isNaN(idx))?idx:0;
}
function myNumbersScopeKey(g){
  return `${seasonYear()}:week:${myNumbersWeekIndexForGame(g)}`;
}
function myNumbersBucket(g,create){
  if(!state.myNumbers||typeof state.myNumbers!=="object"||Array.isArray(state.myNumbers)){
    if(!create) return [];
    state.myNumbers={};
  }
  const key=myNumbersScopeKey(g);
  if(!Array.isArray(state.myNumbers[key])){
    if(!create) return [];
    state.myNumbers[key]=[];
  }
  return state.myNumbers[key];
}
function myNumbersRecordMatchesGame(rec,g){
  if(!rec||!g) return false;
  if(rec.cfbdGameId!=null&&g.cfbdGameId!=null&&String(rec.cfbdGameId)===String(g.cfbdGameId)) return true;
  if(rec.providerGameId&&g.providerGameId&&String(rec.providerGameId)===String(g.providerGameId)) return true;
  return !!(rec.away&&rec.home&&teamMatchTrunc(rec.away,g.away)&&teamMatchTrunc(rec.home,g.home));
}
function myNumberRecordForGame(g){
  return myNumbersBucket(g,false).find(rec=>myNumbersRecordMatchesGame(rec,g))||null;
}
function userNumberFor(g){
  const rec=myNumberRecordForGame(g);
  if(!rec||rec.value==null||rec.value===""||isNaN(rec.value)) return null;
  return Number(rec.value);
}
function setUserNumber(g,value,opts){
  opts=opts||{};
  if(!g) return;
  const bucket=myNumbersBucket(g,true);
  const idx=bucket.findIndex(rec=>myNumbersRecordMatchesGame(rec,g));
  const empty=value==null||value===""||isNaN(value);
  if(empty){
    if(idx>=0) bucket.splice(idx,1);
  }else{
    const existing=idx>=0?bucket[idx]:null;
    const graded=!!(existing&&existing.result);
    const rec={
      id:(existing&&existing.id)||uid(),
      away:g.away,
      home:g.home,
      value:round1(Number(value)),
      cfbdGameId:g.cfbdGameId!=null?g.cfbdGameId:null,
      providerGameId:g.providerGameId||null,
      updatedAt:new Date().toISOString(),
    };
    // Freeze the market reference the moment a number is entered/edited --
    // same "capture now, don't silently recompute later" rule the app
    // already applies to real picks (see pickTeam()'s decision snapshot in
    // app/js/picks.js). This keeps moving while the record is still
    // ungraded (each edit reflects "the market when I last committed to
    // this number"), but never again once graded -- that's the whole point
    // of "freeze historical inputs" for myNumbersPerformanceStats() below.
    // A later market move or Model # change must never retroactively
    // change a graded week's edge.
    if(graded){
      rec.vegasAtEntry=existing.vegasAtEntry;
      rec.result=existing.result;
      rec.gradedEdgePts=existing.gradedEdgePts;
      rec.gradedSide=existing.gradedSide;
      rec.gradedTeam=existing.gradedTeam;
      rec.gradedAt=existing.gradedAt;
    }else{
      const V=(g&&g.vegas!=null&&!isNaN(g.vegas))?round1(Number(g.vegas)):null;
      rec.vegasAtEntry=V!=null?V:(existing?existing.vegasAtEntry:null);
    }
    if(idx>=0) bucket[idx]=rec; else bucket.push(rec);
  }
  // Don't leave empty week buckets behind forever as users clear values.
  const scope=myNumbersScopeKey(g);
  if(state.myNumbers&&Array.isArray(state.myNumbers[scope])&&!state.myNumbers[scope].length) delete state.myNumbers[scope];
  if(!opts.deferSave) save();
}

function myNumbersEdge(g){
  const M=userNumberFor(g);
  const V=g&&g.vegas!=null&&!isNaN(g.vegas)?Number(g.vegas):null;
  if(M==null||V==null) return null;
  const pts=round1(Math.abs(V-M));
  if(pts===0) return {pts:0,side:null,team:null,line:null};
  if(M<V) return {pts,side:"home",team:g.home,line:V};
  return {pts,side:"away",team:g.away,line:-V};
}
function myNumbersEdgeHTML(g){
  const e=myNumbersEdge(g);
  if(!e) return `<span class="my-num-edge faint">${g&&g.vegas==null?"no market line":"enter line"}</span>`;
  if(e.pts===0) return `<span class="my-num-edge">My edge 0.0 · no lean</span>`;
  const cls=edgeClass(e.pts);
  return `<span class="my-num-edge ${cls}">My edge ${fmt(e.pts).replace("-","")} · ${esc(e.team)}</span>`;
}
// --- My Numbers performance tracking (#18) ---------------------------------
// Tracks the user's OWN projection accuracy over time, independent of
// whatever pool picks they actually made -- a game can have a My Number on
// it with no pick attached at all. Grading is manual (same W/L/P button
// pattern Results already uses for real picks in app/js/record.js, not a
// new CFBD auto-grading pipeline), because My Numbers apply broadly across
// every board game regardless of pick status, so there's no existing
// archive-on-close hook to attach automatic grading to the way real picks
// have via api/grade_picks.py's history-shaped records.
//
// The "frozen" edge here (myNumbersRecordEdge) is DELIBERATELY separate
// from myNumbersEdge(g) above: the board cell's edge is live (recomputed
// against today's market every render), but a historical performance
// number must never move once graded -- it uses rec.vegasAtEntry, captured
// by setUserNumber() at entry time and frozen for good once rec.result is
// set, never today's live g.vegas.
function myNumbersRecordEdge(rec){
  if(!rec||rec.value==null||rec.vegasAtEntry==null) return null;
  const M=Number(rec.value),V=Number(rec.vegasAtEntry);
  if(isNaN(M)||isNaN(V)) return null;
  const pts=round1(Math.abs(V-M));
  if(pts===0) return {pts:0,side:null,team:null};
  if(M<V) return {pts,side:"home",team:rec.home};
  return {pts,side:"away",team:rec.away};
}
// The CURRENT week's own scope key -- excluded from grading eligibility
// below since that slate hasn't been played yet. Mirrors
// myNumbersScopeKey(g)'s own key shape but for "right now" rather than a
// specific game's commence time.
function myNumbersCurrentScopeKey(){
  const idx=currentWeekIndex();
  return `${seasonYear()}:week:${(typeof idx==="number"&&!isNaN(idx))?idx:0}`;
}
// Every ungraded My Number from a PAST week that actually implies a lean
// (pts>0 -- a flat 0 edge means the user's number matched the market
// exactly, nothing to grade). Newest week first.
function myNumbersGradableRecords(){
  if(!state.myNumbers||typeof state.myNumbers!=="object"||Array.isArray(state.myNumbers)) return [];
  const currentKey=myNumbersCurrentScopeKey();
  const out=[];
  Object.keys(state.myNumbers).forEach(key=>{
    if(key===currentKey) return;
    (state.myNumbers[key]||[]).forEach(rec=>{
      if(rec.result) return;
      const edge=myNumbersRecordEdge(rec);
      if(!edge||!edge.pts) return;
      out.push({scopeKey:key,rec,edge});
    });
  });
  out.sort((a,b)=>String(b.scopeKey).localeCompare(String(a.scopeKey)));
  return out;
}
// Toggle-style grading -- clicking the already-active result clears it,
// same interaction Results already uses for real picks (setResult(),
// app/js/record.js). Freezes gradedEdgePts/gradedSide/gradedTeam from the
// frozen rec.vegasAtEntry at the moment of grading; a later edit to this
// same game's My Number (setUserNumber() above) will then preserve these
// graded fields untouched rather than recomputing them.
function setMyNumbersResult(scopeKey,recordId,result){
  if(!state.myNumbers||!Array.isArray(state.myNumbers[scopeKey])) return false;
  const rec=state.myNumbers[scopeKey].find(r=>r.id===recordId);
  if(!rec) return false;
  if(rec.result===result){
    delete rec.result; delete rec.gradedEdgePts; delete rec.gradedSide; delete rec.gradedTeam; delete rec.gradedAt;
  }else{
    const edge=myNumbersRecordEdge(rec);
    rec.result=result;
    rec.gradedEdgePts=edge?edge.pts:null;
    rec.gradedSide=edge?edge.side:null;
    rec.gradedTeam=edge?edge.team:null;
    rec.gradedAt=new Date().toISOString();
  }
  save();
  return true;
}
// Aggregate ATS record / win rate / average edge / edge-bucket breakdown
// across every graded record, in every week, in every scope key -- this is
// the "historical performance" the raw per-cell My edge label never shows.
// Bucket boundaries deliberately match recordAnalytics()'s own edgeBuckets
// (app/js/record.js) so the same edge-size language means the same thing
// in both places.
function myNumbersPerformanceStats(){
  const graded=[];
  if(state.myNumbers&&typeof state.myNumbers==="object"&&!Array.isArray(state.myNumbers)){
    Object.values(state.myNumbers).forEach(bucket=>{
      (bucket||[]).forEach(rec=>{ if(rec.result==="W"||rec.result==="L"||rec.result==="P") graded.push(rec); });
    });
  }
  const W=graded.filter(r=>r.result==="W").length;
  const L=graded.filter(r=>r.result==="L").length;
  const P=graded.filter(r=>r.result==="P").length;
  const decisions=W+L;
  const winPct=decisions?Math.round((W/decisions)*1000)/10:null;
  const edgeVals=graded.map(r=>r.gradedEdgePts).filter(v=>v!=null&&!isNaN(v));
  const avgEdge=edgeVals.length?round1(edgeVals.reduce((a,b)=>a+b,0)/edgeVals.length):null;
  const bucketDefs=[
    {label:"0.1–1.4",test:v=>v>0&&v<1.5},
    {label:"1.5–2.9",test:v=>v>=1.5&&v<3},
    {label:"3.0–4.9",test:v=>v>=3&&v<5},
    {label:"5.0+",test:v=>v>=5},
  ];
  const buckets=bucketDefs.map(d=>{
    const rows=graded.filter(r=>r.gradedEdgePts!=null&&d.test(r.gradedEdgePts));
    const w=rows.filter(r=>r.result==="W").length;
    const l=rows.filter(r=>r.result==="L").length;
    const p=rows.filter(r=>r.result==="P").length;
    const dec=w+l;
    return {label:d.label,W:w,L:l,P:p,n:rows.length,pct:dec?Math.round((w/dec)*1000)/10:null};
  });
  return {W,L,P,decisions,winPct,avgEdge,graded:graded.length,buckets};
}
function renderMyNumbersPerformance(){
  const summaryEl=document.getElementById("myNumbersPerfSummary");
  const bucketsEl=document.getElementById("myNumbersPerfBuckets");
  const ungradedEl=document.getElementById("myNumbersPerfUngraded");
  if(!summaryEl&&!bucketsEl&&!ungradedEl) return;
  const stats=myNumbersPerformanceStats();
  if(summaryEl){
    summaryEl.textContent=stats.graded
      ? `${stats.W}-${stats.L}-${stats.P}${stats.winPct!=null?` · ${stats.winPct}% win rate`:""}${stats.avgEdge!=null?` · avg edge ${fmt(stats.avgEdge).replace("-","")} pts`:""} · ${stats.graded} graded`
      : "No graded games yet. Grade a past week below once you know how the numbers played out.";
  }
  if(bucketsEl){
    const rows=stats.buckets.filter(b=>b.n>0);
    bucketsEl.innerHTML=rows.length
      ? rows.map(b=>`<div class="pl-row"><span class="pl-team">${esc(b.label)} pts</span><span class="pl-meta">${b.W}-${b.L}-${b.P}${b.pct!=null?` · ${b.pct}%`:""} (n=${b.n})</span></div>`).join("")
      : "";
  }
  if(ungradedEl){
    const items=myNumbersGradableRecords();
    if(!items.length){
      ungradedEl.innerHTML=`<p class="note" style="margin:0;">No past-week My Numbers awaiting grading.</p>`;
    }else{
      ungradedEl.innerHTML=items.map(({scopeKey,rec,edge})=>{
        const mkBtn=(r,label)=>`<button type="button" class="resbtn ${rec.result===r?"active-"+r:""}" data-perf-scope="${esc(scopeKey)}" data-perf-record="${esc(rec.id)}" data-perf-res="${r}">${label}</button>`;
        return `<div class="pl-row">
          <div><span class="pl-team">${esc(edge.team||"")}</span><span class="pl-meta" style="margin-left:8px;">${esc(rec.away)} @ ${esc(rec.home)} · my edge ${fmt(edge.pts).replace("-","")} vs ${fmt(rec.vegasAtEntry)}</span></div>
          <span class="resgroup">${mkBtn("W","W")}${mkBtn("L","L")}${mkBtn("P","P")}</span>
        </div>`;
      }).join("");
      ungradedEl.querySelectorAll("[data-perf-record]").forEach(btn=>{
        btn.onclick=()=>{
          setMyNumbersResult(btn.dataset.perfScope,btn.dataset.perfRecord,btn.dataset.perfRes);
          renderMyNumbersPerformance();
        };
      });
    }
  }
}
function myNumbersCellHTML(g){
  const val=userNumberFor(g);
  const home=g&&g.home?g.home:"home";
  return `<div class="my-num-edit-wrap">
    <input class="my-num-inp" type="number" inputmode="decimal" step="0.5" data-my-number="${esc(g.key)}" value="${val==null?"":esc(val)}" placeholder="—" aria-label="My projected home-team line for ${esc(g.away)} at ${esc(g.home)}" title="Enter your projected spread from the home-team perspective. ${esc(home)} -7 = -7; away team -3 = +3.">
    <button type="button" class="my-num-clear-one" data-my-number-clear="${esc(g.key)}" title="Clear My Number for this game" aria-label="Clear My Number for ${esc(g.away)} at ${esc(g.home)}" ${val==null?'style="visibility:hidden"':""}>×</button>
  </div>${myNumbersEdgeHTML(g)}`;
}
function updateMyNumbersCell(key){
  const g=games.find(x=>x.key===key); if(!g) return;
  const cell=document.querySelector(`[data-my-number-cell="${CSS.escape(key)}"]`);
  if(cell) cell.innerHTML=myNumbersCellHTML(g);
  bindMyNumbersRowInputs(cell||document);
  renderMyNumbersControls();
}

function currentMyNumbersCount(){
  return games.reduce((n,g)=>n+(userNumberFor(g)!=null?1:0),0);
}
function renderMyNumbersControls(){
  const count=document.getElementById("myNumbersCount");
  if(count) count.textContent=`${currentMyNumbersCount()} of ${games.length} entered`;
  const note=document.getElementById("myNumbersContextNote");
  if(note){
    const pool=currentPool();
    const week=(pool&&pool.weekLabel)?pool.weekLabel:weekLabel(currentWeekIndex());
    note.textContent=`Saved to your account for ${seasonYear()} ${week}. The same game uses the same My Number across Overall and your pools.`;
  }
  renderMyNumbersReview();
  renderMyNumbersPerformance();
}

function bindMyNumbersRowInputs(root){
  (root||document).querySelectorAll("[data-my-number]").forEach(el=>{
    if(el.dataset.myBound==="1") return;
    el.dataset.myBound="1";
    el.addEventListener("input",()=>{
      const g=games.find(x=>x.key===el.dataset.myNumber); if(!g) return;
      const value=el.value===""?null:Number(el.value);
      setUserNumber(g,value);
      const cell=el.closest("[data-my-number-cell]");
      if(cell){
        const edge=cell.querySelector(".my-num-edge");
        if(edge){
          const holder=document.createElement("div"); holder.innerHTML=myNumbersEdgeHTML(g);
          edge.replaceWith(holder.firstElementChild);
        }
        const clear=cell.querySelector("[data-my-number-clear]");
        if(clear) clear.style.visibility=value==null?"hidden":"visible";
      }
      renderMyNumbersControls();
    });
    el.addEventListener("change",()=>{
      if(el.value!==""&&typeof trackBetaEvent==="function") trackBetaEvent("my_numbers_manual",{source:"manual"});
    });
  });
  (root||document).querySelectorAll("[data-my-number-clear]").forEach(btn=>{
    if(btn.dataset.myBound==="1") return;
    btn.dataset.myBound="1";
    btn.addEventListener("click",()=>{
      const g=games.find(x=>x.key===btn.dataset.myNumberClear); if(!g) return;
      setUserNumber(g,null);
      updateMyNumbersCell(g.key);
    });
  });
}

function csvEscape(value){
  const s=String(value==null?"":value);
  return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function parseCsvRows(text){
  const rows=[]; let row=[],field="",quoted=false;
  const s=String(text||"").replace(/^\uFEFF/,"");
  for(let i=0;i<s.length;i++){
    const ch=s[i];
    if(quoted){
      if(ch==='"'&&s[i+1]==='"'){ field+='"'; i++; }
      else if(ch==='"') quoted=false;
      else field+=ch;
    }else if(ch==='"') quoted=true;
    else if(ch===","){ row.push(field); field=""; }
    else if(ch==="\n"){ row.push(field); rows.push(row); row=[]; field=""; }
    else if(ch!=="\r") field+=ch;
  }
  row.push(field);
  if(row.some(x=>String(x).trim()!=="")||rows.length===0) rows.push(row);
  return rows;
}
function myNumbersHeaderKey(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function findMyNumbersColumn(headers,candidates){
  const keys=headers.map(myNumbersHeaderKey);
  for(const c of candidates){ const i=keys.indexOf(c); if(i>=0) return i; }
  return -1;
}
function parseMyNumbersCsv(text){
  const rows=parseCsvRows(text);
  if(rows.length<2) return {rows:[],error:"CSV needs a header row and at least one game."};
  const headers=rows[0].map(x=>String(x).trim());
  const awayI=findMyNumbersColumn(headers,["awayteam","away","roadteam","road","visitor","visitingteam"]);
  const homeI=findMyNumbersColumn(headers,["hometeam","home"]);
  const lineI=findMyNumbersColumn(headers,["myline","mynumber","projectedline","projection","spread","line"]);
  if(awayI<0||homeI<0||lineI<0) return {rows:[],error:"Use columns Away Team, Home Team, and My Line."};
  const out=[];
  rows.slice(1).forEach((r,idx)=>{
    const away=String(r[awayI]||"").trim(), home=String(r[homeI]||"").trim(), raw=String(r[lineI]||"").trim();
    if(!away&&!home&&!raw) return;
    out.push({rowNumber:idx+2,away,home,raw});
  });
  return {rows:out,error:null};
}
function parseMyNumbersLine(raw,away,home){
  const s=String(raw||"").trim();
  if(!s) return {value:null,error:"missing line"};
  if(/^(pk|pick|pickem|pick'em|even)$/i.test(s)) return {value:0,error:null};
  if(/^[-+]?\d+(?:\.\d+)?$/.test(s)) return {value:Number(s),error:null};
  // Also accept human-friendly "Georgia -7" / "Georgia +7". Convert the
  // named team's spread to PickGauge's home-team perspective.
  const m=s.match(/^(.*?)\s*([+-]\s*\d+(?:\.\d+)?)\s*$/);
  if(m){
    const team=m[1].trim(), n=Number(m[2].replace(/\s/g,""));
    if(teamMatchTrunc(team,home)) return {value:n,error:null};
    if(teamMatchTrunc(team,away)) return {value:-n,error:null};
  }
  return {value:null,error:"line must be a number, PK, or a team plus signed spread (for example Georgia -7)"};
}
function matchMyNumbersCsvGame(away,home){
  const matches=games.filter(g=>teamMatchTrunc(away,g.away)&&teamMatchTrunc(home,g.home));
  return matches.length===1?matches[0]:null;
}
function applyMyNumbersCsvText(text){
  const parsed=parseMyNumbersCsv(text);
  if(parsed.error) return {matched:0,review:[],error:parsed.error,total:0};
  let matched=0;
  const review=[];
  parsed.rows.forEach(r=>{
    const line=parseMyNumbersLine(r.raw,r.away,r.home);
    const g=line.error?null:matchMyNumbersCsvGame(r.away,r.home);
    if(g){ setUserNumber(g,line.value,{deferSave:true}); matched++; }
    else review.push({...r,value:line.value,reason:line.error||"game did not match this board"});
  });
  if(matched) save();
  myNumbersPendingReview=review;
  return {matched,review,error:null,total:parsed.rows.length};
}

async function importMyNumbersFile(file){
  if(typeof betaRememberAction==="function") betaRememberAction("my_numbers_csv_import",{source:"csv"});
  const status=document.getElementById("myNumbersImportStatus");
  if(!file) return;
  if(!/\.csv$/i.test(file.name||"")){
    if(status){ status.className="err"; status.textContent="Choose a .csv file."; }
    return;
  }
  try{
    const result=applyMyNumbersCsvText(await file.text());
    if(result.error){
      if(status){ status.className="err"; status.textContent=result.error; }
      renderMyNumbersReview(); return;
    }
    if(status){
      status.className=result.review.length?"note":"ok";
      status.textContent=`Imported ${result.matched} of ${result.total} row${result.total===1?"":"s"}${result.review.length?`; ${result.review.length} need review.`:"."}`;
    }
    renderBoard();
    if(result.matched&&typeof trackBetaEvent==="function") trackBetaEvent("my_numbers_csv_import",{source:"csv"});
  }catch(e){
    if(status){ status.className="err"; status.textContent="Couldn't read that CSV."; }
  }
}
function downloadMyNumbersTemplate(){
  const header=["Away Team","Home Team","My Line"];
  const body=games.map(g=>[g.away,g.home,userNumberFor(g)==null?"":userNumberFor(g)]);
  const csv=[header,...body].map(r=>r.map(csvEscape).join(",")).join("\r\n");
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`pickgauge-my-numbers-${seasonYear()}-${weekLabel(currentWeekIndex()).toLowerCase().replace(/\s+/g,"-")}.csv`;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
async function clearCurrentMyNumbers(){
  const count=currentMyNumbersCount();
  if(!count) return;
  const ok=await pgConfirm({
    title:"Clear My Numbers?",
    eyebrow:"Current slate",
    message:`Remove ${count} My Number${count===1?"":"s"} currently shown on this slate? This won't change PickGauge Model #, picks, or other model inputs.`,
    confirmText:"Clear numbers",
    danger:true,
  });
  if(!ok) return;
  games.forEach(g=>setUserNumber(g,null,{deferSave:true}));
  save();
  myNumbersPendingReview=[];
  const status=document.getElementById("myNumbersImportStatus");
  if(status){ status.className="ok"; status.textContent="My Numbers cleared for this slate."; }
  renderBoard();
}
function renderMyNumbersReview(){
  const wrap=document.getElementById("myNumbersReview");
  if(!wrap) return;
  if(!myNumbersPendingReview.length){ wrap.style.display="none"; wrap.innerHTML=""; return; }
  wrap.style.display="block";
  wrap.innerHTML=`<div class="my-num-review-hdr">Review ${myNumbersPendingReview.length} unmatched CSV row${myNumbersPendingReview.length===1?"":"s"}</div>`+
    myNumbersPendingReview.map((r,i)=>{
      const opts=[`<option value="">Choose game…</option>`].concat(games.map(g=>`<option value="${esc(g.key)}">${esc(g.away)} @ ${esc(g.home)}</option>`)).join("");
      const val=r.value==null?"":fmt(r.value);
      return `<div class="my-num-review-row" data-my-review-row="${i}">
        <div><b>Row ${r.rowNumber}:</b> ${esc(r.away)} @ ${esc(r.home)} · ${esc(r.raw)}${r.reason?`<div class="faint">${esc(r.reason)}</div>`:""}</div>
        <select data-my-review-game="${i}" aria-label="Match CSV row ${r.rowNumber} to a game">${opts}</select>
        <button type="button" class="iconbtn" data-my-review-apply="${i}" ${r.value==null?"disabled":""}>Apply${val?` ${esc(val)}`:""}</button>
      </div>`;
    }).join("");
  wrap.querySelectorAll("[data-my-review-apply]").forEach(btn=>{
    btn.onclick=()=>{
      const i=Number(btn.dataset.myReviewApply), r=myNumbersPendingReview[i];
      const sel=wrap.querySelector(`[data-my-review-game="${i}"]`);
      const g=sel&&games.find(x=>x.key===sel.value);
      if(!r||!g||r.value==null) return;
      setUserNumber(g,r.value);
      if(typeof trackBetaEvent==="function") trackBetaEvent("my_numbers_manual",{source:"review"});
      myNumbersPendingReview.splice(i,1);
      renderBoard();
    };
  });
}
function initMyNumbers(){
  const file=document.getElementById("myNumbersCsvFile");
  if(file) file.onchange=()=>{
    const f=file.files&&file.files[0];
    if(f) importMyNumbersFile(f);
    file.value="";
  };
  const dl=document.getElementById("myNumbersTemplateBtn");
  if(dl) dl.onclick=downloadMyNumbersTemplate;
  const clear=document.getElementById("myNumbersClearBtn");
  if(clear) clear.onclick=clearCurrentMyNumbers;
  renderMyNumbersPerformance();
}
