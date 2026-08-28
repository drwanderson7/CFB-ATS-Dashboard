import assert from 'node:assert/strict';
import { buildSeasonPlan } from '../js/survivor-score.js';

function matchup({ team, opponent, week, winProbability, gameId }) {
  return {
    team,
    opponent,
    week,
    completed: false,
    winProbability,
    spread: null,
    gameId,
    probabilitySource: winProbability === null ? null : 'CFBD pregame WP',
    probabilitySourceShort: winProbability === null ? null : 'WP'
  };
}

// Regression test: a locked pick (a real, already-made selection for the active
// entry) must be honored by the planner even when the matchup has no modeled
// win probability yet, and the picked team must be marked used so it is never
// recommended again in a later week.
const matchups = [
  matchup({ team: 'Alabama', opponent: 'FCS Foe', week: 1, winProbability: null, gameId: 1 }),
  matchup({ team: 'Alabama', opponent: 'Georgia', week: 5, winProbability: 0.7, gameId: 5 }),
  matchup({ team: 'Texas', opponent: 'Rice', week: 1, winProbability: 0.95, gameId: 2 }),
  matchup({ team: 'Texas', opponent: 'Oklahoma', week: 5, winProbability: 0.55, gameId: 6 })
];

const weeks = [1, 5];
const lockedPicks = { 1: 'Alabama' };

const plan = buildSeasonPlan(matchups, weeks, new Set(), lockedPicks);

const week1Pick = plan.picks.find(p => p.week === 1);
assert.ok(week1Pick, 'week 1 should have a plan entry');
assert.equal(week1Pick.skipped, undefined, 'a locked pick must not be reported as skipped');
assert.equal(week1Pick.team, 'Alabama', 'the locked team must be honored even with no model probability');
assert.equal(week1Pick.locked, true, 'locked picks should be flagged as locked');
assert.equal(week1Pick.noModel, true, 'locked pick with no probability should be flagged noModel');
assert.equal(week1Pick.p, null, 'probability should stay null rather than being coerced to a number');

const week5Pick = plan.picks.find(p => p.week === 5);
assert.ok(week5Pick, 'week 5 should have a plan entry');
assert.notEqual(week5Pick.team, 'Alabama', 'Alabama was already used in week 1 and must not be reused in week 5');
assert.equal(week5Pick.team, 'Texas', 'Texas should be the only remaining unused candidate for week 5');

// Sanity check: without a locked pick, an unmodeled matchup is correctly excluded
// from candidates and the week is skipped, not silently mis-picked.
const noLockPlan = buildSeasonPlan(
  [matchup({ team: 'Alabama', opponent: 'FCS Foe', week: 1, winProbability: null, gameId: 1 })],
  [1],
  new Set(),
  {}
);
assert.equal(noLockPlan.picks[0].skipped, true, 'an unmodeled week with no locked pick should still be skipped');
assert.equal(noLockPlan.coverageComplete, false, 'missing model data makes the path incomplete');
assert.equal(noLockPlan.survivalProbability, null, 'an incomplete path must not publish a fake full-season survival probability');
assert.deepEqual(noLockPlan.missingWeeks, [1]);
assert.equal(noLockPlan.modeledWeekCount, 0);
assert.equal(noLockPlan.requiredWeekCount, 1);

// A fully modeled path still publishes the true multiplicative survival
// probability and reports complete coverage.
const completePlan = buildSeasonPlan([
  matchup({ team: 'Georgia', opponent: 'A', week: 1, winProbability: 0.9, gameId: 10 }),
  matchup({ team: 'Texas', opponent: 'B', week: 2, winProbability: 0.8, gameId: 11 })
], [1, 2], new Set(), {});
assert.equal(completePlan.coverageComplete, true);
assert.equal(completePlan.modeledWeekCount, 2);
assert.equal(completePlan.requiredWeekCount, 2);
assert.ok(Math.abs(completePlan.survivalProbability - 0.72) < 1e-12);


// Coverage must outrank raw log probability during the beam search itself.
// Picking A in week 1 (99%) leaves no week-2 candidate; picking B in week 1
// (80%) preserves A for week 2 (70%). The planner must choose the complete
// 0.8*0.7 path rather than a misleading one-week 0.99 path.
const coverageFirstPlan = buildSeasonPlan([
  matchup({ team: 'A', opponent: 'W1A', week: 1, winProbability: 0.99, gameId: 20 }),
  matchup({ team: 'B', opponent: 'W1B', week: 1, winProbability: 0.80, gameId: 21 }),
  matchup({ team: 'A', opponent: 'W2A', week: 2, winProbability: 0.70, gameId: 22 })
], [1, 2], new Set(), {});
assert.equal(coverageFirstPlan.coverageComplete, true, 'planner should prefer a complete path over a higher-probability path that skips a week');
assert.equal(coverageFirstPlan.picks.find(p => p.week === 1)?.team, 'B');
assert.equal(coverageFirstPlan.picks.find(p => p.week === 2)?.team, 'A');
assert.ok(Math.abs(coverageFirstPlan.survivalProbability - 0.56) < 1e-12);

console.log('season-plan tests passed');
