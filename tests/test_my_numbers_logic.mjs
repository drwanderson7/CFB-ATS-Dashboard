// Phase-1 My Numbers regression coverage. Exercises the ACTUAL functions from
// app/js/my-numbers.js rather than a copied implementation.
import fs from "node:fs";
import vm from "node:vm";

const mySrc=fs.readFileSync(new URL("../app/js/my-numbers.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
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
  const calls={save:0};
  const ctx={
    console, Date, Number, String, Array, Object, RegExp, Math,
    state:{myNumbers:{}}, games:[],
    seasonYear:()=>2026,
    weekIndexOf:(c)=>String(c||"").includes("week2")?2:1,
    currentWeekIndex:()=>1,
    currentPool:()=>activePool,
    teamMatchTrunc:(a,b)=>normalizeName(a)===normalizeName(b),
    round1:(n)=>Math.round(n*10)/10,
    fmt:(n)=>{ const r=Math.round(Number(n)*10)/10; return (r>0?"+":"")+r.toFixed(1); },
    esc:(s)=>String(s??""),
    edgeClass:(pts)=>pts>=3?"gd":pts>=1.5?"g":"r",
    save:()=>{calls.save++;},
  };
  vm.createContext(ctx);
  vm.runInContext(mySrc,ctx);
  ctx.__setPool=(v)=>{activePool=v?pool:null;};
  ctx.__calls=calls;
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

console.log("");
console.log(`${total-failures.length}/${total} checks passed`);
if(failures.length){ console.log("FAILED:"); failures.forEach(f=>console.log(`  - ${f}`)); process.exit(1); }
