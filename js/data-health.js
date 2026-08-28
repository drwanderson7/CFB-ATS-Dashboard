// Pure data-health helpers for the compact trust strip. This module deliberately
// contains no DOM access so the same calculations can be unit-tested and reused
// if Survivor later moves into PickGauge's shared data layer.

function asFinite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function probabilityCoverageFromMatchups(matchups = []) {
  const total = Array.isArray(matchups) ? matchups.length : 0;
  let modeled = 0;
  const bySource = { direct: 0, sp: 0, line: 0, missing: 0, other: 0 };

  for (const matchup of Array.isArray(matchups) ? matchups : []) {
    const probability = matchup?.winProbability;
    const hasProbability = probability !== null && probability !== undefined && Number.isFinite(Number(probability));
    if (hasProbability) modeled += 1;

    const source = String(matchup?.probabilitySource || '');
    if (!hasProbability) bySource.missing += 1;
    else if (source === 'CFBD pregame WP') bySource.direct += 1;
    else if (source === 'SP+ derived') bySource.sp += 1;
    else if (source === 'Spread derived') bySource.line += 1;
    else bySource.other += 1;
  }

  return { total, modeled, missing: Math.max(0, total - modeled), bySource };
}

function buildDataHealth(data) {
  if (!data) {
    return {
      tone: 'error',
      schedule: { matched: 0, expected: 0, complete: false, label: 'Unavailable' },
      probability: { modeled: 0, total: 0, missing: 0, complete: false, bySource: { direct: 0, sp: 0, line: 0, missing: 0, other: 0 } },
      results: { label: 'Unavailable', live: false },
      updatedAt: null,
      warnings: ['No survivor data is loaded.']
    };
  }

  const expected = data.poolSchedule
    ? asFinite(data.poolSchedule.expectedGames, 0)
    : new Set((data.matchups || []).map(matchup => matchup?.gameId).filter(id => id !== null && id !== undefined)).size;
  const matched = data.poolSchedule
    ? asFinite(data.poolSchedule.matchedGames, 0)
    : expected;
  const scheduleComplete = expected > 0 && matched === expected;

  const fallbackProbability = probabilityCoverageFromMatchups(data.matchups || []);
  const selectableSides = asFinite(data.coverage?.selectableSides, fallbackProbability.total);
  const missingProbability = asFinite(data.coverage?.missingProbability, fallbackProbability.missing);
  const modeled = Math.max(0, selectableSides - missingProbability);
  const bySource = {
    direct: asFinite(data.coverage?.directPregame, fallbackProbability.bySource.direct),
    sp: asFinite(data.coverage?.spDerived, fallbackProbability.bySource.sp),
    line: asFinite(data.coverage?.spreadDerived, fallbackProbability.bySource.line),
    missing: missingProbability,
    other: Math.max(0, modeled
      - asFinite(data.coverage?.directPregame, fallbackProbability.bySource.direct)
      - asFinite(data.coverage?.spDerived, fallbackProbability.bySource.sp)
      - asFinite(data.coverage?.spreadDerived, fallbackProbability.bySource.line))
  };
  const probabilityComplete = selectableSides > 0 && missingProbability === 0;

  const isDemo = Boolean(data.demo);
  const resultSource = String(data.results?.source || '');
  const resultsLive = !isDemo && Boolean(resultSource || data.generatedAt);
  const resultsLabel = isDemo ? 'Demo' : resultsLive ? 'Live' : 'Unknown';

  let tone = 'healthy';
  if (!scheduleComplete) tone = 'error';
  else if (!probabilityComplete) tone = 'warning';
  else if (isDemo) tone = 'demo';
  else if ((data.warnings || []).length) tone = 'warning';

  return {
    tone,
    schedule: {
      matched,
      expected,
      complete: scheduleComplete,
      label: expected ? `${matched}/${expected}` : '—'
    },
    probability: {
      modeled,
      total: selectableSides,
      missing: missingProbability,
      complete: probabilityComplete,
      bySource
    },
    results: { label: resultsLabel, live: resultsLive },
    updatedAt: data.generatedAt || null,
    warnings: Array.isArray(data.warnings) ? [...data.warnings] : [],
    missingGames: Array.isArray(data.poolSchedule?.missingGames) ? [...data.poolSchedule.missingGames] : []
  };
}

export { buildDataHealth, probabilityCoverageFromMatchups };
