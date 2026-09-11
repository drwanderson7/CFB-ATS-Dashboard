// Regression for Sept. 11, 2026 production crash on /app startup when the
// saved board sort was CLV inside a pool. sortValue("clv") computed
// `pickedSide` but accidentally called clvOf(g, e.side), where `e` did not
// exist. Because init() sorts immediately, that ReferenceError took down the
// whole game page before render.
import fs from "node:fs";

const board = fs.readFileSync(new URL("../app/js/board.js", import.meta.url), "utf8");
const failures=[];
let total=0;
function check(name, cond){
  total++;
  console.log(`[${cond?"PASS":"FAIL"}] ${name}`);
  if(!cond) failures.push(name);
}

check("CLV sort no longer references nonexistent e.side", !/clvOf\(g\s*,\s*e\.side\)/.test(board));
check("CLV sort passes the actual pickedSide to clvOf", /const c=clvOf\(g,pickedSide\)/.test(board));
check("CLV sort tolerates a pool with no active entry/picks", /const pick=ent&&ent\.picks\?ent\.picks\[g\.key\]:null/.test(board));

// Execute only the two sort helpers with lightweight stubs. This recreates the
// production path closely enough to catch a ReferenceError in sortValue while
// avoiding board.js's DOM-heavy module initialization.
const start=board.indexOf("function sortValue(key,g){");
const end=board.indexOf("// setSort:", start);
check("sort helper source can be isolated for execution", start>=0 && end>start);
if(start>=0 && end>start){
  const helperSource=board.slice(start,end);
  const games=[
    {key:"a",home:"A",lockedLine:-3,liveVegas:-5},
    {key:"b",home:"B",lockedLine:-7,liveVegas:-6},
  ];
  const seenSides=[];
  const run=new Function(
    "currentPool","activeEntry","clvOf","games",
    `${helperSource}\nsortGamesBy("clv","desc"); return games;`
  );
  let threw=false;
  let sorted=null;
  try{
    sorted=run(
      ()=>({id:"pool-1"}),
      ()=>({picks:{a:{side:"home"},b:{side:"away"}}}),
      (g,side)=>{ seenSides.push([g.key,side]); const raw=g.liveVegas-g.lockedLine; const forPick=side==="home"?-raw:side==="away"?raw:null; return {raw,forPick}; },
      games
    );
  }catch(err){
    threw=true;
    console.error(err);
  }
  check("sorting by CLV inside a pool does not throw", !threw);
  check("CLV sort evaluates each game's saved pick side", seenSides.some(([k,s])=>k==="a"&&s==="home") && seenSides.some(([k,s])=>k==="b"&&s==="away"));
  check("CLV sort returns a sorted games array", Array.isArray(sorted) && sorted.length===2);

  // Also cover a newly-created/empty pool where no entry exists yet.
  let emptyThrew=false;
  try{
    run(
      ()=>({id:"pool-2"}),
      ()=>undefined,
      (g,side)=>({raw:g.liveVegas-g.lockedLine,forPick:side?0:null}),
      [{key:"c",home:"C",lockedLine:-1,liveVegas:-2}]
    );
  }catch(err){ emptyThrew=true; console.error(err); }
  check("CLV sort does not crash when a pool has no active entry yet", !emptyThrew);
}

console.log(failures.length?`\n${failures.length} of ${total} checks FAILED:`:`\nAll ${total} checks passed.`);
for(const f of failures) console.log(" -",f);
if(failures.length) process.exit(1);
