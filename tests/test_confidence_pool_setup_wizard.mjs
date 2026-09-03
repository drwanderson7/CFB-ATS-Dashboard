import fs from 'fs';
import vm from 'vm';

let failures=0, checks=0;
function check(name, cond){ checks++; if(cond) console.log(`[PASS] ${name}`); else { failures++; console.error(`[FAIL] ${name}`); } }

const root=new URL('../', import.meta.url);
const logic=fs.readFileSync(new URL('../app/js/confidence.js', import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../app/js/confidence-integration.js', import.meta.url),'utf8');
const main=fs.readFileSync(new URL('../app/js/main.js', import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css', import.meta.url),'utf8');

let id=0;
const ctx={
  console,
  state:{confidencePools:[],confidenceActivePoolId:null,lastGames:[]},
  uid:()=>`id${++id}`,
  save:()=>{},
  esc:s=>String(s??''),
  mkey:(a,h)=>`${a}@@${h}`,
  localStorage:{getItem:()=>null,setItem:()=>{}},
  document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null},
  pgAlert:async()=>{},pgConfirm:async()=>true,pgPrompt:async()=>null,
  kickStr:s=>s,
  setTimeout,clearTimeout,Date,Number,Math,Array,Set,Map,Object,String,JSON,
};
vm.createContext(ctx);
vm.runInContext(logic,ctx);
vm.runInContext(ui,ctx);

check('wizard copy contains all six requested setup questions',
  ui.includes('What is the name of your pool?') &&
  ui.includes('How are picks scored?') &&
  ui.includes('How many games do you pick each week?') &&
  ui.includes('Which picks receive confidence points?') &&
  ui.includes('Does the pool drop any low-scoring weeks?') &&
  ui.includes('How many entries do you have in this pool?'));
check('wizard has a review-before-create step', ui.includes('Ready to create') && ui.includes('Create confidence pool →'));
check('wizard is transient until final creation', ui.includes('nothing is saved until Review -> Create pool'));
check('mobile/desktop wizard styling exists', css.includes('.pg-wizard-card') && css.includes('.pg-wizard-choices') && css.includes('@media(max-width:700px)'));
check('normalizeState backfills explicit confidence rule schema',
  main.includes('p.scoring=') && main.includes('p.weeklyPickMode=') && main.includes('p.confidenceMode='));

const pool=ctx.cpCreatePoolFromDraft({
  name:"Grundy's Gang",
  scoring:'ats',
  weeklyPickMode:'all',
  confidenceMode:'top',
  confidenceCount:5,
  dropLowestWeeks:2,
  entryCount:3,
});
check('draft creates the named pool', pool.name==="Grundy's Gang");
check('draft saves ATS scoring explicitly', pool.scoring==='ats');
check('draft saves every-game weekly mode explicitly', pool.weeklyPickMode==='all' && pool.weeklyPickCount===null);
check('draft saves Top-X confidence independently of weekly picks', pool.confidenceMode==='top' && pool.confidenceCount===5);
check('draft saves dropped weeks', pool.dropLowestWeeks===2);
check('entry count creates numbered entries automatically', pool.entries.length===3 && pool.entries[0].name==='Entry 1' && pool.entries[2].name==='Entry 3');

pool.games=[1,2,3,4,5,6].map((n)=>({key:`g${n}`,away:`A${n}`,home:`H${n}`,line:-3}));
check('every-game + Top 5 requires all six sides but only five confidence values',
  ctx.cpRequiredPickCount(pool)===6 && ctx.cpRequiredRankedCount(pool)===5 && ctx.cpMaxPoints(pool)===5);
const entry={picks:{}};
for(let i=1;i<=6;i++) entry.picks[`g${i}`]={team:'home',points:i<=5?i:null};
const validTop=ctx.cpValidatePicks(pool,entry,true);
check('Top-X allows submitted unranked picks worth zero while requiring exact 1..X ranking', validTop.valid && validTop.pickedCount===6 && validTop.rankedCount===5);

const su=ctx.cpCreatePoolFromDraft({name:'Straight Up',scoring:'straight_up',weeklyPickMode:'count',weeklyPickCount:2,confidenceMode:'all',dropLowestWeeks:0,entryCount:1});
su.games=[{key:'a',away:'A',home:'B',line:null},{key:'c',away:'C',home:'D',line:null},{key:'e',away:'E',home:'F',line:null}];
const suEntry={picks:{a:{team:'home',points:2},c:{team:'away',points:1}}};
check('straight-up pick-N pools do not require spreads', ctx.cpValidatePicks(su,suEntry,true).valid);
check('straight-up grading ignores the spread and grades the winner', ctx.cpStraightUpResult({team:'home'},31,24)==='W' && ctx.cpPickResult(su,{team:'away'},31,24,null)==='L');

// Pick-N archive should freeze only submitted games, not every game on the available slate.
su.entries=[{id:'e1',name:'Entry 1',picks:suEntry.picks,history:[]}];
const close=ctx.cpCloseWeek(su);
check('pick-N card is ready to close with exactly N submitted picks', close.problems.length===0);
close.apply();
check('pick-N archive contains only submitted picks', su.entries[0].history[0].games.length===2);

console.log(`\n${checks-failures}/${checks} checks passed`);
if(failures) process.exit(1);
