function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

export function probabilityFor(matchup) {
  const raw = matchup?.winProbability;
  if (raw === null || raw === undefined || raw === '' || typeof raw === 'boolean') return null;
  const p = Number(raw);
  return Number.isFinite(p) && p >= 0 && p <= 1 ? p : null;
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



const FUTURE_VALUE_STAR_THRESHOLDS = Object.freeze([
  [0.90, 5],
  [0.82, 4.5],
  [0.74, 4],
  [0.66, 3.5],
  [0.58, 3],
  [0.50, 2.5],
  [0.42, 2],
  [0.34, 1.5],
  [0.26, 1],
  [0, 0.5]
]);

function futureValueLabel(stars) {
  if (stars === null || stars === undefined) return 'No model';
  if (stars >= 5) return 'Elite';
  if (stars >= 4) return 'High';
  if (stars >= 3) return 'Medium';
  if (stars >= 2) return 'Low';
  return 'Minimal';
}

// Compact row-level "Future Value" rating used by the Season Board. This is
// explanatory/display-only and does not alter the exact season optimizer.
// It starts with the existing future-opportunity value (peak safety + depth of
// strong/elite future spots) and can receive a modest upward boost when one of
// those future landing spots is especially scarce. The boost can only add
// value; it never punishes an otherwise strong future schedule.
//
// `currentWeek` is the actual pool week, not the week being viewed/sorted on
// the grid. That keeps the star rating stable while the user researches future
// columns. Used teams are still shown with their underlying "if available"
// future value, but the row's existing USED styling makes them non-actionable.
export function teamFutureValueRating(team, currentWeek, matchups, usedTeams = new Set(), picksPerWeek = 1) {
  const week = Number(currentWeek) || 0;
  const comparisonUsed = new Set(usedTeams);
  comparisonUsed.delete(team);

  const futureGames = matchups.filter(m =>
    m.team === team &&
    Number(m.week) > week &&
    !m.completed
  );

  if (!futureGames.length) {
    return {
      stars: 0.5,
      index: 0,
      label: 'Minimal',
      best: null,
      strongCount: 0,
      eliteCount: 0,
      scarcityCost: 0,
      criticalWeek: null,
      hasModel: true
    };
  }

  const future = futureProfile(team, week, matchups, comparisonUsed);
  if (future.best === null) {
    return {
      stars: null,
      index: null,
      label: 'No model',
      best: null,
      strongCount: 0,
      eliteCount: 0,
      scarcityCost: null,
      criticalWeek: null,
      hasModel: false
    };
  }

  const scarcity = futureScarcityProfile(team, week, matchups, comparisonUsed, picksPerWeek);
  const scarcityBoost = (1 - future.value) * 0.25 * (scarcity.cost ?? 0);
  const index = clamp(future.value + scarcityBoost);
  const stars = FUTURE_VALUE_STAR_THRESHOLDS.find(([threshold]) => index >= threshold)?.[1] ?? 0.5;

  return {
    stars,
    index,
    label: futureValueLabel(stars),
    best: future.best,
    strongCount: future.strongCount,
    eliteCount: future.eliteCount,
    scarcityCost: scarcity.cost,
    criticalWeek: scarcity.criticalWeek,
    hasModel: true
  };
}

export const SURVIVOR_SCORE_WEIGHTS = Object.freeze({
  safety: 0.85,
  preservation: 0.08,
  scarcity: 0.07
});

function scarcityPressure(safeCount, picksPerWeek = 1) {
  const required = Math.max(1, Number(picksPerWeek) || 1);
  const optionsPerRequiredPick = Math.max(0, Number(safeCount) || 0) / required;
  // Eight 90%+ options per required pick is effectively non-scarce. One or
  // fewer is maximally scarce. Keeping this continuous avoids hard score
  // jumps at the display-label boundaries.
  return clamp((8 - optionsPerRequiredPick) / 7);
}

export function futureScarcityProfile(team, week, matchups, usedTeams = new Set(), picksPerWeek = 1, threshold = 0.9) {
  if (usedTeams.has(team)) {
    return { cost: 1, flexibility: 0, criticalWeek: null, opportunities: [] };
  }

  const futureSafeSpots = matchups
    .filter(m => m.team === team && Number(m.week) > Number(week) && !m.completed)
    .map(m => ({ ...m, p: probabilityFor(m) }))
    .filter(m => m.p !== null && m.p >= threshold);

  const opportunities = futureSafeSpots.map(spot => {
    const weekScarcity = seasonScarcity(matchups, [Number(spot.week)], usedTeams, threshold, picksPerWeek)[0];
    return {
      week: Number(spot.week),
      p: spot.p,
      safeCount: weekScarcity?.safeCount ?? 0,
      optionsPerRequiredPick: weekScarcity?.optionsPerRequiredPick ?? 0,
      pressure: weekScarcity?.pressure ?? 1,
      label: weekScarcity?.label ?? 'Very Hard'
    };
  }).sort((a, b) => b.pressure - a.pressure || b.p - a.p || a.week - b.week);

  const criticalWeek = opportunities[0] || null;
  const cost = criticalWeek?.pressure ?? 0;
  return { cost, flexibility: 1 - cost, criticalWeek, opportunities };
}

export function survivorScoreBreakdown(matchup, allMatchups, usedTeams = new Set(), picksPerWeek = 1) {
  const p = probabilityFor(matchup);
  if (p === null) return null;
  if (usedTeams.has(matchup.team)) {
    return {
      score: 0,
      p,
      preservation: 0,
      scarcityFlexibility: 0,
      scarcityCost: 1,
      safetyPoints: 0,
      preservationPoints: 0,
      scarcityPoints: 0,
      scarcity: futureScarcityProfile(matchup.team, matchup.week, allMatchups, usedTeams, picksPerWeek)
    };
  }

  const future = futureProfile(matchup.team, matchup.week, allMatchups, usedTeams);
  const scarcity = futureScarcityProfile(matchup.team, matchup.week, allMatchups, usedTeams, picksPerWeek);
  const preservation = 1 - future.value;
  const scarcityFlexibility = scarcity.flexibility;
  const weighted =
    SURVIVOR_SCORE_WEIGHTS.safety * p +
    SURVIVOR_SCORE_WEIGHTS.preservation * preservation +
    SURVIVOR_SCORE_WEIGHTS.scarcity * scarcityFlexibility;
  const score = Math.round(clamp(weighted) * 1000) / 10;

  return {
    score,
    p,
    preservation,
    scarcityFlexibility,
    scarcityCost: scarcity.cost,
    safetyPoints: SURVIVOR_SCORE_WEIGHTS.safety * p * 100,
    preservationPoints: SURVIVOR_SCORE_WEIGHTS.preservation * preservation * 100,
    scarcityPoints: SURVIVOR_SCORE_WEIGHTS.scarcity * scarcityFlexibility * 100,
    future,
    scarcity
  };
}

export function survivorScore(matchup, allMatchups, usedTeams = new Set(), picksPerWeek = 1) {
  return survivorScoreBreakdown(matchup, allMatchups, usedTeams, picksPerWeek)?.score ?? null;
}

export function recommendationLabel(matchup, allMatchups, usedTeams = new Set(), picksPerWeek = 1) {
  const breakdown = survivorScoreBreakdown(matchup, allMatchups, usedTeams, picksPerWeek);
  const score = breakdown?.score ?? null;
  const p = probabilityFor(matchup);
  const future = futureProfile(matchup.team, matchup.week, allMatchups, usedTeams);

  if (usedTeams.has(matchup.team)) return { label: 'Used', tone: 'muted' };
  if (p === null) return { label: 'No model', tone: 'muted' };
  if (p < 0.65) return { label: 'Avoid', tone: 'danger' };
  if ((breakdown?.scarcityCost ?? 0) >= 0.7 && p < 0.95) return { label: 'Save', tone: 'warn' };
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

function normalizeLockedTeams(value) {
  if (Array.isArray(value)) return [...new Set(value.filter(Boolean))];
  return value ? [value] : [];
}

function addFlowEdge(graph, from, to, cap, cost, meta = null) {
  const forward = { to, rev: graph[to].length, cap, cost, initialCap: cap, meta };
  const reverse = { to: from, rev: graph[from].length, cap: 0, cost: -cost, initialCap: 0, meta: null };
  graph[from].push(forward);
  graph[to].push(reverse);
  return forward;
}

// Successive shortest augmenting path with Bellman-Ford. The graph is small
// (<=13 week nodes, a few hundred week-game nodes, ~120 team nodes, <=26
// units of flow for Kelly), so this exact solver stays fast while supporting
// constraints a simple assignment matrix cannot express:
//   - N picks per week
//   - each team used once globally
//   - at most one side from the same game in a week
//   - missing-model slots allowed but always lower priority than modeled picks.
function minCostMaxFlow(graph, source, sink, requestedFlow) {
  let flow = 0;
  let cost = 0;
  const nodeCount = graph.length;

  while (flow < requestedFlow) {
    const dist = new Array(nodeCount).fill(Number.POSITIVE_INFINITY);
    const prevNode = new Array(nodeCount).fill(-1);
    const prevEdge = new Array(nodeCount).fill(-1);
    dist[source] = 0;

    for (let pass = 0; pass < nodeCount - 1; pass += 1) {
      let changed = false;
      for (let u = 0; u < nodeCount; u += 1) {
        if (!Number.isFinite(dist[u])) continue;
        for (let ei = 0; ei < graph[u].length; ei += 1) {
          const edge = graph[u][ei];
          if (edge.cap <= 0) continue;
          const next = dist[u] + edge.cost;
          if (next + 1e-12 < dist[edge.to]) {
            dist[edge.to] = next;
            prevNode[edge.to] = u;
            prevEdge[edge.to] = ei;
            changed = true;
          }
        }
      }
      if (!changed) break;
    }

    if (!Number.isFinite(dist[sink])) break;

    let augment = requestedFlow - flow;
    for (let v = sink; v !== source; v = prevNode[v]) {
      if (prevNode[v] < 0) { augment = 0; break; }
      augment = Math.min(augment, graph[prevNode[v]][prevEdge[v]].cap);
    }
    if (!augment) break;

    for (let v = sink; v !== source; v = prevNode[v]) {
      const u = prevNode[v];
      const edge = graph[u][prevEdge[v]];
      edge.cap -= augment;
      graph[v][edge.rev].cap += augment;
    }

    flow += augment;
    cost += dist[sink] * augment;
  }

  return { flow, cost };
}

export function buildSeasonPlan(matchups, weeks, alreadyUsed = new Set(), lockedPicks = {}, picksPerWeek = 1) {
  const requiredPerWeek = Math.max(1, Number(picksPerWeek) || 1);
  const futureWeeks = weeks.filter(week => {
    const games = matchups.filter(m => m.week === week);
    return games.some(m => !m.completed);
  });

  const unavailable = new Set(alreadyUsed);
  const picksByWeek = new Map(futureWeeks.map(week => [week, []]));
  const reservedGamesByWeek = new Map(futureWeeks.map(week => [week, new Set()]));
  const missingWeeks = [];
  const invalidLockedWeeks = [];
  let logP = 0;
  let modeledPickCount = 0;

  // Reserve every locked pick before optimizing open slots. A locked pick
  // consumes one of the week's required slots even if its probability is
  // unavailable or it conflicts with another lock; that keeps the plan honest
  // about the user's actual card rather than silently replacing a bad lock.
  for (const week of futureWeeks) {
    const locks = normalizeLockedTeams(lockedPicks[String(week)] ?? lockedPicks[week]).slice(0, requiredPerWeek);
    const weekPicks = picksByWeek.get(week);
    const reservedGames = reservedGamesByWeek.get(week);

    locks.forEach((lockedTeam, index) => {
      const lockedMatchup = matchups.find(m => m.team === lockedTeam && m.week === week) || null;
      const p = lockedMatchup ? probabilityFor(lockedMatchup) : null;
      const gameKey = lockedMatchup?.gameId ?? null;
      const teamConflict = unavailable.has(lockedTeam);
      const gameConflict = gameKey !== null && reservedGames.has(gameKey);
      const conflict = teamConflict || gameConflict;

      unavailable.add(lockedTeam);
      if (gameKey !== null) reservedGames.add(gameKey);

      if (conflict) {
        invalidLockedWeeks.push(week);
      } else if (p !== null) {
        modeledPickCount += 1;
        logP += Math.log(Math.max(p, 0.0001));
      }

      weekPicks.push({
        week,
        slot: index + 1,
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
    });
  }

  const openSlotsByWeek = new Map();
  for (const week of futureWeeks) {
    const lockedCount = picksByWeek.get(week).length;
    openSlotsByWeek.set(week, Math.max(0, requiredPerWeek - lockedCount));
  }

  const totalOpenSlots = [...openSlotsByWeek.values()].reduce((sum, count) => sum + count, 0);
  const candidateEdges = [];

  if (totalOpenSlots > 0) {
    const candidateByWeekGame = new Map();
    const allTeams = new Set();

    for (const week of futureWeeks) {
      if (!openSlotsByWeek.get(week)) continue;
      const reservedGames = reservedGamesByWeek.get(week);
      for (const candidate of weekCandidates(week, matchups, unavailable)) {
        const gameId = candidate.matchup.gameId;
        if (gameId !== null && gameId !== undefined && reservedGames.has(gameId)) continue;
        const gameKey = `${week}|${gameId ?? [candidate.matchup.team, candidate.matchup.opponent].sort().join('|')}`;
        if (!candidateByWeekGame.has(gameKey)) candidateByWeekGame.set(gameKey, []);
        candidateByWeekGame.get(gameKey).push(candidate);
        allTeams.add(candidate.matchup.team);
      }
    }

    const weekNodes = new Map();
    const gameNodes = new Map();
    const teamNodes = new Map();
    let nextNode = 1; // 0 is source
    for (const week of futureWeeks) {
      if (openSlotsByWeek.get(week)) weekNodes.set(week, nextNode++);
    }
    for (const gameKey of candidateByWeekGame.keys()) gameNodes.set(gameKey, nextNode++);
    for (const team of [...allTeams].sort()) teamNodes.set(team, nextNode++);
    const sink = nextNode++;
    const graph = Array.from({ length: nextNode }, () => []);
    const source = 0;

    // The bonus dominates every possible probability tradeoff, making the
    // objective lexicographic: maximize modeled pick slots first, then maximize
    // sum(log p), which is equivalent to maximizing full-path survival.
    const requiredPickCount = futureWeeks.length * requiredPerWeek;
    const COVERAGE_BONUS = (requiredPickCount + 1) * 20;

    for (const [week, weekNode] of weekNodes) {
      const slots = openSlotsByWeek.get(week);
      addFlowEdge(graph, source, weekNode, slots, 0);
      // Missing-model fallback. Real candidate paths have negative total cost
      // because of COVERAGE_BONUS, so this is used only when constraints make a
      // modeled assignment impossible.
      addFlowEdge(graph, weekNode, sink, slots, 0, { type: 'missing', week });
    }

    for (const [gameKey, candidates] of candidateByWeekGame) {
      const [weekText] = gameKey.split('|');
      const week = Number(weekText);
      const weekNode = weekNodes.get(week);
      const gameNode = gameNodes.get(gameKey);
      addFlowEdge(graph, weekNode, gameNode, 1, 0);

      for (const candidate of candidates) {
        const teamNode = teamNodes.get(candidate.matchup.team);
        const weight = COVERAGE_BONUS + Math.log(Math.max(candidate.p, 0.0001));
        const edge = addFlowEdge(graph, gameNode, teamNode, 1, -weight, {
          type: 'candidate',
          week,
          matchup: candidate.matchup,
          p: candidate.p
        });
        candidateEdges.push(edge);
      }
    }

    for (const teamNode of teamNodes.values()) addFlowEdge(graph, teamNode, sink, 1, 0);

    minCostMaxFlow(graph, source, sink, totalOpenSlots);

    const selectedByWeek = new Map(futureWeeks.map(week => [week, []]));
    for (const edge of candidateEdges) {
      if (edge.initialCap === 1 && edge.cap === 0 && edge.meta?.type === 'candidate') {
        selectedByWeek.get(edge.meta.week).push(edge.meta);
      }
    }

    for (const week of futureWeeks) {
      const weekPicks = picksByWeek.get(week);
      const selected = selectedByWeek.get(week)
        .sort((a, b) => b.p - a.p || a.matchup.team.localeCompare(b.matchup.team));
      for (const item of selected) {
        modeledPickCount += 1;
        logP += Math.log(Math.max(item.p, 0.0001));
        weekPicks.push({
          week,
          slot: weekPicks.length + 1,
          team: item.matchup.team,
          opponent: item.matchup.opponent,
          p: item.p,
          spread: item.matchup.spread,
          gameId: item.matchup.gameId,
          probabilitySource: item.matchup.probabilitySource || null,
          probabilitySourceShort: item.matchup.probabilitySourceShort || null
        });
      }

      while (weekPicks.length < requiredPerWeek) {
        weekPicks.push({ week, slot: weekPicks.length + 1, skipped: true });
      }
    }
  }

  // If there were no open slots, locked picks may still need skipped
  // placeholders so every week exposes exactly `picksPerWeek` planner slots.
  for (const week of futureWeeks) {
    const weekPicks = picksByWeek.get(week);
    while (weekPicks.length < requiredPerWeek) {
      weekPicks.push({ week, slot: weekPicks.length + 1, skipped: true });
    }
    const modeledInWeek = weekPicks.filter(pick => !pick.skipped && !pick.conflict && pick.p !== null && pick.p !== undefined).length;
    if (modeledInWeek < requiredPerWeek) missingWeeks.push(week);
  }

  const picks = futureWeeks
    .flatMap(week => picksByWeek.get(week))
    .sort((a, b) => a.week - b.week || (a.slot || 0) - (b.slot || 0));

  const requiredWeekCount = futureWeeks.length;
  const requiredPickCount = requiredWeekCount * requiredPerWeek;
  const uniqueMissingWeeks = [...new Set(missingWeeks)].sort((a, b) => a - b);
  const modeledWeekCount = futureWeeks.filter(week =>
    picksByWeek.get(week).filter(pick => !pick.skipped && !pick.conflict && pick.p !== null && pick.p !== undefined).length >= requiredPerWeek
  ).length;
  const modeledSurvivalProbability = modeledPickCount ? Math.exp(logP) : null;
  const coverageComplete = requiredPickCount > 0 &&
    modeledPickCount === requiredPickCount &&
    uniqueMissingWeeks.length === 0 &&
    invalidLockedWeeks.length === 0;

  return {
    picks,
    survivalProbability: coverageComplete ? Math.exp(logP) : null,
    modeledSurvivalProbability,
    coverageComplete,
    modeledWeekCount,
    requiredWeekCount,
    modeledPickCount,
    requiredPickCount,
    picksPerWeek: requiredPerWeek,
    missingPickCount: Math.max(0, requiredPickCount - modeledPickCount),
    missingWeeks: uniqueMissingWeeks,
    invalidLockedWeeks: [...new Set(invalidLockedWeeks)].sort((a, b) => a - b),
    optimizer: 'exact-assignment',
    optimality: 'exact'
  };
}

// --- P3: What-if comparison ------------------------------------------------
// For multi-pick pools, a candidate is locked as one of the week's required
// selections and the exact solver fills every remaining slot optimally.
export function compareWhatIf(matchups, weeks, alreadyUsed, week, teams, picksPerWeek = 1) {
  const weekNumber = Number(week);
  const uniqueTeams = [...new Set(teams)].filter(Boolean);

  const results = uniqueTeams.map(team => {
    const matchup = matchups.find(m => m.team === team && m.week === weekNumber) || null;
    const plan = buildSeasonPlan(matchups, weeks, alreadyUsed, { [weekNumber]: [team] }, picksPerWeek);
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
      modeledPickCount: plan.modeledPickCount,
      requiredPickCount: plan.requiredPickCount,
      missingWeeks: plan.missingWeeks,
      remainingPlan: plan.picks
    };
  });

  results.sort((a, b) => {
    if (a.coverageComplete !== b.coverageComplete) return a.coverageComplete ? -1 : 1;
    if (a.modeledPickCount !== b.modeledPickCount) return b.modeledPickCount - a.modeledPickCount;
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

// Strategic recommendation source of truth. For a 2-pick pool this returns
// both teams in `recommendations`; `recommendation` remains the first team for
// backward compatibility with single-pick UI/helpers.
export function buildStrategicRecommendation(matchups, weeks, alreadyUsed = new Set(), week, lockedPicks = {}, picksPerWeek = 1) {
  const weekNumber = Number(week);
  const locks = Object.fromEntries(Object.entries(lockedPicks || {})
    .filter(([lockedWeek]) => Number(lockedWeek) !== weekNumber));
  const plan = buildSeasonPlan(matchups, weeks, alreadyUsed, locks, picksPerWeek);
  const recommendations = plan.picks
    .filter(pick => Number(pick.week) === weekNumber && !pick.skipped && pick.team)
    .slice(0, Math.max(1, Number(picksPerWeek) || 1));
  return { ...plan, recommendation: recommendations[0] || null, recommendations };
}

// --- P4: Future-week scarcity -----------------------------------------------
// "How many safe options exist in each future week?" — a week with only one
// or two teams above the safety threshold is a week worth saving a strong
// team for; a week with eight is a week to spend a strong team on. As of
// v1.23.1 scarcity is also an explicit, modest Survivor Score input. The exact
// season optimizer still maximizes path survival probability directly, so the
// heuristic scarcity term does not distort its core objective.

const SCARCITY_THRESHOLD = 0.9;

function scarcityLabel(count, picksPerWeek = 1) {
  const required = Math.max(1, Number(picksPerWeek) || 1);
  const optionsPerRequiredPick = count / required;
  if (optionsPerRequiredPick <= 1) return 'Very Hard';
  if (optionsPerRequiredPick <= 3) return 'Hard';
  if (optionsPerRequiredPick <= 6) return 'Medium';
  return 'Easy';
}

// Per-week count of not-yet-used teams with a win probability at or above
// SCARCITY_THRESHOLD in that week. `weeks` should be the remaining/future
// weeks the caller cares about (e.g. from the current week onward).
export function seasonScarcity(matchups, weeks, usedTeams = new Set(), threshold = SCARCITY_THRESHOLD, picksPerWeek = 1) {
  const required = Math.max(1, Number(picksPerWeek) || 1);
  return weeks.map(week => {
    const safeCount = matchups.filter(m =>
      Number(m.week) === Number(week) &&
      !m.completed &&
      !usedTeams.has(m.team) &&
      (probabilityFor(m) ?? -1) >= threshold
    ).length;
    const optionsPerRequiredPick = safeCount / required;
    const pressure = scarcityPressure(safeCount, required);

    return {
      week: Number(week),
      safeCount,
      threshold,
      picksPerWeek: required,
      optionsPerRequiredPick,
      pressure,
      label: scarcityLabel(safeCount, required)
    };
  });
}
// Builds the factual ingredients for the "Why this pick?" UI. This does not
// invent a second recommendation model. Best Play itself now comes from the
// season planner (P1.2); this helper explains that choice using safety, the
// secondary Survivor Score heuristic, future value, what-if context and
// scarcity.
export function buildPickExplanation(matchup, allMatchups, weeks, usedTeams = new Set(), picksPerWeek = 1) {
  if (!matchup) return null;
  const week = Number(matchup.week);
  const p = probabilityFor(matchup);
  const scoreBreakdown = survivorScoreBreakdown(matchup, allMatchups, usedTeams, picksPerWeek);
  const score = scoreBreakdown?.score ?? null;
  const future = futureProfile(matchup.team, week, allMatchups, usedTeams);

  const available = allMatchups
    .filter(m => Number(m.week) === week && !m.completed && !usedTeams.has(m.team))
    .map(m => ({
      matchup: m,
      p: probabilityFor(m),
      score: survivorScore(m, allMatchups, usedTeams, picksPerWeek)
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

  const comparisons = compareWhatIf(allMatchups, weeks, usedTeams, week, candidateTeams, picksPerWeek);
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
  const scarcity = seasonScarcity(allMatchups, futureWeeks, usedAfterPick, SCARCITY_THRESHOLD, picksPerWeek);
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
    scoreBreakdown,
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

