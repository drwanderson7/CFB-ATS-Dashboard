// Regression for Splash/CFBD current name "Sam Houston" vs Odds API provider
// name "Sam Houston State Bearkats". These must be one school identity.
import fs from 'node:fs';
import vm from 'node:vm';
const pdfSrc=fs.readFileSync(new URL('../app/js/pdf-import.js',import.meta.url),'utf8');
const aliasSrc=fs.readFileSync(new URL('../app/data/team-alias.js',import.meta.url),'utf8');
function extractFunction(name,source){
  const marker=`function ${name}(`; const start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf('{',start),d=0;
  for(;i<source.length;i++){ if(source[i]==='{')d++; else if(source[i]==='}'){d--;if(!d){i++;break;}} }
  return source.slice(start,i);
}
function extractConst(name,source){ const s=source.indexOf(`const ${name}=`),e=source.indexOf(';',s); return source.slice(s,e+1); }
const ctx={}; vm.createContext(ctx); vm.runInContext(aliasSrc,ctx); vm.runInContext(extractConst('SIGNIFICANT_TOKENS',pdfSrc),ctx);
for(const f of ['teamTokens','aliasOf','prefixOk','teamMatch']) vm.runInContext(extractFunction(f,pdfSrc),ctx);
let fail=0; const check=(n,c)=>{console.log(`[${c?'PASS':'FAIL'}] ${n}`);if(!c)fail++;};
check('Sam Houston matches Sam Houston State Bearkats',ctx.teamMatch('Sam Houston','Sam Houston State Bearkats'));
check('Sam Houston still does not match Houston',!ctx.teamMatch('Sam Houston','Houston Cougars'));
check('Sam Houston State still does not match Houston',!ctx.teamMatch('Sam Houston State','Houston'));
if(fail) process.exit(1);
console.log('Sam Houston live-odds alias regression passed.');
