import assert from 'node:assert/strict';
import fs from 'node:fs';

const syncUI = fs.readFileSync(new URL('../js/sync-ui.js', import.meta.url), 'utf8');
const state = fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
const css = [
  '../css/desktop-density.css',
  '../css/responsive-mobile.css'
].map(path => fs.readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');

assert.match(state, /syncPendingLink:\s*null/, 'state should explicitly track an initial-link confirmation separately from normal sync conflicts');
assert.match(syncUI, /localSummary\.totalPicks\s*>\s*0/, 'initial linking should guard devices that already have saved picks');
assert.match(syncUI, /Nothing has been replaced yet/i, 'confirmation copy must make it clear local data is still intact');
assert.match(syncUI, /Use synced copy &amp; link/, 'the destructive direction should require an explicit confirmation button');
assert.match(syncUI, /syncLinkCancelBtn/, 'the user must have a non-destructive cancel path');
assert.match(syncUI, /Initial linking never overwrites the existing cloud copy/i, 'initial-link UI should explicitly avoid encouraging a destructive cloud overwrite');
assert.match(syncUI, /finishSyncLink\(pending\)/, 'remote data should only be applied after explicit confirmation when local picks exist');
assert.match(css, /\.sync-link-compare/, 'desktop link comparison should have dedicated styling');
assert.match(css, /\.sync-link-confirm-actions/, 'link confirmation actions should have dedicated styling');

console.log('sync-link safety tests passed');
