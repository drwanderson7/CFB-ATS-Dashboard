import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// The other half of the Sept 4 2026 fix: with api/fetch_teams.py now
// carrying homePoints/awayPoints (see tests/test_fetch_teams_final_scores.py),
// this confirms refreshPickGaugeSurvivorResults() actually consumes that
// data correctly end-to-end -- completed status AND a real final score --
// with cfbdScoreboard completely EMPTY, i.e. exactly the state a free-tier
// CFBD key leaves it in (the live /scoreboard endpoint is paid-tier-only
// and 401s). If this works with zero live-scoreboard data, Survivor's
// results no longer depend on the paid endpoint at all.

const source = fs.readFileSync(new URL('../app/js/survivor-data-adapter.js', import.meta.url), 'utf8');
const context = vm.createContext({
  console, Math, Date, Number, String, Array, Object, Set, Map, JSON,
  window: { PickGaugeSurvivorCore: { manifest: { schedules: {} }, schedules: {} } },
  localStorage: { getItem() { return null; }, setItem() {} },
  // The paid live endpoint returns nothing on a free-tier key -- this is
  // the actual state fetchCfbdScoreboard(true) leaves cfbdScoreboard in
  // after a 401, not a contrived empty array.
  cfbdScoreboard: [],
  cfbdRatings: [], games: [], teamLogos: [],
  teamMatch: (a, b) => String(a).toLowerCase() === String(b).toLowerCase(),
  // The real Rutgers/Massachusetts game, exactly as api/fetch_teams.py now
  // returns it: a real CFBD id, completed:true, and (after today's fix)
  // real homePoints/awayPoints.
  cfbdGames: [{
    id: 401858423, season: 2026, week: 1, completed: true,
    homeId: 164, homeTeam: 'Rutgers', awayId: 113, awayTeam: 'Massachusetts',
    homePoints: 34, awayPoints: 10,
  }],
});
vm.runInContext(source, context, { filename: 'survivor-data-adapter.js' });
const run = (expr) => vm.runInContext(expr, context);

context.pgSurvivorData = {
  matchups: [
    // Rutgers picked the home side; a losing pick (24 < 34... wait, Rutgers
    // IS the home team and scored 34, the winner) -- model this as a Rutgers
    // survivor pick, which should resolve to a WIN (34 > 10).
    { gameId: 401858423, team: 'Rutgers', isHome: true, week: 1 },
    // Massachusetts picked the away side on the same real game -- should
    // resolve to a LOSS (10 < 34).
    { gameId: 401858423, team: 'Massachusetts', isHome: false, week: 1 },
  ],
};

const result = run('refreshPickGaugeSurvivorResults(pgSurvivorData)');

const rutgers = result.matchups.find(m => m.team === 'Rutgers');
const umass = result.matchups.find(m => m.team === 'Massachusetts');

assert.equal(rutgers.completed, true, 'completed should resolve to true from cg.completed alone, no live scoreboard needed');
assert.equal(rutgers.teamPoints, 34, "Rutgers' own score should come from cg.homePoints, not a live feed");
assert.equal(rutgers.opponentPoints, 10);

assert.equal(umass.completed, true);
assert.equal(umass.teamPoints, 10, "Massachusetts' own score should come from cg.awayPoints");
assert.equal(umass.opponentPoints, 34);

console.log('Survivor results-from-free-tier-games (no live scoreboard) tests passed');
