import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/odds.js",import.meta.url),"utf8");
function extractFunction(name,source){const marker=`function ${name}(`,start=source.indexOf(marker);if(start<0)throw new Error(`missing ${name}`);let i=source.indexOf("{",start),d=0;for(;i<source.length;i++){if(source[i]==="{")d++;else if(source[i]==="}"){d--;if(d===0){i++;break;}}}return source.slice(start,i);}
const ctx={SHARED_FRESH_MINUTES:30};vm.createContext(ctx);vm.runInContext(extractFunction("oddsFreshMinutes",src),ctx);
const now=Date.parse("2026-09-05T12:00:00Z");
const g=m=>({commence:new Date(now+m*60000).toISOString()});
const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}
check("client >24h = 30m",ctx.oddsFreshMinutes([g(1500)],now)===30);
check("client <=24h = 15m",ctx.oddsFreshMinutes([g(1200)],now)===15);
check("client <=6h = 10m",ctx.oddsFreshMinutes([g(300)],now)===10);
check("client <=1h = 5m",ctx.oddsFreshMinutes([g(45)],now)===5);
check("client nearest future kickoff wins",ctx.oddsFreshMinutes([g(2000),g(50)],now)===5);
check("client ignores already-started games",ctx.oddsFreshMinutes([g(-1),g(700)],now)===15);
if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
