import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const syncUi = fs.readFileSync(new URL('../js/sync-ui.js', import.meta.url), 'utf8');
const entryControls = fs.readFileSync(new URL('../js/entry-controls.js', import.meta.url), 'utf8');
const board = fs.readFileSync(new URL('../js/views/season-board.js', import.meta.url), 'utf8');
const rankings = fs.readFileSync(new URL('../js/views/week-rankings.js', import.meta.url), 'utf8');
const planner = fs.readFileSync(new URL('../js/views/season-plan.js', import.meta.url), 'utf8');
const picks = fs.readFileSync(new URL('../js/views/my-picks.js', import.meta.url), 'utf8');
const dialog = fs.readFileSync(new URL('../js/dialogs/matchup-dialog.js', import.meta.url), 'utf8');

assert.match(app, /from '\.\/views\/season-board\.js'/, 'app should delegate Season Board rendering');
assert.match(app, /from '\.\/views\/week-rankings\.js'/, 'app should delegate Week Rankings rendering');
assert.match(app, /from '\.\/views\/season-plan\.js'/, 'app should delegate Season Plan rendering');
assert.match(app, /from '\.\/views\/my-picks\.js'/, 'app should delegate My Picks rendering');
assert.match(app, /from '\.\/dialogs\/matchup-dialog\.js'/, 'app should delegate matchup dialog rendering');
assert.match(board, /function renderGrid\(/, 'Season Board renderer should live in its view module');
assert.match(rankings, /function renderRankings\(/, 'Week Rankings renderer should live in its view module');
assert.match(planner, /function renderPlanner\(/, 'Season Plan renderer should live in its view module');
assert.match(picks, /function renderPicks\(/, 'My Picks renderer should live in its view module');
assert.match(dialog, /function openMatchup\(/, 'matchup dialog renderer should live in its dialog module');
assert.match(entryControls, /function renderEntryControls\(/, 'entry-control rendering should be shared outside app.js');
assert.doesNotMatch(syncUi, /from '\.\/app\.js'/, 'sync-ui must not import app.js after phase 2');
assert.match(syncUi, /function configureSyncUI\(/, 'sync-ui should receive app callbacks explicitly');
assert.match(app, /configureSyncUI\(\{ renderAll, loadData, refreshResults, renderEntryStatus \}\)/, 'app should register sync callbacks before boot');
assert.ok(app.split('\n').length < 800, `app.js should remain a coordinator after extraction (got ${app.split('\n').length} lines)`);

console.log('architecture phase 2 tests passed');
