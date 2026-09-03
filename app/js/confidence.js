// ---------------------------------------------------------------------------
// Confidence pools -- dedicated pure rule/grading engine.
//
// Pool setup now stores the contest rules explicitly:
//   scoring: "ats" | "straight_up"
//   weeklyPickMode: "all" | "count"
//   weeklyPickCount: null | N
//   confidenceMode: "all" | "top"
//   confidenceCount: null | N
//   dropLowestWeeks: null | N
//
// This separation matters because a contest may require every game to be
// picked but only the Top X picks to receive confidence values. Those
// remaining submitted picks are valid picks worth 0 points. Legacy pools
// that only have `pickCount` remain supported through the compatibility
// readers below and normalizeState() in main.js.
//
// Current-week games/picks are archived into each entry's history before
// automated grading. ATS mode grades against the frozen contest spread;
// straight-up mode grades the final winner and does not require a spread.
// ---------------------------------------------------------------------------

// The point-value ceiling for a pool's CURRENT week: Drew's explicit rule --
// pickCount unset means "every game on the slate", pickCount set means
// points run 1..pickCount (not 1..totalGames with gaps).
function cpScoring(pool){
  return (pool&&pool.scoring==="straight_up")?"straight_up":"ats";
}

// Backward-compatible rule readers. Pools created before the guided setup
// wizard only had `pickCount`; normalize them here so old saved state keeps
// working even before normalizeState() has had a chance to persist the newer
// explicit fields.
function cpWeeklyPickMode(pool){
  if(pool&&pool.weeklyPickMode==="count") return "count";
  if(pool&&pool.weeklyPickMode==="all") return "all";
  return (pool&&pool.pickCount!=null&&pool.pickCount!=="")?"count":"all";
}
function cpWeeklyPickCount(pool){
  if(cpWeeklyPickMode(pool)!=="count") return null;
  const raw=(pool&&pool.weeklyPickCount!=null)?pool.weeklyPickCount:pool&&pool.pickCount;
  const n=Math.floor(Number(raw));
  return Number.isFinite(n)&&n>0?n:0;
}
function cpConfidenceMode(pool){
  return (pool&&pool.confidenceMode==="top")?"top":"all";
}
function cpConfidenceCount(pool){
  if(cpConfidenceMode(pool)!=="top") return null;
  const n=Math.floor(Number(pool&&pool.confidenceCount));
  return Number.isFinite(n)&&n>0?n:0;
}

// How many games must receive a side this week.
function cpRequiredPickCount(pool){
  const available=(pool&&Array.isArray(pool.games))?pool.games.length:0;
  if(cpWeeklyPickMode(pool)==="all") return available;
  return Math.min(available, cpWeeklyPickCount(pool));
}

// Highest confidence value / number of games that must receive confidence
// points. This is intentionally independent from cpRequiredPickCount(): a
// pool may require every game to be picked but only the Top 5 to carry
// confidence points. Unranked submitted picks are worth zero points.
function cpMaxPoints(pool){
  const required=cpRequiredPickCount(pool);
  if(cpConfidenceMode(pool)==="all") return required;
  return Math.min(required, cpConfidenceCount(pool));
}

function cpRequiredRankedCount(pool){ return cpMaxPoints(pool); }

// Every point value an entry currently has assigned, across its CURRENT
// active games only. Zero/null means the pick is submitted but intentionally
// unranked in a Top-X confidence pool.
function cpUsedPointValues(pool, entry){
  const validKeys=new Set((pool.games||[]).map(g=>g.key));
  const vals=[];
  Object.keys((entry&&entry.picks)||{}).forEach(k=>{
    if(!validKeys.has(k)) return;
    const p=entry.picks[k];
    if(p&&p.points!=null&&p.points!==""&&Number(p.points)>0) vals.push(Number(p.points));
  });
  return vals;
}

function cpValidatePicks(pool, entry, requireComplete){
  const errors=[];
  const maxPoints=cpMaxPoints(pool);
  const required=cpRequiredPickCount(pool);
  const rankedRequired=cpRequiredRankedCount(pool);
  const games=pool.games||[];
  const picks=(entry&&entry.picks)||{};
  const validKeys=new Set(games.map(g=>g.key));
  const seenPoints=new Map();
  let pickedCount=0, rankedCount=0;

  games.forEach(g=>{
    const p=picks[g.key];
    if(!p) return;
    if(p.team!=null){
      if(p.team!=="home"&&p.team!=="away") errors.push(`${g.away} @ ${g.home}: pick must be the home or away team.`);
      else pickedCount++;
    }
    const explicitPts=p.points!=null&&p.points!=="";
    if(explicitPts && Number(p.points)===0 && cpConfidenceMode(pool)!=="top") {
      errors.push(`${g.away} @ ${g.home}: 0 points is outside the allowed 1-${maxPoints} range.`);
      return;
    }
    const hasPts=explicitPts&&Number(p.points)>0;
    if(!hasPts) return;
    if(p.team!=="home"&&p.team!=="away"){
      errors.push(`${g.away} @ ${g.home}: choose a side before assigning confidence points.`);
      return;
    }
    const pts=Number(p.points);
    rankedCount++;
    if(!Number.isInteger(pts)){
      errors.push(`${g.away} @ ${g.home}: points must be a whole number.`);
      return;
    }
    if(pts<1||pts>maxPoints){
      errors.push(`${g.away} @ ${g.home}: ${pts} points is outside the allowed 1-${maxPoints} range.`);
      return;
    }
    if(!seenPoints.has(pts)) seenPoints.set(pts,[]);
    seenPoints.get(pts).push(`${g.away} @ ${g.home}`);
  });

  seenPoints.forEach((matchups,pts)=>{
    if(matchups.length>1) errors.push(`${pts} points is assigned to more than one game: ${matchups.join(" / ")}.`);
  });

  Object.keys(picks).forEach(k=>{
    if(!validKeys.has(k)) errors.push(`A pick is assigned to a game that's no longer on this week's slate -- remove it to free up its point value.`);
  });

  // ATS pools need a frozen contest line for every required picked game.
  // Straight-up pools do not use the spread at all.
  if(cpScoring(pool)==="ats"){
    games.forEach(g=>{
      const p=picks[g.key];
      const lineRequired=cpWeeklyPickMode(pool)==="all" || (p&&p.team!=null);
      if(lineRequired && (g.line==null||g.line==="")){
        errors.push(`${g.away} @ ${g.home}: no line set -- required to grade an ATS confidence pick.`);
      }
    });
  }

  if(requireComplete){
    if(pickedCount<required) errors.push(`${pickedCount} of ${required} required picks made.`);
    if(rankedCount<rankedRequired) errors.push(`${rankedCount} of ${rankedRequired} required confidence values assigned.`);
    // Exact 1..N usage guarantees no missing confidence rank in a complete card.
    for(let n=1;n<=rankedRequired;n++){
      if(!seenPoints.has(n)) errors.push(`Confidence ${n} is unassigned.`);
    }
  }
  return {valid:errors.length===0, errors, pickedCount, rankedCount, required, rankedRequired, maxPoints};
}

// Grades one confidence pick against the spread -- the EXACT same
// cover-margin math as api/grade_picks.py's grade(picked_score, opp_score,
// line) / this app's own ATS pick grading, just expressed client-side so
// an instant local preview and the server-side Python port
// (_grade_confidence_pools()) can never quietly diverge on what "covers"
// means. `line` is home-team-perspective (Splash's printed home-team
// number); the picked side's own line is `line` if home, `-line` if away
// -- same flip every other ATS calculation in this app already does.
// Returns "W"/"L"/"P" (a push -- an exact tie against the number --
// counts as neither), or null if scores/line aren't available yet.
function cpAtsResult(pick, homeScore, awayScore, line){
  if(homeScore==null||awayScore==null||line==null||isNaN(homeScore)||isNaN(awayScore)||isNaN(line)) return null;
  const pickedLine=(pick.team==="home")?Number(line):-Number(line);
  const pickedScore=(pick.team==="home")?homeScore:awayScore;
  const oppScore=(pick.team==="home")?awayScore:homeScore;
  const margin=(pickedScore-oppScore)+pickedLine;
  if(margin>0) return "W";
  if(margin<0) return "L";
  return "P";
}

function cpStraightUpResult(pick, homeScore, awayScore){
  if(homeScore==null||awayScore==null||isNaN(homeScore)||isNaN(awayScore)) return null;
  const pickedScore=(pick.team==="home")?Number(homeScore):Number(awayScore);
  const oppScore=(pick.team==="home")?Number(awayScore):Number(homeScore);
  if(pickedScore>oppScore) return "W";
  if(pickedScore<oppScore) return "L";
  return "P";
}

function cpPickResult(pool,pick,homeScore,awayScore,line){
  return cpScoring(pool)==="straight_up"
    ? cpStraightUpResult(pick,homeScore,awayScore)
    : cpAtsResult(pick,homeScore,awayScore,line);
}

// Grades one archived week's games in place. `pool` is optional for legacy
// callers/tests and defaults to ATS behavior.
function cpGradeWeek(weekEntry, scoreLookupFn, pool){
  let totalPoints=0, possiblePoints=0, anyUngraded=false;
  (weekEntry.games||[]).forEach(g=>{
    possiblePoints+=Number(g.points)||0;
    if(g.result!=null){ if(g.result==="W") totalPoints+=Number(g.pointsEarned)||0; return; }
    const score=scoreLookupFn(g);
    if(!score){ anyUngraded=true; return; }
    if(cpScoring(pool)!=="straight_up" && g.line==null){ anyUngraded=true; return; }
    const result=cpPickResult(pool||{scoring:"ats"},g,score.home_score,score.away_score,g.line);
    if(result==null){ anyUngraded=true; return; }
    g.result=result;
    g.pointsEarned=(result==="W")?(Number(g.points)||0):0;
    if(result==="W") totalPoints+=g.pointsEarned;
  });
  if(!anyUngraded){ weekEntry.totalPoints=totalPoints; weekEntry.possiblePoints=possiblePoints; }
  return {totalPoints, possiblePoints, complete:!anyUngraded};
}

// Season-long total for one entry -- always derived fresh from history,
// never a stored running counter (see the schema comment above for why).
// Only counts weeks that finished grading (totalPoints!=null) so an
// in-progress week's partial/undefined score never silently deflates or
// inflates the season number.
//
// dropLowestWeeks (a real Splash rule -- Drew's actual sheet says "Your 2
// lowest-scoring weeks will be dropped"): a simple, documented
// interpretation -- once N weeks are graded, the `dropLowestWeeks` weeks
// with the lowest totalPoints are excluded from the season sum,
// progressively, as each new week gets graded (not "wait for the full
// season, then drop 2" -- confirm against your actual Splash rules page
// if that distinction matters to you before trusting final standings).
// Ties for "lowest" are broken by history order (earliest archived first)
// purely for determinism; Splash's own tie-break rule (if any) isn't
// known.
function cpSeasonTotal(entry, dropLowestWeeks){
  const graded=((entry&&entry.history)||[]).filter(wk=>wk.totalPoints!=null);
  const drop=Math.max(0, Math.floor(Number(dropLowestWeeks)||0));
  const dropCount=Math.min(drop, graded.length);
  const sortedAscending=graded.slice().sort((a,b)=>(Number(a.totalPoints)||0)-(Number(b.totalPoints)||0));
  const droppedSet=new Set(sortedAscending.slice(0,dropCount));
  let points=0, possible=0, weeksGraded=0, weeksDropped=0;
  graded.forEach(wk=>{
    weeksGraded++;
    if(droppedSet.has(wk)){ weeksDropped++; return; }
    points+=Number(wk.totalPoints)||0;
    possible+=Number(wk.possiblePoints)||0;
  });
  return {points, possible, weeksGraded, weeksDropped};
}

