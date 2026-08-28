// Pure display/formatting helpers used across every view — no dependency
// on app state, only on the arguments each function is given. Extracted
// from js/app.js (architecture cleanup pass).

import { TEAM_META } from './pools.js';
import { pickResultFor } from './results.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function fmtPct(value, digits = 0) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return '—';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${(number * 100).toFixed(digits)}%`;
}

function probabilitySourceLabel(matchup, compact = false) {
  if (!matchup?.probabilitySource) return compact ? '—' : 'Unavailable';
  if (compact) return matchup.probabilitySourceShort || matchup.probabilitySource;
  return matchup.probabilitySource;
}

function teamMeta(team) {
  return TEAM_META[team] || { abbr: String(team || '?').slice(0, 3).toUpperCase(), color: '#344054' };
}

function teamAvatar(team, small = false) {
  const meta = teamMeta(team);
  return `<span class="team-avatar${small ? ' small' : ''}" style="--team-color:${meta.color}">${escapeHtml(meta.abbr)}</span>`;
}

function matchupLabel(matchup) {
  if (matchup.isNeutral) return `vs ${matchup.opponent} · neutral`;
  return `${matchup.isHome ? 'vs' : '@'} ${matchup.opponent}`;
}

function resultLabel(matchup) {
  if (!matchup) return null;
  const result = pickResultFor([matchup], matchup.week, matchup.team);
  return ['win','loss','tie'].includes(result.status) ? result.label : null;
}

function formatSyncTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatPointDelta(delta) {
  if (delta === null || delta === undefined || !Number.isFinite(Number(delta))) return '—';
  const points = Number(delta) * 100;
  return `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`;
}

function futureValueLabel(future) {
  if (future.best === null) return { text: 'Low', tone: 'neutral' };
  if (future.value >= 0.78) return { text: 'High — save', tone: 'warn' };
  if (future.value >= 0.62) return { text: 'Medium', tone: 'neutral' };
  return { text: 'Low', tone: 'good' };
}

function probabilityClass(p) {
  if (p === null) return '';
  if (p >= 0.9) return 'elite';
  if (p >= 0.8) return 'strong';
  if (p >= 0.7) return 'medium';
  return 'risky';
}

export {
  escapeHtml,
  fmtPct,
  probabilitySourceLabel,
  teamMeta,
  teamAvatar,
  matchupLabel,
  resultLabel,
  formatSyncTimestamp,
  formatPointDelta,
  futureValueLabel,
  probabilityClass
};
