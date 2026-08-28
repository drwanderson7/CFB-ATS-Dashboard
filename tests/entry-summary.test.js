import assert from 'node:assert/strict';
import fs from 'node:fs';

const app = fs.readFileSync(new URL('../js/app.js', import.meta.url), 'utf8');
const css = [
  '../css/planner-dialogs.css',
  '../css/responsive-mobile.css'
].map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

assert.match(app, /aria-label="Active entry summary"/, 'entry status should expose a compact summary group');
for (const label of ['Record', 'Pool week', 'Pick', 'Used', 'Sync']) {
  assert.match(app, new RegExp(`<b>${label}<\\/b>`), `entry summary should include ${label}`);
}
assert.match(app, /selectedPickForWeek\(poolWeek\)/, 'summary Pick should be based on the actual pool week, not a future week the user is browsing');
assert.match(app, /Number\(week\) <= poolWeek/, 'summary Used count should exclude picks merely reserved in future weeks');
assert.match(app, /state\.syncCode \? syncStatusLabel\(\) : 'Off'/, 'summary should surface cross-device sync state');
assert.match(app, /configureSyncUI\(\{ renderAll, loadData, refreshResults, renderEntryStatus \}\)/, 'sync UI should be able to refresh the shared entry summary when sync status changes');
assert.match(app, /activePool\(\)\.name/, 'summary identity should include the active survivor pool');
assert.match(css, /\.entry-summary-chip/, 'summary chips need compact visual styling');
assert.match(css, /grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)/, 'mobile entry summary should collapse to a readable two-column grid');

console.log('entry summary tests passed');
