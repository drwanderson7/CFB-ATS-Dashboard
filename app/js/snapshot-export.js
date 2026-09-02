// --- Snapshot tab + social-export graphic -----------------------------
// Split out of app/js/board.js (Sept 1, 2026 -- TODO #24) to keep Board
// logic maintainable as social/export features keep growing. Covers the
// entire Snapshot tab (renderSnapshot() and everything it calls: Top
// Opportunities, the Week Snapshot stat panel, the condensed Full Slate
// table, and the detail-row percentile breakdown) plus the "Export PNG"
// social-share graphic generator (exportSnapshotTopEdgesGraphic() and its
// canvas-drawing helpers).
//
// Genuinely Snapshot-exclusive logic lives here. Three real cell-rendering
// helpers (edgeExtrasHTML()/probCellHTML()/mktModelHTML()) are called by
// BOTH renderBoard() and renderSnapshot() and deliberately stayed in
// board.js rather than being duplicated here or split a third time into a
// shared.js -- see board.js's own header comment for the reasoning. Same
// for bindRowInputs()/updateRowCalc()/updatePickCount()/renderPickSummary(),
// which are Board-row-input plumbing that Snapshot's re-render path also
// depends on indirectly (renderBoard() cascades into renderSnapshot() at
// its own end) but doesn't call directly.
//
// Loaded as a plain <script src="/app/js/snapshot-export.js"> tag, same as
// board.js -- an ordinary global scope, not a module. Real external
// references this file makes that are NOT self-contained (all resolved
// lazily inside function bodies, never at top-level, so script load order
// relative to the rest of the page doesn't matter for correctness -- same
// reasoning as board.js's own header comment):
//   - `state`, `games` -- global app state and the current week's game
//     list (main inline script).
//   - `myNumber()`/`edgeOf()`/`edgeClass()`/`clvOf()`/`clvAlignment()`/
//     `probabilityCoverForGame()`/`keyNumberScore()` -- the composite
//     probability model (app/js/model.js).
//   - `edgeExtrasHTML()`/`probCellHTML()`/`mktModelHTML()`/
//     `edgeEmptyHTML()` -- shared cell-rendering helpers that stayed in
//     app/js/board.js (see this file's header above).
//   - `activeEntry()`/`activeEntries()`/`currentPool()`/`pickLimit()` --
//     pool/entry context accessors (main inline script).
//   - `esc()`/`fmt()`/`round1()`/`teamMatch()` -- general utilities (main
//     inline script).
//   - `switchTab()` -- tab navigation (main inline script).
//   - `myNumbersCellHTML()`/`myNumbersEdgeHTML()` -- My Numbers board
//     integration (app/js/my-numbers.js).
//   - `trackBetaSnapshotView()`/`betaRememberAction()`/`trackBetaEvent()`
//     -- analytics (app/js/beta.js).

/* ---------- Snapshot tab ----------
   Quick-scan summary view: Top Opportunities, a Week Snapshot stat panel,
   and a condensed Full Slate table, all computed from the SAME `games`/
   `state` data and the SAME real functions (myNumber/edgeOf/clvOf/
   probabilityCoverForGame/keyNumberScore) the full Edge Board uses --
   nothing here is a separate data source or a reimplementation that could
   drift from the real board. "View full board" just switches to the
   existing board tab, unchanged. */

// This tab is a quick scan, not a second full board -- always cap the
// condensed table at this many rows (regardless of which filter pill is
// active), with a "See full slate ->" link to the real board for
// everything past that. Games analyzed / Strong / Good / key-crossing
// counts in the Week Snapshot panel are NOT capped -- those reflect the
// whole week, only the row list itself is trimmed.
const SNAPSHOT_ROW_LIMIT=8;
// Human labels for the Quick Look filter pills -- used by the empty-state
// message ("No games match X") so it names the actual active filter
// instead of a generic "this filter". Keys match snapshotFilterRows()'s
// own switch cases exactly.
const SNAP_FILTER_LABELS={strong:"Strong", dog:"Underdogs", key:"Crosses key #", mine:"My picks", shortlist:"Shortlisted"};

// Which games currently have their detail row expanded. Ephemeral UI
// state only -- intentionally NOT part of `state`/saved, since which rows
// happen to be expanded isn't something worth persisting across reloads
// or syncing across devices.
const snapExpandedKeys=new Set();

// Percentile rank of `val` within `arr`, 0-100. Ties share the same rank
// (games with an identical value are treated identically, not arbitrarily
// ordered against each other).
function percentileRank(arr,val){
  if(arr.length<=1) return 50;
  const sorted=[...arr].sort((a,b)=>a-b);
  const below=sorted.filter(v=>v<val).length;
  return (below/(sorted.length-1))*100;
}

// Two independent, real-methodology percentile ranks used by the detail
// panel's mini progress bars (edgeRank/coverRank/keyRank) -- how this
// game's Raw Edge, Cover %, and key-number proximity each stack up
// against just this week's own slate. These are useful context on their
// own regardless of which ranking mode is active (Raw Edge or Cover %),
// so they're always computed here.
//
// NOTE: this function used to also compute a blended "Pick Score" (an
// equal-weighted average of the three ranks above) as a second ranking
// mode alongside Raw Edge. Removed entirely (Aug 26, Drew's explicit
// call) -- a synthetic blended percentile invited more confidence than
// it deserved (it wasn't calibrated against historical outcomes the way
// Cover % is), and it duplicated Cover %, which is already a real,
// fitted, historically-calibrated number (see the 5,705-game key-number/
// cover dataset this app already computes from). Ranking by Cover %
// directly is more honest and needs no blended synthetic in between.
function computeSnapshotScores(rows){
  const edges=rows.map(r=>r.e.pts);
  const covers=rows.map(r=>r.e.prob?r.e.prob.pCover:0);
  const keys=rows.map(r=>r.e.keyScore||0);
  rows.forEach(r=>{
    r.edgeRank=percentileRank(edges,r.e.pts);
    r.coverRank=percentileRank(covers,r.e.prob?r.e.prob.pCover:0);
    r.keyRank=percentileRank(keys,r.e.keyScore||0);
  });
}

// Renders the expandable detail panel for one row -- "why is this ranked
// where it is." The three signal percentiles (edge/cover/key) show
// regardless of ranking mode -- useful context either way. When ranking
// by Cover % specifically, the real modeled cover probability itself
// (not a blended synthetic) is highlighted at the top, since that's the
// actual number driving the current sort.
function renderSnapDetailRow(r,coverOn,stats){
  const {g,e}=r;
  const colspan=7+(stats.pool?1:0);
  const scoreHTML=coverOn?`<div class="detail-score-row">
      <span class="big-score num">${e.prob&&e.prob.side?(e.prob.pCover*100).toFixed(1)+'%':'—'}</span>
      <span class="note" style="margin:0;">Cover % — modeled probability this side covers, fitted from 5,705 real FBS-vs-FBS games (2018-2025). This is the number currently ranking the slate.</span>
    </div>`:"";

  // YOUR MODEL -- real individual inputs (inputsFor/predsFor), nothing
  // fabricated. Only shows systems actually toggled on and actually
  // matched for this game.
  const inp=inputsFor(g.key);
  const modelRows=[];
  const pgActive=isPickGaugeModelActive();
  if(!pgActive){
    if(state.enabledSystems.includes("bp") && inp[0]!=null && inp[0]!=="") modelRows.push(["BP", Number(inp[0])]);
    if(state.enabledSystems.includes("comp") && inp[1]!=null && inp[1]!=="") modelRows.push(["Comp", Number(inp[1])]);
    const preds=predsFor(g.key);
    enabledSystemsOrdered().forEach(code=>{
      const v=preds[code];
      if(v!=null){
        const sysName=(PRED_SYSTEMS.find(s=>s.code===code)||{}).name||code;
        modelRows.push([sysName, Number(v)]);
      }
    });
  }
  const myn=myNumber(g);
  const modelHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Your model</div>
    ${pgActive?'<div class="detail-empty">Standalone PickGauge blend active. Internal component lines stay behind the scenes.</div>':(modelRows.length?modelRows.map(([lbl,v])=>`<div class="detail-line"><span>${esc(lbl)}</span><span class="num">${fmt(v)}</span></div>`).join(""):'<div class="detail-empty">No individual inputs loaded yet.</div>')}
    <div class="detail-line detail-line-total"><span>${pgActive?'PickGauge Model #':'Model #'}</span><span class="num">${myn==null?'—':fmt(myn)}</span></div>
  </div>`;

  // MARKET -- pool line vs current market when in a pool (the real
  // comparison that matters for CLV), otherwise the resolved live line.
  // Always home-team perspective (g.lockedLine/g.liveVegas/g.vegas all
  // are, same as myNumber() and every row in the "Your model" column
  // above) -- this used to fall back to e.line in the non-pool branch,
  // which is picked-side perspective (flipped for an away pick, see
  // edgeOf()). That silently mismatched the home-perspective Model #
  // total right next to it whenever the pick was away -- same bug
  // family as the Snapshot condensed row's Market->Model cell, just
  // here it was the Market side that had the wrong convention instead
  // of the Model side. board's own Vegas column already does it this
  // way (`pool?g.liveVegas:g.vegas`, see renderBoard()) -- matching
  // that instead of inventing a third convention.
  const marketRows=[];
  if(stats.pool && g.lockedLine!=null){
    marketRows.push(["Pool line", g.lockedLine]);
    marketRows.push(["Current market", g.liveVegas]);
  }else{
    const marketLabel=(g.book&&g.book!=="consensus"&&g.book!=="demo")?g.book:"Consensus";
    const marketVal=stats.pool?g.liveVegas:g.vegas;
    marketRows.push([marketLabel, marketVal]);
  }
  const marketHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Market</div>
    ${marketRows.map(([lbl,v])=>`<div class="detail-line"><span>${esc(lbl)}</span><span class="num">${v==null?'—':fmt(v)}</span></div>`).join("")}
  </div>`;

  // SIGNALS -- real key-number/CLV facts, plus the three percentile ranks
  // (kept here, not removed by this redesign -- shown regardless of
  // which ranking mode is active, same as before).
  const sigLines=[];
  if(e.keyNumbers&&e.keyNumbers.length){
    sigLines.push(`✓ Crosses key number${e.keyNumbers.length>1?'s':''} ${e.keyNumbers.join(', ')} (${e.keyTier})`);
  }
  const agreement=modelAgreement(g,e.side);
  if(agreement&&agreement.total){
    sigLines.push(`${agreement.agree}/${agreement.total} models favor ${e.team||"this side"} (${Math.round(agreement.pct*100)}% agreement)`);
  }
  if(stats.pool && g.lockedLine!=null){
    const ent=activeEntry();
    const picked=ent.picks[g.key];
    const c=clvOf(g, picked?picked.side:e.side);
    if(c&&c.forPick!=null){
      // Wording differs for an actual pick ("you beat the market") vs. just
      // the model's current lean on an unpicked game ("this side would beat
      // the market") -- both use the same forPick math, but claiming past
      // tense for a game nobody's picked yet would overstate it.
      if(picked){
        sigLines.push(c.forPick>0?`✓ CLV ${fmt(c.forPick)} — you beat the market`:c.forPick<0?`⚠ CLV ${fmt(c.forPick)} — market moved away`:`– CLV flat since lock`);
      }else{
        sigLines.push(c.forPick>0?`✓ CLV ${fmt(c.forPick)} if picked — this side beat the market`:c.forPick<0?`⚠ CLV ${fmt(c.forPick)} if picked — market moved away`:`– CLV flat since lock`);
      }
      // Same ⚡ alignment signal as the Board tab and Quick Look column --
      // market movement since lock AND the model's remaining disagreement
      // both point the same direction. Detail panel previously computed CLV
      // but never surfaced this specific compound signal.
      if(clvAlignment(g)){
        sigLines.push(`⚡ Market's still sliding this way — model agrees there's more room`);
      }
    }
  }
  const miniBar=(label,rank)=>`<div class="detail-sig-lbl">${label} <b>${Math.round(rank)}${ordinalSuffix(Math.round(rank))} pctile</b></div><div class="detail-bar-track"><div class="detail-bar-fill" style="width:${Math.max(2,rank)}%;"></div></div>`;
  const signalsHTML=`<div class="detail-col">
    <div class="detail-col-hdr">Signals</div>
    ${sigLines.map(s=>`<div class="detail-sig">${s}</div>`).join("")}
    ${miniBar("Raw edge",r.edgeRank)}
    ${miniBar("Cover %",r.coverRank)}
    ${miniBar("Key-number proximity",r.keyRank)}
  </div>`;

  const ratingsHTML=(typeof cfbdRatingsPanelHTML==="function")?cfbdRatingsPanelHTML(g):"";
  const matchupHTML=(typeof cfbdMatchupPanelHTML==="function")?cfbdMatchupPanelHTML(g):"";
  return `<tr class="detail-row" data-detail-for="${esc(g.key)}"><td colspan="${colspan}">
    ${scoreHTML}
    <div class="detail-cols">${modelHTML}${marketHTML}${signalsHTML}</div>
    ${ratingsHTML}
    ${matchupHTML}
    <div class="detail-foot"><button class="btn btn-light" data-snap-jump="${esc(g.key)}" style="padding:6px 12px;font-size:12px;">Open on full board →</button></div>
  </td></tr>`;
}
function ordinalSuffix(n){
  const v=n%100;
  if(v>=11&&v<=13) return "th";
  switch(n%10){case 1:return "st";case 2:return "nd";case 3:return "rd";default:return "th";}
}

function computeWeekStats(rows){
  const pool=currentPool();
  const ent=activeEntry();
  let strong=0,good=0,keyCrossings=0;
  rows.forEach(r=>{
    const cls=edgeClass(r.e.pts);
    if(cls==="gd") strong++; else if(cls==="g") good++;
    if(r.e.keyNumbers&&r.e.keyNumbers.length) keyCrossings++;
  });
  const pickedKeys=Object.keys(ent.picks);
  let edgeSum=0,edgeCount=0,clvPos=0,clvEligible=0;
  pickedKeys.forEach(key=>{
    const g=games.find(x=>x.key===key);
    if(!g) return;
    const p=ent.picks[key];
    const e=edgeOf(g);
    if(e&&e.pts>0){ edgeSum+=e.pts; edgeCount++; }
    if(pool){
      const c=clvOf(g,p.side);
      if(c&&c.forPick!=null){ clvEligible++; if(c.forPick>0) clvPos++; }
    }
  });
  return {
    gamesAnalyzed:rows.length, strong, good, keyCrossings,
    avgPickEdge:edgeCount?edgeSum/edgeCount:null,
    clvPos, clvEligible, pool:!!pool, pickedCount:pickedKeys.length,
  };
}

function snapshotRows(){
  // Every game with a real lean (pts>0) -- "no lean" games have nothing to
  // rank or recommend, same exclusion the full board already applies.
  return games.map(g=>({g,e:edgeOf(g)})).filter(r=>r.e&&r.e.pts>0);
}

function snapshotFilterRows(rows,filter){
  const ent=activeEntry();
  switch(filter){
    case "strong": return rows.filter(r=>edgeClass(r.e.pts)==="gd");
    case "dog": return rows.filter(r=>r.e.side==="away");
    case "key": return rows.filter(r=>r.e.keyTier&&r.e.keyTier!=="none");
    case "mine": return rows.filter(r=>ent.picks[r.g.key]);
    case "shortlist": return rows.filter(r=>isShortlisted(r.g.key));
    default: return rows;
  }
}


function snapshotExportRows(limit){
  const rows=snapshotRows();
  if(!rows.length) return [];
  computeSnapshotScores(rows);
  // The exported asset is explicitly a "Top 5 Edges" graphic, so always
  // rank by raw model-vs-market disagreement even if the on-screen Snapshot
  // is temporarily sorted by Cover %. The export title and ranking can
  // never disagree with each other.
  return [...rows]
    .sort((a,b)=>b.e.pts-a.e.pts)
    .slice(0,limit||5)
    .map(r=>{
      const {g,e}=r;
      const model=myNumber(g);
      const recommended=e.side||"home";
      const recommendedTeam=recommended==="home"?g.home:g.away;
      const toTeamPerspective=v=>recommended==="home"?v:-v;
      return {
        g,e,
        matchupShort:`${snapshotExportTeamShort(g.away)} @ ${snapshotExportTeamShort(g.home)}`,
        kickoff:snapshotExportKickoff(g.commence),
        modelTeam:recommendedTeam,
        modelLine:toTeamPerspective(model),
        marketTeam:recommendedTeam,
        marketLine:toTeamPerspective(g.vegas),
        leanText:`${snapshotExportTeamShort(recommendedTeam)} ${fmt(e.line)}`,
        edgeText:fmt(e.pts),
      };
    });
}
function snapshotExportTeamShort(name){
  const s=String(name||"").trim();
  if(!s) return "—";
  // Prefer a handful of familiar broadcast abbreviations over provider
  // abbreviations that can look odd in a social card (e.g. JXST/NCSU).
  const custom={
    "North Carolina":"UNC","NC State":"NCST","North Carolina State":"NCST",
    "Florida State":"FSU","Texas Christian":"TCU","TCU":"TCU",
    "Texas-San Antonio":"UTSA","Brigham Young":"BYU","San Jose State":"SJSU",
    "New Mexico State":"NMSU","Jacksonville State":"JAXST","Hawaii":"HAW","Hawaiʻi":"HAW",
    "Stanford":"STAN","Memphis":"MEM","Nevada-Las Vegas":"UNLV","UNLV":"UNLV",
    "Southern California":"USC","USC":"USC","Virginia":"UVA","Texas":"TEX"
  };
  if(custom[s]) return custom[s];
  const sl=s.toLowerCase();
  if(sl.includes('jacksonville state')) return 'JAXST';
  if(sl.includes('north carolina state')||sl.includes('nc state')) return 'NCST';
  if(sl.includes('north carolina')&&!sl.includes('state')) return 'UNC';
  if(sl.includes('florida state')) return 'FSU';
  if(sl.includes('san jose state')) return 'SJSU';
  if(sl.includes('new mexico state')) return 'NMSU';
  try{
    if(typeof cfbdTeamForName==="function"){
      const t=cfbdTeamForName(name);
      if(t&&t.abbreviation) return String(t.abbreviation).toUpperCase();
    }
  }catch(e){}
  const words=s.replace(/[^A-Za-z0-9 ]+/g,' ').trim().split(/\s+/).filter(Boolean);
  if(words.length===1) return words[0].slice(0,4).toUpperCase();
  if(words.length===2 && words[0].length<=3) return (words[0]+words[1].slice(0,2)).toUpperCase();
  return words.map(w=>w[0]).join('').slice(0,5).toUpperCase();
}
function snapshotExportKickoff(commence){
  if(!commence) return weekLabel(currentWeekIndex());
  try{
    const d=new Date(commence);
    const dow=d.toLocaleDateString(undefined,{weekday:'short'});
    const date=d.toLocaleDateString(undefined,{month:'numeric',day:'numeric'});
    const time=d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'});
    return `${dow} ${date} • ${time} ET`;
  }catch(e){
    return weekLabel(currentWeekIndex());
  }
}
function snapshotExportDateRange(rows){
  const times=rows.map(r=>Date.parse(r.g.commence||''))
    .filter(t=>!isNaN(t))
    .sort((a,b)=>a-b);
  if(!times.length) return weekLabel(currentWeekIndex());
  const fmtOpts={month:'long',day:'numeric'};
  const first=new Date(times[0]), last=new Date(times[times.length-1]);
  const a=first.toLocaleDateString(undefined,fmtOpts);
  const b=last.toLocaleDateString(undefined,fmtOpts);
  if(a===b) return a;
  if(first.getMonth()===last.getMonth()) return `${a}–${last.getDate()}`;
  return `${a}–${b}`;
}
function snapshotDrawRoundRect(ctx,x,y,w,h,r,fill,stroke){
  const rr=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
  if(fill){ ctx.fillStyle=fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle=stroke; ctx.stroke(); }
}
const snapshotImageCache=new Map();
async function snapshotFetchDataUrl(url){
  if(!url) return null;
  if(snapshotImageCache.has(url)) return snapshotImageCache.get(url);
  const prom=(async()=>{
    try{
      const res=await fetch(url,{mode:'cors',credentials:'omit'});
      if(!res.ok) return null;
      const blob=await res.blob();
      return await new Promise(resolve=>{
        const fr=new FileReader();
        fr.onload=()=>resolve(fr.result||null);
        fr.onerror=()=>resolve(null);
        fr.readAsDataURL(blob);
      });
    }catch(e){
      return null;
    }
  })();
  snapshotImageCache.set(url,prom);
  return prom;
}
async function snapshotLoadImage(url){
  if(!url) return null;
  const dataUrl=String(url).startsWith('data:')?url:await snapshotFetchDataUrl(url);
  if(!dataUrl) return null;
  return await new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=()=>resolve(null);
    img.src=dataUrl;
  });
}
function snapshotDrawLogo(ctx,img,label,x,y,size){
  ctx.save();
  ctx.beginPath();
  ctx.arc(x+size/2,y+size/2,size/2,0,Math.PI*2);
  ctx.closePath();
  ctx.fillStyle='#ffffff';
  ctx.fill();
  ctx.strokeStyle='#d7dfdb';
  ctx.lineWidth=2;
  ctx.stroke();
  ctx.clip();
  if(img){
    const pad=size*0.16;
    const iw=img.width||1, ih=img.height||1;
    const scale=Math.min((size-pad*2)/iw,(size-pad*2)/ih);
    const w=iw*scale, h=ih*scale;
    ctx.drawImage(img,x+(size-w)/2,y+(size-h)/2,w,h);
  }else{
    ctx.fillStyle='#0f172a';
    ctx.font='700 20px Inter, Arial, sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(snapshotExportTeamShort(label),x+size/2,y+size/2);
  }
  ctx.restore();
}
function snapshotDrawEdgeGauge(ctx,x,y,w,edgePts){
  const max=6;
  const value=Math.max(0,Math.min(max,Number(edgePts)||0));
  const fillW=w*(value/max);
  ctx.lineCap='round';
  ctx.strokeStyle='#d7dfdb';
  ctx.lineWidth=5;
  ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+w,y); ctx.stroke();
  if(fillW>0){
    ctx.strokeStyle='#2fb34d';
    ctx.lineWidth=5;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+fillW,y); ctx.stroke();
    ctx.fillStyle='#2fb34d';
    ctx.beginPath(); ctx.arc(x+fillW,y,7,0,Math.PI*2); ctx.fill();
  }
  ctx.lineCap='butt';
  ctx.fillStyle='#87938d';
  ctx.font='500 12px Inter, Arial, sans-serif';
  ctx.textBaseline='top';
  ctx.textAlign='left'; ctx.fillText('0',x,y+9);
  ctx.textAlign='center'; ctx.fillText('3',x+w/2,y+9);
  ctx.textAlign='right'; ctx.fillText('6+',x+w,y+9);
}
async function snapshotGetSocialLogoImages(rows){
  const ids=[...new Set(rows.flatMap(r=>[r.g.cfbdAwayTeamId,r.g.cfbdHomeTeamId])
    .filter(v=>v!=null).map(v=>String(v)))].slice(0,10);
  const byId=new Map();
  if(ids.length){
    try{
      const y=(rows.find(r=>r.g.cfbdSeason!=null)?.g.cfbdSeason)
        || ((typeof seasonYear==='function')?seasonYear():new Date().getFullYear());
      const result=await apiFetch(`/api/fetch_teams?year=${encodeURIComponent(y)}&logoIds=${encodeURIComponent(ids.join(','))}`,{});
      const logos=result.ok&&result.body&&result.body.logos?result.body.logos:{};
      await Promise.all(ids.map(async id=>{
        const img=logos[id]?await snapshotLoadImage(logos[id]):null;
        if(img) byId.set(id,img);
      }));
    }catch(e){
      console.warn('social export logo proxy unavailable',e);
    }
  }
  // Fallback for any game that lacks a canonical CFBD id or whose server-side
  // logo fetch failed. Some CDNs allow direct CORS; when they don't, this just
  // resolves null and snapshotDrawLogo() uses the abbreviation fallback.
  await Promise.all(rows.flatMap(r=>[
    [r.g.cfbdAwayTeamId,r.g.awayLogo],[r.g.cfbdHomeTeamId,r.g.homeLogo]
  ]).map(async ([id,url])=>{
    const key=id!=null?String(id):null;
    if(!url||(key&&byId.has(key))) return;
    const img=await snapshotLoadImage(url);
    if(img&&key) byId.set(key,img);
  }));
  return byId;
}
function snapshotDrawBrand(ctx,icon,W){
  const iconSize=68;
  const brandY=7;
  const brandCenterY=brandY+iconSize/2;
  ctx.font='800 32px Inter, Arial, sans-serif';
  const pickW=ctx.measureText('PICK').width;
  const gaugeW=ctx.measureText('GAUGE').width;
  const brandGap=16;
  const total=iconSize+brandGap+pickW+gaugeW;
  const x=(W-total)/2;
  if(icon){
    // The current app icon asset has the green PickGauge mark on a dark square
    // (appropriate for a favicon, ugly on a white social card). Strip only the
    // near-black backing pixels at draw time so the existing official mark can
    // sit cleanly on the light export without introducing a second logo asset.
    try{
      const tmp=document.createElement('canvas');
      tmp.width=iconSize; tmp.height=iconSize;
      const tctx=tmp.getContext('2d');
      tctx.drawImage(icon,0,0,iconSize,iconSize);
      const data=tctx.getImageData(0,0,iconSize,iconSize);
      for(let i=0;i<data.data.length;i+=4){
        const r=data.data[i], g=data.data[i+1], b=data.data[i+2];
        if(r<70&&g<70&&b<70) data.data[i+3]=0;
      }
      tctx.putImageData(data,0,0);
      ctx.drawImage(tmp,x,brandY,iconSize,iconSize);
    }catch(e){ ctx.drawImage(icon,x,brandY,iconSize,iconSize); }
  }
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillStyle='#111827'; ctx.fillText('PICK',x+iconSize+brandGap,brandCenterY);
  ctx.fillStyle='#2fb34d'; ctx.fillText('GAUGE',x+iconSize+brandGap+pickW,brandCenterY);
}
async function exportSnapshotTopEdgesGraphic(){
  if(typeof betaRememberAction==="function") betaRememberAction("snapshot_export",{source:"button"});
  // Make one best-effort identity refresh before freezing the export. The
  // normal Snapshot can render edges before the async team directory has
  // finished loading; waiting here prevents a user who clicks Export quickly
  // from getting abbreviation circles simply because canonical ids/logos were
  // still a few milliseconds behind the rest of the page.
  try{
    if(typeof fetchTeamLogos==='function' && (!teamLogos||!teamLogos.length)){
      await fetchTeamLogos(false);
      if(typeof applyTeamLogos==='function') applyTeamLogos();
    }
  }catch(e){}
  const rows=snapshotExportRows(5);
  if(!rows.length){
    if(typeof pgAlert==='function') await pgAlert({title:'Nothing to export',message:'Snapshot has no live edges yet. Load lines and model numbers first.'});
    return false;
  }
  // The exported asset is a public, shareable graphic titled "TOP 5 EDGES".
  // On a flat week where nothing clears the "good" threshold, exporting it
  // anyway would publish five slim leans under that headline -- the same
  // overstatement the on-screen Top Opportunities section was fixed to
  // avoid, in its most public form. Block it and say why rather than
  // silently producing a graphic that overclaims.
  if(typeof edgeClass==='function'&&!rows.some(r=>edgeClass(r.e.pts)!=="r")){
    if(typeof pgAlert==='function') await pgAlert({
      title:'No standout edges to export',
      message:'No game clears the edge bar this week — every lean is slim. A "Top 5 Edges" graphic would overstate them, so PickGauge won\u2019t build one. Check back once the model and the market disagree more.',
    });
    return false;
  }
  if(document.fonts&&document.fonts.ready){
    try{ await document.fonts.ready; }catch(e){}
  }

  const W=1080, H=1250;
  const canvas=document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  const ctx=canvas.getContext('2d');
  if(!ctx) throw new Error('Canvas not supported');

  const [icon,logoById]=await Promise.all([
    snapshotLoadImage('/icon-96.png'),
    snapshotGetSocialLogoImages(rows),
  ]);

  // Neutral editorial background -- light enough to feel like a real sports
  // data card rather than a neon/AI render, with only a very faint grid.
  ctx.fillStyle='#f5f7f6';
  ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(20,74,49,0.035)';
  ctx.lineWidth=1;
  for(let x=40;x<W-20;x+=52){ ctx.beginPath(); ctx.moveTo(x,38); ctx.lineTo(x,H-64); ctx.stroke(); }

  snapshotDrawBrand(ctx,icon,W);

  const titleY=136;
  ctx.textBaseline='alphabetic';
  ctx.font='800 76px Oswald, Inter, Arial Black, sans-serif';
  const t1='TOP 5 ';
  const t2='EDGES';
  const tw1=ctx.measureText(t1).width, tw2=ctx.measureText(t2).width;
  const tx=(W-(tw1+tw2))/2;
  ctx.fillStyle='#111827'; ctx.fillText(t1,tx,titleY);
  ctx.fillStyle='#2fb34d'; ctx.fillText(t2,tx+tw1,titleY);

  ctx.strokeStyle='#2fb34d'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(150,170); ctx.lineTo(306,170); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(774,170); ctx.lineTo(930,170); ctx.stroke();
  ctx.font='600 26px Inter, Arial, sans-serif';
  ctx.fillStyle='#374151';
  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(`${weekLabel(currentWeekIndex())} • ${snapshotExportDateRange(rows)}`,W/2,170);

  const cardX=40, cardW=1000, cardH=170, gap=17, startY=199;
  const edgeW=148, edgeX=cardX+cardW-edgeW;
  rows.forEach((row,idx)=>{
    const y=startY+idx*(cardH+gap);
    ctx.save();
    ctx.shadowColor='rgba(15,23,42,0.07)';
    ctx.shadowBlur=12; ctx.shadowOffsetY=4;
    snapshotDrawRoundRect(ctx,cardX,y,cardW,cardH,22,'#ffffff','#dce4e0');
    ctx.restore();

    // Green edge panel is drawn INSIDE its own reserved column. The previous
    // version started it on top of the Lean column, which is what caused the
    // overlapping text shown in the real exported screenshot.
    ctx.save();
    ctx.beginPath();
    const rr=22;
    ctx.moveTo(edgeX,y);
    ctx.lineTo(cardX+cardW-rr,y);
    ctx.arcTo(cardX+cardW,y,cardX+cardW,y+rr,rr);
    ctx.lineTo(cardX+cardW,y+cardH-rr);
    ctx.arcTo(cardX+cardW,y+cardH,cardX+cardW-rr,y+cardH,rr);
    ctx.lineTo(edgeX,y+cardH);
    ctx.closePath();
    ctx.fillStyle='#31b64b'; ctx.fill();
    ctx.restore();

    const awayId=row.g.cfbdAwayTeamId!=null?String(row.g.cfbdAwayTeamId):null;
    const homeId=row.g.cfbdHomeTeamId!=null?String(row.g.cfbdHomeTeamId):null;
    snapshotDrawLogo(ctx,awayId?logoById.get(awayId):null,row.g.away,cardX+24,y+48,68);
    snapshotDrawLogo(ctx,homeId?logoById.get(homeId):null,row.g.home,cardX+130,y+48,68);
    snapshotDrawRoundRect(ctx,cardX+101,y+68,24,24,12,'#f4f6f5','#d7dfdb');
    ctx.fillStyle='#7b8580'; ctx.font='700 13px Inter, Arial, sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText('@',cardX+113,y+80);

    // Matchup block has a fixed 245px lane. This keeps long matchup text from
    // invading the numeric columns, another source of the first export's
    // crowded/AI-looking layout.
    ctx.textAlign='left'; ctx.textBaseline='alphabetic';
    ctx.fillStyle='#111827'; ctx.font='800 30px Oswald, Inter, Arial Black, sans-serif';
    ctx.fillText(row.matchupShort,cardX+230,y+68,245);
    ctx.fillStyle='#667085'; ctx.font='500 17px Inter, Arial, sans-serif';
    ctx.fillText(row.kickoff,cardX+230,y+104,245);

    const statsX=cardX+500;
    const statsW=edgeX-statsX-20;
    const colGap=18;
    const colW=(statsW-colGap)/2;
    const marketX=statsX+colW+colGap;
    ctx.strokeStyle='#e2e8e5'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(cardX+480,y+28); ctx.lineTo(cardX+480,y+142); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(marketX-10,y+28); ctx.lineTo(marketX-10,y+92); ctx.stroke();

    ctx.fillStyle='#169b3a'; ctx.font='700 15px Inter, Arial, sans-serif';
    ctx.textAlign='left'; ctx.textBaseline='alphabetic'; ctx.fillText('PICKGAUGE',statsX,y+43);
    ctx.fillStyle='#111827'; ctx.font='800 27px Oswald, Inter, Arial Black, sans-serif';
    ctx.fillText(`${snapshotExportTeamShort(row.modelTeam)} ${fmt(row.modelLine)}`,statsX,y+76,colW-4);

    ctx.fillStyle='#667085'; ctx.font='700 15px Inter, Arial, sans-serif';
    ctx.fillText('MARKET',marketX,y+43);
    ctx.fillStyle='#111827'; ctx.font='800 27px Oswald, Inter, Arial Black, sans-serif';
    ctx.fillText(`${snapshotExportTeamShort(row.marketTeam)} ${fmt(row.marketLine)}`,marketX,y+76,colW-4);

    ctx.fillStyle='#7b8580'; ctx.font='700 11px Inter, Arial, sans-serif';
    ctx.fillText('MODEL GAP',statsX,y+104);
    snapshotDrawEdgeGauge(ctx,statsX,y+119,statsW,row.e.pts);

    ctx.textAlign='center'; ctx.fillStyle='#ffffff';
    ctx.font='700 18px Inter, Arial, sans-serif'; ctx.textBaseline='alphabetic';
    ctx.fillText('EDGE',edgeX+edgeW/2,y+43);
    ctx.font='800 54px Oswald, Inter, Arial Black, sans-serif';
    ctx.fillText(row.edgeText,edgeX+edgeW/2,y+105);
    ctx.font='700 14px Inter, Arial, sans-serif';
    ctx.fillText(`${snapshotExportTeamShort(row.e.team)} ${fmt(row.e.line)}`,edgeX+edgeW/2,y+136);
  });

  ctx.strokeStyle='#d7e0dc'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(40,H-58); ctx.lineTo(W-40,H-58); ctx.stroke();
  ctx.textAlign='left'; ctx.textBaseline='middle';
  ctx.fillStyle='#111827'; ctx.font='700 16px Inter, Arial, sans-serif';
  ctx.fillText('pickgauge.com',58,H-29);
  ctx.textAlign='right'; ctx.fillStyle='#6b7280'; ctx.font='500 14px Inter, Arial, sans-serif';
  ctx.fillText('Lines can move • Generated from current Snapshot',W-58,H-29);

  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob) throw new Error('PNG export failed');
  const a=document.createElement('a');
  const url=URL.createObjectURL(blob);
  const weekSlug=String(weekLabel(currentWeekIndex())).toLowerCase().replace(/\s+/g,'-');
  a.href=url;
  a.download=`pickgauge_top5_edges_${weekSlug}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
  if(typeof trackBetaEvent==='function') trackBetaEvent('snapshot_export',{source:'button'});
  return true;
}

function renderSnapshot(){
  const pool=currentPool();
  const ent=activeEntry();
  const coverOn=!!state.snapRankByCover;
  document.querySelectorAll("#scoreToggle .toggle-btn").forEach(b=>{
    b.classList.toggle("active",(b.dataset.score==="1")===coverOn);
  });
  renderSetupStatus();
  renderContextBar();  const allRows=snapshotRows();
  computeSnapshotScores(allRows);
  const stats=computeWeekStats(allRows);

  // Pick count now lives in the global context bar's summary line (see
  // renderContextBar()) rather than a Snapshot-specific element -- this
  // used to write into a #snapPickCount span that existed only here,
  // duplicating what Board's own #pickCount showed with a different id.

  document.getElementById("snapRankNote").textContent=coverOn
    ? "Ranked by Cover % · market line shown"
    : "Ranked by Raw Edge · market line shown";

  const ranked=[...allRows].sort((a,b)=>coverOn?(b.e.prob?b.e.prob.pCover:0)-(a.e.prob?a.e.prob.pCover:0):b.e.pts-a.e.pts);

  // ---- Top Opportunities ----
  // Capped at 5, but ALSO gated on actually clearing the "good" edge
  // threshold. This section's heading is "Your strongest ATS edges this
  // week" -- on a thin week where the model and market broadly agree, an
  // unconditional top-5 filled the slot with SLIM cards and presented them
  // under that heading anyway, which overstates them. Same reasoning as the
  // Edge Board's tier labels: report what's actually there, and say so
  // plainly when there's little.
  //
  // The bar is raw-edge-based (edgeClass) even while ranked by Cover %,
  // deliberately: each card's own tier label is raw-edge-based, and
  // computeWeekStats()'s strong/good counts are too, so the "N games clear
  // the bar" note below can never disagree with the STRONG EDGES / GOOD
  // EDGES numbers in the stat strip directly underneath it. Cover % still
  // controls the ORDER of whatever qualifies, as before.
  const qualifying=ranked.filter(r=>edgeClass(r.e.pts)!=="r");
  const shown=qualifying.slice(0,5);
  // The heading is itself part of the overstatement on a flat week --
  // "Your strongest ATS edges this week" above a set of slim leans (or
  // above nothing) reads as a claim the data doesn't support. Swap it for
  // a neutral statement of fact when nothing qualifies.
  const titleEl=document.getElementById("snapOppTitle");
  if(titleEl) titleEl.textContent=(allRows.length&&!qualifying.length)
    ?"No standout edges this week"
    :"Your strongest ATS edges this week";
  const noteEl=document.getElementById("snapOppThinNote");
  if(noteEl){
    if(!allRows.length){
      // No leans at all is already covered by the grid's own empty state
      // plus the Quick Look empty state -- don't stack a third message.
      noteEl.style.display="none";
    }else if(!qualifying.length){
      noteEl.style.display="";
      noteEl.innerHTML=`<b>No games clear the edge bar this week.</b> The model and the market are close on all ${allRows.length} game${allRows.length===1?"":"s"} — every lean is slim. The full slate is in <b>Top games</b> below.`;
    }else if(qualifying.length<5){
      noteEl.style.display="";
      noteEl.innerHTML=`Only ${qualifying.length} game${qualifying.length===1?"":"s"} clear${qualifying.length===1?"s":""} the edge bar this week — the other ${allRows.length-qualifying.length} ${allRows.length-qualifying.length===1?"lean is":"leans are"} slim. All ${allRows.length} are in <b>Top games</b> below.`;
    }else{
      noteEl.style.display="none";
    }
  }
  document.getElementById("snapOppGrid").innerHTML=shown.length?shown.map((r,idx)=>{
    const {g,e}=r;
    const cls=edgeClass(e.pts);
    const tierLabel=edgeTierLabel(e.pts);
    const picked=!!ent.picks[g.key];
    const shortlisted=isShortlisted(g.key);
    const logo=e.side==="home"?g.homeLogo:g.awayLogo;
    // Own class (not the shared .teampick-logo, 18px) -- same reasoning
    // as Quick Look's .bet-logo: these cards have real room for a bigger,
    // more identifiable logo. Wrapping <span> + inset <img>, same padded-
    // circular-badge treatment as .bet-logo/Board's .logo-badge -- a
    // bare img with border-radius:50% clips the corners of any square/
    // rectangular logo that fills its own frame edge-to-edge; the
    // padding insets the image so its corners land inside the circle.
    const logoHTML=logo?`<span class="opp-logo"><img src="${esc(logo)}" alt="" loading="lazy"></span>`:"";
    // Only the #1 card gets the green "primary action" treatment -- #2/#3
    // used to render their own independent btn-go, meaning up to THREE
    // simultaneously-visible green "Add pick" buttons competed for the
    // same attention with no visual reason to click one over another.
    // btn-secondary (bold dark outline) still reads as a real, clickable
    // action for #2/#3 -- just not the one thing this screen is telling
    // you to do first. "Already picked" collapses to the same quiet
    // btn-light regardless of rank either way -- nothing left to
    // emphasize once it's done.
    const primaryAction=idx===0;
    return `<div class="opp-card${idx===0?' rank-1':''}">
      <div class="opp-tier ${cls}">${tierLabel.toUpperCase()}</div>
      <div class="opp-team">${logoHTML}${esc(e.team)} ${fmt(e.line)}</div>
      <div class="opp-stats">
        <div><div class="opp-stat-lbl">Raw edge</div><div class="opp-stat-val edge-hero num">${fmt(e.pts)}</div><div class="edge-bar-track"><div class="edge-bar-fill" style="width:${Math.min(100,e.pts/12*100)}%;"></div></div></div>
        <div><div class="opp-stat-lbl">Cover est.</div><div class="opp-stat-val num">${e.prob&&e.prob.side?(e.prob.pCover*100).toFixed(1)+'%':'—'}</div></div>
      </div>
      <div class="opp-actions">
        <button class="btn ${picked?'btn-light':(primaryAction?'btn-go':'btn-secondary')}" data-snap-pick="${esc(g.key)}" data-snap-side="${esc(e.side)}">${picked?'✓ Picked':'★ Add pick'}</button>
        <button class="shortlist-toggle ${shortlisted?'active':''}" data-snap-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist — flag for a closer look before picking'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button>
        <button class="btn btn-light" data-snap-jump="${esc(g.key)}">Details</button>
      </div>
    </div>`;
  }).join("") : (allRows.length
    // Leans exist, none clear the bar. The amber note directly above
    // already explains this in full, so the grid itself stays empty rather
    // than restating it -- an earlier pass had both, which read as the
    // page saying the same thing twice in a row.
    ? ""
    : `<p class="note">No games with a live lean yet — refresh lines or load model predictions.</p>`);

  // ---- Week Snapshot stat panel ----
  const statRows=[
    [`Games analyzed`, stats.gamesAnalyzed],
    [`Strong edges`, stats.strong],
    [`Good edges`, stats.good],
    [`Key-number crossings`, stats.keyCrossings],
    [`Your average pick edge`, stats.avgPickEdge==null?"—":fmt(stats.avgPickEdge)+" pts"],
    [`Shortlisted`, currentShortlist().length],
  ];
  if(stats.pool) statRows.push([`Picked games with +CLV`, stats.clvEligible?`${stats.clvPos} / ${stats.clvEligible}`:"—"]);
  document.getElementById("snapStatsList").innerHTML=statRows.map(([lbl,val])=>
    `<div class="snap-tile"><div class="snap-lbl">${lbl}</div><div class="snap-val num">${val}</div></div>`
  ).join("");

  // ---- Full Slate (condensed) ----
  const filter=state.snapFilter||"all";
  document.querySelectorAll("#snapFilterPills .pill-btn").forEach(b=>b.classList.toggle("active",b.dataset.filter===filter));
  const filteredAll=snapshotFilterRows(ranked,filter);
  const filtered=filteredAll.slice(0,SNAPSHOT_ROW_LIMIT);

  // "Recommended bet / matchup" header carries a spacer matching
  // .bet-logo's width + .bet-block's gap (see those rules' own comments
  // in app/index.html) -- without it, the header text starts flush at
  // the column's left edge while the actual team-name text on every row
  // starts ~35px further right (the logo sits in that gap), so the
  // header visibly doesn't line up with the text underneath it even
  // though the LOGO does. This was worse after bumping the logo bigger
  // (26px, up from 18px) -- the bigger the logo, the bigger that
  // unindented gap looked.
  document.getElementById("snapTableHead").innerHTML=
    `<th></th><th class="l"><span class="bet-th-spacer"></span>Recommended bet / matchup</th><th>Market → Model</th><th>Raw edge</th><th>Cover %</th>${stats.pool?'<th>CLV</th>':''}<th class="signal-th">Signal</th><th>Action</th>`;

  const tbody=document.getElementById("snapTableBody");
  const empty=document.getElementById("snapEmpty");
  if(!filtered.length){
    tbody.innerHTML="";
    empty.style.display="block";
    // Real gap fix: this used to be one bare "No games match this
    // filter." message regardless of WHY -- someone with zero games
    // loaded, someone with games but no model inputs (so every edge is
    // exactly 0, nothing to rank), and someone whose specific filter
    // pill (Strong/Underdogs/etc.) just happens to match nothing among
    // real leans all saw the exact same unhelpful sentence. Distinguish
    // the three so the message names the actual blocker and, where
    // there's a real fix, links straight to it -- same
    // goToSetupItem()/predPanel target the setup checklist's own
    // "Explore ->" row already uses (see that fix's own comment).
    if(!games.length){
      empty.innerHTML=`No games loaded yet — hit <b>Refresh lines</b> above to pull this week's spreads.`;
    }else if(!allRows.length){
      empty.innerHTML=`No model edges yet — Vegas lines are in, but there's nothing to compare them to. <button type="button" class="btn-link-sm" id="snapEmptyLoadPreds">Load prediction systems</button> or import Powers PDF (BP/Comp) on the Edge Board to generate leans.`;
      const btn=document.getElementById("snapEmptyLoadPreds");
      if(btn) btn.onclick=()=>goToSetupItem({tab:"board", openPanel:"predPanel", highlight:"predPanel"});
    }else{
      const pillLabel=SNAP_FILTER_LABELS[filter]||"this filter";
      empty.innerHTML=`No games match <b>${esc(pillLabel)}</b> — try a different filter above.`;
    }
  }else{
    empty.style.display="none";
    tbody.innerHTML=filtered.map(r=>{
      const {g,e}=r;
      const picked=!!ent.picks[g.key];
      const shortlisted=isShortlisted(g.key);
      const myn=myNumber(g);
      let clvTd="";
      if(stats.pool){
        const cell=snapClvCellData(g,picked?ent.picks[g.key].side:null,e.side);
        // Same ⚡ signal the full Board tab already shows (clvAlignment()) --
        // market movement since lock AND the model's remaining disagreement
        // both pointing the same way. Previously Board-only; added here so
        // Snapshot users see it without switching tabs.
        const aligned=clvAlignment(g)||0;
        const alignBadge=aligned?` <span class="clv-align" title="Market movement since lock AND the model's remaining disagreement with the current line both point the same direction — the market's been sliding this way, and the model still sees more room to go.">⚡</span>`:"";
        if(cell.kind==="none"){
          clvTd=`<td data-label="CLV"><span class="faint">—</span></td>`;
        }else if(cell.kind==="raw"){
          // No pick AND no model lean either (model===market exactly) --
          // nothing to orient the move to, so show the raw home-perspective
          // market move instead of a blank dash.
          clvTd=`<td data-label="CLV" title="No pick or lean yet — raw market move since lock, home-team perspective."><span class="clv-raw num">${fmt(cell.value)}</span></td>`;
        }else{
          const title=cell.kind==="recommended"
            ? `Recommended pick — locked ${fmt(g.lockedLine)} · live ${fmt(g.liveVegas)} (home persp.)`
            : `Locked ${fmt(g.lockedLine)} · live ${fmt(g.liveVegas)} (home persp.)`;
          clvTd=`<td data-label="CLV" title="${title}"><span class="${cell.value>0?'clv-good':cell.value<0?'clv-bad':'clv-even'} num">${fmt(cell.value)}</span>${alignBadge}</td>`;
        }
      }
      const logo=e.side==="home"?g.homeLogo:g.awayLogo;
      // Own class (not the shared .teampick-logo used by Board's compact
      // pill buttons and the Top Opportunities cards above) -- Quick
      // Look's rows have real room for a bigger, more identifiable logo;
      // reusing .teampick-logo here would also bump it everywhere else
      // .teampick-logo is used, which wasn't part of this fix.
      // Wrapping <span> + inset <img> -- same padded-circular-badge
      // pattern Board's mobile card view already established for its own
      // away-logo/home-logo (.board .logo-badge, see that rule's own
      // comment on why: object-fit:contain sizes the whole image within
      // a plain circular border-radius mask, but a square/rectangular
      // logo that fills its own frame edge-to-edge then has ITS OWN
      // corners clipped by that circle -- "part of the logo gets cut
      // off". A fixed-size frame with real internal padding insets the
      // image so its corners land inside the circle, not clipped by it,
      // rather than just making the same problem bigger.
      const logoHTML=logo?`<span class="bet-logo"><img src="${esc(logo)}" alt="" loading="lazy"></span>`:"";
      const isOpen=snapExpandedKeys.has(g.key);
      const mainRow=`<tr class="${picked?'picked':''}" data-key="${esc(g.key)}">
        <td><button class="expand-btn ${isOpen?'open':''}" data-snap-expand="${esc(g.key)}" aria-label="Show detail">▸</button></td>
        <td class="l" data-label="Bet"><div class="bet-block">${logoHTML}<div class="bet-text"><div class="bet-line">${esc(e.team)} ${fmt(e.line)}</div><div class="matchup-sub">${esc(g.away)} @ ${esc(g.home)}</div></div></div></td>
        <td data-label="Market → Model">${mktModelHTML(e,myn)}</td>
        <td data-label="Raw edge"><span class="pill ${edgeClass(e.pts)}">${fmt(e.pts)}</span></td>
        <td data-label="Cover %">${probCellHTML(e)}</td>
        ${clvTd}
        <td data-label="Signal" class="signal-td">${edgeExtrasHTML(e,g)||'<span class="faint">—</span>'}</td>
        <td data-label="Pick"><button class="btn btn-light" data-snap-pick="${esc(g.key)}" data-snap-side="${esc(e.side)}" style="padding:5px 10px;font-size:12px;">${picked?'✓':'★'}</button><button class="shortlist-toggle ${shortlisted?'active':''}" data-snap-shortlist="${esc(g.key)}" title="${shortlisted?'Remove from shortlist':'Add to shortlist'}" aria-label="${shortlisted?'Remove from shortlist':'Add to shortlist'}">⚑</button></td>
      </tr>`;
      const detailRow=isOpen?renderSnapDetailRow(r,coverOn,stats):"";
      return mainRow+detailRow;
    }).join("");
  }

  const moreRow=document.getElementById("snapMoreRow");
  if(filteredAll.length>filtered.length){
    moreRow.style.display="flex";
    document.getElementById("snapMoreNote").textContent=
      `Showing top ${filtered.length} of ${filteredAll.length} games`;
  }else{
    moreRow.style.display="none";
  }

  document.getElementById("snapMethodology").innerHTML=coverOn
    ? `<b>Ranked by Cover %</b> — modeled probability your side covers, fitted from 5,705 real FBS-vs-FBS games (2018-2025), the same real methodology behind the Cover % column itself. Not a synthetic blend — this is the actual number ranking the slate. Switch to Raw Edge above to rank by model-vs-market disagreement instead.`
    : `<b>Ranked by Raw Edge</b> — the model-vs-market disagreement in points, the same metric the Edge Board has always used. Try Cover % above to rank by modeled cover probability instead.`;

  const exportBtn=document.getElementById("snapExportBtn");
  if(exportBtn) exportBtn.onclick=async()=>{
    const orig=exportBtn.textContent;
    exportBtn.disabled=true;
    exportBtn.textContent='Exporting…';
    try{
      const ok=await exportSnapshotTopEdgesGraphic();
      exportBtn.textContent=ok?'✓ Exported':'Export top 5 graphic';
      setTimeout(()=>{ exportBtn.textContent=orig; exportBtn.disabled=false; }, ok?1600:250);
    }catch(err){
      console.error('snapshot export failed',err);
      exportBtn.disabled=false;
      exportBtn.textContent=orig;
      if(typeof pgAlert==='function') await pgAlert({title:'Export failed',message:'PickGauge could not build the top-5 graphic just now. Try again in a moment.'});
    }
  };

  document.querySelectorAll("[data-snap-pick]").forEach(btn=>{
    btn.onclick=()=>{ pickTeam(btn.dataset.snapPick,btn.dataset.snapSide); };
  });
  document.querySelectorAll("[data-snap-shortlist]").forEach(btn=>{
    btn.onclick=()=>{ toggleShortlist(btn.dataset.snapShortlist); };
  });
  document.querySelectorAll("[data-snap-jump]").forEach(btn=>{
    btn.onclick=()=>{ switchTab("board"); setTimeout(()=>{ const row=document.querySelector(`tr[data-key="${CSS.escape(btn.dataset.snapJump)}"]`); if(row) row.scrollIntoView({behavior:"smooth",block:"center"}); },50); };
  });
  document.querySelectorAll("[data-snap-expand]").forEach(btn=>{
    btn.onclick=()=>{
      const key=btn.dataset.snapExpand;
      if(snapExpandedKeys.has(key)) snapExpandedKeys.delete(key); else snapExpandedKeys.add(key);
      renderSnapshot(); // re-render Snapshot only -- expand/collapse doesn't touch board data
    };
  });
}
