import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Reproduces Drew's exact real-world report: "it says the results fetched
// but rutgers still says pending". Root cause: fetchTeamLogos(true) (what
// the Fetch Results button calls to refresh scores from CFBD's free-tier
// /games endpoint) only refreshes the shared cfbdGames array. It does NOT
// rebuild pgSurvivorCandidateGames -- Survivor's own candidate-game
// snapshot, built once inside buildPickGaugeSurvivorData() and never
// otherwise invalidated. refreshPickGaugeSurvivorResults() matches each
// matchup's gameId against that STALE snapshot, so a genuinely fresh
// cfbdGames sat right next to a matchup that still couldn't see it.
//
// This test drives the real production functions from
// app/js/survivor-data-adapter.js (not a reimplementation): builds real
// Survivor data while the game is still in progress (no score), simulates
// a fetchTeamLogos(true) refresh landing a final score in cfbdGames, shows
// the bug reproduces exactly as reported, then shows that rebuilding via
// buildPickGaugeSurvivorData() -- what pgSurvivorEnsureSharedData(true)
// now does inside the fixed pgSurvivorFetchResultsNow() -- resolves it.

const source = fs.readFileSync(new URL('../app/js/survivor-data-adapter.js', import.meta.url), 'utf8');
const context = vm.createContext({
  console, Math, Date, Number, String, Array, Object, Set, Map, JSON,
  window: {
    PickGaugeSurvivorCore: {
      manifest: { schedules: { bigten: { applyExport: 'applyBigTenPoolSchedule' } } },
      schedules: { bigten: { applyBigTenPoolSchedule(games) { return { games, missing: [] }; } } },
    },
  },
  localStorage: { getItem() { return null; }, setItem() {} },
  cfbdScoreboard: [], games: [], teamLogos: [],
  teamMatch: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
});
vm.runInContext(source, context, { filename: 'survivor-data-adapter.js' });
const run = (expr) => vm.runInContext(expr, context);

// One real game, matching the actual Rutgers/Massachusetts shape -- kicked
// off, still in progress: completed:false, no score yet.
context.cfbdGames = [{
  id: 401858423, season: 2026, week: 1, startDate: '2026-09-03T22:00:00Z',
  homeId: 164, homeTeam: 'Rutgers', homeConference: 'Big Ten',
  awayId: 113, awayTeam: 'Massachusetts', awayConference: 'Mid-American',
  neutralSite: false, completed: false, homePoints: null, awayPoints: null,
}];
context.cfbdRatings = [
  { team: 'Rutgers', sp: { rating: 12 } },
  { team: 'Massachusetts', sp: { rating: -8 } },
];

const dataV1 = run(`buildPickGaugeSurvivorData('bigten')`);
context.pgSurvivorData = dataV1;
const rutgersMatchupV1 = dataV1.matchups.find(m => m.team === 'Rutgers' && m.week === 1);
assert.ok(rutgersMatchupV1, 'sanity: Rutgers matchup should exist in the initial build');
assert.equal(rutgersMatchupV1.completed, false, 'sanity: game genuinely not final yet at initial load');

// Simulate exactly what a successful fetchTeamLogos(true) does: it
// REASSIGNS the whole cfbdGames array to brand-new objects freshly parsed
// from CFBD's response ("cfbdGames=body.games;" in app/js/pdf-import.js)
// -- it does NOT mutate the existing game objects in place. That
// reassignment is exactly why the old pgSurvivorCandidateGames snapshot
// (built earlier from the PREVIOUS array) ends up holding references to
// now-orphaned objects, completely disconnected from the fresh ones.
context.cfbdGames = [{
  id: 401858423, season: 2026, week: 1, startDate: '2026-09-03T22:00:00Z',
  homeId: 164, homeTeam: 'Rutgers', homeConference: 'Big Ten',
  awayId: 113, awayTeam: 'Massachusetts', awayConference: 'Mid-American',
  neutralSite: false, completed: true, homePoints: 34, awayPoints: 10,
}];

// THE BUG, reproduced: calling only refreshPickGaugeSurvivorResults() (no
// rebuild) against the SAME dataV1 object still can't see the fresh score,
// because pgSurvivorCandidateGames -- what refreshPickGaugeSurvivorResults
// actually matches against -- is still the stale snapshot from the first
// build, even though the raw cfbdGames array right next to it is current.
run(`refreshPickGaugeSurvivorResults(pgSurvivorData)`);
const staleMatchup = dataV1.matchups.find(m => m.team === 'Rutgers' && m.week === 1);
assert.equal(
  staleMatchup.completed, false,
  'BUG REPRODUCTION: without a rebuild, a genuinely fresh cfbdGames score still does not reach the matchup -- this is exactly "fetch succeeded but Rutgers still says pending"'
);

// THE FIX: pgSurvivorEnsureSharedData(true) rebuilds via
// buildPickGaugeSurvivorData() again, which repopulates
// pgSurvivorCandidateGames from the now-current cfbdGames.
const dataV2 = run(`buildPickGaugeSurvivorData('bigten')`);
context.pgSurvivorData = dataV2;
run(`refreshPickGaugeSurvivorResults(pgSurvivorData)`);
const freshMatchup = dataV2.matchups.find(m => m.team === 'Rutgers' && m.week === 1);
assert.equal(freshMatchup.completed, true, 'after a real rebuild, the fresh score reaches the matchup');
assert.equal(freshMatchup.teamPoints, 34);
assert.equal(freshMatchup.opponentPoints, 10);

console.log('Survivor Fetch Results stale-candidate-games bug reproduction + fix tests passed');
