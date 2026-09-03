// Regression for Sept 2 production failures where PredictionTracker abbreviation
// expansion rewrote prefixes inside legitimate full school names.
import fs from 'node:fs';
import vm from 'node:vm';

const mainSrc=fs.readFileSync(new URL('../app/js/main.js',import.meta.url),'utf8');
const pdfSrc=fs.readFileSync(new URL('../app/js/pdf-import.js',import.meta.url),'utf8');
const aliasSrc=fs.readFileSync(new URL('../app/data/team-alias.js',import.meta.url),'utf8');

function extractFunction(name,source){
  const marker=`function ${name}(`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf('{',start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==='{') depth++;
    else if(source[i]==='}'){ depth--; if(depth===0){ i++; break; } }
  }
  return source.slice(start,i);
}
function extractConst(name,source){
  const marker=`const ${name}=`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  const semi=source.indexOf(';',start); return source.slice(start,semi+1);
}
const ctx={console,round1:n=>Math.round(Number(n)*10)/10,mkey:(a,h)=>`${a}@${h}`};
vm.createContext(ctx);
vm.runInContext(aliasSrc,ctx);
vm.runInContext(extractConst('SIGNIFICANT_TOKENS',pdfSrc),ctx);
for(const f of ['teamTokens','aliasOf','prefixOk','teamMatch']) vm.runInContext(extractFunction(f,pdfSrc),ctx);
vm.runInContext(extractConst('TRACKER_TEAM_ALIASES',mainSrc),ctx);
vm.runInContext(extractFunction('normTracker',mainSrc),ctx);
ctx.teamMatchTrunc=(a,b)=>ctx.teamMatch(a,b);
ctx.applyCfbdDerivedPredictions=()=>{};
ctx.isDemo=false; ctx.demoInputs={};
ctx.games=[
  {key:'uab@ill',away:'UAB',home:'Illinois'},
  {key:'wmu@mich',away:'Western Michigan',home:'Michigan'},
  {key:'mia@stan',away:'Miami (FL)',home:'Stanford'},
  {key:'tol@msu',away:'Toledo',home:'Michigan State'},
];
const systems={teamrank:1,sagpred:2,wayward:3,sag:4};
ctx.state={predictions:[
  {road:'UAB',home:'Illinois',systems:{...systems}},
  {road:'Western Mich.',home:'Michigan',systems:{...systems}},
  {road:'Miami (Fla.)',home:'Stanford',systems:{...systems}},
  {road:'Toledo',home:'Michigan St.',systems:{...systems}},
]};
vm.runInContext('let predByKey={}; let lastPredUnmatched=[]; let lastBoardPredMissing=[];',ctx);
vm.runInContext(extractFunction('_finishApplyPredictions',pdfSrc),ctx);
vm.runInContext(extractFunction('applyPredictions',pdfSrc),ctx);

let failures=0;
function check(name,cond){ console.log(`[${cond?'PASS':'FAIL'}] ${name}`); if(!cond) failures++; }
for(const name of ['Illinois','Michigan','Stanford','Penn State','Vanderbilt']){
  check(`full name is not corrupted: ${name}`,ctx.normTracker(name)===name);
}
const expands={
  'Western Mich.':'Western Michigan',
  'Michigan St.':'Michigan State',
  'West Va.':'West Virginia',
  'Florida Intl.':'Florida International',
  'Ohio St.':'Ohio State',
};
for(const [raw,want] of Object.entries(expands)) check(`abbreviation expands only as a token: ${raw}`,ctx.normTracker(raw)===want);
const matched=ctx.applyPredictions();
check('all four reported PredictionTracker matchups attach',matched===4);
const predByKey=vm.runInContext('predByKey',ctx);
for(const g of ctx.games){
  check(`${g.away} @ ${g.home} gets all four PickGauge tracker feeds`,['teamrank','sagpred','wayward','sag'].every(k=>Number.isFinite(predByKey[g.key]?.[k])));
}
if(failures) process.exit(1);
console.log('PredictionTracker token-normalization regression passed.');
