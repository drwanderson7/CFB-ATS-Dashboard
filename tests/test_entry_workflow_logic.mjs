// Draft -> Ready -> Submitted workflow regression tests.
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/picks.js",import.meta.url),"utf8");
function extractFunction(name,source){
  const marker=`function ${name}(`,start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{")depth++; else if(source[i]==="}"){depth--;if(depth===0){i++;break;}}
  }
  return source.slice(start,i);
}
const failures=[];let total=0;
function check(name,cond){total++;console.log(`[${cond?"PASS":"FAIL"}] ${name}`);if(!cond)failures.push(name);}

const entry={id:"e1",name:"Entry 1",picks:{}};
const calls={save:0,board:0,entries:0,detail:0,count:0};
const ctx={
  pickLimit:()=>3,
  activeEntries:()=>[entry],
  save:()=>calls.save++, renderBoard:()=>calls.board++,renderEntries:()=>calls.entries++,renderPicksDetail:()=>calls.detail++,updatePickCount:()=>calls.count++,
};
vm.createContext(ctx);
vm.runInContext(extractFunction("entryWorkflowStatus",src),ctx);
vm.runInContext(extractFunction("entryIsLocked",src),ctx);
vm.runInContext(extractFunction("setEntrySubmitted",src),ctx);

check("empty entry begins Draft",ctx.entryWorkflowStatus(entry).code==="draft");
entry.picks={a:{},b:{}};
check("partially filled entry remains Draft",ctx.entryWorkflowStatus(entry).code==="draft");
check("incomplete entry cannot be marked submitted",ctx.setEntrySubmitted("e1",true)===false&&!entry.submittedAt);
entry.picks.c={};
check("entry becomes Ready automatically at the pick limit",ctx.entryWorkflowStatus(entry).code==="ready");
check("complete entry can be marked Submitted",ctx.setEntrySubmitted("e1",true)===true&&ctx.entryWorkflowStatus(entry).code==="submitted");
check("Submitted status carries an ISO timestamp",typeof entry.submittedAt==="string"&&entry.submittedAt.includes("T"));
check("Submitted entry is treated as locked",ctx.entryIsLocked(entry)===true);
check("submission change persists and rerenders all pick surfaces",calls.save===1&&calls.board===1&&calls.entries===1&&calls.detail===1&&calls.count===1);
check("Unlock removes submittedAt and returns entry to Ready",ctx.setEntrySubmitted("e1",false)===true&&!entry.submittedAt&&ctx.entryWorkflowStatus(entry).code==="ready");
check("unknown entry id is a safe no-op",ctx.setEntrySubmitted("missing",true)===false);

// Structural guards: these are the actual edit paths that must respect the
// lock, not merely a cosmetic status badge.
check("pickTeam has a submitted-entry lock guard",extractFunction("pickTeam",src).includes("entryIsLocked(ent)"));
check("movePick has a submitted-entry lock guard",extractFunction("movePick",src).includes("entryIsLocked(ent)"));
check("pick removal handler has a submitted-entry lock guard",src.includes("if(!ent||entryIsLocked(ent)) return;\n    delete ent.picks[b.dataset.rmkey]"));

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}
console.log(`\nAll ${total} checks passed.`);
