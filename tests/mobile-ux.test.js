import fs from 'node:fs';
import assert from 'node:assert/strict';

// After the architecture-cleanup module split, survivor.css was split into
// several ordered files. Concatenating them keeps CSS assertions meaningful
// without tracking which file each rule now lives in.
const css = ['../css/base.css', '../css/board-rankings.css', '../css/planner-dialogs.css', '../css/desktop-density.css', '../css/responsive-tablet.css', '../css/responsive-mobile.css'].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
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

assert.match(css, /grid-scroller\s*\{[\s\S]*?max-height:\s*none;[\s\S]*?overflow-x:\s*auto;[\s\S]*?overflow-y:\s*visible;/);
assert.match(css, /grid-team,\s*\n\s*\.cell,\s*\n\s*\.empty-cell\s*\{\s*min-height:\s*54px;/);
assert.match(css, /\.season-grid \.team-col\s*\{[\s\S]*?width:\s*106px;/);
assert.match(css, /\.season-grid th,\s*\n\s*\.season-grid td\s*\{\s*min-width:\s*98px;/);
assert.match(css, /\.rank-mobile-actions\s*\{[\s\S]*?display:\s*grid;/);
assert.match(css, /\.side-pick-cta\s*\{[\s\S]*?min-height:\s*44px;[\s\S]*?display:\s*block;/);
assert.match(html, /Available this week/);
assert.match(html, /<details class="board-note">/);
assert.match(app, /status-banner-toggle/);
assert.match(app, /data-dialog-pick-team/);
assert.match(app, /of \$\{weekEligible\.size\} selectable sides/);

console.log('mobile UX tests passed');
