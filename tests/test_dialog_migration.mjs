// Regression coverage for the native-dialog -> PickGauge modal migration.
// The real DOM behavior is also exercised in test_e2e_ui_behaviors.py; this
// fast test protects the wiring/API and makes it impossible for a future
// alert()/confirm()/prompt() call to quietly creep back into app code.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(__dirname,"..");
const dialogPath=path.join(root,"app/js/dialogs.js");
const indexPath=path.join(root,"app/index.html");
const dialogSrc=fs.readFileSync(dialogPath,"utf8");
const indexSrc=fs.readFileSync(indexPath,"utf8");
const failures=[];let total=0;
function check(name,cond){total++;console.log(`[${cond?"PASS":"FAIL"}] ${name}`);if(!cond)failures.push(name);}

function stripComments(s){
  return s.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
}
function extractFunction(name,source){
  const asyncMarker=`async function ${name}(`,plainMarker=`function ${name}(`;
  let start=source.indexOf(asyncMarker); if(start<0) start=source.indexOf(plainMarker);
  if(start<0) throw new Error(`missing ${name}`);
  let i=source.indexOf("{",start),depth=0;
  for(;i<source.length;i++){
    if(source[i]==="{")depth++; else if(source[i]==="}"){depth--;if(depth===0){i++;break;}}
  }
  return source.slice(start,i);
}

// Deployment/wiring.
check("dialogs.js exists",fs.existsSync(dialogPath));
check("app/index.html loads dialogs.js",indexSrc.includes('<script src="/app/js/dialogs.js"></script>'));
check("dialog CSS layer is present",indexSrc.includes(".pg-dialog-layer")&&indexSrc.includes(".pg-dialog-danger"));

// No native browser dialogs remain anywhere in shipped app JS. Strip comments
// first so explanatory prose such as "replaces alert()/confirm()/prompt()"
// doesn't create a false failure.
const jsDir=path.join(root,"app/js");
for(const file of fs.readdirSync(jsDir).filter(f=>f.endsWith(".js"))){
  const clean=stripComments(fs.readFileSync(path.join(jsDir,file),"utf8"));
  check(`${file}: no native alert()/confirm()/prompt() invocation remains`,
    !/\b(?:alert|confirm|prompt)\s*\(/.test(clean));
}

// Shared helper surface exists and all user-facing wrappers route through one
// primitive instead of growing separate modal implementations.
for(const name of ["pgOpenDialog","pgOpenDialogNow","pgAlert","pgConfirm","pgPrompt","pgChoice","pgForm"]){
  check(`dialogs.js defines ${name}()`,dialogSrc.includes(`function ${name}(`));
}
check("dialog layer advertises role=dialog + aria-modal",dialogSrc.includes('setAttribute("role","dialog")')&&dialogSrc.includes('setAttribute("aria-modal","true")'));
check("Escape dismissal is implemented",dialogSrc.includes('e.key==="Escape"'));
check("Tab focus trapping is implemented",dialogSrc.includes('e.key!=="Tab"')&&dialogSrc.includes("last.focus()")&&dialogSrc.includes("first.focus()"));
check("focus is restored to the triggering control after close",dialogSrc.includes("previousFocus")&&dialogSrc.includes("previousFocus.focus()"));
check("background scrolling is locked while a modal is open",dialogSrc.includes('document.body.style.overflow="hidden"'));
check("backdrop listener is explicitly removed on close (no listener leak)",dialogSrc.includes('removeEventListener("mousedown",onBackdropMouseDown)'));
check("validation errors render inside the modal",dialogSrc.includes("pg-dialog-error")&&dialogSrc.includes("showError"));
check("dialogs are queued so multi-step confirmation flows cannot overlap",dialogSrc.includes("pgDialogQueue")&&dialogSrc.includes("pgDialogQueue.then"));

// Wrapper behavior can be tested without a DOM by stubbing the one primitive.
const wrapperCode=["pgAlert","pgConfirm","pgPrompt","pgChoice","pgForm"].map(n=>extractFunction(n,dialogSrc)).join("\n");
const ctx={
  calls:[],
  pgOpenDialog:async opts=>{
    ctx.calls.push(opts);
    return ctx.nextResult||{confirmed:true,values:{value:"abc"},choice:"p1"};
  }
};
vm.createContext(ctx);vm.runInContext(wrapperCode,ctx);
ctx.nextResult={confirmed:true,values:{value:"Week 9"},choice:null};
check("pgPrompt returns the entered value on confirm",await ctx.pgPrompt({title:"Archive",label:"Week",value:"Week 8"})==="Week 9");
check("pgPrompt translates cancel into null",(ctx.nextResult={confirmed:false,values:{value:"x"},choice:null},await ctx.pgPrompt("Rename","Old"))===null);
check("pgConfirm returns a boolean",(ctx.nextResult={confirmed:true,values:{},choice:null},await ctx.pgConfirm({message:"Sure?"}))===true);
check("pgChoice returns the selected value",(ctx.nextResult={confirmed:true,values:{},choice:"p2"},await ctx.pgChoice({choices:[{value:"p2",label:"Pool 2"}]}))==="p2");
check("pgForm returns the values object",(ctx.nextResult={confirmed:true,values:{name:"Office",pickLimit:"7"},choice:null},(await ctx.pgForm({fields:[]})).name)==="Office");
await ctx.pgAlert("Heads up");
check("pgAlert renders with no cancel button and an OK action",ctx.calls.at(-1).cancelText===null&&ctx.calls.at(-1).confirmText==="OK");

// High-value migration-specific UX improvements.
const pools=fs.readFileSync(path.join(root,"app/js/pool-contexts.js"),"utf8");
const settings=fs.readFileSync(path.join(root,"app/js/settings.js"),"utf8");
const picks=fs.readFileSync(path.join(root,"app/js/picks.js"),"utf8");
const record=fs.readFileSync(path.join(root,"app/js/record.js"),"utf8");
check("new-pool creation is one pgForm (name + pick limit), not two sequential prompts",extractFunction("createEmptyPool",pools).includes("pgForm")&&extractFunction("createEmptyPool",pools).includes('name:"pickLimit"'));
check("sheet-to-pool selection uses a choice list instead of asking for a numeric index",extractFunction("applyParsedPoolData",pools).includes("pgChoice"));
check("account deletion still has a typed DELETE backstop outside the dialog validator",extractFunction("deleteAccountData",settings).includes('typed!=="DELETE"'));
check("entry delete uses a destructive PickGauge confirmation",picks.includes('title:"Delete entry?"')&&picks.includes("danger:true"));
check("archive with zero picks uses a PickGauge alert",extractFunction("closeWeek",record).includes("pgAlert"));

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}
console.log(`\nAll ${total} checks passed.`);
