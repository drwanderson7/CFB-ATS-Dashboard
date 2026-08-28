import assert from 'node:assert/strict';
import { compareWhatIf, seasonScarcity, buildSeasonPlan } from '../js/survivor-score.js';

function matchup({ team, opponent, week, winProbability, completed = false }) {
  return { team, opponent, week, completed, winProbability, spread: null, gameId: `${team}-${week}`, probabilitySource: 'WP', probabilitySourceShort: 'WP' };
}

// --- compareWhatIf (P3) ---------------------------------------------------

// Scenario: week 3 choice between a very safe team with weak future options
// (Team A) and a slightly less safe team with a great future option it would
// otherwise have to use up later (Team B). Using A now and saving B for its
// big future spot should beat using B now.
const matchups = [
  matchup({ team: 'TeamA', opponent: 'Weak1', week: 3, winProbability: 0.95 }),
  matchup({ team: 'TeamA', opponent: 'Weak2', week: 4, winProbability: 0.55 }), // A has nothing great later
  matchup({ team: 'TeamB', opponent: 'Weak3', week: 3, winProbability: 0.85 }),
  matchup({ team: 'TeamB', opponent: 'Weak4', week: 4, winProbability: 0.97 })  // B's best spot is next week
];
const weeks = [3, 4];

const comparison = compareWhatIf(matchups, weeks, new Set(), 3, ['TeamA', 'TeamB']);
assert.equal(comparison.length, 2);
assert.equal(comparison[0].team, 'TeamA', 'using TeamA now (saving TeamB for its week-4 peak) should win the comparison');
assert.equal(comparison[0].deltaFromBest, 0, 'the top result is always 0 behind itself');
assert.ok(comparison[1].deltaFromBest < 0, 'the worse option should show a negative delta');
assert.ok(Math.abs(comparison[0].survivalProbability - (0.95 * 0.97)) < 1e-9, 'best path should be TeamA week3 * TeamB week4');
assert.ok(Math.abs(comparison[1].survivalProbability - (0.85 * 0.55)) < 1e-9, 'TeamB-now path should be TeamB week3 * TeamA week4');

// A team with no matchup that week (e.g. bye) should still return a row —
// p/opponent null rather than throwing — since the caller may still want to
// know "what if I somehow used this team" is not applicable.
const withMissing = compareWhatIf(matchups, weeks, new Set(), 3, ['TeamA', 'GhostTeam']);
const ghostRow = withMissing.find(r => r.team === 'GhostTeam');
assert.ok(ghostRow);
assert.equal(ghostRow.p, null);
assert.equal(ghostRow.opponent, null);

// Duplicate team names in the input should be deduplicated.
const deduped = compareWhatIf(matchups, weeks, new Set(), 3, ['TeamA', 'TeamA', 'TeamB']);
assert.equal(deduped.length, 2);

// Already-used teams are invalid what-if picks. A hypothetical current-week
// lock must not override the one-use rule; callers normally disable these
// choices in the UI, and the shared planner now rejects the path as incomplete.
const comparisonWithUsed = compareWhatIf(matchups, weeks, new Set(['TeamB']), 3, ['TeamA', 'TeamB']);
const teamBRow = comparisonWithUsed.find(r => r.team === 'TeamB');
assert.equal(teamBRow.coverageComplete, false);
assert.equal(teamBRow.survivalProbability, null);

console.log('compareWhatIf tests passed');

// --- seasonScarcity (P4) ---------------------------------------------------

function scarcityMatchup(team, week, winProbability) {
  return matchup({ team, opponent: `Opp-${team}-${week}`, week, winProbability });
}

const scarcityMatchups = [
  // Week 5: 8 teams >= 0.90 -> "Easy"
  ...Array.from({ length: 8 }, (_, i) => scarcityMatchup(`E${i}`, 5, 0.91)),
  ...Array.from({ length: 3 }, (_, i) => scarcityMatchup(`E-low${i}`, 5, 0.5)),
  // Week 6: 2 teams >= 0.90 -> "Hard"
  scarcityMatchup('H1', 6, 0.93),
  scarcityMatchup('H2', 6, 0.91),
  scarcityMatchup('H-low', 6, 0.6),
  // Week 8: 1 team >= 0.90 -> "Very Hard"
  scarcityMatchup('VH1', 8, 0.9),
  scarcityMatchup('VH-low', 8, 0.7)
];

const scarcity = seasonScarcity(scarcityMatchups, [5, 6, 8], new Set());
const byWeek = Object.fromEntries(scarcity.map(s => [s.week, s]));

assert.equal(byWeek[5].safeCount, 8);
assert.equal(byWeek[5].label, 'Easy');
assert.equal(byWeek[6].safeCount, 2);
assert.equal(byWeek[6].label, 'Hard');
assert.equal(byWeek[8].safeCount, 1);
assert.equal(byWeek[8].label, 'Very Hard');

// A used team's future safe game should not count toward that week's
// available-options total — it's no longer actually available to pick.
const scarcityWithUsed = seasonScarcity(scarcityMatchups, [8], new Set(['VH1']));
assert.equal(scarcityWithUsed[0].safeCount, 0);
assert.equal(scarcityWithUsed[0].label, 'Very Hard');

// A completed game shouldn't count as a future option either.
const completedGame = { ...scarcityMatchup('Done', 5, 0.99), completed: true };
const scarcityWithCompleted = seasonScarcity([...scarcityMatchups, completedGame], [5], new Set());
assert.equal(scarcityWithCompleted[0].safeCount, 8, 'a completed game must not inflate the safe-options count');

// A week with zero safe options at all (not just zero data) is "Very Hard," not a crash.
const emptyWeekScarcity = seasonScarcity(scarcityMatchups, [99], new Set());
assert.equal(emptyWeekScarcity[0].safeCount, 0);
assert.equal(emptyWeekScarcity[0].label, 'Very Hard');

console.log('seasonScarcity tests passed');

// Sanity: buildSeasonPlan itself is untouched by these additions (regression
// guard, since compareWhatIf calls it internally).
const planCheck = buildSeasonPlan(matchups, weeks, new Set(), {});
assert.ok(planCheck.survivalProbability > 0);
console.log('buildSeasonPlan regression check passed');
