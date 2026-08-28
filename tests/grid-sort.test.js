import assert from 'node:assert/strict';
import { bestSelectableSideForTeamWeek, sortTeamsByWeekProbability } from '../js/survivor-score.js';

const teams = ['Alabama', 'Arkansas', 'Auburn', 'Florida'];
const matchups = [
  { gameId: 401, team: 'Alabama', opponent: 'East Carolina', week: 4, winProbability: 0.68 },
  { gameId: 401, team: 'East Carolina', opponent: 'Alabama', week: 4, winProbability: 0.32 },
  { gameId: 402, team: 'Arkansas', opponent: 'Notre Dame', week: 4, winProbability: 0.19 },
  { gameId: 402, team: 'Notre Dame', opponent: 'Arkansas', week: 4, winProbability: 0.81 },
  { gameId: 403, team: 'Auburn', opponent: 'FCS Team', week: 4, winProbability: null },
  { gameId: 403, team: 'FCS Team', opponent: 'Auburn', week: 4, winProbability: null },
  { gameId: 404, team: 'Florida', opponent: 'UCF', week: 4, winProbability: 0.53 },
  { gameId: 404, team: 'UCF', opponent: 'Florida', week: 4, winProbability: 0.47 },

  { gameId: 501, team: 'Alabama', opponent: 'Vanderbilt', week: 5, winProbability: 0.74 },
  { gameId: 501, team: 'Vanderbilt', opponent: 'Alabama', week: 5, winProbability: 0.26 },
  { gameId: 502, team: 'Arkansas', opponent: 'Texas', week: 5, winProbability: 0.13 },
  { gameId: 502, team: 'Texas', opponent: 'Arkansas', week: 5, winProbability: 0.87 },
  { gameId: 503, team: 'Auburn', opponent: 'Georgia', week: 5, winProbability: 0.30 },
  { gameId: 503, team: 'Georgia', opponent: 'Auburn', week: 5, winProbability: 0.70 },
  { gameId: 504, team: 'Florida', opponent: 'LSU', week: 5, winProbability: 0.43 },
  { gameId: 504, team: 'LSU', opponent: 'Florida', week: 5, winProbability: 0.57 }
];

assert.equal(
  bestSelectableSideForTeamWeek('Arkansas', matchups, 4)?.matchup.team,
  'Notre Dame',
  'Best side helper should consider the non-conference opponent, not only the conference row team.'
);

assert.deepEqual(
  sortTeamsByWeekProbability(teams, matchups, 4),
  ['Arkansas', 'Alabama', 'Florida', 'Auburn'],
  'Week sort should rank each game by its best selectable side and put missing modeled games last.'
);

assert.deepEqual(
  sortTeamsByWeekProbability(teams, matchups, 5),
  ['Arkansas', 'Alabama', 'Auburn', 'Florida'],
  'Sorting a different week should use the best selectable side in that week.'
);

assert.deepEqual(
  sortTeamsByWeekProbability(teams, matchups, 4, new Set(['Notre Dame'])),
  ['Alabama', 'Florida', 'Arkansas', 'Auburn'],
  'A previously used opponent must not continue to make that game sort as an 81% selectable option.'
);

assert.deepEqual(teams, ['Alabama', 'Arkansas', 'Auburn', 'Florida'], 'Sorting must not mutate canonical conference-team order.');

console.log('grid-sort.test.js passed');
