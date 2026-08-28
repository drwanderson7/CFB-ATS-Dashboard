import assert from 'node:assert/strict';
import { buildStrategicRecommendation, survivorScore } from '../js/survivor-score.js';

function matchup(team, opponent, week, p) {
  return {
    team,
    opponent,
    week,
    completed: false,
    winProbability: p,
    spread: null,
    gameId: `${week}-${team}`,
    probabilitySource: 'Test',
    probabilitySourceShort: 'T'
  };
}

// P1.2 regression: the quick Survivor Score can prefer A because A is the
// safest immediate pick, while the season planner correctly prefers B because
// preserving A creates a stronger complete two-week path.
const matchups = [
  matchup('A', 'A1', 1, 0.99),
  matchup('B', 'B1', 1, 0.80),
  matchup('A', 'A2', 2, 0.70),
  matchup('C', 'C2', 2, 0.50)
];

const scoreA = survivorScore(matchups[0], matchups, new Set());
const scoreB = survivorScore(matchups[1], matchups, new Set());
assert.ok(scoreA > scoreB, 'fixture must prove Survivor Score and path recommendation can disagree');

const strategic = buildStrategicRecommendation(matchups, [1, 2], new Set(), 1, {});
assert.equal(strategic.recommendation?.team, 'B', 'Best Play must come from the first pick in the strongest season path');
assert.equal(strategic.coverageComplete, true);
assert.ok(Math.abs(strategic.survivalProbability - 0.56) < 1e-12, 'B then A should produce 80% × 70% = 56% path survival');

// A current-week manual pick must not redefine the model's Best Play. The
// recommendation helper deliberately ignores a current-week lock.
const ignoresCurrentLock = buildStrategicRecommendation(matchups, [1, 2], new Set(), 1, { 1: 'A' });
assert.equal(ignoresCurrentLock.recommendation?.team, 'B');

// A future manually locked pick is real state and must be respected. Locking
// A in Week 2 makes B the only valid Week 1 route to that future plan.
const respectsFutureLock = buildStrategicRecommendation(matchups, [1, 2], new Set(), 1, { 2: 'A' });
assert.equal(respectsFutureLock.recommendation?.team, 'B');
assert.equal(respectsFutureLock.picks.find(p => p.week === 2)?.team, 'A');
assert.equal(respectsFutureLock.picks.find(p => p.week === 2)?.locked, true);

console.log('strategic recommendation source tests passed');
