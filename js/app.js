import {
  loadState, saveActivePoolId,
  loadSyncCode
} from './storage.js';
import { buildDemoData, hasAuthoritativeSchedule } from './demo-data.js';
import {
  buildSeasonPlan,
  buildStrategicRecommendation,
  buildPickExplanation
} from './survivor-score.js';
import { deriveCurrentPoolWeek, evaluateEntryStatus } from './results.js';
import { buildDataHealth } from './data-health.js';
import { mergeResultRefresh } from './result-refresh.js';
import { DEFAULT_SURVIVOR_SEASON, normalizeSurvivorSeason } from '../data/survivor-config.js';

import {
  els, state,
  activePool, activeEntry,
  syncActiveEntryState, nextEntryName, newEntryId,
  selectedPickForWeek, usedTeamsSet, getDataWeeks, determineCurrentWeek
} from './state.js';
import {
  escapeHtml, fmtPct, probabilitySourceLabel, teamAvatar,
  matchupLabel, formatPointDelta, futureValueLabel
} from './render-utils.js';
import { renderEntryControls } from './entry-controls.js';
import { rankedMatchups, renderRankings } from './views/week-rankings.js';
import { renderGrid } from './views/season-board.js';
import { renderPlanner } from './views/season-plan.js';
import { renderPicks } from './views/my-picks.js';
import { lookupMatchup, opponentSideFor, openMatchup } from './dialogs/matchup-dialog.js';
// Sync UI receives its app callbacks through configureSyncUI() at boot.
// This avoids the former app.js ↔ sync-ui.js circular module dependency.
import { saveLocal, pullSyncOnBoot, bindSyncEvents, startAutomaticResultRefresh, configureSyncUI, syncStatusLabel } from './sync-ui.js';


function applyPoolChrome() {
  const pool = activePool();
  document.title = `${pool.name} · CFB Survivor`;
  els.poolSelect.value = pool.id;
  els.brandMarkText.textContent = pool.cfbdConference;
  const exactSchedule = hasAuthoritativeSchedule(pool.id, state.season || DEFAULT_SURVIVOR_SEASON);
  els.brandSubtitle.textContent = exactSchedule ? `${pool.conference} pool · Splash schedule` : `${pool.conference} pool · either side eligible`;
  els.poolRuleConference.textContent = exactSchedule ? `Listed ${pool.conference} games · either team` : `${pool.conference} game · either team`;
  els.gridTitle.textContent = exactSchedule ? `${pool.conference} Survivor Schedule` : `${pool.conference} Season Board`;
  // Entry-specific copy is rendered by renderEntryControls().
}



function setStatus(message = '', type = '') {
  els.statusBanner.className = `status-banner${type ? ` ${type}` : ''}${message ? '' : ' hidden'}`;
  if (!message) {
    els.statusBanner.innerHTML = '';
    return;
  }
  els.statusBanner.classList.remove('expanded');
  els.statusBanner.innerHTML = `
    <span class="status-banner-icon" aria-hidden="true">!</span>
    <span class="status-banner-copy">${escapeHtml(message)}</span>
    <button class="status-banner-toggle" type="button" aria-expanded="false">Details</button>`;
}

function setFreshness(mode, text) {
  els.dataFreshness.className = `data-freshness${mode ? ` ${mode}` : ''}`;
  els.dataFreshness.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(text)}</span>`;
}




let resultsRefreshInFlight = false;
async function refreshResults({ forceFresh = false } = {}) {
  if (!state.data || state.data.demo || resultsRefreshInFlight) return state.data;
  resultsRefreshInFlight = true;
  try {
    const year = Number(state.season) || DEFAULT_SURVIVOR_SEASON;
    const freshParam = forceFresh ? `&fresh=1&_=${Date.now()}` : '';
    const response = await fetch(`/api/survivor-data?year=${encodeURIComponent(year)}&pool=${encodeURIComponent(state.poolId)}&mode=results${freshParam}`, forceFresh ? { cache: 'no-store' } : undefined);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Unable to refresh results (${response.status}).`);

    state.data = mergeResultRefresh(state.data, payload);
    const validWeeks = getDataWeeks();
    state.scheduleCurrentWeek = determineCurrentWeek();
    if (!validWeeks.includes(Number(state.currentWeek)) || Number(state.currentWeek) < Number(state.scheduleCurrentWeek)) {
      state.currentWeek = state.scheduleCurrentWeek;
      saveLocal({ sync: false });
    }
    renderAll();
    return state.data;
  } catch (error) {
    // A failed result poll must never erase the already-loaded board/model.
    setFreshness('error', 'Results refresh failed · using loaded data');
    if (forceFresh) setStatus(error.message || 'Unable to refresh live results.', 'error');
    return state.data;
  } finally {
    resultsRefreshInFlight = false;
  }
}

async function loadData({ forceDemo = false, forceFresh = false, silent = false } = {}) {
  const previousData = state.data;
  const year = Number(els.seasonSelect.value) || state.season || DEFAULT_SURVIVOR_SEASON;
  state.season = year;
  const pool = activePool();
  state.loading = true;
  if (!silent) {
    setStatus('');
    setFreshness('', 'Loading data');
    els.heroRecommendation.innerHTML = `<div class="skeleton-block">Loading ${escapeHtml(pool.conference)} schedule, lines and model probabilities…</div>`;
  }

  try {
    const demoRequested = forceDemo || new URLSearchParams(location.search).get('demo') === '1' || location.protocol === 'file:';
    if (demoRequested) {
      state.data = buildDemoData(year, state.poolId);
    } else {
      const freshParam = forceFresh ? `&fresh=1&_=${Date.now()}` : '';
      const response = await fetch(`/api/survivor-data?year=${encodeURIComponent(year)}&pool=${encodeURIComponent(state.poolId)}${freshParam}`, forceFresh ? { cache: 'no-store' } : undefined);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Unable to load data (${response.status}).`);
      state.data = payload;
    }

    const validWeeks = getDataWeeks();
    state.scheduleCurrentWeek = determineCurrentWeek();
    // Advance a stale persisted focus when the real pool week has moved on,
    // while still allowing the user to browse future weeks intentionally.
    if (!validWeeks.includes(Number(state.currentWeek)) || Number(state.currentWeek) < Number(state.scheduleCurrentWeek)) {
      state.currentWeek = state.scheduleCurrentWeek;
    }
    state.currentWeek = Number(state.currentWeek) || state.scheduleCurrentWeek;
    saveLocal({ sync: false });

    const warnings = state.data.warnings || [];
    if (warnings.length) setStatus(warnings.join(' '));
    renderAll();
  } catch (error) {
    if (silent && previousData) {
      state.data = previousData;
      setFreshness('error', 'Model refresh failed · using loaded data');
    } else {
      state.data = null;
      setFreshness('error', 'Data unavailable');
      setStatus(`${error.message} Add CFBD_API_KEY in Vercel, or open with ?demo=1 to preview the UI.`, 'error');
      renderNoData();
    }
  } finally {
    state.loading = false;
  }
}

function renderNoData() {
  els.heroRecommendation.innerHTML = `
    <div class="hero-team-line">
      <div class="hero-team-copy"><span class="hero-team">Data connection needed</span><div class="hero-matchup">Configure the CFBD server key to populate the board.</div></div>
    </div>`;
  els.currentWeekMetric.textContent = '—';
  els.currentWeekMeta.textContent = 'No schedule loaded';
  els.planSurvivalMetric.textContent = '—';
  if (els.entryStatusBar) { els.entryStatusBar.className = 'entry-status-bar hidden'; els.entryStatusBar.innerHTML = ''; }
  if (els.dataHealthPanel) { els.dataHealthPanel.className = 'data-health-panel error'; els.dataHealthItems.innerHTML = '<span class="data-health-item warn"><span>Data health</span><strong>Unavailable ⚠</strong></span>'; els.dataHealthDetails.innerHTML = '<div class="data-health-block">No survivor data is loaded.</div>'; }
  if (els.planSurvivalDetail) els.planSurvivalDetail.textContent = 'remaining model path';
  els.rankingList.innerHTML = '<div class="empty-message">No live schedule is loaded yet. Configure the CFBD server key or use <strong>?demo=1</strong>.</div>';
  els.seasonGrid.innerHTML = '';
  els.plannerList.innerHTML = '<div class="empty-message">Planner will appear after data loads.</div>';
  els.plannerSummary.innerHTML = '';
  renderPicks();
}

function planInputs({ ignoreCurrentWeek = false } = {}) {
  const weeks = getDataWeeks();
  const activeWeeks = new Set(weeks.filter(week => Number(week) >= Number(state.currentWeek) && state.data.matchups.some(m => m.week === week && !m.completed)));
  const priorUsed = new Set(Object.entries(state.picks)
    .filter(([week]) => !activeWeeks.has(Number(week)))
    .map(([, team]) => team));
  const locked = Object.fromEntries(Object.entries(state.picks).filter(([week]) =>
    activeWeeks.has(Number(week)) && (!ignoreCurrentWeek || Number(week) !== Number(state.currentWeek))
  ));
  return { weeks, priorUsed, locked };
}

function computePlan() {
  if (!state.data) return { picks: [], survivalProbability: null, modeledSurvivalProbability: null, coverageComplete: false, modeledWeekCount: 0, requiredWeekCount: 0, missingWeeks: [] };
  const { weeks, priorUsed, locked } = planInputs();
  return buildSeasonPlan(state.data.matchups, weeks, priorUsed, locked);
}

function computeRecommendationPlan() {
  if (!state.data) return { picks: [], recommendation: null, survivalProbability: null, modeledSurvivalProbability: null, coverageComplete: false, modeledWeekCount: 0, requiredWeekCount: 0, missingWeeks: [] };
  const { weeks, priorUsed, locked } = planInputs({ ignoreCurrentWeek: true });
  return buildStrategicRecommendation(state.data.matchups, weeks, priorUsed, state.currentWeek, locked);
}

function strategicRecommendationTeam() {
  return state.recommendationPlan?.recommendation?.team || null;
}

function formatDataHealthTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function renderDataHealth() {
  if (!els.dataHealthPanel || !els.dataHealthItems || !els.dataHealthDetails) return;
  const health = buildDataHealth(state.data);
  els.dataHealthPanel.className = `data-health-panel ${health.tone}`;

  const statusMark = value => value ? '✓' : '⚠';
  const probabilityLabel = health.probability.total
    ? `${health.probability.modeled}/${health.probability.total}`
    : '—';

  els.dataHealthItems.innerHTML = `
    <span class="data-health-item ${health.schedule.complete ? 'ok' : 'warn'}"><span>Schedule</span><strong>${escapeHtml(health.schedule.label)} ${statusMark(health.schedule.complete)}</strong></span>
    <span class="data-health-item ${health.probability.complete ? 'ok' : 'warn'}"><span>Probabilities</span><strong>${escapeHtml(probabilityLabel)} ${statusMark(health.probability.complete)}</strong></span>
    <span class="data-health-item ${health.results.live || state.data?.demo ? 'ok' : 'warn'}"><span>Results</span><strong>${escapeHtml(health.results.label)}${health.results.live ? ' ✓' : ''}</strong></span>
    <span class="data-health-item"><span>Updated</span><strong>${escapeHtml(formatDataHealthTime(health.updatedAt))}</strong></span>`;

  const sources = health.probability.bySource;
  const sourceBits = [
    sources.direct ? `${sources.direct} WP` : '',
    sources.sp ? `${sources.sp} SP+` : '',
    sources.line ? `${sources.line} Line` : '',
    sources.other ? `${sources.other} Other` : '',
    sources.missing ? `${sources.missing} Missing` : ''
  ].filter(Boolean).join(' · ') || 'No probability sources loaded';

  const missingGames = health.missingGames.length
    ? `<div class="data-health-block"><strong>Unmatched Splash games</strong><ul>${health.missingGames.map(game => `<li>W${escapeHtml(game.week)} · ${escapeHtml((game.teams || []).join(' vs '))}</li>`).join('')}</ul></div>`
    : '<div class="data-health-good">All listed Splash games currently match the loaded schedule.</div>';

  const warnings = health.warnings.length
    ? `<div class="data-health-block"><strong>Warnings</strong><ul>${health.warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></div>`
    : '';

  els.dataHealthDetails.innerHTML = `
    <div class="data-health-detail-grid">
      <div><span>Schedule source</span><strong>${escapeHtml(state.data?.scheduleSource || (state.data?.demo ? 'Demo Splash schedule' : '—'))}</strong></div>
      <div><span>Probability coverage</span><strong>${escapeHtml(probabilityLabel)} selectable sides</strong><small>${escapeHtml(sourceBits)}</small></div>
      <div><span>Results source</span><strong>${escapeHtml(state.data?.results?.source || (state.data?.demo ? 'Demo data' : '—'))}</strong></div>
      <div><span>Model loaded</span><strong>${escapeHtml(state.data?.modelGeneratedAt ? new Date(state.data.modelGeneratedAt).toLocaleString() : state.data?.generatedAt ? new Date(state.data.generatedAt).toLocaleString() : '—')}</strong><small>${escapeHtml(state.data?.results?.refreshMode === 'results-only' && state.data?.results?.lastCheckedAt ? `Results checked ${new Date(state.data.results.lastCheckedAt).toLocaleString()}` : '')}</small></div>
    </div>
    ${missingGames}
    ${warnings}`;
}

function renderAll() {
  if (!state.data) return renderNoData();
  state.scheduleCurrentWeek = deriveCurrentPoolWeek(state.data.matchups, getDataWeeks(), Date.now());
  state.entryStatus = evaluateEntryStatus(state.data.matchups, state.picks, getDataWeeks(), state.scheduleCurrentWeek, Date.now());
  state.plan = computePlan();
  state.recommendationPlan = computeRecommendationPlan();
  renderEntryStatus();
  renderDataHealth();
  renderWeekControls();
  renderHeaderMetrics();
  renderRankings(strategicRecommendationTeam());
  renderGrid();
  renderPlanner();
  renderPicks();
}



function renderWhyPickPanel(matchup) {
  if (!els.whyPickPanel) return;
  if (!state.whyPickOpen || !matchup || !state.data) {
    els.whyPickPanel.classList.add('hidden');
    els.whyPickPanel.innerHTML = '';
    return;
  }

  const explanation = buildPickExplanation(
    matchup,
    state.data.matchups,
    getDataWeeks(),
    usedTeamsSet(matchup.week)
  );
  if (!explanation) {
    els.whyPickPanel.classList.add('hidden');
    return;
  }

  const futureSpot = explanation.futureBestSpot;
  let futureText = futureSpot
    ? `Best later spot: W${futureSpot.week} ${matchupLabel(futureSpot)} at ${fmtPct(futureSpot.p, 1)}. ${explanation.future.strongCount || 0} future 85%+ spot${explanation.future.strongCount === 1 ? '' : 's'}.`
    : 'No later modeled opportunity is currently available for this team.';
  if (explanation.safestTeam && explanation.safestTeam !== matchup.team && explanation.safestFutureBestSpot) {
    const saveSpot = explanation.safestFutureBestSpot;
    futureText += ` ${explanation.safestTeam}, the safer option today, has a W${saveSpot.week} spot at ${fmtPct(saveSpot.p, 1)}, which is a reason to preserve it.`;
  }

  let safetyText = `#${explanation.safetyRank} of ${explanation.optionCount} modeled options by raw win probability.`;
  if (explanation.safetyRank === 1) {
    safetyText = `Safest modeled option this week at ${fmtPct(explanation.p, 1)}.`;
  } else if (explanation.safestTeam && explanation.safetyGapToSafest !== null) {
    safetyText = `#${explanation.safetyRank} in safety at ${fmtPct(explanation.p, 1)} — ${Math.abs(explanation.safetyGapToSafest * 100).toFixed(1)} pts below ${explanation.safestTeam}.`;
  }

  const strategicPlan = state.recommendationPlan;
  let pathText = 'Not enough modeled coverage for a reliable season-path recommendation yet.';
  if (strategicPlan?.recommendation?.team === matchup.team) {
    if (strategicPlan.coverageComplete && strategicPlan.survivalProbability !== null) {
      pathText = `This team starts the planner’s strongest complete remaining path at ${fmtPct(strategicPlan.survivalProbability, 1)}.`;
      if (explanation.comparableAlternative?.team && explanation.pathAdvantageVsAlternative !== null && explanation.pathAdvantageVsAlternative >= 0) {
        pathText += ` In the leading what-if comparison it is ${formatPointDelta(explanation.pathAdvantageVsAlternative)} vs ${explanation.comparableAlternative.team}.`;
      }
    } else if (strategicPlan.requiredWeekCount) {
      pathText = `This team starts the planner’s best-coverage path: ${strategicPlan.modeledWeekCount}/${strategicPlan.requiredWeekCount} remaining weeks modeled${strategicPlan.missingWeeks?.length ? `; missing W${strategicPlan.missingWeeks.join(', W')}` : ''}.`;
    }
  } else if (explanation.chosenPath?.requiredWeekCount) {
    pathText = `This option is not the planner’s current Best Play. Its comparison covers ${explanation.chosenPath.modeledWeekCount}/${explanation.chosenPath.requiredWeekCount} remaining weeks.`;
  }

  const hardest = explanation.hardestFutureWeek;
  const scarcityText = hardest
    ? `Hardest modeled future week after using ${matchup.team}: W${hardest.week}, with ${hardest.safeCount} unused 90%+ option${hardest.safeCount === 1 ? '' : 's'}.`
    : 'No future-week scarcity data is available yet.';

  els.whyPickPanel.classList.remove('hidden');
  els.whyPickPanel.innerHTML = `
    <div class="why-pick-head">
      <div><span class="why-pick-kicker">Why this pick?</span><strong>${escapeHtml(matchup.team)}</strong></div>
      <span class="model-source">${escapeHtml(probabilitySourceLabel(matchup, true))}</span>
    </div>
    <div class="why-pick-grid">
      <div class="why-pick-fact"><span>Safety</span><p>${escapeHtml(safetyText)}</p></div>
      <div class="why-pick-fact"><span>Future cost</span><p>${escapeHtml(futureText)}</p></div>
      <div class="why-pick-fact"><span>Season path</span><p>${escapeHtml(pathText)}</p></div>
      <div class="why-pick-fact"><span>Future scarcity</span><p>${escapeHtml(scarcityText)}</p></div>
    </div>
    <p class="why-pick-footnote">Best Play is driven by the exact season planner. Survivor Score rank: #${explanation.scoreRank} is retained as a secondary heuristic for quick comparison.</p>`;
}

function renderEntryStatus() {
  if (!els.entryStatusBar || !state.entryStatus) return;
  const entry = activeEntry();
  const status = state.entryStatus;
  const poolWeek = Number(state.scheduleCurrentWeek);
  const viewingFuture = Number(state.currentWeek) !== poolWeek;
  const currentPick = Number.isFinite(poolWeek) ? selectedPickForWeek(poolWeek) : null;
  const usedCount = new Set(Object.entries(state.picks)
    .filter(([week, team]) => team && (!Number.isFinite(poolWeek) || Number(week) <= poolWeek))
    .map(([, team]) => team)).size;
  const syncLabel = state.syncCode ? syncStatusLabel() : 'Off';
  const record = status.record || `${status.wins || 0}-${status.losses || 0}`;
  els.entryStatusBar.className = `entry-status-bar is-${status.status}`;
  els.entryStatusBar.innerHTML = `
    <div class="entry-status-main">
      <span class="entry-status-pill">${escapeHtml(status.label)}</span>
      <span class="entry-status-identity"><span>${escapeHtml(activePool().name)}</span><strong>${escapeHtml(entry?.name || 'My Entry')}</strong></span>
      <span class="entry-status-detail">${escapeHtml(status.detail)}</span>
    </div>
    <div class="entry-status-meta" aria-label="Active entry summary">
      <span class="entry-summary-chip"><b>Record</b><strong>${escapeHtml(record)}</strong></span>
      <span class="entry-summary-chip"><b>Pool week</b><strong>${Number.isFinite(poolWeek) ? `W${poolWeek}` : '—'}</strong></span>
      <span class="entry-summary-chip"><b>Pick</b><strong>${escapeHtml(currentPick || '—')}</strong></span>
      <span class="entry-summary-chip"><b>Used</b><strong>${usedCount}</strong></span>
      <span class="entry-summary-chip"><b>Sync</b><strong>${escapeHtml(syncLabel)}</strong></span>
      ${viewingFuture ? `<span class="entry-summary-chip is-viewing"><b>Viewing</b><strong>W${escapeHtml(String(state.currentWeek))}</strong></span>` : ''}
    </div>`;
}

function renderHeaderMetrics() {
  const usedOtherWeeks = usedTeamsSet(state.currentWeek);
  const weekEligible = new Set(state.data.matchups
    .filter(matchup => matchup.week === Number(state.currentWeek))
    .map(matchup => matchup.team));
  const availableThisWeek = [...weekEligible].filter(team => !usedOtherWeeks.has(team)).length;
  els.teamsRemainingMetric.textContent = String(availableThisWeek);
  els.teamsRemainingDetail.textContent = `of ${weekEligible.size} selectable sides`;
  els.currentWeekMetric.textContent = `W${state.currentWeek}`;
  const weekGames = state.data.matchups.filter(m => m.week === state.currentWeek);
  const dates = weekGames.map(m => m.startDate).filter(Boolean).sort();
  els.currentWeekMeta.textContent = dates[0]
    ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(dates[0]))
    : `${weekGames.length} eligible picks`;

  const planHasWeeks = (state.plan?.requiredWeekCount || 0) > 0;
  if (state.entryStatus?.status === 'eliminated') {
    els.planSurvivalMetric.textContent = '0%';
    els.planSurvivalDetail.textContent = `eliminated W${state.entryStatus.eliminatedWeek}`;
  } else if (state.entryStatus?.status === 'survived') {
    els.planSurvivalMetric.textContent = '100%';
    els.planSurvivalDetail.textContent = 'season survived';
    els.teamsRemainingMetric.textContent = '0';
    els.teamsRemainingDetail.textContent = 'season complete';
  } else if (state.entryStatus?.status === 'data-issue') {
    els.planSurvivalMetric.textContent = '—';
    els.planSurvivalDetail.textContent = `resolve W${state.entryStatus.dataIssueWeeks?.[0] || '?'} data issue`;
  } else if (state.entryStatus?.status === 'missing-pick') {
    els.planSurvivalMetric.textContent = '—';
    els.planSurvivalDetail.textContent = `missing W${state.entryStatus.missingPastWeeks[0]} pick`;
  } else {
    els.planSurvivalMetric.textContent = planHasWeeks && state.plan?.coverageComplete
      ? fmtPct(state.plan.survivalProbability, 1)
      : '—';
    if (els.planSurvivalDetail) {
      els.planSurvivalDetail.textContent = planHasWeeks && !state.plan?.coverageComplete
        ? `${state.plan?.modeledWeekCount || 0}/${state.plan?.requiredWeekCount || 0} weeks modeled`
        : 'remaining model path';
    }
  }

  const generated = state.data.generatedAt ? new Date(state.data.generatedAt) : null;
  const freshnessText = state.data.demo
    ? 'Demo data'
    : generated && !Number.isNaN(generated.valueOf())
      ? `Updated ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(generated)}`
      : 'CFBD connected';
  setFreshness(state.data.demo ? 'demo' : '', freshnessText);

  if (state.entryStatus?.status === 'survived') {
    els.heroRecommendation.innerHTML = `
      <div class="hero-team-line">
        <div class="hero-team-copy">
          <span class="hero-team">Season survived</span>
          <div class="hero-matchup">${escapeHtml(activeEntry()?.name || 'My Entry')} completed every listed pool week without a loss.</div>
        </div>
        <div class="hero-number">
          <span class="hero-pct">${escapeHtml(state.entryStatus.record)}</span>
          <span class="hero-pct-label">final record</span>
        </div>
      </div>
      <div class="hero-meta"><div class="hero-facts"><span class="badge good">SURVIVED</span><span>All ${getDataWeeks().length} pool weeks complete</span></div></div>`;
    renderWhyPickPanel(null);
    return;
  }

  const rankings = rankedMatchups(state.currentWeek, strategicRecommendationTeam());
  const strategicTeam = strategicRecommendationTeam();
  const top = rankings.find(item => item.matchup.team === strategicTeam && !item.used && item.p !== null)
    || rankings.find(item => !item.used && item.p !== null);
  if (!top) {
    els.heroRecommendation.innerHTML = `
      <div class="hero-team-line">
        <div class="hero-team-copy"><span class="hero-team">No eligible model pick</span><div class="hero-matchup">Choose another week or check CFBD probability availability.</div></div>
      </div>`;
    renderWhyPickPanel(null);
    return;
  }

  const futureBest = top.future.best === null ? '—' : fmtPct(top.future.best);
  const pathPlan = state.recommendationPlan;
  const pathValue = pathPlan?.coverageComplete
    ? fmtPct(pathPlan.survivalProbability, 1)
    : pathPlan?.requiredWeekCount
      ? `${pathPlan.modeledWeekCount}/${pathPlan.requiredWeekCount}`
      : '—';
  const pathLabel = pathPlan?.coverageComplete ? 'Path' : 'Modeled';
  els.heroRecommendation.innerHTML = `
    <div class="hero-team-line">
      <div class="hero-identity">
        ${teamAvatar(top.matchup.team)}
        <div class="hero-team-copy">
          <div class="hero-name-row"><span class="hero-team">${escapeHtml(top.matchup.team)}</span>${top.matchup.isConferenceMember === false ? '<span class="badge opponent">Opponent</span>' : ''}</div>
          <div class="hero-matchup">${escapeHtml(matchupLabel(top.matchup))} · ${escapeHtml(top.matchup.spread || 'no line')}</div>
        </div>
      </div>
      <div class="hero-number">
        <span class="hero-pct">${fmtPct(top.p, 1)}</span>
        <span class="hero-pct-label">win probability</span>
      </div>
    </div>
    <div class="hero-meta">
      <div class="hero-facts">
        <span class="badge good">Best path</span>
        ${state.entryStatus?.status === 'eliminated' ? '<span class="badge danger">Research only · entry eliminated</span>' : ''}
        ${state.entryStatus?.status === 'data-issue' ? '<span class="badge warning">Research only · entry status unresolved</span>' : ''}
        <span><span class="hero-fact-label">${pathLabel}</span> <strong>${escapeHtml(pathValue)}</strong></span>
        <span><span class="hero-fact-label">Score</span> <strong>${top.score?.toFixed(1) ?? '—'}</strong></span>
        <span><span class="hero-fact-label">Future</span> <strong>${escapeHtml(futureBest)}</strong></span>
        <span class="model-source">${escapeHtml(probabilitySourceLabel(top.matchup, true))}</span>
      </div>
      <div class="hero-actions">
        <button class="hero-why-button" type="button" data-why-pick-game="${top.matchup.gameId}" data-why-pick-team="${escapeHtml(top.matchup.team)}" aria-expanded="${state.whyPickOpen ? 'true' : 'false'}">${state.whyPickOpen ? 'Hide why' : 'Why this pick?'}</button>
        <button class="hero-detail-button" type="button" data-hero-game="${top.matchup.gameId}" data-hero-team="${escapeHtml(top.matchup.team)}">Details <span aria-hidden="true">→</span></button>
      </div>
    </div>`;
  renderWhyPickPanel(top.matchup);
}

function renderWeekControls() {
  const weeks = getDataWeeks();
  els.weekSelect.innerHTML = weeks.map(week => `<option value="${week}"${week === Number(state.currentWeek) ? ' selected' : ''}>Week ${week}</option>`).join('');
  els.weekHeading.textContent = `Week ${state.currentWeek} rankings`;
  els.weekNavLabel.textContent = `Week ${state.currentWeek}`;
  const index = weeks.indexOf(Number(state.currentWeek));
  const prevDisabled = index <= 0;
  const nextDisabled = index < 0 || index >= weeks.length - 1;
  els.prevWeekBtn.disabled = prevDisabled;
  els.nextWeekBtn.disabled = nextDisabled;
  els.weekPrevSecondary.disabled = prevDisabled;
  els.weekNextSecondary.disabled = nextDisabled;
}

function applyPick(matchup) {
  if (!matchup) return;
  if (usedTeamsSet(matchup.week).has(matchup.team)) return;
  state.picks[String(matchup.week)] = matchup.team;
  state.currentWeek = matchup.week;
  saveLocal();
  renderAll();
}

function switchView(view) {
  state.selectedView = view;
  document.querySelectorAll('.nav-item').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  document.querySelectorAll('.view').forEach(section => section.classList.remove('active-view'));
  document.getElementById(`${view}View`)?.classList.add('active-view');
}

function bindEvents() {
  els.statusBanner.addEventListener('click', event => {
    const toggle = event.target.closest('.status-banner-toggle');
    if (!toggle) return;
    const expanded = els.statusBanner.classList.toggle('expanded');
    toggle.textContent = expanded ? 'Less' : 'Details';
    toggle.setAttribute('aria-expanded', String(expanded));
  });

  document.querySelector('.primary-nav').addEventListener('click', event => {
    const tab = event.target.closest('.nav-item');
    if (tab) switchView(tab.dataset.view);
  });

  els.poolSelect.addEventListener('change', () => {
    saveLocal({ sync: false });
    state.poolId = els.poolSelect.value === 'bigten' ? 'bigten' : 'sec';
    const poolState = loadState(state.poolId);
    state.entries = poolState.entries;
    state.activeEntryId = poolState.activeEntryId;
    state.currentWeek = poolState.currentWeek;
    state.season = poolState.season;
    syncActiveEntryState();
    state.data = null;
    state.plan = null;
    state.selectedMatchup = null;
    state.gridSortWeek = null;
    saveActivePoolId(state.poolId);
    els.seasonSelect.value = String(state.season || DEFAULT_SURVIVOR_SEASON);
    applyPoolChrome();
    renderEntryControls();
    loadData();
  });

  els.entrySelect.addEventListener('change', () => {
    saveLocal({ sync: false });
    if (!state.entries.some(entry => entry.id === els.entrySelect.value)) return;
    state.activeEntryId = els.entrySelect.value;
    syncActiveEntryState();
    saveLocal({ sync: false });
    renderAll();
  });

  els.addEntryBtn.addEventListener('click', () => {
    saveLocal({ sync: false });
    const entry = { id: newEntryId(), name: nextEntryName(), picks: {} };
    state.entries.push(entry);
    state.activeEntryId = entry.id;
    syncActiveEntryState();
    saveLocal();
    renderAll();
    switchView('picks');
    requestAnimationFrame(() => {
      els.entryNameInput.focus();
      els.entryNameInput.select();
    });
  });

  els.refreshBtn.addEventListener('click', () => refreshResults({ forceFresh: true }));
  els.seasonSelect.addEventListener('change', () => {
    state.season = normalizeSurvivorSeason(els.seasonSelect.value);
    state.currentWeek = null;
    state.gridSortWeek = null;
    saveLocal();
    loadData();
  });

  els.weekSelect.addEventListener('change', () => {
    state.currentWeek = Number(els.weekSelect.value);
    saveLocal({ sync: false });
    renderAll();
  });

  els.prevWeekBtn.addEventListener('click', () => moveWeek(-1));
  els.nextWeekBtn.addEventListener('click', () => moveWeek(1));
  els.weekPrevSecondary.addEventListener('click', () => moveWeek(-1));
  els.weekNextSecondary.addEventListener('click', () => moveWeek(1));

  els.heroRecommendation.addEventListener('click', event => {
    const whyButton = event.target.closest('[data-why-pick-game]');
    if (whyButton) {
      state.whyPickOpen = !state.whyPickOpen;
      renderHeaderMetrics();
      return;
    }
    const button = event.target.closest('[data-hero-game]');
    if (!button) return;
    openMatchup(lookupMatchup(button.dataset.heroGame, button.dataset.heroTeam));
  });

  els.rankingList.addEventListener('click', event => {
    const card = event.target.closest('.rank-card');
    if (!card) return;
    const matchup = lookupMatchup(card.dataset.gameId, card.dataset.team);
    if (event.target.closest('[data-action="use"]')) {
      applyPick(matchup);
    } else if (event.target.closest('[data-action="details"]')) {
      openMatchup(matchup);
    } else if (event.target.closest('[data-action="compare"]')) {
      const team = card.dataset.team;
      if (state.compareSelection.has(team)) {
        state.compareSelection.delete(team);
      } else if (state.compareSelection.size < 4) {
        state.compareSelection.add(team);
      }
      renderRankings(strategicRecommendationTeam());
    }
  });

  els.compareBar.addEventListener('click', event => {
    if (event.target.id === 'compareClearBtn') {
      state.compareSelection = new Set();
      renderRankings(strategicRecommendationTeam());
      return;
    }
    const removeBtn = event.target.closest('[data-compare-remove]');
    if (removeBtn) {
      state.compareSelection.delete(removeBtn.dataset.compareRemove);
      renderRankings(strategicRecommendationTeam());
    }
  });

  els.seasonGrid.addEventListener('click', event => {
    const weekButton = event.target.closest('[data-grid-week]');
    if (weekButton) {
      const week = Number(weekButton.dataset.gridWeek);
      state.currentWeek = week;
      state.gridSortWeek = Number(state.gridSortWeek) === week ? null : week;
      saveLocal({ sync: false });
      renderAll();
      return;
    }
    const cell = event.target.closest('[data-cell-game]');
    if (!cell) return;
    openMatchup(lookupMatchup(cell.dataset.cellGame, cell.dataset.cellTeam));
  });

  els.dialogBody.addEventListener('click', event => {
    const button = event.target.closest('[data-dialog-pick-team]');
    if (!button || button.disabled || !state.selectedMatchup) return;
    const candidate = lookupMatchup(state.selectedMatchup.gameId, button.dataset.dialogPickTeam);
    if (!candidate) return;
    applyPick(candidate);
    els.matchupDialog.close();
  });

  els.useTeamBtn.addEventListener('click', event => {
    event.preventDefault();
    if (els.useTeamBtn.disabled) return;
    applyPick(state.selectedMatchup);
    els.matchupDialog.close();
  });

  els.useOpponentBtn.addEventListener('click', event => {
    event.preventDefault();
    if (els.useOpponentBtn.disabled) return;
    applyPick(opponentSideFor(state.selectedMatchup));
    els.matchupDialog.close();
  });

  els.pickHistory.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-week]');
    if (!button) return;
    delete state.picks[String(button.dataset.removeWeek)];
    saveLocal();
    renderAll();
  });

  els.entryNameInput.addEventListener('change', () => {
    state.entryName = els.entryNameInput.value.trim() || 'My Entry';
    saveLocal();
    renderEntryControls();
  });

  els.deleteEntryBtn.addEventListener('click', () => {
    if (state.entries.length <= 1) return;
    renderEntryControls();
    if (typeof els.deleteEntryDialog.showModal === 'function') els.deleteEntryDialog.showModal();
  });

  els.confirmDeleteEntryBtn.addEventListener('click', event => {
    event.preventDefault();
    if (state.entries.length <= 1) return;
    const deletedId = state.activeEntryId;
    state.entries = state.entries.filter(entry => entry.id !== deletedId);
    state.activeEntryId = state.entries[0].id;
    syncActiveEntryState();
    saveLocal();
    els.deleteEntryDialog.close();
    renderAll();
  });

  els.resetPicksBtn.addEventListener('click', () => {
    const entry = activeEntry();
    if (els.resetEntryCopy) {
      els.resetEntryCopy.textContent = `This removes every weekly pick from ${entry?.name || 'this entry'} only. Other entries and the other conference pool are unchanged.`;
    }
    if (typeof els.resetEntryDialog?.showModal === 'function') els.resetEntryDialog.showModal();
  });

  els.confirmResetPicksBtn?.addEventListener('click', event => {
    event.preventDefault();
    state.picks = {};
    state.entryName = els.entryNameInput.value.trim() || state.entryName || 'My Entry';
    saveLocal();
    els.resetEntryDialog?.close();
    renderAll();
  });

  bindSyncEvents();
}

function moveWeek(delta) {
  const weeks = getDataWeeks();
  const index = weeks.indexOf(Number(state.currentWeek));
  const next = weeks[index + delta];
  if (next === undefined) return;
  state.currentWeek = next;
  saveLocal({ sync: false });
  renderAll();
}




export { renderAll, loadData, refreshResults };

configureSyncUI({ renderAll, loadData, refreshResults, renderEntryStatus });
bindEvents();
applyPoolChrome();
renderEntryControls();
els.poolSelect.value = state.poolId;
els.seasonSelect.value = String(state.season || DEFAULT_SURVIVOR_SEASON);
switchView('grid');
loadData();
pullSyncOnBoot();
startAutomaticResultRefresh();

