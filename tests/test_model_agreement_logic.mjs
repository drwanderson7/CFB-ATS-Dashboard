// Regression tests for transparent model-agreement counts.
import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../app/js/model.js",import.meta.url),"utf8");
function extractFunction(name, source){
  const marker=`function ${name}(`, start=source.indexOf(marker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{") depth++;
    else if(source[i]==="}"){ depth--; if(depth===0){i++;break;} }
  }
  return source.slice(start,i);
}
const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

const ctx={
  state:{enabledSystems:["bp","comp","fpi","sag"]},
  inputsFor:()=>[-7,1],
  predsFor:()=>({fpi:-4,sag:-3}),
  enabledSystemsOrdered:()=>["fpi","sag"],
  weightOf:(code)=>code==="comp"?0:1,
  myNumber:()=>-5,
};
vm.createContext(ctx);
vm.runInContext(extractFunction("modelAgreement",src),ctx);
const g={key:"a@b",vegas:-3,home:"B",away:"A"};
const home=ctx.modelAgreement(g,"home");
check("agreement counts only enabled inputs with positive weight",home.total===3);
check("agreement counts two models on the home side",home.agree===2);
check("agreement keeps exact market ties in denominator as neutral",home.neutral===1);
check("zero-weight Comp is excluded rather than counted as opposition",home.oppose===0);
check("agreement percentage uses all loaded contributing models",Math.abs(home.pct-2/3)<1e-9);
const away=ctx.modelAgreement(g,"away");
check("same inputs can be viewed from opposite side without changing source set",away.total===3&&away.agree===0&&away.oppose===2);
const inferred=ctx.modelAgreement(g,null);
check("when side omitted, agreement follows current Model # lean",inferred.side==="home"&&inferred.agree===2);
check("agreement is unavailable without a market line",ctx.modelAgreement({key:"a@b",vegas:null},"home")===null);

if(failures.length){ console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures); process.exit(1); }
console.log(`\nAll ${total} checks passed.`);
