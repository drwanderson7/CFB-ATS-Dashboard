import assert from 'node:assert/strict';
import fs from 'node:fs';

// After the architecture-cleanup module split, sync logic moved out of
// js/app.js into js/sync-ui.js (and a few shared pieces into js/state.js).
// Concatenating the app module set keeps every existing assertion below meaningful
// without having to track exactly which file each pattern now lives in.
const app = [
  '../js/app.js', '../js/state.js', '../js/render-utils.js', '../js/sync-ui.js',
  '../js/entry-controls.js', '../js/views/week-rankings.js', '../js/views/season-board.js',
  '../js/views/season-plan.js', '../js/views/my-picks.js', '../js/dialogs/matchup-dialog.js'
].map(p => fs.readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));

assert.match(app, /if \(!state\.syncCode \|\| !state\.syncHydrationReady\) return;/, 'cloud pushes must be gated until initial hydration succeeds');
assert.match(app, /state\.syncHydrationReady = false;[\s\S]*fetchSyncProfile\(code\)/, 'boot pull must mark hydration incomplete before fetching');
assert.match(app, /state\.syncHydrationReady = true;[\s\S]*reloadActivePoolFromLocalStorage/, 'successful pull must unlock pushes only after cloud data is applied');
assert.match(app, /saveLocal\(\{ sync: false \}\)/, 'device-only navigation changes should persist locally without scheduling a cloud write');

assert.match(app, /syncLocalDirty: initialSyncCode \? loadSyncDirtyFlag\(\) : false/, 'unsynced local edits must survive browser reloads');
assert.match(app, /if \(state\.syncLocalDirty\) \{[\s\S]*state\.syncPendingRemote = result;[\s\S]*state\.syncStatus = 'conflict'/, 'incoming cloud data must be held for an explicit conflict choice when local edits are unsynced');
assert.match(app, /syncKeepLocalBtn[\s\S]*pushSyncProfile\(code, buildSyncProfile\(\)\)/, 'conflict UI must let the user explicitly keep this device');
assert.match(app, /syncUseCloudBtn[\s\S]*applySyncProfile\(pending\.profile\)/, 'conflict UI must let the user explicitly use the cloud copy');
assert.match(app, /resetEntryDialog\.showModal/, 'resetting an entry must require a confirmation dialog');

const syncRule = vercel.headers.find(rule => rule.source === '/api/sync');
assert.ok(syncRule, 'vercel.json must have an explicit /api/sync cache rule');
assert.match(syncRule.headers[0].value, /no-store/, 'sync cache rule must prohibit storage');

console.log('sync safety tests passed');
