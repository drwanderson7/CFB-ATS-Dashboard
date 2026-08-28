import assert from 'node:assert/strict';
import { buildPickExplanation } from '../js/survivor-score.js';

function m(team, opponent, week, p) {
  return { team, opponent, week, completed: false, winProbability: p, spread: null, gameId: `${week}-${team}`, probabilitySource: 'WP', probabilitySourceShort: 'WP' };
}

// Team A is the safest current-week option and has little future value. Team B
// is slightly less safe now but owns an elite Week 2 spot. The explanation
// should identify A as safest, show B's future value via path comparison, and
// report future scarcity after A is burned.
const matchups = [
  m('TeamA', 'OppA1', 1, .95),
  m('TeamB', 'OppB1', 1, .90),
  m('TeamC', 'OppC1', 1, .82),
  m('TeamA', 'OppA2', 2, .60),
  m('TeamB', 'OppB2', 2, .98),
  m('TeamC', 'OppC2', 2, .70),
  m('TeamA', 'OppA3', 3, .65),
  m('TeamB', 'OppB3', 3, .75),
  m('TeamC', 'OppC3', 3, .94)
];

const info = buildPickExplanation(matchups[0], matchups, [1, 2, 3], new Set());
assert.equal(info.team, 'TeamA');
assert.equal(info.safetyRank, 1);
assert.equal(info.safestTeam, 'TeamA');
assert.equal(info.optionCount, 3);
assert.equal(info.futureBestSpot.week, 3);
assert.ok(info.comparisons.length >= 2, 'explanation should use the what-if planner for leading alternatives');
assert.ok(info.chosenPath, 'chosen team should have a path result');
assert.ok(info.pathLeader, 'leading path should be identified');
assert.ok(info.hardestFutureWeek, 'future scarcity should be included');

// If we explain Team B, it should correctly say it is not the safest current
// option and quantify the raw safety gap to Team A.
const infoB = buildPickExplanation(matchups[1], matchups, [1, 2, 3], new Set());
assert.equal(infoB.safetyRank, 2);
assert.equal(infoB.safestTeam, 'TeamA');
assert.equal(infoB.safestFutureBestSpot.week, 3, "explanation should expose the safer option best later spot for save context");
assert.ok(Math.abs(infoB.safetyGapToSafest - (-0.05)) < 1e-9);

console.log('pick explanation tests passed');
