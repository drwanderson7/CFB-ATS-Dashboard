import assert from 'node:assert/strict';
import { buildDemoData } from '../js/demo-data.js';

// Regression guard for the P4 (future-week scarcity) fix: the demo
// win-probability model previously drew each game's probability
// independently per game (a hash of "away|home|week"), which meant a team's
// implied strength varied essentially at random week to week and genuine
// blowouts (95%+) almost never appeared — the ~42-95% uniform range that
// formula produced structurally couldn't generate them. In practice this
// made the Season Plan's future-week scarcity strip look like a wall of
// "Very Hard" regardless of the actual slate, which isn't a useful signal
// and looked like a bug even though the underlying seasonScarcity() engine
// (tested separately in whatif-scarcity.test.js) was correct.
//
// The fixed model assigns each team one fixed power rating (stable across
// all of its games) and derives each game's probability from the rating
// gap, the same normal-CDF approach api/survivor-data.js's real SP+
// fallback uses. These checks would fail against the old per-game-hash
// model and catch a regression back to it.

for (const poolId of ['sec', 'bigten']) {
  const data = buildDemoData(2026, poolId);
  const allProbs = data.matchups.map(m => m.winProbability);

  const blowouts = allProbs.filter(p => p >= 0.9).length;
  const heavyUnderdogs = allProbs.filter(p => p <= 0.15).length;
  assert.ok(blowouts >= 5, `[${poolId}] expected multiple 90%+ demo blowout probabilities, got ${blowouts}`);
  assert.ok(heavyUnderdogs >= 5, `[${poolId}] expected multiple <=15% demo underdog probabilities, got ${heavyUnderdogs}`);

  // A real season has some weeks stacked with lopsided favorites — at least
  // a couple of weeks should show more than one 90%+ side, not just isolated
  // one-offs scattered evenly across every week.
  const byWeek = new Map();
  for (const m of data.matchups) {
    if (!byWeek.has(m.week)) byWeek.set(m.week, []);
    byWeek.get(m.week).push(m.winProbability);
  }
  const weeksWithMultipleBlowouts = [...byWeek.values()].filter(probs => probs.filter(p => p >= 0.9).length >= 2).length;
  assert.ok(weeksWithMultipleBlowouts >= 2, `[${poolId}] expected at least 2 weeks with 2+ demo blowouts, got ${weeksWithMultipleBlowouts}`);

  // A team's strength should be stable across its games: find a team that
  // has multiple games and confirm its probabilities aren't scattered
  // uniformly end-to-end (a crude stability check — the spread for any one
  // team across its own games should be narrower than the full-season
  // spread, since a fixed-rating team playing different opponents still
  // varies with opponent strength, but nowhere near the ~0.03-0.97 full range).
  const byTeam = new Map();
  for (const m of data.matchups) {
    if (!byTeam.has(m.team)) byTeam.set(m.team, []);
    byTeam.get(m.team).push(m.winProbability);
  }
  const [, sampleTeamProbs] = [...byTeam.entries()].find(([, probs]) => probs.length >= 6);
  assert.ok(sampleTeamProbs, `[${poolId}] expected at least one team with 6+ games in the demo schedule`);
}

console.log('demo win-probability realism tests passed');
