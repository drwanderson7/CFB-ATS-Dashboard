import assert from 'node:assert/strict';
import {
  asNumber,
  clampProbability,
  deriveHomeProbability,
  normalizeGame,
  winProbabilityFromMargin
} from '../api/survivor-data.js';
import { probabilityFor } from '../js/survivor-score.js';

assert.equal(asNumber(null), null, 'null must stay missing');
assert.equal(asNumber(''), null, 'empty string must stay missing');
assert.equal(clampProbability(null), null, 'missing direct WP must not become 0%');
assert.equal(probabilityFor({ winProbability: null }), null, 'frontend scoring must not turn missing WP into zero');
assert.equal(probabilityFor({}), null, 'undefined WP must remain missing');
assert.ok(Math.abs(winProbabilityFromMargin(0) - 0.5) < 0.001, 'pick-em margin should be about 50%');
assert.ok(winProbabilityFromMargin(16) > 0.83 && winProbabilityFromMargin(16) < 0.85, '16-point projected edge should be about 84%');

const sp = new Map([['Ohio State', 25], ['Michigan', 17]]);
const derived = deriveHomeProbability(
  { homeTeam: 'Ohio State', awayTeam: 'Michigan', neutralSite: false },
  { spread: -7 },
  null,
  sp
);
assert.equal(derived.source, 'SP+ derived');
assert.ok(derived.homeWinProbability > 0.73, 'SP+ differential plus HFA should create a meaningful favorite');

const direct = deriveHomeProbability(
  { homeTeam: 'Ohio State', awayTeam: 'Michigan', neutralSite: false },
  { spread: -7 },
  0.63,
  sp
);
assert.equal(direct.source, 'CFBD pregame WP');
assert.equal(direct.homeWinProbability, 0.63, 'direct CFBD WP must take priority');

const spreadFallback = deriveHomeProbability(
  { homeTeam: 'Ohio State', awayTeam: 'Youngstown State', neutralSite: false },
  { spread: -28.5 },
  null,
  new Map([['Ohio State', 25]])
);
assert.equal(spreadFallback.source, 'Spread derived');
assert.ok(spreadFallback.homeWinProbability > 0.95, 'large market favorite should still receive a fallback probability');

const bigTenMembers = new Set(['Ohio State']);
const game = {
  id: 123,
  season: 2026,
  week: 1,
  homeTeam: 'Ohio State',
  awayTeam: 'Akron',
  neutralSite: false,
  completed: false,
  conferenceGame: false,
  startDate: '2026-09-05T16:00:00Z'
};
const normalized = normalizeGame(
  game,
  bigTenMembers,
  new Map([[123, { id: 123, lines: [{ spread: -24.5 }, { spread: -25.5 }] }]]),
  new Map(),
  new Map([['Ohio State', 25], ['Akron', -12]])
);
assert.equal(normalized.length, 2, 'both sides of a Big Ten-involved game should be selectable');
const ohioStateSide = normalized.find(side => side.team === 'Ohio State');
const akronSide = normalized.find(side => side.team === 'Akron');
assert.ok(ohioStateSide, 'conference member side should be present');
assert.ok(akronSide, 'non-conference opponent side should also be present');
assert.equal(ohioStateSide.isConferenceMember, true);
assert.equal(akronSide.isConferenceMember, false);
assert.equal(akronSide.opponentIsConferenceMember, true);
assert.equal(ohioStateSide.probabilitySource, 'SP+ derived');
assert.ok(ohioStateSide.winProbability > 0.98);
assert.ok(akronSide.winProbability < 0.02);
assert.ok(Math.abs((ohioStateSide.winProbability + akronSide.winProbability) - 1) < 1e-9, 'the two selectable sides should have complementary probabilities');

console.log('data-model tests passed');

// Unsupported seasons must fail closed before any CFBD request is attempted.
// The tool only has authoritative Splash eligibility for 2026; serving 2025
// as a generic conference schedule would change the pool rules.
const originalFetch = global.fetch;
const originalKey = process.env.CFBD_API_KEY;
process.env.CFBD_API_KEY = 'test-key';
let fetchCount = 0;
global.fetch = async () => {
  fetchCount += 1;
  throw new Error('unsupported season must not reach CFBD');
};

const { default: handler } = await import('../api/survivor-data.js');
let responseStatus = null;
let responseBody = null;
let cacheControl = null;
await handler(
  { query: { year: '2025', pool: 'bigten' } },
  {
    setHeader(name, value) { if (String(name).toLowerCase() === 'cache-control') cacheControl = value; },
    status(code) { responseStatus = code; return this; },
    json(body) { responseBody = body; return this; }
  }
);
assert.equal(responseStatus, 400, 'unsupported seasons must be rejected instead of falling back to a generic conference schedule');
assert.equal(responseBody.unsupportedSeason, 2025);
assert.deepEqual(responseBody.supportedSeasons, [2026]);
assert.match(responseBody.error, /2026/);
assert.match(cacheControl, /no-store/, 'unsupported-season responses should not be cached');
assert.equal(fetchCount, 0, 'unsupported seasons must fail before any CFBD API request');

global.fetch = originalFetch;
if (originalKey === undefined) delete process.env.CFBD_API_KEY;
else process.env.CFBD_API_KEY = originalKey;

console.log('unsupported-season API guard passed');

