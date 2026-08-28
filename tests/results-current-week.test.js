import assert from 'node:assert/strict';
import { deriveCurrentPoolWeek, evaluateEntryStatus, pickResultFor, weekLifecycle } from '../js/results.js';

const HOUR = 60 * 60 * 1000;
const now = Date.parse('2026-09-13T18:00:00Z');

function side({ id, week, team, opponent='Opponent', startDate, completed=false, teamPoints=null, opponentPoints=null }) {
  return { gameId:id, week, team, opponent, startDate, completed, teamPoints, opponentPoints };
}

// Week 1 is fully final, so the app should advance to upcoming Week 2 immediately.
const completedThenUpcoming = [
  side({ id:1, week:1, team:'Georgia', startDate:'2026-09-05T16:00:00Z', completed:true, teamPoints:31, opponentPoints:10 }),
  side({ id:2, week:2, team:'Texas', startDate:'2026-09-18T23:00:00Z' })
];
assert.equal(deriveCurrentPoolWeek(completedThenUpcoming, [1,2], now), 2);

// A stale incomplete game from an old week must not strand the app there.
const staleThenUpcoming = [
  side({ id:3, week:1, team:'Alabama', startDate:'2026-09-05T16:00:00Z', completed:false }),
  side({ id:4, week:2, team:'LSU', startDate:'2026-09-18T23:00:00Z' })
];
assert.equal(weekLifecycle(staleThenUpcoming, 1, now).state, 'stale-incomplete');
assert.equal(deriveCurrentPoolWeek(staleThenUpcoming, [1,2], now), 2);

// A genuinely active game within the normal window keeps the week active.
const activeNow = Date.parse('2026-09-12T20:00:00Z');
const active = [side({ id:5, week:2, team:'Ohio State', startDate:'2026-09-12T16:00:00Z', completed:false })];
assert.equal(deriveCurrentPoolWeek(active, [2,3], activeNow), 2);

const resultGames = [
  side({ id:10, week:1, team:'Georgia', opponent:'Clemson', startDate:'2026-09-05T16:00:00Z', completed:true, teamPoints:34, opponentPoints:17 }),
  side({ id:11, week:2, team:'Alabama', opponent:'Texas', startDate:'2026-09-12T16:00:00Z', completed:true, teamPoints:21, opponentPoints:24 }),
  side({ id:12, week:3, team:'LSU', opponent:'Florida', startDate:'2026-09-19T16:00:00Z', completed:false })
];
assert.equal(pickResultFor(resultGames, 1, 'Georgia', now).status, 'win');
assert.equal(pickResultFor(resultGames, 1, 'Georgia', now).label, 'W 34–17');
assert.equal(pickResultFor(resultGames, 2, 'Alabama', now).status, 'loss');

const eliminated = evaluateEntryStatus(resultGames, {1:'Georgia',2:'Alabama'}, [1,2,3], 3, now);
assert.equal(eliminated.status, 'eliminated');
assert.equal(eliminated.eliminatedWeek, 2);
assert.equal(eliminated.record, '1-1');

const pickNeededGames = [
  side({ id:30, week:1, team:'Georgia', startDate:'2026-09-05T16:00:00Z', completed:true, teamPoints:34, opponentPoints:17 }),
  side({ id:31, week:2, team:'Texas', startDate:'2026-09-12T16:00:00Z', completed:false })
];
const pickNeeded = evaluateEntryStatus(pickNeededGames, {1:'Georgia'}, [1,2], 2, Date.parse('2026-09-10T12:00:00Z'));
assert.equal(pickNeeded.status, 'pick-needed');
assert.equal(pickNeeded.label, 'PICK NEEDED');
assert.match(pickNeeded.detail, /Week 2/);

const alive = evaluateEntryStatus(pickNeededGames, {1:'Georgia',2:'Texas'}, [1,2], 2, Date.parse('2026-09-10T12:00:00Z'));
assert.equal(alive.status, 'alive');
assert.equal(alive.record, '1-0');
assert.match(alive.detail, /Texas selected/);

// A saved pick that cannot be matched back to the loaded authoritative
// schedule is not evidence that the entry is ALIVE. Surface a first-class
// DATA ISSUE until the team/game mapping is repaired.
const unmappedPick = pickResultFor(pickNeededGames, 2, 'Ghost Team', Date.parse('2026-09-10T12:00:00Z'));
assert.equal(unmappedPick.status, 'data-issue');
assert.match(unmappedPick.label, /data issue/i);
const dataIssue = evaluateEntryStatus(pickNeededGames, {1:'Georgia',2:'Ghost Team'}, [1,2], 2, Date.parse('2026-09-10T12:00:00Z'));
assert.equal(dataIssue.status, 'data-issue');
assert.equal(dataIssue.label, 'DATA ISSUE');
assert.deepEqual(dataIssue.dataIssueWeeks, [2]);
assert.match(dataIssue.detail, /Ghost Team/);

const awaitingNow = Date.parse('2026-09-19T18:00:00Z');
const awaiting = evaluateEntryStatus(resultGames, {1:'Georgia',3:'LSU'}, [1,2,3], 3, awaitingNow);
// Week 2 is missing history, which is more important than an awaiting current result.
assert.equal(awaiting.status, 'missing-pick');
assert.deepEqual(awaiting.missingPastWeeks, [2]);


const awaitingOnlyGames = [
  side({ id:20, week:1, team:'Georgia', startDate:'2026-09-05T16:00:00Z', completed:true, teamPoints:31, opponentPoints:17 }),
  side({ id:21, week:2, team:'Texas', startDate:'2026-09-12T16:00:00Z', completed:true, teamPoints:28, opponentPoints:14 }),
  side({ id:22, week:3, team:'LSU', startDate:'2026-09-19T16:00:00Z', completed:false })
];
const awaitingClean = evaluateEntryStatus(awaitingOnlyGames, {1:'Georgia',2:'Texas',3:'LSU'}, [1,2,3], 3, awaitingNow);
assert.equal(awaitingClean.status, 'awaiting-result');
assert.equal(awaitingClean.record, '2-0');

const awaitingCompleteHistory = evaluateEntryStatus(resultGames, {1:'Georgia',2:'Alabama',3:'LSU'}, [1,2,3], 3, awaitingNow);
assert.equal(awaitingCompleteHistory.status, 'eliminated', 'a prior loss remains authoritative even while a later result is pending');

const eliminatedWithDataGap = evaluateEntryStatus(resultGames, {1:'Georgia',2:'Alabama',3:'Ghost Team'}, [1,2,3], 3, awaitingNow);
assert.equal(eliminatedWithDataGap.status, 'eliminated', 'a known loss remains authoritative even if another saved pick has a data issue');


// A fully completed, fully picked, undefeated pool is no longer just ALIVE —
// it receives the terminal SURVIVED state.
const survivedGames = [
  side({ id:40, week:1, team:'Georgia', startDate:'2026-09-05T16:00:00Z', completed:true, teamPoints:31, opponentPoints:10 }),
  side({ id:41, week:2, team:'Texas', startDate:'2026-09-12T16:00:00Z', completed:true, teamPoints:28, opponentPoints:14 }),
  side({ id:42, week:3, team:'LSU', startDate:'2026-09-19T16:00:00Z', completed:true, teamPoints:24, opponentPoints:20 })
];
const survived = evaluateEntryStatus(survivedGames, {1:'Georgia',2:'Texas',3:'LSU'}, [1,2,3], 3, Date.parse('2026-09-20T18:00:00Z'));
assert.equal(survived.status, 'survived');
assert.equal(survived.label, 'SURVIVED');
assert.equal(survived.seasonSurvived, true);
assert.equal(survived.record, '3-0');

// A missing pick in the final completed week must still be reported; the old
// currentWeek comparison could miss this exact end-of-season case.
const missingFinal = evaluateEntryStatus(survivedGames, {1:'Georgia',2:'Texas'}, [1,2,3], 3, Date.parse('2026-09-20T18:00:00Z'));
assert.equal(missingFinal.status, 'missing-pick');
assert.deepEqual(missingFinal.missingPastWeeks, [3]);

console.log('results/current-week tests passed');
