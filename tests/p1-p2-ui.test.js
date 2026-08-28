import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
// After the architecture-cleanup module split, some app.js logic moved into
// js/state.js, js/render-utils.js, and js/sync-ui.js. Concatenating the app module set
// keeps the assertions below meaningful without tracking which file each
// pattern now lives in.
const app = [
  '../js/app.js', '../js/state.js', '../js/render-utils.js', '../js/sync-ui.js',
  '../js/entry-controls.js', '../js/views/week-rankings.js', '../js/views/season-board.js',
  '../js/views/season-plan.js', '../js/views/my-picks.js', '../js/dialogs/matchup-dialog.js'
].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
// After the architecture-cleanup module split, survivor.css was split into
// several ordered files. Concatenating them keeps CSS assertions meaningful
// without tracking which file each rule now lives in.
const css = ['../css/base.css', '../css/board-rankings.css', '../css/planner-dialogs.css', '../css/desktop-density.css', '../css/responsive-tablet.css', '../css/responsive-mobile.css'].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');

assert.match(html, /id="resetEntryDialog"/, 'entry reset must have a confirmation dialog');
assert.match(html, /id="confirmResetPicksBtn"/, 'entry reset confirmation needs an explicit destructive action');
assert.match(html, /id="whyPickPanel"/, 'Best Play needs a dedicated Why this pick panel');
assert.match(app, /data-why-pick-game/, 'Best Play must expose the Why this pick action');
assert.match(app, /buildPickExplanation\(/, 'Why this pick UI must use the explanation engine');
assert.match(app, /Safety[\s\S]*Future cost[\s\S]*Season path[\s\S]*Future scarcity/, 'explanation should surface the four decision factors');
assert.match(app, /Keep this device[\s\S]*Use synced copy/, 'sync conflict UI must expose both explicit resolution choices');
assert.match(css, /\.why-pick-grid/, 'Why this pick needs responsive visual styling');
assert.match(css, /\.sync-conflict-box/, 'sync conflict choice needs visible styling');

console.log('P1.3/P2 UI tests passed');
