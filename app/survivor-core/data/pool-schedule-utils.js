// Shared matching engine for "authoritative Splash schedule" style survivor-pool
// allowlists. A pool schedule lists exactly which games are eligible for that
// pool (by week and team pair, transcribed from the pool provider's own
// listing); this matches those slots against CFBD's schedule rows so the
// pool's own eligible-game list drives the board, rather than a naive
// "every game involving a conference member" filter.
//
// Extracted out of data/sec-pool-schedule-2026.js so the same matching logic
// (normalize -> build candidate map -> match -> report missing) isn't
// hand-duplicated in every per-pool schedule file. Each pool still keeps its
// own game list and its own team-name alias map, since the alias needs differ
// per pool (which non-conference opponents each pool's teams play).

function normalizeTeamKey(team, aliases) {
  const raw = String(team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return aliases.get(raw) || raw;
}

export function createScheduleMatcher(aliasEntries = []) {
  const aliases = new Map(aliasEntries);

  function teamScheduleKey(team) {
    return normalizeTeamKey(team, aliases);
  }

  function gameScheduleKey(teamA, teamB) {
    return [teamScheduleKey(teamA), teamScheduleKey(teamB)].sort().join('|');
  }

  function applySchedule(games, schedule) {
    if (!schedule) {
      return {
        games: Array.isArray(games) ? games : [],
        expectedGames: null,
        matchedGames: null,
        missing: [],
        authoritative: false
      };
    }

    const candidates = new Map();
    for (const game of Array.isArray(games) ? games : []) {
      const key = gameScheduleKey(game?.homeTeam, game?.awayTeam);
      if (!key || key === '|') continue;
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(game);
    }

    const matched = [];
    const missing = [];
    for (const slot of schedule) {
      const key = gameScheduleKey(slot.teams[0], slot.teams[1]);
      const options = candidates.get(key) || [];
      const game = options.shift();
      if (!game) {
        missing.push(slot);
        continue;
      }
      matched.push({
        ...game,
        week: slot.week,
        poolWeek: slot.week
      });
    }

    return {
      games: matched,
      expectedGames: schedule.length,
      matchedGames: matched.length,
      missing,
      authoritative: true
    };
  }

  return { teamScheduleKey, gameScheduleKey, applySchedule };
}
