import fs from "node:fs";
import vm from "node:vm";

const oddsSrc = fs.readFileSync(new URL("../app/js/odds.js", import.meta.url), "utf8");
const predSrc = fs.readFileSync(new URL("../app/js/prediction-tracker.js", import.meta.url), "utf8");

function extractFunction(name, source) {
  const startMarker = `function ${name}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) throw new Error(`Could not find function ${name}()`);
  let i = source.indexOf("{", start), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") { depth--; if (depth === 0) { i++; break; } }
  }
  return source.slice(start, i);
}

const failures=[]; let total=0;
function check(name, cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

{
  const ctx={state:{lastGames:[{key:"old"}],lastRefresh:"old",reqLeft:"99",booksSeen:["oldbook"],sharedUpdatedAt:"server-clock"}};
  vm.createContext(ctx);
  vm.runInContext(extractFunction("mergePreKickLinesLocally", oddsSrc),ctx);
  vm.runInContext(extractFunction("adoptOddsResponseLocally", oddsSrc),ctx);
  const fresh={games:[{key:"fresh"}],lastRefresh:"2026-08-18T21:00:00Z",reqLeft:"88",booksSeen:["newbook","oldbook"],
    preKickLines:{g1:{books:{draftkings:-7},bookObservedAt:{draftkings:"2026-08-18T20:59:00Z"},observedAt:"2026-08-18T20:59:00Z"}}};
  check("odds fallback helper accepts a valid fresh response",ctx.adoptOddsResponseLocally(fresh)===true);
  check("odds fallback helper replaces stale games with the successful endpoint response",ctx.state.lastGames[0].key==="fresh");
  check("odds fallback helper carries refresh metadata and requests remaining",ctx.state.lastRefresh===fresh.lastRefresh&&ctx.state.reqLeft==="88");
  check("odds fallback helper unions bookmaker names without duplicates",ctx.state.booksSeen.join(",")==="newbook,oldbook");
  check("odds fallback helper does NOT fabricate/advance sharedUpdatedAt",ctx.state.sharedUpdatedAt==="server-clock");
  check("odds fallback helper also retains the current refresh's pre-kick closing-line delta",
    ctx.state.preKickLines.g1.books.draftkings===-7);
}

{
  const ctx={state:{predictions:[{home:"Old"}],predMeta:{fetchedAt:"old",count:1},sharedUpdatedAt:"server-clock"}};
  vm.createContext(ctx);
  vm.runInContext(extractFunction("adoptPredictionsResponseLocally", predSrc),ctx);
  const fresh={games:[{home:"New1"},{home:"New2"}],count:2,fetchedAt:"2026-08-18T21:00:00Z"};
  check("prediction fallback helper accepts a valid fresh response",ctx.adoptPredictionsResponseLocally(fresh)===true);
  check("prediction fallback helper replaces stale predictions",ctx.state.predictions.length===2&&ctx.state.predictions[0].home==="New1");
  check("prediction fallback helper carries the endpoint's fetchedAt/count",ctx.state.predMeta.fetchedAt===fresh.fetchedAt&&ctx.state.predMeta.count===2);
  check("prediction fallback helper does NOT fabricate/advance sharedUpdatedAt",ctx.state.sharedUpdatedAt==="server-clock");
}

check("refreshLines explicitly falls back when sharedPersisted is false",oddsSrc.includes('data.sharedPersisted===false'));
check("fetchPredictions explicitly falls back when sharedPersisted is false",predSrc.includes('data.sharedPersisted===false'));

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
