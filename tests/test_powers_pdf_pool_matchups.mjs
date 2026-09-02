// Regression for Powers BP/Comp overlays on pool-context games whose imported
// team labels may literally be ellipsis-truncated. The Powers parser has the
// numbers, but pre-Sept-2 applyPdfData() used the strict global team matcher and
// could not attach them when a pool row said e.g. "Western Michi…".
import fs from "node:fs";
import vm from "node:vm";

const pdfSrc=fs.readFileSync(new URL("../app/js/pdf-import.js",import.meta.url),"utf8");
const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const aliasSrc=fs.readFileSync(new URL("../app/data/team-alias.js",import.meta.url),"utf8");

function extractFunction(name,source){
  const marker=`function ${name}(`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){ i++; break; } }
  }
  return source.slice(start,i);
}
function extractConst(name,source){
  const marker=`const ${name}=`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  const semi=source.indexOf(";",start); return source.slice(start,semi+1);
}

const board=[
  {key:"ulm@msst",away:"Louisiana-Mon…",home:"Mississippi St…",vegas:-28.5},
  {key:"wmu@mich",away:"Western Michi…",home:"Michigan",vegas:-27.5},
  {key:"sjsu@emu",away:"San Jose State",home:"Eastern Michig…",vegas:-3},
  {key:"txst@tex",away:"Texas State",home:"Texas",vegas:-29.5},
  {key:"cmu@unm",away:"Central Michig…",home:"New Mexico",vegas:-10},
  {key:"wku@nev",away:"Western Kentu…",home:"Nevada",vegas:1.5},
  {key:"wsu@uw",away:"Washington St…",home:"Washington",vegas:-23.5},
  {key:"fiu@usf",away:"Florida Interna…",home:"South Florida",vegas:-14},
  {key:"shsu@troy",away:"Sam Houston",home:"Troy",vegas:-16.5},
];
const pdfGames=[
  {away:"UL-Monroe",home:"Mississippi State",bp:-29,comp:-28.5,homeVegas:-28.5},
  {away:"Western Michigan",home:"Michigan",bp:-27,comp:-27.3,homeVegas:-27.5},
  {away:"San Jose State",home:"Eastern Michigan",bp:-2,comp:-2.7,homeVegas:-3},
  {away:"Texas State",home:"Texas",bp:-30,comp:-30.1,homeVegas:-29.5},
  {away:"Central Michigan",home:"New Mexico",bp:-10,comp:-12.9,homeVegas:-10},
  {away:"Western Kentucky",home:"Nevada",bp:1,comp:1.6,homeVegas:1.5},
  {away:"Washington State",home:"Washington",bp:-22,comp:-21.8,homeVegas:-23.5},
  {away:"FIU",home:"South Florida",bp:-15,comp:-14.6,homeVegas:-14},
  {away:"Sam Houston State",home:"Troy",bp:-15,comp:-14.6,homeVegas:-16.5},
];

const ctx={console,games:board,state:{inputs:{},pdfGames,lastGames:board},demoInputs:{},isDemo:false};
vm.createContext(ctx);
vm.runInContext(aliasSrc,ctx);
vm.runInContext(extractConst("SIGNIFICANT_TOKENS",pdfSrc),ctx);
for(const n of ["norm","mkey","stripEllipsis","resolveTrunc","teamMatchTrunc","inputsFor"]){
  vm.runInContext(extractFunction(n,mainSrc),ctx);
}
for(const n of ["teamTokens","aliasOf","prefixOk","teamMatch"]){
  vm.runInContext(extractFunction(n,pdfSrc),ctx);
}
// teamMatchTrunc was defined before teamMatch in this test context; function
// lookup is runtime/global, so that mirrors the browser's split-script behavior.
vm.runInContext(extractConst("POWERS_TEAM_ALIASES",pdfSrc),ctx);
for(const n of ["normPowersTeam","powersTeamMatch","findBoardGame","findBoardGameByRotation","applyPdfData"]){
  vm.runInContext(extractFunction(n,pdfSrc),ctx);
}

const filled=ctx.applyPdfData();
let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
check("all screenshot-like Powers rows attach in a pool context",filled===pdfGames.length);
for(let i=0;i<board.length;i++){
  const key=board[i].key, src=pdfGames[i];
  check(`${src.away} @ ${src.home}: BP attached`,ctx.state.inputs[key]?.[0]===src.bp);
  check(`${src.away} @ ${src.home}: Comp attached`,ctx.state.inputs[key]?.[1]===src.comp);
}
check("FIU source alias does not match plain Florida",!ctx.powersTeamMatch("FIU","Florida"));

if(failures){ console.error(`${failures} Powers pool matching check(s) failed`); process.exit(1); }
console.log(`All ${2+board.length*2} Powers pool matching checks passed.`);
