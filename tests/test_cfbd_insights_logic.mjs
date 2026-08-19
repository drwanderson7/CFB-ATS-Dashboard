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
check("My Picks renderer calls CFBD live status",picks.includes('cfbdPickStatusHTML(p,live)'));
check("CFBD insights script is shipped in app HTML",html.includes('/app/js/cfbd-insights.js'));
if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
