import assert from 'node:assert/strict';
import fs from 'node:fs';
import handler from '../api/survivor-data.js';
import { mergeResultRefresh } from '../js/result-refresh.js';


const syncUiSource = fs.readFileSync(new URL('../js/sync-ui.js', import.meta.url), 'utf8');
const appSource = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(syncUiSource, /RESULTS_REFRESH_MS = 5 \* 60 \* 1000/, 'live results should remain on a five-minute cadence');
assert.match(syncUiSource, /MODEL_REFRESH_MS = 30 \* 60 \* 1000/, 'full model data should refresh much less often');
assert.match(syncUiSource, /appCallbacks\.refreshResults\?\.\(\)/, 'five-minute timer should use the lightweight results callback');
assert.match(syncUiSource, /loadData\?\.\(\{ silent: true \}\)/, 'background model refresh should be silent and non-destructive');
assert.match(appSource, /mode=results/, 'browser result refresh must request results-only API mode');
assert.match(appSource, /forceFresh \? \{ cache: 'no-store' \} : undefined/, 'normal full loads should remain eligible for shared edge caching');
assert.match(appSource, /silent && previousData/, 'failed background model refresh must preserve the loaded board');
assert.match(htmlSource, /Refresh live results/, 'manual refresh should accurately describe its cheaper behavior');

const originalFetch = global.fetch;
const originalKey = process.env.CFBD_API_KEY;
process.env.CFBD_API_KEY = 'test-key';
const calls = [];
global.fetch = async input => {
  const url = new URL(String(input));
  calls.push(url.pathname);
  if (url.pathname !== '/games') throw new Error(`results-only mode should not call ${url.pathname}`);
  return {
    ok: true,
    status: 200,
    json: async () => [{
      id: 77, season: 2026, week: 3,
      homeTeam: 'Georgia', awayTeam: 'Arkansas',
      completed: true, homePoints: 31, awayPoints: 17,
      startDate: '2026-09-12T19:30:00Z'
    }],
    text: async () => ''
  };
};

let body, status, cache;
await handler(
  { query: { year: '2026', pool: 'sec', mode: 'results' } },
  { setHeader(name, value) { if (name.toLowerCase() === 'cache-control') cache = value; }, status(code) { status = code; return this; }, json(value) { body = value; return this; } }
);
assert.equal(status, 200);
assert.deepEqual(calls, ['/games'], 'results-only polling must make exactly one CFBD call');
assert.match(cache, /s-maxage=60/);
assert.equal(body.mode, 'results');
assert.equal(body.games[0].homePoints, 31);
assert.equal(body.results.source, 'CFBD /games');

const before = {
  generatedAt: '2026-08-28T10:00:00Z',
  matchups: [
    { gameId: 77, team: 'Georgia', opponent: 'Arkansas', winProbability: 0.91, spread: '-15.5', completed: false, teamPoints: null, opponentPoints: null, startDate: '2026-09-12T16:00:00Z' },
    { gameId: 77, team: 'Arkansas', opponent: 'Georgia', winProbability: 0.09, spread: '+15.5', completed: false, teamPoints: null, opponentPoints: null, startDate: '2026-09-12T16:00:00Z' }
  ],
  results: { source: 'CFBD /games' }
};
const merged = mergeResultRefresh(before, body);
assert.equal(merged.matchups[0].completed, true);
assert.equal(merged.matchups[0].teamPoints, 31);
assert.equal(merged.matchups[0].opponentPoints, 17);
assert.equal(merged.matchups[1].teamPoints, 17);
assert.equal(merged.matchups[1].opponentPoints, 31);
assert.equal(merged.matchups[0].winProbability, 0.91, 'result merge must preserve model inputs');
assert.equal(merged.matchups[0].spread, '-15.5', 'result merge must preserve lines');
assert.equal(merged.results.refreshMode, 'results-only');
assert.equal(merged.modelGeneratedAt, '2026-08-28T10:00:00Z');

calls.length = 0;
await handler(
  { query: { year: '2026', pool: 'sec', mode: 'results', fresh: '1' } },
  { setHeader(name, value) { if (name.toLowerCase() === 'cache-control') cache = value; }, status(code) { status = code; return this; }, json(value) { body = value; return this; } }
);
assert.deepEqual(calls, ['/games']);
assert.match(cache, /no-store/);

if (originalKey === undefined) delete process.env.CFBD_API_KEY; else process.env.CFBD_API_KEY = originalKey;
global.fetch = originalFetch;
console.log('results polling tests passed');
