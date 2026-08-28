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

assert.match(html, /id="entryStatusBar"/, 'entry status bar should be rendered in the app shell');
assert.match(app, /evaluateEntryStatus\(/, 'app should derive entry status from game results');
assert.match(app, /pickResultFor\(state\.data\.matchups/, 'My Picks should render per-pick result data');
assert.match(app, /season survived/, 'completed undefeated entries should surface a season-survived metric state');
assert.match(app, /forceFresh: true/, 'manual refresh should request a cache-bypassing data load');
assert.match(app, /RESULTS_REFRESH_MS = 5 \* 60 \* 1000/, 'visible app should periodically refresh results');
// Regression guard: startAutomaticResultRefresh() was previously called a
// second time from inside the sync dialog's "Retry" handler by mistake, in
// addition to the one legitimate call at boot. Since its return value (the
// interval id) was never captured or cleared anywhere, every retry click
// stacked a new never-ending setInterval on top of the others, multiplying
// CFBD polling and re-renders for the rest of the session. Fixed by removing
// the stray call and making the function clear any prior timer of its own
// before starting a new one, so a future duplicate call is a no-op rather
// than a leak. Both properties are checked here.
assert.equal((app.match(/startAutomaticResultRefresh\(\)/g) || []).length, 2, 'exactly one definition and one call site should remain (was 3: definition + 2 call sites)');
assert.match(app, /if \(resultsRefreshTimer !== null\) clearInterval\(resultsRefreshTimer\)/, 'starting the refresh timer must clear any previous one first');
assert.match(css, /\.entry-status-bar\.is-eliminated/, 'eliminated state should have distinct visual treatment');
assert.match(css, /\.entry-status-bar\.is-pick-needed/, 'pick-needed state should have distinct visual treatment');
assert.match(css, /\.entry-status-bar\.is-data-issue/, 'data-issue state should have distinct visual treatment');
assert.match(css, /\.entry-status-bar\.is-survived/, 'survived state should have distinct visual treatment');
assert.match(css, /\.pick-result\.is-win/, 'win result badge should be styled');
assert.match(css, /\.pick-result\.is-loss/, 'loss result badge should be styled');
assert.match(css, /\.pick-result\.is-data-issue/, 'data-issue result badge should be styled');
assert.match(app, /Research only · entry status unresolved/, 'Best Play should be clearly research-only while an entry has unresolved result data');

console.log('results UI tests passed');
