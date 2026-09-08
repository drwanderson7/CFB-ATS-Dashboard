import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Drew's real question: "what if my line is different than what's listed?"
// e.g. Marshall -24 in hand, board shows -24.5. setPickCustomLine() lets
// the saved pick.line be overridden directly. His explicit choice when
// asked how this should interact with Edge/CLV: "Just store your line,
// keep CLV/Edge as-is off current market" -- i.e. touch ONLY p.line, never
// the frozen decision-snapshot fields (marketHomeLineAtPick,
// modelNumberAtPick, coverProbabilityAtPick, etc.) that describe what the
// market/model said at pick time. This test proves exactly that: editing
// the line changes p.line and nothing else on the pick object.

const source = fs.readFileSync(new URL('../app/js/picks.js', import.meta.url), 'utf8');
const context = vm.createContext({
  console, Math, Date, Number, String, Array, Object, Set, Map, JSON,
  state: {},
  games: [],
  save() {}, renderBoard() {}, renderEntries() {}, renderPicksDetail() {},
});
vm.runInContext(source, context, { filename: 'picks.js' });
// picks.js defines real renderBoard()/renderEntries()/renderPicksDetail()
// itself (DOM-touching), which shadow the no-op stubs passed into the
// context above -- overwrite them post-load so setPickCustomLine()'s own
// render calls are harmless in this DOM-less test. Nothing under test here
// depends on what these functions do, only on the resulting pick object.
vm.runInContext('renderBoard=function(){};renderEntries=function(){};renderPicksDetail=function(){};', context);
const run = (expr) => vm.runInContext(expr, context);

function freshEntry(picks) {
  return { id: 'e1', name: 'Entry 1', picks };
}

// Home-side pick: Marshall was the HOME team, PickGauge showed -24.5 at
// pick time (marketHomeLineAtPick, home-line convention), matching what
// pickTeam() itself would have frozen.
context.state = {
  entries: [freshEntry({
    'away@Marshall': {
      side: 'home', team: 'Marshall', line: -24.5, matchup: 'Away @ Marshall',
      marketHomeLineAtPick: -24.5, modelNumberAtPick: -21.0, coverProbabilityAtPick: 0.58,
    },
  })],
  pools: [],
};
context.activeEntry = () => context.state.entries[0];
context.entryIsLocked = () => false;

// Editing the line updates ONLY .line and sets .customLine -- everything
// else on the pick object is untouched.
let ok = run(`setPickCustomLine('away@Marshall', '-24')`);
assert.equal(ok, true);
let p = context.state.entries[0].picks['away@Marshall'];
assert.equal(p.line, -24, "the actual override");
assert.equal(p.customLine, true);
assert.equal(p.marketHomeLineAtPick, -24.5, 'frozen market snapshot must be untouched');
assert.equal(p.modelNumberAtPick, -21.0, 'frozen model snapshot must be untouched');
assert.equal(p.coverProbabilityAtPick, 0.58, 'frozen cover-probability snapshot must be untouched');
assert.equal(p.team, 'Marshall');
assert.equal(p.side, 'home');

// Clearing the field (empty string, as the input sends on a fully-erased
// field) reverts to the ORIGINAL market line from the frozen snapshot --
// not the current live line, which may have moved since -- and removes
// the customLine flag.
ok = run(`setPickCustomLine('away@Marshall', '')`);
assert.equal(ok, true);
p = context.state.entries[0].picks['away@Marshall'];
assert.equal(p.line, -24.5, 'clearing reverts to the frozen market line at pick time');
assert.equal(p.customLine, undefined);

// Away-side pick: the frozen snapshot is always home-line convention, so
// the away team's own line is the negation of marketHomeLineAtPick.
context.state.entries[0].picks['UMass@Rutgers'] = {
  side: 'away', team: 'UMass', line: 8, matchup: 'UMass @ Rutgers',
  marketHomeLineAtPick: -8,
};
run(`setPickCustomLine('UMass@Rutgers', '7.5')`);
p = context.state.entries[0].picks['UMass@Rutgers'];
assert.equal(p.line, 7.5);
assert.equal(p.customLine, true);
run(`setPickCustomLine('UMass@Rutgers', '')`);
p = context.state.entries[0].picks['UMass@Rutgers'];
assert.equal(p.line, 8, 'away-side clear reverts to -marketHomeLineAtPick, not +marketHomeLineAtPick');

// Invalid input (not a number) must be rejected, leaving the pick alone.
ok = run(`setPickCustomLine('UMass@Rutgers', 'not-a-number')`);
assert.equal(ok, false);
p = context.state.entries[0].picks['UMass@Rutgers'];
assert.equal(p.line, 8, 'a rejected edit must not have touched the stored line');

// A locked (submitted) entry must reject edits entirely.
context.entryIsLocked = () => true;
ok = run(`setPickCustomLine('UMass@Rutgers', '3')`);
assert.equal(ok, false, 'submitted entries must not be editable');

// A key with no existing pick at all must be a no-op, not a crash.
context.entryIsLocked = () => false;
ok = run(`setPickCustomLine('no-such-game', '3')`);
assert.equal(ok, false);

console.log('setPickCustomLine tests passed');
