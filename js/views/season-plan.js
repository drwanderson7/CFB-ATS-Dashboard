import { state, els, selectedPickForWeek, usedTeamsSet, getDataWeeks } from '../state.js';
import { seasonScarcity } from '../survivor-score.js';
import { escapeHtml, fmtPct, teamAvatar } from '../render-utils.js';

function renderScarcityStrip() {
  const container = els.scarcityStrip;
  if (!container) return;
  if (!state.data) { container.innerHTML = ''; return; }

  const weeks = getDataWeeks().filter(week => Number(week) >= Number(state.currentWeek));
  if (!weeks.length) { container.innerHTML = ''; return; }

  const used = usedTeamsSet();
  const scarcity = seasonScarcity(state.data.matchups, weeks, used);

  container.innerHTML = `
    <div class="scarcity-strip-head">
      <span class="scarcity-strip-title">Future-week difficulty</span>
      <span class="scarcity-strip-note">How many teams are 90%+ favorites each week — fewer safe options is a week worth saving a strong team for.</span>
    </div>
    <div class="scarcity-strip-row">
      ${scarcity.map(week => `
        <div class="scarcity-chip scarcity-${week.label.toLowerCase().replace(/\s+/g, '-')}">
          <span class="scarcity-week">W${week.week}</span>
          <span class="scarcity-label">${escapeHtml(week.label)}</span>
          <span class="scarcity-count">${week.safeCount} team${week.safeCount === 1 ? '' : 's'} &gt;90%</span>
        </div>`).join('')}
    </div>
  `;
}

function renderPlanner() {
  renderScarcityStrip();
  const plan = state.plan || { picks: [], survivalProbability: null, modeledSurvivalProbability: null, coverageComplete: false, modeledWeekCount: 0, requiredWeekCount: 0, missingWeeks: [] };
  const picks = plan.picks.filter(p => !p.skipped);
  // Locked picks made before the model has a probability for that game (p === null)
  // are real, committed picks and stay in the list, but they're excluded from the
  // average/weakest-week stats below since there's no number to average or compare.
  const scored = picks.filter(p => p.p !== null && p.p !== undefined);
  const avg = scored.length ? scored.reduce((sum, p) => sum + p.p, 0) / scored.length : null;
  const weakest = scored.length ? scored.reduce((a, b) => a.p < b.p ? a : b) : null;

  const optimizerText = plan.optimizer === 'exact-assignment' ? 'Exact optimizer' : 'Planner';
  const coverageText = plan.requiredWeekCount
    ? `${optimizerText} · ${plan.modeledWeekCount}/${plan.requiredWeekCount} weeks modeled${plan.missingWeeks?.length ? ` · missing W${plan.missingWeeks.join(', W')}` : ''}`
    : `${optimizerText} · no remaining weeks`;
  const survivalLabel = plan.coverageComplete ? 'Full path survival' : 'Modeled path survival';
  const survivalValue = plan.coverageComplete ? plan.survivalProbability : plan.modeledSurvivalProbability;

  els.plannerSummary.innerHTML = `
    <div class="plan-summary-card${plan.coverageComplete ? '' : ' is-incomplete'}"><span class="stat-label">${survivalLabel}</span><strong>${picks.length ? fmtPct(survivalValue, 1) : '—'}</strong><span class="plan-coverage-note">${escapeHtml(coverageText)}</span></div>
    <div class="plan-summary-card"><span class="stat-label">Average weekly safety</span><strong>${fmtPct(avg, 1)}</strong></div>
    <div class="plan-summary-card"><span class="stat-label">Weakest planned week</span><strong>${weakest ? `W${weakest.week} · ${fmtPct(weakest.p)}` : '—'}</strong></div>`;

  if (!plan.picks.length) {
    els.plannerList.innerHTML = '<div class="empty-message">No future model path is available.</div>';
    return;
  }

  els.plannerList.innerHTML = plan.picks.map(pick => {
    if (pick.skipped) return `<div class="plan-row"><div><span class="plan-week-badge">W${pick.week}</span></div><div><span class="plan-team">No model pick</span><span class="plan-opp">No modeled probability — excluded from survival %</span></div><div>—</div><div>—</div></div>`;
    const manual = pick.locked || selectedPickForWeek(pick.week) === pick.team;
    const opponentLabel = pick.opponent ? escapeHtml(pick.opponent) : 'Opponent unavailable';
    const sourceLabel = pick.noModel ? 'no model data yet' : escapeHtml(pick.probabilitySourceShort || 'model');
    const barWidth = pick.p === null || pick.p === undefined ? 0 : Math.round(pick.p * 100);
    return `<div class="plan-row">
      <div><span class="plan-week-badge">W${pick.week}</span></div>
      <div class="plan-team-wrap">${teamAvatar(pick.team, true)}<div><span class="plan-team">${escapeHtml(pick.team)} ${manual ? '<span class="badge good">Locked</span>' : ''}</span><span class="plan-opp">${opponentLabel} · ${sourceLabel}</span></div></div>
      <div><span class="plan-prob">${fmtPct(pick.p, 1)}</span><div class="plan-bar"><span style="width:${barWidth}%"></span></div></div>
      <div><span class="stat-value">${escapeHtml(pick.spread || '—')}</span></div>
    </div>`;
  }).join('');
}

export { renderPlanner };
