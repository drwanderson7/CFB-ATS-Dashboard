// Merge the lightweight results-only API response into the already-loaded
// survivor model without touching probabilities, spreads, planner metadata,
// or the authoritative pool-week mapping. This keeps frequent score polling
// cheap while preserving the full response shape consumed by the UI.

function asNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mergeResultRefresh(data, payload) {
  if (!data || !Array.isArray(data.matchups) || !payload || !Array.isArray(payload.games)) return data;

  const updates = new Map(payload.games
    .map(game => [Number(game?.gameId), game])
    .filter(([gameId]) => Number.isFinite(gameId)));

  let updatedMatchups = 0;
  const matchups = data.matchups.map(matchup => {
    const game = updates.get(Number(matchup?.gameId));
    if (!game) return matchup;

    const isHomeSide = matchup.team === game.homeTeam;
    const isAwaySide = matchup.team === game.awayTeam;
    if (!isHomeSide && !isAwaySide) return matchup;

    updatedMatchups += 1;
    return {
      ...matchup,
      startDate: game.startDate || matchup.startDate || null,
      completed: Boolean(game.completed),
      resultSource: 'CFBD /games',
      teamPoints: asNumberOrNull(isHomeSide ? game.homePoints : game.awayPoints),
      opponentPoints: asNumberOrNull(isHomeSide ? game.awayPoints : game.homePoints)
    };
  });

  const checkedAt = payload.generatedAt || new Date().toISOString();
  return {
    ...data,
    // `generatedAt` remains the latest time any portion of the merged data was
    // refreshed so the compact freshness badge reflects the live result poll.
    generatedAt: checkedAt,
    modelGeneratedAt: data.modelGeneratedAt || data.generatedAt || null,
    matchups,
    results: {
      ...(data.results || {}),
      source: 'CFBD /games',
      lastCheckedAt: checkedAt,
      refreshMode: 'results-only',
      gamesFetched: Number(payload.results?.gamesFetched) || payload.games.length,
      updatedMatchups
    }
  };
}

export { mergeResultRefresh };
