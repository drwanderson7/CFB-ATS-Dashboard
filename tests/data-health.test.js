import assert from 'node:assert/strict';
import { buildDataHealth, probabilityCoverageFromMatchups } from '../js/data-health.js';

const matchups = [
  { gameId: 1, winProbability: .9, probabilitySource: 'CFBD pregame WP' },
  { gameId: 1, winProbability: .1, probabilitySource: 'CFBD pregame WP' },
  { gameId: 2, winProbability: .75, probabilitySource: 'SP+ derived' },
  { gameId: 2, winProbability: null, probabilitySource: null }
];

const fallback = probabilityCoverageFromMatchups(matchups);
assert.equal(fallback.total, 4);
assert.equal(fallback.modeled, 3);
assert.equal(fallback.missing, 1);
assert.equal(fallback.bySource.direct, 2);
assert.equal(fallback.bySource.sp, 1);

const degraded = buildDataHealth({
  generatedAt: '2026-08-28T12:00:00.000Z',
  poolSchedule: { expectedGames: 106, matchedGames: 104, missingGames: [{ week: 2, teams: ['A', 'B'] }] },
  matchups,
  coverage: { selectableSides: 4, missingProbability: 1, directPregame: 2, spDerived: 1, spreadDerived: 0 },
  results: { source: 'CFBD /games' },
  warnings: ['Two games missing.']
});
assert.equal(degraded.tone, 'error');
assert.equal(degraded.schedule.complete, false);
assert.equal(degraded.probability.modeled, 3);
assert.equal(degraded.results.live, true);

const healthy = buildDataHealth({
  generatedAt: '2026-08-28T12:00:00.000Z',
  poolSchedule: { expectedGames: 106, matchedGames: 106, missingGames: [] },
  matchups: matchups.slice(0, 3),
  coverage: { selectableSides: 3, missingProbability: 0, directPregame: 2, spDerived: 1, spreadDerived: 0 },
  results: { source: 'CFBD /games' },
  warnings: []
});
assert.equal(healthy.tone, 'healthy');
assert.equal(healthy.schedule.label, '106/106');
assert.equal(healthy.probability.complete, true);

console.log('data health tests passed');
