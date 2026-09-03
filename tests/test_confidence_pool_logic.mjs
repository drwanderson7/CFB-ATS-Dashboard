// Confidence pool logic coverage -- Sept 2, 2026 (Drew's explicit request).
// Exercises the ACTUAL functions from app/js/confidence.js in an isolated vm
// context, since that file is deliberately self-contained (no DOM, no
// `state` global) -- see its own header comment for why.
//
// CORRECTED same day after seeing Drew's real Splash sheet: this is
// confidence AGAINST THE SPREAD, not straight-up -- every game carries a
// required `line`, and grading uses the same cover-margin math as any ATS
// pick. The first version of this test file (and confidence.js itself)
// assumed straight-up; both are rewritten here.
import fs from "node:fs";
import vm from "node:vm";

const src=fs.readFileSync(new URL("../app/js/confidence.js",import.meta.url),"utf8");
const failures=[]; let total=0;
function check(name,cond){ total++; console.log(`[${cond?"PASS":"FAIL"}] ${name}`); if(!cond) failures.push(name); }

function makeCtx(){
  const ctx={ console, Object, Number, Math, Array, Set, Map, isNaN, Boolean };
  vm.createContext(ctx);
  vm.runInContext(src,ctx);
  return ctx;
}

function makePool(overrides){
  return Object.assign({
    id:"p1", name:"Test Confidence", pickCount:null,
    games:[
      {key:"a@b",away:"A",home:"B",line:-3},
      {key:"c@d",away:"C",home:"D",line:6.5},
      {key:"e@f",away:"E",home:"F",line:-10},
    ],
  },overrides||{});
}

// ---------------------------------------------------------------------------
// cpMaxPoints() / cpRequiredPickCount()
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const pool=makePool();
  check("cpMaxPoints(): pickCount unset -> every game on the slate (3)",ctx.cpMaxPoints(pool)===3);
  check("cpRequiredPickCount(): matches cpMaxPoints() when pickCount is unset",ctx.cpRequiredPickCount(pool)===3);

  const poolCustom=makePool({pickCount:2});
  check("cpMaxPoints(): custom pickCount(2) with 3 games available -> ceiling is 2, NOT total games -- Drew's explicit call",
    ctx.cpMaxPoints(poolCustom)===2);

  const poolZeroGames=makePool({games:[]});
  check("cpMaxPoints(): no games on the slate -> 0",ctx.cpMaxPoints(poolZeroGames)===0);

  const poolBadCount=makePool({pickCount:"not a number"});
  check("cpMaxPoints(): garbage pickCount value doesn't crash -> 0",ctx.cpMaxPoints(poolBadCount)===0);
}

// ---------------------------------------------------------------------------
// cpUsedPointValues()
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const pool=makePool();
  const entry={picks:{"a@b":{team:"home",points:3},"c@d":{team:"away",points:1}}};
  const used=ctx.cpUsedPointValues(pool,entry);
  check("cpUsedPointValues(): returns every currently-assigned point value",
    used.length===2 && used.includes(3) && used.includes(1));

  const entryStale={picks:{"a@b":{team:"home",points:3},"zzz@not-on-slate":{team:"home",points:2}}};
  const usedStale=ctx.cpUsedPointValues(pool,entryStale);
  check("cpUsedPointValues(): ignores picks pointing at a game no longer on the pool's active slate",
    usedStale.length===1 && usedStale[0]===3);
}

// ---------------------------------------------------------------------------
// cpValidatePicks()
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const pool=makePool(); // 3 games (each with a line set), pickCount unset -> maxPoints=3, required=3

  const goodEntry={picks:{
    "a@b":{team:"home",points:3},
    "c@d":{team:"away",points:1},
    "e@f":{team:"home",points:2},
  }};
  const rGood=ctx.cpValidatePicks(pool,goodEntry,true);
  check("cpValidatePicks(): a fully valid, complete set of picks passes with zero errors",
    rGood.valid===true && rGood.errors.length===0 && rGood.pickedCount===3 && rGood.required===3);

  const poolMissingLine=makePool({games:[
    {key:"a@b",away:"A",home:"B",line:-3},
    {key:"c@d",away:"C",home:"D",line:null},
    {key:"e@f",away:"E",home:"F",line:-10},
  ]});
  const rMissingLine=ctx.cpValidatePicks(poolMissingLine,{picks:{}},false);
  check("cpValidatePicks(): a game with no line set is flagged even during live/incomplete editing (can never be graded otherwise)",
    rMissingLine.valid===false && rMissingLine.errors.some(e=>e.includes("no line set")));

  const partialEntry={picks:{ "a@b":{team:"home",points:1} }};
  const rPartialLive=ctx.cpValidatePicks(pool,partialEntry,false);
  check("cpValidatePicks(): partial picks with requireComplete=false raises no 'missing pick' error (mid-edit UX)",
    rPartialLive.valid===true);

  const rPartialClose=ctx.cpValidatePicks(pool,partialEntry,true);
  check("cpValidatePicks(): same partial picks with requireComplete=true correctly blocks closing the week",
    rPartialClose.valid===false && rPartialClose.errors.some(e=>e.includes("1 of 3 required picks")));

  const dupEntry={picks:{
    "a@b":{team:"home",points:2},
    "c@d":{team:"away",points:2},
    "e@f":{team:"home",points:1},
  }};
  const rDup=ctx.cpValidatePicks(pool,dupEntry,true);
  check("cpValidatePicks(): duplicate point value across two games is rejected",
    rDup.valid===false && rDup.errors.some(e=>e.includes("2 points is assigned to more than one game")));

  const overEntry={picks:{ "a@b":{team:"home",points:5} }};
  const rOver=ctx.cpValidatePicks(pool,overEntry,false);
  check("cpValidatePicks(): a point value above the pool's max is rejected",
    rOver.valid===false && rOver.errors.some(e=>e.includes("outside the allowed 1-3 range")));

  const zeroEntry={picks:{ "a@b":{team:"home",points:0} }};
  const rZero=ctx.cpValidatePicks(pool,zeroEntry,false);
  check("cpValidatePicks(): a point value of 0 is rejected (range is 1-N, not 0-N)",
    rZero.valid===false);

  const fracEntry={picks:{ "a@b":{team:"home",points:1.5} }};
  const rFrac=ctx.cpValidatePicks(pool,fracEntry,false);
  check("cpValidatePicks(): a non-integer point value is rejected",
    rFrac.valid===false && rFrac.errors.some(e=>e.includes("whole number")));

  const badTeamEntry={picks:{ "a@b":{team:"visitor",points:1} }};
  const rBadTeam=ctx.cpValidatePicks(pool,badTeamEntry,false);
  check("cpValidatePicks(): a pick with an invalid team value ('visitor') is rejected",
    rBadTeam.valid===false && rBadTeam.errors.some(e=>e.includes("home or away")));

  const staleEntry={picks:{ "not-on-slate":{team:"home",points:1} }};
  const rStale=ctx.cpValidatePicks(pool,staleEntry,false);
  check("cpValidatePicks(): a pick pointing at a game no longer on the active slate is flagged",
    rStale.valid===false && rStale.errors.some(e=>e.includes("no longer on this week's slate")));

  const poolCustom=makePool({pickCount:2});
  const customGoodEntry={picks:{ "a@b":{team:"home",points:2}, "c@d":{team:"away",points:1} }};
  const rCustomGood=ctx.cpValidatePicks(poolCustom,customGoodEntry,true);
  check("cpValidatePicks(): custom pickCount=2 -- picking exactly 2 of 3 games with points 1-2 is valid and complete",
    rCustomGood.valid===true && rCustomGood.required===2 && rCustomGood.maxPoints===2);

  const customOverEntry={picks:{ "a@b":{team:"home",points:3} }};
  const rCustomOver=ctx.cpValidatePicks(poolCustom,customOverEntry,false);
  check("cpValidatePicks(): custom pickCount=2 -- a point value of 3 is rejected (range is 1-2, not 1-totalGames)",
    rCustomOver.valid===false && rCustomOver.errors.some(e=>e.includes("outside the allowed 1-2 range")));
}

// ---------------------------------------------------------------------------
// cpAtsResult() -- the actual against-the-spread grading math, same
// cover-margin convention as api/grade_picks.py's grade().
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  check("cpAtsResult(): home favorite covers a bigger margin than the line -> W",
    ctx.cpAtsResult({team:"home"},31,21,-7)==="W");
  check("cpAtsResult(): home favorite wins but doesn't cover the spread -> L",
    ctx.cpAtsResult({team:"home"},24,21,-7)==="L");
  check("cpAtsResult(): away underdog picked, loses by less than the spread -> covers -> W",
    ctx.cpAtsResult({team:"away"},24,21,-7)==="W");
  check("cpAtsResult(): margin exactly equals the spread -> P (push), matching grade_picks.py's grade()",
    ctx.cpAtsResult({team:"home"},28,21,-7)==="P");
  check("cpAtsResult(): missing score or line -> null, doesn't throw",
    ctx.cpAtsResult({team:"home"},null,21,-7)===null &&
    ctx.cpAtsResult({team:"home"},28,21,null)===null);

  check("cpAtsResult(): real Splash-sheet-shaped numbers (GT -6.5 wins by 10) -- home (GT) pick covers -> W",
    ctx.cpAtsResult({team:"home"},31,21,-6.5)==="W");
  check("cpAtsResult(): same game -- away (Colorado) pick does not cover -> L",
    ctx.cpAtsResult({team:"away"},31,21,-6.5)==="L");
}

// ---------------------------------------------------------------------------
// cpGradeWeek()
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const scores={
    "a@b":{home_score:31,away_score:24},
    "c@d":{home_score:10,away_score:27},
    "e@f":{home_score:21,away_score:14},
  };
  const weekEntry={
    games:[
      {key:"a@b",away:"A",home:"B",line:-3,team:"home",points:3,result:null,pointsEarned:null},
      {key:"c@d",away:"C",home:"D",line:6.5,team:"home",points:2,result:null,pointsEarned:null},
      {key:"e@f",away:"E",home:"F",line:-10,team:"home",points:1,result:null,pointsEarned:null},
    ],
    totalPoints:null, possiblePoints:null,
  };
  const result=ctx.cpGradeWeek(weekEntry,(g)=>scores[g.key]||null);
  check("cpGradeWeek(): grading completes when every game has a resolvable score and line",result.complete===true);
  check("cpGradeWeek(): a covering pick earns its full point value",
    weekEntry.games[0].result==="W" && weekEntry.games[0].pointsEarned===3);
  check("cpGradeWeek(): a non-covering pick earns 0 points and is marked L",
    weekEntry.games[1].result==="L" && weekEntry.games[1].pointsEarned===0);
  check("cpGradeWeek(): a favorite that wins but doesn't cover is L, not W (proves the spread actually matters, not just the winner)",
    weekEntry.games[2].result==="L" && weekEntry.games[2].pointsEarned===0);
  check("cpGradeWeek(): totalPoints sums only the covering picks' points (3 + 0 + 0 = 3)",
    result.totalPoints===3 && weekEntry.totalPoints===3);
  check("cpGradeWeek(): possiblePoints sums every picked game's point value regardless of outcome (3+2+1=6)",
    result.possiblePoints===6 && weekEntry.possiblePoints===6);

  const pushWeek={
    games:[{key:"a@b",away:"A",home:"B",line:-7,team:"home",points:5,result:null,pointsEarned:null}],
    totalPoints:null, possiblePoints:null,
  };
  ctx.cpGradeWeek(pushWeek,()=>({home_score:28,away_score:21}));
  check("cpGradeWeek(): an exact push is graded 'P', earns 0 points, and is not counted as a covering win",
    pushWeek.games[0].result==="P" && pushWeek.games[0].pointsEarned===0 && pushWeek.totalPoints===0);

  const weekEntryPartial={
    games:[
      {key:"a@b",away:"A",home:"B",line:-3,team:"home",points:3,result:null,pointsEarned:null},
      {key:"c@d",away:"C",home:"D",line:6.5,team:"home",points:2,result:null,pointsEarned:null},
    ],
    totalPoints:null, possiblePoints:null,
  };
  const partialScores={"a@b":{home_score:31,away_score:24}};
  const resultPartial=ctx.cpGradeWeek(weekEntryPartial,(g)=>partialScores[g.key]||null);
  check("cpGradeWeek(): incomplete grading (a game with no final score yet) reports complete:false",
    resultPartial.complete===false);
  check("cpGradeWeek(): incomplete grading still grades the games that DO have a score",
    weekEntryPartial.games[0].result==="W");
  check("cpGradeWeek(): incomplete grading does NOT write totalPoints/possiblePoints onto the week yet (avoids a misleadingly-final-looking partial total)",
    weekEntryPartial.totalPoints===null && weekEntryPartial.possiblePoints===null);

  const weekEntryNoLine={
    games:[{key:"a@b",away:"A",home:"B",line:null,team:"home",points:3,result:null,pointsEarned:null}],
    totalPoints:null, possiblePoints:null,
  };
  const resultNoLine=ctx.cpGradeWeek(weekEntryNoLine,()=>({home_score:31,away_score:24}));
  check("cpGradeWeek(): a resolvable score but a missing line still leaves the game ungraded (no line = no ATS grade)",
    resultNoLine.complete===false && weekEntryNoLine.games[0].result===null);

  let scoreLookupCalls=0;
  const alreadyGraded={
    games:[{key:"a@b",away:"A",home:"B",line:-3,team:"home",points:3,result:"W",pointsEarned:3}],
    totalPoints:3, possiblePoints:3,
  };
  const rerunResult=ctx.cpGradeWeek(alreadyGraded,(g)=>{ scoreLookupCalls++; return scores[g.key]; });
  check("cpGradeWeek(): a game already graded (result already set) is skipped -- no re-lookup, idempotent re-run",
    scoreLookupCalls===0 && rerunResult.totalPoints===3);
}

// ---------------------------------------------------------------------------
// cpSeasonTotal() -- including dropLowestWeeks, the real Splash rule from
// Drew's actual sheet ("Your 2 lowest-scoring weeks will be dropped").
// ---------------------------------------------------------------------------
{
  const ctx=makeCtx();
  const entry={history:[
    {totalPoints:10,possiblePoints:15},
    {totalPoints:7,possiblePoints:12},
    {totalPoints:null,possiblePoints:null},
  ]};
  const season=ctx.cpSeasonTotal(entry);
  check("cpSeasonTotal(): with no dropLowestWeeks, sums only weeks that finished grading (10+7=17), ignoring an in-progress week",
    season.points===17 && season.possible===27 && season.weeksGraded===2 && season.weeksDropped===0);

  const emptyEntry={history:[]};
  const emptySeason=ctx.cpSeasonTotal(emptyEntry);
  check("cpSeasonTotal(): an entry with no graded history yet returns zeros, not null/undefined/a crash",
    emptySeason.points===0 && emptySeason.possible===0 && emptySeason.weeksGraded===0);

  const seasonEntry={history:[
    {totalPoints:10,possiblePoints:15},
    {totalPoints:3,possiblePoints:15},
    {totalPoints:14,possiblePoints:15},
    {totalPoints:5,possiblePoints:15},
    {totalPoints:12,possiblePoints:15},
  ]};
  const dropped=ctx.cpSeasonTotal(seasonEntry,2);
  check("cpSeasonTotal(): dropLowestWeeks=2 excludes the 2 lowest-scoring weeks (drops 3 and 5, keeps 10+14+12=36)",
    dropped.points===36 && dropped.weeksGraded===5 && dropped.weeksDropped===2);

  const tooFewWeeks={history:[{totalPoints:10,possiblePoints:15}]};
  const droppedTooMany=ctx.cpSeasonTotal(tooFewWeeks,2);
  check("cpSeasonTotal(): dropLowestWeeks=2 with only 1 graded week doesn't crash or drop more weeks than exist",
    droppedTooMany.weeksDropped===1 && droppedTooMany.points===0);

  const noDropVariants=[undefined,0,-5,null].map(d=>ctx.cpSeasonTotal(seasonEntry,d));
  check("cpSeasonTotal(): dropLowestWeeks of undefined/0/negative/null all behave as 'no drop'",
    noDropVariants.every(s=>s.weeksDropped===0 && s.points===(10+3+14+5+12)));
}

console.log("");
console.log(`${total-failures.length}/${total} checks passed`);
if(failures.length){ console.log("FAILED:"); failures.forEach(f=>console.log(`  - ${f}`)); process.exit(1); }
process.exit(0);
