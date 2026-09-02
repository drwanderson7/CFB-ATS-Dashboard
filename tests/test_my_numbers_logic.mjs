// Phase-1 My Numbers regression coverage. Exercises the ACTUAL functions from
// app/js/my-numbers.js rather than a copied implementation.
import fs from "node:fs";
import vm from "node:vm";

const mySrc=fs.readFileSync(new URL("../app/js/my-numbers.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8")
  // CSS moved out of index.html into app/css/app.css (Aug 28, pure file-
  // split) -- appended here the same way this codebase already handles
  // every other file split out of index.html.
  + fs.readFileSync(new URL("../app/css/app.css",import.meta.url),"utf8");
const modelSrc=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");

const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }
function extractFunction(name,source){
  const marker=`function ${name}(`,start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){i++;break;} }
  }
  return source.slice(start,i);
}

function normalizeName(s){ return String(s||"").toLowerCase().replace(/[^a-z0-9]/g,""); }
function makeCtx(){
  const pool={id:"pool1",weekLabel:"Week 1"};
  let activePool=null;
  let weekIdx=1;
  const calls={save:0};
  let uidN=0;
  // Minimal fake DOM -- just enough for myNumbersColumnVisible()/
  // updateMyNumbersColumnVisibility() to run for real. #myNumbersPanel's
  // `open` is directly settable (mirrors the real <details> element); the
  // fake .board tracks classList.toggle(cls, force) with real two-arg
  // force semantics, since that's the only call shape the real code uses.
  const panel={open:false};
  const boardClasses=new Set();
  const board={classList:{
    toggle:(cls,force)=>{ if(force){boardClasses.add(cls);} else {boardClasses.delete(cls);} },
    contains:(cls)=>boardClasses.has(cls),
  }};
  const fakeDocument={
    getElementById:(id)=>id==="myNumbersPanel"?panel:null,
    querySelector:(sel)=>sel===".board"?board:null,
  };
  const ctx={
    console, Date, Number, String, Array, Object, RegExp, Math,
    state:{myNumbers:{}}, games:[],
    document:fakeDocument,
    seasonYear:()=>2026,
    weekIndexOf:(c)=>String(c||"").includes("week2")?2:1,
    currentWeekIndex:()=>weekIdx,
    currentPool:()=>activePool,
    teamMatchTrunc:(a,b)=>normalizeName(a)===normalizeName(b),
    round1:(n)=>Math.round(n*10)/10,
    fmt:(n)=>{ const r=Math.round(Number(n)*10)/10; return (r>0?"+":"")+r.toFixed(1); },
    esc:(s)=>String(s??""),
    edgeClass:(pts)=>pts>=3?"gd":pts>=1.5?"g":"r",
    save:()=>{calls.save++;},
    uid:()=>`u${++uidN}`,
  };
  vm.createContext(ctx);
  vm.runInContext(mySrc,ctx);
  ctx.__setPool=(v)=>{activePool=v?pool:null;};
  ctx.__setWeek=(v)=>{weekIdx=v;};
  ctx.__calls=calls;
  ctx.__panel=panel;
  ctx.__boardHasHideClass=()=>boardClasses.has("hide-usernum");
  return ctx;
}

// Persistence + week scoping + cross-context reuse.
{
  const ctx=makeCtx();
  const g={key:"ala@aub",away:"Alabama",home:"Auburn",commence:"week1",vegas:-3.5,cfbdGameId:123};
  ctx.games=[g];
  ctx.setUserNumber(g,-7);
  check("manual entry is stored and read back",ctx.userNumberFor(g)===-7);
  check("manual entry calls save()",ctx.__calls.save===1);
  check("storage scope is season/week based",Array.isArray(ctx.state.myNumbers["2026:week:1"]));
  ctx.__setPool(true);
  const poolShape={...g,key:"alabama@auburn",providerGameId:"odds-1"};
  check("same game reuses My Number across Overall and pool context",ctx.userNumberFor(poolShape)===-7);
  const week2={...g,key:"ala@aub2",commence:"week2",cfbdGameId:456};
  check("a different week starts empty",ctx.userNumberFor(week2)===null);
  ctx.setUserNumber(g,null);
  check("clearing one value removes it",ctx.userNumberFor(g)===null);
}

// Independent My Edge: compare against board reference line, never Model #.
{
  const ctx=makeCtx();
  const g={key:"uga@clem",away:"Georgia",home:"Clemson",commence:"week1",vegas:4};
  ctx.games=[g];
  ctx.setUserNumber(g,7,{deferSave:true}); // away (Georgia) favored more than market
  const e=ctx.myNumbersEdge(g);
  check("My edge magnitude is absolute difference between personal and reference line",e&&e.pts===3);
  check("higher home-perspective personal line recommends away side",e&&e.side==="away"&&e.team==="Georgia"&&e.line===-4);
  check("core model source does not read userNumberFor/My Numbers",!modelSrc.includes("userNumberFor")&&!modelSrc.includes("state.myNumbers"));
}

// CSV parsing: exact documented shape, quoted names, PK, signed-team format.
{
  const ctx=makeCtx();
  const parsed=ctx.parseMyNumbersCsv('Away Team,Home Team,My Line\r\n"Miami, FL",Florida State,PK\r\nGeorgia,Clemson,Georgia -7\r\n');
  check("CSV parser recognizes documented three columns",!parsed.error&&parsed.rows.length===2);
  check("CSV parser preserves quoted comma-containing team names",parsed.rows[0].away==="Miami, FL");
  check("PK parses to zero",ctx.parseMyNumbersLine("PK","Miami","Florida State").value===0);
  check("named away-team -7 converts to +7 home-team perspective",ctx.parseMyNumbersLine("Georgia -7","Georgia","Clemson").value===7);
  check("named home-team -7 stays -7 home-team perspective",ctx.parseMyNumbersLine("Clemson -7","Georgia","Clemson").value===-7);
  check("plain numeric values are accepted as home-team perspective",ctx.parseMyNumbersLine("-4.5","Georgia","Clemson").value===-4.5);
}

// Auto match + review queue.
{
  const ctx=makeCtx();
  ctx.games=[
    {key:"uga@clem",away:"Georgia",home:"Clemson",commence:"week1",vegas:3},
    {key:"ala@fsu",away:"Alabama",home:"Florida State",commence:"week1",vegas:2},
  ];
  const result=ctx.applyMyNumbersCsvText('Away Team,Home Team,My Line\nGeorgia,Clemson,Georgia -7\nUnknown Tech,Nowhere State,-3\n');
  check("CSV importer auto-matches a unique current-board matchup",result.matched===1&&ctx.userNumberFor(ctx.games[0])===7);
  check("unmatched CSV rows are retained for review instead of silently dropped",result.review.length===1&&result.review[0].away==="Unknown Tech");
  check("bulk import saves matched values once",ctx.__calls.save===1);
}

// normalizeState + actual UI/script wiring.
{
  check("normalizeState initializes private myNumbers object",mainSrc.includes('s.myNumbers=(s.myNumbers&&typeof s.myNumbers==="object"&&!Array.isArray(s.myNumbers))?s.myNumbers:{}'));
  check("Edge Board contains My Numbers panel",html.includes('id="myNumbersPanel"'));
  check("Edge Board contains CSV file input",html.includes('id="myNumbersCsvFile"'));
  check("Edge Board contains template download control",html.includes('id="myNumbersTemplateBtn"'));
  check("my-numbers.js is loaded by app page",html.includes('<script src="/app/js/my-numbers.js"></script>'));
  check("mobile layout gives My Numbers its own row instead of squeezing core stats",html.includes('.board td.usernum-cell{grid-column:2/6;grid-row:4'));
}

// --- Performance tracking (#18): freeze-at-entry + manual grading ---------
{
  const ctx=makeCtx();
  ctx.__setWeek(1);
  const g={key:"uga@clem",away:"Georgia",home:"Clemson",commence:"week1",vegas:3,cfbdGameId:1};
  ctx.games=[g];
  ctx.setUserNumber(g,7,{deferSave:true}); // implies away (Georgia) lean, 4pt edge vs market
  const rec=ctx.state.myNumbers["2026:week:1"][0];
  check("setUserNumber freezes vegasAtEntry from the market at entry time",rec.vegasAtEntry===3);
  check("setUserNumber assigns a stable id to a new record",!!rec.id);

  // the market moves later, but the frozen edge must not follow it
  g.vegas=1;
  const frozenEdge=ctx.myNumbersRecordEdge(rec);
  check("myNumbersRecordEdge uses frozen vegasAtEntry, not today's live g.vegas",frozenEdge.pts===4&&frozenEdge.side==="away"&&frozenEdge.team==="Georgia");
  const liveEdge=ctx.myNumbersEdge(g);
  check("myNumbersEdge (board cell) still reflects the live market, unaffected by the frozen tracker",liveEdge.pts===6);

  // editing an ungraded record's value re-freezes vegasAtEntry to the
  // CURRENT market (still "at entry", since nothing's graded yet)
  ctx.setUserNumber(g,7,{deferSave:true});
  check("editing an ungraded record updates vegasAtEntry to the current market",ctx.state.myNumbers["2026:week:1"][0].vegasAtEntry===1);
}

// current week is excluded from grading; a past week is included
{
  const ctx=makeCtx();
  ctx.__setWeek(2); // "now" is week 2
  const gCur={key:"a@b",away:"A",home:"B",commence:"week2",vegas:3,cfbdGameId:1};
  const gPast={key:"c@d",away:"C",home:"D",commence:"week1",vegas:3,cfbdGameId:2};
  ctx.games=[gCur,gPast];
  ctx.setUserNumber(gCur,7,{deferSave:true});
  ctx.setUserNumber(gPast,7,{deferSave:true});
  const gradable=ctx.myNumbersGradableRecords();
  check("myNumbersGradableRecords excludes the current week's own scope key",!gradable.some(x=>x.scopeKey==="2026:week:2"));
  check("myNumbersGradableRecords includes a past week's ungraded record",gradable.some(x=>x.scopeKey==="2026:week:1"));
  check("myNumbersGradableRecords excludes a record with zero implied edge (number matched the market exactly)",
    (()=>{
      const flat={key:"e@f",away:"E",home:"F",commence:"week1",vegas:3,cfbdGameId:3};
      ctx.games.push(flat);
      ctx.setUserNumber(flat,3,{deferSave:true}); // matches vegas exactly -> 0 edge
      return !ctx.myNumbersGradableRecords().some(x=>x.rec.away==="E");
    })());
}

// grading, toggle-off, and freezing at grade time
{
  const ctx=makeCtx();
  ctx.__setWeek(2);
  const g={key:"c@d",away:"C",home:"D",commence:"week1",vegas:3,cfbdGameId:2};
  ctx.games=[g];
  ctx.setUserNumber(g,7,{deferSave:true});
  const recId=ctx.state.myNumbers["2026:week:1"][0].id;
  const current=()=>ctx.state.myNumbers["2026:week:1"].find(r=>r.id===recId);
  ctx.__calls.save=0;
  check("setMyNumbersResult grades a real ungraded record",ctx.setMyNumbersResult("2026:week:1",recId,"W"));
  check("grading calls save()",ctx.__calls.save===1);
  check("grading freezes gradedEdgePts/gradedSide/gradedTeam from the record's frozen edge",
    current().result==="W"&&current().gradedEdgePts===4&&current().gradedSide==="away"&&current().gradedTeam==="C");
  check("a graded record no longer shows up as gradable",!ctx.myNumbersGradableRecords().some(x=>x.rec.id===recId));
  // editing the game's My Number again after grading must NOT touch the
  // frozen grade -- this is the literal "freeze historical inputs, don't
  // recalculate old weeks with today's model" requirement. setUserNumber()
  // replaces the array entry with a new object each edit, so re-fetch by
  // id (current()) rather than holding a stale reference across the edit.
  g.vegas=10;
  ctx.setUserNumber(g,8,{deferSave:true});
  check("editing a GRADED record's value preserves its frozen vegasAtEntry",current().vegasAtEntry===3);
  check("editing a GRADED record's value preserves its frozen result/grade fields",
    current().result==="W"&&current().gradedEdgePts===4&&current().gradedSide==="away"&&current().gradedTeam==="C");
  // toggle off
  check("clicking the same result again clears the grade (toggle-off, same pattern as Results' setResult())",
    ctx.setMyNumbersResult("2026:week:1",recId,"W")&&current().result===undefined&&current().gradedEdgePts===undefined);
  check("unknown record id is a safe no-op, returns false",!ctx.setMyNumbersResult("2026:week:1","nope","W"));
  check("unknown scope key is a safe no-op, returns false",!ctx.setMyNumbersResult("2099:week:1",recId,"W"));
}

// aggregate stats: record, win rate, average edge, edge buckets
{
  const ctx=makeCtx();
  ctx.__setWeek(3);
  const mk=(key,away,home,vegas,value,week)=>({key,away,home,commence:week,vegas,cfbdGameId:key});
  ctx.games=[
    mk("g1","A1","H1",3,7,"week1"),   // 4pt edge, away lean
    mk("g2","A2","H2",0,-5,"week1"),  // 5pt edge, home lean
    mk("g3","A3","H3",1,2,"week1"),   // 1pt edge, away lean
    mk("g4","A4","H4",-3,1,"week1"),  // 4pt edge, away lean
  ];
  ctx.setUserNumber(ctx.games[0],7,{deferSave:true});
  ctx.setUserNumber(ctx.games[1],-5,{deferSave:true});
  ctx.setUserNumber(ctx.games[2],2,{deferSave:true});
  ctx.setUserNumber(ctx.games[3],1,{deferSave:true});
  const recs=ctx.state.myNumbers["2026:week:1"];
  ctx.setMyNumbersResult("2026:week:1",recs[0].id,"W"); // 4.0 bucket, W
  ctx.setMyNumbersResult("2026:week:1",recs[1].id,"L"); // 5.0 bucket, L
  ctx.setMyNumbersResult("2026:week:1",recs[2].id,"P"); // 1.0 bucket, P
  ctx.setMyNumbersResult("2026:week:1",recs[3].id,"W"); // 4.0 bucket, W

  const stats=ctx.myNumbersPerformanceStats();
  check("myNumbersPerformanceStats: correct graded count",stats.graded===4);
  check("myNumbersPerformanceStats: correct W-L-P record",stats.W===2&&stats.L===1&&stats.P===1);
  check("myNumbersPerformanceStats: win rate excludes pushes from the denominator (2 of 3 decisions)",stats.winPct===66.7);
  check("myNumbersPerformanceStats: average edge across all graded records",stats.avgEdge===round1((4+5+1+4)/4));
  const b3to5=stats.buckets.find(b=>b.label==="3.0–4.9");
  check("myNumbersPerformanceStats: 3.0-4.9 bucket has the two 4pt records (2-0-0)",b3to5&&b3to5.W===2&&b3to5.L===0&&b3to5.n===2);
  const b5plus=stats.buckets.find(b=>b.label==="5.0+");
  check("myNumbersPerformanceStats: 5.0+ bucket has the 5pt loss",b5plus&&b5plus.L===1&&b5plus.n===1);
  const b01to14=stats.buckets.find(b=>b.label==="0.1–1.4");
  check("myNumbersPerformanceStats: 0.1-1.4 bucket has the 1pt push",b01to14&&b01to14.P===1&&b01to14.n===1);
}
{
  const ctx=makeCtx();
  const stats=ctx.myNumbersPerformanceStats();
  check("myNumbersPerformanceStats: no graded records yet -> zeroed out, not a crash",
    stats.graded===0&&stats.W===0&&stats.L===0&&stats.P===0&&stats.winPct===null&&stats.avgEdge===null);
}

function round1(n){ return Math.round(n*10)/10; }

// --- My Numbers column/row visibility (UI review item #3) -----------------
// Real problem this fixes: the My Numbers column/mobile row rendered
// unconditionally, even at "0 of N entered" -- 8 empty "enter line" boxes
// as the widest non-data column on the board for anyone who's never used
// the feature, repeated on every single mobile card. Now hidden unless the
// My Numbers panel is open OR at least one number is genuinely entered.
{
  const ctx=makeCtx();
  const g1={key:"a@b",away:"A",home:"B",commence:"week1",vegas:3};
  ctx.games=[g1];

  check("myNumbersColumnVisible: false with panel closed and nothing entered",
    ctx.myNumbersColumnVisible()===false);
  ctx.updateMyNumbersColumnVisibility();
  check("updateMyNumbersColumnVisibility: adds hide-usernum to .board when nothing to show",
    ctx.__boardHasHideClass()===true);

  ctx.__panel.open=true;
  check("myNumbersColumnVisible: true while the panel is open, regardless of entries",
    ctx.myNumbersColumnVisible()===true);
  ctx.updateMyNumbersColumnVisibility();
  check("updateMyNumbersColumnVisibility: removes hide-usernum while the panel is open",
    ctx.__boardHasHideClass()===false);

  ctx.__panel.open=false;
  ctx.setUserNumber(g1,-5,{deferSave:true});
  check("myNumbersColumnVisible: true once a real number is entered, even with the panel closed",
    ctx.myNumbersColumnVisible()===true);
  ctx.updateMyNumbersColumnVisibility();
  check("updateMyNumbersColumnVisibility: stays visible (no hide-usernum) once real data exists -- never hides entered data",
    ctx.__boardHasHideClass()===false);

  // Clearing the number with the panel still closed should hide it again.
  ctx.setUserNumber(g1,"",{deferSave:true});
  check("myNumbersColumnVisible: false again once the only entry is cleared and the panel is closed",
    ctx.myNumbersColumnVisible()===false);

  // Multi-game slate: ANY entered number keeps it visible, not just the first.
  const g2={key:"c@d",away:"C",home:"D",commence:"week1",vegas:1};
  ctx.games=[g1,g2];
  ctx.setUserNumber(g2,2,{deferSave:true});
  check("myNumbersColumnVisible: true if ANY game in the current slate has an entered number",
    ctx.myNumbersColumnVisible()===true);
}
{
  // No #myNumbersPanel in the DOM at all (defensive: shouldn't happen on
  // the real page, but must not throw) -- currentMyNumbersCount() is the
  // sole fallback.
  const ctx=makeCtx();
  ctx.document.getElementById=()=>null;
  ctx.games=[{key:"a@b",away:"A",home:"B",commence:"week1",vegas:3}];
  check("myNumbersColumnVisible: falls back to entry count without throwing if the panel element is missing",
    ctx.myNumbersColumnVisible()===false);
}

// --- wiring: the real page actually has the pieces this depends on -------
check("board.js's usernum <th> carries the same .usernum-cell class as the <td> cells, so one CSS rule hides both",
  /sortHeaderHTML\("usernum","My Numbers",\{[^}]*extraClass:"usernum-cell"/.test(
    fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8")));
check("renderMyNumbersControls() calls updateMyNumbersColumnVisibility(), so every board render/edit/clear stays in sync",
  /renderMyNumbersPerformance\(\);\s*\n\s*updateMyNumbersColumnVisibility\(\);\s*\n\}/.test(mySrc));
check("initMyNumbers() listens for the native <details> toggle event, so manually opening/closing the panel updates immediately",
  /panel\.addEventListener\("toggle",updateMyNumbersColumnVisibility\)/.test(mySrc));
check(".board.hide-usernum .usernum-cell is styled to hide (covers desktop th/td AND the mobile card row, same class both places)",
  /\.board\.hide-usernum \.usernum-cell\{display:none/.test(html));

console.log("");
console.log(`${total-failures.length}/${total} checks passed`);
if(failures.length){ console.log("FAILED:"); failures.forEach(f=>console.log(`  - ${f}`)); process.exit(1); }
