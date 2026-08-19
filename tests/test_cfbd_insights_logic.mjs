import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/cfbd-insights.js",import.meta.url),"utf8");
const html=fs.readFileSync(new URL("../app/index.html",import.meta.url),"utf8");
const board=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8");
const picks=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
const store=new Map();
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const ctx={
 console,
 localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 setInterval:()=>123,clearInterval:()=>{},
 document:{visibilityState:"visible",getElementById:()=>null},
 apiFetch:async()=>({ok:false}),
 teamLogos:[{id:333,school:"Alabama"},{id:2633,school:"Tennessee"}],
 cfbdGames:[],logosMeta:{season:2026},
 teamMatch:(a,b)=>norm(a)===norm(b),
 cfbdTeamForName:name=>null,
 recordNumber:v=>(v==null||v===""||!Number.isFinite(Number(v)))?null:Number(v),
 round1:v=>Math.round(v*10)/10,
 fmt:v=>{const n=Number(v);return n>0?`+${n}`:`${n}`;},
 esc:s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"),
 kickStr:()=>"Sat 11:00 AM",
 renderPicksDetail:()=>{},renderSnapshot:()=>{},renderRecord:()=>{},
};
vm.createContext(ctx);vm.runInContext(src,ctx);
vm.runInContext(`cfbdScoreboard=[{id:401,status:"in_progress",period:3,clock:"8:24",startDate:"2026-09-05T16:00:00Z",homeTeam:{id:333,name:"Alabama",points:17},awayTeam:{id:2633,name:"Tennessee",points:13}}]`,ctx);
const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}
const pick={cfbdGameId:401,cfbdPickedTeamId:333,team:"Alabama",side:"home",line:-6.5,matchup:"Tennessee @ Alabama"};
const sg=ctx.cfbdScoreboardGameFor(pick);
check("scoreboard match prefers canonical CFBD game id",sg&&sg.id===401);
const status=ctx.cfbdPickScoreStatus(pick,sg);
check("live ATS status computes current cover margin from picked side",status.coverMargin===-2.5&&status.result===null);
const liveHtml=ctx.cfbdPickStatusHTML(pick,null);
check("My Picks status reports LIVE and ATS position",liveHtml.includes("LIVE")&&liveHtml.includes("Behind ATS by 2.5"));
vm.runInContext(`cfbdScoreboard[0].status="completed";cfbdScoreboard[0].homeTeam.points=31;cfbdScoreboard[0].awayTeam.points=20`,ctx);
const finalStatus=ctx.cfbdPickScoreStatus(pick,ctx.cfbdScoreboardGameFor(pick));
check("completed score produces ATS W/L/P",finalStatus.result==="W"&&finalStatus.coverMargin===4.5);
vm.runInContext(`cfbdRatings=[
 {year:2026,team:"Alabama",core:{overall:18,throughWeek:4},sp:{rating:20.1,ranking:3},fpi:{fpi:19.3},elo:{elo:1912},srs:{rating:17.4,ranking:4}},
 {year:2026,team:"Tennessee",core:{overall:12,throughWeek:4},sp:{rating:14.2,ranking:12},fpi:{fpi:13.1},elo:{elo:1810},srs:{rating:11.8,ranking:15}}
]`,ctx);
const ratingsHtml=ctx.cfbdRatingsPanelHTML({away:"Tennessee",home:"Alabama",cfbdAwayTeamId:2633,cfbdHomeTeamId:333});
check("rating panel surfaces all five CFBD rating systems",["CORE","SP+","FPI","Elo","SRS"].every(x=>ratingsHtml.includes(x)));
check("rating panel explicitly says ratings do not affect Model #",ratingsHtml.includes("not part of Model #"));
check("rating panel includes both matchup teams",ratingsHtml.includes("Tennessee")&&ratingsHtml.includes("Alabama"));
check("Snapshot detail renderer calls CFBD ratings panel",board.includes('cfbdRatingsPanelHTML(g)'));

// --- Matchup Intelligence v1 -------------------------------------------
// cfbdMatchupAdvantage() is the pure comparison function -- tested
// directly, separate from its own HTML renderer, same split the rest of
// this project uses for model/logic vs HTML-string builders.
const bamaOff={offense:{ppa:0.38,successRate:0.50,explosiveness:1.30,rushingPlays:{successRate:0.55},passingPlays:{successRate:0.45}}};
const volsDef={defense:{ppa:0.05,successRate:0.35,explosiveness:1.05,rushingPlays:{successRate:0.32},passingPlays:{successRate:0.37}}};
const adv=ctx.cfbdMatchupAdvantage(bamaOff,volsDef);
check("cfbdMatchupAdvantage returns all 5 tracked metrics when both sides have full data",adv.length===5);
const successRow=adv.find(r=>r.key==="successRate");
check("cfbdMatchupAdvantage: a clearly higher offense successRate than what the defense allows favors the OFFENSE",
  successRow&&successRow.offVal===0.50&&successRow.defVal===0.35&&successRow.favors==="offense");
const rushRow=adv.find(r=>r.key==="rushSuccessRate");
check("cfbdMatchupAdvantage: rushing success pulled from the nested rushingPlays.successRate split, not a top-level field",
  rushRow&&rushRow.offVal===0.55&&rushRow.defVal===0.32);

// A near-equal matchup (tiny real difference) should read as "even," not
// falsely favor either side -- this is the noise-threshold behavior.
const evenOff={offense:{ppa:0.20,successRate:0.40,explosiveness:1.10}};
const evenDef={defense:{ppa:0.19,successRate:0.395,explosiveness:1.09}};
const evenAdv=ctx.cfbdMatchupAdvantage(evenOff,evenDef);
check("cfbdMatchupAdvantage: a difference within the noise threshold reads as 'even', not a false advantage",
  evenAdv.find(r=>r.key==="successRate").favors==="even");

// Missing offense/defense data must degrade to an empty comparison, not throw.
check("cfbdMatchupAdvantage returns [] when the offense side has no data at all",
  ctx.cfbdMatchupAdvantage(null,volsDef).length===0);
check("cfbdMatchupAdvantage returns [] when the defense side has no data at all",
  ctx.cfbdMatchupAdvantage(bamaOff,null).length===0);

// REAL BUG, found and fixed after this shipped: a genuinely empty (but
// successfully fetched) CFBD result showed NOTHING at all, with zero
// explanation -- which is exactly what caused real production confusion
// (CFBD legitimately returns 200 with body [] in the preseason, before any
// games have been played, since /stats/season/advanced computes CUMULATIVE
// season stats from games actually played). Panel must now distinguish
// "never fetched yet" (stay silent, same as before) from "fetched
// successfully, genuinely nothing there" (say so).
check("matchup panel: before any fetch has ever completed (cfbdAdvancedMeta still null), stays silent -- same as ratings before their own first load",
  vm.runInContext("cfbdAdvanced.length",ctx)===0 && vm.runInContext("cfbdAdvancedMeta",ctx)===null && ctx.cfbdMatchupPanelHTML({away:"A",home:"B"})==="");
vm.runInContext(`cfbdAdvancedMeta={year:2026,fetchedAt:"2026-08-19T12:00:00Z",source:"live"}`,ctx);
const emptySeasonHtml=ctx.cfbdMatchupPanelHTML({away:"A",home:"B"});
check("matchup panel: AFTER a successful fetch that genuinely returned nothing (cfbdAdvancedMeta set, cfbdAdvanced still []), explains why instead of silently showing nothing",
  emptySeasonHtml!=="" && emptySeasonHtml.includes("Not available yet this season"));
check("matchup panel: the empty-season explanation still carries the Matchup Intelligence label and context-only note, same as the populated panel",
  emptySeasonHtml.includes("Matchup Intelligence") && emptySeasonHtml.includes("not part of Model #"));
vm.runInContext(`cfbdAdvancedMeta=null`,ctx); // reset for the populated-data tests below

vm.runInContext(`cfbdAdvanced=[
 {team:"Alabama",offense:{ppa:0.38,successRate:0.50,explosiveness:1.30,rushingPlays:{successRate:0.55},passingPlays:{successRate:0.45}},
  defense:{ppa:0.05,successRate:0.33,explosiveness:1.0,rushingPlays:{successRate:0.30},passingPlays:{successRate:0.36},havoc:{total:0.22}}},
 {team:"Tennessee",offense:{ppa:0.22,successRate:0.41,explosiveness:1.05,rushingPlays:{successRate:0.44},passingPlays:{successRate:0.38}},
  defense:{ppa:0.05,successRate:0.35,explosiveness:1.05,rushingPlays:{successRate:0.32},passingPlays:{successRate:0.37},havoc:{total:0.14}}}
]`,ctx);
const matchupHtml=ctx.cfbdMatchupPanelHTML({away:"Tennessee",home:"Alabama",cfbdAwayTeamId:2633,cfbdHomeTeamId:333});
check("matchup panel is labeled Matchup Intelligence and marked context-only, same convention as the ratings panel",
  matchupHtml.includes("Matchup Intelligence")&&matchupHtml.includes("not part of Model #"));
check("matchup panel shows BOTH offense-vs-defense directions (away off vs home def, AND home off vs away def)",
  matchupHtml.includes("Tennessee offense")&&matchupHtml.includes("Alabama defense")
  &&matchupHtml.includes("Alabama offense")&&matchupHtml.includes("Tennessee defense"));
check("matchup panel includes the standalone havoc comparison row",matchupHtml.includes("Havoc rate"));
check("matchup panel highlights the stronger side's number, same '.stronger' visual convention as the ratings panel",
  matchupHtml.includes("stronger"));
check("matchup panel returns empty string when there's no advanced-stats data at all for either team",
  ctx.cfbdMatchupPanelHTML({away:"Nowhere State",home:"Neverland U"})==="");
check("Snapshot detail renderer calls the matchup panel",board.includes('cfbdMatchupPanelHTML(g)'));

check("My Picks renderer calls CFBD live status",picks.includes('cfbdPickStatusHTML(p,live)'));
check("CFBD insights script is shipped in app HTML",html.includes('/app/js/cfbd-insights.js'));
if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
