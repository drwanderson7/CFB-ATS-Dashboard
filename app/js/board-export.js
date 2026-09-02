// --- Edge Board offline export ---------------------------------------------
// Dedicated report/export layer for the full weekly Edge Board.
//
// PDF: opens a print-ready landscape report in a new browser window and then
// invokes the native print dialog. Choosing "Save as PDF" produces a real,
// searchable multi-page PDF rather than a giant raster screenshot. The full
// weekly-board action deliberately ignores the Board's temporary row filters;
// "Current view PDF" is available separately for someone who really does want
// only the filtered subset.
//
// CSV: exports the same full board with one column per enabled model input so
// the raw weekly numbers can be archived/reviewed in Excel/Sheets.
//
// This file does NOT expose PickGauge Model #'s proprietary internal weights.
// It only reports the final PickGauge number plus model/system columns the user
// has explicitly enabled on the Board.

function boardExportSafeText(value){
  return String(value==null?"":value)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function boardExportCsvCell(value){
  const s=String(value==null?"":value);
  return /[",\n\r]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
}
function boardExportFinite(value){
  return value!=null&&value!==""&&!isNaN(value)?Number(value):null;
}
function boardExportEnabledInputs(){
  const enabled=new Set(Array.isArray(state.enabledSystems)?state.enabledSystems:[]);
  const out=[];
  if(enabled.has("bp")) out.push({key:"bp",label:"BP",value:g=>boardExportFinite((inputsFor(g.key)||[])[0])});
  if(enabled.has("comp")) out.push({key:"comp",label:"Comp",value:g=>boardExportFinite((inputsFor(g.key)||[])[1])});
  enabledSystemsOrdered().forEach(code=>out.push({
    key:code,
    label:predShort(code),
    fullLabel:predName(code),
    value:g=>boardExportFinite((predsFor(g.key)||{})[code]),
  }));
  return out;
}
function boardExportWeekLabel(){
  const pool=currentPool();
  if(pool) return pool.weekLabel||"Current week";
  if(state.weekAnchor==="ALL") return "All weeks";
  return weekLabel(currentWeekIndex());
}
function boardExportContext(){
  const pool=currentPool();
  const ent=activeEntry();
  return {
    poolLabel:pool?(pool.name||"Pool"):"Overall board",
    entryLabel:ent?(ent.name||"Entry"):"Entry",
    weekLabel:boardExportWeekLabel(),
    isPool:!!pool,
    pickLimit:pickLimit(),
  };
}
function boardExportGames(mode){
  if(mode!=="current") return games.slice();
  const pool=currentPool();
  const filterOn=!!(pool&&state.boardFilter==="aligned");
  return boardVisibleGames(games,filterOn,!!state.boardShortlistOnly,currentShortlist()).slice();
}
function boardExportPickForGame(g){
  const ent=activeEntry();
  return ent&&ent.picks?ent.picks[g.key]||null:null;
}
function boardExportLineData(g){
  const pool=currentPool();
  return {
    poolLine:pool?boardExportFinite(g.lockedLine!=null?g.lockedLine:g.vegas):null,
    liveLine:boardExportFinite(pool?g.liveVegas:g.vegas),
  };
}
function boardExportInputHtml(g,descriptors){
  const pieces=[];
  descriptors.forEach(d=>{
    const v=d.value(g);
    pieces.push(`<span class="input-chip${v==null?' missing':''}"><b>${boardExportSafeText(d.label)}</b> ${v==null?'—':boardExportSafeText(fmt(v))}</span>`);
  });
  const user=typeof userNumberFor==="function"?userNumberFor(g):null;
  if(user!=null) pieces.push(`<span class="input-chip user"><b>MY</b> ${boardExportSafeText(fmt(user))}</span>`);
  return pieces.length?pieces.join(""):'<span class="muted">No enabled comparison inputs</span>';
}
function boardExportStatusHtml(g){
  const pick=boardExportPickForGame(g);
  const bits=[];
  if(pick){
    const line=pick.line==null?"":` ${fmt(Number(pick.line))}`;
    bits.push(`<span class="status-chip picked">PICK · ${boardExportSafeText(pick.team||"")}${boardExportSafeText(line)}</span>`);
  }
  if(isShortlisted(g.key)) bits.push('<span class="status-chip shortlist">SHORTLIST</span>');
  return bits.length?bits.join(""):'<span class="muted">—</span>';
}
function boardExportEdgeHtml(g){
  const e=edgeOf(g);
  if(!e) return '<span class="muted">—</span>';
  const tier=e.team?edgeTierLabel(e.pts):"";
  const side=e.team?`${boardExportSafeText(e.team)} ${boardExportSafeText(fmt(e.line))}`:"No lean";
  return `${tier?`<b>${boardExportSafeText(tier)}</b><br>`:""}${side}<br><span class="edge-points">${boardExportSafeText(fmt(e.pts))} pts</span>`;
}
function boardExportCoverText(g){
  const e=edgeOf(g);
  const p=e&&e.prob&&e.prob.side?Number(e.prob.pCover):null;
  return Number.isFinite(p)?`${p.toFixed(1)}%`:"—";
}
function boardExportModelText(g){
  const v=modelColumnDisplayNumber(g);
  return v==null?"—":fmt(v);
}
function boardExportBlendText(g){
  if(!(typeof myBlendActive==="function"&&myBlendActive())) return null;
  const v=myNumber(g);
  return v==null?"—":fmt(v);
}
function boardExportReportFilename(ext){
  const ctx=boardExportContext();
  const raw=`PickGauge-${ctx.poolLabel}-${ctx.weekLabel}`.replace(/[^a-z0-9_-]+/gi,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
  return `${raw||"PickGauge-Weekly-Board"}.${ext}`;
}
function boardExportBuildHtml(mode){
  const ctx=boardExportContext();
  const reportGames=boardExportGames(mode);
  const descriptors=boardExportEnabledInputs();
  const pgActive=isPickGaugeModelActive();
  const blendActive=typeof myBlendActive==="function"&&myBlendActive();
  const modelLabel=pgActive?"PickGauge Model #":"Model #";
  const pickCount=reportGames.filter(g=>!!boardExportPickForGame(g)).length;
  const shortlistCount=reportGames.filter(g=>isShortlisted(g.key)).length;
  const generated=new Date().toLocaleString([], {year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});
  const enabledNames=descriptors.map(d=>d.fullLabel||d.label);
  const hasMyNumbers=reportGames.some(g=>typeof userNumberFor==="function"&&userNumberFor(g)!=null);
  if(hasMyNumbers) enabledNames.push("My Numbers");
  const modelSummary=enabledNames.length?enabledNames.join(", "):(pgActive?"PickGauge Model # only":"No comparison systems enabled");
  const poolLineHead=ctx.isPool?'<th class="line">Pool line</th>':"";
  const blendHead=blendActive?'<th class="num">My Blend</th>':"";
  const rows=reportGames.map(g=>{
    const lines=boardExportLineData(g);
    const rot=rotationStr(g)||"—";
    const time=kickStr(g.commence)||"—";
    const poolLine=ctx.isPool?`<td class="num">${lines.poolLine==null?'—':boardExportSafeText(fmt(lines.poolLine))}</td>`:"";
    const blend=blendActive?`<td class="num">${boardExportSafeText(boardExportBlendText(g)||"—")}</td>`:"";
    return `<tr>
      <td class="rot">${boardExportSafeText(rot.replace(/^Rot\s*/,""))}</td>
      <td class="time">${boardExportSafeText(time)}</td>
      <td class="matchup"><b>${boardExportSafeText(g.away)}</b><span>@</span><b>${boardExportSafeText(g.home)}</b></td>
      ${poolLine}
      <td class="num">${lines.liveLine==null?'—':boardExportSafeText(fmt(lines.liveLine))}</td>
      <td class="inputs">${boardExportInputHtml(g,descriptors)}</td>
      <td class="num model">${boardExportSafeText(boardExportModelText(g))}</td>
      ${blend}
      <td class="num cover">${boardExportSafeText(boardExportCoverText(g))}</td>
      <td class="edge-cell">${boardExportEdgeHtml(g)}</td>
      <td class="status">${boardExportStatusHtml(g)}</td>
    </tr>`;
  }).join("");
  const empty=rows||`<tr><td colspan="${ctx.isPool?11:10}" class="empty">No games are loaded for this board.</td></tr>`;
  const viewNote=mode==="current"?"Current filtered view":"Full weekly board · filters ignored";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${boardExportSafeText(boardExportReportFilename("pdf").replace(/\.pdf$/,""))}</title>
<style>
  @page{size:landscape;margin:.32in}
  *{box-sizing:border-box} body{margin:0;background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:9px;line-height:1.25;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .report{padding:18px 20px}.top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:2px solid #111827;padding-bottom:10px;margin-bottom:10px}
  .brand{font-size:23px;font-weight:900;letter-spacing:-.6px}.brand b{color:#16a34a}.subtitle{font-size:13px;font-weight:800;margin-top:3px}.meta{color:#667085;margin-top:3px}.summary{text-align:right}.summary strong{display:block;font-size:11px}.summary span{display:block;color:#667085;margin-top:2px}
  .models{border:1px solid #d0d5dd;background:#f8fafc;border-radius:7px;padding:7px 9px;margin-bottom:9px}.models b{margin-right:5px}.models span{color:#475467}
  table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}th{background:#111827;color:white;text-transform:uppercase;letter-spacing:.45px;font-size:7px;padding:6px 5px;text-align:left}td{border-bottom:1px solid #dfe3e8;padding:6px 5px;vertical-align:top}
  th:nth-child(1),td.rot{width:5%}th:nth-child(2),td.time{width:9%}td.matchup{width:16%}.matchup span{display:block;color:#98a2b3;font-size:7px;margin:1px 0}.num{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}.model{font-weight:800}.cover{font-weight:800;color:#067647}.inputs{width:25%}.input-chip{display:inline-block;border:1px solid #d0d5dd;border-radius:4px;background:#fff;padding:2px 4px;margin:0 3px 3px 0;white-space:nowrap;font-size:7.3px}.input-chip b{font-size:6.8px}.input-chip.missing{color:#98a2b3}.input-chip.user{border-color:#84adff;background:#eff4ff}.edge-cell{width:12%}.edge-points{font-weight:800;color:#344054}.status{width:11%}.status-chip{display:inline-block;border-radius:4px;padding:2px 4px;margin:0 3px 3px 0;font-size:6.8px;font-weight:800}.status-chip.picked{background:#dcfae6;color:#067647}.status-chip.shortlist{background:#fef0c7;color:#93370d}.muted{color:#98a2b3}.empty{text-align:center;color:#667085;padding:30px}
  .foot{display:flex;justify-content:space-between;gap:20px;border-top:1px solid #d0d5dd;margin-top:9px;padding-top:7px;color:#667085;font-size:7.5px}.foot strong{color:#344054}
  @media screen{body{background:#eaecf0}.report{max-width:1400px;margin:16px auto;background:white;box-shadow:0 8px 30px rgba(16,24,40,.12)} }
  @media print{.report{padding:0}.screen-note{display:none!important}}
</style></head><body><div class="report">
<div class="top"><div><div class="brand">Pick<b>Gauge</b></div><div class="subtitle">Weekly Edge Board · ${boardExportSafeText(ctx.weekLabel)}</div><div class="meta">${boardExportSafeText(ctx.poolLabel)} · ${boardExportSafeText(ctx.entryLabel)} · ${boardExportSafeText(viewNote)}</div></div><div class="summary"><strong>${reportGames.length} games · ${pickCount} pick${pickCount===1?'':'s'} · ${shortlistCount} shortlisted</strong><span>Generated ${boardExportSafeText(generated)}</span><span>Current board order: ${boardExportSafeText((SORT_LABELS&&SORT_LABELS[state.sortKey])||state.sortKey||"Edge")} · ${state.sortDir==="asc"?"ascending":"descending"}</span></div></div>
<div class="models"><b>Inputs in this report:</b><span>${boardExportSafeText(modelSummary)}</span></div>
<table><thead><tr><th>Rot</th><th>Kickoff</th><th>Matchup</th>${poolLineHead}<th class="line">Live Vegas</th><th>Model inputs</th><th>${boardExportSafeText(modelLabel)}</th>${blendHead}<th>Cover %</th><th>Edge / lean</th><th>Status</th></tr></thead><tbody>${empty}</tbody></table>
<div class="foot"><span><strong>Offline review copy.</strong> Lines and models reflect the values loaded in PickGauge when this report was generated.</span><span>PickGauge Model # proprietary weighting is intentionally not printed. Matchup Intelligence is excluded from the compact report.</span></div>
</div></body></html>`;
}
function boardExportPdf(mode){
  const w=window.open("","_blank");
  if(!w){
    if(typeof pgAlert==="function") pgAlert({title:"Export blocked",message:"Your browser blocked the report window. Allow pop-ups for PickGauge and try Export Board again."});
    return false;
  }
  w.document.open();
  w.document.write(boardExportBuildHtml(mode==="current"?"current":"full"));
  w.document.close();
  try{ w.document.title=boardExportReportFilename("pdf").replace(/\.pdf$/i,""); }catch(_e){}
  setTimeout(()=>{ try{ w.focus(); w.print(); }catch(_e){} },250);
  return true;
}
function boardExportCsv(){
  const reportGames=boardExportGames("full");
  const ctx=boardExportContext();
  const descriptors=boardExportEnabledInputs();
  const blendActive=typeof myBlendActive==="function"&&myBlendActive();
  const pgActive=isPickGaugeModelActive();
  const modelLabel=pgActive?"PickGauge Model #":"Model #";
  const headers=["Week","Pool / context","Entry","Away rotation","Home rotation","Kickoff ISO","Kickoff local","Away","Home"];
  if(ctx.isPool) headers.push("Pool line");
  headers.push("Live Vegas");
  descriptors.forEach(d=>headers.push(d.fullLabel||d.label));
  headers.push("My Numbers",modelLabel);
  if(blendActive) headers.push("My Blend");
  headers.push("Cover %","Edge pts","Recommended team","Recommended line","Tier","Picked team","Picked line","Shortlisted");
  const rows=[headers];
  reportGames.forEach(g=>{
    const lines=boardExportLineData(g);
    const e=edgeOf(g);
    const pick=boardExportPickForGame(g);
    const row=[ctx.weekLabel,ctx.poolLabel,ctx.entryLabel,g.awayRotation??"",g.homeRotation??"",g.commence||"",kickStr(g.commence)||"",g.away,g.home];
    if(ctx.isPool) row.push(lines.poolLine==null?"":lines.poolLine);
    row.push(lines.liveLine==null?"":lines.liveLine);
    descriptors.forEach(d=>{ const v=d.value(g); row.push(v==null?"":v); });
    const user=typeof userNumberFor==="function"?userNumberFor(g):null;
    const model=modelColumnDisplayNumber(g);
    row.push(user==null?"":user,model==null?"":model);
    if(blendActive){ const blend=myNumber(g); row.push(blend==null?"":blend); }
    const cover=e&&e.prob&&e.prob.side?Number(e.prob.pCover):null;
    row.push(
      Number.isFinite(cover)?cover.toFixed(1):"",
      e?e.pts:"",
      e&&e.team?e.team:"",
      e&&e.team?e.line:"",
      e&&e.team?edgeTierLabel(e.pts):"",
      pick?(pick.team||""):"",
      pick&&pick.line!=null?pick.line:"",
      isShortlisted(g.key)?"Yes":"No"
    );
    rows.push(row);
  });
  const csv=rows.map(r=>r.map(boardExportCsvCell).join(",")).join("\r\n");
  const blob=new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url; a.download=boardExportReportFilename("csv");
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  return true;
}
function boardExportCloseMenu(){
  const menu=document.getElementById("boardExportMenu");
  if(menu) menu.open=false;
}
function initBoardExport(){
  const full=document.getElementById("exportWeeklyBoardPdf");
  const current=document.getElementById("exportCurrentBoardPdf");
  const csv=document.getElementById("exportWeeklyBoardCsv");
  if(full) full.onclick=()=>{ boardExportCloseMenu(); boardExportPdf("full"); };
  if(current) current.onclick=()=>{ boardExportCloseMenu(); boardExportPdf("current"); };
  if(csv) csv.onclick=()=>{ boardExportCloseMenu(); boardExportCsv(); };
}
