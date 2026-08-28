import { state, els, activePool, selectedPickForWeek, usedTeamsSet } from '../state.js';
import { futureProfile, probabilityFor, recommendationLabel, survivorScore } from '../survivor-score.js';
import { escapeHtml, fmtPct, probabilitySourceLabel, teamAvatar, matchupLabel, futureValueLabel } from '../render-utils.js';

function lookupMatchup(gameId, team) {
  return state.data?.matchups.find(m => Number(m.gameId) === Number(gameId) && m.team === team) || null;
}

function opponentSideFor(matchup) {
  if (!matchup || !state.data) return null;
  return state.data.matchups.find(m => Number(m.gameId) === Number(matchup.gameId) && m.team === matchup.opponent) || null;
}

function pickButtonCopy(matchup) {
  if (!matchup) return { disabled: true, text: 'Unavailable' };
  const usedElsewhere = usedTeamsSet(matchup.week).has(matchup.team);
  const selected = selectedPickForWeek(matchup.week) === matchup.team;
  if (usedElsewhere) return { disabled: true, text: `${matchup.team} used` };
  if (selected) return { disabled: false, text: `${matchup.team} selected` };
  if (selectedPickForWeek(matchup.week)) return { disabled: false, text: `Replace with ${matchup.team}` };
  return { disabled: false, text: `Use ${matchup.team}` };
}

function openMatchup(matchup) {
  if (!matchup) return;
  state.selectedMatchup = matchup;
  const opponentSide = opponentSideFor(matchup);
  const score = survivorScore(matchup, state.data.matchups, usedTeamsSet(matchup.week));
  const future = futureProfile(matchup.team, matchup.week, state.data.matchups, usedTeamsSet(matchup.week));
  const rec = recommendationLabel(matchup, state.data.matchups, usedTeamsSet(matchup.week));
  const p = probabilityFor(matchup);
  const futureLabel = futureValueLabel(future);
  const opponentP = probabilityFor(opponentSide);
  const opponentScore = opponentSide ? survivorScore(opponentSide, state.data.matchups, usedTeamsSet(opponentSide.week)) : null;
  const primaryState = pickButtonCopy(matchup);
  const opponentState = pickButtonCopy(opponentSide);

  const dialogLabel = Number(matchup.week) === Number(state.currentWeek) && matchup.team === state.recommendationPlan?.recommendation?.team ? 'Best path' : rec.label;
  els.dialogWeek.textContent = `Week ${matchup.week} · ${dialogLabel}`;
  els.dialogTitle.textContent = `${matchup.team} ${matchupLabel(matchup)}`;
  els.dialogBody.innerHTML = `
    <div class="eligibility-callout"><strong>Either side is eligible.</strong> This game counts because it involves ${escapeHtml(activePool().conference)}. Once you use either team, that team cannot be used again in this entry.</div>
    <div class="side-compare" aria-label="Eligible sides">
      <div class="side-option${matchup.isConferenceMember === false ? ' opponent-side' : ''}">
        <div class="side-team">${teamAvatar(matchup.team, true)}<span>${escapeHtml(matchup.team)}</span>${matchup.isConferenceMember === false ? '<span class="badge opponent">Opponent</span>' : ''}</div>
        <strong>${fmtPct(p, 1)}</strong>
        <span>${escapeHtml(matchup.spread || '—')} · score ${score === null ? '—' : score.toFixed(1)}</span>
        <button type="button" class="button side-pick-cta" data-dialog-pick-team="${escapeHtml(matchup.team)}" ${primaryState.disabled ? 'disabled' : ''}>${escapeHtml(primaryState.text)}</button>
      </div>
      ${opponentSide ? `<div class="side-option${opponentSide.isConferenceMember === false ? ' opponent-side' : ''}">
        <div class="side-team">${teamAvatar(opponentSide.team, true)}<span>${escapeHtml(opponentSide.team)}</span>${opponentSide.isConferenceMember === false ? '<span class="badge opponent">Opponent</span>' : ''}</div>
        <strong>${fmtPct(opponentP, 1)}</strong>
        <span>${escapeHtml(opponentSide.spread || '—')} · score ${opponentScore === null ? '—' : opponentScore.toFixed(1)}</span>
        <button type="button" class="button side-pick-cta" data-dialog-pick-team="${escapeHtml(opponentSide.team)}" ${opponentState.disabled ? 'disabled' : ''}>${escapeHtml(opponentState.text)}</button>
      </div>` : ''}
    </div>
    <div class="dialog-metrics">
      <div class="dialog-metric"><span class="stat-label">${escapeHtml(matchup.team)} win probability</span><strong>${fmtPct(p, 1)}</strong><span class="prob-source">${escapeHtml(probabilitySourceLabel(matchup))}</span></div>
      <div class="dialog-metric"><span class="stat-label">Spread</span><strong>${escapeHtml(matchup.spread || '—')}</strong></div>
      <div class="dialog-metric"><span class="stat-label">Survivor score</span><strong>${score === null ? '—' : score.toFixed(1)}</strong></div>
    </div>
    <div class="dialog-context">Future value for ${escapeHtml(matchup.team)}: <strong>${escapeHtml(futureLabel.text)}</strong>. ${matchup.teamSpRating !== null && matchup.teamSpRating !== undefined && matchup.opponentSpRating !== null && matchup.opponentSpRating !== undefined ? `SP+ ratings: ${escapeHtml(matchup.team)} ${Number(matchup.teamSpRating).toFixed(1)}, ${escapeHtml(matchup.opponent)} ${Number(matchup.opponentSpRating).toFixed(1)}${matchup.modelProjectedMargin !== null && matchup.modelProjectedMargin !== undefined ? ` · projected margin ${Number(matchup.modelProjectedMargin) > 0 ? '+' : ''}${Number(matchup.modelProjectedMargin).toFixed(1)}` : ''}. ` : ''}${matchup.lineProviders ? `${matchup.lineProviders} line provider${matchup.lineProviders === 1 ? '' : 's'}.` : 'No betting line.'}</div>
    <div class="future-spots">
      <h3>Best future spots if you save ${escapeHtml(matchup.team)}</h3>
      ${future.opportunities.slice(0, 4).map(spot => `<div class="future-spot"><span>Week ${spot.week} ${escapeHtml(matchupLabel(spot))}</span><strong>${fmtPct(spot.p, 1)}</strong></div>`).join('') || '<div class="matchup-meta">No future modeled games available.</div>'}
    </div>`;

  els.useTeamBtn.disabled = primaryState.disabled;
  els.useTeamBtn.textContent = primaryState.text;

  els.useOpponentBtn.hidden = !opponentSide;
  els.useOpponentBtn.disabled = opponentState.disabled;
  els.useOpponentBtn.textContent = opponentState.text;

  if (typeof els.matchupDialog.showModal === 'function') els.matchupDialog.showModal();
}

export { lookupMatchup, opponentSideFor, openMatchup };
