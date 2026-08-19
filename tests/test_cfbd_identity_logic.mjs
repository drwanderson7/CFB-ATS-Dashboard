import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../app/js/pdf-import.js",import.meta.url),"utf8");
const picksSrc=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
const boardSrc=fs.readFileSync(new URL("../app/js/board.js",import.meta.url),"utf8");
function extractFunction(name,source){
  const start=source.indexOf(`function ${name}(`); if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){ if(source[i]==="{") depth++; else if(source[i]==="}"){ depth--; if(depth===0){ i++; break; } } }
  return source.slice(start,i);
}
const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

const norm=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
const ctx={
  teamLogos:[
    {id:194,school:"Ohio State",abbreviation:"OSU",alternateNames:["Ohio State Buckeyes"],conference:"Big Ten",logo:"osu.png"},
    {id:130,school:"Michigan",abbreviation:"MICH",alternateNames:["Michigan Wolverines"],conference:"Big Ten",logo:"mich.png"},
  ],
  cfbdGames:[
    {id:1,season:2026,week:3,seasonType:"regular",startDate:"2026-09-19T16:00:00Z",homeId:194,homeTeam:"Ohio State",homeConference:"Big Ten",homeClassification:"fbs",awayId:999,awayTeam:"Youngstown State",awayConference:"MVFC",awayClassification:"fcs"},
    {id:2,season:2026,week:5,seasonType:"regular",startDate:"2026-10-03T16:00:00Z",homeId:194,homeTeam:"Ohio State",homeConference:"Big Ten",awayId:130,awayTeam:"Michigan",awayConference:"Big Ten"},
    {id:3,season:2026,week:14,seasonType:"postseason",startDate:"2026-12-05T17:00:00Z",homeId:194,homeTeam:"Ohio State",homeConference:"Big Ten",awayId:130,awayTeam:"Michigan",awayConference:"Big Ten"},
  ],
  currentWeekIndex:()=>5,
  teamMatchTrunc:(a,b)=>norm(a)===norm(b)||norm(a).startsWith(norm(b))||norm(b).startsWith(norm(a)),
};
vm.createContext(ctx);
for(const fn of ["cfbdTeamForName","_cfbdGameNameMatch","findCfbdGame","applyCfbdIdentityToGame","cfbdPickIdentity"]){
  vm.runInContext(extractFunction(fn,src),ctx);
}

check("team alias resolves to canonical CFBD team",ctx.cfbdTeamForName("Ohio State Buckeyes").id===194);
check("team abbreviation resolves to canonical CFBD team",ctx.cfbdTeamForName("OSU").id===194);
let g={away:"Youngstown State",home:"Ohio State",commence:"2026-09-19T16:05:00Z"};
check("FBS-vs-FCS game resolves from schedule names",ctx.findCfbdGame(g).id===1);
ctx.applyCfbdIdentityToGame(g);
check("runtime game receives CFBD game id",g.cfbdGameId===1);
check("runtime game receives both CFBD team ids including FCS opponent",g.cfbdHomeTeamId===194&&g.cfbdAwayTeamId===999);
check("runtime game receives canonical conferences",g.cfbdHomeConference==="Big Ten"&&g.cfbdAwayConference==="MVFC");
check("runtime game receives season/week metadata",g.cfbdSeason===2026&&g.cfbdWeek===3);
check("logo remains available from canonical team directory",g.homeLogo==="osu.png");

let rematch={away:"Michigan",home:"Ohio State",commence:"2026-10-03T16:30:00Z"};
check("kickoff proximity disambiguates same-season rematch",ctx.findCfbdGame(rematch).id===2);
let byId={away:"Michigan Wolverines",home:"Ohio State Buckeyes",cfbdGameId:3};
check("stored CFBD game id outranks changing team display names",ctx.findCfbdGame(byId).id===3);

const pickId=ctx.cfbdPickIdentity(g,"away");
check("pick snapshot freezes CFBD game id",pickId.cfbdGameId===1);
check("pick snapshot freezes selected team id in side-aware orientation",pickId.cfbdPickedTeamId===999);
check("pick snapshot freezes canonical home/away schools",pickId.cfbdHomeSchool==="Ohio State"&&pickId.cfbdAwaySchool==="Youngstown State");

check("new picks call the canonical identity snapshot helper",picksSrc.includes('cfbdPickIdentity(g,side)'));
check("saved-pick key migration prefers cfbdGameId",boardSrc.includes('pick&&pick.cfbdGameId!=null')&&boardSrc.includes('String(x.cfbdGameId)===String(pick.cfbdGameId)'));
check("Odds API provider id remains a separate field",picksSrc.includes('providerGameId:g.providerGameId||null'));

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
