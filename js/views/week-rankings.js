import { state, els, activePool, selectedPickForWeek, usedTeamsSet, getDataWeeks } from '../state.js';
import { futureProfile, probabilityFor, survivorScore, recommendationLabel, compareWhatIf } from '../survivor-score.js';
import { escapeHtml, fmtPct, probabilitySourceLabel, teamAvatar, matchupLabel, resultLabel, futureValueLabel } from '../render-utils.js';

function rankedMatchups(week, strategicTeam = null) {
  const usedOtherWeeks = usedTeamsSet(week);
  const pickThisWeek = selectedPickForWeek(week);

  return state.data.matchups
    .filter(m => m.week === Number(week))
    .map(matchup => {
      const p = probabilityFor(matchup);
      const used = usedOtherWeeks.has(matchup.team);
      const score = used ? 0 : survivorScore(matchup, state.data.matchups, usedOtherWeeks);
      const future = futureProfile(matchup.team, matchup.week, state.data.matchups, usedOtherWeeks);
      const rec = recommendationLabel(matchup, state.data.matchups, usedOtherWeeks);
      const strategicBest = matchup.team === strategicTeam;
      return { matchup, p, score, future, rec, used, selected: pickThisWeek === matchup.team, strategicBest };
    })
    .sort((a, b) => {
      if (a.used !== b.used) return a.used ? 1 : -1;
      if (a.strategicBest !== b.strategicBest) return a.strategicBest ? -1 : 1;
      return (b.score ?? -1) - (a.score ?? -1) || (b.p ?? -1) - (a.p ?? -1);
    });
}



function computeWhatIfComparison(teams) {
  if (!state.data || !teams.length) return [];
  const weeks = getDataWeeks();
  const alreadyUsed = usedTeamsSet(state.currentWeek);
  return compareWhatIf(state.data.matchups, weeks, alreadyUsed, state.currentWeek, teams);
}

function renderCompareBar() {
  const bar = els.compareBar;
  if (!bar) return;

  const teams = [...state.compareSelection];
  if (teams.length < 2) {
    bar.classList.add('hidden');
    bar.innerHTML = '';
    return;
  }

  const results = computeWhatIfComparison(teams);
  bar.classList.remove('hidden');
  bar.innerHTML = `
    <div class="compare-bar-head">
      <div>
        <span class="compare-bar-title">What if I use…</span>
        <span class="compare-bar-note">Remaining-season path if this pick is locked in for Week ${escapeHtml(String(state.currentWeek))}, playing optimally after. Incomplete model coverage is labeled rather than treated as a guaranteed week.</span>
      </div>
      <button type="button" id="compareClearBtn" class="small-button">Clear</button>
    </div>
    <div class="compare-bar-rows">
      ${results.map((result, index) => `
        <div class="compare-row${index === 0 ? ' is-best' : ''}">
          ${teamAvatar(result.team, true)}
          <div class="compare-row-copy">
            <span class="compare-row-team">${escapeHtml(result.team)}</span>
            <span class="compare-row-meta">${result.opponent ? `vs ${escapeHtml(result.opponent)} · ${fmtPct(result.p, 1)} this week` : 'No model data this week'}</span>
          </div>
          <div class="compare-row-stat">
            <span class="compare-row-value">${result.coverageComplete ? fmtPct(result.survivalProbability, 1) : fmtPct(result.modeledSurvivalProbability, 1)}</span>
            <span class="compare-row-label">${result.coverageComplete
              ? (index === 0 ? 'Best remaining path' : `${fmtPct(result.deltaFromBest, 1)} vs best`)
              : `${result.modeledWeekCount}/${result.requiredWeekCount} weeks modeled`}</span>
          </div>
          <button type="button" class="small-button compare-remove" data-compare-remove="${escapeHtml(result.team)}" aria-label="Remove ${escapeHtml(result.team)} from comparison">×</button>
        </div>`).join('')}
    </div>
  `;
}

function renderRankings(strategicTeam = null) {
  if (state.compareWeek !== state.currentWeek) {
    state.compareSelection = new Set();
    state.compareWeek = state.currentWeek;
  }

  const rankings = rankedMatchups(state.currentWeek, strategicTeam);
  if (!rankings.length) {
    els.rankingList.innerHTML = `<div class="empty-message">No eligible teams are available from ${escapeHtml(activePool().conference)}-involved games this week.</div>`;
    renderCompareBar();
    return;
  }

  const compareFull = state.compareSelection.size >= 4;

  const header = `
    <div class="ranking-head" aria-hidden="true">
      <span>Rank</span><span>Team / matchup</span><span>Win prob.</span><span>Spread</span><span>Survivor score</span><span>Future value</span><span></span>
    </div>`;

  const rows = rankings.map((item, index) => {
    const { matchup, p, score, future, rec, used, selected, strategicBest } = item;
    const result = resultLabel(matchup);
    const futureLabel = futureValueLabel(future);
    const scoreWidth = score === null ? 0 : Math.max(0, Math.min(100, score));
    const comparing = state.compareSelection.has(matchup.team);
    const compareDisabled = used || (!comparing && compareFull);
    return `
      <article class="rank-card${used ? ' used-card' : ''}${strategicBest && !used ? ' top-ranked path-ranked' : ''}" data-game-id="${matchup.gameId}" data-team="${escapeHtml(matchup.team)}">
        <div class="rank-number">${index + 1}</div>
        <div class="rank-team-wrap">
          ${teamAvatar(matchup.team)}
          <div class="rank-team-copy">
            <div class="team-name"><span class="team-name-text">${escapeHtml(matchup.team)}</span>${matchup.isConferenceMember === false ? '<span class="badge opponent">Opponent</span>' : ''}${strategicBest ? '<span class="badge good">Best path</span>' : ''}${selected ? '<span class="badge neutral">Your pick</span>' : ''}</div>
            <div class="matchup-meta">${escapeHtml(matchupLabel(matchup))}<span class="mobile-spread"> · ${escapeHtml(matchup.spread || '—')}</span>${result ? ` · ${escapeHtml(result)}` : ''}</div>
          </div>
        </div>
        <div class="rank-prob"><span class="stat-label">Win prob.</span><span class="probability-value">${fmtPct(p, 1)}</span><span class="prob-source">${escapeHtml(probabilitySourceLabel(matchup, true))}</span></div>
        <div class="rank-spread"><span class="stat-label">Spread</span><span class="stat-value">${escapeHtml(matchup.spread || '—')}</span></div>
        <div class="rank-score"><span class="stat-label">Survivor score</span><div class="score-wrap"><span class="stat-value">${score === null ? '—' : score.toFixed(1)}</span><span class="score-meter"><span style="width:${scoreWidth}%"></span></span></div></div>
        <div class="rank-future"><span class="stat-label">Future value</span><span class="badge ${futureLabel.tone}">${escapeHtml(futureLabel.text)}</span></div>
        <div class="rank-actions">
          <button type="button" class="small-button details-btn" data-action="details">Details</button>
          <button type="button" class="small-button compare-toggle${comparing ? ' is-active' : ''}" data-action="compare" ${compareDisabled ? 'disabled' : ''}>${comparing ? '✓ Comparing' : '+ Compare'}</button>
          <button type="button" class="small-button use" data-action="use" ${used ? 'disabled' : ''}>${selected ? 'Selected' : 'Use'}</button>
        </div>
        <div class="rank-mobile-details">
          <span><span class="mobile-detail-label">Score</span><strong>${score === null ? '—' : score.toFixed(1)}</strong></span>
          <span><span class="mobile-detail-label">Future</span><span class="badge ${futureLabel.tone}">${escapeHtml(futureLabel.text)}</span></span>
          <span><span class="mobile-detail-label">Model</span><strong>${escapeHtml(probabilitySourceLabel(matchup, true))}</strong></span>
        </div>
        <div class="rank-mobile-actions">
          <button type="button" class="small-button details-btn" data-action="details">Details</button>
          <button type="button" class="small-button compare-toggle${comparing ? ' is-active' : ''}" data-action="compare" ${compareDisabled ? 'disabled' : ''}>${comparing ? '✓ Comparing' : '+ Compare'}</button>
          <button type="button" class="small-button use" data-action="use" ${used ? 'disabled' : ''}>${selected ? 'Selected' : `Use ${escapeHtml(matchup.team)}`}</button>
        </div>
      </article>`;
  }).join('');

  els.rankingList.innerHTML = header + rows;
  renderCompareBar();
}

export { rankedMatchups, renderRankings };
