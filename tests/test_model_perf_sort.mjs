// Regression for Drew's Sept 8, 2026 request: the Model Performance
// leaderboard table (Model / ATS / Win % / Avg edge / n) on the Results
// tab should have clickable column headers -- alphabetical for the Model
// name column, numeric for the rest.
//
// Same fs+vm harness pattern as test_model_performance_history_logic.mjs:
// load the real record.js source into a sandboxed context with the
// external globals it expects (esc, fmt, round1, etc.) stubbed, then
// exercise the actual functions rather than re-implementing sort logic
// here to test against.
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/record.js",import.meta.url),"utf8");

const ctx={
  console,
  esc:x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  fmt:n=>{ if(n==null||isNaN(n)) return "—"; const r=Math.round(n*10)/10; return (r>0?"+":"")+r.toFixed(1); },
  round1:n=>Math.round(n*10)/10,
  renderRecord:()=>{ ctx.__renderCount=(ctx.__renderCount||0)+1; },
};
vm.createContext(ctx);vm.runInContext(src,ctx);
// record.js defines its own real renderRecord() (which needs `document`,
// unavailable in this harness) -- override it AFTER loading so
// setModelPerfSort()'s renderRecord() call is a harmless no-op instead of
// throwing, same as the file's own stub above intended.
ctx.renderRecord=()=>{ ctx.__renderCount=(ctx.__renderCount||0)+1; };

const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}

// --- sortModelPerfSystems(): pure function, direct unit coverage ---
const sample=[
  {code:"pickgauge",name:"PickGauge Model #",W:25,L:15,P:1,n:41,winPct:0.625,avgEdge:1.8},
  {code:"sag",name:"Sagarin Ratings",W:24,L:16,P:1,n:41,winPct:0.6,avgEdge:6.2},
  {code:"wayward",name:"Waywardtrends",W:10,L:8,P:0,n:18,winPct:0.5556,avgEdge:3.1},
  {code:"fpi",name:"ESPN FPI",W:0,L:0,P:5,n:5,winPct:null,avgEdge:null}, // all pushes -- no decisions yet
];

check("sortModelPerfSystems() with no sort key returns the array UNCHANGED (default PickGauge-first order stands)",
  ctx.sortModelPerfSystems(sample,{key:null,dir:null})===sample);

const byNameAsc=ctx.sortModelPerfSystems(sample,{key:"name",dir:"asc"});
check("sort by Model name, ascending: literal A-to-Z order",
  byNameAsc.map(s=>s.code).join(",")==="fpi,pickgauge,sag,wayward");

const byNameDesc=ctx.sortModelPerfSystems(sample,{key:"name",dir:"desc"});
check("sort by Model name, descending: Z-to-A order",
  byNameDesc.map(s=>s.code).join(",")==="wayward,sag,pickgauge,fpi");

const byWinPctDesc=ctx.sortModelPerfSystems(sample,{key:"winPct",dir:"desc"});
check("sort by Win %, descending: highest win% first",
  byWinPctDesc[0].code==="pickgauge"&&byWinPctDesc[1].code==="sag"&&byWinPctDesc[2].code==="wayward");
check("sort by Win %, descending: a system with NO decisions yet (null winPct) sorts LAST regardless of direction",
  byWinPctDesc.at(-1).code==="fpi");

const byWinPctAsc=ctx.sortModelPerfSystems(sample,{key:"winPct",dir:"asc"});
check("sort by Win %, ascending: lowest real win% first, but null STILL sorts last (not first, which 'ascending' would naively suggest)",
  byWinPctAsc[0].code==="wayward"&&byWinPctAsc.at(-1).code==="fpi");

const byAtsDesc=ctx.sortModelPerfSystems(sample,{key:"ats",dir:"desc"});
check("sort by ATS, descending: ranks by net wins (W-L) -- pickgauge (+10) then sag (+8) then wayward (+2) then fpi (0)",
  byAtsDesc.map(s=>s.code).join(",")==="pickgauge,sag,wayward,fpi");

const byAvgEdgeDesc=ctx.sortModelPerfSystems(sample,{key:"avgEdge",dir:"desc"});
check("sort by Avg edge, descending: biggest average edge first (sag 6.2 > wayward 3.1 > pickgauge 1.8), null last",
  byAvgEdgeDesc.map(s=>s.code).join(",")==="sag,wayward,pickgauge,fpi");

const byNDesc=ctx.sortModelPerfSystems(sample,{key:"n",dir:"desc"});
check("sort by n, descending: most graded games first",
  byNDesc.map(s=>s.n).join(",")==="41,41,18,5");

// --- setModelPerfSort(): the click-toggle behavior itself ---
// recordModelPerfSort is a module-scoped `let`, not `var`/a function decl,
// so unlike PRED_SYSTEMS etc. above it never becomes a property on this vm
// context's global object -- ctx.recordModelPerfSort would just create an
// unrelated property, not touch the real internal state. Observe the
// toggle purely through its effects: setModelPerfSort()'s own re-render
// trigger, and what recordModelPerformanceHTML() actually renders
// afterward (header label/class, row order) -- exactly what a real click
// in the browser would produce.
const perfHist=[{season:2026,week:1,games:[
  {cfbdGameId:1,marketHomeLine:-3,systems:{pickgauge:-6,sag:-9},systemResults:{pickgauge:"W",sag:"L"}},
  {cfbdGameId:2,marketHomeLine:5,systems:{pickgauge:2,sag:1},systemResults:{pickgauge:"L",sag:"W"}},
]}];
const filters={season:"all",week:"all"};

const htmlDefault=ctx.recordModelPerformanceHTML(perfHist,filters);
// NOTE: can't just search for the text "PickGauge Model #"/"Sagarin"
// anywhere in the HTML -- the pgHero metrics block (rendered BEFORE the
// table) always mentions "PickGauge Model # ATS" regardless of table sort
// order, which would make this check pass even if the table itself were
// broken. Anchor on each system's actual row instead
// (data-model-perf-toggle="<code>"), which only exists once per system,
// inside the table, in the table's real row order.
const rowOrder=html=>[...html.matchAll(/data-model-perf-toggle="([a-z]+)"/g)].map(m=>m[1]);
check("recordModelPerformanceHTML(): with no sort active, PickGauge Model # renders first (the table's original default order, untouched until the user clicks a header)",
  rowOrder(htmlDefault)[0]==="pickgauge");
check("recordModelPerformanceHTML(): with no sort active, no header carries the 'active' sort-styling class",
  !htmlDefault.includes("model-perf-sort-active"));

ctx.setModelPerfSort("name");
const htmlNameAsc=ctx.recordModelPerformanceHTML(perfHist,filters);
check("first click on the Model header: sorts ASCENDING (literally 'a to z', Drew's own framing) -- 'PickGauge Model #' (P) now renders before 'Sagarin' (S), same as it already did by luck in the default order, so also check the header itself picked up the ascending label",
  /aria-label="Sort by Model, currently ascending"/.test(htmlNameAsc));
check("first click on Model: the header button carries the active-sort styling class",
  /class="model-perf-sort-btn model-perf-sort-active" data-model-perf-sort="name"/.test(htmlNameAsc));
check("setModelPerfSort() triggers a re-render",
  ctx.__renderCount>0);

ctx.setModelPerfSort("name");
const htmlNameDesc=ctx.recordModelPerformanceHTML(perfHist,filters);
check("second click on the SAME header (Model): flips to descending -- 'Sagarin' (S) now renders before 'PickGauge Model #' (P) in actual table row order",
  rowOrder(htmlNameDesc)[0]==="sag"
  &&/aria-label="Sort by Model, currently descending"/.test(htmlNameDesc));

ctx.setModelPerfSort("name");
const htmlNameAsc2=ctx.recordModelPerformanceHTML(perfHist,filters);
check("third click on Model flips back to ascending (a clean two-state toggle, not a 3-state cycle back to 'no sort')",
  /aria-label="Sort by Model, currently ascending"/.test(htmlNameAsc2));

ctx.setModelPerfSort("winPct");
const htmlWinPct=ctx.recordModelPerformanceHTML(perfHist,filters);
check("clicking a DIFFERENT header (Win %) resets to THAT column's own first-click default (descending for numeric columns), not whatever direction Model was left on",
  /aria-label="Sort by Win %, currently descending"/.test(htmlWinPct));

check("an unrecognized sort key is ignored (no crash, and the previous real sort state is untouched)",
  (()=>{
    ctx.setModelPerfSort("nonsense");
    const html=ctx.recordModelPerformanceHTML(perfHist,filters);
    return /aria-label="Sort by Win %, currently descending"/.test(html);
  })());

check("recordModelPerformanceHTML(): every header cell is a real, clickable <button data-model-perf-sort>, not a plain <span> anymore",
  (htmlDefault.match(/data-model-perf-sort="(name|ats|winPct|avgEdge|n)"/g)||[]).length===5);

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}
console.log(`\nAll ${total} checks passed.`);
