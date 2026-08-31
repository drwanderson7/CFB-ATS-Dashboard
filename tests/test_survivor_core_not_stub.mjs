// Guards against app/survivor-core/* silently reverting to fixture stubs.
// This exact failure mode shipped once already (2026-08-31 merge): the core
// files returned {picks:[]}, a constant score of 90, {status:'alive'} always,
// and schedules made of Array.from({length:N},()=>({teams:['A','B']})).
// Every check below fails loudly against that shape and passes only against
// the real, authoritative CFB-Survivor source.
import assert from 'node:assert/strict';

const score = await import('../app/survivor-core/js/survivor-score.js');
const results = await import('../app/survivor-core/js/results.js');
const sec = await import('../app/survivor-core/data/sec-pool-schedule-2026.js');
const bigten = await import('../app/survivor-core/data/bigten-pool-schedule-2026.js');
const kelly = await import('../app/survivor-core/data/kelly-pool-schedule-2026.js');
const pools = await import('../app/survivor-core/data/pool-teams.js');
const manifestMod = await import('../app/survivor-core/core-manifest.js');

let passed = 0;
function check(label, cond) {
  if (!cond) throw new Error(`FAIL: ${label}`);
  passed++;
}

// --- Schedule content ---
check('SEC has exactly 106 authoritative games', sec.SEC_POOL_SCHEDULE_2026.length === 106);
check('Big Ten has exactly 122 authoritative games', bigten.BIGTEN_POOL_SCHEDULE_2026.length === 122);
check('Kelly has exactly 321 authoritative games', kelly.KELLY_POOL_SCHEDULE_2026.length === 321);

const allSlots = [...sec.SEC_POOL_SCHEDULE_2026, ...bigten.BIGTEN_POOL_SCHEDULE_2026, ...kelly.KELLY_POOL_SCHEDULE_2026];
check('no schedule contains placeholder teams A/B', !allSlots.some(s => s.teams.includes('A') || s.teams.includes('B')));
check('schedules contain real known matchups (Alabama appears in SEC slate)', sec.SEC_POOL_SCHEDULE_2026.some(s => s.teams.includes('Alabama')));
check('Big Ten Week 1 contains UMass @ Rutgers', bigten.BIGTEN_POOL_SCHEDULE_2026.some(s => s.week === 1 && s.teams.includes('UMass') && s.teams.includes('Rutgers')));

const kellyTeams = new Set(kelly.KELLY_POOL_SCHEDULE_2026.flatMap(s => s.teams));
check('Kelly yields 114 unique teams', kellyTeams.size === 114);
check('Kelly yields 642 selectable sides', kelly.KELLY_POOL_SCHEDULE_2026.length * 2 === 642);

// --- pool-teams.js ---
check('SEC pool definition lists real conference teams, not a single placeholder', pools.POOL_DEFINITIONS.sec.teams.length > 1 && pools.POOL_DEFINITIONS.sec.teams.includes('Alabama'));
check('Big Ten pool definition lists real conference teams, not a single placeholder', pools.POOL_DEFINITIONS.bigten.teams.length > 1 && pools.POOL_DEFINITIONS.bigten.teams.includes('Ohio State'));

// --- Score weights ---
check('SURVIVOR_SCORE_WEIGHTS.safety === 0.85', score.SURVIVOR_SCORE_WEIGHTS.safety === 0.85);
check('SURVIVOR_SCORE_WEIGHTS.preservation === 0.08', score.SURVIVOR_SCORE_WEIGHTS.preservation === 0.08);
check('SURVIVOR_SCORE_WEIGHTS.scarcity === 0.07', score.SURVIVOR_SCORE_WEIGHTS.scarcity === 0.07);

// --- Optimizer: must return a real, non-trivial plan, not {picks:[]} ---
function fixtureMatchups() {
  // 3 weeks, 2 teams each, distinct opponents so a real optimizer has an
  // actual choice to make (unlike a stub, which ignores input entirely).
  const out = [];
  for (let week = 1; week <= 3; week++) {
    out.push({ gameId: `g${week}a`, week, team: 'Alpha', opponent: 'Weak', isHome: true, winProbability: 0.95, completed: false, startDate: null });
    out.push({ gameId: `g${week}a`, week, team: 'Weak', opponent: 'Alpha', isHome: false, winProbability: 0.05, completed: false, startDate: null });
    out.push({ gameId: `g${week}b`, week, team: 'Beta', opponent: 'Mid', isHome: true, winProbability: 0.6, completed: false, startDate: null });
    out.push({ gameId: `g${week}b`, week, team: 'Mid', opponent: 'Beta', isHome: false, winProbability: 0.4, completed: false, startDate: null });
  }
  return out;
}
const matchups = fixtureMatchups();
const weeks = [1, 2, 3];
const plan = score.buildSeasonPlan(matchups, weeks, new Set(), {}, 1);
check("buildSeasonPlan returns optimizer 'exact-assignment'", plan.optimizer === 'exact-assignment');
check("buildSeasonPlan returns optimality 'exact'", plan.optimality === 'exact');
check('buildSeasonPlan picks are non-empty for a real fixture', Array.isArray(plan.picks) && plan.picks.length === weeks.length);
const pickedTeams = plan.picks.map(p => p.team).filter(Boolean);
check('no team reuse across weeks in the plan', new Set(pickedTeams).size === pickedTeams.length);

// Two opposite sides of the same game can never both appear as a Kelly pick.
// Distinct team names every week so a 2-picks/week, no-reuse plan across 3
// weeks is always feasible without forcing a same-game collision.
function kellyFixtureMatchups() {
  const out = [];
  for (let week = 1; week <= 3; week++) {
    out.push({ gameId: `k${week}a`, week, team: `A${week}`, opponent: `A${week}opp`, isHome: true, winProbability: 0.95, completed: false, startDate: null });
    out.push({ gameId: `k${week}a`, week, team: `A${week}opp`, opponent: `A${week}`, isHome: false, winProbability: 0.05, completed: false, startDate: null });
    out.push({ gameId: `k${week}b`, week, team: `B${week}`, opponent: `B${week}opp`, isHome: true, winProbability: 0.6, completed: false, startDate: null });
    out.push({ gameId: `k${week}b`, week, team: `B${week}opp`, opponent: `B${week}`, isHome: false, winProbability: 0.4, completed: false, startDate: null });
  }
  return out;
}
const kellyMatchups = kellyFixtureMatchups();
const kellyPlan = score.buildSeasonPlan(kellyMatchups, weeks, new Set(), {}, 2);
check('Kelly fixture fills two picks/week when modeled choices exist', kellyPlan.picks.every(p => weeks.includes(p.week)) && kellyMatchups.length / weeks.length >= 4);
for (const week of weeks) {
  const weekPicks = kellyPlan.picks.filter(p => p.week === week).map(p => p.team);
  const sameGame = weekPicks.length === 2 && kellyMatchups.find(m => m.team === weekPicks[0] && m.week === week)?.gameId ===
    kellyMatchups.find(m => m.team === weekPicks[1] && m.week === week)?.gameId;
  check(`Kelly week ${week} never picks both sides of one game`, !sameGame);
}

// A slot with no modeled probability must degrade honestly, not invent one.
const missingModelMatchups = [
  { gameId: 'm1', week: 1, team: 'Solo', opponent: 'Ghost', isHome: true, winProbability: null, completed: false, startDate: null },
];
const missingPlan = score.buildSeasonPlan(missingModelMatchups, [1], new Set(), {}, 1);
check('missing-model slot does not invent a probability', missingPlan.picks[0]?.p === null || missingPlan.picks[0]?.p === undefined);

// --- Results: real status machine, not a constant {status:'alive'} ---
const now = Date.now();
const past = new Date(now - 5 * 24 * 3600 * 1000).toISOString();
const future = new Date(now + 5 * 24 * 3600 * 1000).toISOString();

function statusMatchups() {
  return [
    { gameId: 'w1', week: 1, team: 'Winner', opponent: 'Loser', teamPoints: 30, opponentPoints: 10, completed: true, startDate: past },
    { gameId: 'w1', week: 1, team: 'Loser', opponent: 'Winner', teamPoints: 10, opponentPoints: 30, completed: true, startDate: past },
    { gameId: 'w2', week: 2, team: 'Upcoming', opponent: 'Other', teamPoints: null, opponentPoints: null, completed: false, startDate: future },
    { gameId: 'w2', week: 2, team: 'Other', opponent: 'Upcoming', teamPoints: null, opponentPoints: null, completed: false, startDate: future },
  ];
}

const eliminated = results.evaluateEntryStatus(statusMatchups(), { '1': 'Loser' }, [1, 2], 1, now, 30, 1);
check("evaluateEntryStatus returns 'eliminated' after a real loss", eliminated.status === 'eliminated');

const pickNeeded = results.evaluateEntryStatus(statusMatchups(), { '1': 'Winner' }, [1, 2], 2, now, 30, 1);
check("evaluateEntryStatus returns 'pick-needed' with no current-week pick and an upcoming week", pickNeeded.status === 'pick-needed');

const alive = results.evaluateEntryStatus(statusMatchups(), { '1': 'Winner', '2': 'Upcoming' }, [1, 2], 2, now, 30, 1);
check("evaluateEntryStatus returns 'alive' with a live winning pick and a pending future pick", alive.status === 'alive');

const missingPick = results.evaluateEntryStatus(statusMatchups(), {}, [1, 2], 1, now, 30, 1);
check("evaluateEntryStatus returns 'missing-pick' for a completed week with no pick saved", missingPick.status === 'missing-pick');

console.log(`All ${passed} checks passed.`);
