import assert from 'node:assert/strict';
import { buildSeasonPlan, probabilityFor } from '../js/survivor-score.js';

function matchup(team, week, p) {
  return {
    team,
    opponent: `${team}-opp-${week}`,
    week,
    completed: false,
    winProbability: p,
    spread: null,
    gameId: `${week}-${team}`,
    probabilitySource: 'Test',
    probabilitySourceShort: 'T'
  };
}

// Independent exhaustive solver for small fixtures. It optimizes the same
// lexicographic objective as production: maximize modeled-week coverage first,
// then maximize multiplicative survival probability with one use per team.
function bruteForce(matchups, weeks, alreadyUsed = new Set()) {
  let best = null;
  function visit(index, used, picks, modeled, logP) {
    if (index === weeks.length) {
      const candidate = { picks: [...picks], modeled, logP };
      if (!best || modeled > best.modeled || (modeled === best.modeled && logP > best.logP)) best = candidate;
      return;
    }
    const week = weeks[index];
    const options = matchups
      .filter(m => m.week === week && !used.has(m.team))
      .map(m => ({ matchup: m, p: probabilityFor(m) }))
      .filter(item => item.p !== null && item.p > 0);

    // Missing-week option.
    visit(index + 1, used, [...picks, { week, skipped: true }], modeled, logP);

    for (const option of options) {
      const nextUsed = new Set(used);
      nextUsed.add(option.matchup.team);
      visit(
        index + 1,
        nextUsed,
        [...picks, { week, team: option.matchup.team, p: option.p }],
        modeled + 1,
        logP + Math.log(Math.max(option.p, 0.0001))
      );
    }
  }
  visit(0, new Set(alreadyUsed), [], 0, 0);
  return best;
}

const weeks = [1, 2, 3, 4, 5];
const matchups = [
  matchup('A', 1, 0.99), matchup('B', 1, 0.84), matchup('C', 1, 0.70),
  matchup('A', 2, 0.96), matchup('D', 2, 0.83), matchup('E', 2, 0.71),
  matchup('B', 3, 0.95), matchup('C', 3, 0.91), matchup('D', 3, 0.78),
  matchup('C', 4, 0.94), matchup('E', 4, 0.89), matchup('F', 4, 0.80),
  matchup('A', 5, 0.90), matchup('D', 5, 0.88), matchup('F', 5, 0.86)
];

const exact = buildSeasonPlan(matchups, weeks, new Set(), {});
const brute = bruteForce(matchups, weeks);
assert.equal(exact.optimizer, 'exact-assignment');
assert.equal(exact.optimality, 'exact');
assert.equal(exact.modeledWeekCount, brute.modeled, 'exact planner must match exhaustive maximum coverage');
assert.equal(exact.coverageComplete, brute.modeled === weeks.length);
assert.ok(Math.abs(Math.log(exact.modeledSurvivalProbability) - brute.logP) < 1e-10,
  'exact planner survival probability must match exhaustive optimum');

// A future lock must reserve its team against earlier open weeks while still
// allowing the exact optimizer to solve the remaining assignment globally.
const locked = buildSeasonPlan(matchups, weeks, new Set(), { 5: 'A' });
assert.equal(locked.picks.find(p => p.week === 5)?.team, 'A');
assert.equal(locked.picks.find(p => p.week === 5)?.locked, true);
assert.equal(locked.picks.find(p => p.week === 1)?.team === 'A', false, 'future lock must reserve A from Week 1');
assert.equal(locked.coverageComplete, true);

// Coverage remains lexicographically dominant over a superficially stronger
// but incomplete one-week path.
const coverage = buildSeasonPlan([
  matchup('A', 1, 0.99), matchup('B', 1, 0.80), matchup('A', 2, 0.70)
], [1, 2], new Set(), {});
assert.deepEqual(coverage.picks.map(p => p.team), ['B', 'A']);
assert.ok(Math.abs(coverage.survivalProbability - 0.56) < 1e-12);

console.log('exact planner tests passed');
