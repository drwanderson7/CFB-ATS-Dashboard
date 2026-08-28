import assert from 'node:assert/strict';
import {
  SEC_POOL_SCHEDULE_2026,
  SEC_POOL_WEEK_GAME_COUNTS_2026,
  applySecPoolSchedule,
  gameScheduleKey
} from '../data/sec-pool-schedule-2026.js';

assert.equal(SEC_POOL_SCHEDULE_2026.length, 106, '2026 SEC Splash schedule must contain 106 games');
const counts = Array.from({ length: 13 }, (_, index) =>
  SEC_POOL_SCHEDULE_2026.filter(game => game.week === index + 1).length
);
assert.deepEqual(counts, SEC_POOL_WEEK_GAME_COUNTS_2026, 'weekly game counts must match the supplied Splash screenshots');
assert.deepEqual(counts, [10, 13, 11, 9, 6, 7, 7, 6, 5, 8, 8, 6, 10]);

// Alias support is required because CFBD has historically used "UL Monroe"
// while pool displays may spell the school as Louisiana-Monroe.
assert.equal(
  gameScheduleKey('Louisiana-Monroe', 'Mississippi State'),
  gameScheduleKey('UL Monroe', 'Mississippi State')
);

const fixture = [
  { id: 1, season: 2026, week: 99, homeTeam: 'Oklahoma', awayTeam: 'UTEP' },
  { id: 2, season: 2026, week: 99, homeTeam: 'Alabama', awayTeam: 'East Carolina' },
  { id: 3, season: 2026, week: 99, homeTeam: 'Alabama', awayTeam: 'FCS Example' }, // must be excluded
  { id: 4, season: 2026, week: 99, homeTeam: 'Mississippi State', awayTeam: 'Louisiana-Monroe' }
];
const filtered = applySecPoolSchedule(fixture, 2026);
assert.equal(filtered.authoritative, true);
assert.equal(filtered.games.length, 3, 'only listed Splash games should survive the schedule filter');
assert.ok(!filtered.games.some(game => game.id === 3), 'unlisted SEC-vs-non-FBS game must be excluded');
assert.equal(filtered.games.find(game => game.id === 1)?.week, 1, 'Splash pool week must override source week');
assert.equal(filtered.games.find(game => game.id === 4)?.week, 1, 'UL Monroe alias must match the supplied schedule');

// Confirm specific late-season games supplied by the user are preserved.
const keys = new Set(SEC_POOL_SCHEDULE_2026.map(game => `${game.week}:${gameScheduleKey(...game.teams)}`));
assert.ok(keys.has(`13:${gameScheduleKey('Florida', 'Florida State')}`));
assert.ok(keys.has(`13:${gameScheduleKey('South Carolina', 'Clemson')}`));
assert.ok(keys.has(`13:${gameScheduleKey('Georgia Tech', 'Georgia')}`));
assert.ok(keys.has(`13:${gameScheduleKey('Louisville', 'Kentucky')}`));

console.log('SEC Splash schedule tests passed');
