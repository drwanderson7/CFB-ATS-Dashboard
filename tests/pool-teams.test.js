import assert from 'node:assert/strict';
import { POOL_DEFINITIONS, getPoolDefinition } from '../data/pool-teams.js';
import { POOLS, getPool, TEAM_META } from '../js/pools.js';

// Regression guard for the roster-duplication bug: js/pools.js (frontend) and
// api/survivor-data.js (API) previously each hardcoded their own independent
// copy of the SEC/Big Ten team lists, which could silently drift apart (a
// realignment change or a typo fix made in one file but not the other). Both
// now import from data/pool-teams.js. These assertions confirm the frontend
// re-export is really the same object/values as the shared source, not a
// second hand-maintained copy that happens to match today.

assert.equal(POOLS, POOL_DEFINITIONS, 'js/pools.js should re-export the shared POOL_DEFINITIONS, not its own copy');
assert.equal(getPool('sec'), getPoolDefinition('sec'), 'getPool() should resolve through the shared getPoolDefinition()');

assert.deepEqual(POOL_DEFINITIONS.sec.teams, [
  'Alabama', 'Arkansas', 'Auburn', 'Florida', 'Georgia', 'Kentucky', 'LSU',
  'Mississippi State', 'Missouri', 'Oklahoma', 'Ole Miss', 'South Carolina',
  'Tennessee', 'Texas', 'Texas A&M', 'Vanderbilt'
]);
assert.equal(POOL_DEFINITIONS.sec.teams.length, 16, 'SEC pool should have 16 member teams');

assert.deepEqual(POOL_DEFINITIONS.bigten.teams, [
  'Illinois', 'Indiana', 'Iowa', 'Maryland', 'Michigan', 'Michigan State',
  'Minnesota', 'Nebraska', 'Northwestern', 'Ohio State', 'Oregon', 'Penn State',
  'Purdue', 'Rutgers', 'UCLA', 'USC', 'Washington', 'Wisconsin'
]);
assert.equal(POOL_DEFINITIONS.bigten.teams.length, 18, 'Big Ten pool should have 18 member teams');

// Every rostered team should have a TEAM_META entry so the UI never falls back
// to the generic 3-letter/gray-badge default for a real conference member.
for (const [poolId, def] of Object.entries(POOL_DEFINITIONS)) {
  for (const team of def.teams) {
    assert.ok(TEAM_META[team], `TEAM_META is missing an entry for ${team} (${poolId})`);
  }
}

// cfbdConference doubles as the UI's short conference label (brand mark text) —
// confirm it still holds the expected CFBD abbreviations.
assert.equal(POOL_DEFINITIONS.sec.cfbdConference, 'SEC');
assert.equal(POOL_DEFINITIONS.bigten.cfbdConference, 'B1G');

console.log('pool-teams tests passed');
