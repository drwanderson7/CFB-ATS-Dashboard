// ---------------------------------------------------------------------------
// Confidence pools -- Sept 2, 2026, Drew's explicit request, built as its own
// dedicated module (mirrors why Survivor got its own module instead of being
// folded into ATS pools).
//
// CORRECTION (same day, after seeing Drew's real Splash sheet -- "Grundy's
// Gang" Team Pickem, Week 1 2026): this is confidence AGAINST THE SPREAD,
// not straight-up. Every game on a real Splash confidence sheet shows a
// line (e.g. "Colorado +6.5" / "Georgia Tech -6.5"), and grading is exactly
// the same cover-margin math this app's ATS pools already use --
// api/grade_picks.py's grade(picked_score, opp_score, line). The first
// version of this file graded straight-up (winner only, no line at all in
// the math); that was wrong for Drew's actual contest and has been
// replaced below. A pick's `line` field is now REQUIRED and drives grading
// directly -- it is NOT the same "reference only" Vegas/Model#/Edge display
// Drew asked to keep separate from grading (that's still true -- Model #/
// Edge remain reference-only for deciding WHICH games to rank highly; the
// `line` here is the actual contest number a pick is graded against, the
// same role a `line` plays for a normal ATS pool pick).
//
// This file holds every pure function (no DOM, no `state` global mutation
// beyond what's passed in) so the actual math is unit-testable in
// isolation; DOM rendering and wiring live in confidence-integration.js.
//
// SCHEMA (state.confidencePools -- see main.js's normalizeState()):
//
// state.confidencePools = [{
//   id, name, createdAt,
//   pickCount: null | number,   // null = "rank every game this week" (the
//                                // default Drew asked for); a number N means
//                                // pick exactly N of the available games,
//                                // point values then run 1..N (Drew's
//                                // explicit call -- NOT 1..totalGames with
//                                // gaps).
//   dropLowestWeeks: null | number, // Drew's real Splash sheet: "Your 2
//                                // lowest-scoring weeks will be dropped."
//                                // A per-pool setting since this varies by
//                                // contest, not a hardcoded 2. null/0 = no
//                                // drop. See cpSeasonTotal() below for how
//                                // this is applied (a documented, simple
//                                // interpretation -- confirm against your
//                                // actual Splash rules page if it matters
//                                // before the season's final standings).
//   weekLabel: string,           // set at creation/import time, shown in UI
//   archived: bool,
//   games: [{                    // CURRENT week's active slate only -- same
//                                 // lifecycle as an ATS pool's own
//                                 // `pool.games` (see pool-contexts.js's
//                                 // mergePoolLines()/archivePoolCurrentWeek()):
//                                 // lives here while the week is open,
//                                 // archived into each entry's history when
//                                 // the week closes, then replaced for the
//                                 // next week.
//     key,                       // mkey(away,home) -- same join key format
//                                 // used everywhere else in the app
//     away, home, commence,
//     providerGameId,            // Odds API id, when added from the live
//                                 // board -- carried through so grading can
//                                 // eventually resolve identity the same way
//                                 // ATS picks do
//     cfbdGameId, cfbdSeason, cfbdHomeTeamId, cfbdAwayTeamId, // filled at
//                                 // archive time when resolvable, for
//                                 // canonical-identity grading (see
//                                 // cfbPickIdentity() in picks.js for the
//                                 // ATS-pick equivalent)
//     line,                      // REQUIRED for grading. Home-team-
//                                 // perspective spread, same sign
//                                 // convention as every ATS pool/pick in
//                                 // this app. Prefilled from the live
//                                 // board's Vegas number when added from
//                                 // there, but always editable -- must
//                                 // match whatever the real Splash sheet
//                                 // actually shows, which can differ from
//                                 // today's live market by the time you're
//                                 // entering picks.
//   }],
//   entries: [{
//     id, name,
//     picks: {},                 // gameKey -> {team:"home"|"away", points:N}
//                                 // -- CURRENT week only, mirrors ATS entry
//                                 // picks shape
//     history: [{                // one entry per archived (closed) week
//       week, season, weekLabel, archivedAt,
//       games: [{                // frozen picks + frozen game identity +
//                                 // frozen line, same "freeze now, grade
//                                 // later" pattern closeWeek() already
//                                 // uses for ATS picks
//         key, away, home, line,
//         cfbdGameId, cfbdSeason, cfbdHomeTeamId, cfbdAwayTeamId,
//         providerGameId,
//         team,                  // the side this entry picked ("home"/"away")
//         points,                // the point value assigned
//         result: null,          // filled by grading: "W" | "L" | "P" --
//                                 // same vocabulary as every ATS pick's
//                                 // result in this app, on purpose (it's
//                                 // the exact same cover-margin grade)
//         pointsEarned: null,    // filled by grading: points if "W", else 0
//                                 // (a push earns 0, same as a straight
//                                 // loss, but is NOT a loss -- see
//                                 // cpAtsResult() below)
//       }],
//       totalPoints: null,       // filled by grading: sum of pointsEarned
//       possiblePoints: null,    // sum of every picked game's points value,
//                                // regardless of outcome -- the ceiling this
//                                // week could have scored
//     }],
//   }],
// }]
//
// Season-long totals (multiple pools "running all season", per Drew's
// explicit call) are deliberately NOT a separate mutable running counter --
// they're always derived by summing entry.history[].totalPoints, the same
// "history is the one source of truth, never a hand-incremented tally"
// principle the rest of the app already follows (e.g. Survivor's season
// record, My Numbers' aggregate stats). See cpSeasonTotal() below.
// ---------------------------------------------------------------------------

// The point-value ceiling for a pool's CURRENT week: Drew's explicit rule --
// pickCount unset means "every game on the slate", pickCount set means
// points run 1..pickCount (not 1..totalGames with gaps).
function cpMaxPoints(pool){
  const n=pool&&pool.pickCount;
  if(n==null || n==="") return (pool&&Array.isArray(pool.games))?pool.games.length:0;
  const num=Number(n);
  return (isNaN(num)||num<0)?0:Math.floor(num);
}

// How many games this entry is actually required to pick this week --
// same number as cpMaxPoints() (every picked game gets a point value, and
// every point value 1..N must be used exactly once), kept as a separate
// named function since "how many picks are required" and "what's the top
// point value" are conceptually different questions that happen to share a
// number, and a future rule change (e.g. allowing pickCount picks without
// requiring literally every value 1..N be used) would only need one of
// these to change.
function cpRequiredPickCount(pool){ return cpMaxPoints(pool); }

// Every point value an entry currently has assigned, across its CURRENT
// (unarchived) picks for this pool's active game list only -- an entry's
// `picks` map is never pruned when a game leaves the active list (e.g. a
// game gets removed before anyone picked it), so this filters to games
// still actually on the pool's current slate.
function cpUsedPointValues(pool, entry){
  const validKeys=new Set((pool.games||[]).map(g=>g.key));
  const vals=[];
  Object.keys((entry&&entry.picks)||{}).forEach(k=>{
    if(!validKeys.has(k)) return;
    const p=entry.picks[k];
    if(p&&p.points!=null&&p.points!=="") vals.push(Number(p.points));
  });
  return vals;
}

// Validates one entry's current picks for a pool against Drew's explicit
// rules: every assigned point value must be a whole number in [1, maxPoints];
// no two games may share the same point value; and -- only when checking
// readiness for archiving, not on every keystroke -- every required pick
// slot must actually be filled. Returns {valid, errors: string[]}. Called
// both for live inline validation (requireComplete=false, so a
// half-filled-in week doesn't show a wall of "missing pick" errors while
// someone's still working through it) and before closing a week
// (requireComplete=true).
function cpValidatePicks(pool, entry, requireComplete){
  const errors=[];
  const maxPoints=cpMaxPoints(pool);
  const required=cpRequiredPickCount(pool);
  const games=pool.games||[];
  const picks=(entry&&entry.picks)||{};
  const validKeys=new Set(games.map(g=>g.key));

  const seenPoints=new Map(); // point value -> [gameKey,...] that used it
  let pickedCount=0;
  games.forEach(g=>{
    const p=picks[g.key];
    if(!p||p.team==null||p.points==null||p.points==="") return;
    pickedCount++;
    if(p.team!=="home"&&p.team!=="away"){
      errors.push(`${g.away} @ ${g.home}: pick must be the home or away team.`);
      return;
    }
    const pts=Number(p.points);
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
    if(matchups.length>1){
      errors.push(`${pts} points is assigned to more than one game: ${matchups.join(" / ")}.`);
    }
  });
  // Stale picks pointing at a game no longer on the pool's active slate --
  // surfaced so a removed/replaced game doesn't silently strand a used
  // point value the person can't see or free up.
  Object.keys(picks).forEach(k=>{
    if(!validKeys.has(k)) errors.push(`A pick is assigned to a game that's no longer on this week's slate -- remove it to free up its point value.`);
  });
  // A game missing its line can't be graded later no matter how the picks
  // shake out -- flagged now (both live and on close) rather than
  // discovered only once grading silently can't resolve it.
  games.forEach(g=>{
    if(g.line==null||g.line===""){
      errors.push(`${g.away} @ ${g.home}: no line set -- required to grade this pick against the spread.`);
    }
  });
  if(requireComplete && pickedCount<required){
    errors.push(`${pickedCount} of ${required} required picks made.`);
  }
  return {valid:errors.length===0, errors, pickedCount, required, maxPoints};
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

// Grades one archived week's games in place for one entry (mutates the
// `games` array's result/pointsEarned fields, matching the mutate-in-place
// pattern api/grade_picks.py already uses for ATS picks). `scoreLookupFn
// (gameEntry)` must return {home_score, away_score} or null -- kept as an
// injected function rather than this file reaching for CFBD/Odds data
// directly, so the exact same grading math runs identically client-side
// (for an instant local preview) and server-side in
// api/grade_picks.py's Python port of this same logic (see
// _grade_confidence_pools() there) without either copy needing to know
// where scores actually come from.
//
// A push (an exact tie against the spread) earns 0 points and counts as
// neither a win nor a loss, same treatment every ATS "P" result gets
// elsewhere in this app.
function cpGradeWeek(weekEntry, scoreLookupFn){
  let totalPoints=0, possiblePoints=0, anyUngraded=false;
  (weekEntry.games||[]).forEach(g=>{
    possiblePoints+=Number(g.points)||0;
    if(g.result!=null){ if(g.result==="W") totalPoints+=Number(g.pointsEarned)||0; return; } // already graded
    const score=scoreLookupFn(g);
    if(!score || g.line==null){ anyUngraded=true; return; }
    const result=cpAtsResult(g, score.home_score, score.away_score, g.line);
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

