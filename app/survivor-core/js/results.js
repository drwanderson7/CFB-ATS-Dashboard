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

function pickTeamsForWeek(picks, week) {
  const value = picks?.[String(week)] ?? picks?.[week] ?? null;
  if (Array.isArray(value)) return [...new Set(value.filter(team => typeof team === 'string' && team.trim()))];
  return typeof value === 'string' && value.trim() ? [value] : [];
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

export function evaluateEntryStatus(
  matchups,
  picks,
  weeks,
  currentWeek,
  nowMs = Date.now(),
  graceHours = DEFAULT_WEEK_GRACE_HOURS,
  picksPerWeek = 1
) {
  const normalizedPicks = picks && typeof picks === 'object' ? picks : {};
  const requiredPerWeek = Math.max(1, Number(picksPerWeek) || 1);
  const orderedWeeks = [...new Set((Array.isArray(weeks) ? weeks : []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);

  const results = orderedWeeks
    .flatMap(week => pickTeamsForWeek(normalizedPicks, week).map(team => pickResultFor(matchups, week, team, nowMs)))
    .sort((a, b) => a.week - b.week || a.team.localeCompare(b.team));

  const wins = results.filter(result => result.status === 'win').length;
  const losses = results.filter(result => result.status === 'loss').length;
  const ties = results.filter(result => result.status === 'tie').length;
  const dataIssueResults = results.filter(result => result.status === 'data-issue');
  const dataIssueWeeks = [...new Set(dataIssueResults.map(result => result.week))].sort((a, b) => a - b);
  const loss = results.find(result => result.status === 'loss') || null;

  const currentWeekNumber = Number(currentWeek);
  const currentPickTeams = pickTeamsForWeek(normalizedPicks, currentWeekNumber);
  const currentPickResults = currentPickTeams.map(team => pickResultFor(matchups, currentWeekNumber, team, nowMs));
  const currentPickTeam = currentPickTeams[0] || null;
  const currentPickResult = currentPickResults[0] || null;
  const currentLifecycle = weekLifecycle(matchups, currentWeekNumber, nowMs, graceHours);

  // Any completed/stale listed week with fewer than the required number of
  // saved picks is a real historical gap. For Kelly this means 0/2 or 1/2
  // both count as a missing-pick week.
  const missingPastWeeks = orderedWeeks.filter(week => {
    if (pickTeamsForWeek(normalizedPicks, week).length >= requiredPerWeek) return false;
    const life = weekLifecycle(matchups, week, nowMs, graceHours);
    return life.state === 'complete' || life.state === 'stale-incomplete';
  });

  const missingPickSlots = orderedWeeks.reduce((sum, week) => {
    const life = weekLifecycle(matchups, week, nowMs, graceHours);
    if (!['complete', 'stale-incomplete'].includes(life.state)) return sum;
    return sum + Math.max(0, requiredPerWeek - pickTeamsForWeek(normalizedPicks, week).length);
  }, 0);

  const weekLifecycles = orderedWeeks.map(week => weekLifecycle(matchups, week, nowMs, graceHours));
  const allWeeksComplete = orderedWeeks.length > 0 && weekLifecycles.every(life => life.state === 'complete');
  const allWeeksPicked = orderedWeeks.length > 0 && orderedWeeks.every(week => pickTeamsForWeek(normalizedPicks, week).length >= requiredPerWeek);

  // A survivor-season completion is intentionally conservative: every listed
  // pool week must be final and every required pick must be an outright win.
  const allPicksWon = allWeeksPicked && orderedWeeks.every(week =>
    pickTeamsForWeek(normalizedPicks, week)
      .slice(0, requiredPerWeek)
      .every(team => pickResultFor(matchups, week, team, nowMs).status === 'win')
  );
  const seasonSurvived = allWeeksComplete && allPicksWon;

  let status = 'alive';
  let label = 'ALIVE';
  let detail = wins || losses ? `${wins}-${losses} picks tracked` : 'No completed picks yet';

  if (loss) {
    status = 'eliminated';
    label = 'ELIMINATED';
    detail = `Week ${loss.week} · ${loss.team} ${loss.label}`;
  } else if (dataIssueResults.length) {
    const firstIssue = dataIssueResults[0];
    status = 'data-issue';
    label = 'DATA ISSUE';
    detail = `Week ${firstIssue.week} · ${firstIssue.team} matchup unavailable${dataIssueResults.length > 1 ? ` · +${dataIssueResults.length - 1} more` : ''}`;
  } else if (missingPastWeeks.length) {
    status = 'missing-pick';
    label = 'MISSING PICK';
    detail = requiredPerWeek > 1
      ? `Week ${missingPastWeeks[0]} · ${Math.min(requiredPerWeek, pickTeamsForWeek(normalizedPicks, missingPastWeeks[0]).length)}/${requiredPerWeek} picks saved`
      : `Enter Week ${missingPastWeeks[0]}${missingPastWeeks.length > 1 ? ` +${missingPastWeeks.length - 1} more` : ''}`;
  } else if (seasonSurvived) {
    status = 'survived';
    label = 'SURVIVED';
    detail = `Season complete · ${wins}-${losses} picks`;
  } else if (currentPickTeams.length < requiredPerWeek && ['upcoming', 'active', 'unknown'].includes(currentLifecycle.state)) {
    status = 'pick-needed';
    label = 'PICK NEEDED';
    detail = currentPickTeams.length
      ? `Week ${currentWeekNumber} · ${currentPickTeams.length} of ${requiredPerWeek} picks selected`
      : `Week ${currentWeekNumber} · choose ${requiredPerWeek === 1 ? 'a team' : `${requiredPerWeek} teams`}`;
  } else if (currentPickResults.some(result => result.status === 'awaiting')) {
    status = 'awaiting-result';
    label = 'AWAITING RESULT';
    const pending = currentPickResults.filter(result => result.status === 'awaiting');
    detail = `Week ${currentWeekNumber} · ${pending.length === 1 ? pending[0].team : `${pending.length} picks pending`}`;
  } else if (currentPickTeams.length >= requiredPerWeek && currentPickResults.every(result => result.status === 'upcoming')) {
    status = 'alive';
    label = 'ALIVE';
    detail = requiredPerWeek === 1
      ? `Week ${currentWeekNumber} · ${currentPickTeams[0]} selected`
      : `Week ${currentWeekNumber} · ${requiredPerWeek} picks selected`;
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
    currentPickTeams,
    currentPickResult,
    currentPickResults,
    picksPerWeek: requiredPerWeek,
    currentLifecycle,
    missingPastWeeks,
    missingPickSlots,
    dataIssueWeeks,
    dataIssueResults,
    allWeeksComplete,
    seasonSurvived,
    results
  };
}
