const DEFAULT_WEEK_GRACE_HOURS = 30;

function asTime(value) {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function uniqueGamesForWeek(matchups, week) {
  const seen = new Set();
  const games = [];
  for (const matchup of Array.isArray(matchups) ? matchups : []) {
    if (Number(matchup?.week) !== Number(week)) continue;
    const gameId = Number(matchup?.gameId);
    const key = Number.isFinite(gameId)
      ? `id:${gameId}`
      : `fallback:${week}:${matchup?.startDate || ''}:${[matchup?.team, matchup?.opponent].filter(Boolean).sort().join('|')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    games.push(matchup);
  }
  return games;
}

export function weekLifecycle(matchups, week, nowMs = Date.now(), graceHours = DEFAULT_WEEK_GRACE_HOURS) {
  const games = uniqueGamesForWeek(matchups, week);
  const starts = games.map(game => asTime(game.startDate)).filter(time => time !== null).sort((a, b) => a - b);
  const earliestStart = starts.length ? starts[0] : null;
  const latestStart = starts.length ? starts[starts.length - 1] : null;
  const completedCount = games.filter(game => Boolean(game.completed)).length;
  const allCompleted = games.length > 0 && completedCount === games.length;
  const graceMs = Math.max(0, Number(graceHours) || 0) * 60 * 60 * 1000;
  const staleAfter = latestStart === null ? null : latestStart + graceMs;
  const staleIncomplete = !allCompleted && staleAfter !== null && nowMs > staleAfter;

  let state = 'unknown';
  if (!games.length) state = 'empty';
  else if (allCompleted) state = 'complete';
  else if (earliestStart !== null && nowMs < earliestStart) state = 'upcoming';
  else if (staleIncomplete) state = 'stale-incomplete';
  else if (earliestStart !== null && nowMs >= earliestStart) state = 'active';

  return {
    week: Number(week),
    games: games.length,
    completedCount,
    allCompleted,
    earliestStart,
    latestStart,
    staleAfter,
    staleIncomplete,
    state
  };
}

// Picks the pool week the user should naturally land on. Completed weeks
// advance immediately. An old postponed/canceled game cannot strand the app
// forever: once the week's normal kickoff window is > graceHours old, the
// scheduler advances to the next listed pool week even if CFBD still reports
// one stale game as incomplete. If CFBD moves the game's startDate, the window
// moves with it automatically.
export function deriveCurrentPoolWeek(matchups, weeks, nowMs = Date.now(), graceHours = DEFAULT_WEEK_GRACE_HOURS) {
  const orderedWeeks = [...new Set((Array.isArray(weeks) ? weeks : []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!orderedWeeks.length) return 1;

  let undatedFallback = null;
  for (const week of orderedWeeks) {
    const life = weekLifecycle(matchups, week, nowMs, graceHours);
    if (life.state === 'empty' || life.state === 'complete' || life.state === 'stale-incomplete') continue;
    if (life.earliestStart === null) {
      undatedFallback ??= week;
      continue;
    }
    if (life.state === 'upcoming' || life.state === 'active') return week;
  }

  if (undatedFallback !== null) return undatedFallback;
  return orderedWeeks[orderedWeeks.length - 1];
}

export function pickResultFor(matchups, week, team, nowMs = Date.now()) {
  const matchup = (Array.isArray(matchups) ? matchups : []).find(item =>
    Number(item?.week) === Number(week) && item?.team === team
  );
  if (!matchup) return { status: 'data-issue', week: Number(week), team, matchup: null, label: 'Data issue · matchup unavailable' };

  const teamPoints = matchup.teamPoints === null || matchup.teamPoints === undefined ? null : Number(matchup.teamPoints);
  const opponentPoints = matchup.opponentPoints === null || matchup.opponentPoints === undefined ? null : Number(matchup.opponentPoints);
  const hasScore = Number.isFinite(teamPoints) && Number.isFinite(opponentPoints);

  if (matchup.completed && hasScore) {
    const status = teamPoints > opponentPoints ? 'win' : teamPoints < opponentPoints ? 'loss' : 'tie';
    return {
      status,
      week: Number(week),
      team,
      matchup,
      teamPoints,
      opponentPoints,
      label: `${status === 'win' ? 'W' : status === 'loss' ? 'L' : 'T'} ${teamPoints}–${opponentPoints}`
    };
  }

  const start = asTime(matchup.startDate);
  if (start !== null && nowMs >= start) {
    return { status: 'awaiting', week: Number(week), team, matchup, label: 'Awaiting final' };
  }
  return { status: 'upcoming', week: Number(week), team, matchup, label: 'Upcoming' };
}

export function evaluateEntryStatus(matchups, picks, weeks, currentWeek, nowMs = Date.now(), graceHours = DEFAULT_WEEK_GRACE_HOURS) {
  const normalizedPicks = picks && typeof picks === 'object' ? picks : {};
  const orderedWeeks = [...new Set((Array.isArray(weeks) ? weeks : []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  const results = Object.entries(normalizedPicks)
    .map(([week, team]) => pickResultFor(matchups, Number(week), team, nowMs))
    .sort((a, b) => a.week - b.week);

  const wins = results.filter(result => result.status === 'win').length;
  const losses = results.filter(result => result.status === 'loss').length;
  const ties = results.filter(result => result.status === 'tie').length;
  const dataIssueResults = results.filter(result => result.status === 'data-issue');
  const dataIssueWeeks = dataIssueResults.map(result => result.week);
  const loss = results.find(result => result.status === 'loss') || null;
  const currentWeekNumber = Number(currentWeek);
  const currentPickTeam = normalizedPicks[String(currentWeekNumber)] || normalizedPicks[currentWeekNumber] || null;
  const currentPickResult = results.find(result => result.week === currentWeekNumber) || null;
  const currentLifecycle = weekLifecycle(matchups, currentWeekNumber, nowMs, graceHours);

  // A completed/stale listed week with no saved pick is a real historical gap,
  // including the final week of the season. The old `< currentWeek` rule could
  // miss a Week 13 omission because deriveCurrentPoolWeek() intentionally
  // returns the final listed week once the season is over.
  const missingPastWeeks = orderedWeeks.filter(week => {
    if (normalizedPicks[String(week)] || normalizedPicks[week]) return false;
    const life = weekLifecycle(matchups, week, nowMs, graceHours);
    return life.state === 'complete' || life.state === 'stale-incomplete';
  });

  const weekLifecycles = orderedWeeks.map(week => weekLifecycle(matchups, week, nowMs, graceHours));
  const allWeeksComplete = orderedWeeks.length > 0 && weekLifecycles.every(life => life.state === 'complete');
  const allWeeksPicked = orderedWeeks.length > 0 && orderedWeeks.every(week => Boolean(normalizedPicks[String(week)] || normalizedPicks[week]));
  // A survivor-season completion is intentionally conservative: every listed
  // pool week must be final and every pick must be an outright win. A tie is
  // not silently treated as a win because Splash tie handling is not encoded
  // in this tool's pool rules.
  const allPicksWon = allWeeksPicked && orderedWeeks.every(week => {
    const team = normalizedPicks[String(week)] || normalizedPicks[week];
    return pickResultFor(matchups, week, team, nowMs).status === 'win';
  });
  const seasonSurvived = allWeeksComplete && allPicksWon;

  let status = 'alive';
  let label = 'ALIVE';
  let detail = wins || losses ? `${wins}-${losses} tracked` : 'No completed picks yet';

  if (loss) {
    status = 'eliminated';
    label = 'ELIMINATED';
    detail = `Week ${loss.week} · ${loss.label}`;
  } else if (dataIssueResults.length) {
    const firstIssue = dataIssueResults[0];
    status = 'data-issue';
    label = 'DATA ISSUE';
    detail = `Week ${firstIssue.week} · ${firstIssue.team} matchup unavailable${dataIssueResults.length > 1 ? ` · +${dataIssueResults.length - 1} more` : ''}`;
  } else if (missingPastWeeks.length) {
    status = 'missing-pick';
    label = 'MISSING PICK';
    detail = `Enter Week ${missingPastWeeks[0]}${missingPastWeeks.length > 1 ? ` +${missingPastWeeks.length - 1} more` : ''}`;
  } else if (currentPickResult?.status === 'awaiting') {
    status = 'awaiting-result';
    label = 'AWAITING RESULT';
    detail = `Week ${currentPickResult.week} · ${currentPickResult.team}`;
  } else if (seasonSurvived) {
    status = 'survived';
    label = 'SURVIVED';
    detail = `Season complete · ${wins}-${losses}`;
  } else if (!currentPickTeam && ['upcoming', 'active', 'unknown'].includes(currentLifecycle.state)) {
    status = 'pick-needed';
    label = 'PICK NEEDED';
    detail = `Week ${currentWeekNumber} · choose a team`;
  } else if (currentPickResult?.status === 'upcoming') {
    status = 'alive';
    label = 'ALIVE';
    detail = `Week ${currentWeekNumber} · ${currentPickResult.team} selected`;
  }

  return {
    status,
    label,
    detail,
    wins,
    losses,
    ties,
    record: `${wins}-${losses}${ties ? `-${ties}` : ''}`,
    eliminatedWeek: loss?.week ?? null,
    currentPickTeam,
    currentPickResult,
    currentLifecycle,
    missingPastWeeks,
    dataIssueWeeks,
    dataIssueResults,
    allWeeksComplete,
    seasonSurvived,
    results
  };
}

