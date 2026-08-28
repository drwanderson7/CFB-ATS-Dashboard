function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function probabilityFor(matchup) {
  const raw = matchup?.winProbability;
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const p = Number(raw);
  return Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
}



export function bestSelectableSideForTeamWeek(team, matchups, week, usedTeams = new Set()) {
  const weekNumber = Number(week);
  const anchor = matchups.find(matchup =>
    matchup.team === team && Number(matchup.week) === weekNumber
  );
  if (!anchor) return null;

  const sides = matchups
    .filter(matchup =>
      Number(matchup.week) === weekNumber &&
      matchup.gameId === anchor.gameId &&
      !usedTeams.has(matchup.team)
    )
    .map(matchup => ({ matchup, p: probabilityFor(matchup) }))
    .filter(item => item.p !== null)
    .sort((a, b) => b.p - a.p);

  return sides[0] || null;
}

export function sortTeamsByWeekProbability(teams, matchups, week, usedTeams = new Set()) {
  const byTeam = new Map(
    teams.map(team => [
      team,
      bestSelectableSideForTeamWeek(team, matchups, week, usedTeams)?.p ?? null
    ])
  );

  return [...teams].sort((a, b) => {
    const aP = byTeam.get(a) ?? null;
    const bP = byTeam.get(b) ?? null;
    if (aP === null && bP === null) return teams.indexOf(a) - teams.indexOf(b);
    if (aP === null) return 1;
    if (bP === null) return -1;
    if (bP !== aP) return bP - aP;
    return teams.indexOf(a) - teams.indexOf(b);
  });
}

export function futureProfile(team, week, matchups, usedTeams = new Set()) {
  if (usedTeams.has(team)) {
    return { best: null, strongCount: 0, opportunities: [], value: 1 };
  }

  const opportunities = matchups
    .filter(m => m.team === team && m.week > week && !m.completed)
    .map(m => ({ ...m, p: probabilityFor(m) }))
    .filter(m => m.p !== null)
    .sort((a, b) => b.p - a.p);

  const best = opportunities[0]?.p ?? null;
  const strongCount = opportunities.filter(m => m.p >= 0.85).length;
  const eliteCount = opportunities.filter(m => m.p >= 0.92).length;

  // Future value combines peak safety and how many strong future landing spots exist.
  const value = best === null
    ? 0
    : clamp(0.5 * best + 0.35 * clamp(strongCount / 4) + 0.15 * clamp(eliteCount / 2));

  return { best, strongCount, eliteCount, opportunities, value };
}

export function survivorScore(matchup, allMatchups, usedTeams = new Set()) {
  const p = probabilityFor(matchup);
  if (p === null) return null;
  if (usedTeams.has(matchup.team)) return 0;

  const future = futureProfile(matchup.team, matchup.week, allMatchups, usedTeams);

  // Safety stays dominant. Preservation rewards using a team that has less value later.
  const preservation = 1 - future.value;
  return Math.round(clamp(0.9 * p + 0.1 * preservation) * 1000) / 10;
}

export function recommendationLabel(matchup, allMatchups, usedTeams = new Set()) {
  const score = survivorScore(matchup, allMatchups, usedTeams);
  const p = probabilityFor(matchup);
  const future = futureProfile(matchup.team, matchup.week, allMatchups, usedTeams);

  if (usedTeams.has(matchup.team)) return { label: 'Used', tone: 'muted' };
  if (p === null) return { label: 'No model', tone: 'muted' };
  if (p < 0.65) return { label: 'Avoid', tone: 'danger' };
  if (future.value >= 0.78 && p < 0.93) return { label: 'Save', tone: 'warn' };
  if (score >= 88 && p >= 0.88) return { label: 'Top option', tone: 'good' };
  if (score >= 82 && p >= 0.82) return { label: 'Strong', tone: 'good' };
  if (p >= 0.75) return { label: 'Playable', tone: 'neutral' };
  return { label: 'Risky', tone: 'warn' };
}

function weekCandidates(week, matchups, used) {
  return matchups
    .filter(m => m.week === week && !m.completed && !used.has(m.team))
    .map(m => ({ matchup: m, p: probabilityFor(m) }))
    .filter(item => item.p !== null && item.p > 0);
}

function bestCandidatePerTeam(week, matchups, unavailableTeams = new Set()) {
  const byTeam = new Map();
  for (const candidate of weekCandidates(week, matchups, unavailableTeams)) {
    const existing = byTeam.get(candidate.matchup.team);
    if (!existing || candidate.p > existing.p) byTeam.set(candidate.matchup.team, candidate);
  }
  return byTeam;
}

// Exact rectangular assignment solver (Hungarian algorithm, minimization
// form). Rows are weeks. Columns are unique teams plus one private "missing"
// dummy column per week. Because every week owns a dummy, a feasible
// assignment always exists even when model coverage is incomplete.
function solveRectangularAssignment(costMatrix) {
  const rowCount = costMatrix.length;
  if (!rowCount) return [];
  const colCount = costMatrix[0]?.length || 0;
  if (!colCount || rowCount > colCount) throw new Error('Exact assignment requires rows <= columns.');

  const u = new Array(rowCount + 1).fill(0);
  const v = new Array(colCount + 1).fill(0);
  const p = new Array(colCount + 1).fill(0);
  const way = new Array(colCount + 1).fill(0);

  for (let i = 1; i <= rowCount; i += 1) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(colCount + 1).fill(Number.POSITIVE_INFINITY);
    const used = new Array(colCount + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;

      for (let j = 1; j <= colCount; j += 1) {
        if (used[j]) continue;
        const cur = costMatrix[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= colCount; j += 1) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else if (j > 0) {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = new Array(rowCount).fill(-1);
  for (let j = 1; j <= colCount; j += 1) {
    if (p[j] > 0) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

export function buildSeasonPlan(matchups, weeks, alreadyUsed = new Set(), lockedPicks = {}) {
  // Exact maximum-weight assignment across remaining weeks. Each week gets at
  // most one team; each team can appear at most once. Coverage is optimized
  // lexicographically before probability by giving every modeled assignment a
  // bonus larger than the maximum possible log-probability swing across the
  // whole remaining season. Among equally complete paths, maximizing the sum
  // of log(p) is exactly equivalent to maximizing multiplicative survival.
  const futureWeeks = weeks.filter(week => {
    const games = matchups.filter(m => m.week === week);
    return games.some(m => !m.completed);
  });

  const unavailable = new Set(alreadyUsed);
  const picksByWeek = new Map();
  const missingWeeks = [];
  const invalidLockedWeeks = [];
  let logP = 0;
  let modeledWeeks = 0;

  // Reserve every future locked pick before solving earlier open weeks. This
  // prevents the optimizer from using a team in Week 5 if the user has already
  // locked that same team for Week 6.
  for (const week of futureWeeks) {
    const lockedTeam = lockedPicks[String(week)] || lockedPicks[week] || null;
    if (!lockedTeam) continue;

    const lockedMatchup = matchups.find(m => m.team === lockedTeam && m.week === week) || null;
    const p = lockedMatchup ? probabilityFor(lockedMatchup) : null;
    const conflict = unavailable.has(lockedTeam);
    unavailable.add(lockedTeam);

    if (conflict) {
      invalidLockedWeeks.push(week);
      missingWeeks.push(week);
    } else if (p !== null) {
      modeledWeeks += 1;
      logP += Math.log(Math.max(p, 0.0001));
    } else {
      missingWeeks.push(week);
    }

    picksByWeek.set(week, {
      week,
      team: lockedTeam,
      opponent: lockedMatchup?.opponent ?? null,
      p: conflict ? null : p,
      spread: lockedMatchup?.spread ?? null,
      gameId: lockedMatchup?.gameId ?? null,
      probabilitySource: lockedMatchup?.probabilitySource || null,
      probabilitySourceShort: lockedMatchup?.probabilitySourceShort || null,
      locked: true,
      noModel: conflict || p === null,
      conflict
    });
  }

  const unlockedWeeks = futureWeeks.filter(week => !(lockedPicks[String(week)] || lockedPicks[week]));
  const candidatesByWeek = new Map();
  const allTeams = new Set();

  for (const week of unlockedWeeks) {
    const candidates = bestCandidatePerTeam(week, matchups, unavailable);
    candidatesByWeek.set(week, candidates);
    for (const team of candidates.keys()) allTeams.add(team);
  }

  const teamColumns = [...allTeams].sort();
  const teamColumnIndex = new Map(teamColumns.map((team, index) => [team, index]));
  const teamColumnCount = teamColumns.length;

  if (unlockedWeeks.length) {
    const INVALID_COST = 1e9;
    // probabilityFor() is clamped at 0.0001 in the log objective below, so
    // the total log swing is < ~9.22 per modeled week. This bonus therefore
    // makes one additional modeled week dominate every possible probability
    // tradeoff across the full remaining schedule.
    const COVERAGE_BONUS = (futureWeeks.length + 1) * 20;
    const columnCount = teamColumnCount + unlockedWeeks.length;

    const costs = unlockedWeeks.map((week, rowIndex) => {
      const row = new Array(columnCount).fill(INVALID_COST);
      const candidates = candidatesByWeek.get(week) || new Map();
      for (const [team, candidate] of candidates) {
        const column = teamColumnIndex.get(team);
        const weight = COVERAGE_BONUS + Math.log(Math.max(candidate.p, 0.0001));
        row[column] = -weight;
      }
      // Private missing-data/assignment dummy for this week only.
      row[teamColumnCount + rowIndex] = 0;
      return row;
    });

    const assignment = solveRectangularAssignment(costs);

    unlockedWeeks.forEach((week, rowIndex) => {
      const column = assignment[rowIndex];
      const candidates = candidatesByWeek.get(week) || new Map();
      if (column >= 0 && column < teamColumnCount) {
        const team = teamColumns[column];
        const candidate = candidates.get(team);
        if (candidate) {
          modeledWeeks += 1;
          logP += Math.log(Math.max(candidate.p, 0.0001));
          picksByWeek.set(week, {
            week,
            team: candidate.matchup.team,
            opponent: candidate.matchup.opponent,
            p: candidate.p,
            spread: candidate.matchup.spread,
            gameId: candidate.matchup.gameId,
            probabilitySource: candidate.matchup.probabilitySource || null,
            probabilitySourceShort: candidate.matchup.probabilitySourceShort || null
          });
          return;
        }
      }

      missingWeeks.push(week);
      picksByWeek.set(week, { week, skipped: true });
    });
  }

  const requiredWeekCount = futureWeeks.length;
  const uniqueMissingWeeks = [...new Set(missingWeeks)].sort((a, b) => a - b);
  const modeledSurvivalProbability = modeledWeeks ? Math.exp(logP) : null;
  const coverageComplete = requiredWeekCount > 0 &&
    uniqueMissingWeeks.length === 0 &&
    invalidLockedWeeks.length === 0 &&
    modeledWeeks === requiredWeekCount;

  return {
    picks: futureWeeks.map(week => picksByWeek.get(week) || { week, skipped: true }),
    survivalProbability: coverageComplete ? Math.exp(logP) : null,
    modeledSurvivalProbability,
    coverageComplete,
    modeledWeekCount: modeledWeeks,
    requiredWeekCount,
    missingWeeks: uniqueMissingWeeks,
    invalidLockedWeeks: [...new Set(invalidLockedWeeks)].sort((a, b) => a - b),
    optimizer: 'exact-assignment',
    optimality: 'exact'
  };
}

// --- P3: What-if comparison ------------------------------------------------
// "If I use team X this week instead, what does that do to my best remaining
// season?" Reuses buildSeasonPlan itself rather than a separate estimate: for
// each candidate team, lock it in for `week` and let the exact assignment
// solver find the globally optimal path through the rest of the season. That keeps
// the comparison honest — it's not just this week's raw win probability, it's
// "this pick, then optimal play afterward," which is what actually answers
// "should I use my safest team now or save it."
//
// Returns candidates sorted best-to-worst, each with the resulting full
// remaining-season survival probability and how far behind the best option
// they are (`deltaFromBest`, always <= 0; the top entry is 0).
export function compareWhatIf(matchups, weeks, alreadyUsed, week, teams) {
  const weekNumber = Number(week);
  const uniqueTeams = [...new Set(teams)].filter(Boolean);

  const results = uniqueTeams.map(team => {
    const matchup = matchups.find(m => m.team === team && m.week === weekNumber) || null;
    const plan = buildSeasonPlan(matchups, weeks, alreadyUsed, { [weekNumber]: team });
    return {
      team,
      opponent: matchup?.opponent ?? null,
      p: matchup ? probabilityFor(matchup) : null,
      spread: matchup?.spread ?? null,
      survivalProbability: plan.survivalProbability,
      modeledSurvivalProbability: plan.modeledSurvivalProbability,
      coverageComplete: plan.coverageComplete,
      modeledWeekCount: plan.modeledWeekCount,
      requiredWeekCount: plan.requiredWeekCount,
      missingWeeks: plan.missingWeeks,
      remainingPlan: plan.picks
    };
  });

  // Complete paths are comparable as full-season probabilities. Incomplete
  // paths are ordered only for display by coverage then modeled probability,
  // but receive no "vs best" delta because that would imply false precision.
  results.sort((a, b) => {
    if (a.coverageComplete !== b.coverageComplete) return a.coverageComplete ? -1 : 1;
    if (a.modeledWeekCount !== b.modeledWeekCount) return b.modeledWeekCount - a.modeledWeekCount;
    return (b.modeledSurvivalProbability ?? -1) - (a.modeledSurvivalProbability ?? -1);
  });
  const best = results.find(result => result.coverageComplete)?.survivalProbability ?? null;
  return results.map(result => ({
    ...result,
    deltaFromBest: best !== null && result.coverageComplete && result.survivalProbability !== null
      ? result.survivalProbability - best
      : null
  }));
}


// --- P1.2: Strategic recommendation source of truth -----------------------
// Returns the first pick from the same season planner that powers the Season
// Plan view. The current week is intentionally never treated as locked here:
// Best Play should remain model advice even if the user has already made a
// different current-week pick. Picks in other active weeks may remain locked.
//
// This keeps one recommendation source of truth without running a separate
// what-if search for every team just to decide the headline recommendation.
export function buildStrategicRecommendation(matchups, weeks, alreadyUsed = new Set(), week, lockedPicks = {}) {
  const weekNumber = Number(week);
  const locks = Object.fromEntries(Object.entries(lockedPicks || {})
    .filter(([lockedWeek]) => Number(lockedWeek) !== weekNumber));
  const plan = buildSeasonPlan(matchups, weeks, alreadyUsed, locks);
  const recommendation = plan.picks.find(pick => Number(pick.week) === weekNumber && !pick.skipped && pick.team) || null;
  return { ...plan, recommendation };
}

// --- P4: Future-week scarcity -----------------------------------------------
// "How many safe options exist in each future week?" — a week with only one
// or two teams above the safety threshold is a week worth saving a strong
// team for; a week with eight is a week to spend a strong team on, since
// there's no shortage of other safe options that week. This only computes
// and reports the scarcity profile; it is not yet fed into survivorScore()/
// futureProfile()'s weighting (see HANDOFF.md P4 note) — surfacing it to the
// user first, wiring it into the score formula is a deliberate follow-up.

const SCARCITY_THRESHOLD = 0.9;

function scarcityLabel(count) {
  if (count <= 1) return 'Very Hard';
  if (count <= 3) return 'Hard';
  if (count <= 6) return 'Medium';
  return 'Easy';
}

// Per-week count of not-yet-used teams with a win probability at or above
// SCARCITY_THRESHOLD in that week. `weeks` should be the remaining/future
// weeks the caller cares about (e.g. from the current week onward).
export function seasonScarcity(matchups, weeks, usedTeams = new Set(), threshold = SCARCITY_THRESHOLD) {
  return weeks.map(week => {
    const safeCount = matchups.filter(m =>
      m.week === week &&
      !m.completed &&
      !usedTeams.has(m.team) &&
      (probabilityFor(m) ?? -1) >= threshold
    ).length;

    return { week, safeCount, threshold, label: scarcityLabel(safeCount) };
  });
}
// Builds the factual ingredients for the "Why this pick?" UI. This does not
// invent a second recommendation model. Best Play itself now comes from the
// season planner (P1.2); this helper explains that choice using safety, the
// secondary Survivor Score heuristic, future value, what-if context and
// scarcity.
export function buildPickExplanation(matchup, allMatchups, weeks, usedTeams = new Set()) {
  if (!matchup) return null;
  const week = Number(matchup.week);
  const p = probabilityFor(matchup);
  const score = survivorScore(matchup, allMatchups, usedTeams);
  const future = futureProfile(matchup.team, week, allMatchups, usedTeams);

  const available = allMatchups
    .filter(m => Number(m.week) === week && !m.completed && !usedTeams.has(m.team))
    .map(m => ({
      matchup: m,
      p: probabilityFor(m),
      score: survivorScore(m, allMatchups, usedTeams)
    }))
    .filter(item => item.p !== null);

  const bySafety = [...available].sort((a, b) => (b.p ?? -1) - (a.p ?? -1));
  const byScore = [...available].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.p ?? -1) - (a.p ?? -1));
  const safetyRank = Math.max(1, bySafety.findIndex(item => item.matchup.team === matchup.team) + 1);
  const scoreRank = Math.max(1, byScore.findIndex(item => item.matchup.team === matchup.team) + 1);
  const safest = bySafety[0] || null;
  const safestFuture = safest && safest.matchup.team !== matchup.team
    ? futureProfile(safest.matchup.team, week, allMatchups, usedTeams)
    : null;

  // Compare only leading contenders to keep the explanation responsive in
  // the browser. Always include the explained team and the raw safest team.
  const candidateTeams = [];
  const addCandidate = team => {
    if (team && !candidateTeams.includes(team) && candidateTeams.length < 3) candidateTeams.push(team);
  };
  addCandidate(matchup.team);
  byScore.slice(0, 2).forEach(item => addCandidate(item.matchup.team));
  addCandidate(safest?.matchup?.team);

  const comparisons = compareWhatIf(allMatchups, weeks, usedTeams, week, candidateTeams);
  const chosenPath = comparisons.find(result => result.team === matchup.team) || null;
  const pathLeader = comparisons[0] || null;
  const comparableAlternative = comparisons.find(result =>
    result.team !== matchup.team &&
    result.coverageComplete === chosenPath?.coverageComplete &&
    (result.coverageComplete || result.modeledWeekCount === chosenPath?.modeledWeekCount)
  ) || null;

  const usedAfterPick = new Set(usedTeams);
  usedAfterPick.add(matchup.team);
  const futureWeeks = [...new Set(weeks.map(Number))].filter(candidateWeek => candidateWeek > week).sort((a, b) => a - b);
  const scarcity = seasonScarcity(allMatchups, futureWeeks, usedAfterPick);
  const hardestFutureWeek = [...scarcity].sort((a, b) => a.safeCount - b.safeCount || a.week - b.week)[0] || null;

  const chosenPathValue = chosenPath?.coverageComplete
    ? chosenPath.survivalProbability
    : chosenPath?.modeledSurvivalProbability ?? null;
  const alternativePathValue = comparableAlternative?.coverageComplete
    ? comparableAlternative.survivalProbability
    : comparableAlternative?.modeledSurvivalProbability ?? null;
  const leaderPathValue = pathLeader?.coverageComplete
    ? pathLeader.survivalProbability
    : pathLeader?.modeledSurvivalProbability ?? null;

  return {
    team: matchup.team,
    week,
    p,
    score,
    safetyRank,
    scoreRank,
    optionCount: available.length,
    safestTeam: safest?.matchup?.team ?? null,
    safestProbability: safest?.p ?? null,
    safetyGapToSafest: p !== null && safest?.p !== null && safest?.p !== undefined ? p - safest.p : null,
    safestFuture,
    safestFutureBestSpot: safestFuture?.opportunities?.[0] || null,
    future,
    futureBestSpot: future.opportunities?.[0] || null,
    comparisons,
    chosenPath,
    pathLeader,
    comparableAlternative,
    chosenPathValue,
    alternativePathValue,
    leaderPathValue,
    pathAdvantageVsAlternative: chosenPathValue !== null && alternativePathValue !== null
      ? chosenPathValue - alternativePathValue
      : null,
    pathGapToLeader: chosenPathValue !== null && leaderPathValue !== null
      ? chosenPathValue - leaderPathValue
      : null,
    hardestFutureWeek
  };
}

