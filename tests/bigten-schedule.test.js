import assert from 'node:assert/strict';
import {
  BIGTEN_POOL_SCHEDULE_2026,
  BIGTEN_POOL_WEEK_GAME_COUNTS_2026,
  applyBigTenPoolSchedule,
  gameScheduleKey
} from '../data/bigten-pool-schedule-2026.js';

assert.equal(BIGTEN_POOL_SCHEDULE_2026.length, 122, '2026 Big Ten Splash schedule (all 13 weeks) must contain 122 games');

const counts = Array.from({ length: 13 }, (_, index) =>
  BIGTEN_POOL_SCHEDULE_2026.filter(game => game.week === index + 1).length
);
const expectedCounts = [14, 15, 11, 9, 8, 8, 7, 6, 9, 8, 9, 9, 9];
assert.deepEqual(counts, expectedCounts, 'weekly game counts must match the supplied Splash screenshots');
assert.deepEqual(counts, BIGTEN_POOL_WEEK_GAME_COUNTS_2026);
assert.ok(BIGTEN_POOL_WEEK_GAME_COUNTS_2026.every(count => count !== null), 'all 13 weeks should now be supplied — no gap weeks remain');

// Alias support: CFBD's exact school-name spelling for a few non-conference
// opponents (Cal/California, UConn/Connecticut, Louisiana) can't be verified
// without a live API key, so both common spellings must resolve to the same key.
assert.equal(gameScheduleKey('Cal', 'UCLA'), gameScheduleKey('California', 'UCLA'));
assert.equal(gameScheduleKey('Connecticut', 'Maryland'), gameScheduleKey('UConn', 'Maryland'));
assert.equal(gameScheduleKey('Louisiana', 'USC'), gameScheduleKey('Louisiana-Lafayette', 'USC'));

const fixture = [
  { id: 1, season: 2026, week: 99, homeTeam: 'Ohio State', awayTeam: 'Kent State' }, // listed, week 3
  { id: 2, season: 2026, week: 99, homeTeam: 'Ohio State', awayTeam: 'Akron' }, // NOT listed — must be excluded
  { id: 3, season: 2026, week: 99, homeTeam: 'Michigan', awayTeam: 'Western Michigan' } // listed, week 1
];
const filtered = applyBigTenPoolSchedule(fixture, 2026);
assert.equal(filtered.authoritative, true);
assert.equal(filtered.games.length, 2, 'only listed Splash games should survive the schedule filter');
assert.ok(!filtered.games.some(game => game.id === 2), 'unlisted Big Ten-involving game must be excluded');
assert.equal(filtered.games.find(game => game.id === 1)?.week, 3, 'Splash pool week must override source week');
assert.equal(filtered.games.find(game => game.id === 3)?.week, 1, 'Splash pool week must override source week');

// Confirm specific games from each end of the transcribed schedule are preserved,
// including Week 11 (supplied separately from the initial screenshot batch).
const keys = new Set(BIGTEN_POOL_SCHEDULE_2026.map(game => `${game.week}:${gameScheduleKey(...game.teams)}`));
assert.ok(keys.has(`1:${gameScheduleKey('Wisconsin', 'Notre Dame')}`));
assert.ok(keys.has(`2:${gameScheduleKey('Ohio State', 'Texas')}`));
assert.ok(keys.has(`11:${gameScheduleKey('Illinois', 'UCLA')}`));
assert.ok(keys.has(`11:${gameScheduleKey('Northwestern', 'Ohio State')}`));
assert.ok(keys.has(`13:${gameScheduleKey('Michigan', 'Ohio State')}`));
assert.ok(keys.has(`13:${gameScheduleKey('Purdue', 'Indiana')}`));

console.log('Big Ten Splash schedule tests passed');

// End-to-end handler fixture: the 2026 Big Ten board must apply the
// authoritative Splash schedule (a game the two teams actually play that
// isn't on the Splash list must be excluded), and — now that Week 11 has
// been supplied — must NOT warn about a schedule gap.
const originalFetch = global.fetch;
const originalKey = process.env.CFBD_API_KEY;
process.env.CFBD_API_KEY = 'test-key';
global.fetch = async urlInput => {
  const url = new URL(String(urlInput));
  let payload = [];
  if (url.pathname === '/games') {
    payload = [
      // On the Splash list (week 3): Ohio State vs Kent State.
      { id: 301, season: 2026, week: 3, homeTeam: 'Ohio State', awayTeam: 'Kent State', neutralSite: false, completed: false, conferenceGame: false },
      // Not on the Splash list at all — must be excluded from the board.
      { id: 302, season: 2026, week: 3, homeTeam: 'Ohio State', awayTeam: 'Rutgers', neutralSite: false, completed: false, conferenceGame: true },
      // On the Splash list (week 11): Northwestern vs Ohio State.
      { id: 303, season: 2026, week: 11, homeTeam: 'Northwestern', awayTeam: 'Ohio State', neutralSite: false, completed: false, conferenceGame: true }
    ];
  } else if (url.pathname === '/lines') {
    payload = [{ id: 301, lines: [{ spread: -20 }] }, { id: 303, lines: [{ spread: -10 }] }];
  } else if (url.pathname === '/ratings/sp') {
    payload = [{ team: 'Ohio State', rating: 25 }, { team: 'Kent State', rating: -18 }, { team: 'Northwestern', rating: 5 }];
  } else if (url.pathname === '/metrics/wp/pregame') {
    payload = [];
  }
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
};

const { default: handler } = await import('../api/survivor-data.js');
let responseStatus = null;
let responseBody = null;
await handler(
  { query: { year: '2026', pool: 'bigten' } },
  {
    status(code) { responseStatus = code; return this; },
    json(body) { responseBody = body; return this; }
  }
);
assert.equal(responseStatus, 200);
assert.equal(responseBody.poolId, 'bigten');
assert.deepEqual(
  new Set(responseBody.matchups.map(side => side.team)),
  new Set(['Ohio State', 'Kent State', 'Northwestern']),
  'the Rutgers game (not on the Splash list) must not appear, but the Week 3 and Week 11 listed games must both appear'
);
assert.ok(
  responseBody.matchups.some(side => side.team === 'Ohio State' && side.week === 11),
  'the Week 11 Northwestern @ Ohio State game must appear on Week 11, not fall through to a schedule gap'
);
assert.ok(
  !responseBody.warnings.some(w => /[Ww]eek 11/.test(w)),
  'no week-11 gap warning should fire now that week 11 has been supplied'
);
assert.match(responseBody.scheduleSource, /Splash/);
assert.match(responseBody.eligibilityRule, /Splash/);

global.fetch = originalFetch;
if (originalKey === undefined) delete process.env.CFBD_API_KEY;
else process.env.CFBD_API_KEY = originalKey;

console.log('Big Ten handler fixture passed');

// Frontend chrome helper: hasAuthoritativeSchedule() drives whether the UI
// says "Splash schedule" for a pool/year — confirm it reports both SEC and
// Big Ten as authoritative for 2026, and everything else as not.
const { hasAuthoritativeSchedule } = await import('../js/demo-data.js');
assert.equal(hasAuthoritativeSchedule('sec', 2026), true);
assert.equal(hasAuthoritativeSchedule('bigten', 2026), true);
assert.equal(hasAuthoritativeSchedule('bigten', 2025), false, 'no authoritative schedule exists for other years yet');
assert.equal(hasAuthoritativeSchedule('nonexistent-pool', 2026), false);

console.log('demo-data authoritative-schedule helper tests passed');
