import fs from 'fs';
import vm from 'vm';
let failures=0,checks=0;
function check(name,cond){checks++;if(cond)console.log(`[PASS] ${name}`);else{failures++;console.error(`[FAIL] ${name}`);}}
const logic=fs.readFileSync(new URL('../app/js/confidence.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('../app/js/confidence-integration.js',import.meta.url),'utf8');
const css=fs.readFileSync(new URL('../app/css/app.css',import.meta.url),'utf8');
let id=0;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const ctx={
 console,
 state:{confidencePools:[],confidenceActivePoolId:null,lastGames:[],predictions:[],pdfGames:[]},
 uid:()=>`id${++id}`,save:()=>{},esc:s=>String(s??''),mkey:(a,h)=>`${norm(a)}@${norm(h)}`,
 teamMatchTrunc:(a,b)=>norm(a)===norm(b),normTracker:s=>s,
 localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>({})},
 pgAlert:async()=>{},pgConfirm:async()=>true,pgPrompt:async()=>null,kickStr:s=>s,
 round1:n=>Math.round(Number(n)*10)/10,
 probabilityCoverForGame:(M,V)=>{const edge=Math.abs(Number(V)-Number(M));const side=M<V?'home':M>V?'away':null;return {pCover:side?Math.min(.75,.525+edge*.02):.5,pLoss:.45,pPush:0,side,probEdge:0,ev:0,bucketRange:[0,999]};},
 PICKGAUGE_MODEL_PRESET:{systems:['teamrank','sagpred','cfbdsp','wayward','sag'],weights:{teamrank:20,vegas:19,sagpred:18,cfbdsp:16,wayward:15,sag:12}},
 Date,Number,Math,Array,Set,Map,Object,String,JSON,isNaN,Blob:class{},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},navigator:{},window:{open:()=>null},setTimeout,clearTimeout,
};
vm.createContext(ctx);vm.runInContext(logic,ctx);vm.runInContext(ui,ctx);

check('Confidence UI now has This Week / Results / Pool Settings subviews',ui.includes('This Week')&&ui.includes('Results')&&ui.includes('Pool Settings'));
check('weekly PDF import is the primary setup path',ui.includes('Import Splash PDF')&&ui.includes('cpImportWeeklyPdf'));
check('Confidence Board includes suggested ranking, submission and export actions',ui.includes('Build PickGauge ranking')&&ui.includes('Mark card submitted')&&ui.includes('Print / PDF')&&ui.includes('Copy picks'));
check('ranking CSS includes desktop grid and mobile responsive layout',css.includes('.cp-confidence-board')&&css.includes('.cp-board-row')&&css.includes('@media(max-width:620px)'));

const pool=ctx.cpCreatePoolFromDraft({name:'Test',scoring:'ats',weeklyPickMode:'all',confidenceMode:'all',dropLowestWeeks:2,entryCount:1});
const imported={source:'splash',pickLimit:3,count:3,dropLowestWeeks:2,picksLockAt:'2099-09-03T19:00:00',lockMode:'card',weekNumber:1,games:[
 {away:'A',home:'B',commence:'2099-09-03T19:00:00',line:-3},
 {away:'C',home:'D',commence:'2099-09-04T19:00:00',line:-7},
 {away:'E',home:'F',commence:'2099-09-05T19:00:00',line:3},
]};
ctx.state.lastGames=[
 {id:'g1',away:'A',home:'B',commence:'2099-09-03T19:00:00',vegas:-3},
 {id:'g2',away:'C',home:'D',commence:'2099-09-04T19:00:00',vegas:-7},
 {id:'g3',away:'E',home:'F',commence:'2099-09-05T19:00:00',vegas:3},
];
ctx.state.predictions=[
 {road:'A',home:'B',systems:{teamrank:-8,sagpred:-7,cfbdsp:-7,wayward:-6,sag:-7}},
 {road:'C',home:'D',systems:{teamrank:-8,sagpred:-8,cfbdsp:-8,wayward:-8,sag:-8}},
 {road:'E',home:'F',systems:{teamrank:8,sagpred:8,cfbdsp:8,wayward:8,sag:8}},
];
const applied=ctx.cpApplyImportedWeek(pool,imported);
check('weekly import saves all games and exact pool lines',applied.ok&&pool.games.length===3&&pool.games[0].line===-3&&pool.games[2].line===3);
check('weekly import captures full-card lock and drop-week validation metadata',pool.lockMode==='card'&&pool.cardLockAt==='2099-09-03T19:00:00'&&pool.weekImportMeta.dropLowestWeeks===2&&pool.weekImportMeta.warnings.length===0);
check('imported games inherit stable provider IDs from live odds matches',pool.games[0].providerGameId==='g1'&&pool.games[2].providerGameId==='g3');

const entry=pool.entries[0];
const built=ctx.cpBuildSuggestedCard(pool,entry);
check('Build PickGauge ranking selects every required ATS side when model coverage exists',built.ok&&built.picked===3&&Object.values(entry.picks).filter(p=>p.team).length===3);
const pts=Object.values(entry.picks).map(p=>Number(p.points)||0).sort((a,b)=>a-b);
check('suggested ranking automatically assigns unique 1..N confidence values',JSON.stringify(pts)===JSON.stringify([1,2,3]));
const rankedBefore=ctx.cpRankedKeys(pool,entry);
ctx.cpMoveRank(pool,entry,rankedBefore[0],1);
const rankedAfter=ctx.cpRankedKeys(pool,entry);
check('manual reorder changes confidence order while preserving unique points',rankedAfter[0]===rankedBefore[1]&&new Set(Object.values(entry.picks).map(p=>p.points)).size===3);

const ready=ctx.cpValidatePicks(pool,entry,true);
check('readiness validation recognizes a complete card',ready.valid&&ready.pickedCount===3&&ready.rankedCount===3);
const submit=ctx.cpMarkCardSubmitted(pool,entry);
check('Mark card submitted creates a dated history snapshot without clearing current picks',submit.ok&&entry.history.length===1&&Object.keys(entry.picks).length===3&&entry.history[0].status==='submitted');
const again=ctx.cpMarkCardSubmitted(pool,entry);
check('re-submit before lock updates the same week instead of duplicating history',again.ok&&entry.history.length===1);
check('submission snapshot freezes PickGauge probability context when available',entry.history[0].games.every(g=>'pickGaugeModelAtSubmit' in g&&'coverProbabilityAtSubmit' in g&&'winProbabilityAtSubmit' in g));

const dup=ctx.cpDuplicateEntry(pool,entry);
check('Duplicate entry copies current-week card but not season history',JSON.stringify(dup.picks)===JSON.stringify(entry.picks)&&dup.history.length===0);
check('card lock helper enforces the imported full-card lock',ctx.cpIsCardLocked({cardLockAt:'2000-01-01T00:00:00'},Date.now())===true);
const su=ctx.cpCreatePoolFromDraft({name:'SU',scoring:'straight_up',weeklyPickMode:'all',confidenceMode:'all',dropLowestWeeks:0,entryCount:1});
su.games=[
 {key:ctx.mkey('SU Dog A','SU Fav A'),away:'SU Dog A',home:'SU Fav A',commence:'2099-09-03T19:00:00'},
 {key:ctx.mkey('SU Dog B','SU Fav B'),away:'SU Dog B',home:'SU Fav B',commence:'2099-09-04T19:00:00'},
];
ctx.state.lastGames.push(
 {id:'su1',away:'SU Dog A',home:'SU Fav A',commence:'2099-09-03T19:00:00',vegas:-14},
 {id:'su2',away:'SU Dog B',home:'SU Fav B',commence:'2099-09-04T19:00:00',vegas:-3},
);
ctx.state.predictions.push(
 {road:'SU Dog A',home:'SU Fav A',systems:{teamrank:-16,sagpred:-15,cfbdsp:-15,wayward:-14,sag:-15}},
 {road:'SU Dog B',home:'SU Fav B',systems:{teamrank:-4,sagpred:-3,cfbdsp:-3,wayward:-2,sag:-3}},
);
const suStrong=ctx.cpWinProbabilityFromModel(-15),suWeak=ctx.cpWinProbabilityFromModel(-3);
check('straight-up win probability converts PickGauge projected margin into favorite win chance',suStrong.side==='home'&&suStrong.pWin>.8&&suWeak.pWin>.5&&suStrong.pWin>suWeak.pWin);
const suBuilt=ctx.cpBuildSuggestedCard(su,su.entries[0]);
check('Build PickGauge ranking now supports straight-up confidence pools',suBuilt.ok&&suBuilt.picked===2&&Object.values(su.entries[0].picks).every(p=>p.team==='home'));
const suRanks=ctx.cpRankedKeys(su,su.entries[0]);
check('straight-up ranking assigns the highest confidence value to the highest modeled win probability',suRanks[0]===su.games[0].key&&su.entries[0].picks[su.games[0].key].points===2);
const suAnalysis=ctx.cpPickGaugeAnalysis(su,su.games[0]);
check('straight-up board analysis exposes Win % and no Cover %',suAnalysis.pWin>.8&&suAnalysis.pCover===null&&suAnalysis.side==='home');

// Splash exports include navigation tabs for multiple weeks, so a parser can
// encounter "Week 1" before the actual Week 2 slate. Kickoff dates must win.
ctx.weekIndexOf=s=>String(s).includes('2099-09-10')?2:1;
const futurePool=ctx.cpCreatePoolFromDraft({name:'Future',scoring:'ats',weeklyPickMode:'all',confidenceMode:'all',dropLowestWeeks:0,entryCount:1});
const futureApplied=ctx.cpApplyImportedWeek(futurePool,{source:'splash',pickLimit:1,count:1,weekNumber:1,games:[{away:'G',home:'H',commence:'2099-09-10T19:00:00',line:-4}]});
check('weekly import derives week from kickoff dates instead of Splash navigation-tab text',futureApplied.ok&&futurePool.currentWeekNumber===2&&futurePool.weekLabel==='Week 2');

console.log(`\n${checks-failures}/${checks} checks passed`);if(failures)process.exit(1);
