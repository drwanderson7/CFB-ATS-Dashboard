// Results/learning dashboard uses frozen pick-time fields only and keeps
// historical filtering/calibration numerically honest.
import fs from "node:fs";
import vm from "node:vm";
const src=fs.readFileSync(new URL("../app/js/record.js",import.meta.url),"utf8");
const ctx={console};vm.createContext(ctx);vm.runInContext(src,ctx);

const hist=[
  {id:"w26-1",label:"2026 Week 1",closedAt:"2026-09-05T20:00:00Z",entries:[{entryId:"e1",name:"Entry 1",picks:[
    {result:"W",side:"home",line:-3.5,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:3.2,clv:1.0,coverProbabilityAtPick:.58,modelAgreementAtPick:{pct:.80},keyTierAtPick:"major"},
    {result:"L",side:"away",line:7,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:2.0,clv:-0.5,coverProbabilityAtPick:.54,modelAgreementAtPick:{pct:.65},keyTierAtPick:"none"},
    {result:"P",side:"away",line:-10.5,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:5.0,clv:0,coverProbabilityAtPick:.66,modelAgreementAtPick:{pct:.90},keyTierAtPick:"moderate"},
    {result:null,side:"home",line:4,cfbdSeason:2026,cfbdWeek:1,pickedEdgeAtPick:4.0,clv:2.0,coverProbabilityAtPick:.61,modelAgreementAtPick:{pct:.90},keyTierAtPick:"major"}, // ungraded excluded
  ]}]},
  {id:"w26-2",label:"Week 2",closedAt:"2026-09-12T20:00:00Z",entries:[{entryId:"e1",name:"Entry 1",picks:[
    // Deliberate null analytics fields: null must remain missing, never become numeric zero.
    {result:"W",side:"home",line:2.5,cfbdSeason:2026,cfbdWeek:2,pickedEdgeAtPick:null,clv:null,coverProbabilityAtPick:null,modelAgreementAtPick:null},
  ]}]},
  {id:"w25-4",label:"2025 Week 4",closedAt:"2025-09-20T20:00:00Z",entries:[{entryId:"e2",name:"Entry 2",picks:[
    {result:"W",side:"home",line:-14.5,cfbdSeason:2025,cfbdWeek:4,pickedEdgeAtPick:1.0,clv:1.5,coverProbabilityAtPick:.62,modelAgreementAtPick:{pct:.70},keyTierAtPick:"minor"},
  ]}]},
];

const failures=[];let total=0;function check(n,c){total++;console.log(`[${c?"PASS":"FAIL"}] ${n}`);if(!c)failures.push(n);}
const a=ctx.recordAnalytics(hist);
check("overall record includes every graded pick",a.W===3&&a.L===1&&a.P===1&&a.gradedCount===5);
check("ATS win rate excludes pushes",Math.abs(a.winPct-3/4)<1e-9);
check("ungraded archived picks are excluded from learning metrics",a.totalArchived===6&&a.gradedCount===5);
check("null frozen Edge stays missing instead of becoming numeric zero",a.edgeEligible===4&&Math.abs(a.avgPickedEdge-2.8)<1e-9);
check("null CLV stays missing instead of being misclassified as flat",a.clvEligible===4&&Math.abs(a.avgClv-0.5)<1e-9);
check("positive CLV rate uses only picks with real closing-line data",Math.abs(a.positiveClvPct-0.5)<1e-9);
check("null Cover % stays missing",a.coverEligible===4&&Math.abs(a.avgCoverProbability-.60)<1e-9);
check("overall calibration compares observed covers to frozen probability",Math.abs(a.observedCoverRate-.50)<1e-9&&Math.abs(a.calibrationGap-(-.10))<1e-9);

const fav=a.favoriteDogBuckets.find(x=>x.label==="Favorites");
const dog=a.favoriteDogBuckets.find(x=>x.label==="Underdogs");
check("favorites vs underdogs uses the picked team's frozen line",fav.W===2&&fav.P===1&&fav.n===3&&dog.W===1&&dog.L===1&&dog.n===2);
const home=a.homeAwayBuckets.find(x=>x.label==="Home");
const away=a.homeAwayBuckets.find(x=>x.label==="Away");
check("home vs away uses frozen pick side",home.W===3&&home.n===3&&away.L===1&&away.P===1&&away.n===2);
const spreadSmall=a.spreadBuckets.find(x=>x.label==="PK–2.5");
const spreadHuge=a.spreadBuckets.find(x=>x.label==="14.5+");
check("spread buckets use absolute picked spread",spreadSmall.W===1&&spreadSmall.n===1&&spreadHuge.W===1&&spreadHuge.n===1);
const keyMajor=a.keyTierBuckets.find(x=>x.label==="Major");
const keyNone=a.keyTierBuckets.find(x=>x.label==="No key involvement");
check("key-number analysis excludes legacy picks with no frozen key tier",a.keyTierEligible===4&&keyMajor.W===1&&keyNone.L===1);
const posClv=a.clvBuckets.find(x=>x.label==="Positive CLV");
const negClv=a.clvBuckets.find(x=>x.label==="Negative CLV");
const flatClv=a.clvBuckets.find(x=>x.label==="Flat CLV");
check("CLV vs ATS separates positive negative and true zero",posClv.W===2&&posClv.n===2&&negClv.L===1&&flatClv.P===1);
const cal65=a.calibrationBuckets.find(x=>x.label==="65%+");
check("calibration treats a push as not-a-cover rather than a win/loss decision",cal65.n===1&&cal65.P===1&&cal65.observed===0&&Math.abs(cal65.avgPred-.66)<1e-9);

const s26=ctx.recordAnalytics(hist,{season:"2026",week:"all"});
check("season filter applies to record and analytics",s26.W===2&&s26.L===1&&s26.P===1&&s26.totalArchived===5);
const s26w1=ctx.recordAnalytics(hist,{season:"2026",week:"1"});
check("week filter narrows the selected season",s26w1.W===1&&s26w1.L===1&&s26w1.P===1&&s26w1.totalArchived===4);
const optsAll=ctx.recordFilterOptions(hist,{season:"all",week:"all"});
const opts26=ctx.recordFilterOptions(hist,{season:"2026",week:"all"});
check("season options are canonical and newest first",JSON.stringify(optsAll.seasons)==='[2026,2025]');
check("week options react to selected season",JSON.stringify(opts26.weeks)==='[1,2]');
check("legacy labels can supply explicit season/week metadata without model reconstruction",ctx.recordSeasonOf({label:"2024 Week 9"},{})===2024&&ctx.recordWeekOf({label:"2024 Week 9"},{})===9);
check("missing numeric historical values remain null",ctx.recordNumber(null)===null&&ctx.recordNumber(undefined)===null&&ctx.recordNumber("")===null&&ctx.recordNumber(0)===0);

if(failures.length){console.log(`\n${failures.length} of ${total} FAILURE(S):`,failures);process.exit(1);}console.log(`\nAll ${total} checks passed.`);
