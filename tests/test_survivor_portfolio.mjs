import assert from "node:assert/strict";
import {portfolioSurvivalProbability,buildDiversifiedPortfolio} from "../app/survivor-core/js/portfolio.js";

// Exact shared-outcome math: duplicate paths should not be treated independently.
const p1={coverageComplete:true,probability:.72,events:[
  {gameKey:"g1",outcome:"A",p:.8},{gameKey:"g2",outcome:"C",p:.9}
]};
const p2same={coverageComplete:true,probability:.72,events:[
  {gameKey:"g1",outcome:"A",p:.8},{gameKey:"g2",outcome:"C",p:.9}
]};
let r=portfolioSurvivalProbability([p1,p2same]);
assert.ok(Math.abs(r.probability-.72)<1e-10,"duplicate paths must not double count");
assert.equal(r.sharedEventCount,2);

// Opposite sides of one game cannot both survive, so their intersection is zero.
const p2opp={coverageComplete:true,probability:.18,events:[
  {gameKey:"g1",outcome:"B",p:.2},{gameKey:"g3",outcome:"D",p:.9}
]};
r=portfolioSurvivalProbability([p1,p2opp]);
assert.ok(Math.abs(r.probability-.9)<1e-10,"opposite-side path intersection should be zero");

// Partial shared exposure is counted once in the intersection.
const p2overlap={coverageComplete:true,probability:.56,events:[
  {gameKey:"g1",outcome:"A",p:.8},{gameKey:"g3",outcome:"D",p:.7}
]};
r=portfolioSurvivalProbability([p1,p2overlap]);
assert.ok(Math.abs(r.probability-.776)<1e-10,"shared event should be counted once");

// More than 12 entries deliberately switches to deterministic Monte Carlo.
const thirteen=Array.from({length:13},()=>p1);
r=portfolioSurvivalProbability(thirteen,{monteCarloSamples:10000});
assert.equal(r.method,"seeded-monte-carlo");
assert.ok(Math.abs(r.probability-.72)<.025,"large-entry estimate should stay close on identical paths");

// Two identical entries: standalone exact paths both choose A (~50% season path).
// Portfolio optimizer should move one to B (~48%) because disjoint exposure raises
// "at least one survives" to about 74%.
const matchups=[
 {week:1,team:"A",opponent:"aOpp",gameId:"ga",completed:false,startDate:"2099-09-01T12:00:00Z",winProbability:.9},
 {week:1,team:"B",opponent:"bOpp",gameId:"gb",completed:false,startDate:"2099-09-01T12:00:00Z",winProbability:.8},
 {week:1,team:"C",opponent:"cOpp",gameId:"gc",completed:false,startDate:"2099-09-01T12:00:00Z",winProbability:.79},
 {week:2,team:"FA",opponent:"x",gameId:"gfa",completed:false,startDate:"2099-09-08T12:00:00Z",winProbability:.5555555556},
 {week:2,team:"FB",opponent:"y",gameId:"gfb",completed:false,startDate:"2099-09-08T12:00:00Z",winProbability:.6},
 {week:2,team:"FC",opponent:"z",gameId:"gfc",completed:false,startDate:"2099-09-08T12:00:00Z",winProbability:.5949367089},
];
const pathMap={
 A:[["A",.9,"ga","aOpp"],["FA",.5555555556,"gfa","x"]],
 B:[["B",.8,"gb","bOpp"],["FB",.6,"gfb","y"]],
 C:[["C",.79,"gc","cOpp"],["FC",.5949367089,"gfc","z"]],
};
const scoreApi={
 probabilityFor:m=>m.winProbability,
 buildSeasonPlan(planningMatchups,weeks,used,locks,picksPerWeek){
   const locked=Array.isArray(locks["1"])?locks["1"][0]:locks["1"];
   const available=planningMatchups.filter(m=>m.week===1);
   const team=locked||available.sort((a,b)=>b.winProbability-a.winProbability)[0]?.team;
   const rows=pathMap[team];
   if(!rows)return {picks:[],coverageComplete:false,survivalProbability:null,modeledSurvivalProbability:null};
   const picks=rows.map(([t,p,g,opp],i)=>({week:i+1,team:t,p,gameId:g,opponent:opp,skipped:false,conflict:false}));
   const prob=rows.reduce((x,row)=>x*row[1],1);
   return {picks,coverageComplete:true,survivalProbability:prob,modeledSurvivalProbability:prob};
 }
};
const entries=[{id:"e1",name:"One",picks:{}},{id:"e2",name:"Two",picks:{}}];
const portfolio=buildDiversifiedPortfolio({matchups,weeks:[1,2],entries,currentWeek:1,picksPerWeek:1,scoreApi,maxCandidatesPerEntry:3});
assert.ok(portfolio.baseline.probability>.49&&portfolio.baseline.probability<.51);
assert.ok(portfolio.optimized.probability>.73);
assert.ok(portfolio.diversificationGain>.20);
assert.equal(new Set(portfolio.optimized.selections.map(s=>s.option.signature)).size,2);

// Already-started games are not proposed as new choices.
const startedMatchups=[
 {week:1,team:"A",opponent:"aOpp",gameId:"ga",completed:false,startDate:"2000-01-01T12:00:00Z",winProbability:.99},
 {week:1,team:"B",opponent:"bOpp",gameId:"gb",completed:false,startDate:"2099-01-01T12:00:00Z",winProbability:.8},
 {week:2,team:"FB",opponent:"y",gameId:"gfb",completed:false,startDate:"2099-01-08T12:00:00Z",winProbability:.6},
];
const startedScore={
 probabilityFor:m=>m.winProbability,
 buildSeasonPlan(planningMatchups,weeks,used,locks){
   const locked=Array.isArray(locks["1"])?locks["1"][0]:locks["1"];
   const team=locked||planningMatchups.filter(m=>m.week===1).sort((a,b)=>b.winProbability-a.winProbability)[0]?.team;
   if(team==="B") return {picks:[
     {week:1,team:"B",p:.8,gameId:"gb"},{week:2,team:"FB",p:.6,gameId:"gfb"}
   ],coverageComplete:true,survivalProbability:.48,modeledSurvivalProbability:.48};
   if(team==="A") return {picks:[
     {week:1,team:"A",p:.99,gameId:"ga"},{week:2,team:"FB",p:.6,gameId:"gfb"}
   ],coverageComplete:true,survivalProbability:.594,modeledSurvivalProbability:.594};
   return {picks:[],coverageComplete:false,survivalProbability:null,modeledSurvivalProbability:null};
 }
};
const startedPortfolio=buildDiversifiedPortfolio({
  matchups:startedMatchups,weeks:[1,2],
  entries:[{id:"x1",name:"X1",picks:{}},{id:"x2",name:"X2",picks:{}}],
  currentWeek:1,picksPerWeek:1,scoreApi:startedScore
});
assert.ok(startedPortfolio.optimized.selections.every(s=>s.option.currentPicks.every(p=>p.team!=="A")),
  "an already-started unsaved team must not be recommended");


// A saved pick whose game has already started is locked and cannot be "diversified away."
const lockedStarted=buildDiversifiedPortfolio({
  matchups:startedMatchups,weeks:[1,2],
  entries:[{id:"s1",name:"S1",picks:{"1":"A"}},{id:"s2",name:"S2",picks:{}}],
  currentWeek:1,picksPerWeek:1,scoreApi:startedScore
});
const savedSelection=lockedStarted.optimized.selections.find(s=>s.entry.id==="s1");
assert.equal(savedSelection.option.currentPicks[0].team,"A","started saved pick must remain locked");

console.log("Survivor portfolio #25-26 tests passed");
