import { state, els, activePool, poolTeams, selectedPickForWeek, usedTeamsSet, getDataWeeks } from '../state.js';
import { sortTeamsByWeekProbability, bestSelectableSideForTeamWeek, probabilityFor } from '../survivor-score.js';
import { escapeHtml, fmtPct, probabilitySourceLabel, teamMeta, teamAvatar, resultLabel, probabilityClass } from '../render-utils.js';

function renderGrid() {
  const weeks = getDataWeeks();
  const used = usedTeamsSet();
  const byTeamWeek = new Map(state.data.matchups.map(m => [`${m.team}|${m.week}`, m]));
  const byGameTeam = new Map(state.data.matchups.map(m => [`${m.gameId}|${m.team}`, m]));

  const sortedWeek = Number(state.gridSortWeek) || null;
  // Sorting is survivor-oriented: rank each conference-team row by the best
  // currently selectable side in that game, not merely the conference
  // member's own probability. The focused week's pick is excluded from the
  // used set so an already-selected side still represents that week's game.
  const sortUsed = sortedWeek ? usedTeamsSet(sortedWeek) : new Set();
  const teamOrder = sortedWeek
    ? sortTeamsByWeekProbability(poolTeams(), state.data.matchups, sortedWeek, sortUsed)
    : poolTeams();

  const head = `<thead><tr><th class="team-col">${escapeHtml(activePool().conference)} team</th>${weeks.map(w => {
    const classes = [w === Number(state.currentWeek) ? 'current-week-col' : '', w === sortedWeek ? 'sorted-week-col' : ''].filter(Boolean).join(' ');
    const sorted = w === sortedWeek;
    return `<th class="${classes}"${sorted ? ' aria-sort="descending"' : ''}><button type="button" class="grid-week-button${sorted ? ' is-sorted' : ''}" data-grid-week="${w}" title="${sorted ? `Week ${w} sorted by best selectable side — click to reset` : `Sort Week ${w} by the best selectable win probability in each game`}"><span>Week ${w}</span><span class="grid-sort-indicator" aria-hidden="true">${sorted ? '↓' : '↕'}</span></button></th>`;
  }).join('')}</tr></thead>`;

  const body = teamOrder.map(team => {
    const cells = weeks.map(week => {
      const currentClass = week === Number(state.currentWeek) ? ' current-week-col' : '';
      const matchup = byTeamWeek.get(`${team}|${week}`);
      if (!matchup) return `<td class="${currentClass.trim()}"><div class="empty-cell">—</div></td>`;

      const opponentSide = byGameTeam.get(`${matchup.gameId}|${matchup.opponent}`) || null;
      const weekUsed = usedTeamsSet(week);
      const bestSelectable = bestSelectableSideForTeamWeek(team, state.data.matchups, week, weekUsed);
      const bestTeam = bestSelectable?.matchup?.team || null;
      const bestP = bestSelectable?.p ?? null;
      const selectedTeam = selectedPickForWeek(week);
      const sourceShort = probabilitySourceLabel(matchup, true);
      const locationShort = matchup.isNeutral ? 'N' : matchup.isHome ? 'H' : 'A';

      const sides = [matchup, opponentSide || {
        team: matchup.opponent,
        opponent: matchup.team,
        spread: null,
        winProbability: null,
        completed: matchup.completed
      }];

      const sideRows = sides.map(side => {
        const p = probabilityFor(side);
        const selected = selectedTeam === side.team;
        const sideUsed = used.has(side.team) && !selected;
        const result = side === matchup ? resultLabel(matchup) : (opponentSide ? resultLabel(opponentSide) : null);
        const isBest = bestTeam === side.team;
        const meta = teamMeta(side.team);
        const marker = result || (selected ? '✓' : isBest ? '★' : '');
        const markerTitle = result
          ? `${side.team}: ${result}`
          : selected
            ? `${side.team}: your pick`
            : isBest
              ? `${side.team}: best selectable side in this game`
              : '';
        return `<span class="cell-side${isBest ? ' is-best' : ''}${selected ? ' is-selected' : ''}${sideUsed ? ' is-used' : ''}" title="${escapeHtml(side.team)}${markerTitle ? ` · ${escapeHtml(markerTitle)}` : ''}">
          <span class="cell-side-marker" aria-hidden="true">${escapeHtml(marker)}</span>
          <span class="cell-side-team">${escapeHtml(meta.abbr)}</span>
          <span class="cell-side-spread">${escapeHtml(side.spread || '—')}</span>
          <span class="cell-side-prob">${fmtPct(p)}</span>
        </span>`;
      }).join('');

      const isSelectedGame = selectedTeam === matchup.team || selectedTeam === matchup.opponent;
      const bothUnavailable = !bestSelectable;
      const ariaBest = bestSelectable
        ? `Best selectable ${bestSelectable.matchup.team} ${fmtPct(bestP)}`
        : 'No modeled selectable side available';
      const cellAria = `${team} and ${matchup.opponent}. ${team} ${fmtPct(probabilityFor(matchup))}; ${matchup.opponent} ${fmtPct(probabilityFor(opponentSide))}. ${ariaBest}.`;

      return `<td class="${currentClass.trim()}">
        <button type="button" class="cell dual-side-cell ${probabilityClass(bestP)}${bothUnavailable ? ' no-selectable-side' : ''}${isSelectedGame ? ' selected-cell' : ''}" data-cell-game="${matchup.gameId}" data-cell-team="${escapeHtml(team)}" data-best-selectable-prob="${bestP === null ? '' : bestP}" data-best-selectable-team="${escapeHtml(bestTeam || '')}" aria-label="${escapeHtml(cellAria)}">
          <span class="cell-sides">${sideRows}</span>
          <span class="cell-foot"><span title="${matchup.isNeutral ? 'Neutral site' : matchup.isHome ? `${team} is home` : `${team} is away`}">${locationShort}</span><span>${escapeHtml(sourceShort)}</span></span>
        </button>
      </td>`;
    }).join('');
    return `<tr><td class="team-col"><div class="grid-team">${teamAvatar(team, true)}<div class="team-copy"><span class="grid-team-name">${escapeHtml(team)}</span><span class="grid-team-state">${used.has(team) ? 'Already used' : 'Available'}</span></div></div></td>${cells}</tr>`;
  }).join('');

  els.seasonGrid.innerHTML = `${head}<tbody>${body}</tbody>`;
}

export { renderGrid };
