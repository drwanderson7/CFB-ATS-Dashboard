import { state, els, selectedPickForWeek, usedTeamsSet, getDataWeeks } from '../state.js';
import { pickResultFor } from '../results.js';
import { escapeHtml, teamAvatar } from '../render-utils.js';
import { renderEntryControls } from '../entry-controls.js';

function renderPicks() {
  renderEntryControls();
  const weeks = state.data ? getDataWeeks() : [...new Set(Object.keys(state.picks).map(Number))].sort((a,b)=>a-b);
  const displayWeeks = weeks.length ? weeks : [1,2,3,4];

  els.pickHistory.innerHTML = displayWeeks.map(week => {
    const team = selectedPickForWeek(week);
    const result = team && state.data ? pickResultFor(state.data.matchups, week, team, Date.now()) : null;
    const resultClass = result ? ` is-${result.status}` : '';
    const resultMarkup = result
      ? `<span class="pick-result${resultClass}">${escapeHtml(result.label)}</span>`
      : '';
    return `<div class="pick-row">
      <span class="pick-week">Week ${week}</span>
      <span class="pick-team">${team ? `<span class="rank-team-wrap">${teamAvatar(team, true)}<span>${escapeHtml(team)}</span></span>${resultMarkup}` : '<span class="no-pick">No pick yet</span>'}</span>
      ${team ? `<button type="button" class="remove-pick" data-remove-week="${week}">Remove</button>` : ''}
    </div>`;
  }).join('');

  const used = [...usedTeamsSet()].sort();
  els.usedTeams.innerHTML = used.length
    ? used.map(team => `<span class="used-pill">${teamAvatar(team, true)}<span>${escapeHtml(team)}</span></span>`).join('')
    : '<span class="matchup-meta">No teams used yet.</span>';
}

export { renderPicks };
