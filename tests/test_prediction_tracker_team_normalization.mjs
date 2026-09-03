// Regression for real Sept 2, 2026 PredictionTracker team-name dialects.
// These rows were live on the source while PickGauge showed "Model # incomplete"
// because applyPredictions() could not match the tracker row to the board game.
import fs from "node:fs";
import vm from "node:vm";

const mainSrc=fs.readFileSync(new URL("../app/js/main.js",import.meta.url),"utf8");
const pdfSrc=fs.readFileSync(new URL("../app/js/pdf-import.js",import.meta.url),"utf8");
const aliasSrc=fs.readFileSync(new URL("../app/data/team-alias.js",import.meta.url),"utf8");

function extractFunction(name,source){
  const marker=`function ${name}(`;
  const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){ i++; break; } }
  }
  return source.slice(start,i);
}
function extractConst(name,source){
  const marker=`const ${name}=`;
  const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  const semi=source.indexOf(";",start);
  return source.slice(start,semi+1);
}

const ctx={};
vm.createContext(ctx);
vm.runInContext(extractConst("TEAM_ALIAS",aliasSrc),ctx);
vm.runInContext(extractConst("SIGNIFICANT_TOKENS",pdfSrc),ctx);
vm.runInContext(extractFunction("teamTokens",pdfSrc),ctx);
vm.runInContext(extractFunction("aliasOf",pdfSrc),ctx);
vm.runInContext(extractFunction("prefixOk",pdfSrc),ctx);
vm.runInContext(extractFunction("teamMatch",pdfSrc),ctx);
vm.runInContext(extractConst("TRACKER_TEAM_ALIASES",mainSrc),ctx);
vm.runInContext(extractFunction("normTracker",mainSrc),ctx);

const cases=[
  ["Northern Ill.","Northern Illinois"],
  ["Kent","Kent State"],
  ["West Va.","West Virginia"],
  ["Florida Intl.","Florida International"],
  ["Troy St.","Troy"],
  ["Sam Houston St.","Sam Houston"],
  ["Eastern Mich.","Eastern Michigan"],
  ["Washington St.","Washington State"],
];
let failures=0;
for(const [tracker,board] of cases){
  const normalized=ctx.normTracker(tracker);
  const ok=ctx.teamMatch(normalized,board);
  console.log(`[${ok?'PASS':'FAIL'}] ${tracker} -> ${normalized} matches ${board}`);
  if(!ok) failures++;
}

// Guard against the dangerous collision that originally drove the global
// matcher to treat International/Intl as significant: Florida Intl must never
// match plain Florida.
const fi=ctx.normTracker("Florida Intl.");
const collision=!ctx.teamMatch(fi,"Florida");
console.log(`[${collision?'PASS':'FAIL'}] Florida Intl. does not collapse into Florida`);
if(!collision) failures++;

// Keep State-token collision protection globally, except for the explicit
// canonical Sam Houston / Sam Houston State identity required by live odds.
// Troy State remains source-specific, and Sam Houston must never collapse
// into the unrelated Houston Cougars identity.
const globalSafety=
  !ctx.teamMatch("Troy State","Troy") &&
  ctx.teamMatch("Sam Houston State Bearkats","Sam Houston") &&
  !ctx.teamMatch("Sam Houston","Houston Cougars") &&
  !ctx.teamMatch("Miami","Miami (OH)");
console.log(`[${globalSafety?'PASS':'FAIL'}] global matcher permits canonical Sam Houston identity without unsafe collisions`);
if(!globalSafety) failures++;

if(failures){
  console.error(`${failures} normalization check(s) failed`);
  process.exit(1);
}
console.log(`All ${cases.length+2} PredictionTracker normalization checks passed.`);
